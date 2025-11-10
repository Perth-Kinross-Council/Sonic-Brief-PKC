// Unified naming convention utility for all upload functions
// Format: sub_category_case_id_date_time_username.ext

export interface FileNamingOptions {
  subcategory?: string;
  caseId?: string;
  username?: string;
  fileExtension: string;
}

export function generateUnifiedFileName(options: FileNamingOptions): string {
  const {
    subcategory,
    caseId,
    username,
    fileExtension
  } = options;

  // 1. Sub-category (sanitized, or 'Unknown_Service' if not provided)
  const subShort = subcategory
    ? subcategory.replace(/\s+/g, "_").replace(/-/g, "_").replace(/[^a-zA-Z0-9_]/g, "")
    : "Unknown_Service";

  // 2. Case ID (or 'Null_Case_ID' if not entered)
  const caseIdValue = caseId?.trim() || "Null_Case_ID";

  // 3. Date-time in format DDMMYYYY_HHMM
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const dateTime = `${dd}${mm}${yyyy}_${hh}${min}`;

  // 4. Username (extract name before @ if email, remove spaces, dots, and special chars)
  let userShort = "Unknown_User";
  if (username) {
    const emailUsername = username.includes("@") 
      ? username.split("@")[0] 
      : username;
    userShort = emailUsername
      .replace(/\s+/g, "_")
      .replace(/\./g, "")  // Remove dots to avoid file extension issues
      .replace(/-/g, "_")  // Convert hyphens to underscores
      .replace(/[^a-zA-Z0-9_]/g, "");
  }

  // 5. File extension (ensure it starts with a dot)
  const ext = fileExtension.startsWith(".") ? fileExtension.slice(1) : fileExtension;

  // Build unified filename: sub_category_case_id_date_time_username.ext
  return `${subShort}_${caseIdValue}_${dateTime}_${userShort}.${ext}`;
}

// Helper function to extract subcategory name from categories data
export function getSubcategoryName(
  categories: any[] | undefined,
  subcategoryId: string
): string | undefined {
  if (!categories || !subcategoryId) return undefined;
  
  const subcat = categories
    .flatMap((cat) => cat.subcategories)
    .find((sub) => sub.subcategory_id === subcategoryId);
    
  return subcat?.subcategory_name;
}
