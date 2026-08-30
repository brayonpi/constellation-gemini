from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from threading import RLock
from typing import Protocol

from .digests import sha256_digest
from .models import AuditEvent, MissionRecord, utc_now


class IdempotencyConflict(RuntimeError):
    """An idempotency key was reused with a different request digest."""


class ConcurrentUpdate(RuntimeError):
    """The mission changed after it was read."""


class StoreProtocol(Protocol):
    def get(self, mission_id: str) -> MissionRecord | None: ...
    def put(self, mission: MissionRecord, *, expected_version: int | None = None) -> MissionRecord: ...
    def claim_idempotency(self, operation: str, key: str, mission_id: str, request_digest: str) -> str: ...
    def list_events(self, mission_id: str, after_sequence: int = 0) -> list[AuditEvent]: ...


class MissionStore:
    """SQLite development store with optimistic concurrency and append-only events."""

    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._initialize()

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._connection() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS missions (
                    id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    version INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS audit_events (
                    mission_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    payload TEXT NOT NULL,
                    PRIMARY KEY (mission_id, sequence)
                );
                CREATE TABLE IF NOT EXISTS idempotency (
                    operation TEXT NOT NULL,
                    key TEXT NOT NULL,
                    mission_id TEXT NOT NULL,
                    request_digest TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT '',
                    PRIMARY KEY (operation, key)
                );
                """
            )
            self._ensure_column(connection, "missions", "version", "INTEGER NOT NULL DEFAULT 0")
            self._ensure_column(connection, "idempotency", "request_digest", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(connection, "idempotency", "created_at", "TEXT NOT NULL DEFAULT ''")

    @staticmethod
    def _ensure_column(connection: sqlite3.Connection, table: str, column: str, declaration: str) -> None:
        columns = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}
        if column not in columns:
            connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {declaration}")

    def get(self, mission_id: str) -> MissionRecord | None:
        with self._lock, self._connection() as connection:
            row = connection.execute("SELECT payload, version FROM missions WHERE id = ?", (mission_id,)).fetchone()
            if not row:
                return None
            events = connection.execute(
                "SELECT payload FROM audit_events WHERE mission_id=? ORDER BY sequence", (mission_id,)
            ).fetchall()
        mission = MissionRecord.model_validate_json(row["payload"])
        mission.version = int(row["version"])
        mission.audit = [AuditEvent.model_validate_json(event["payload"]) for event in events]
        return mission

    def put(self, mission: MissionRecord, *, expected_version: int | None = None) -> MissionRecord:
        with self._lock, self._connection() as connection:
            row = connection.execute("SELECT version FROM missions WHERE id=?", (mission.id,)).fetchone()
            current_version = int(row["version"]) if row else 0
            if expected_version is not None and current_version != expected_version:
                raise ConcurrentUpdate(
                    f"mission version changed: expected {expected_version}, observed {current_version}"
                )
            mission.version = current_version + 1
            mission.updated_at = utc_now()
            stored = mission.model_copy(deep=True)
            stored.audit = []
            payload = stored.model_dump_json()
            connection.execute(
                "INSERT INTO missions(id, payload, version, updated_at) VALUES(?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, version=excluded.version, "
                "updated_at=excluded.updated_at",
                (mission.id, payload, mission.version, mission.updated_at.isoformat()),
            )
            connection.executemany(
                "INSERT OR IGNORE INTO audit_events(mission_id, sequence, payload) VALUES(?, ?, ?)",
                [(mission.id, event.sequence, event.model_dump_json()) for event in mission.audit],
            )
        return mission

    def claim_idempotency(self, operation: str, key: str, mission_id: str, request_digest: str) -> str:
        with self._lock, self._connection() as connection:
            row = connection.execute(
                "SELECT mission_id, request_digest FROM idempotency WHERE operation=? AND key=?",
                (operation, key),
            ).fetchone()
            if row:
                previous = str(row["request_digest"])
                if previous and previous != request_digest:
                    raise IdempotencyConflict("idempotency key was reused with a different request")
                if not previous:
                    connection.execute(
                        "UPDATE idempotency SET request_digest=? WHERE operation=? AND key=?",
                        (request_digest, operation, key),
                    )
                return str(row["mission_id"])
            connection.execute(
                "INSERT INTO idempotency(operation, key, mission_id, request_digest, created_at) "
                "VALUES(?, ?, ?, ?, ?)",
                (operation, key, mission_id, request_digest, utc_now().isoformat()),
            )
        return mission_id

    def list_events(self, mission_id: str, after_sequence: int = 0) -> list[AuditEvent]:
        with self._lock, self._connection() as connection:
            rows = connection.execute(
                "SELECT payload FROM audit_events WHERE mission_id=? AND sequence>? ORDER BY sequence",
                (mission_id, after_sequence),
            ).fetchall()
        return [AuditEvent.model_validate_json(row["payload"]) for row in rows]


class FirestoreMissionStore:
    """Firestore adapter using mission versions and append-only event subcollections."""

    def __init__(self, project: str):
        try:
            from google.cloud import firestore
        except ImportError as exc:  # pragma: no cover - optional cloud dependency
            raise RuntimeError("install the google dependency group for Firestore mode") from exc
        self.firestore = firestore
        self.client = firestore.Client(project=project)
        self.collection = self.client.collection("constellation_missions")

    def get(self, mission_id: str) -> MissionRecord | None:
        reference = self.collection.document(mission_id)
        snapshot = reference.get()
        if not snapshot.exists:
            return None
        payload = snapshot.to_dict()
        payload["audit"] = [event.to_dict() for event in reference.collection("events").order_by("sequence").stream()]
        return MissionRecord.model_validate(payload)

    def put(self, mission: MissionRecord, *, expected_version: int | None = None) -> MissionRecord:
        reference = self.collection.document(mission.id)
        transaction = self.client.transaction()

        @self.firestore.transactional
        def _write(transaction):
            snapshot = reference.get(transaction=transaction)
            current_version = int(snapshot.to_dict().get("version", 0)) if snapshot.exists else 0
            if expected_version is not None and current_version != expected_version:
                raise ConcurrentUpdate(
                    f"mission version changed: expected {expected_version}, observed {current_version}"
                )
            mission.version = current_version + 1
            mission.updated_at = utc_now()
            payload = mission.model_dump(mode="json", exclude={"audit"})
            transaction.set(reference, payload)
            for event in mission.audit:
                transaction.set(
                    reference.collection("events").document(f"{event.sequence:08d}"),
                    event.model_dump(mode="json"),
                )

        _write(transaction)
        return mission

    def claim_idempotency(self, operation: str, key: str, mission_id: str, request_digest: str) -> str:
        document_id = sha256_digest({"operation": operation, "key": key})
        reference = self.client.collection("constellation_idempotency").document(document_id)
        transaction = self.client.transaction()

        @self.firestore.transactional
        def _claim(transaction):
            snapshot = reference.get(transaction=transaction)
            if snapshot.exists:
                payload = snapshot.to_dict()
                if payload.get("request_digest") != request_digest:
                    raise IdempotencyConflict("idempotency key was reused with a different request")
                return payload["mission_id"]
            transaction.set(
                reference,
                {
                    "operation": operation,
                    "mission_id": mission_id,
                    "request_digest": request_digest,
                    "created_at": utc_now(),
                },
            )
            return mission_id

        return str(_claim(transaction))

    def list_events(self, mission_id: str, after_sequence: int = 0) -> list[AuditEvent]:
        query = (
            self.collection.document(mission_id)
            .collection("events")
            .where("sequence", ">", after_sequence)
            .order_by("sequence")
        )
        return [AuditEvent.model_validate(snapshot.to_dict()) for snapshot in query.stream()]
