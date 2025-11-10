import type { EditCategoryFormValues } from "@/schema/prompt-management.schema";
import { useEffect } from "react";
import { useUpdateCategory } from "@/lib/api";
import type { CategoryResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";
import { editCategoryFormSchema } from "@/schema/prompt-management.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

interface EditCategoryDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  category: CategoryResponse | null;
}

export function EditCategoryDialog({
  isOpen,
  onOpenChange,
  category,
}: EditCategoryDialogProps) {
  const updateCategory = useUpdateCategory();
  
  const form = useForm<EditCategoryFormValues>({
    resolver: zodResolver(editCategoryFormSchema),
    defaultValues: {
      name: category?.name || "",
      id: category?.id || "",
    },
  });

  useEffect(() => {
    if (category) {
      form.reset({
        name: category.name || "",
        id: category.id || "",
      });
    }
  }, [category, form]);

  const { mutate: editCategoryMutation, isPending } = useOptimisticMutation({
    mutationFn: ({ categoryId, name }: { categoryId: string; name: string }) => {
      return updateCategory(categoryId, name);
    },
    queryKey: ["sonic-brief", "prompt-management", "categories"],
    updateFn: (old: CategoryResponse[] = [], newData: { categoryId: string; name: string }) => {
      return old.map((cat: CategoryResponse) =>
        cat.id === newData.categoryId ? { ...cat, name: newData.name } : cat,
      );
    },
    successMessage: "Category updated successfully",
    onMutateSideEffect: () => {
      form.reset();
      onOpenChange(false);
    },
  });

  const onSubmit = (values: EditCategoryFormValues) => {
    if (!values.id) {
      console.error("[EditCategoryDialog] No category ID available for update");
      return;
    }
    
    editCategoryMutation({
      categoryId: values.id,
      name: values.name,
    });
  };

  if (!category) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Category</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category Name</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="text-muted-foreground text-xs">
              Category ID: {category.id || "Not available"}
            </div>
            <div className="flex justify-end space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
