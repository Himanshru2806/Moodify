from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Moodify"
    api_version: str = "0.1.0"
    api_prefix: str = "/api/v1"
    cors_origins: list[str] = ["http://localhost:5173"]
    max_image_bytes: int = 5 * 1024 * 1024
    max_image_pixels: int = Field(default=20_000_000, ge=1)
    model_dir: Path = Path(__file__).resolve().parents[2] / "models" / "vit-face-expression"
    model_min_confidence: float = Field(default=0.4, ge=0, le=1)
    model_num_threads: int = Field(default=2, ge=1, le=32)

    model_config = SettingsConfigDict(env_file=".env", env_prefix="MOODIFY_")


settings = Settings()
