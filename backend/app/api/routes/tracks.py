from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.tracks import Track
from app.services.catalogue import load_tracks


router = APIRouter(prefix="/tracks", tags=["tracks"])


@router.get("", response_model=list[Track])
def list_tracks(database: Session = Depends(get_db)) -> list[Track]:
    return load_tracks(database)
