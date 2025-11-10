import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import { useUserManagementApi } from "../../api/user-management";
import { useEnhancedUnifiedAuth } from "../../lib/useEnhancedUnifiedAuth";
import type { User } from "../../api/user-management";

interface UserManagementContextType {
  users: User[];
  loading: boolean;
  error: string;
  fetchUsers: (filter?: string, roleFilter?: string, authMethodFilter?: string, bypassAuth?: boolean) => Promise<void>;
  updateUserRole: (userId: string, newRole: string) => Promise<void>;
  updateUserPassword: (userId: string, newPassword: string) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  clearError: () => void;
}

const UserManagementContext = createContext<UserManagementContextType | undefined>(undefined);

export function UserManagementProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const api = useUserManagementApi();
  const { isAuthenticated, isLoading: authLoading } = useEnhancedUnifiedAuth();

  const fetchUsers = useCallback(async (filter = "", roleFilter = "", authMethodFilter = "", bypassAuth = false) => {
    // Don't fetch users if authentication is still loading or user is not authenticated
    // UNLESS bypassAuth is true (for timeout scenarios)
    // Use current auth state directly instead of refs
  if (!bypassAuth && (authLoading || !isAuthenticated)) {
      return;
    }

  if (bypassAuth) {
    }

    setLoading(true);
    setError("");
    try {
  const data = await api.fetchUsers(filter, roleFilter, authMethodFilter);
      setUsers(data);

      // Clear any previous errors on successful fetch
      setError("");
    } catch (e: any) {
      console.error("[UserManagement] fetchUsers error:", e);

      // Set user-friendly error message
      let errorMessage = e.message || "Unknown error occurred";

      // Add suggestions based on error type
      if (errorMessage.includes("Authentication failed") || errorMessage.includes("401")) {
        errorMessage += " Try refreshing the page or signing in again.";
      } else if (errorMessage.includes("Access denied") || errorMessage.includes("403")) {
        errorMessage += " Contact your administrator to get admin privileges.";
      } else if (errorMessage.includes("not found") || errorMessage.includes("404")) {
        errorMessage += " The API endpoint may be misconfigured.";
      }

      setError(errorMessage);
      // Don't clear users array on error - keep showing previous data if available
    } finally {
      setLoading(false);
    }
  }, [api, authLoading, isAuthenticated]); // Include auth states as dependencies

  const updateUserRole = useCallback(async (userId: string, newRole: string) => {
    if (authLoading || !isAuthenticated) {
      return; // Skipping updateUserRole - auth not ready (removed commented log)
    }

    setLoading(true);
    setError("");
    try {
      await api.updateUserRole(userId, newRole);
      // Re-fetch users after role update
      const data = await api.fetchUsers("", "", "");
      setUsers(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  const updateUserPassword = useCallback(async (userId: string, newPassword: string) => {
    if (authLoading || !isAuthenticated) {
      return; // Skipping updateUserPassword - auth not ready (removed commented log)
    }

    setLoading(true);
    setError("");
    try {
      await api.updateUserPassword(userId, newPassword);
      // Re-fetch users after password update
      const data = await api.fetchUsers("", "", "");
      setUsers(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [api, authLoading, isAuthenticated]);

  const deleteUser = useCallback(async (userId: string) => {
    if (authLoading || !isAuthenticated) {
      return; // Skipping deleteUser - auth not ready (removed commented log)
    }

    setLoading(true);
    setError("");
    try {
      await api.deleteUser(userId);
      // Re-fetch users after deletion
      const data = await api.fetchUsers("", "", "");
      setUsers(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [api, authLoading, isAuthenticated]);

  const clearError = useCallback(() => {
    setError("");
  }, []);

  return (
    <UserManagementContext.Provider value={{ users, loading, error, fetchUsers, updateUserRole, updateUserPassword, deleteUser, clearError }}>
      {children}
    </UserManagementContext.Provider>
  );
}

export function useUserManagement() {
  const context = useContext(UserManagementContext);
  if (!context) throw new Error("useUserManagement must be used within a UserManagementProvider");
  return context;
}
