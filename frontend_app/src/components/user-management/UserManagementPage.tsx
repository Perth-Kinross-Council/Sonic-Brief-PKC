import { useEffect, useState, useRef } from "react";
import { useUserManagement } from "./UserManagementContext";
import { useEnhancedUnifiedAuth } from "../../lib/useEnhancedUnifiedAuth";
import { RoleSelector } from "./RoleSelector";
import { BulkUserActions } from "./BulkUserActions";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";
import { apiUrl } from "@/lib/apiUrl";

export function UserManagementPage() {
  const {
    users,
    loading,
    error,
    fetchUsers,
    updateUserRole,
    updateUserPassword,
    deleteUser,
    clearError,
  } = useUserManagement();
  const { isAuthenticated, isLoading: authLoading, authMethod } = useEnhancedUnifiedAuth();
  const [filter, setFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [authMethodFilter, setAuthMethodFilter] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [authTimeout, setAuthTimeout] = useState(false);
  const fetchingRef = useRef(false);

  // Set a timeout for authentication loading
  useEffect(() => {
    if (authLoading) {
      const timer = setTimeout(() => {
        setAuthTimeout(true);
      }, 10000); // 10 second timeout

      return () => clearTimeout(timer);
    } else {
      setAuthTimeout(false);
    }
  }, [authLoading]);

  useEffect(() => {
    // Only fetch users when authentication is ready and user is authenticated
    // OR if authentication has timed out (fallback)
    if ((!authLoading && isAuthenticated) || authTimeout) {
      // Prevent multiple simultaneous fetches
      if (fetchingRef.current) {
        return;
      }

      fetchingRef.current = true;
      fetchUsers(filter, roleFilter, authMethodFilter, authTimeout) // Pass authTimeout as bypassAuth parameter
        .finally(() => {
          fetchingRef.current = false;
        });

      // Update URL params only if needed
      const params = new URLSearchParams();
      if (filter) params.set("filter", filter);
      if (roleFilter) params.set("role", roleFilter);
      if (authMethodFilter) params.set("auth_method", authMethodFilter);
      const newSearch = params.toString();
      if (window.location.search !== `?${newSearch}`) {
        window.history.replaceState(null, "", `?${newSearch}`);
      }
    } else {
      /* silent when auth not ready */
    }
  }, [filter, roleFilter, authMethodFilter, authLoading, isAuthenticated, authTimeout, authMethod]); // Removed fetchUsers to prevent infinite loops

  const handleBulkDelete = () => {
    if (window.confirm(`Delete ${selected.length} users?`)) {
      selected.forEach(id => deleteUser(id));
      setSelected([]);
    }
  };
  const handleBulkRoleChange = (role: string) => {
    selected.forEach(id => updateUserRole(id, role));
    setSelected([]);
  };

  return (
    <div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
  {/* Auth debug banners removed to avoid flicker during page load */}

      {/* API error state */}
      {error && (
        <div className="bg-red-100 text-red-800 p-3 rounded border border-red-300 mb-4">
          <div className="flex items-start justify-between">
            <div>
              <strong>Error loading users:</strong>
              <div className="mt-1 text-sm">{error}</div>
            </div>
            <div className="flex gap-2 ml-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  fetchUsers(filter, roleFilter, authMethodFilter);
                }}
                disabled={loading}
              >
                Retry
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDebugInfo(!showDebugInfo)}
              >
                {showDebugInfo ? 'Hide' : 'Show'} Debug Info
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => clearError()}
              >
                Dismiss
              </Button>
            </div>
          </div>
          {showDebugInfo && (
            <div className="mt-3 p-3 bg-gray-50 rounded border text-xs">
              <strong>Debug Information:</strong>
              <div className="mt-1 space-y-1">
                <div>Auth State: {authLoading ? 'Loading' : isAuthenticated ? 'Authenticated' : 'Not Authenticated'}</div>
                <div>Auth Timeout: {authTimeout ? 'Yes (bypassed)' : 'No'}</div>
                <div>Auth Method: {authMethod || 'Unknown'}</div>
                <div>Users Count: {users.length}</div>
                <div>Current Filter: "{filter}" (Role: "{roleFilter}", Auth: "{authMethodFilter}")</div>
                <div>API Endpoint: {apiUrl('/auth/admin/users')}</div>
              </div>
              <div className="mt-2">
                <strong>Troubleshooting:</strong>
                <ul className="list-disc list-inside mt-1 space-y-1">
                  <li>Check browser console for detailed error logs</li>
                  <li>Verify you have admin role assigned</li>
                  <li>Try signing out and signing in again</li>
                  <li>Check if API endpoint is accessible</li>
                  <li>If auth is stuck loading, click "Continue Anyway" above</li>
                </ul>
                <div className="mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.location.reload()}
                  >
                    Refresh Page
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mb-4 min-h-[48px]">
        <div className="space-y-1">
          <nav
            className="flex items-center text-sm text-muted-foreground mb-1"
            aria-label="Breadcrumb"
          >
            <a href="/home" className="hover:underline">
              Home
            </a>
            <span className="mx-2">&gt;</span>
            <span className="font-semibold">User Management</span>
          </nav>
          <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Users className="h-5 w-5" />
            User Management
          </h2>
          <p className="text-muted-foreground text-sm">
            Manage users, roles, and credentials for the platform.
          </p>
        </div>
  {/* Add New User button removed (legacy flow deprecated) */}
      </div>

      {/* Only show user management content when authenticated */}
      {!authLoading && isAuthenticated && (
      <div className="flex justify-center w-full">
        <div className="w-full">
          <div>
            <div className="mb-4 flex flex-col sm:flex-row gap-2 w-full">
              <input
                type="text"
                placeholder="Filter by email"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="border p-2 rounded w-full sm:w-auto"
              />
              <select
                title="Filter by role"
                value={roleFilter}
                onChange={e => setRoleFilter(e.target.value)}
                className="border p-2 rounded w-full sm:w-auto"
              >
                <option value="">All Roles</option>
                <option value="admin">Admin</option>
                <option value="power_user">Power User</option>
                <option value="standard">Standard</option>
              </select>
              <select
                title="Filter by account type"
                value={authMethodFilter}
                onChange={e => setAuthMethodFilter(e.target.value)}
                className="border p-2 rounded w-full sm:w-auto"
              >
                <option value="">All Account Types</option>
                <option value="entra">Entra ID</option>
                <option value="legacy">Legacy</option>
              </select>
            </div>
            {loading ? (
              <div role="status" aria-busy="true" className="flex items-center gap-2 text-blue-600">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /></svg>
                Loading users...
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border bg-card shadow">
                <table className="w-full min-w-[800px] border-0 text-sm" aria-label="User management table">
                  <caption className="sr-only">User management table</caption>
                  <thead>
                    <tr className="bg-muted">
                      <th className="border-b p-2 text-left font-semibold">Display Name</th>
                      <th className="border-b p-2 text-left font-semibold">Email</th>
                      <th className="border-b p-2 text-left font-semibold">Role</th>
                      <th className="border-b p-2 text-left font-semibold">Account Type</th>
                      <th className="border-b p-2 text-left font-semibold">Created</th>
                      <th className="border-b p-2 text-left font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(user => (
                      <tr key={user.id} className="even:bg-muted/50">
                        <td className="border-b p-2">
                          <input
                            type="checkbox"
                            title={`Select user ${user.email}`}
                            checked={selected.includes(user.id)}
                            onChange={e => {
                              setSelected(sel =>
                                e.target.checked
                                  ? [...sel, user.id]
                                  : sel.filter(id => id !== user.id)
                              );
                            }}
                          />
                          {user.display_name || "-"}
                        </td>
                        <td className="border-b p-2">{user.email}</td>
                        <td className="border-b p-2">
                          <RoleSelector
                            value={user.role}
                            onChange={role => updateUserRole(user.id, role)}
                          />
                        </td>
                        <td className="border-b p-2">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                            user.auth_method === 'entra'
                              ? 'bg-blue-100 text-blue-800'
                              : user.auth_method === 'legacy'
                              ? 'bg-gray-100 text-gray-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            {user.auth_method === 'entra' ? 'Entra ID' :
                             user.auth_method === 'legacy' ? 'Legacy' :
                             user.auth_method || 'Unknown'}
                          </span>
                        </td>
                        <td className="border-b p-2">{user.created_at}</td>
                        <td className="border-b p-2 flex flex-col sm:flex-row gap-2">
                          {/* Only show Update Password button for non-Entra accounts */}
                          {user.auth_method !== 'entra' && (
                            <button
                              className="border rounded px-2 py-1 bg-blue-100 hover:bg-blue-200"
                              onClick={() => {
                                const newPassword = prompt("Enter new password:");
                                if (newPassword) updateUserPassword(user.id, newPassword);
                              }}
                            >Update Password</button>
                          )}
                          <button
                            className="border rounded px-2 py-1 bg-red-100 hover:bg-red-200"
                            onClick={() => {
                              if (window.confirm(`Delete user ${user.email}?`)) deleteUser(user.id);
                            }}
                          >Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <BulkUserActions
                  selected={selected}
                  onBulkDelete={handleBulkDelete}
                  onBulkRoleChange={handleBulkRoleChange}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      )}

  {/* Add User dialog removed */}
    </div>
  );
}
