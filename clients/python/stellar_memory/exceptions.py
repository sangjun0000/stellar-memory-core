"""Exceptions for the Stellar Memory client SDK."""

from __future__ import annotations


class StellarMemoryError(Exception):
    """Base exception for all Stellar Memory errors."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class ConnectionError(StellarMemoryError):
    """Raised when the client cannot connect to the Stellar Memory API."""


class NotFoundError(StellarMemoryError):
    """Raised when the requested resource does not exist (HTTP 404)."""

    def __init__(self, message: str = "Resource not found") -> None:
        super().__init__(message, status_code=404)


class ValidationError(StellarMemoryError):
    """Raised when the API rejects the request due to invalid input (HTTP 400/422)."""

    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=400)


class ConflictError(StellarMemoryError):
    """Raised when an operation conflicts with existing state (HTTP 409)."""

    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=409)


class ServerError(StellarMemoryError):
    """Raised when the server returns a 5xx error."""

    def __init__(self, message: str, status_code: int = 500) -> None:
        super().__init__(message, status_code=status_code)
