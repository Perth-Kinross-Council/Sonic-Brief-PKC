import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('apiConstants via apiUrl', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('builds URLs correctly when VITE_API_URL has trailing slash', async () => {
    vi.doMock('@/env', () => ({ env: { VITE_API_URL: 'https://api.example.com/' } }))
    const constants = await import('./apiConstants')
    expect(constants.LOGIN_API).toBe('https://api.example.com/auth/login')
    expect(constants.HEALTH_API).toBe('https://api.example.com/health')
    expect(constants.JOBS_API).toBe('https://api.example.com/upload/jobs')
  })

  it('builds URLs correctly when VITE_API_URL has no trailing slash', async () => {
    vi.doMock('@/env', () => ({ env: { VITE_API_URL: 'https://api.example.com' } }))
    const constants = await import('./apiConstants')
    expect(constants.LOGIN_API).toBe('https://api.example.com/auth/login')
    expect(constants.HEALTH_API).toBe('https://api.example.com/health')
    expect(constants.UPLOAD_API).toBe('https://api.example.com/upload/upload')
  })
})
