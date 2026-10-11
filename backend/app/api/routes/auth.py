from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models import AuthToken, RefreshSession, User
from app.schemas.auth import (
    AccessResponse,
    Credentials,
    EmailRequest,
    MessageResponse,
    PasswordResetRequest,
    ProfileResponse,
    ProfileUpdate,
    RegistrationRequest,
    TokenRequest,
)
from app.services.email_service import send_action_email
from app.services.security import (
    create_access_token,
    decode_access_token,
    generate_opaque_token,
    hash_password,
    hash_token,
    verify_password,
)


router = APIRouter(prefix="/auth", tags=["auth"])
bearer = HTTPBearer(auto_error=False)
REFRESH_COOKIE = "moodify_refresh"


def _is_expired(expires_at: datetime) -> bool:
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at <= datetime.now(timezone.utc)


def _new_action_token(database: Session, user: User, purpose: str, lifetime: timedelta) -> str:
    raw_token = generate_opaque_token()
    database.add(AuthToken(
        user_id=user.id,
        token_hash=hash_token(raw_token),
        purpose=purpose,
        expires_at=datetime.now(timezone.utc) + lifetime,
    ))
    return raw_token


def _send_action(user: User, purpose: str, token: str) -> None:
    if purpose == "verify":
        subject = "Verify your Moodify account"
        action = "verify"
    else:
        subject = "Reset your Moodify password"
        action = "reset-password"
    url = f"{settings.frontend_url}/#{action}?token={token}"
    send_action_email(user.email, subject, url)


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        REFRESH_COOKIE,
        token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.refresh_token_days * 24 * 60 * 60,
        path=f"{settings.api_prefix}/auth",
    )


def _issue_session(database: Session, user: User, response: Response) -> AccessResponse:
    refresh_token = generate_opaque_token()
    database.add(RefreshSession(
        user_id=user.id,
        token_hash=hash_token(refresh_token),
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_days),
    ))
    _set_refresh_cookie(response, refresh_token)
    return AccessResponse(
        access_token=create_access_token(user.id),
        email=user.email,
        display_name=user.display_name,
        username=user.username,
        role=user.role,
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    database: Session = Depends(get_db),
) -> User:
    user_id = decode_access_token(credentials.credentials) if credentials else None
    user = database.get(User, user_id) if user_id else None
    if user is None or not user.is_verified:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in to continue.")
    if user.is_suspended:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account has been suspended.")
    return user


@router.post("/register", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegistrationRequest, database: Session = Depends(get_db)) -> MessageResponse:
    email = str(payload.email).lower()
    if database.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists.")
    if database.scalar(select(User).where(func.lower(User.username) == payload.username)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That username is already taken.")

    user = User(
        email=email,
        display_name=payload.display_name,
        username=payload.username,
        password_hash=hash_password(payload.password),
        is_verified=False,
    )
    database.add(user)
    database.flush()
    raw_token = _new_action_token(database, user, "verify", timedelta(hours=24))
    try:
        _send_action(user, "verify", raw_token)
        database.commit()
    except IntegrityError as error:
        database.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That email or username is already in use.") from error
    except Exception as error:
        database.rollback()
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Verification email could not be sent.") from error
    return MessageResponse(message="Check your email for a verification link.")


@router.get("/me", response_model=ProfileResponse)
def get_profile(user: User = Depends(get_current_user)) -> ProfileResponse:
    return ProfileResponse(email=user.email, display_name=user.display_name, username=user.username)


@router.put("/me", response_model=ProfileResponse)
def update_profile(
    payload: ProfileUpdate,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_db),
) -> ProfileResponse:
    existing = database.scalar(
        select(User).where(func.lower(User.username) == payload.username, User.id != user.id)
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That username is already taken.")
    user.display_name = payload.display_name
    user.username = payload.username
    try:
        database.commit()
    except IntegrityError as error:
        database.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That username is already taken.") from error
    return ProfileResponse(email=user.email, display_name=user.display_name, username=user.username)


@router.post("/verify", response_model=MessageResponse)
def verify_email(payload: TokenRequest, database: Session = Depends(get_db)) -> MessageResponse:
    record = database.scalar(select(AuthToken).where(
        AuthToken.token_hash == hash_token(payload.token), AuthToken.purpose == "verify"
    ))
    if record is None or _is_expired(record.expires_at):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This verification link is invalid or expired.")
    user = database.get(User, record.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This verification link is invalid or expired.")
    user.is_verified = True
    database.delete(record)
    database.commit()
    return MessageResponse(message="Email verified. You can now sign in.")


@router.post("/login", response_model=AccessResponse)
def login(payload: Credentials, response: Response, database: Session = Depends(get_db)) -> AccessResponse:
    email = str(payload.email).lower()
    user = database.scalar(select(User).where(User.email == email))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email or password is incorrect.")
    if user.is_suspended:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account has been suspended.")
    if not user.is_verified:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Verify your email before signing in.")
    result = _issue_session(database, user, response)
    database.commit()
    return result


@router.post("/refresh", response_model=AccessResponse)
def refresh(request: Request, response: Response, database: Session = Depends(get_db)) -> AccessResponse:
    raw_token = request.cookies.get(REFRESH_COOKIE)
    record = database.scalar(select(RefreshSession).where(RefreshSession.token_hash == hash_token(raw_token or "")))
    if record is None or _is_expired(record.expires_at):
        response.delete_cookie(REFRESH_COOKIE, path=f"{settings.api_prefix}/auth", samesite="lax")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Your session has expired. Sign in again.")
    user = database.get(User, record.user_id)
    if user is None or not user.is_verified or user.is_suspended:
        database.delete(record)
        database.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Your session is no longer valid.")
    database.delete(record)
    result = _issue_session(database, user, response)
    database.commit()
    return result


@router.post("/logout", response_model=MessageResponse)
def logout(request: Request, response: Response, database: Session = Depends(get_db)) -> MessageResponse:
    raw_token = request.cookies.get(REFRESH_COOKIE)
    if raw_token:
        record = database.scalar(select(RefreshSession).where(RefreshSession.token_hash == hash_token(raw_token)))
        if record:
            database.delete(record)
            database.commit()
    response.delete_cookie(REFRESH_COOKIE, path=f"{settings.api_prefix}/auth", samesite="lax")
    return MessageResponse(message="Signed out.")


@router.post("/forgot-password", response_model=MessageResponse)
def forgot_password(payload: EmailRequest, database: Session = Depends(get_db)) -> MessageResponse:
    email = str(payload.email).lower()
    user = database.scalar(select(User).where(User.email == email, User.is_verified.is_(True)))
    if user:
        raw_token = _new_action_token(database, user, "reset", timedelta(minutes=30))
        try:
            _send_action(user, "reset", raw_token)
            database.commit()
        except Exception:
            database.rollback()
    return MessageResponse(message="If an account exists for that email, a password reset link has been sent.")


@router.post("/reset-password", response_model=MessageResponse)
def reset_password(payload: PasswordResetRequest, database: Session = Depends(get_db)) -> MessageResponse:
    record = database.scalar(select(AuthToken).where(
        AuthToken.token_hash == hash_token(payload.token), AuthToken.purpose == "reset"
    ))
    if record is None or _is_expired(record.expires_at):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This reset link is invalid or expired.")
    user = database.get(User, record.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This reset link is invalid or expired.")
    user.password_hash = hash_password(payload.password)
    database.delete(record)
    database.query(RefreshSession).filter(RefreshSession.user_id == user.id).delete(synchronize_session=False)
    database.commit()
    return MessageResponse(message="Password updated. Sign in with your new password.")
