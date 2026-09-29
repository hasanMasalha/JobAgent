"""Shared-secret auth for the AI service.

Every request must carry `X-Internal-Key: <INTERNAL_API_KEY>`, except
/health (deploy health check). The service used to trust its network
position alone, and port 8000 was once reachable from the internet with no
auth on any route — /ats-apply and /linkedin/save-cookie take user_id from
the body. Callers: Next.js via lib/python-service.ts (pythonFetch) and the
daily-scrape workflow, which reads the key from the server's .env.

Fails closed: if INTERNAL_API_KEY is unset, every protected route returns
401 rather than opening up.
"""
import hmac
import os

from starlette.types import ASGIApp, Receive, Scope, Send

HEADER = b"x-internal-key"
OPEN_PATHS = frozenset({"/health"})


def _configured_key() -> str:
    return os.environ.get("INTERNAL_API_KEY", "")


def is_valid_key(given: str | None) -> bool:
    key = _configured_key()
    if not key or not given:
        return False
    return hmac.compare_digest(given.encode(), key.encode())


class InternalKeyMiddleware:
    """Pure ASGI middleware (not BaseHTTPMiddleware) so long-running and
    streaming routes aren't wrapped in an extra task."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        if not _configured_key():
            print("[internal-auth] ERROR: INTERNAL_API_KEY is not set — every route except /health will return 401")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("path") in OPEN_PATHS:
            await self.app(scope, receive, send)
            return

        given = None
        for name, value in scope.get("headers", []):
            if name == HEADER:
                given = value.decode("latin-1")
                break

        if not is_valid_key(given):
            body = b'{"detail":"Unauthorized"}'
            await send({
                "type": "http.response.start",
                "status": 401,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
            })
            await send({"type": "http.response.body", "body": body})
            return

        await self.app(scope, receive, send)
