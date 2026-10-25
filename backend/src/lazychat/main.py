from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from .config.settings import get_settings
from .core.logging import configure_logging, get_logger
from .core.middleware import add_cors, request_id_middleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    logger = get_logger("lazychat")
    logger.info("starting backend", env=get_settings().app_env)
    yield
    logger.info("shutting down backend")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
    )
    add_cors(app)
    app.middleware("http")(request_id_middleware)

    # Routers
    from .api.v1 import router as v1_router

    app.include_router(v1_router, prefix="/api/v1")

    @app.get("/healthz")
    async def healthz() -> dict:
        return {"status": "ok", "env": settings.app_env}

    return app


app = create_app()