from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from typing import Any

from .config import Settings
from .digests import canonical_json
from .models import ArtifactManifest, MissionRecord
from .review_guide import AI_REVIEW_PROMPT


class ArtifactNotFound(FileNotFoundError):
    pass


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode()


def _zip_bytes(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, content in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, content)
    return buffer.getvalue()


def _content_type(name: str) -> str:
    if name.endswith(".ndjson"):
        return "application/x-ndjson"
    if name.endswith(".md"):
        return "text/markdown"
    if name.endswith(".py"):
        return "text/x-python"
    return "application/json"


class ArtifactStore:
    """Writes immutable mission evidence locally and, when configured, to Cloud Storage."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.base = settings.artifact_dir.resolve()
        self.base.mkdir(parents=True, exist_ok=True)

    def write(self, mission_id: str, name: str, content: bytes, content_type: str, provenance: str) -> ArtifactManifest:
        safe_name = Path(name).name
        if safe_name != name or not safe_name:
            raise ValueError("artifact name must be a plain filename")
        mission_dir = self.base / mission_id
        mission_dir.mkdir(parents=True, exist_ok=True)
        path = mission_dir / safe_name
        if path.exists() and path.read_bytes() != content:
            raise RuntimeError(f"immutable artifact collision: {safe_name}")
        if not path.exists():
            path.write_bytes(content)

        storage_uri = str(path)
        if self.settings.mode == "cloud" and self.settings.artifact_bucket:
            try:
                from google.cloud import storage
            except ImportError as exc:  # pragma: no cover - optional cloud dependency
                raise RuntimeError("install the google dependency group for Cloud Storage") from exc
            blob_name = f"missions/{mission_id}/{safe_name}"
            blob = storage.Client(project=self.settings.google_cloud_project).bucket(
                self.settings.artifact_bucket
            ).blob(blob_name)
            if not blob.exists():
                blob.upload_from_string(content, content_type=content_type, if_generation_match=0)
            storage_uri = f"gs://{self.settings.artifact_bucket}/{blob_name}"

        return ArtifactManifest(
            name=safe_name,
            content_type=content_type,
            size=len(content),
            sha256=_bytes_digest(content),
            provenance=provenance,
            storage_uri=storage_uri,
        )

    def read(self, mission_id: str, name: str) -> bytes:
        safe_name = Path(name).name
        if safe_name != name:
            raise ArtifactNotFound(name)
        path = self.base / mission_id / safe_name
        if path.is_file():
            return path.read_bytes()
        if self.settings.mode == "cloud" and self.settings.artifact_bucket:
            from google.cloud import storage

            blob = storage.Client(project=self.settings.google_cloud_project).bucket(
                self.settings.artifact_bucket
            ).blob(f"missions/{mission_id}/{safe_name}")
            if blob.exists():
                return blob.download_as_bytes()
        raise ArtifactNotFound(name)


def _bytes_digest(content: bytes) -> str:
    import hashlib

    return hashlib.sha256(content).hexdigest()


def build_mission_artifacts(settings: Settings, mission: MissionRecord) -> list[ArtifactManifest]:
    """Materialize the complete, independently replayable evidence set."""
    store = ArtifactStore(settings)
    selected = set(mission.plan.selected_bundle_ids if mission.plan else [])
    patch = {
        "target": "sandbox",
        "review_required_for_external_system": True,
        "apply_status": mission.plan.apply_status if mission.plan else "not_applied",
        "replace_schedule_with_bundles": sorted(selected),
        "plan_digest": (
            mission.plan.verification_report.plan_digest
            if mission.plan and mission.plan.verification_report
            else None
        ),
    }
    files: dict[str, bytes] = {
        "mission.json": _json_bytes(mission.model_dump(mode="json", exclude={"artifacts"})),
        "canonical-model.json": _json_bytes(mission.intent.model_dump(mode="json") if mission.intent else None),
        "fixture.json": _json_bytes(mission.snapshot.model_dump(mode="json")),
        "candidate-bundles.json": _json_bytes([bundle.model_dump(mode="json") for bundle in mission.bundles]),
        "selected-bundles.json": _json_bytes(
            [bundle.model_dump(mode="json") for bundle in mission.bundles if bundle.id in selected]
        ),
        "mission-result.json": _json_bytes(mission.plan.model_dump(mode="json") if mission.plan else None),
        "verification-report.json": _json_bytes(
            mission.plan.verification_report.model_dump(mode="json")
            if mission.plan and mission.plan.verification_report
            else None
        ),
        "runtime-telemetry.json": _json_bytes(
            mission.runtime_telemetry.model_dump(mode="json") if mission.runtime_telemetry else None
        ),
        "mission-patch.json": _json_bytes(patch),
        "events.ndjson": "".join(canonical_json(event) + "\n" for event in mission.audit).encode(),
        "AI-REVIEW-PROMPT.md": AI_REVIEW_PROMPT.encode(),
        "VERIFIER-SOURCE.py": Path(__file__).with_name("verifier.py").read_bytes(),
    }
    checksums = {name: _bytes_digest(content) for name, content in sorted(files.items())}
    files["checksums.json"] = _json_bytes(checksums)
    replay = _zip_bytes(files)

    manifests = [
        store.write(
            mission.id,
            name,
            content,
            _content_type(name),
            "Constellation runtime",
        )
        for name, content in files.items()
    ]
    manifests.append(
        store.write(
            mission.id,
            "mission-replay.zip",
            replay,
            "application/zip",
            "Constellation deterministic replay packager",
        )
    )
    return sorted(manifests, key=lambda item: item.name)
