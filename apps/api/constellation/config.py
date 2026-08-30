from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Secrets are never serialized into API responses."""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")

    mode: Literal["local", "cloud"] = Field("local", alias="CONSTELLATION_MODE")
    role: Literal["web", "worker"] = Field("web", alias="CONSTELLATION_ROLE")
    database_path: Path = Field(Path("constellation.sqlite3"), alias="CONSTELLATION_DATABASE_PATH")
    public_base_url: str = Field("http://localhost:8080", alias="CONSTELLATION_PUBLIC_BASE_URL")
    internal_token: str | None = Field(None, alias="CONSTELLATION_INTERNAL_TOKEN")
    task_service_account: str | None = Field(None, alias="CONSTELLATION_TASK_SERVICE_ACCOUNT")
    task_location: str = Field("us-central1", alias="CONSTELLATION_TASK_LOCATION")
    worker_base_url: str | None = Field(None, alias="CONSTELLATION_WORKER_BASE_URL")
    google_cloud_project: str | None = Field(None, alias="GOOGLE_CLOUD_PROJECT")
    google_cloud_location: str = Field("global", alias="GOOGLE_CLOUD_LOCATION")
    gemini_model: str = Field("gemini-3.5-flash", alias="GEMINI_MODEL")
    hexstellar_api_url: str | None = Field("https://api.hexstellar.com", alias="HEXSTELLAR_API_URL")
    hexstellar_api_key: str | None = Field(None, alias="HEXSTELLAR_API_KEY")
    cortex_model: str = Field("cortex-1.0", alias="CORTEX_MODEL")
    cortex_cover_effort: Literal["flash", "medium", "high"] = Field("medium", alias="CORTEX_COVER_EFFORT")
    cortex_qap_effort: Literal["flash", "medium", "high"] = Field("flash", alias="CORTEX_QAP_EFFORT")
    artifact_dir: Path = Field(Path("artifacts"), alias="CONSTELLATION_ARTIFACT_DIR")
    artifact_bucket: str | None = Field(None, alias="CONSTELLATION_ARTIFACT_BUCKET")
    cors_origins: str = Field(
        "http://localhost:5173,http://localhost:8080", alias="CONSTELLATION_CORS_ORIGINS"
    )
    max_request_bytes: int = Field(65_536, alias="CONSTELLATION_MAX_REQUEST_BYTES", ge=1_024, le=1_048_576)
    public_run_limit: int = Field(100, alias="CONSTELLATION_PUBLIC_RUN_LIMIT", ge=1, le=10_000)

    @property
    def live_gemini_available(self) -> bool:
        return bool(self.google_cloud_project)

    @property
    def live_cortex_available(self) -> bool:
        return bool(self.hexstellar_api_url and self.hexstellar_api_key)

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
