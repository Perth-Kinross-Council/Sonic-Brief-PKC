import { z } from "zod";

export const audioUploadSchema = z.object({
  audioFile: z.instanceof(File),
  promptCategory: z.string({
    required_error: "Please select a prompt category.",
  }),
  promptSubcategory: z.string({
    required_error: "Please select a prompt subcategory.",
  }),
});

// Enhanced schema with case_id support
export const enhancedAudioUploadSchema = audioUploadSchema.extend({
  caseId: z.string().optional(),
});

export type AudioUploadValues = z.infer<typeof audioUploadSchema>;
export type EnhancedAudioUploadValues = z.infer<typeof enhancedAudioUploadSchema>;
