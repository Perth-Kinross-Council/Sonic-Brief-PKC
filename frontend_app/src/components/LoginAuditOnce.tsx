import { useEffect } from "react";
import { useIsAuthenticated } from "@azure/msal-react";
import { useAuditLoginOnce } from "@/lib/enhancedApi";

// Emits a single LOGIN audit per browser session after successful authentication
export function LoginAuditOnce() {
  const isAuthenticated = useIsAuthenticated();
  const auditLoginOnce = useAuditLoginOnce();

  useEffect(() => {
    const alreadyDone = sessionStorage.getItem("sb_login_audit_done") === "1";
    const loggingOut = (window as any).__sbLogoutInProgress;
    if (!isAuthenticated || alreadyDone || loggingOut) return;

    let cancelled = false;
    (async () => {
      try {
        await auditLoginOnce();
        if (!cancelled) sessionStorage.setItem("sb_login_audit_done", "1");
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, auditLoginOnce]);

  return null;
}
