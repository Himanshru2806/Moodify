"""Persist catalogue tracks and allowlisted product settings."""
from alembic import op
import sqlalchemy as sa


revision = "0004_catalogue_settings"
down_revision = "0003_admin_roles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tracks = sa.Table(
        "catalogue_tracks",
        sa.MetaData(),
        sa.Column("id", sa.String(length=80), primary_key=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("artist", sa.String(length=200), nullable=False),
        sa.Column("language", sa.String(length=80), nullable=False),
        sa.Column("genre", sa.String(length=80), nullable=False),
        sa.Column("energy", sa.Float(), nullable=False),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("expression_affinities", sa.JSON(), nullable=False),
        sa.Column("source_url", sa.String(length=1000), nullable=True),
    )
    tracks.create(op.get_bind())
    settings = sa.Table(
        "product_settings",
        sa.MetaData(),
        sa.Column("key", sa.String(length=80), primary_key=True),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    settings.create(op.get_bind())

    op.bulk_insert(tracks, [
        {"id": "trk_001", "title": "Morning Light", "artist": "Moodify Demo", "language": "English", "genre": "indie", "energy": 0.62, "tags": ["uplifting", "warm", "focus"], "expression_affinities": {"happy": 1.0, "surprise": 0.5}, "source_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"},
        {"id": "trk_002", "title": "Quiet Rain", "artist": "Moodify Demo", "language": "English", "genre": "ambient", "energy": 0.22, "tags": ["calm", "relax", "comfort"], "expression_affinities": {"sad": 1.0, "neutral": 0.5}, "source_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3"},
        {"id": "trk_003", "title": "City Pulse", "artist": "Moodify Demo", "language": "Hindi", "genre": "pop", "energy": 0.84, "tags": ["energizing", "upbeat", "dance"], "expression_affinities": {"happy": 0.5, "surprise": 1.0}, "source_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3"},
        {"id": "trk_004", "title": "Soft Echoes", "artist": "Moodify Demo", "language": "Hindi", "genre": "acoustic", "energy": 0.34, "tags": ["reflective", "comfort", "calm"], "expression_affinities": {"sad": 0.75, "neutral": 0.5}, "source_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3"},
        {"id": "trk_005", "title": "Deep Work", "artist": "Moodify Demo", "language": "Instrumental", "genre": "lofi", "energy": 0.48, "tags": ["focus", "steady", "calm"], "expression_affinities": {"neutral": 1.0}, "source_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3"},
    ])


def downgrade() -> None:
    op.drop_table("product_settings")
    op.drop_table("catalogue_tracks")