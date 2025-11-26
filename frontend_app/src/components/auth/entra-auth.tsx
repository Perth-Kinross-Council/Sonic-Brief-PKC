
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { loginRequest } from "../../lib/authConfig";
// React import not needed with automatic JSX runtime
import { Button } from "@/components/ui/button";
import { logoutAllAuth } from "@/lib/auth-util";
import { useEnhancedUnifiedAuth } from "@/lib/useEnhancedUnifiedAuth";

export const EntraAuth: React.FC = () => {
  const { instance, accounts, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const { logout } = useEnhancedUnifiedAuth();

  if (!instance) {
    return (
      <div className="text-destructive">
        Authentication service is not available. Please try refreshing the page.
      </div>
    );
  }

  const handleLogin = () => {
    if (inProgress === "none") {
      instance.loginRedirect(loginRequest);
    }
  };

  const handleLogout = async () => {
    try {
      // Use unified logout to notify backend (/auth/logout) before clearing tokens
      await logout();
    } catch (e) {
      // Fallback: clear local auth if unified logout fails for any reason
      logoutAllAuth();
      window.location.href = "/login";
    }
  };

  return (
    <div className="space-y-3">
      {!isAuthenticated ? (
        <Button 
          onClick={handleLogin} 
          disabled={inProgress !== "none"}
          className="w-full"
          variant="outline"
        >
          {inProgress !== "none" ? "Signing in..." : "Sign in with Microsoft"}
        </Button>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Signed in as: {accounts[0]?.username}
          </p>
          <Button 
            onClick={handleLogout} 
            disabled={inProgress !== "none"}
            variant="outline"
            className="w-full"
          >
            {inProgress !== "none" ? "Signing out..." : "Sign out"}
          </Button>
        </div>
      )}
    </div>
  );
};
