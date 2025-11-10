/**
 * Debugging Analytics Dashboard Component
 * Temporarily bypasses admin checking to debug JWT token structure
 */

import { useState, useEffect } from 'react';
import { TokenInspector } from '../debug/TokenInspector';
import { debugConfig } from "../../env";
import { useEnhancedUnifiedAuth } from '../../lib/useEnhancedUnifiedAuth';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { debugLog, debugError } from '../../lib/debug';

const DebugAnalyticsDashboard = () => {
  if (!debugConfig.isEnabled()) return null;
  const [loading, setLoading] = useState(true);
  const [adminCheckResult, setAdminCheckResult] = useState<any>(null);

  // Use the same auth hook as UserManagementPage
  const { isAuthenticated, isLoading: authLoading, authMethod } = useEnhancedUnifiedAuth();

  useEffect(() => {
    // Perform admin check and token debugging using MSAL approach
    const debugAdminCheck = async () => {
  debugLog('=== ADMIN CHECK DEBUG (MSAL APPROACH) ===');
  debugLog('isAuthenticated:', isAuthenticated);
  debugLog('authLoading:', authLoading);
  debugLog('authMethod:', authMethod);

      // Wait for auth to finish loading
      if (authLoading) {
  debugLog('Still loading authentication...');
        return;
      }

      if (!isAuthenticated) {
        setAdminCheckResult({
          error: 'User not authenticated via MSAL',
          isAuthenticated: false,
          authMethod: authMethod
        });
        setLoading(false);
        return;
      }

  debugLog('User is authenticated! Now checking for admin access...');

      // Try to get token using the auth manager (same as User Management does)
      try {
        // Check if the auth manager is available globally
        const authManager = (window as any).sonicBriefAuthManager;
  debugLog('Auth manager available:', !!authManager);

        if (authManager && typeof authManager.getToken === 'function') {
          debugLog('Attempting to get token from auth manager...');
          const token = await authManager.getToken();
          debugLog('Token from auth manager: [redacted] length=', token ? token.length : 0);

          if (token && token.includes('.')) {
            try {
              const payload = JSON.parse(atob(token.split('.')[1]));
              debugLog('Token payload:', payload);

              // Check various role-related fields
              const roleFields = {
                role: payload.role,
                roles: payload.roles,
                isAdmin: payload.isAdmin,
                admin: payload.admin,
                user_role: payload.user_role,
                authorities: payload.authorities,
                permissions: payload.permissions,
                groups: payload.groups,
                app_roles: payload.app_roles,
                extension_UserRole: payload.extension_UserRole
              };

              debugLog('Role fields found:', roleFields);

              setAdminCheckResult({
                success: true,
                tokenSource: 'authManager',
                payload: payload,
                roleFields: roleFields,
                isAuthenticated: true,
                authMethod: authMethod
              });
            } catch (err) {
              debugError('Failed to decode token from auth manager:', err);
              setAdminCheckResult({
                error: 'Token decode failed',
                details: err,
                tokenSource: 'authManager',
                tokenFound: true
              });
            }
          } else {
            debugLog('No valid token from auth manager');
            setAdminCheckResult({
              error: 'No valid token from auth manager',
              tokenSource: 'authManager',
              tokenFound: false
            });
          }
        } else {
          debugLog('Auth manager not available or no getToken method');
          setAdminCheckResult({
            error: 'Auth manager not available',
            isAuthenticated: true,
            authMethod: authMethod,
            authManagerAvailable: false
          });
        }
      } catch (err) {
  debugError('Error during admin check:', err);
        setAdminCheckResult({
          error: 'Admin check failed',
          details: err,
          isAuthenticated: true,
          authMethod: authMethod
        });
      } finally {
        setLoading(false);
      }
    };

    debugAdminCheck();
  }, [isAuthenticated, authLoading, authMethod]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-600">Loading analytics...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Debug component to inspect JWT token structure */}
      <TokenInspector />

      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold">🔍 Analytics Dashboard (Debug Mode)</h2>
        <p className="text-sm text-gray-600 mt-1">Debugging JWT token structure</p>
      </div>

      {/* Debug Results */}
      <Card>
        <CardHeader>
          <CardTitle>🔧 Debug Results</CardTitle>
        </CardHeader>
        <CardContent>
          {adminCheckResult?.error ? (
            <div className="text-red-600 space-y-3">
              <div>
                <AlertCircle className="h-5 w-5 inline mr-2" />
                Error: {adminCheckResult.error}
              </div>

              {adminCheckResult.isAuthenticated !== undefined && (
                <div className="bg-blue-50 p-3 rounded text-sm">
                  <h5 className="font-semibold mb-2">MSAL Authentication State:</h5>
                  <div className="space-y-1">
                    <div>Is Authenticated: <span className="font-mono">{adminCheckResult.isAuthenticated ? 'Yes' : 'No'}</span></div>
                    <div>Auth Method: <span className="font-mono">{adminCheckResult.authMethod || 'Unknown'}</span></div>
                    <div>Auth Manager Available: <span className="font-mono">{adminCheckResult.authManagerAvailable !== false ? 'Yes' : 'No'}</span></div>
                  </div>
                </div>
              )}

              {adminCheckResult.checkedKeys && (
                <div className="bg-red-50 p-3 rounded text-sm">
                  <h5 className="font-semibold mb-2">Checked token keys:</h5>
                  <div className="grid grid-cols-2 gap-1">
                    {adminCheckResult.checkedKeys.map((key: string) => (
                      <div key={key} className="font-mono">{key}</div>
                    ))}
                  </div>
                </div>
              )}

              {adminCheckResult.allLocalStorageKeys && (
                <div className="bg-gray-50 p-3 rounded text-sm">
                  <h5 className="font-semibold mb-2">All localStorage keys found:</h5>
                  <div className="font-mono text-xs">
                    {adminCheckResult.allLocalStorageKeys.length > 0
                      ? adminCheckResult.allLocalStorageKeys.join(', ')
                      : 'None'
                    }
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h4 className="font-semibold text-green-600">✅ Authentication Successful (MSAL)</h4>
                <div className="text-sm text-gray-600 space-y-1">
                  <p>Authentication method: <span className="font-mono bg-gray-100 px-2 py-1 rounded">{adminCheckResult?.authMethod}</span></p>
                  <p>Token source: <span className="font-mono bg-gray-100 px-2 py-1 rounded">{adminCheckResult?.tokenSource}</span></p>
                  <p>Check browser console for detailed token structure</p>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Role Fields Found:</h4>
                <div className="bg-gray-50 p-3 rounded text-sm font-mono">
                  {adminCheckResult?.roleFields && Object.entries(adminCheckResult.roleFields).map(([key, value]) => (
                    <div key={key} className="mb-1">
                      <span className="font-semibold">{key}:</span> {JSON.stringify(value)}
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-blue-50 p-4 rounded">
                <h4 className="font-semibold text-blue-800 mb-2">Next Steps:</h4>
                <ol className="text-sm text-blue-700 list-decimal list-inside space-y-1">
                  <li>Check browser console for complete token structure</li>
                  <li>Identify which field contains your admin role information</li>
                  <li>Update AdminRouteGuard with correct role checking logic</li>
                  <li>Restore proper admin access control</li>
                </ol>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Instructions */}
      <Card>
        <CardHeader>
          <CardTitle>📋 Instructions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <p>This debug version will help us identify your JWT token structure.</p>
            <p><strong>Please check your browser console</strong> and share:</p>
            <ul className="list-disc list-inside pl-4 space-y-1">
              <li>Which field contains your admin role (role, roles, isAdmin, etc.)</li>
              <li>What the exact value is (admin, administrator, Admin, etc.)</li>
              <li>Any other role-related fields you see</li>
            </ul>
            <p>Once we know the correct field and values, we can fix the AdminRouteGuard and restore proper access control.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default DebugAnalyticsDashboard;
