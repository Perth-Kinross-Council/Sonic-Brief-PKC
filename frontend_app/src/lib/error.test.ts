import { describe, expect, it } from 'vitest'
import { getMessageFromError } from './error'

describe('getMessageFromError', () => {
  it('returns message from object with message', () => {
    expect(getMessageFromError({ message: 'boom' })).toBe('boom')
  })
  it('returns string error directly', () => {
    expect(getMessageFromError('oops')).toBe('oops')
  })
  it('falls back to default message', () => {
    expect(getMessageFromError({})).toBe('An error occurred')
  })
})
