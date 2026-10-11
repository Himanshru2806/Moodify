from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.models import AdminAuditLog, User


def promote_configured_superuser(database: Session) -> None:
    email = settings.initial_superuser_email
    if not email:
        return

    user = database.scalar(select(User).where(User.email == email.strip().lower()))
    if user is None or not user.is_verified:
        raise RuntimeError(
            "MOODIFY_INITIAL_SUPERUSER_EMAIL must refer to an existing, verified Moodify account."
        )
    if user.role != "super_user":
        user.role = "super_user"
        database.add(AdminAuditLog(
            actor_user_id=None,
            target_user_id=user.id,
            action="bootstrap_superuser",
            details="Initial super-user promotion from deployment configuration.",
        ))
        database.commit()


def bootstrap_configured_superuser() -> None:
    if not settings.initial_superuser_email:
        return
    with SessionLocal() as database:
        promote_configured_superuser(database)