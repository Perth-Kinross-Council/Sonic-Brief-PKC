import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useMsal } from '@azure/msal-react';
// Use the canonical EnhancedAuthManager implementation (duplicate lowercase file removed)
import { EnhancedAuthManager } from './EnhancedAuthManager';

interface AuthManagerContextType {
  authManager: EnhancedAuthManager;
}

const AuthManagerContext = createContext<AuthManagerContextType | null>(null);

interface AuthManagerProviderProps {
  children: ReactNode;
}

export function AuthManagerProvider({ children }: AuthManagerProviderProps) {
  const { instance } = useMsal();

  const authManager = useMemo(() => {
    const scopes = [
      import.meta.env.VITE_AZURE_BACKEND_SCOPE || 'api://default/access_as_user',
      'User.Read'
    ].filter(Boolean); // Remove any undefined values

    const manager = new EnhancedAuthManager(instance, {
      scopes,
      preemptiveRefreshBuffer: 15, // 15 minutes
      backgroundRefreshInterval: 120000, // 2 minutes
      maxCacheSize: 50,
      enablePerformanceLogging: import.meta.env.DEV
    });

    // Expose auth manager globally for debugging
    if (typeof window !== 'undefined') {
      (window as any).authManager = manager;
    }

    return manager;
  }, [instance]);

  return (
    <AuthManagerContext.Provider value={{ authManager }}>
      {children}
    </AuthManagerContext.Provider>
  );
}

export function useAuthManager(): EnhancedAuthManager {
  const context = useContext(AuthManagerContext);
  if (!context) {
    throw new Error('useAuthManager must be used within an AuthManagerProvider');
  }
  return context.authManager;
}
