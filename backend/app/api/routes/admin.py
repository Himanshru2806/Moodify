from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models import AdminAuditLog, AuthToken, CatalogueTrack, PersonalSong, ProductSetting, RefreshSession, User
from app.schemas.admin import (
    AdminAuditResponse,
    AdminMetricsResponse,
    AdminStatusResponse,
    AdminUserResponse,
    MessageResponse,
    RecommendationWeights,
    RoleUpdate,
    SuspensionUpdate,
)
from app.schemas.tracks import Track


router = APIRouter(prefix="/admin", tags=["admin"])


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role not in {"admin", "super_user"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access is required.")
    return user


def require_super_user(user: User = Depends(get_current_user)) -> User:
    if user.role != "super_user":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super-user access is required.")
    return user


def _record_action(database: Session, actor: User, target_id: str | None, action: str, details: str = "") -> None:
    database.add(AdminAuditLog(
        actor_user_id=actor.id,
        target_user_id=target_id,
        action=action,
        details=details[:500],
    ))


def _target_for_moderation(database: Session, target_id: str, actor: User) -> User:
    target = database.get(User, target_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    if target.id == actor.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot apply this action to your own account.")
    if actor.role == "admin" and target.role != "user":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admins can manage ordinary user accounts only.")
    if target.role == "super_user":
        owners = database.scalar(select(func.count()).select_from(User).where(User.role == "super_user")) or 0
        if owners <= 1:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The last super user cannot be removed or suspended.")
    return target


def _user_response(user: User) -> AdminUserResponse:
    return AdminUserResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        username=user.username,
        role=user.role,  # type: ignore[arg-type]
        is_verified=user.is_verified,
        is_suspended=user.is_suspended,
        created_at=user.created_at,
    )


@router.get("/users", response_model=list[AdminUserResponse])
def list_users(
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _: User = Depends(require_admin),
    database: Session = Depends(get_db),
) -> list[AdminUserResponse]:
    query = select(User)
    if q and q.strip():
        needle = f"%{q.strip()}%"
        query = query.where(or_(User.email.ilike(needle), User.username.ilike(needle), User.display_name.ilike(needle)))
    users = database.scalars(query.order_by(User.created_at.desc()).offset(offset).limit(limit)).all()
    return [_user_response(user) for user in users]


@router.get("/metrics", response_model=AdminMetricsResponse)
def get_metrics(
    _: User = Depends(require_admin),
    database: Session = Depends(get_db),
) -> AdminMetricsResponse:
    return AdminMetricsResponse(
        users_total=database.scalar(select(func.count()).select_from(User)) or 0,
        users_verified=database.scalar(select(func.count()).select_from(User).where(User.is_verified.is_(True))) or 0,
        users_suspended=database.scalar(select(func.count()).select_from(User).where(User.is_suspended.is_(True))) or 0,
        songs_total=database.scalar(select(func.count()).select_from(PersonalSong)) or 0,
    )


@router.put("/users/{target_id}/suspension", response_model=AdminUserResponse)
def update_suspension(
    target_id: str,
    payload: SuspensionUpdate,
    actor: User = Depends(require_admin),
    database: Session = Depends(get_db),
) -> AdminUserResponse:
    target = _target_for_moderation(database, target_id, actor)
    target.is_suspended = payload.suspended
    if payload.suspended:
        database.query(RefreshSession).filter(RefreshSession.user_id == target.id).delete(synchronize_session=False)
    _record_action(database, actor, target.id, "suspend_user" if payload.suspended else "restore_user")
    database.commit()
    database.refresh(target)
    return _user_response(target)


@router.delete("/users/{target_id}", response_model=MessageResponse)
def delete_user(
    target_id: str,
    actor: User = Depends(require_admin),
    database: Session = Depends(get_db),
) -> MessageResponse:
    target = _target_for_moderation(database, target_id, actor)
    _record_action(database, actor, target.id, "delete_user", "Account and associated playlist data deleted.")
    database.query(PersonalSong).filter(PersonalSong.user_id == target.id).delete(synchronize_session=False)
    database.query(AuthToken).filter(AuthToken.user_id == target.id).delete(synchronize_session=False)
    database.query(RefreshSession).filter(RefreshSession.user_id == target.id).delete(synchronize_session=False)
    database.delete(target)
    database.commit()
    return MessageResponse(message="User account and associated playlist data deleted.")


@router.put("/users/{target_id}/role", response_model=AdminUserResponse)
def update_role(
    target_id: str,
    payload: RoleUpdate,
    actor: User = Depends(require_super_user),
    database: Session = Depends(get_db),
) -> AdminUserResponse:
    target = database.get(User, target_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    if target.id == actor.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot change your own role.")
    if target.role == "super_user" and payload.role != "super_user":
        owners = database.scalar(select(func.count()).select_from(User).where(User.role == "super_user")) or 0
        if owners <= 1:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The last super user cannot be demoted.")
    old_role = target.role
    target.role = payload.role
    database.query(RefreshSession).filter(RefreshSession.user_id == target.id).delete(synchronize_session=False)
    _record_action(database, actor, target.id, "change_role", f"{old_role} -> {payload.role}")
    database.commit()
    database.refresh(target)
    return _user_response(target)


@router.get("/audit", response_model=list[AdminAuditResponse])
def list_audit_log(
    limit: int = Query(default=100, ge=1, le=200),
    _: User = Depends(require_super_user),
    database: Session = Depends(get_db),
) -> list[AdminAuditResponse]:
    records = database.scalars(select(AdminAuditLog).order_by(AdminAuditLog.created_at.desc()).limit(limit)).all()
    return [AdminAuditResponse.model_validate(record, from_attributes=True) for record in records]


@router.get("/catalogue", response_model=list[Track])
def list_catalogue(
    _: User = Depends(require_super_user),
    database: Session = Depends(get_db),
) -> list[Track]:
    records = database.scalars(select(CatalogueTrack).order_by(CatalogueTrack.id)).all()
    return [Track.model_validate(record, from_attributes=True) for record in records]


@router.post("/catalogue", response_model=Track, status_code=status.HTTP_201_CREATED)
def create_catalogue_track(
    track: Track,
    actor: User = Depends(require_super_user),
    database: Session = Depends(get_db),
) -> Track:
    if database.get(CatalogueTrack, track.id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A catalogue track with that ID already exists.")
    record = CatalogueTrack(**track.model_dump())
    database.add(record)
    _record_action(database, actor, None, "create_catalogue_track", track.id)
    database.commit()
    return track


@router.put("/catalogue/{track_id}", response_model=Track)
def update_catalogue_track(
    track_id: str,
    track: Track,
    actor: User = Depends(require_super_user),
    database: Session = Depends(get_db),
) -> Track:
    if track.id != track_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Track ID in the URL and body must match.")
    record = database.get(CatalogueTrack, track_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalogue track not found.")
    for key, value in track.model_dump().items():
        setattr(record, key, value)
    _record_action(database, actor, None, "update_catalogue_track", track_id)
    database.commit()
    return track


@router.delete("/catalogue/{track_id}", response_model=MessageResponse)
def delete_catalogue_track(
    track_id: str,
    actor: User = Depends(require_super_user),
    database: Session = Depends(get_db),
) -> MessageResponse:
    record = database.get(CatalogueTrack, track_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalogue track not found.")
    remaining = database.scalar(select(func.count()).select_from(CatalogueTrack)) or 0
    if remaining <= 1:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The catalogue must contain at least one track.")
    database.delete(record)
    _record_action(database, actor, None, "delete_catalogue_track", track_id)
    database.commit()
    return MessageResponse(message="Catalogue track deleted.")


@router.get("/settings/recommendations", response_model=RecommendationWeights)
def get_recommendation_settings(
    _: User = Depends(require_super_user),
    database: Session = Depends(get_db),
) -> RecommendationWeights:
    record = database.get(ProductSetting, "recommendation_weights")
    return RecommendationWeights(**record.value) if record else RecommendationWeights()


@router.put("/settings/recommendations", response_model=RecommendationWeights)
def update_recommendation_settings(
    weights: RecommendationWeights,
    actor: User = Depends(require_super_user),
    database: Session = Depends(get_db),
) -> RecommendationWeights:
    record = database.get(ProductSetting, "recommendation_weights")
    if record is None:
        record = ProductSetting(key="recommendation_weights", value=weights.model_dump())
        database.add(record)
    else:
        record.value = weights.model_dump()
    _record_action(database, actor, None, "update_recommendation_weights")
    database.commit()
    return weights


@router.get("/status", response_model=AdminStatusResponse)
def get_operational_status(
    _: User = Depends(require_admin),
    database: Session = Depends(get_db),
) -> AdminStatusResponse:
    try:
        database.execute(select(1))
        database_state = "ok"
    except Exception:
        database.rollback()
        database_state = "unavailable"
    return AdminStatusResponse(
        status="ok" if database_state == "ok" else "degraded",
        environment=settings.environment,
        api_version=settings.api_version,
        database=database_state,
    )