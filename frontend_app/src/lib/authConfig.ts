import type { Configuration } from '@azure/msal-browser';
import { debugLog, debugWarn, debugError } from './debug';


export const msalConfig: Configuration = {
  auth: {
    clientId: import.meta.env.VITE_AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_AZURE_TENANT_ID}`,
    redirectUri: window.location.origin + "/",
  },
  cache: {
    cacheLocation: 'sessionStorage', // Use sessionStorage for balanced security and UX
    storeAuthStateInCookie: false, // Don't use cookies for auth state
    secureCookies: false, // Not using cookies anyway
    // Aggressive caching settings to prevent unnecessary token refreshes
    claimsBasedCachingEnabled: true, // Enable claims-based caching for better performance
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return; // Never log PII
        // Map MSAL log levels to gated debug helpers. Only errors/warnings surface un-gated via console.* policy.
        switch (level) {
          case 0: // Error
            debugError('[MSAL]', message);
            break;
          case 1: // Warning
            debugWarn('[MSAL]', message);
            break;
          case 2: // Info
            debugLog('[MSAL]', message);
            break;
          case 3: // Verbose
            debugLog('[MSAL:verbose]', message);
            break;
        }
      },
      piiLoggingEnabled: false,
      logLevel: import.meta.env.DEV ? 3 : 1, // Verbose in dev, warnings in prod
    },
    windowHashTimeout: 60000, // Increase timeout for slower networks
    iframeHashTimeout: 6000,
    loadFrameTimeout: 0,
  }
};

export const loginRequest = {
  scopes: ['User.Read'],
  prompt: 'select_account', // Allow user to select account if multiple available
};
