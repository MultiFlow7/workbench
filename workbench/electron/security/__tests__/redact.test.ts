import { describe, expect, it } from 'vitest'
import { redactSensitive } from '../redact'

describe('redactSensitive', () => {
  it('redacts bearer tokens and URL query keys', () => {
    const out = redactSensitive('POST https://api.test/v1?key=fake-secret-token Authorization: Bearer fake-secret-token')

    expect(out).not.toContain('fake-secret-token')
    expect(out).toContain('[REDACTED]')
  })

  it('redacts key-like fields in objects', () => {
    const out = redactSensitive({ api_key: 'fake-secret-token', nested: { token: 'another-secret-token' } })

    expect(out).not.toContain('fake-secret-token')
    expect(out).not.toContain('another-secret-token')
  })
})
