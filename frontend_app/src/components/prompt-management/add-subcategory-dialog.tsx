import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CategoryResponse } from "@/lib/api";

import { SubcategoryForm } from "./subcategory-form";

interface AddSubcategoryDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Array<CategoryResponse>;
  selectedCategoryId: string | null;
}

export function AddSubcategoryDialog({
  isOpen,
  onOpenChange,
  categories,
  selectedCategoryId,
}: AddSubcategoryDialogProps) {
  // diagnostics removed

  // Ensure selectedCategoryId is not null before rendering the form
  if (!isOpen) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Subcategory</DialogTitle>
        </DialogHeader>
        {selectedCategoryId ? (
          <SubcategoryForm
            key={`add-subcategory-form-${selectedCategoryId}`} // Use selectedCategoryId in key
            categories={categories}
            selectedCategoryId={selectedCategoryId}
            closeDialog={() => onOpenChange(false)}
          />
        ) : (
          <div>No category selected. Please select a category first.</div>
        )}
      </DialogContent>
    </Dialog>
  );
}
