import { describe, it, expect, vi } from 'vitest'
import { fetchJsonStrict } from './api'

// Minimal tests for helper behavior: ok JSON, empty body, and error path

describe('fetchJsonStrict', () => {
  it('returns parsed JSON on 200 OK', async () => {
    const payload = { hello: 'world' }
    // @ts-expect-error override global fetch for test
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(payload)),
    })
    const res = await fetchJsonStrict('/ok')
    expect(res).toEqual(payload)
  })

  it('returns null on 204 No Content', async () => {
    // @ts-expect-error override global fetch for test
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: () => Promise.resolve(''),
    })
    const res = await fetchJsonStrict('/nocontent')
    expect(res).toBeNull()
  })

  it('returns null on whitespace-only body', async () => {
    // @ts-expect-error override global fetch for test
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('  \n\t  '),
    })
    const res = await fetchJsonStrict('/whitespace')
    expect(res).toBeNull()
  })

  it('throws with message from error payload on non-OK', async () => {
    // @ts-expect-error override global fetch for test
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve(JSON.stringify({ message: 'Bad Request' })),
    })
    await expect(fetchJsonStrict('/bad')).rejects.toThrow('Bad Request')
  })
})
