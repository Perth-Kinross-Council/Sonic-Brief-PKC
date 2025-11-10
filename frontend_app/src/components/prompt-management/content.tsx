import { useState, useEffect } from "react";
import MDPreview from "@uiw/react-markdown-preview";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Edit,
  File,
  Folder,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { MarkdownEditor } from "./markdown-editor";
import { usePromptManagement } from "./prompt-management-context";
import { SubcategoryForm } from "./subcategory-form";
import type { Category, Subcategory } from "./prompt-management-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { notifyError, notifySuccess } from '@/lib/notify';


export function PromptManagementContent() {
  const {
    categories,
    subcategories,
    selectedCategory,
    selectedSubcategory,
    loading,
    error,
    setSelectedCategory,
    setSelectedSubcategory,
    editCategory,
    editSubcategory,
    removeCategory,
    removeSubcategory,
    refreshData,
  } = usePromptManagement();

  const [expandedCategories, setExpandedCategories] = useState<Array<string>>([]);
  const [isAddSubcategoryOpen, setIsAddSubcategoryOpen] = useState(false);
  const [isEditCategoryOpen, setIsEditCategoryOpen] = useState(false);
  const [isEditSubcategoryOpen, setIsEditSubcategoryOpen] = useState(false);
  const [editCategoryName, setEditCategoryName] = useState("");
  const [editSubcategoryName, setEditSubcategoryName] = useState("");
  const [editPrompts, setEditPrompts] = useState<Record<string, string>>({});
  const [isDeleteCategoryOpen, setIsDeleteCategoryOpen] = useState(false);
  const [isDeleteSubcategoryOpen, setIsDeleteSubcategoryOpen] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(
    null,
  );
  const [subcategoryToDelete, setSubcategoryToDelete] =
    useState<Subcategory | null>(null);

  // Ensure body scroll is restored after all dialogs close (workaround for lingering scroll lock)
  const anyDialogOpen =
    isAddSubcategoryOpen ||
    isEditCategoryOpen ||
    isEditSubcategoryOpen ||
    isDeleteCategoryOpen ||
    isDeleteSubcategoryOpen;

  useEffect(() => {
    if (!anyDialogOpen) {
      // Defer to next frame so Radix unmount cleanup runs first
      requestAnimationFrame(() => {
        const body = document.body;
        if (body.getAttribute("data-scroll-locked") !== null) {
          body.removeAttribute("data-scroll-locked");
        }
        // Only reset if lingering
        if (body.style.overflow === "hidden") {
          body.style.overflow = ""; // allow default / stylesheet to apply
        }
        if (body.style.paddingRight) {
          body.style.removeProperty("padding-right");
        }
      });
    }
  }, [anyDialogOpen]);

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((prev) => prev.includes(categoryId)
      ? prev.filter((id) => id !== categoryId)
      : [...prev, categoryId]);
  };

  const handleCategoryClick = (category: Category) => {
    setSelectedCategory(category);
    setSelectedSubcategory(null);
    // Get the actual category ID with fallback
    const categoryId = category.category_id || category.id || "";
    if (!expandedCategories.includes(categoryId)) {
      toggleCategory(categoryId);
    }
  };

  const handleSubcategoryClick = (subcategory: Subcategory) => {
    setSelectedSubcategory(subcategory);
  };

  const handleEditCategory = async () => {
    if (!selectedCategory) {
  notifyError('No category selected for editing');
      return;
    }

    try {
      const categoryId = selectedCategory.category_id || selectedCategory.id;
      if (!categoryId) throw new Error("Category ID is undefined");

      await editCategory(categoryId, editCategoryName);
      // Update local selectedCategory name
      setSelectedCategory({
        ...selectedCategory,
        category_id: selectedCategory.category_id || categoryId,
        name: editCategoryName,
      });

  notifySuccess('Category updated successfully');
      setIsEditCategoryOpen(false);
  } catch (e) {
  notifyError(e, 'Failed to update category');
    }
  };

  const handleEditSubcategory = async () => {
	if (!selectedSubcategory) {
  notifyError('No subcategory selected for editing');
      return;
    }

    try {
      const subcategoryId = selectedSubcategory.id;
      if (!subcategoryId) {
        throw new Error("Invalid subcategory ID");
      }

  // Removed commented debug logging: updating subcategory details

      await editSubcategory(subcategoryId, editSubcategoryName, editPrompts);
      // Refresh the data after updating the subcategory
      await refreshData();

  notifySuccess('Subcategory updated successfully');
      setIsEditSubcategoryOpen(false);
  } catch (e) {
  notifyError(e, 'Failed to update subcategory');
    }
  };

  const handleDeleteCategory = async () => {
    if (!categoryToDelete) return;

    try {
      const categoryId =
        categoryToDelete.category_id || categoryToDelete.id || "";
      await removeCategory(categoryId);
  notifySuccess('Category deleted successfully');
      setIsDeleteCategoryOpen(false);
      setCategoryToDelete(null);
    } catch (e) {
  notifyError(e, 'Failed to delete category');
    }
  };

  const handleDeleteSubcategory = async () => {
	if (!subcategoryToDelete || !subcategoryToDelete.id) {
  notifyError('Cannot delete subcategory: Invalid subcategory data');
      return;
    }

    try {
      // Removed commented debug logging: attempting subcategory deletion
      await removeSubcategory(subcategoryToDelete.id);
      // Refresh the data after deleting the subcategory
      await refreshData();

      // Clear selected subcategory if it was the one that was deleted
      if (selectedSubcategory?.id === subcategoryToDelete.id) {
        setSelectedSubcategory(null);
      }

  notifySuccess('Subcategory deleted successfully');
      setIsDeleteSubcategoryOpen(false);
      setSubcategoryToDelete(null);
  } catch (e) {
      const errorMessage =
    e instanceof Error ? e.message : "Failed to delete subcategory";
  // Removed commented debug error logging for delete subcategory

      // Show more specific error messages
      if (errorMessage.includes("404")) {
        notifyError('Subcategory not found. It may have been already deleted.');
        // Close the dialog and clear the selection since the subcategory doesn't exist
        setIsDeleteSubcategoryOpen(false);
        setSubcategoryToDelete(null);
        if (selectedSubcategory?.id === subcategoryToDelete.id) {
          setSelectedSubcategory(null);
        }
      } else if (errorMessage.includes("401")) {
        notifyError('Your session has expired. Please log in again.');
      } else {
        notifyError(errorMessage);
      }
    }
  };

  const openEditCategory = (category: Category) => {
  // Removed commented debug logging: openEditCategory invoked

    // Check for either category_id or id property
    const categoryId = category.category_id || category.id;

	if (!category || !categoryId) {
  notifyError('Could not edit category: missing or invalid data');
      return;
    }

    try {
      // Create a normalized category object
      const normalizedCategory = {
        ...category,
        category_id: categoryId,
      };

      // First set the data
      setSelectedCategory(normalizedCategory);
      setEditCategoryName(category.name);

  // Removed commented debug logging: category ID & name prior to dialog open

      // Then open the dialog with a small delay to ensure state is updated
    setTimeout(() => {
        setIsEditCategoryOpen(true);
      }, 10);
	} catch (e) {
  notifyError(e, 'Something went wrong while trying to edit the category');
    }
  };

  const openEditSubcategory = (subcategory: Subcategory) => {
  // Removed commented debug logging: openEditSubcategory invoked

	if (!subcategory || !subcategory.id) {
  notifyError('Cannot edit subcategory: Invalid data');
      return;
    }

    // Set the selected subcategory first
    setSelectedSubcategory(subcategory);

    // Then set the form data
    setEditSubcategoryName(subcategory.name);
    setEditPrompts(subcategory.prompts);

    // Finally open the dialog
    setIsEditSubcategoryOpen(true);
  };

  return (
    <div className="grid grid-cols-12 gap-6">
      <Card className="col-span-3">
        <CardContent className="p-4">
          {loading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}

          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <ScrollArea className="h-[calc(100vh-200px)]">
            {categories.map((category) => (
              <div
                key={category.category_id || category.id || ""}
                className="mb-2"
              >
                <div className="flex items-center justify-between">
                  <Button
                    variant="ghost"
                    className="w-full justify-start p-2"
                    onClick={() => handleCategoryClick(category)}
                  >
                    {expandedCategories.includes(
                      category.category_id || category.id || "",
                    ) ? (
                      <ChevronDown className="mr-2 h-4 w-4" />
                    ) : (
                      <ChevronRight className="mr-2 h-4 w-4" />
                    )}
                    <Folder className="mr-2 h-4 w-4" />
                    {category.name}
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
                {expandedCategories.includes(
                  category.category_id || category.id || "",
                ) && (
                  <div className="mt-2 ml-6">
                    {subcategories
                      .filter(
                        (sub) =>
                          sub.category_id ===
                          (category.category_id || category.id || ""),
                      )
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
                            className="w-full justify-start p-2"
                            onClick={() => handleSubcategoryClick(subcategory)}
                          >
                            <File className="mr-2 h-4 w-4" />
                            {subcategory.name}
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
                        const normalizedCategory = {
                          ...category,
                          category_id:
                            category.category_id || category.id || "",
                        };
                        setSelectedCategory(normalizedCategory);
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
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="col-span-9">
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
                          <MDPreview source={value} />
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
                className="flex items-center justify-between"
              >
                <h2 className="text-2xl font-bold">{selectedCategory.name}</h2>
                <div className="flex space-x-2">
                  <Button
                    variant="outline"
                    onClick={(e) => {
                      // Make sure the event doesn't propagate up to parent elements
                      e.stopPropagation();
                      // Removed commented debug logging: edit button clicked
                      if (selectedCategory) {
                        openEditCategory(selectedCategory);
                      } else {
                        // Removed commented debug error: no category selected
                      }
                    }}
                  >
                    <Edit className="mr-2 h-4 w-4" />
                    Edit Category
                  </Button>
                  <Button
                    onClick={() => {
                      if (selectedCategory) {
                        const normalizedCategory = {
                          ...selectedCategory,
                          category_id:
                            selectedCategory.category_id ||
                            selectedCategory.id ||
                            "",
                        };
                        setSelectedCategory(normalizedCategory);
                      }
                      setIsAddSubcategoryOpen(true);
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
                  .filter(
                    (sub) =>
                      sub.category_id ===
                      (selectedCategory.category_id ||
                        selectedCategory.id ||
                        ""),
                  )
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

                {subcategories.filter(
                  (sub) =>
                    sub.category_id ===
                    (selectedCategory.category_id || selectedCategory.id || ""),
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
                Please select a category or subcategory from the sidebar to view
                details.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Add Subcategory Dialog */}
      {isAddSubcategoryOpen && (
        <Dialog
          open={isAddSubcategoryOpen}
          onOpenChange={(open) => {
            if (!open) {
              setIsAddSubcategoryOpen(false);
            }
          }}
        >
          <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add New Subcategory</DialogTitle>
            </DialogHeader>
            <SubcategoryForm
              key={`subcategory-form-${selectedCategory?.category_id || selectedCategory?.id || ""}`}
              categories={categories.map((c) => ({
                id: (c as any).id ?? (c as any).category_id,
                name: (c as any).name,
                created_at: (c as any).created_at ?? new Date().toISOString(),
                updated_at: (c as any).updated_at ?? new Date().toISOString(),
                category_id: (c as any).category_id ?? (c as any).id,
              }))}
              selectedCategoryId={
                selectedCategory?.category_id || selectedCategory?.id || ""
              }
              closeDialog={() => setIsAddSubcategoryOpen(false)}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Edit Category Dialog */}
      {isEditCategoryOpen && (
        <Dialog
          open={isEditCategoryOpen}
          onOpenChange={(open) => {
            if (!open) {
              setIsEditCategoryOpen(false);
            } else if (
              !(
                selectedCategory &&
                (selectedCategory.category_id || selectedCategory.id)
              )
            ) {
              // Prevent opening without a valid selected category
              setIsEditCategoryOpen(false);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Category</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div key="category-name-field" className="space-y-2">
                <Label htmlFor="edit-category-name">Category Name</Label>
                <Input
                  id="edit-category-name"
                  value={editCategoryName}
                  onChange={(e) => setEditCategoryName(e.target.value)}
                />
              </div>
              {selectedCategory && (
                <div
                  key="category-id-display"
                  className="text-muted-foreground text-xs"
                >
                  Category ID:{" "}
                  {selectedCategory.category_id || selectedCategory.id}
                </div>
              )}
              <div key="action-buttons" className="flex justify-end space-x-2">
                <Button
                  variant="outline"
                  onClick={() => setIsEditCategoryOpen(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleEditCategory} disabled={loading}>
                  {loading ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit Subcategory Dialog */}
      {isEditSubcategoryOpen && (
        <Dialog
          open={isEditSubcategoryOpen}
          onOpenChange={setIsEditSubcategoryOpen}
        >
          <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Subcategory</DialogTitle>
            </DialogHeader>
            <div className="space-y-6">
              <div key="subcategory-name-field" className="space-y-2">
                <Label htmlFor="edit-subcategory-name">Subcategory Name</Label>
                <Input
                  id="edit-subcategory-name"
                  value={editSubcategoryName}
                  onChange={(e) => setEditSubcategoryName(e.target.value)}
                />
              </div>
              <div key="prompts-editor" className="space-y-2">
                <Label>Prompts</Label>
                <MarkdownEditor
                  value={editPrompts}
                  onChange={setEditPrompts}
                />
              </div>
              <div key="action-buttons" className="flex justify-end space-x-2">
                <Button
                  variant="outline"
                  onClick={() => setIsEditSubcategoryOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={(e) => {
                    e.preventDefault();
                    handleEditSubcategory();
                  }}
                  disabled={loading}
                >
                  {loading ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete Category Confirmation Dialog */}
      {isDeleteCategoryOpen && (
        <Dialog
          open={isDeleteCategoryOpen}
          onOpenChange={setIsDeleteCategoryOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="text-destructive h-5 w-5" />
                Delete Category
              </DialogTitle>
              <DialogDescription>
                Are you sure you want to delete the category "
                {categoryToDelete?.name}"? This will also delete all subcategories
                and their prompts. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                onClick={() => {
                  setIsDeleteCategoryOpen(false);
                  setCategoryToDelete(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteCategory}
                disabled={loading}
              >
                {loading ? "Deleting..." : "Delete Category"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete Subcategory Confirmation Dialog */}
      {isDeleteSubcategoryOpen && (
        <Dialog
          open={isDeleteSubcategoryOpen}
          onOpenChange={setIsDeleteSubcategoryOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="text-destructive h-5 w-5" />
                Delete Subcategory
              </DialogTitle>
              <DialogDescription>
                Are you sure you want to delete the subcategory "
                {subcategoryToDelete?.name}"? This will also delete all prompts
                associated with this subcategory. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                onClick={() => {
                  setIsDeleteSubcategoryOpen(false);
                  setSubcategoryToDelete(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteSubcategory}
                disabled={loading}
              >
                {loading ? "Deleting..." : "Delete Subcategory"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
