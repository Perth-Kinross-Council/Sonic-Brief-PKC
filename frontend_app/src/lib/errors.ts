// Centralized user-facing error sanitization utility
// Ensures internal error details aren't leaked in production builds.
import { debugConfig } from '@/env';

const GENERIC = 'An unexpected error occurred. Please try again.';

export function sanitizeError(err: unknown, fallback?: string): string {
  // In debug, surface the original (still avoiding giant stacks in UI)
  if (debugConfig.isEnabled()) {
    if (err instanceof Error) return err.message || fallback || GENERIC;
    if (typeof err === 'string') return err || fallback || GENERIC;
  }
  return fallback || GENERIC;
}

export function userMessage(err: unknown, fallback?: string): string {
  return sanitizeError(err, fallback);
}
