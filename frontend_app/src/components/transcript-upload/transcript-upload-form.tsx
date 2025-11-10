import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useMsal } from "@azure/msal-react";
import * as docx from "docx-preview";
// Use the package entry for pdfjs-dist compatible with v3.x
import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore - Vite will resolve this to a URL string (v3 uses .js worker)
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.js?url";
import { TranscriptUploadDialog } from "./transcript-upload-dialog";
import { transcriptUploadSchema } from "@/schema/prompt-management.schema";
import type { TranscriptUploadValues } from "@/schema/prompt-management.schema";
import { useFetchPrompts, useUploadFile } from "@/lib/api";
import { generateUnifiedFileName, getSubcategoryName } from "@/utils/fileNaming";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCcw } from "lucide-react";

export function TranscriptUploadForm() {
  const AUTO_CLOSE_DELAY_MS = 1500;
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [successMessage, setSuccessMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [stepProgress, setStepProgress] = useState<number[]>([0, 0, 0]);
  const [convertedText, setConvertedText] = useState<string>("");
  const [userName, setUserName] = useState<string>("");

  // Get MSAL accounts for user info (consistent with audio upload)
  const { accounts } = useMsal();
  const userEmail = accounts && accounts.length > 0 ? accounts[0].username : "";

  const fetchPrompts = useFetchPrompts();
  const uploadFile = useUploadFile();

  const form = useForm<TranscriptUploadValues>({
    resolver: zodResolver(transcriptUploadSchema),
    defaultValues: {
      caseId: "",
      transcriptFile: undefined,
      promptCategory: "",
      promptSubcategory: "",
    },
  });

  const {
    data: categoriesResp,
    isLoading: isLoadingCategories,
    refetch: refetchCategories,
  } = useQuery({
    queryKey: ["sonic-brief", "prompts"],
    queryFn: fetchPrompts,
    select: (data: any) => data.data as Array<any>,
  });

  const categories = categoriesResp as Array<any> | undefined;
  const selectedCategoryData = categories?.find(
    (cat: any) => cat.category_id === form.watch("promptCategory")
  );
  const selectedSubcategoryData = selectedCategoryData?.subcategories.find(
    (sub: any) => sub.subcategory_id === form.watch("promptSubcategory")
  );

  useEffect(() => {
    // Set user name from MSAL email (consistent with audio upload and record audio)
    if (userEmail) {
      setUserName(userEmail.split("@")[0] || "User");
    } else {
      setUserName("User");
    }
  }, [userEmail]);

  const handleFileToText = async (file: File): Promise<string> => {
    let text = "";
    if (file.type === "application/pdf") {
      try {
        const arrayBuffer = await file.arrayBuffer();
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const allText: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const lines: Record<number, { x: number; str: string }[]> = {};
          (content.items as any[]).forEach((item) => {
            const y = Math.round(item.transform[5]);
            if (!lines[y]) lines[y] = [];
            lines[y].push({ x: item.transform[4], str: item.str });
          });
          const sortedY = Object.keys(lines)
            .map(Number)
            .sort((a, b) => b - a);
          const pageLines = sortedY.map((y) =>
            lines[y].sort((a, b) => a.x - b.x).map((item) => item.str).join(" ")
          );
          allText.push(pageLines.join("\n"));
        }
        text = allText.join("\n");
      } catch (err: any) {
        throw new Error("PDF conversion failed. See debug pane for details.");
      }
    } else if (
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const arrayBuffer = await file.arrayBuffer();
      const tempDiv = document.createElement("div");
      await docx.renderAsync(arrayBuffer, tempDiv);
      const paragraphs = Array.from(tempDiv.querySelectorAll("p"));
      const paraTexts = paragraphs
        .map((p) => p.innerText.trim())
        .filter((line) => line.length > 0);
      text = paraTexts.join("\n");
      return text;
    } else {
      text = await file.text();
    }
    const lines = text.split(/\r?\n/);
    let startIdx = 0;
  const transcriptStartRegex = /^(?:(\(|\[)?\d{1,2}:\d{2}|Speaker|Interviewer|Interviewee|Participant|Q:|A:)/i;
  const cleanedLines = lines.map((line) => line.trim()).filter((line, idx) => {
      if (
        idx < 20 &&
        (/^\\|^\{|^\}/.test(line) ||
          /fonttbl|colortbl|stylesheet|info|generator|\*|\\pard|\\qc|\\ql|\\qr|\\b0|\\b|\\i0|\\i|\\ul|\\ulnone|\\fs\d+/.test(line))
      ) {
        return false;
      }
      return true;
    });
    for (let i = 0; i < cleanedLines.length; i++) {
      if (transcriptStartRegex.test(cleanedLines[i])) {
        startIdx = i;
        break;
      }
    }
    const cleanedText = cleanedLines.slice(startIdx).join("\n").trim();
    return cleanedText;
  };

  const onSubmit = async (values: TranscriptUploadValues) => {
    setSuccessMessage("");
    setErrorMessage("");
    setUploadProgress(0);
    setUploading(true);
    setDialogOpen(true);
    setStepProgress([10, 0, 0]);
    setConvertedText("");
    let textContent = "";
    try {
      setStepProgress([30, 0, 0]);
      textContent = await handleFileToText(values.transcriptFile);
      setConvertedText(textContent);
      setStepProgress([100, 50, 0]);
    } catch (err: any) {
      setErrorMessage("File conversion failed. Please check your file.");
      setUploading(false);
      setDialogOpen(false);
      return;
    }
    let subShort = "SUB";
    if (values.promptSubcategory && categories) {
      const subcategoryName = getSubcategoryName(categories, values.promptSubcategory);
      if (subcategoryName) {
        subShort = subcategoryName;
      }
    }

    // Generate unified filename
    const fileName = generateUnifiedFileName({
      subcategory: subShort,
      caseId: values.caseId,
      username: userName,
      fileExtension: "txt"
    });
    const fileForUpload = new File([textContent], fileName, { type: "text/plain" });
    try {
      setStepProgress([100, 100, 10]);
      const result = await uploadFile(
        fileForUpload,
        values.promptCategory,
        values.promptSubcategory,
        values.caseId
      );
      setSuccessMessage(result.message || "Transcript uploaded successfully!");
      setUploadProgress(100);
      setStepProgress([100, 100, 100]);
  // Auto-close dialog after success (matches audio upload behavior)
  setTimeout(() => setDialogOpen(false), AUTO_CLOSE_DELAY_MS);
    } catch (err: any) {
      setErrorMessage(err?.message || "Upload failed. Please try again.");
      setUploading(false);
      setDialogOpen(false);
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <TranscriptUploadDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open && successMessage) {
            window.location.reload();
          }
        }}
        uploading={uploading}
        uploadProgress={uploadProgress}
        stepLabels={["Converting file to plain text...", "Preparing file for upload...", "Uploading transcript file..."]}
        stepProgress={stepProgress}
        errorMessage={errorMessage}
        successMessage={successMessage}
        convertedText={convertedText}
        onClose={() => {
          setDialogOpen(false);
          if (successMessage) {
            window.location.reload();
          }
        }}
      />
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <FormField
            control={form.control}
            name="caseId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Case ID</FormLabel>
                <FormControl>
                  <Input type="text" placeholder="Enter Case ID" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="transcriptFile"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Transcript File</FormLabel>
                <FormControl>
                  <Input
                    type="file"
                    accept=".txt,.docx,.pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      field.onChange(file);
                    }}
                  />
                </FormControl>
                <FormDescription>Upload a transcript file (txt, docx, pdf)</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="promptCategory"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Service Area</FormLabel>
                <div className="flex items-center space-x-2">
                  <Select
                    value={field.value || selectedCategory || ""}
                    onValueChange={(value) => {
                      field.onChange(value);
                      setSelectedCategory(value);
                      setSelectedSubcategory(null);
                      form.setValue("promptSubcategory", "");
                    }}
                    disabled={isLoadingCategories}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select Service Area" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {categories?.map((category: any) => (
                        <SelectItem
                          key={category.category_id}
                          value={category.category_id}
                        >
                          {category.category_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => refetchCategories()}
                    disabled={isLoadingCategories}
                  >
                    <RefreshCcw className="mr-2 h-4 w-4" />
                    {isLoadingCategories ? "Refreshing..." : "Refresh"}
                  </Button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="promptSubcategory"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Service Function / Meeting</FormLabel>
                <Select
                  value={field.value || selectedSubcategory || ""}
                  onValueChange={(value) => {
                    field.onChange(value);
                    setSelectedSubcategory(value);
                  }}
                  disabled={!form.watch("promptCategory")}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select Service Function" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {selectedCategoryData?.subcategories.map((subcategory: any) => (
                      <SelectItem
                        key={subcategory.subcategory_id}
                        value={subcategory.subcategory_id}
                      >
                        {subcategory.subcategory_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          {selectedSubcategoryData && (
            <Card>
              <CardHeader>
                <CardTitle className="font-bold">
                  {selectedSubcategoryData.subcategory_name}
                </CardTitle>
                <CardDescription>
                  Prompt details for the selected subcategory
                </CardDescription>
              </CardHeader>
              <CardContent className="max-h-60 overflow-auto p-4">
                {Object.entries(selectedSubcategoryData.prompts).map(
                  ([key, value]: [string, unknown]) => (
                    <div key={key} className="mb-4">
                      <h4 className="text-lg font-semibold">{key}</h4>
                      <div className="prose prose-sm max-w-none whitespace-pre-line">{String(value)}</div>
                    </div>
                  ),
                )}
              </CardContent>
            </Card>
          )}
          <Button type="submit" disabled={uploading}>
            {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Upload Transcript"}
          </Button>
          {successMessage && <div className="text-green-700 font-semibold mt-2">{successMessage}</div>}
          {errorMessage && <div className="text-red-600 font-semibold mt-2">{errorMessage}</div>}
        </form>
      </Form>
    </>
  );
}
