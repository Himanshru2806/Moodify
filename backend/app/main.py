from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import admin, auth, expressions, health, personal_playlists, recommendations, tracks, youtube
from app.core.config import settings
from app.services.admin_bootstrap import bootstrap_configured_superuser


def create_app() -> FastAPI:
    if settings.environment.lower() == "production":
        if settings.jwt_secret == "development-only-change-this-secret-before-deploying":
            raise RuntimeError("Set MOODIFY_JWT_SECRET to a unique secret before running in production.")
        if not settings.cookie_secure:
            raise RuntimeError("Set MOODIFY_COOKIE_SECURE=true before running in production.")

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        bootstrap_configured_superuser()
        yield

    app = FastAPI(
        title=settings.app_name,
        version=settings.api_version,
        description="Moodify backend API",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router, prefix=settings.api_prefix)
    app.include_router(expressions.router, prefix=settings.api_prefix)
    app.include_router(recommendations.router, prefix=settings.api_prefix)
    app.include_router(tracks.router, prefix=settings.api_prefix)
    app.include_router(auth.router, prefix=settings.api_prefix)
    app.include_router(personal_playlists.router, prefix=settings.api_prefix)
    app.include_router(youtube.router, prefix=settings.api_prefix)
    app.include_router(admin.router, prefix=settings.api_prefix)

    return app


app = create_app()
