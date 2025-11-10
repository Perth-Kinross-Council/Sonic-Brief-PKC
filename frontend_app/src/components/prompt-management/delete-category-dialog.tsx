import type { CategoryResponse } from "@/lib/api";
import { useDeleteCategory } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";
import { AlertTriangle } from "lucide-react";

interface DeleteCategoryDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  category: CategoryResponse | null;
}

export function DeleteCategoryDialog({
  isOpen,
  onOpenChange,
  category,
}: DeleteCategoryDialogProps) {
  const deleteCategory = useDeleteCategory();
  
  const { mutate: removeCategoryMutation, isPending } = useOptimisticMutation({
    mutationFn: async (categoryId: string) => {
      await deleteCategory(categoryId);
      return { id: categoryId, name: '', created_at: '', updated_at: '' } as CategoryResponse;
    },
    queryKey: ["sonic-brief", "prompt-management", "categories"],
    updateFn: (old: CategoryResponse[] = [], categoryId: string) =>
      old.filter((cat: CategoryResponse) => cat.id !== categoryId),
    successMessage: "Category deleted successfully",
    onMutateSideEffect: () => {
      onOpenChange(false);
    },
  });

  // Don't render if no category is selected
  if (!category) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="text-destructive h-5 w-5" />
            Delete Category
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to delete the category "{category.name}"? This
            will also delete all subcategories and their prompts. This action
            cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => removeCategoryMutation(category.id)}
            disabled={isPending}
          >
            {isPending ? "Deleting..." : "Delete Category"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
