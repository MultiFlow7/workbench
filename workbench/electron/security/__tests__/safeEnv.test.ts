import { describe, expect, it } from 'vitest'
import { buildSafeAgentEnv } from '../safeEnv'

describe('buildSafeAgentEnv', () => {
  it('keeps runtime essentials and explicit Anthropic env only', () => {
    const env = buildSafeAgentEnv(
      { ANTHROPIC_API_KEY: 'settings-key' },
      {
        PATH: '/usr/bin',
        HOME: '/home/user',
        HTTPS_PROXY: 'http://proxy.local:8080',
        GITHUB_TOKEN: 'ghp_secret',
        OPENAI_API_KEY: 'sk-secret',
        AWS_SECRET_ACCESS_KEY: 'aws-secret',
        ANTHROPIC_API_KEY: 'shell-key',
      }
    )

    expect(env.PATH).toBe('/usr/bin')
    expect(env.HOME).toBe('/home/user')
    expect(env.HTTPS_PROXY).toBe('http://proxy.local:8080')
    expect(env.ANTHROPIC_API_KEY).toBe('settings-key')
    expect(env.GITHUB_TOKEN).toBeUndefined()
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
  })
})
