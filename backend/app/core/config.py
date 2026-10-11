from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    environment: str = "development"
    app_name: str = "Moodify"
    api_version: str = "0.1.0"
    api_prefix: str = "/api/v1"
    cors_origins: list[str] = ["http://localhost:5173"]
    max_image_bytes: int = 5 * 1024 * 1024
    max_image_pixels: int = Field(default=20_000_000, ge=1)
    model_dir: Path = Path(__file__).resolve().parents[2] / "models" / "vit-face-expression"
    model_min_confidence: float = Field(default=0.4, ge=0, le=1)
    model_num_threads: int = Field(default=2, ge=1, le=32)
    database_url: str = "postgresql+psycopg://moodify:moodify@localhost:5432/moodify"
    jwt_secret: str = Field(default="development-only-change-this-secret-before-deploying", min_length=32)
    access_token_minutes: int = Field(default=15, ge=1, le=1440)
    refresh_token_days: int = Field(default=30, ge=1, le=365)
    frontend_url: str = "http://localhost:5173"
    cookie_secure: bool = False
    smtp_host: str = "localhost"
    smtp_port: int = Field(default=1025, ge=1, le=65535)
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str = "noreply@moodify.local"
    smtp_starttls: bool = False
    initial_superuser_email: str | None = None

    model_config = SettingsConfigDict(env_file=".env", env_prefix="MOODIFY_")


settings = Settings()
