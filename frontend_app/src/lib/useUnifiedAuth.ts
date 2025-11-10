import { useIsAuthenticated } from "@azure/msal-react";
import { useState, useEffect } from "react";

function isValidLegacyToken(token: string | null): boolean {
  if (!token) return false;
  try {
    const [, payloadBase64] = token.split(".");
    if (!payloadBase64) return false;
    const payload = JSON.parse(atob(payloadBase64.replace(/-/g, "+").replace(/_/g, "/")));
    if (!payload.exp) return false;
    const now = Math.floor(Date.now() / 1000);
    return payload.exp > now;
  } catch (e) {
    return false;
  }
}

// React hook to check if user is authenticated by either legacy token or MSAL/Entra ID
export function useUnifiedAuth() {
  // Hydrate legacyToken from localStorage immediately for first render
  const [legacyToken, setLegacyToken] = useState<string | null>(
    typeof window !== "undefined" ? window.localStorage.getItem("token") : null
  );
  const [pending, setPending] = useState(true);
  const isMsalAuthenticated = useIsAuthenticated();

  // Only run auth logic on client
  useEffect(() => {
    if (typeof window === "undefined") return;
    function handleAuthChanged() {
      const token = window.localStorage.getItem("token");
      setLegacyToken(token);
      setPending(false);
    }
    window.addEventListener("auth-changed", handleAuthChanged);
    // Initial check
    const token = window.localStorage.getItem("token");
    setLegacyToken(token);
    setPending(false);
    return () => {
      window.removeEventListener("auth-changed", handleAuthChanged);
    };
  }, []);

  // Listen for localStorage changes in other tabs
  useEffect(() => {
    if (typeof window === "undefined") return;
    function handleStorage(e: StorageEvent) {
      if (e.key === "token") {
        setLegacyToken(window.localStorage.getItem("token"));
        setPending(false);
      }
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const validLegacy = isValidLegacyToken(legacyToken);
  const authenticated = Boolean(isMsalAuthenticated || validLegacy);

  if (typeof window !== "undefined") {
    // Intentionally silent to avoid leaking auth state in production
  }
  return { authenticated, pending };
}
