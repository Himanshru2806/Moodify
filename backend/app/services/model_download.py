from huggingface_hub import snapshot_download

from app.core.config import settings
from app.services.expression_model import MODEL_REPOSITORY, MODEL_REVISION


def main() -> None:
    settings.model_dir.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=MODEL_REPOSITORY,
        revision=MODEL_REVISION,
        local_dir=str(settings.model_dir),
        allow_patterns=["config.json", "preprocessor_config.json", "model.safetensors"],
    )
    print(f"Moodify expression model downloaded to {settings.model_dir}")


if __name__ == "__main__":
    main()