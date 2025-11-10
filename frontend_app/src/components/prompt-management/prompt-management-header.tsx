import type { AddCategoryFormValues } from "@/schema/prompt-management.schema";
import { useState } from "react";
import { useCreateCategory } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import { getPromptManagementCategoriesQuery } from "@/queries/prompt-management.query";
import type { CategoryResponse } from "@/lib/api";
import { queryClient } from "@/queryClient";
import { addCategoryFormSchema } from "@/schema/prompt-management.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { PlusCircle, FileText } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { notifyError } from '@/lib/notify';

export function PromptManagementHeader() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const addCategory = useCreateCategory();

  const form = useForm<AddCategoryFormValues>({
    resolver: zodResolver(addCategoryFormSchema),
    defaultValues: {
      name: "",
    },
  });

  const { mutate: addCategoryMutation, isPending } = useMutation({
    mutationKey: ["sonic-brief/prompt-management/add-category"],
    mutationFn: async ({ name }: { name: string }) => await addCategory(name),
    onMutate: async ({ name }) => {
      await queryClient.cancelQueries({
        queryKey: getPromptManagementCategoriesQuery().queryKey,
      });

      const previousCategories = queryClient.getQueryData(
        getPromptManagementCategoriesQuery().queryKey,
      );

      queryClient.setQueryData(
        getPromptManagementCategoriesQuery().queryKey,
        (old?: CategoryResponse[]) => {
          const prev = Array.isArray(old) ? old : [];
          const next: CategoryResponse = {
            id: "new-category",
            name,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as CategoryResponse;
          return [...prev, next];
        },
      );

      setIsDialogOpen(false);

      return { previousCategories };
    },
    onError: (error, _vars, context) => {
      queryClient.setQueryData(
        getPromptManagementCategoriesQuery().queryKey,
        context?.previousCategories,
      );
  notifyError(error, 'Failed to create category');
    },
    onSuccess: () => {
      toast.success("Success", {
        description: "Category created successfully",
      });
      form.reset();
    },
  });

  const onSubmit = (values: AddCategoryFormValues) => {
    addCategoryMutation({ name: values.name });
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <nav
            className="flex items-center text-sm text-muted-foreground mb-1"
            aria-label="Breadcrumb"
          >
            <a href="/home" className="hover:underline">
              Home
            </a>
            <span className="mx-2">&gt;</span>
            <span className="font-semibold">Prompt Management</span>
          </nav>
          <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <FileText className="h-5 w-5" />
            Prompt Management
          </h2>
          <p className="text-muted-foreground text-sm">
            Manage categories, subcategories, and prompts for your AI system.
          </p>
        </div>
        <Button onClick={() => setIsDialogOpen(true)}>
          <PlusCircle className="me-2 h-4 w-4" />
          Add Category
        </Button>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Category</DialogTitle>
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
                      <Input
                        {...field}
                        placeholder="Enter category name"
                        disabled={isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    form.reset();
                    setIsDialogOpen(false);
                  }}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Creating..." : "Create Category"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
