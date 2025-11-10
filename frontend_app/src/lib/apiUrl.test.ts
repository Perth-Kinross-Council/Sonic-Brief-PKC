import { describe, it, expect, vi } from 'vitest'

describe('apiUrl', () => {
  it('joins base with trailing slash and path with leading slash', async () => {
    vi.resetModules()
    vi.doMock('@/env', () => ({ env: { VITE_API_URL: 'https://api.example.com/' } }))
    const { apiUrl } = await import('./apiUrl')
    expect(apiUrl('/auth/me')).toBe('https://api.example.com/auth/me')
  })

  it('joins base without trailing slash and path with leading slash', async () => {
    vi.resetModules()
    vi.doMock('@/env', () => ({ env: { VITE_API_URL: 'https://api.example.com' } }))
    const { apiUrl } = await import('./apiUrl')
    expect(apiUrl('/auth/me')).toBe('https://api.example.com/auth/me')
  })
})
