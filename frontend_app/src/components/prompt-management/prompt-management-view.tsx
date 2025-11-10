import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useFetchCategories, useFetchSubcategories } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import MDPreview from "@uiw/react-markdown-preview";
import {
  ChevronDown,
  ChevronRight,
  Edit,
  File,
  Folder,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

// Map API response to component types
import type { CategoryResponse, SubcategoryResponse } from "@/lib/api";

import { AddSubcategoryDialog } from "./add-subcategory-dialog";
import { DeleteCategoryDialog } from "./delete-category-dialog";
import { DeleteSubcategoryDialog } from "./delete-subcategory-dialog";
import { EditCategoryDialog } from "./edit-category-dialog";
import { EditSubcategoryDialog } from "./edit-subcategory-dialog";

export function PromptManagementView() {
  const [selectedCategory, setSelectedCategory] = useState<CategoryResponse | null>(null);
  const [selectedSubcategory, setSelectedSubcategory] = useState<SubcategoryResponse | null>(null);

  // Use the hooks from api.ts
  const fetchCategories = useFetchCategories();
  const fetchSubcategories = useFetchSubcategories();

  const { data: categories, isLoading: isCategoriesPending } = useQuery({
    queryKey: ["sonic-brief", "prompt-management", "categories"],
    queryFn: async () => {
      const apiCategories = await fetchCategories();
      // Return API response as-is since types now match
      return apiCategories;
    },
  });

  useEffect(() => {
    /* silent on categories load */
  }, [categories]);

  const { data: subcategories, isLoading: isSubcategoriesPending } = useQuery({
    queryKey: ["sonic-brief", "prompt-management", "subcategories"],
    queryFn: () => fetchSubcategories(),
  });

  const [expandedCategories, setExpandedCategories] = useState<Array<string>>(
    [],
  );

  const [isAddSubcategoryOpen, setIsAddSubcategoryOpen] = useState(false);
  const [isEditCategoryOpen, setIsEditCategoryOpen] = useState(false);
  const [isEditSubcategoryOpen, setIsEditSubcategoryOpen] = useState(false);

  const [isDeleteCategoryOpen, setIsDeleteCategoryOpen] = useState(false);
  const [isDeleteSubcategoryOpen, setIsDeleteSubcategoryOpen] = useState(false);
  const [categoryToDelete, setCategoryToDelete] =
    useState<CategoryResponse | null>(null);
  const [subcategoryToDelete, setSubcategoryToDelete] =
    useState<SubcategoryResponse | null>(null);

  useEffect(() => {
    if (selectedCategory && categories) {
      const updatedCategory = categories.find(
        (c) => c.id === selectedCategory.id,
      );
      setSelectedCategory(updatedCategory || null);
    }
  }, [categories, selectedCategory]);

  useEffect(() => {
    if (selectedSubcategory && subcategories) {
      const updatedSubcategory = subcategories.find(
        (s) => s.id === selectedSubcategory.id,
      );
      setSelectedSubcategory(updatedSubcategory || null);
    }
  }, [subcategories, selectedSubcategory]);

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((prev) => {
      if (prev.includes(categoryId)) {
        return prev.filter((id) => id !== categoryId);
      } else {
        return [...prev, categoryId];
      }
    });
  };

  const handleCategoryClick = (category: CategoryResponse) => {
    const categoryId = category.id || "";
    const isExpanded = expandedCategories.includes(categoryId);

    if (isExpanded) {
      // Collapse: toggle off and clear selection if it was the active category
      toggleCategory(categoryId);
      if (selectedCategory?.id === categoryId) {
        setSelectedCategory(null);
        // Clear any subcategory selection that belongs to this category
        if (selectedSubcategory && selectedSubcategory.category_id === categoryId) {
          setSelectedSubcategory(null);
        }
      }
    } else {
      // Expand: toggle on and set as active
      toggleCategory(categoryId);
      setSelectedCategory(category);
      setSelectedSubcategory(null);
    }
  };

  const handleSubcategoryClick = (subcategory: SubcategoryResponse) => {
    setSelectedSubcategory(subcategory);
  };

  const openEditCategory = (category: CategoryResponse) => {
    setSelectedCategory(category);
    setIsEditCategoryOpen(true);
  };

  const openEditSubcategory = (subcategory: SubcategoryResponse) => {
    if (!subcategory || !subcategory.id) {
      toast.error("Error", {
        description: "Cannot edit subcategory: Invalid data",
      });
      return;
    }

    // Set the selected subcategory first
    setSelectedSubcategory(subcategory);

    // Finally open the dialog
    setIsEditSubcategoryOpen(true);
  };

  return (
    <>
      <div className="grid-cols-[1fr_2fr] gap-3 lg:grid">
        {isCategoriesPending || isSubcategoriesPending ? (
          <CategoryListSkeleton />
        ) : !categories || categories.length === 0 ? (
          <Alert>
            <AlertTitle>No Categories</AlertTitle>
            <AlertDescription>
              No categories found. Please add a category to get started.
            </AlertDescription>
          </Alert>
        ) : (
          <Card>
            <CardContent className="min-h-[calc(100vh-200px)] p-4">
              {categories?.map((category) => (
                <div key={category.id} className="mb-2">
                  <div className="flex items-center justify-between">
                    <Button
                      variant="ghost"
                      className="justify-start p-2"
                      onClick={() => handleCategoryClick(category)}
                    >
                      {expandedCategories.includes(category.id) ? (
                        <ChevronDown className="me-2 h-4 w-4" />
                      ) : (
                        <ChevronRight className="me-2 h-4 w-4" />
                      )}
                      <Folder className="mr-2 h-4 w-4" />
                      <h3 className="max-w-[150px] truncate">
                        {category.name}
                      </h3>
                    </Button>
                    <div className="flex">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditCategory(category);
                        }}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCategoryToDelete(category);
                          setIsDeleteCategoryOpen(true);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {expandedCategories.includes(category.id) && (
                    <div className="mt-2 ml-6">
                      {subcategories
                        ?.filter((sub) => sub.category_id === category.id)
                        .map((subcategory) => (
                          <div
                            key={subcategory.id}
                            className="flex items-center justify-between"
                          >
                            <Button
                              variant={
                                selectedSubcategory?.id === subcategory.id
                                  ? "secondary"
                                  : "ghost"
                              }
                              className="justify-start p-2"
                              onClick={() =>
                                handleSubcategoryClick(subcategory)
                              }
                            >
                              <File className="me-2 h-4 w-4" />
                              <h3 className="max-w-[150px] truncate">
                                {subcategory.name}
                              </h3>
                            </Button>
                            <div className="flex">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openEditSubcategory(subcategory)}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSubcategoryToDelete(subcategory);
                                  setIsDeleteSubcategoryOpen(true);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      <Button
                        variant="ghost"
                        className="w-full justify-start p-2"
                        onClick={() => {
                        setSelectedCategory(category); // Removed commented debug logs
                        setIsAddSubcategoryOpen(true);
                      }}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add Subcategory
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-6">
            {selectedSubcategory ? (
              <div className="space-y-6">
                <div
                  key="subcategory-header"
                  className="flex items-center justify-between"
                >
                  <h2 className="text-2xl font-bold">
                    {selectedSubcategory.name}
                  </h2>
                  <div className="flex space-x-2">
                    <Button
                      variant="outline"
                      onClick={() => openEditSubcategory(selectedSubcategory)}
                    >
                      <Edit className="mr-2 h-4 w-4" />
                      Edit Subcategory
                    </Button>
                  </div>
                </div>

                <Separator key="subcategory-separator" />

                <div key="prompts-section" className="space-y-4">
                  <h3 className="text-xl font-semibold">Prompts</h3>
                  {Object.entries(selectedSubcategory.prompts).map(
                    ([key, value]) => (
                      <Card key={key} className="overflow-hidden">
                        <CardContent className="p-0">
                          <div className="bg-muted border-b p-3 font-medium">
                            {key}
                          </div>
                          <div className="p-4">
                            <MDPreview source={typeof value === "string" ? value : ""} />
                          </div>
                        </CardContent>
                      </Card>
                    ),
                  )}
                </div>
              </div>
            ) : selectedCategory ? (
              <div className="space-y-6">
                <div
                  key="category-header"
                  className="flex flex-wrap justify-between gap-2"
                >
                  <h2 className="max-w-[300px] text-2xl font-bold break-words">
                    {selectedCategory.name}
                  </h2>
                  <div className="flex space-x-2">
                    <Button
                      variant="outline"
                      onClick={(e) => {
                        // Make sure the event doesn't propagate up to parent elements
                        e.stopPropagation();
                        if (selectedCategory) {
                          openEditCategory(selectedCategory);
                        } else {
                          toast.error("No category selected for editing");
                        }
                      }}
                    >
                      <Edit className="mr-2 h-4 w-4" />
                      Edit Category
                    </Button>
                    <Button
                    onClick={() => {
                      setIsAddSubcategoryOpen(true); // Removed commented debug logs
                    }}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add Subcategory
                    </Button>
                  </div>
                </div>

                <Separator key="category-separator" />

                <div key="subcategories-section" className="space-y-4">
                  <h3 className="text-xl font-semibold">Subcategories</h3>
                  {subcategories
                    ?.filter((sub) => sub.category_id === selectedCategory.id)
                    .map((subcategory) => (
                      <Button
                        key={subcategory.id}
                        variant="outline"
                        className="h-auto w-full justify-start py-3 text-left"
                        onClick={() => handleSubcategoryClick(subcategory)}
                      >
                        <div>
                          <div className="font-medium">{subcategory.name}</div>
                          <div className="text-muted-foreground text-sm">
                            {Object.keys(subcategory.prompts).length} prompts
                          </div>
                        </div>
                      </Button>
                    ))}

                  {subcategories?.filter(
                    (sub) => sub.category_id === selectedCategory.id,
                  ).length === 0 && (
                    <Alert key="no-subcategories-alert">
                      <AlertTitle>No subcategories</AlertTitle>
                      <AlertDescription>
                        This category doesn't have any subcategories yet. Click
                        the "Add Subcategory" button to create one.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </div>
            ) : (
              <Alert>
                <AlertTitle>No Selection</AlertTitle>
                <AlertDescription>
                  Please select a category or subcategory from the sidebar to
                  view details.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add Subcategory Dialog */}
      <AddSubcategoryDialog
        isOpen={isAddSubcategoryOpen}
        onOpenChange={setIsAddSubcategoryOpen}
        categories={categories || []}
        selectedCategoryId={selectedCategory?.id || null}
      />

      {/* Edit Category Dialog */}
      <EditCategoryDialog
        isOpen={isEditCategoryOpen}
        onOpenChange={setIsEditCategoryOpen}
        category={selectedCategory}
      />

      {/* Delete Category Confirmation Dialog */}
      <DeleteCategoryDialog
        isOpen={isDeleteCategoryOpen}
        onOpenChange={setIsDeleteCategoryOpen}
        category={categoryToDelete}
      />

      {/* Edit Subcategory Dialog */}
      <EditSubcategoryDialog
        isOpen={isEditSubcategoryOpen}
        onOpenChange={setIsEditSubcategoryOpen}
        subcategory={selectedSubcategory}
      />

      {/* Delete Subcategory Confirmation Dialog  */}
      <DeleteSubcategoryDialog
        isOpen={isDeleteSubcategoryOpen}
        onOpenChange={setIsDeleteSubcategoryOpen}
        subcategory={subcategoryToDelete}
      />
    </>
  );
}

const PLACEHOLDER_ARR = Array.from({ length: 5 }, (_, i) => i);

function CategoryListSkeleton() {
  return (
    <Card className="h-[calc(100vh-200px)] space-y-3 lg:w-xs">
      <CardContent className="p-4">
        {PLACEHOLDER_ARR.map((_, i) => (
          <div key={i} className="mb-3 flex items-center justify-between gap-3">
            <div className="items-cente flex space-x-2">
              <Skeleton className="h-4 w-4" /> {/* Icon placeholder */}
              <Skeleton className="h-4 w-4" /> {/* Icon placeholder */}
              <Skeleton className="h-5 w-24" /> {/* Name placeholder */}
            </div>
            <div className="flex gap-3 space-x-1">
              <Skeleton className="size-6" /> {/* Button placeholder */}
              <Skeleton className="size-6" /> {/* Button placeholder */}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
