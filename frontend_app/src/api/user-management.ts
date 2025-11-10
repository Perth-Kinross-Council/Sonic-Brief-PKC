import { useMemo } from "react";
import { useUnifiedAccessToken, fetchJsonStrict } from "../lib/api";
import { apiUrl } from "../lib/apiUrl";

export interface User {
  id: string;
  email: string;
  display_name?: string;
  role: string;
  created_at: string;
  is_active?: boolean;
  auth_method?: string; // "entra" or "legacy"
}

// Base URL is resolved via apiUrl helper

export function useUserManagementApi() {
  const getToken = useUnifiedAccessToken();
  return useMemo(
    () => ({
      fetchUsers: async (filter = "", roleFilter = "", authMethodFilter = ""): Promise<User[]> => {
        try {
          // Removed commented debug logging: fetching users parameters & API URL

          const token = await getToken();
          // Removed commented debug logging: token length

          if (!token) {
            throw new Error("No authentication token available. Please sign in again.");
          }

          const params = new URLSearchParams();
          if (filter) params.append("filter", filter);
          if (roleFilter) params.append("role", roleFilter);
          if (authMethodFilter) params.append("auth_method", authMethodFilter);

          const endpoint = apiUrl(`/auth/admin/users?${params.toString()}`);
          // Removed commented debug logging: request endpoint

          const data = (await fetchJsonStrict(endpoint, {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
          })) as unknown;
          // Removed commented debug logging: users received count

          // Validate response structure
          if (!Array.isArray(data)) {
            console.error("[UserManagementAPI] Invalid response format:", data);
            throw new Error("Invalid response format from server");
          }

          return data;
        } catch (error: any) {
          console.error("[UserManagementAPI] fetchUsers failed:", error);

          // Map HTTP status-based errors from fetchJsonStrict
          if (typeof error?.status === "number") {
            switch (error.status) {
              case 401:
                throw new Error("Authentication failed. Please sign in again.");
              case 403:
                throw new Error("Access denied. Admin privileges required to view users.");
              case 404:
                throw new Error("User management endpoint not found. Check API configuration.");
              case 500:
                throw new Error("Server error occurred while fetching users. Please try again.");
              default:
                // Include server-provided message if available
                throw new Error(
                  `Failed to fetch users: ${error.status} ${error.statusText || ""} ${error.body ? "- " + (typeof error.body === "string" ? error.body : JSON.stringify(error.body)) : ""}`.trim()
                );
            }
          }

          // Handle network and other errors
          if (error.name === 'NetworkError' || error.message.includes('fetch')) {
            throw new Error("Network error: Unable to connect to the server. Check your internet connection and try again.");
          }

          if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
            throw new Error("Connection failed: The server may be down or the URL is incorrect.");
          }

          // Re-throw with enhanced error message if not already enhanced
          const errorMessage = error.message.includes('User management error:')
            ? error.message
            : `User management error: ${error.message}`;

          throw new Error(errorMessage);
        }
      },
      updateUserRole: async (userId: string, newRole: string): Promise<void> => {
        const token = await getToken();
        const res = await fetch(apiUrl(`/auth/admin/users/${userId}/role?new_role=${newRole}`), {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Failed to update user role");
      },
      updateUserPassword: async (userId: string, newPassword: string): Promise<void> => {
        const token = await getToken();
        const res = await fetch(apiUrl(`/auth/admin/users/${userId}/password?new_password=${newPassword}`), {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Failed to update user password");
      },
      deleteUser: async (userId: string): Promise<void> => {
        const token = await getToken();
        const res = await fetch(apiUrl(`/auth/admin/users/${userId}`), {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Failed to delete user");
      },
    }),
    [getToken]
  );
}
