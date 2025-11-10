// Reference MSAL config for SonicBrief-EID parity
import type { Configuration } from '@azure/msal-browser';
import { debugLog, debugWarn, debugError } from './debug';

export const msalConfig: Configuration = {
  auth: {
    clientId: import.meta.env.VITE_AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_AZURE_TENANT_ID}`,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
    navigateToLoginRequestUrl: true,
  },
  cache: {
    cacheLocation: 'localStorage',
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return; // Never log PII
        switch (level) {
          case 0:
            debugError('[MSAL]', message);
            break;
          case 1:
            debugWarn('[MSAL]', message);
            break;
          case 2:
            debugLog('[MSAL]', message);
            break;
          case 3:
            debugLog('[MSAL:verbose]', message);
            break;
        }
      },
      logLevel: 2,
      piiLoggingEnabled: false,
    },
  },
};

export const loginRequest = {
  scopes: [import.meta.env.VITE_AZURE_BACKEND_SCOPE, 'User.Read'],
  prompt: 'select_account',
};
