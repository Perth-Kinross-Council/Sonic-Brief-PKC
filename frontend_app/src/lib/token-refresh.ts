import type { IPublicClientApplication, AccountInfo } from "@azure/msal-browser";
import { loginRequest } from "./authConfig";
import { BrowserAuthError } from "@azure/msal-browser";

export async function acquireTokenSilently(msalInstance: IPublicClientApplication): Promise<string | null> {
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) return null;
  
  try {
    const response = await msalInstance.acquireTokenSilent({
      ...loginRequest,
      account: accounts[0] as AccountInfo,
    });
    return response.accessToken;
  } catch (error: any) {
    if (error instanceof BrowserAuthError && error.errorCode === "interaction_in_progress") {
      // Don't try popup if already in progress
      return null;
    }
    try {
      const response = await msalInstance.acquireTokenPopup(loginRequest);
      return response.accessToken;
    } catch (popupError) {
      console.error("Token acquisition failed:", popupError);
      return null;
    }
  }
}

// Remove legacy refreshToken and credential storage functions, as MSAL now manages tokens.
// ENHANCED: Token management is now handled by EnhancedAuthManager