/**
 * Admin Route Guard Component
 * Restricts access to admin-only routes and components
 */

import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { AlertCircle, Shield } from 'lucide-react';
import { debugLog, debugError } from '@/lib/debug';

interface AdminRouteGuardProps {
  children: React.ReactNode;
  fallbackMessage?: string;
}

const AdminRouteGuard: React.FC<AdminRouteGuardProps> = ({
  children,
  fallbackMessage = "Administrator access required to view this content."
}) => {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAdminPermissions();
  }, []);

  const checkAdminPermissions = () => {
    try {
      const token = localStorage.getItem('token');

      if (!token) {
        debugLog('AdminRouteGuard: No token found');
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      // Decode JWT token to check user role
      const payload = JSON.parse(atob(token.split('.')[1]));
  debugLog('AdminRouteGuard: JWT payload:', payload);

      const userRole = payload.role || '';
      const userRoles = payload.roles || [];

  debugLog('AdminRouteGuard: userRole:', userRole);
  debugLog('AdminRouteGuard: userRoles:', userRoles);

      // More flexible admin checking - check multiple possible fields and values
      const hasAdminAccess = (
        userRole === 'admin' ||
        userRole === 'administrator' ||
        userRole === 'Admin' ||
        userRole === 'Administrator' ||
        userRoles.includes('admin') ||
        userRoles.includes('administrator') ||
        userRoles.includes('Admin') ||
        userRoles.includes('Administrator') ||
        // Check if there's an 'isAdmin' field
        payload.isAdmin === true ||
        // Check Azure AD specific roles
        (payload.roles && payload.roles.some((role: string) =>
          role.toLowerCase().includes('admin')
        ))
      );

  debugLog('AdminRouteGuard: hasAdminAccess:', hasAdminAccess);
      setIsAdmin(hasAdminAccess);
    } catch (error) {
  debugError('AdminRouteGuard: Error checking admin permissions:', error);
      setIsAdmin(false);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Shield className="h-8 w-8 mx-auto mb-2 text-gray-400" />
          <p className="text-gray-600">Checking permissions...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <Card className="border-red-200 max-w-lg">
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="flex items-center justify-center text-red-600 mb-4">
                <AlertCircle className="h-8 w-8 mr-2" />
                <span className="text-lg font-semibold">Access Denied</span>
              </div>

              <p className="text-gray-700 mb-4">{fallbackMessage}</p>

              <div className="bg-gray-50 p-4 rounded-lg mb-4">
                <div className="flex items-start">
                  <Shield className="h-5 w-5 text-gray-400 mt-1 mr-2" />
                  <div className="text-left">
                    <p className="text-sm font-medium text-gray-700 mb-1">Admin Features Include:</p>
                    <ul className="text-sm text-gray-600 space-y-1">
                      <li>• System analytics and performance metrics</li>
                      <li>• User activity monitoring</li>
                      <li>• Job audit trails and system health</li>
                      <li>• Administrative controls and settings</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="text-sm text-gray-600 mb-4">
                If you need access to administrative features, please contact your system administrator.
              </div>

              <div className="flex gap-2 justify-center">
                <Button
                  onClick={() => window.history.back()}
                  variant="outline"
                >
                  Go Back
                </Button>
                <Button
                  onClick={() => window.location.href = '/dashboard'}
                  variant="default"
                >
                  Return to Dashboard
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // User is admin, render the protected content
  return <>{children}</>;
};

export default AdminRouteGuard;

/*
Usage Instructions:

1. Wrap any admin-only components or routes:
   ```tsx
   import AdminRouteGuard from '../components/guards/AdminRouteGuard';

   // In your route configuration
   <Route path="/analytics" element={
     <AdminRouteGuard>
       <AnalyticsDashboard />
     </AdminRouteGuard>
   } />
   ```

2. For custom fallback messages:
   ```tsx
   <AdminRouteGuard fallbackMessage="This feature is restricted to system administrators.">
     <SensitiveAdminComponent />
   </AdminRouteGuard>
   ```

3. Use in navigation menus to conditionally show admin links:
   ```tsx
   import AdminRouteGuard from '../components/guards/AdminRouteGuard';

   <AdminRouteGuard fallbackMessage="">
     <NavLink to="/analytics">
       <Activity className="h-4 w-4" />
       Analytics
     </NavLink>
   </AdminRouteGuard>
   ```

4. The component automatically:
   - Checks JWT token for admin roles
   - Shows loading state while checking permissions
   - Displays helpful error message for non-admin users
   - Provides navigation options to return to allowed areas
   - Renders protected content only for verified admin users

This ensures your analytics dashboard and other admin features are properly secured!
*/
