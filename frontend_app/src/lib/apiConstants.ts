// Environment note: VITE_API_URL is read via the centralized apiUrl helper.
import { apiUrl } from "./apiUrl";

export const REGISTER_API = apiUrl('/auth/register');
// NOTE (lite-refactor): Current backend exposes POST /upload/upload (historic path).
// A cleaner alias POST /upload will be added server-side; once live we'll switch
// this constant to '/upload' and deprecate the double segment. Keep as-is now to avoid behavior change.
export const UPLOAD_API = apiUrl('/upload/upload');
export const JOBS_API = apiUrl('/upload/jobs');
export const LOGIN_API = apiUrl('/auth/login');
export const CATEGORIES_API = apiUrl('/prompts/categories');
export const SUBCATEGORIES_API = apiUrl('/prompts/subcategories');
export const PROMPTS_API = apiUrl('/prompts/retrieve_prompts');
export const TRANSCRIPTION_API = apiUrl('/upload/jobs/transcription');
export const HEALTH_API = apiUrl('/health');
