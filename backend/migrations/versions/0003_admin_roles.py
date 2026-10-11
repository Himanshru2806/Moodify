"""Add user roles, suspension state, and admin audit logs."""
from alembic import op
import sqlalchemy as sa


revision = "0003_admin_roles"
down_revision = "0002_user_profiles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("role", sa.String(length=20), nullable=False, server_default="user"))
    op.add_column("users", sa.Column("is_suspended", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_check_constraint("ck_users_role", "users", "role IN ('user','admin','super_user')")
    op.create_table(
        "admin_audit_logs",
        sa.Column("id", sa.Uuid(as_uuid=False), primary_key=True),
        sa.Column("actor_user_id", sa.Uuid(as_uuid=False), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("target_user_id", sa.String(length=36), nullable=True),
        sa.Column("action", sa.String(length=40), nullable=False),
        sa.Column("details", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("admin_audit_logs")
    op.drop_constraint("ck_users_role", "users", type_="check")
    op.drop_column("users", "is_suspended")
    op.drop_column("users", "role")