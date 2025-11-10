import type { SubcategoryResponse } from "@/lib/api";
import type { SubcategoryFormValues } from "@/schema/prompt-management.schema";
import { useEffect } from "react";
import { useUpdateSubcategory } from "@/lib/api";
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
import { subcategoryFormSchema } from "@/schema/prompt-management.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { MarkdownEditor } from "./markdown-editor";

interface EditSubcategoryDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  subcategory: SubcategoryResponse | null;
}

export function EditSubcategoryDialog({
  isOpen,
  onOpenChange,
  subcategory,
}: EditSubcategoryDialogProps) {
  const updateSubcategory = useUpdateSubcategory();
  
  const form = useForm<SubcategoryFormValues>({
    resolver: zodResolver(subcategoryFormSchema),
    defaultValues: {
      categoryId: subcategory?.id,
      name: "",
      prompts: {},
    },
  });

  // Update form values when subcategory changes
  useEffect(() => {
    if (subcategory) {
      form.reset({
        name: subcategory.name,
        prompts: subcategory.prompts,
        categoryId: subcategory.id,
      });
    }
  }, [subcategory, form]);

  const { mutate: editSubcategoryMutation, isPending } = useOptimisticMutation({
    mutationFn: ({ subcategoryId, name, prompts }: { subcategoryId: string; name: string; prompts: Record<string, string> }) =>
      updateSubcategory(subcategoryId, name, prompts),
    queryKey: ["sonic-brief", "prompt-management", "subcategories"],
    updateFn: (old: SubcategoryResponse[] = [], newData: { subcategoryId: string; name: string; prompts: Record<string, string> }) =>
      old.map((sub: SubcategoryResponse) =>
        sub.id === newData.subcategoryId
          ? { ...sub, name: newData.name, prompts: newData.prompts }
          : sub,
      ),
    successMessage: "Subcategory updated successfully",
    onMutateSideEffect: () => {
      form.reset();
      onOpenChange(false);
    },
  });

  const onSubmit = (values: SubcategoryFormValues) => {
    editSubcategoryMutation({
      subcategoryId: values.categoryId,
      name: values.name,
      prompts: values.prompts,
    });
  };

  // Don't render if the dialog is closed or no subcategory is selected
  if (!isOpen || !subcategory) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Subcategory</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-6 py-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Subcategory Name</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={isPending} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="prompts"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Prompts</FormLabel>
                  <FormControl>
                    <MarkdownEditor
                      key={`md-editor-${subcategory.id}`}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
