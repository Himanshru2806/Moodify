from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Moodify"
    api_version: str = "0.1.0"
    api_prefix: str = "/api/v1"
    cors_origins: list[str] = ["http://localhost:5173"]
    max_image_bytes: int = 5 * 1024 * 1024

    model_config = SettingsConfigDict(env_file=".env", env_prefix="MOODIFY_")


settings = Settings()
