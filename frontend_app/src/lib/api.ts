import {
  CATEGORIES_API,
  LOGIN_API,
  PROMPTS_API,
  REGISTER_API,
  SUBCATEGORIES_API,
  UPLOAD_API,
  JOBS_API,
} from "../lib/apiConstants";

import { useEnhancedUnifiedAuth } from "./useEnhancedUnifiedAuth";

// Tiny fetch helper to standardize GET JSON with headers and error surface
export async function fetchJsonStrict(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  // Be tolerant of whitespace-only bodies (e.g., 204 No Content with stray whitespace)
  const data = text && text.trim() ? JSON.parse(text) : null;
  if (!res.ok) {
    // Preserve existing error semantics and attach useful metadata
    const message = (data && (data.message || data.error)) || `HTTP error! status: ${res.status}`;
    const err: any = new Error(message);
    err.status = res.status;
    err.statusText = res.statusText;
    err.body = text;
    throw err;
  }
  return data;
}

interface RegisterResponse {
  status: number
  message: string
}

interface LoginResponse {
  status: number
  message: string
  access_token: string
  token_type: string
}

interface UploadResponse {
  job_id?: string
  status: number | string
  message: string
}

interface Prompt {
  [key: string]: string
}

interface Subcategory {
  subcategory_name: string
  subcategory_id: string
  prompts: Prompt
}

interface Category {
  category_name: string
  category_id: string
  subcategories: Array<Subcategory>
}

interface PromptsResponse {
  status: number
  data: Array<Category>
}

export interface CategoryResponse {
  id: string
  name: string
  created_at: string
  updated_at: string
}

export interface SubcategoryResponse {
  id: string
  name: string
  category_id: string
  prompts: Prompt
  created_at: number
  updated_at: number
}


// Unified token getter using useEnhancedUnifiedAuth (reference parity)
export function useUnifiedAccessToken() {
  const { getToken, isAuthenticated, isLoading } = useEnhancedUnifiedAuth();
  return async () => {
    // For React Query, we need to be more patient with auth state
    // If auth is loading, wait for it to stabilize
  if (isLoading) {
      let attempts = 0;
      const maxAttempts = 30; // 3 seconds total (100ms * 30)

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;

        // Check if we can get a token without relying on the hook state
        try {
          const token = await getToken();
          if (token) {
            return token;
          }
        } catch (error) {
          // Continue waiting if it's still an auth loading error
          if (error instanceof Error && error.message.includes('Authentication is still loading')) {
            continue;
          } else {
            // Different error, break out
            break;
          }
        }
      }
    }

    // Normal token acquisition
    try {
      const token = await getToken();
      if (!token) {
        throw new Error("No valid access token found. Please log in again.");
      }
      return token;
    } catch (error: any) {
  // Enhanced error handling for React Query

      if (!isAuthenticated) {
        throw new Error("User is not authenticated");
      }

      // If it's an auth loading error during React Query retries, make it more specific
      if (error.message.includes('Authentication is still loading')) {
        throw new Error("Authentication temporarily unavailable - retrying...");
      }

      throw error;
    }
  };
}

export function useRegisterUser() {
  return async (email: string, password: string): Promise<RegisterResponse> => {
    // Normalize email to lowercase for consistency
    const normalizedEmail = email.toLowerCase().trim();

    const response = await fetch(REGISTER_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: normalizedEmail, password }),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  };
}

export function useLoginUser() {
  return async (email: string, password: string): Promise<LoginResponse> => {
    // Normalize email to lowercase for consistency
    const normalizedEmail = email.toLowerCase().trim();

    const response = await fetch(LOGIN_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: normalizedEmail, password }),
    });
    const data: LoginResponse = await response.json();
    if (!response.ok) {
      return {
        status: response.status,
        message: data.message || "An error occurred during login",
        access_token: "",
        token_type: "",
      };
    }
    return data;
  };
}

export function useUploadFile() {
  const getToken = useUnifiedAccessToken();
  return async (
    file: File,
    prompt_category_id: string,
    prompt_subcategory_id: string,
    case_id?: string,
    options?: { recorded?: boolean },
  ): Promise<UploadResponse> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("prompt_category_id", prompt_category_id);
    formData.append("prompt_subcategory_id", prompt_subcategory_id);
    if (case_id) {
      formData.append("case_id", case_id);
    }
    if (options?.recorded) {
      formData.append("recorded", "true");
    }

    const token = await getToken();
    const response = await fetch(UPLOAD_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });
    const data: UploadResponse = await response.json();
    if (!response.ok) {
      throw new Error(data.message || `HTTP error! status: ${response.status}`);
    }
    return data;
  };
}

export function useFetchPrompts() {
  const getToken = useUnifiedAccessToken();
  return async (): Promise<PromptsResponse> => {
    const token = await getToken();
    return await fetchJsonStrict(PROMPTS_API, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
  };
}

// New functions for category management
export function useCreateCategory() {
  const getToken = useUnifiedAccessToken();
  return async (name: string): Promise<CategoryResponse> => {
    const token = await getToken();
    const response = await fetch(CATEGORIES_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  };
}

export function useFetchCategories() {
  const getToken = useUnifiedAccessToken();
  return async (): Promise<Array<CategoryResponse>> => {
    const token = await getToken();
    return await fetchJsonStrict(CATEGORIES_API, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
  };
}

export function useUpdateCategory() {
  const getToken = useUnifiedAccessToken();
  return async (categoryId: string, name: string): Promise<CategoryResponse> => {
    if (!categoryId) {
      console.error("Category ID is undefined or empty");
      throw new Error("Invalid category ID. Cannot update category.");
    }
  const token = await getToken();
    const response = await fetch(`${CATEGORIES_API}/${categoryId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      if (response.status === 401) {

        localStorage.removeItem("token"); // Clear invalid token
        throw new Error("Authentication failed. Please log in again.");
      }
      const errorText = await response.text();

      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }
    return await response.json();
  };
}

export function useDeleteCategory() {
  const getToken = useUnifiedAccessToken();
  return async (categoryId: string): Promise<void> => {
    const token = await getToken();
    const response = await fetch(`${CATEGORIES_API}/${categoryId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
  };
}

// Functions for subcategory management
export function useCreateSubcategory() {
  const getToken = useUnifiedAccessToken();
  return async (
    name: string,
    categoryId: string,
    prompts: Record<string, string>,
  ): Promise<SubcategoryResponse> => {
    const token = await getToken();
    const response = await fetch(SUBCATEGORIES_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        category_id: categoryId,
        prompts,
      }),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  };
}

export function useFetchSubcategories() {
  const getToken = useUnifiedAccessToken();
  return async (categoryId?: string): Promise<Array<SubcategoryResponse>> => {
    const token = await getToken();
    const url = categoryId ? `${SUBCATEGORIES_API}?category_id=${categoryId}` : SUBCATEGORIES_API;
    const data = await fetchJsonStrict(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    return data as Array<SubcategoryResponse>;
  };
}

export function useUpdateSubcategory() {
  const getToken = useUnifiedAccessToken();
  return async (
    subcategoryId: string,
    name: string,
    prompts: Record<string, string>,
  ): Promise<SubcategoryResponse> => {
    const token = await getToken();
    if (!subcategoryId) {
      console.error("Subcategory ID is undefined or empty");
      throw new Error("Invalid subcategory ID. Cannot update subcategory.");
    }

    try {
      const response = await fetch(`${SUBCATEGORIES_API}/${subcategoryId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          prompts,
        }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          console.error("Authentication failed (401). Token may be invalid or expired.");
          localStorage.removeItem("token"); // Clear invalid token
          throw new Error("Authentication failed. Please log in again.");
        }
        if (response.status === 404) {
          console.error("Subcategory not found (404).");
          throw new Error("Subcategory not found. It may have been already deleted.");
        }
        const errorText = await response.text();

        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }
      const data = await response.json();

      return data;
    } catch (error) {
      console.error("Error updating subcategory:", error);
      throw error;
    }
  };
}

export function useDeleteSubcategory() {
  const getToken = useUnifiedAccessToken();
  return async (subcategoryId: string): Promise<void> => {
    const token = await getToken();
    if (!subcategoryId || typeof subcategoryId !== "string") {
      console.error("Invalid subcategory ID:", subcategoryId);
      throw new Error("Invalid subcategory ID. Cannot delete subcategory.");
    }

    try {
      const response = await fetch(`${SUBCATEGORIES_API}/${subcategoryId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          console.error("Authentication failed (401). Token may be invalid or expired.");
          localStorage.removeItem("token"); // Clear invalid token
          throw new Error("Authentication failed. Please log in again.");
        }
        if (response.status === 404) {
          console.error("Subcategory not found (404).");
          throw new Error("Subcategory not found. It may have been already deleted.");
        }
        const errorText = await response.text();

        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }
    } catch (error) {
      console.error("Error deleting subcategory:", error);
      throw error;
    }
  };
}

// Jobs/Audio Recordings API functions
export interface AudioRecording {
  id: string;
  user_id: string;
  case_id?: string;
  file_name?: string;
  file_path: string;
  transcription_file_path: string | null;
  analysis_file_path: string | null;
  analysis_text?: string;
  prompt_category_id: string;
  prompt_subcategory_id: string;
  status: "uploaded" | "processing" | "completed" | "failed" | "transcribing" | "transcribed";
  transcription_id: string | null;
  created_at: number | string;
  updated_at: number | string;
  type: string;
  _rid?: string;
  _self?: string;
  _etag?: string;
  _attachments?: string;
  _ts?: number;
}

export interface AudioListFilters {
  job_id?: string;
  case_id?: string;
  status?: string;
  created_at?: string;
  prompt_category_id?: string;
  prompt_subcategory_id?: string;
}

export interface JobsResponse {
  jobs: AudioRecording[];
  message?: string;
}

export function useFetchJobs() {
  const getToken = useUnifiedAccessToken();
  return async (filters?: AudioListFilters): Promise<AudioRecording[]> => {
    const token = await getToken();
    // Build query parameters
    const params = new URLSearchParams();
    if (filters?.job_id) params.append('job_id', filters.job_id);
    if (filters?.case_id) params.append('case_id', filters.case_id);
    if (filters?.status && filters.status !== 'all') params.append('status', filters.status);
    if (filters?.created_at) params.append('created_at', filters.created_at);
    if (filters?.prompt_category_id) params.append('prompt_category_id', filters.prompt_category_id);
    if (filters?.prompt_subcategory_id) params.append('prompt_subcategory_id', filters.prompt_subcategory_id);
    const url = params.toString() ? `${JOBS_API}?${params.toString()}` : JOBS_API;
    const data = await fetchJsonStrict(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    const parsed = data as JobsResponse;
    return parsed.jobs || [];
  };
}

export function useFetchJobTranscription() {
  const getToken = useUnifiedAccessToken();
  return async (jobId: string): Promise<string> => {
    const token = await getToken();
    const response = await fetch(`${JOBS_API}/transcription/${jobId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.text();
  };
}

// Fire-and-forget: log that a job details view occurred
// Deprecated: use GET /upload/jobs?job_id=...&view=true instead (server logs audit). Kept for reference in git history.

