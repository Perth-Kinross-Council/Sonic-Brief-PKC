import { env } from "@/env";

// Build absolute API URL from env base, trimming any trailing slash
export function apiUrl(path: string) {
  return env.VITE_API_URL.replace(/\/$/, "") + path;
}
