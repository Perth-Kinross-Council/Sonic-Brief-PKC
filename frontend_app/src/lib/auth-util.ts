// Utility to check if user is authenticated by either legacy token or MSAL/Entra ID
export function isUserAuthenticated() {
  if (typeof window === "undefined") return false;
  // Check legacy token
  const legacyToken = window.localStorage.getItem("token");
  if (legacyToken) return true;
  // Check MSAL/Entra ID
  // This will be checked in React components using useIsAuthenticated
  return false;
}

// Utility to clear both legacy token and MSAL/Entra ID session on logout
export function logoutAllAuth() {
  if (typeof window !== "undefined") {
    // Clear legacy token
    window.localStorage.removeItem("token");
    // Clear MSAL/Entra ID state by removing session storage and local storage keys
    Object.keys(window.sessionStorage).forEach((key) => {
      if (key.startsWith("msal.")) window.sessionStorage.removeItem(key);
    });
    Object.keys(window.localStorage).forEach((key) => {
      if (key.startsWith("msal.")) window.localStorage.removeItem(key);
    });
  }
}
