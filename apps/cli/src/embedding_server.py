"""Small local HTTP server that keeps the shared embedding model resident."""

from __future__ import annotations

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .pipeline.embedder import MODEL_DIM, MODEL_NAME, MODEL_REVISION, local_embedder


class _Handler(BaseHTTPRequestHandler):
    server_version = "ClassifyreEmbedding/1"

    def _json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._json(
                HTTPStatus.OK,
                {"status": "ok", "model": MODEL_NAME, "revision": MODEL_REVISION, "dim": MODEL_DIM},
            )
            return
        self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/embed":
            self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(length))
            texts = payload.get("texts")
            if not isinstance(texts, list) or not texts or len(texts) > 256:
                raise ValueError("texts must contain 1-256 strings")
            if not all(isinstance(text, str) for text in texts):
                raise ValueError("every text must be a string")
            self._json(HTTPStatus.OK, {"vectors": local_embedder.encode(texts)})
        except ValueError as exc:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except Exception as exc:
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})

    def log_message(self, format: str, *args: Any) -> None:
        return


def serve_embedding_model(host: str, port: int) -> None:
    # Load and exercise the model before advertising a healthy socket. This
    # makes a missing/corrupt bundled model fail desktop/Kubernetes startup
    # instead of surprising the first investigator query.
    local_embedder.encode(["classifyre embedding readiness probe"])
    server = ThreadingHTTPServer((host, port), _Handler)
    server.serve_forever()
