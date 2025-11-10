import { z } from "zod";

import { categoryNameSchema } from "./common.schema";

export const subcategoryFormSchema = z.object({
  name: z.string().min(1, { message: "Subcategory name cannot be empty" }),
  categoryId: z.string({ required_error: "Please select a category" }),
  prompts: z
    .record(z.string(), z.string())
    .refine(
      (prompts) =>
        Object.entries(prompts).filter(([key]) => key.trim()).length > 0,
      {
        message: "Please add at least one prompt with a non-empty key",
      },
    )
    .refine(
      (prompts) =>
        Object.entries(prompts).every(
          ([key, value]) => key.trim().length > 0 && value.trim().length > 0,
        ),
      {
        message: "Prompt keys and values cannot be empty",
      },
    ),
});

export type SubcategoryFormValues = z.infer<typeof subcategoryFormSchema>;

export const addCategoryFormSchema = z.object({
  name: categoryNameSchema,
});

export type AddCategoryFormValues = z.infer<typeof addCategoryFormSchema>;

export const editCategoryFormSchema = z.object({
  name: categoryNameSchema,
  id: z.string().min(1, { message: "Category ID cannot be empty" }),
});

export type EditCategoryFormValues = z.infer<typeof editCategoryFormSchema>;

export const transcriptUploadSchema = z.object({
  caseId: z
    .string({ required_error: "Case ID is required." })
    .min(2, { message: "Case ID must be at least 2 characters." }),
  transcriptFile: z
    .instanceof(File, { message: "Please select a transcript file." })
    .refine((file) => file && file.size > 0, {
      message: "Please select a valid transcript file.",
    }),
  promptCategory: z.string({
    required_error: "Please select a Service Area.",
    invalid_type_error: "Please select a Service Area.",
  }).min(1, { message: "Please select a Service Area." }),
  promptSubcategory: z.string({
    required_error: "Please select a Service Function / Meeting.",
    invalid_type_error: "Please select a Service Function / Meeting.",
  }).min(1, { message: "Please select a Service Function / Meeting." }),
});

export type TranscriptUploadValues = z.infer<typeof transcriptUploadSchema>;
