from security.redact import provider_error_message, redact_sensitive, redact_url


def test_redact_url_query_key():
    out = redact_url("https://example.test/v1?alt=sse&key=fake-secret-token")

    assert "fake-secret-token" not in out
    assert "[REDACTED]" in out


def test_redact_sensitive_headers_and_fields():
    out = redact_sensitive(
        "Authorization: Bearer fake-secret-token x-provider-key=another-secret api_key=third-secret"
    )

    assert "fake-secret-token" not in out
    assert "another-secret" not in out
    assert "third-secret" not in out


def test_provider_error_message_is_stable():
    assert provider_error_message(RuntimeError("fake-secret-token")) == "Provider stream error"
