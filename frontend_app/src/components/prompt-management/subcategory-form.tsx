import type { SubcategoryFormValues } from "@/schema/prompt-management.schema";
import { useEffect } from "react";
import { useCreateSubcategory } from "@/lib/api";
import type { CategoryResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";
import { subcategoryFormSchema } from "@/schema/prompt-management.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { MarkdownEditor } from "./markdown-editor";

// Accept both API CategoryResponse and local Category (which may include category_id)
type CategoryLike = CategoryResponse & { category_id?: string };

interface SubcategoryFormProps {
  categories: Array<CategoryLike>;
  selectedCategoryId?: string;
  closeDialog: () => void;
}

export function SubcategoryForm({
  categories,
  selectedCategoryId,
  closeDialog,
}: SubcategoryFormProps) {
  // diagnostics removed

  const createSubcategory = useCreateSubcategory();

  const form = useForm<SubcategoryFormValues>({
    resolver: zodResolver(subcategoryFormSchema),
    defaultValues: {
      name: "",
      categoryId: selectedCategoryId || undefined,
      prompts: {},
    },
  });

  useEffect(() => {
    if (selectedCategoryId) {
      form.setValue("categoryId", selectedCategoryId);
    }
  }, [selectedCategoryId, form]);

  const { mutate: addSubcategoryMutation, isPending } = useOptimisticMutation({
    mutationFn: ({ name, categoryId, prompts }: { name: string; categoryId: string; prompts: Record<string, string> }) =>
      createSubcategory(name, categoryId, prompts),
    queryKey: ["sonic-brief", "prompt-management", "subcategories"],
    updateFn: (old = [], newData) => [...old, newData],
    successMessage: "Subcategory created successfully",
    onMutateSideEffect: () => {
      form.reset();
      closeDialog();
    },
  });

  const handleFormSubmit = async (values: SubcategoryFormValues) => {
    const formattedPrompts = Object.fromEntries(
      Object.entries(values.prompts)
        .map(([key, value]) => [key.trim(), value.trim()])
        .filter(([key]) => key),
    );

    addSubcategoryMutation({
      name: values.name,
      categoryId: values.categoryId,
      prompts: formattedPrompts,
    });
  };

  const promptsValue = form.watch("prompts");
  const hasValidPrompts =
    Object.entries(promptsValue ?? {}).filter(([key]) => key.trim()).length > 0;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleFormSubmit)}
        className="space-y-6"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem key="subcategory-name">
              <FormLabel>Subcategory Name</FormLabel>
              <FormControl>
                <Input placeholder="Enter subcategory name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="categoryId"
          render={({ field }) => (
            <FormItem key="category-select">
              <FormLabel>Category</FormLabel>
              <Select
                onValueChange={field.onChange}
                value={field.value}
                defaultValue={field.value}
                disabled={!!selectedCategoryId}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="prompts"
          render={({ field }) => (
            <FormItem key="prompts-editor">
              <Label>Prompts</Label>
              <FormControl>
                <MarkdownEditor
                  value={field.value || {}}
                  onChange={(updatedPrompts) => field.onChange(updatedPrompts)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div key="action-buttons" className="flex justify-end space-x-2">
          <Button type="button" variant="outline" onClick={closeDialog}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending || !hasValidPrompts}>
            {isPending ? "Creating..." : "Create Subcategory"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
