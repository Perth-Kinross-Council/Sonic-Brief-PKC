import { StrictMode } from "react";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PublicClientApplication } from "@azure/msal-browser";
import { MsalProvider } from "@azure/msal-react";
import { msalConfig } from "./lib/authConfig";
import { AuthManagerProvider } from "./lib/auth-manager-context";

import * as TanstackQuery from "./integrations/tanstack-query/root-provider";
// Import the generated route tree
import { routeTree } from "./routeTree.gen";

import "./styles.css";

import reportWebVitals from "./reportWebVitals.ts";
import { LoginAuditOnce } from "./components/LoginAuditOnce";

// Create a new router instance
const router = createRouter({
  routeTree,
  context: {
    ...TanstackQuery.getContext(),
  },
  defaultPreload: "intent",
  scrollRestoration: true,
  defaultStructuralSharing: true,
  defaultPreloadStaleTime: 0,
});

// Register the router instance for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}


const msalInstance = new PublicClientApplication(msalConfig);

// Expose MSAL instance globally for debugging purposes
if (typeof window !== 'undefined') {
  (window as any).msal = msalInstance;
  (window as any).msalInstance = msalInstance;
}

msalInstance.initialize().then(() => {

  msalInstance.handleRedirectPromise().finally(() => {

    const rootElement = document.getElementById("app");
    if (rootElement && !rootElement.innerHTML) {
      const root = ReactDOM.createRoot(rootElement);
      root.render(
        <StrictMode>
          <ErrorBoundary>
            <MsalProvider instance={msalInstance}>
              <AuthManagerProvider>
                <TanstackQuery.Provider>
                  <LoginAuditOnce />
                  <RouterProvider router={router} />
                </TanstackQuery.Provider>
              </AuthManagerProvider>
            </MsalProvider>
          </ErrorBoundary>
        </StrictMode>
      );
    }
  });
});

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
