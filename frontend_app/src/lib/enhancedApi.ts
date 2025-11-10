import { env } from "@/env";

/**
 * Enhanced API utilities with integrated authentication and caching
 * Replaces the token management logic in api.ts with EnhancedAuthManager integration
 */
// Note: authManager should be accessed from the global window object
// since it's provided by the AuthManagerProvider context

/**
 * Enhanced API client with automatic token management
 */
class EnhancedApiClient {
  private baseUrl: string;
  private defaultHeaders: HeadersInit;

  constructor(baseUrl: string = "") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.defaultHeaders = {
      "Content-Type": "application/json",
    };
  }

  /**
   * Make authenticated API request with automatic token refresh
   */
  public async request<T = any>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const authManager = (window as any).authManager;
    if (!authManager) {
      throw new Error('AuthManager not available on window object');
    }
    const token = await authManager.getToken();

    if (!token) {
      throw new Error("No valid authentication token available");
    }

  const url = this.baseUrl + endpoint;
    const headers = {
      ...this.defaultHeaders,
      ...options.headers,
      Authorization: `Bearer ${token}`,
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    // Handle token expiry
  if (response.status === 401) {
      const refreshedToken = await authManager.forceRefresh();

      if (refreshedToken) {
        // Retry with new token
        const retryHeaders = {
          ...headers,
          Authorization: `Bearer ${refreshedToken}`,
        };

        const retryResponse = await fetch(url, {
          ...options,
          headers: retryHeaders,
        });

        if (!retryResponse.ok) {
          throw new Error(`API request failed: ${retryResponse.status} ${retryResponse.statusText}`);
        }

        return await retryResponse.json();
      } else {
        // Token refresh failed, redirect to login
        throw new Error("Authentication required");
      }
    }

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * GET request
   */
  public async get<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "GET" });
  }

  /**
   * POST request
   */
  public async post<T = any>(
    endpoint: string,
    data?: any,
    options: RequestInit = {}
  ): Promise<T> {
    const body = data ? JSON.stringify(data) : undefined;
    return this.request<T>(endpoint, { ...options, method: "POST", body });
  }

  /**
   * PUT request
   */
  public async put<T = any>(
    endpoint: string,
    data?: any,
    options: RequestInit = {}
  ): Promise<T> {
    const body = data ? JSON.stringify(data) : undefined;
    return this.request<T>(endpoint, { ...options, method: "PUT", body });
  }

  /**
   * DELETE request
   */
  public async delete<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "DELETE" });
  }

  /**
   * Upload file with automatic token management
   */
  public async uploadFile<T = any>(
    endpoint: string,
    formData: FormData,
    options: RequestInit = {}
  ): Promise<T> {
    const authManager = (window as any).authManager;
    if (!authManager) {
      throw new Error('AuthManager not available on window object');
    }
    const token = await authManager.getToken();

    if (!token) {
      throw new Error("No valid authentication token available");
    }

    const url = this.baseUrl + endpoint;
    const headers = {
      ...options.headers,
      Authorization: `Bearer ${token}`,
      // Don't set Content-Type for FormData - let browser set it with boundary
    };

    const response = await fetch(url, {
      ...options,
      method: "POST",
      headers,
      body: formData,
    });

    // Handle token expiry for file uploads
    if (response.status === 401) {
  const refreshedToken = await authManager.forceRefresh();

      if (refreshedToken) {
        const retryHeaders = {
          ...headers,
          Authorization: `Bearer ${refreshedToken}`,
        };

        const retryResponse = await fetch(url, {
          ...options,
          method: "POST",
          headers: retryHeaders,
          body: formData,
        });

        if (!retryResponse.ok) {
          throw new Error(`File upload failed: ${retryResponse.status} ${retryResponse.statusText}`);
        }

        return await retryResponse.json();
      } else {
        throw new Error("Authentication required for file upload");
      }
    }

    if (!response.ok) {
      throw new Error(`File upload failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Non-authenticated request (for login, register, etc.)
   */
  public async publicRequest<T = any>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = this.baseUrl + endpoint;
    const headers = {
      ...this.defaultHeaders,
      ...options.headers,
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Request failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }
}

// Create singleton API client with proper base URL
export const apiClient = new EnhancedApiClient(env.VITE_API_URL);

/**
 * Enhanced API hooks for use in React components
 */

// Legacy login (no authentication required)
export function useLoginUser() {
  return async (email: string, password: string) => {
    try {
      // Normalize email to lowercase for consistency
      const normalizedEmail = email.toLowerCase().trim();
      const authManager = (window as any).authManager;
      if (!authManager) {
        throw new Error('AuthManager not available on window object');
      }
      const result = await authManager.loginLegacy(normalizedEmail, password);
      return {
        status: result.success ? 200 : 401,
        message: result.error || "Login successful",
        access_token: result.success ? "managed_by_auth_manager" : "",
        token_type: "bearer",
      };
    } catch (error: any) {
      return {
        status: 500,
        message: error.message || "Network error during login",
        access_token: "",
        token_type: "",
      };
    }
  };
}

// Registration (no authentication required)
export function useRegisterUser() {
  return async (email: string, password: string) => {
    // Normalize email to lowercase for consistency
    const normalizedEmail = email.toLowerCase().trim();

    return await apiClient.publicRequest("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email: normalizedEmail, password }),
    });
  };
}

// File upload with enhanced token management
export function useUploadFile() {
  return async (
    file: File,
    prompt_category_id: string,
    prompt_subcategory_id: string,
    case_id?: string
  ) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("prompt_category_id", prompt_category_id);
    formData.append("prompt_subcategory_id", prompt_subcategory_id);

    if (case_id) {
      formData.append("case_id", case_id);
    }

    return await apiClient.uploadFile("/upload", formData);
  };
}

// Get prompts/categories
export function useGetPrompts() {
  return async () => {
    return await apiClient.get("/prompts");
  };
}

// Get categories
export function useGetCategories() {
  return async () => {
    return await apiClient.get("/categories");
  };
}

// Get subcategories
export function useGetSubcategories() {
  return async (categoryId: string) => {
    return await apiClient.get(`/categories/${categoryId}/subcategories`);
  };
}

// Get jobs
export function useGetJobs() {
  return async (
    status?: string,
    startDate?: string,
    endDate?: string,
    skip?: number,
    limit?: number
  ) => {
    const params = new URLSearchParams();
    if (status) params.append("status", status);
    if (startDate) params.append("start_date", startDate);
    if (endDate) params.append("end_date", endDate);
    if (skip !== undefined) params.append("skip", skip.toString());
    if (limit !== undefined) params.append("limit", limit.toString());

    const query = params.toString();
    const endpoint = query ? `/jobs?${query}` : "/jobs";

    return await apiClient.get(endpoint);
  };
}

// Get job by ID
export function useGetJob() {
  return async (jobId: string) => {
    return await apiClient.get(`/jobs/${jobId}`);
  };
}

// Get user profile
export function useGetUserProfile() {
  return async () => {
    // Default: do NOT emit login audit from normal profile calls
    return await apiClient.get("/auth/me");
  };
}

// Explicit login audit trigger (call once per session, e.g., on app mount after successful auth)
export function useAuditLoginOnce() {
  return async () => {
    // Server will still dedupe within 12h
    return await apiClient.get("/auth/me?audit_login=true");
  };
}

// Update user profile
export function useUpdateUserProfile() {
  return async (profileData: any) => {
    return await apiClient.put("/auth/me", profileData);
  };
}

// Admin functions
export function useGetUsers() {
  return async (filter?: string, role?: string, skip?: number, limit?: number) => {
    const params = new URLSearchParams();
    if (filter) params.append("filter", filter);
    if (role) params.append("role", role);
    if (skip !== undefined) params.append("skip", skip.toString());
    if (limit !== undefined) params.append("limit", limit.toString());

    const query = params.toString();
    const endpoint = query ? `/auth/admin/users?${query}` : "/auth/admin/users";

    return await apiClient.get(endpoint);
  };
}

// Health and monitoring endpoints
export function useGetAuthHealth() {
  return async () => {
    return await apiClient.get("/auth/health");
  };
}

export function useGetCacheStats() {
  return async () => {
    return await apiClient.get("/auth/cache/stats");
  };
}

/**
 * Legacy compatibility function - maintains backward compatibility
 * @deprecated Use apiClient directly or specific hooks
 */
export function getAccessToken(): () => Promise<string | null> {
  return async () => {
  const authManager = (window as any).authManager;
  if (!authManager) return null;
  return await authManager.getToken();
  };
}

export { EnhancedApiClient };
