import { queryOptions } from "@tanstack/react-query";
import type { CategoryResponse, SubcategoryResponse } from "@/lib/api";

export function getPromptManagementCategoriesQuery() {
  return queryOptions<CategoryResponse[]>({
    queryKey: ["sonic-brief", "prompt-management", "categories"],
    queryFn: async () => {
      // We'll need to handle this properly in the component
    return [] as CategoryResponse[];
    },
  });
}

export function getPromptManagementSubcategoriesQuery() {
  return queryOptions<SubcategoryResponse[]>({
    queryKey: ["sonic-brief", "prompt-management", "subcategories"],
    queryFn: async () => {
      // We'll need to handle this properly in the component
    return [] as SubcategoryResponse[];
    },
  });
}
