import { createContext, useCallback, useContext, useEffect, useState } from "react"
import type React from "react"
import {
  useCreateCategory,
  useCreateSubcategory,
  useDeleteCategory,
  useDeleteSubcategory,
  useFetchCategories,
  useFetchSubcategories,
  useUpdateCategory,
  useUpdateSubcategory,
} from "@/lib/api"

export interface Category {
  category_id: string
  id?: string
  name: string
  created_at?: string
  updated_at?: string
}

export interface Subcategory {
  id: string
  name: string
  category_id: string
  prompts: Record<string, string>
  created_at: number
  updated_at: number
}

interface PromptManagementContextType {
  categories: Array<Category>
  subcategories: Array<Subcategory>
  selectedCategory: Category | null
  selectedSubcategory: Subcategory | null
  loading: boolean
  error: string | null
  refreshData: () => Promise<void>
  setSelectedCategory: (category: Category | null) => void
  setSelectedSubcategory: (subcategory: Subcategory | null) => void
  addCategory: (name: string) => Promise<void>
  addSubcategory: (name: string, categoryId: string, prompts: Record<string, string>) => Promise<void>
  editCategory: (categoryId: string, name: string) => Promise<void>
  editSubcategory: (subcategoryId: string, name: string, prompts: Record<string, string>) => Promise<void>
  removeCategory: (categoryId: string) => Promise<void>
  removeSubcategory: (subcategoryId: string) => Promise<void>
}

const PromptManagementContext = createContext<PromptManagementContextType | undefined>(undefined)

export function PromptManagementProvider({ children }: { children: React.ReactNode }) {
  const [categories, setCategories] = useState<Array<Category>>([])
  const [subcategories, setSubcategories] = useState<Array<Subcategory>>([])
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)
  const [selectedSubcategory, setSelectedSubcategory] = useState<Subcategory | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchCategories = useFetchCategories();
  const fetchSubcategories = useFetchSubcategories();
  const createSubcategory = useCreateSubcategory();
  const updateCategory = useUpdateCategory();
  const updateSubcategory = useUpdateSubcategory();
  const deleteCategory = useDeleteCategory();
  const deleteSubcategory = useDeleteSubcategory();

  const refreshData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const categoriesData = await fetchCategories();
      // Map API CategoryResponse -> local Category shape
      const mapped = (categoriesData || []).map((cat: any) => ({
        category_id: cat.id,
        id: cat.id,
        name: cat.name,
        created_at: cat.created_at,
        updated_at: cat.updated_at,
      }));
      setCategories(mapped)
      if (selectedCategory) {
        const subcategoriesData = await fetchSubcategories(selectedCategory.category_id);
        setSubcategories(subcategoriesData)
      } else {
        const allSubcategories = await fetchSubcategories();
        setSubcategories(allSubcategories)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred while fetching data")
      console.error("Error fetching data:", err)
    } finally {
      setLoading(false)
    }
  }, [selectedCategory, fetchCategories, fetchSubcategories])

  useEffect(() => {
    refreshData()
  }, [refreshData])

  const addCategoryRaw = useCreateCategory();
  const addCategory = useCallback(async (name: string) => {
    try {
      const result = await addCategoryRaw(name);
      if (!result || !result.id || !result.name) {
        throw new Error("Category creation returned invalid data");
      }
      // Ensure the new category conforms to local Category shape
      const newCategory = {
        category_id: result.id,
        id: result.id,
        name: result.name,
        created_at: result.created_at,
        updated_at: result.updated_at,
      };
      setCategories((prev) => [...prev, newCategory]);
      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred while creating category");
      console.error("Error creating category:", err);
      throw err;
    }
  }, [addCategoryRaw, refreshData])

  const addSubcategory = useCallback(
    async (name: string, categoryId: string, prompts: Record<string, string>) => {
      setLoading(true)
      setError(null)
      try {
        await createSubcategory(name, categoryId, prompts)
        await refreshData()
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred while creating subcategory")
        console.error("Error creating subcategory:", err)
        throw err
      } finally {
        setLoading(false)
      }
    },
    [refreshData, createSubcategory],
  )

  const editCategory = useCallback(
    async (categoryId: string, name: string) => {
      setLoading(true)
      setError(null)
      try {
        await updateCategory(categoryId, name)
        await refreshData()
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred while updating category")
        console.error("Error updating category:", err)
        throw err
      } finally {
        setLoading(false)
      }
    },
    [refreshData, updateCategory],
  )

  const editSubcategory = useCallback(
    async (subcategoryId: string, name: string, prompts: Record<string, string>) => {
      setLoading(true)
      setError(null)
      try {
        await updateSubcategory(subcategoryId, name, prompts)
        await refreshData()
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred while updating subcategory")
        console.error("Error updating subcategory:", err)
        throw err
      } finally {
        setLoading(false)
      }
    },
    [refreshData, updateSubcategory],
  )

  const removeCategory = useCallback(
    async (categoryId: string) => {
      setLoading(true)
      setError(null)
      try {
        await deleteCategory(categoryId)
        if (selectedCategory?.category_id === categoryId) {
          setSelectedCategory(null)
        }
        await refreshData()
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred while deleting category")
        console.error("Error deleting category:", err)
        throw err
      } finally {
        setLoading(false)
      }
    },
    [refreshData, selectedCategory, deleteCategory],
  )

  const removeSubcategory = useCallback(
    async (subcategoryId: string) => {
      setLoading(true)
      setError(null)
      try {
        await deleteSubcategory(subcategoryId)
        if (selectedSubcategory?.id === subcategoryId) {
          setSelectedSubcategory(null)
        }
        await refreshData()
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred while deleting subcategory")
        console.error("Error deleting subcategory:", err)
        throw err
      } finally {
        setLoading(false)
      }
    },
    [refreshData, selectedSubcategory, deleteSubcategory],
  )

  return (
    <PromptManagementContext.Provider
      value={{
        categories,
        subcategories,
        selectedCategory,
        selectedSubcategory,
        loading,
        error,
        refreshData,
        setSelectedCategory,
        setSelectedSubcategory,
        addCategory,
        addSubcategory,
        editCategory,
        editSubcategory,
        removeCategory,
        removeSubcategory,
      }}
    >
      {children}
    </PromptManagementContext.Provider>
  )
}

export function usePromptManagement() {
  const context = useContext(PromptManagementContext)
  if (context === undefined) {
    throw new Error("usePromptManagement must be used within a PromptManagementProvider")
  }
  return context
}

