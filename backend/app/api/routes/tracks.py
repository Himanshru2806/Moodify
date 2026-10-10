from fastapi import APIRouter

from app.schemas.tracks import Track
from app.services.catalogue import TRACKS


router = APIRouter(prefix="/tracks", tags=["tracks"])


@router.get("", response_model=list[Track])
def list_tracks() -> list[Track]:
    return TRACKS
