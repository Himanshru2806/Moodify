"""Add YouTube song matching, connections, and created playlists."""
from alembic import op
import sqlalchemy as sa


revision = "0005_youtube_playlists"
down_revision = "0004_catalogue_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("personal_songs", sa.Column("artist", sa.String(length=200), nullable=True))
    op.add_column("personal_songs", sa.Column("youtube_video_id", sa.String(length=32), nullable=True))
    op.add_column("personal_songs", sa.Column("youtube_video_title", sa.String(length=500), nullable=True))
    op.add_column("personal_songs", sa.Column("youtube_channel_title", sa.String(length=200), nullable=True))
    op.add_column("personal_songs", sa.Column("youtube_thumbnail_url", sa.String(length=1000), nullable=True))

    op.create_table(
        "youtube_connections",
        sa.Column("id", sa.Uuid(as_uuid=False), primary_key=True),
        sa.Column("user_id", sa.Uuid(as_uuid=False), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("google_subject", sa.String(length=255), nullable=False),
        sa.Column("google_email", sa.String(length=320), nullable=True),
        sa.Column("encrypted_refresh_token", sa.String(length=4096), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "youtube_playlists",
        sa.Column("id", sa.Uuid(as_uuid=False), primary_key=True),
        sa.Column("user_id", sa.Uuid(as_uuid=False), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mood", sa.String(length=20), nullable=False),
        sa.Column("title", sa.String(length=150), nullable=False),
        sa.Column("youtube_playlist_id", sa.String(length=64), nullable=False, unique=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="creating"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_youtube_playlists_user_created", "youtube_playlists", ["user_id", "created_at"])

    op.create_table(
        "youtube_playlist_items",
        sa.Column("id", sa.Uuid(as_uuid=False), primary_key=True),
        sa.Column("playlist_id", sa.Uuid(as_uuid=False), sa.ForeignKey("youtube_playlists.id", ondelete="CASCADE"), nullable=False),
        sa.Column("personal_song_id", sa.Uuid(as_uuid=False), sa.ForeignKey("personal_songs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("youtube_video_id", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("artist", sa.String(length=200), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.UniqueConstraint("playlist_id", "position", name="uq_youtube_playlist_items_position"),
    )


def downgrade() -> None:
    op.drop_table("youtube_playlist_items")
    op.drop_index("ix_youtube_playlists_user_created", table_name="youtube_playlists")
    op.drop_table("youtube_playlists")
    op.drop_table("youtube_connections")
    op.drop_column("personal_songs", "youtube_thumbnail_url")
    op.drop_column("personal_songs", "youtube_channel_title")
    op.drop_column("personal_songs", "youtube_video_title")
    op.drop_column("personal_songs", "youtube_video_id")
    op.drop_column("personal_songs", "artist")