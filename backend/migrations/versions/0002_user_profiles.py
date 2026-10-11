"""Add display names and unique usernames to users."""
from alembic import op
import re
import sqlalchemy as sa

revision = "0002_user_profiles"
down_revision = "0001_personal_songs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("display_name", sa.String(length=80), nullable=True))
    op.add_column("users", sa.Column("username", sa.String(length=30), nullable=True))

    connection = op.get_bind()
    users = connection.execute(sa.text("SELECT id, email FROM users ORDER BY id")).mappings()
    seen: set[str] = set()
    for user in users:
        local_part = user["email"].split("@", 1)[0]
        display_name = re.sub(r"[^a-zA-Z0-9 ]+", " ", local_part).strip()[:80] or "Moodify user"
        base_username = re.sub(r"[^a-zA-Z0-9_]+", "_", local_part).strip("_").lower()
        if len(base_username) < 3:
            base_username = f"user_{user['id'].replace('-', '')[:8]}"
        candidate = base_username[:30]
        suffix = 1
        while candidate in seen:
            tail = f"_{suffix}"
            candidate = f"{base_username[:30 - len(tail)]}{tail}"
            suffix += 1
        seen.add(candidate)
        connection.execute(
            sa.text("UPDATE users SET display_name = :display_name, username = :username WHERE id = :id"),
            {"display_name": display_name, "username": candidate, "id": user["id"]},
        )

    op.alter_column("users", "display_name", existing_type=sa.String(length=80), nullable=False)
    op.alter_column("users", "username", existing_type=sa.String(length=30), nullable=False)
    op.create_index("ix_users_username_lower", "users", [sa.text("lower(username)")], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_username_lower", table_name="users")
    op.drop_column("users", "username")
    op.drop_column("users", "display_name")