import { useIsAuthenticated } from "@azure/msal-react";
import { useState, useEffect } from "react";

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  authMethod: 'msal' | 'legacy' | null;
}

export function useUnifiedAuthParity() {
  const isMsalAuthenticated = useIsAuthenticated();
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    authMethod: null
  });

  useEffect(() => {
    const updateAuthState = () => {
      let isAuthenticated = false;
      let authMethod: 'msal' | 'legacy' | null = null;

      // Check MSAL first (primary method)
      if (isMsalAuthenticated) {
        isAuthenticated = true;
        authMethod = 'msal';
      } else {
        // Check legacy token as fallback
        const legacyToken = localStorage.getItem("token");
        if (legacyToken) {
          try {
            const [, payloadBase64] = legacyToken.split(".");
            if (payloadBase64) {
              const payload = JSON.parse(atob(payloadBase64.replace(/-/g, "+").replace(/_/g, "/")));
              const now = Math.floor(Date.now() / 1000);
              if (payload.exp && payload.exp > now) {
                isAuthenticated = true;
                authMethod = 'legacy';
              }
            }
          } catch (e) {
            // Invalid token, ignore
          }
        }
      }

      setAuthState({
        isAuthenticated,
        isLoading: false,
        authMethod
      });
    };

    updateAuthState();
  }, [isMsalAuthenticated]);

  return {
    isAuthenticated: authState.isAuthenticated,
    isLoading: authState.isLoading,
    pending: authState.isLoading,
    authenticated: authState.isAuthenticated,
    authMethod: authState.authMethod
  };
}
