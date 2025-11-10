import { useQuery } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { FileAudio, FileText, Loader2 } from "lucide-react";
import { useFetchCategories, useFetchSubcategories, useUnifiedAccessToken, type AudioRecording } from "@/lib/api";
import { userMessage } from '@/lib/errors';
import { debug } from "@/lib/debug"; // centralized gated logging
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useFetchTranscription } from "@/api/audio-recordings";
import { TRANSCRIPTION_API, JOBS_API } from "@/lib/apiConstants";
import { apiClient, useGetUserProfile } from "@/lib/enhancedApi";
import { useEnhancedUnifiedAuth } from "@/lib/useEnhancedUnifiedAuth";
import MDPreview from "@uiw/react-markdown-preview";
import AudioPlayer from "@/components/media/AudioPlayer";


// Add the analysis_text property to extend the AudioRecording type
interface ExtendedAudioRecording extends AudioRecording {
  analysis_text?: string;
  case_id?: string; // Add case_id to match AudioRecording
}

interface ViewDetailsDialogProps {
  recording: ExtendedAudioRecording;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusStyles: Record<string, string> = {
  completed:
    "bg-green-500 text-white border border-green-700 shadow-md px-4 py-1 rounded-full",
  processing:
    "bg-yellow-500 text-black border border-yellow-600 shadow-md px-4 py-1 rounded-full",
  uploaded:
    "bg-blue-500 text-white border border-blue-700 shadow-md px-4 py-1 rounded-full",
  failed:
    "bg-red-500 text-white border border-red-700 shadow-md px-4 py-1 rounded-full",
  error:
    "bg-red-500 text-white border border-red-700 shadow-md px-4 py-1 rounded-full",
  default:
    "bg-gray-500 text-white border border-gray-600 shadow-md px-4 py-1 rounded-full",
};

export function ViewDetailsDialog({
  recording,
  open,
  onOpenChange,
}: ViewDetailsDialogProps) {
  // Add debug auth state logging (reduced)
  const authState = useEnhancedUnifiedAuth();
  const getToken = useUnifiedAccessToken();

  // Fetch user profile to check role for download button visibility
  const getUserProfile = useGetUserProfile();
  const [userRole, setUserRole] = useState<string | null>(null);
  const [roleLoaded, setRoleLoaded] = useState(false);

  // Fetch user profile when modal opens
  useEffect(() => {
    if (open) {
      setRoleLoaded(false);
      // Use async function inside useEffect to handle promise properly
      const fetchUserRole = async () => {
        try {
          // Diagnostic (non-fatal) – gated via debug helper
          debug.log('Starting user profile fetch...');
          const profile = await getUserProfile();
          debug.log('User profile fetched successfully:', profile);
          const role = profile?.role || null;
          debug.log('User role extracted:', role);
          setUserRole(role);
          setRoleLoaded(true);
        } catch (error) {
          const err = error as any;
          console.error('Failed to fetch user profile:', err);
          console.error('Error details:', {
            message: err?.message,
            stack: err?.stack,
            name: err?.name
          });
          setUserRole(null);
          setRoleLoaded(true);
        }
      };
      fetchUserRole();
    } else {
      // Reset state when modal closes
      setUserRole(null);
      setRoleLoaded(false);
    }
  }, [open]); // CRITICAL FIX: Remove all authState dependencies to prevent infinite loops

  // Using Plyr-based audio component; no native ellipsis/download UI

  // Log auth state when modal opens (only if there are serious authentication issues)
  if (open && !authState.isAuthenticated && !authState.isLoading && authState.error) {
    // Auth diagnostic – not user blocking, so use gated warn
    debug.warn('🔍 Modal Auth Issue:', {
      error: authState.error,
      recordingId: recording.id
    });
  }

  // Use React Query for data fetching - simple and clean like the reference
  const fetchCategories = useFetchCategories();
  const fetchSubcategories = useFetchSubcategories();
  const fetchTranscription = useFetchTranscription();

  // Query for categories - only fetch when modal is open
  const { data: categories, isLoading: categoriesLoading, error: categoriesError } = useQuery({
    queryKey: ["sonic-brief", "modal", "categories"],
    queryFn: fetchCategories,
    enabled: open, // Only fetch when modal is open
    retry: (failureCount, error) => {
      // Don't retry auth errors indefinitely
      if (error.message.includes('Authentication')) {
        return failureCount < 3;
      }
      return failureCount < 2;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * Math.pow(2, attemptIndex), 5000), // Exponential backoff
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Fix the subcategories query - pass function wrapped in arrow function
  const { data: subcategories, isLoading: subcategoriesLoading, error: subcategoriesError } = useQuery({
    queryKey: ["sonic-brief", "modal", "subcategories"],
    queryFn: () => fetchSubcategories(),
    enabled: open, // Only fetch when modal is open
    retry: (failureCount, error) => {
      // Don't retry auth errors indefinitely
      if (error.message.includes('Authentication')) {
        return failureCount < 3;
      }
      return failureCount < 2;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * Math.pow(2, attemptIndex), 5000), // Exponential backoff
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Ready-state helpers
  const transcriptReady = !!recording?.transcription_file_path;
  const analysisReady = !!recording?.analysis_file_path || !!recording?.analysis_text;

  // Query for transcription - only fetch when modal is open and transcript is ready
  const { data: transcriptionText, isLoading: transcriptionLoading, error: transcriptionError } = useQuery({
    queryKey: ["sonic-brief", "modal", "transcription", recording.id],
    queryFn: () => fetchTranscription(recording.id!),
    enabled: open && !!recording.id && transcriptReady, // Only fetch when transcript is available
    retry: (failureCount, error) => {
      // Don't retry auth errors indefinitely
      if (error.message.includes('Authentication')) {
        return failureCount < 3;
      }
      return failureCount < 2;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * Math.pow(2, attemptIndex), 5000), // Exponential backoff
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Simple name resolution - just like the reference implementations
  const categoryName = categories?.find(c => c.id === recording.prompt_category_id)?.name || recording.prompt_category_id || "N/A";
  const subcategoryName = subcategories?.find(s => s.id === recording.prompt_subcategory_id)?.name || recording.prompt_subcategory_id || "N/A";

  // Determine loading states
  const isLoadingTranscription = transcriptionLoading;
  const isLoadingNames = categoriesLoading || subcategoriesLoading;

  // Supported audio file extensions
  const supportedAudioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.webm', '.mp4'];
  const filePath = (recording.file_path || '').split('?')[0].toLowerCase(); // Remove query params and lowercase
  const isAudioFile = !!filePath && supportedAudioExtensions.some(ext => filePath.endsWith(ext));

  // Log a view when the dialog opens (server-side audit via GET /upload/jobs?job_id=...&view=true)
  // Ensure we only fire once per open for a given recording.id
  const viewedRef = useRef<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        if (!open || !recording?.id) return;
        if (viewedRef.current === recording.id) return; // already logged for this open
        // Use enhanced API client to ensure token handling and retries
        await apiClient.get(`/upload/jobs?job_id=${encodeURIComponent(recording.id)}&view=true`, {
          // Avoid caching so it shows up clearly in network traces
          cache: "no-store",
          signal: controller.signal,
        } as RequestInit);
        viewedRef.current = recording.id;
      } catch {
        // best-effort; ignore
      }
    })();
    return () => {
      controller.abort();
      if (!open) viewedRef.current = null; // reset when dialog closes
    };
  }, [open, recording?.id]);


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[90vh] w-full max-w-[1100px] rounded-xl bg-white text-black shadow-lg dark:bg-gray-900 dark:text-white flex flex-row p-0 overflow-hidden">
        {/* Left Panel: Tabs only */}
        <div className="flex-1 min-w-0 flex flex-col gap-6 p-6 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold mb-4 flex items-center gap-2">
              {/* Icon for job type */}
              {isAudioFile ? (
                <FileAudio className="w-7 h-7 text-blue-600 dark:text-blue-400" />
              ) : (
                <FileText className="w-7 h-7 text-green-600 dark:text-green-400" />
              )}
              Audio Recording Details
            </DialogTitle>
            <DialogDescription>
              View transcription, analysis, and download options for this audio recording.
            </DialogDescription>
          </DialogHeader>
          {/* Tabs for Transcription and Analysis */}
          <Tabs key={recording.id} defaultValue="transcription" className="w-full mt-6">
            <TabsList className="mb-4 grid grid-cols-2">
              <TabsTrigger value="transcription">Transcription</TabsTrigger>
              <TabsTrigger value="analysis">Analysis</TabsTrigger>
            </TabsList>
            <TabsContent value="transcription">
              <h3 className="text-md mb-1 flex items-center font-semibold">
                <FileText className="mr-2" /> Transcription
              </h3>
              <div className="rounded-lg bg-gray-100 p-3 text-sm whitespace-pre-wrap dark:bg-gray-800 overflow-auto max-h-[60vh]">
                {!transcriptReady ? (
                  <span className="flex items-center gap-2 italic text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Transcription is being prepared. Please check back shortly.
                  </span>
                ) : isLoadingTranscription ? (
                  <span className="italic text-gray-400">Loading transcript...</span>
                ) : transcriptionError ? (
                  <span className="italic text-red-500">{userMessage(transcriptionError, 'Failed to load transcription')}</span>
                ) : transcriptionText ? (
                  <pre className="whitespace-pre-wrap">{transcriptionText}</pre>
                ) : (
                  <span className="italic text-gray-400">No transcription available for this recording.</span>
                )}
              </div>
            </TabsContent>
            <TabsContent value="analysis">
              <h3 className="text-md mb-1 flex items-center font-semibold">
                <FileText className="mr-2" /> Analysis Summary
              </h3>
              {recording.analysis_text ? (
                <div className="mb-4 rounded-lg bg-gray-100 p-4 shadow-md dark:bg-gray-800 overflow-auto max-h-[60vh]">
                  <MDPreview source={recording.analysis_text} style={{ background: 'transparent' }} />
                </div>
              ) : !analysisReady ? (
                <div className="rounded-lg bg-gray-100 p-3 text-sm whitespace-pre-wrap dark:bg-gray-800 overflow-auto max-h-[60vh]">
                  <span className="flex items-center gap-2 italic text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Analysis is being prepared. Please check back shortly.
                  </span>
                </div>
              ) : (
                <div className="rounded-lg bg-gray-100 p-3 text-sm whitespace-pre-wrap dark:bg-gray-800 overflow-auto max-h-[60vh]">
                  <span className="italic text-gray-400">No analysis available for this recording.</span>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
        {/* Right Panel: Details and Audio Player */}
        <div className="w-[350px] min-w-[320px] max-w-[400px] flex-shrink-0 flex flex-col gap-6 p-6 bg-gray-50 dark:bg-gray-800">
          <div className="space-y-4">
            {/* Recording Details Section */}
            <div>
              <h3 className="text-lg font-semibold mb-2">Recording Details</h3>
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Job ID:</span>
                  <span className="break-all">{recording.id}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">Case ID:</span>
                  <span>{recording.case_id || "-"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">User:</span>
                  <span>{recording.user_id}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">Status:</span>
                  <Badge className={cn("px-2 py-0.5 text-xs", statusStyles[recording.status] || statusStyles.default)}>
                    {recording.status.charAt(0).toUpperCase() + recording.status.slice(1)}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">Service Area:</span>
                  <span>
                    {isLoadingNames ? "Loading..." :
                     categoriesError ? "Error loading" :
                     categoryName}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">Service Function:</span>
                  <span>
                    {isLoadingNames ? "Loading..." :
                     subcategoriesError ? "Error loading" :
                     subcategoryName}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">Created:</span>
                  <span>{new Date(recording.created_at).toLocaleString()}</span>
                </div>
              </div>
            </div>
            <div className="my-4 border-t border-gray-300 dark:border-gray-700" />
            {/* Recording Section */}
            {isAudioFile && (
              <>
                <div onContextMenu={(e) => e.preventDefault()}>
                  <h3 className="flex items-center text-lg font-semibold mb-2">
                    <FileAudio className="mr-2" /> Recording
                  </h3>
                  <div className="rounded-lg bg-gray-200 p-3 shadow-md dark:bg-gray-800">
                    <AudioPlayer src={recording.file_path} />
                  </div>
                </div>
                <div className="my-4 border-t border-gray-300 dark:border-gray-700" />
              </>
            )}
            {/* Actions Section */}
            <div>
              <h3 className="text-lg font-semibold mb-2">Actions</h3>
              <div className="flex flex-col gap-2">
                {/* Debug: Show role visibility info */}
                {import.meta.env.DEV && (
                  <div className="text-xs text-gray-500 p-2 bg-gray-100 rounded">
                    Debug - isAudioFile: {isAudioFile ? 'true' : 'false'},
                    roleLoaded: {roleLoaded ? 'true' : 'false'},
                    userRole: "{userRole || 'null'}",
                    showDownload: {(isAudioFile && roleLoaded && (userRole === "admin" || userRole === "power_user")) ? 'true' : 'false'}
                  </div>
                )}
                {isAudioFile && roleLoaded && (userRole === "admin" || userRole === "power_user") && (
                  <Button
                    onClick={async () => {
                      try {
                        const token = await getToken();
                        const resp = await fetch(`${JOBS_API}?job_id=${encodeURIComponent(recording.id)}&download=true&download_resource=audio`, {
                          headers: { Authorization: `Bearer ${token}` }
                        });
                        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                        const data = await resp.json();
                        const job = (data?.jobs || [])[0];
                        const url = job?.file_path;
                        if (url) window.open(url, "_blank");
                      } catch (e) {
                        console.error('Failed to audit/open audio', e);
                      }
                    }}
                    variant="outline"
                    className="w-full rounded-lg font-semibold shadow-md"
                  >
                    Download Audio Recording
                  </Button>
                )}
        <Button
                  onClick={async () => {
                    if (!recording.id) return;
                    try {
          const token = await getToken();
          const resp = await fetch(`${TRANSCRIPTION_API}/${recording.id}?download=true`, {
                        headers: { Authorization: `Bearer ${token}` }
                      });
                      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                      const blob = await resp.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `transcription-${recording.id}.txt`;
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      URL.revokeObjectURL(url);
                    } catch (e) {
                      console.error('Failed to download transcript', e);
                    }
                  }}
                  variant="outline"
                  className="w-full rounded-lg font-semibold shadow-md"
                  disabled={!recording.transcription_file_path}
                >
                  Download Transcript
                </Button>
                <Button
                  onClick={async () => {
                    try {
                      const token = await getToken();
                      const resp = await fetch(`${JOBS_API}?job_id=${encodeURIComponent(recording.id)}&download=true&download_resource=analysis`, {
                        headers: { Authorization: `Bearer ${token}` }
                      });
                      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                      const data = await resp.json();
                      const job = (data?.jobs || [])[0];
                      const url = job?.analysis_file_path;
                      if (url) window.open(url, "_blank");
                    } catch (e) {
                      console.error('Failed to audit/open analysis', e);
                    }
                  }}
                  variant="outline"
                  className="w-full rounded-lg font-semibold shadow-md"
                  disabled={!recording.analysis_file_path}
                >
                  Download Analysis
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
