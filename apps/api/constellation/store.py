from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from threading import RLock

from .models import MissionRecord, utc_now


class MissionStore:
    """Small durable local store with an interface that can be replaced by Firestore."""

    def __init__(self, path: Path):
        self.path = path
        self._lock = RLock()
        self._initialize()

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._connection() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS missions (
                    id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS idempotency (
                    operation TEXT NOT NULL,
                    key TEXT NOT NULL,
                    mission_id TEXT NOT NULL,
                    PRIMARY KEY (operation, key)
                );
                """
            )

    def get(self, mission_id: str) -> MissionRecord | None:
        with self._lock, self._connection() as connection:
            row = connection.execute("SELECT payload FROM missions WHERE id = ?", (mission_id,)).fetchone()
        return MissionRecord.model_validate_json(row["payload"]) if row else None

    def put(self, mission: MissionRecord) -> MissionRecord:
        mission.updated_at = utc_now()
        payload = mission.model_dump_json()
        with self._lock, self._connection() as connection:
            connection.execute(
                "INSERT INTO missions(id, payload, updated_at) VALUES(?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at",
                (mission.id, payload, mission.updated_at.isoformat()),
            )
        return mission

    def claim_idempotency(self, operation: str, key: str, mission_id: str) -> str:
        with self._lock, self._connection() as connection:
            row = connection.execute(
                "SELECT mission_id FROM idempotency WHERE operation=? AND key=?", (operation, key)
            ).fetchone()
            if row:
                return str(row["mission_id"])
            connection.execute(
                "INSERT INTO idempotency(operation, key, mission_id) VALUES(?, ?, ?)",
                (operation, key, mission_id),
            )
        return mission_id


class FirestoreMissionStore:
    """Production adapter placeholder with explicit dependency and fail-closed initialization."""

    def __init__(self, project: str):
        try:
            from google.cloud import firestore
        except ImportError as exc:  # pragma: no cover - optional cloud dependency
            raise RuntimeError("install the google dependency group for Firestore mode") from exc
        self.client = firestore.Client(project=project)
        self.collection = self.client.collection("constellation_missions")

    def get(self, mission_id: str) -> MissionRecord | None:
        snapshot = self.collection.document(mission_id).get()
        return MissionRecord.model_validate(snapshot.to_dict()) if snapshot.exists else None

    def put(self, mission: MissionRecord) -> MissionRecord:
        mission.updated_at = utc_now()
        self.collection.document(mission.id).set(mission.model_dump(mode="json"))
        return mission

    def claim_idempotency(self, operation: str, key: str, mission_id: str) -> str:
        from google.cloud import firestore

        document = self.client.collection("constellation_idempotency").document(f"{operation}:{key}")
        transaction = self.client.transaction()

        @firestore.transactional
        def _claim(transaction, reference):
            snapshot = reference.get(transaction=transaction)
            if snapshot.exists:
                return snapshot.to_dict()["mission_id"]
            transaction.set(reference, {"mission_id": mission_id})
            return mission_id

        return _claim(transaction, document)
