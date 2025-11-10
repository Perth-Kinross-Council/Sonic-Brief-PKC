import type { EnhancedAudioUploadValues } from "@/schema/audio-upload.schema";
import { useCallback, useState, useEffect, useRef } from "react";
import { useFetchPrompts, useUploadFile } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { enhancedAudioUploadSchema } from "@/schema/audio-upload.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCcw } from "lucide-react";
import { useForm } from "react-hook-form";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { generateUnifiedFileName, getSubcategoryName } from "@/utils/fileNaming";

// Helper for file -> Uint8Array
const fetchFile = async (file: File): Promise<Uint8Array> => {
  return new Uint8Array(await file.arrayBuffer());
};

// Add a callback prop to trigger a page refresh after successful upload
export function AudioUploadForm({ onUploadSuccess }: { onUploadSuccess?: () => void } = {}) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(
    null,
  );
  const [userName, setUserName] = useState<string>("");
  const [processing, setProcessing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [dialogError, setDialogError] = useState<string>("");
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [successMessage, setSuccessMessage] = useState<string>("");
  const [jobId, setJobId] = useState<string>("");
  const dialogTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Add stepwise progress for each check/conversion
  const [stepProgress, setStepProgress] = useState<number[]>([]);
  const stepLabels = [
    "Checking file format and stereo/mono...",
    "Converting to mono wav (if needed)...",
    "Verifying mono wav...",
    "Converting to AAC (.aac)...",
    "Verifying AAC (.aac)...",
    "Finalizing..."
  ];

  // Persistent state for detected file type and channel
  const [detectedFileType, setDetectedFileType] = useState<string>("");
  const [detectedChannel, setDetectedChannel] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);

  // Helper to update step progress and calculate overall progress
  const updateStepProgress = (step: number, value: number) => {
    setStepProgress((prev) => {
      const arr = [...prev];
      arr[step] = value;

      // Calculate overall progress based only on COMPLETED steps (value === 100)
      // Each completed step is worth 1/6 of total progress (since there are 6 steps)
      const totalSteps = stepLabels.length;
      const completedSteps = arr.filter(stepVal => stepVal === 100).length;
      const overallProgress = (completedSteps / totalSteps) * 100;
      setProgress(Math.round(overallProgress));

      return arr;
    });
  };

  // Get user info from enhanced auth (omitted here). Provide minimal shape for DX.
  const userEmail: string = "";

  // Fetch user info on mount
  useEffect(() => {
    if (userEmail) {
      setUserName(userEmail.split("@")[0] || "User");
    } else {
      setUserName("User");
    }
  }, [userEmail]);

  const form = useForm<EnhancedAudioUploadValues>({
    resolver: zodResolver(enhancedAudioUploadSchema),
    defaultValues: {
      caseId: "",
      audioFile: undefined,
      promptCategory: "",
      promptSubcategory: "",
    },
  });

  const fetchPrompts = useFetchPrompts();
  const uploadFile = useUploadFile();

  const {
    data: categories,
    isLoading: isLoadingCategories,
    refetch: refetchCategories,
  } = useQuery({
    queryKey: ["sonic-brief", "prompts"],
    queryFn: fetchPrompts,
    select: (data: any) => data.data,
  });

  // Approved audio file extensions and MIME types
  const approvedExtensions = ["mp3", "wav", "aac", "m4a", "ogg", "flac"];
  // Include common and vendor / legacy variants browsers may report for AAC & containers
  const approvedMimeTypes = [
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
    "audio/aac",
    "audio/x-aac",
    "audio/aacp",            // some browsers
    "audio/vnd.dlna.adts",   // seen on Windows for raw ADTS AAC
    "audio/mp4a-latm",       // raw AAC stream in LATM
    "audio/mp4",
    "audio/ogg",
    "audio/flac",
    "audio/x-m4a",
    "audio/m4a",
  ];

  // Helper to check if file is mono and convert if needed
  const processAudioFile = async (file: File): Promise<File> => {
    setDialogOpen(true);
    setDialogError("");
    setProgress(0);
    setStepProgress([0, 0, 0, 0, 0, 0]);
    setDetectedFileType(file.type || "Unknown");
    setDetectedChannel("");

    // Check for 0-byte file before any processing
    if (file.size === 0) {
      setDialogError("File is empty (0 bytes). Please select a valid audio file.");
      throw new Error("File is empty (0 bytes)");
    }

    try {
      // Step 0: Checking file format and stereo/mono
      updateStepProgress(0, 10);
  const ext = file.name.split(".").pop()?.toLowerCase() || "";

      const ffmpeg = new FFmpeg();
      let ffmpegLogs = "";
      let showProgress = false;

      ffmpeg.on("progress", ({ progress: prog }) => {
        if (showProgress) {
          updateStepProgress(0, Math.round(prog * 100));
        }
      });

      ffmpeg.on("log", ({ message }) => {
        ffmpegLogs += message + "\n";
      });

      if (!ffmpeg.loaded) {
        try {
          await ffmpeg.load();
        } catch (loadErr) {
          console.error("[AudioUpload] FFmpeg failed to load:", loadErr);
          setDialogError("Failed to load audio processing library. Please refresh the page and try again.");
          throw new Error("FFmpeg failed to load");
        }
      }

      const fileData = await fetchFile(file);

      // Check again for 0-byte after reading
      if (!fileData || fileData.length === 0) {
        setDialogError("File is empty (0 bytes) after reading. Please select a valid audio file.");
        throw new Error("File is empty (0 bytes) after reading");
      }


      try {
        // Always pass a new Uint8Array to ffmpeg.writeFile to avoid detached ArrayBuffer errors
        await ffmpeg.writeFile(file.name, new Uint8Array(fileData));
      } catch (writeErr) {
        console.error("[AudioUpload] Failed to write file to FFmpeg:", writeErr);
        setDialogError("Failed to prepare file for processing. Please try again.");
        throw new Error("Failed to write file to FFmpeg");
      }
      updateStepProgress(0, 30);

      // Step 1: Probe for stereo/mono
      let probeLogs = "";
      ffmpeg.on("log", ({ message }) => {
        probeLogs += message + "\n";
      });

      let isStereo = false;
      let isMono = false;

      try {
        // Simple probe - just try to get basic info about the file
        await ffmpeg.exec([
          "-i",
          file.name,
          "-t", "0.1", // Only process first 0.1 seconds to speed up
          "-f",
          "null",
          "-"
        ]);

        // Simplified detection patterns that work better with FFmpeg.js
        const allLogs = probeLogs.toLowerCase();

        // Look for explicit channel mentions
        if (allLogs.includes('stereo') ||
            allLogs.includes('2 channels') ||
            allLogs.includes('channels: 2') ||
            allLogs.includes('channel(s): 2')) {
          isStereo = true;
          isMono = false;
        } else if (allLogs.includes('mono') ||
                   allLogs.includes('1 channel') ||
                   allLogs.includes('channels: 1') ||
                   allLogs.includes('channel(s): 1')) {
          isMono = true;
          isStereo = false;
        } else {
          // If we can't detect clearly, assume it needs conversion (stereo)
          console.warn("[AudioUpload] Could not detect channel count clearly, assuming stereo for safety");
          isStereo = true;
          isMono = false;
        }

        setDetectedChannel(isStereo ? "Stereo" : isMono ? "Mono" : "Unknown");

      } catch (probeErr) {
        setDetectedChannel("Unknown");
        console.warn("[AudioUpload] Audio probing failed, assuming stereo for safety:", probeErr);
        // Assume stereo for safety if detection fails
        isStereo = true;
        isMono = false;
      }

      updateStepProgress(0, 100);

      let data: Uint8Array;

      if (isMono && (ext === "wav" || ext === "aac")) {
        // File is already mono and in a good format
        setProgress(100);
        updateStepProgress(1, 100);
        updateStepProgress(2, 100);
        updateStepProgress(3, 100);
        updateStepProgress(4, 100);
        updateStepProgress(5, 100);
        return file;
      } else if (isMono && ext !== "wav" && ext !== "aac") {
  // File is mono but needs format conversion
        updateStepProgress(1, 50);
        const aacName = file.name.replace(/\.[^.]+$/, ".aac");

        try {
          await ffmpeg.exec(["-i", file.name, "-ac", "1", "-c:a", "aac", "-f", "adts", aacName]);

          const aacData = await ffmpeg.readFile(aacName);
          if (typeof aacData === "string") {
            data = new TextEncoder().encode(aacData);
          } else {
            data = aacData;
          }

          if (data.length === 0) {
            throw new Error("Format conversion produced empty file");
          }

        } catch (convertErr) {
          console.error("[AudioUpload] Format conversion failed:", convertErr);
          setDialogError("Failed to convert audio format. Please try a different file.");
          throw convertErr;
        }

        updateStepProgress(1, 100);
        updateStepProgress(2, 100);
        updateStepProgress(3, 100);
        updateStepProgress(4, 100);
        updateStepProgress(5, 100);
      } else {
  // File needs stereo->mono conversion
        updateStepProgress(1, 10);
        showProgress = true;

        const wavName = file.name.replace(/\.[^.]+$/, ".wav");
        let wavData: Uint8Array;

        try {
          await ffmpeg.exec(["-i", file.name, "-ac", "1", "-ar", "16000", wavName]);
          showProgress = false;
          const wavDataRead = await ffmpeg.readFile(wavName);
          if (typeof wavDataRead === "string") {
            wavData = new TextEncoder().encode(wavDataRead);
          } else {
            wavData = wavDataRead;
          }

          if (wavData.length === 0) {
            throw new Error("Stereo to mono conversion produced empty file");
          }


        } catch (stereoConvertErr) {
          showProgress = false;
          console.error("[AudioUpload] Stereo to mono conversion failed:", stereoConvertErr);
          setDialogError("Failed to convert stereo audio to mono. Please try a different file or check if the file is corrupted.");
          throw stereoConvertErr;
        }

        updateStepProgress(1, 100);

        // Step 2: Verifying mono wav
        updateStepProgress(2, 50);
        let wavProbeLogs = "";
        ffmpeg.on("log", ({ message }) => { wavProbeLogs += message + "\n"; });

        try {
          await ffmpeg.exec([
            "-i",
            wavName,
            "-af",
            "astats=metadata=1:reset=1",
            "-f",
            "null",
            "-",
          ]);

          const isWavMono =
            /channel\(s\)\s*:\s*1(?![\s\S]*channel\(s\)\s*:\s*2)|channels\s*:\s*1(?![\s\S]*channels\s*:\s*2)/i.test(wavProbeLogs) ||
            /\bmono\b/i.test(wavProbeLogs);

          if (!isWavMono) {
            console.error("[AudioUpload] ffmpeg mono wav verification failed: not mono. ffmpeg logs:\n", ffmpegLogs);
            setDialogError('Mono wav verification failed: not mono. See console for ffmpeg logs.');
            throw new Error('Mono wav verification failed: not mono');
          }
        } catch (wavProbeErr) {
          console.error("[AudioUpload] ffmpeg mono wav verification error:", wavProbeErr);
          setDialogError('Mono wav verification error. See console for details.');
          throw wavProbeErr;
        }

        updateStepProgress(2, 100);

        // Step 3: Converting to AAC
        updateStepProgress(3, 50);
        const aacName = file.name.replace(/\.[^.]+$/, ".aac");

        // Always pass a new Uint8Array to ffmpeg.writeFile
        await ffmpeg.writeFile(wavName, new Uint8Array(wavData));
        await ffmpeg.exec(["-i", wavName, "-ac", "1", "-c:a", "aac", "-f", "adts", aacName]);

  const aacData = await ffmpeg.readFile(aacName);
        if (typeof aacData === "string") {
          data = new TextEncoder().encode(aacData);
        } else {
          data = aacData;
        }

        updateStepProgress(3, 100);

        // Check for 0-byte AAC output
        if (!(data instanceof Uint8Array) || data.length === 0) {
          console.error("[AudioUpload] ffmpeg mono wav->aac conversion produced 0-byte file. ffmpeg logs:\n", ffmpegLogs);
          setDialogError('Mono wav->aac conversion failed: produced empty/corrupted file. See console for ffmpeg logs.');
          throw new Error('Mono wav->aac conversion failed: 0-byte output');
        }

        // Step 4: Verifying AAC
        updateStepProgress(4, 50);
        let aacProbeLogs = "";
        ffmpeg.on("log", ({ message }) => { aacProbeLogs += message + "\n"; });

        // Always pass a new Uint8Array to ffmpeg.writeFile
        await ffmpeg.writeFile("probe_temp_" + aacName, new Uint8Array(data));

        try {
          await ffmpeg.exec([
            "-i",
            "probe_temp_" + aacName,
            "-af",
            "astats=metadata=1:reset=1",
            "-f",
            "null",
            "-",
          ]);

          const isAacMono =
            /channel\(s\)\s*:\s*1(?![\s\S]*channel\(s\)\s*:\s*2)|channels\s*:\s*1(?![\s\S]*channels\s*:\s*2)/i.test(aacProbeLogs) ||
            /\bmono\b/i.test(aacProbeLogs);

          if (!isAacMono) {
            console.error("[AudioUpload] ffmpeg aac verification failed: not mono. ffmpeg logs:\n", ffmpegLogs);
            setDialogError('AAC verification failed: not mono. See console for ffmpeg logs.');
            throw new Error('AAC verification failed: not mono');
          }
        } catch (aacProbeErr) {
          console.error("[AudioUpload] ffmpeg aac verification error:", aacProbeErr);
          setDialogError('AAC verification error. See console for details.');
          throw aacProbeErr;
        }

        updateStepProgress(4, 100);
      }

      // Step 5: Finalizing
      updateStepProgress(5, 100);
      setProgress(100);

      const processedFileName = file.name.replace(/\.[^.]+$/, ".aac");
  return new File([data as unknown as BlobPart], processedFileName, { type: "audio/aac" });

    } catch (err: any) {
      console.error("[AudioUpload] processAudioFile error:", err);
      setDialogError(err?.message || "Audio processing failed. Please try again.");
      throw err;
    }
  };

  const onSubmit = useCallback(
    async (values: EnhancedAudioUploadValues) => {
      setProcessing(true);
      setDialogError("");
      setSuccessMessage("");
      setJobId("");

      try {
        if (!values.audioFile) {
          toast.error("Please select an audio file");
          setProcessing(false);
          return;
        }

        const ext = values.audioFile.name.split(".").pop()?.toLowerCase() || "";
        if (!approvedExtensions.includes(ext)) {
          toast.error(`File extension .${ext} is not supported. Please use: ${approvedExtensions.join(", ")}`);
          setProcessing(false);
          return;
        }

        // Relax MIME validation: allow if extension approved even if MIME is a vendor variant
        const fileMime = values.audioFile.type;
        if (fileMime && !approvedMimeTypes.includes(fileMime)) {
          // Log & continue instead of hard failing; some platforms give unusual AAC MIME types
            console.warn(`[AudioUpload] Non-whitelisted MIME '${fileMime}' for extension .${ext} - proceeding (extension allowed).`);
        }

        // Process the audio file
        const processedFile = await processAudioFile(values.audioFile);

        if (!processedFile) {
          setProcessing(false);
          return;
        }

        // Find subcategory shortname using unified naming utility
        const subcategoryName = getSubcategoryName(categories, values.promptSubcategory);

        // Extension
        const ext2 = processedFile.name.split(".").pop() || "aac";


        // Build unified file name
        const fileName = generateUnifiedFileName({
          subcategory: subcategoryName,
          caseId: values.caseId,
          username: userName,
          fileExtension: ext2
        });


        // Create new File with correct name
        const fileForUpload = new File([processedFile], fileName, { type: processedFile.type });

        try {
          setDialogError("");
          setDialogOpen(true);
          setUploadProgress(0);
          setIsUploading(true);

          // Use the proper API function with MSAL authentication
          const uploadResult = await uploadFile(
            fileForUpload,
            values.promptCategory,
            values.promptSubcategory,
            values.caseId || ""
          );

          setSuccessMessage(
            uploadResult?.message || "File uploaded successfully!"
          );
          setJobId(uploadResult?.job_id || "");
          setUploadProgress(100);
          setIsUploading(false);

          // Immediately clear fields to prevent duplicate submissions while leaving dialog content visible
          resetFieldsOnly();

          // Only auto-close dialog after 5 seconds if job id exists
          if (uploadResult?.job_id) {
            dialogTimeoutRef.current = setTimeout(() => {
              // Close the dialog and reset the form to avoid duplicate submissions
              setDialogOpen(false);
              resetFormAndState();
              dialogTimeoutRef.current = null;
              // Call the callback to refresh the page after dialog closes
              if (onUploadSuccess) onUploadSuccess();
            }, 5000);
          }
        } catch (err: any) {
          setIsUploading(false);
          setDialogError(err?.message || "Upload failed. Please try again.");
          setUploadProgress(0);
        } finally {
          setProcessing(false);
        }
      } catch (err: any) {
        setProcessing(false);
        setDialogError(err?.message || "Processing failed. Please try again.");
      }
    },
    [form, categories, userName, onUploadSuccess]
  );

  // Helper to reset form and state after successful upload
  const resetFormAndState = useCallback(() => {
    // Reset RHF state and ensure file input DOM is cleared
    form.reset({ caseId: "", audioFile: undefined, promptCategory: "", promptSubcategory: "" });
    try {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch {}
    setSelectedCategory(null);
    setSelectedSubcategory(null);
    setDetectedFileType("");
    setDetectedChannel("");
    setStepProgress([0, 0, 0, 0, 0, 0]);
    setProgress(0);
    setUploadProgress(0);
    setSuccessMessage("");
    setJobId("");
    setDialogError("");
  }, [form]);

  // Clear just the input fields (keep dialog content and success state intact)
  const resetFieldsOnly = useCallback(() => {
    form.reset({ caseId: "", audioFile: undefined, promptCategory: "", promptSubcategory: "" });
    try {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch {}
    setSelectedCategory(null);
    setSelectedSubcategory(null);
  }, [form]);

  useEffect(() => {
    return () => {
      if (dialogTimeoutRef.current) {
        clearTimeout(dialogTimeoutRef.current);
      }
    };
  }, []);

  // Update Dialog onOpenChange to reset form after successful upload
  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open && successMessage) {
      resetFormAndState();
    }
  };

  const selectedCategoryData = categories?.find(
    (cat: any) => cat.category_id === selectedCategory,
  );
  const selectedSubcategoryData = selectedCategoryData?.subcategories.find(
    (sub: any) => sub.subcategory_id === selectedSubcategory,
  );

  return (
    <>
      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Audio Upload & Conversion</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center mb-2">
            {(processing || isUploading) && (
              <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-2" />
            )}
            <div className="flex flex-col items-center gap-1 mb-2">
              <span className="text-xs font-semibold">Audio File Data Type: <span className="font-mono">{detectedFileType}</span></span>
              <span className="text-xs font-semibold">Detected Upload File Type: <span className="font-mono">{detectedFileType}</span></span>
              <span className="text-xs font-semibold">Detected Channel: <span className="font-mono">{detectedChannel}</span></span>
            </div>
          </div>

          {/* Overall Progress Bar */}
          {(processing || isUploading) && (
            <div className="mb-4">
              <div className="text-sm font-medium mb-2">Overall Progress: {progress}%</div>
              <Progress value={progress} className="mb-2 h-3" />
            </div>
          )}

          {/* Individual Step Progress */}
          {stepLabels.map((label, idx) => (
            <div key={idx} className="mb-1">
              <div className="text-xs font-medium mb-1">{label}</div>
              <Progress value={stepProgress[idx] || 0} className="mb-2 h-2" />
            </div>
          ))}

          {/* Upload Progress (separate from processing) */}
          {(uploadProgress > 0 && uploadProgress < 100) && (
            <div className="mb-2">
              <div className="text-xs font-medium mb-1">Uploading: {uploadProgress}%</div>
              <Progress value={uploadProgress} className="mb-2 h-2" />
            </div>
          )}
          {successMessage && (
            <div className="text-green-700 font-semibold mb-2">{successMessage}</div>
          )}
          {jobId && (
            <div className="text-blue-700 font-semibold mb-2">Job ID: {jobId}</div>
          )}
          {dialogError && (
            <div className="text-red-600 font-semibold mb-2">{dialogError}</div>
          )}
        </DialogContent>
      </Dialog>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <FormField
            control={form.control}
            name="caseId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Case ID</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Enter case ID"
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  Enter the case ID for this audio upload
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="audioFile"
            render={({ field: { value, onChange, ...fieldProps } }) => (
              <FormItem>
                <FormLabel>Audio File</FormLabel>
                <FormControl>
                  <Input
                    {...fieldProps}
                    ref={(node) => {
                      fileInputRef.current = node;
                      // Preserve RHF ref if present
                      const r: any = (fieldProps as any).ref;
                      if (typeof r === "function") r(node);
                      else if (r && typeof r === "object") r.current = node;
                    }}
                    type="file"
                    accept={approvedMimeTypes.join(",")}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      onChange(file);
                    }}
                  />
                </FormControl>
                <FormDescription>
                  Supported formats: {approvedExtensions.join(", ")}
                </FormDescription>
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
                <div className="flex gap-2">
                  <Select
                    value={field.value || selectedCategory || ""}
                    onValueChange={(value) => {
                      field.onChange(value);
                      setSelectedCategory(value);
                      setSelectedSubcategory(null);
                      form.setValue("promptSubcategory", "");
                    }}
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
                  disabled={!selectedCategory}
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
                  ([key, value]) => (
                    <div key={key} className="mb-4">
                      <h4 className="text-lg font-semibold">{key}</h4>
                      <ReactMarkdown remarkPlugins={[remarkGfm as any]}>
                        {String(value)}
                      </ReactMarkdown>
                    </div>
                  ),
                )}
              </CardContent>
            </Card>
          )}
          <Button type="submit" disabled={processing} className="px-8 py-2 text-base font-semibold rounded shadow-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors w-auto min-w-[180px] text-left">
            {processing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              "Upload and Process"
            )}
          </Button>
        </form>
      </Form>
    </>
  );
}
