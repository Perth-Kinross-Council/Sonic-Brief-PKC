// Central helpers for safely representing sensitive tokens without exposing raw substrings
export function shortHash(value: string, length = 8): string {
  try {
    return btoa(value).replace(/[^A-Za-z0-9]/g, '').substring(0, length) || 'na';
  } catch {
    return 'na';
  }
}

export function redactTokenPreview(token: string | null | undefined): string {
  if (!token) return 'null';
  return `[redacted len=${token.length} sha=${shortHash(token)}]`;
}
