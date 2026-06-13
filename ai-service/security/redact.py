"""Sensitive value redaction for logs and user-facing errors."""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import parse_qsl, quote_plus, urlsplit, urlunsplit

REDACTION = "[REDACTED]"

_KEY_NAMES = {"key", "token", "api_key", "api-key", "password", "secret"}

_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9._~+/=-]+", re.I), rf"\1{REDACTION}"),
    (re.compile(r"\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}", re.I), rf"\1{REDACTION}"),
    (re.compile(r"\b(x-provider-key\s*[:=]\s*)[^\s,;]+", re.I), rf"\1{REDACTION}"),
    (re.compile(r"\b(api[_-]?key|key|token|password|secret)(\s*[:=]\s*)[^\s,;}}&\"']+", re.I), rf"\1\2{REDACTION}"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"), REDACTION),
]


def redact_url(value: str) -> str:
    """Redact sensitive query params in a URL-like string."""
    try:
        parsed = urlsplit(value)
    except ValueError:
        return value
    if not parsed.query:
        return value
    pairs = []
    changed = False
    for key, raw in parse_qsl(parsed.query, keep_blank_values=True):
        if key.lower() in _KEY_NAMES:
            pairs.append((key, REDACTION))
            changed = True
        else:
            pairs.append((key, raw))
    if not changed:
        return value
    query = "&".join(
        f"{quote_plus(key)}={REDACTION if raw == REDACTION else quote_plus(raw)}"
        for key, raw in pairs
    )
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, query, parsed.fragment))


def redact_sensitive(value: Any) -> str:
    """Return a string safe for logs, SSE errors, and HTTP details."""
    if isinstance(value, BaseException):
        text = str(value)
    elif isinstance(value, str):
        text = value
    else:
        try:
            text = json.dumps(value, ensure_ascii=False)
        except TypeError:
            text = str(value)

    for url_match in re.findall(r"https?://[^\s\"'<>]+", text):
        text = text.replace(url_match, redact_url(url_match))

    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def provider_error_message(exc: BaseException) -> str:
    name = exc.__class__.__name__
    if name == "HTTPStatusError":
        return "Upstream HTTP error"
    if name in {"ConnectError", "ConnectTimeout", "ReadTimeout", "RequestError"}:
        return "Upstream connection error"
    return "Provider stream error"
