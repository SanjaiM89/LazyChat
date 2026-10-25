from __future__ import annotations

from fastapi import HTTPException, status


class LazyChatError(Exception):
    """Base error for the LazyChat backend."""


class NotFoundError(LazyChatError):
    pass


class ValidationError(LazyChatError):
    pass


class UnauthorizedError(LazyChatError):
    pass


def http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, NotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, UnauthorizedError):
        return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc))
    if isinstance(exc, ValidationError):
        return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))