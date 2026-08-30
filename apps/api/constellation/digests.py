import hashlib
import json
from typing import Any


def canonical_json(value: Any) -> str:
    """Serialize a value with a stable, language-independent JSON representation."""
    def normalize(item: Any) -> Any:
        if hasattr(item, "model_dump"):
            return normalize(item.model_dump(mode="json", exclude_none=True))
        if isinstance(item, dict):
            return {str(key): normalize(candidate) for key, candidate in item.items()}
        if isinstance(item, (list, tuple)):
            return [normalize(candidate) for candidate in item]
        return item

    return json.dumps(normalize(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_digest(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()
