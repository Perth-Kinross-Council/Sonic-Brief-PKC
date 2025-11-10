import { useEffect, useRef, useState } from "react";
import { userMessage } from '@/lib/errors';
import { RecordAudioHeader } from "@/components/record-audio/record-audio-header";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Mic, Loader2 } from "lucide-react";
import { getStorageItem } from "@/lib/storage";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import type { CategoryResponse, SubcategoryResponse } from "@/lib/api";
import { useFetchCategories, useFetchSubcategories, useUploadFile } from "@/lib/api";
import { generateUnifiedFileName, getSubcategoryName } from "@/utils/fileNaming";
import { useEnhancedUnifiedAuth } from "@/lib/useEnhancedUnifiedAuth";
import { getUserInfo } from "@/lib/user-info-util";
import { useMsal } from "@azure/msal-react";
import { AudioPlayer } from "@/components/media/AudioPlayer";

function RecordAudioPage() {
  // Authentication state
  const { isAuthenticated, isLoading: authLoading, error: authError, token } = useEnhancedUnifiedAuth();
  const router = useRouter();
  const { instance: msalInstance } = useMsal();

  // Get user information from authentication
  const userInfo = getUserInfo(msalInstance, token);
  const userEmail = userInfo.email || "user@example.com"; // Fallback for safety

  const [caseId, setCaseId] = useState("");
  const [serviceArea, setServiceArea] = useState("");
  const [visitMeeting, setVisitMeeting] = useState("");
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [sessionTime, setSessionTime] = useState(0);
  const [userName, setUserName] = useState<string>("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const [categories, setCategories] = useState<CategoryResponse[]>([]);
  const [subcategories, setSubcategories] = useState<SubcategoryResponse[]>([]);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);
  const SUCCESS_AUTO_CLOSE_MS = 5000;

  // Use MSAL-based API hooks
  const fetchCategoriesApi = useFetchCategories();
  const fetchSubcategoriesApi = useFetchSubcategories();
  const uploadFileApi = useUploadFile();

  // Add state for debugging API issues
  const [apiError, setApiError] = useState<string | null>(null);
  const [apiLoading, setApiLoading] = useState(false);

  useEffect(() => {
    // Wait for authentication to be ready before making API calls
  if (authLoading) {
      return;
    }

  if (!isAuthenticated) {
  // Navigate to login instead of showing transient banner
  router.navigate({ to: "/login" });
      return;
    }

  if (authError) {
      setApiError(`Authentication error: ${authError}`);
      return;
    }

    // Authentication is ready, now fetch categories
    setApiLoading(true);
    setApiError(null);
  // Removed commented debug logging: fetching categories

    fetchCategoriesApi()
  .then((data) => {
        setCategories(data);
        setApiError(null);
      })
  .catch((error) => {
        setApiError(userMessage(error, 'Failed to fetch categories'));
        setCategories([]);
      })
      .finally(() => {
        setApiLoading(false);
      });

    // Set user name from email - extract username part like audio upload form
    if (userEmail) {
      setUserName(userEmail.split("@")[0] || "User");
    } else {
      setUserName("User");
    }
  }, [authLoading, isAuthenticated, authError, userEmail]);

  useEffect(() => {
    if (serviceArea) {
      // Wait for authentication to be ready before making API calls
  if (authLoading) {
        return;
      }

  if (!isAuthenticated) {
        setApiError("User not authenticated. Please log in.");
        return;
      }

  // Removed commented debug logging: fetching subcategories
      setApiLoading(true);
      setApiError(null);

      fetchSubcategoriesApi(serviceArea)
  .then((data) => {
          setSubcategories(data);
          setApiError(null);
        })
  .catch((error) => {
          setApiError(userMessage(error, 'Failed to fetch subcategories'));
          setSubcategories([]);
        })
        .finally(() => {
          setApiLoading(false);
        });
      setVisitMeeting("");
    } else {
      setSubcategories([]);
      setVisitMeeting("");
    }
  }, [serviceArea, authLoading, isAuthenticated]);

  // Timer logic
  const startTimer = () => {
    timerRef.current = setInterval(() => {
      setSessionTime((t) => t + 1);
    }, 1000);
  };
  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
  };
  const resetTimer = () => {
    setSessionTime(0);
    stopTimer();
  };

  // Recording logic
  const startRecording = async () => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(null);
    setAudioBlob(null);
    resetTimer();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/mp4' });
    mediaRecorderRef.current = mediaRecorder;
    audioChunks.current = [];
    mediaRecorder.ondataavailable = (event) => {
      audioChunks.current.push(event.data);
    };
    mediaRecorder.onstop = () => {
      const blob = new Blob(audioChunks.current, { type: 'audio/mp4' });
      setAudioBlob(blob);
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
    };
    mediaRecorder.start();
    setRecording(true);
    setPaused(false);
    startTimer();
  };
  const pauseRecording = () => {
    mediaRecorderRef.current?.pause();
    setPaused(true);
    stopTimer();
  };
  const resumeRecording = () => {
    mediaRecorderRef.current?.resume();
    setPaused(false);
    startTimer();
  };
  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    setPaused(false);
    stopTimer();
  };

  const formatTime = (t: number) => {
    const m = String(Math.floor(t / 60)).padStart(2, "0");
    const s = String(t % 60).padStart(2, "0");
    return `${m}:${s}`;
  };

  const handleUpload = async () => {
    if (!audioBlob || !serviceArea || !visitMeeting) return;
    setUploading(true);
    try {
      // Convert CategoryResponse/SubcategoryResponse to the format expected by getSubcategoryName
      const allCategories = categories.map(cat => ({
        category_id: cat.id,
        category_name: cat.name,
        subcategories: subcategories
          .filter(sub => sub.category_id === cat.id)
          .map(sub => ({
            subcategory_id: sub.id,
            subcategory_name: sub.name,
            prompts: sub.prompts
          }))
      }));

      const subcategoryName = getSubcategoryName(allCategories, visitMeeting);

      // Generate unified filename
      const fileName = generateUnifiedFileName({
        subcategory: subcategoryName,
        caseId: caseId,
        username: userName,
        fileExtension: "mp4"
      });

      // Use MSAL-authenticated upload with unified filename
      await uploadFileApi(
        new File([audioBlob], fileName, { type: audioBlob.type }),
        serviceArea,
        visitMeeting,
  caseId,
  { recorded: true }
      );
      setSuccessMessage("Upload successful!");
      setDialogOpen(true);
      // Auto-close the success dialog after delay
      setTimeout(() => setDialogOpen(false), SUCCESS_AUTO_CLOSE_MS);
      // Reset form and clear current recording preview
      if (audioUrl) {
        try { URL.revokeObjectURL(audioUrl); } catch {}
      }
      setAudioUrl(null);
      setAudioBlob(null);
      setCaseId("");
      setServiceArea("");
      setVisitMeeting("");
      setSubcategories([]);
      resetTimer();
    } catch (error) {
      setDialogError("Upload failed. Please try again.");
      setDialogOpen(true);
    } finally {
      setUploading(false);
    }
  };

  const restartEligible = !recording && !!audioBlob && sessionTime > 2;
  const handleRestartClick = () => {
    if (restartEligible) {
      setRestartConfirmOpen(true);
    } else {
      startRecording();
    }
  };
  const confirmRestart = () => {
    setRestartConfirmOpen(false);
    // startRecording will clear current audio and begin a new recording
    startRecording();
  };

  // Suppress transient auth debug banners; do not render during auth load or unauthenticated state
  if (authLoading || !isAuthenticated) return null;

  return (
    <div className="space-y-4 p-4 pt-6 md:p-8">
      <RecordAudioHeader />

      {/* Main Content - only show when authenticated */}
      {(
        <>
          {/* Dialog for upload progress and result */}
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Audio Upload</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col items-center mb-2">
                {uploading && <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-2" />}
              </div>
              {successMessage && (
                <div className="text-green-700 font-semibold mb-2">{successMessage}</div>
              )}
              {dialogError && (
                <div className="text-red-600 font-semibold mb-2">{dialogError}</div>
              )}
            </DialogContent>
          </Dialog>
          {/* Confirm restart dialog */}
          <Dialog open={restartConfirmOpen} onOpenChange={setRestartConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Restart recording?</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  This will clear the current recording and start a new one. This action cannot be undone.
                </p>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    className="px-4 py-2 rounded border border-input"
                    onClick={() => setRestartConfirmOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="px-4 py-2 rounded bg-destructive text-white"
                    onClick={confirmRestart}
                  >
                    Ok
                  </button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <div className="flex justify-center w-full">
            <div className="w-full">
              {/* API Error Display */}
              {apiError && (
                <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded mb-4">
                  <strong>API Error:</strong> {apiError}
                </div>
              )}
              {apiLoading && (
                <></>
              )}
              <div className="bg-card text-card-foreground rounded-lg border shadow-sm">
                <form onSubmit={e => { e.preventDefault(); handleUpload(); }} className="space-y-4 p-6 w-full">
                  <div className="flex flex-col items-center mb-4">
                    <Mic className="h-12 w-12 mb-2 text-primary" />
                    <p className="text-center text-muted-foreground text-sm mb-2">
                      Please fill out the information below and begin recording your session. Press submit once the session has concluded.
                    </p>
                  </div>
                  <div className="space-y-3 w-full max-w-xl mx-auto">
        <div className="flex flex-row items-start gap-2 w-full">
                      <label className="w-40 font-medium pt-2">Case ID</label>
                      <input
        className="flex-1 w-full max-w-md bg-background border border-input rounded px-2 py-1 text-lg font-mono focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
                        value={caseId}
                        onChange={e => setCaseId(e.target.value)}
                        required
                        minLength={2}
                        placeholder="Enter Case ID"
                        title="Enter Case ID (min 2 characters)"
                      />
                    </div>
                    <div className="flex flex-row items-start gap-2 w-full">
                      <label className="w-40 font-medium pt-2">User</label>
                      <input
        className="flex-1 w-full max-w-md bg-muted border border-input rounded px-2 py-1 text-lg"
                        value={userEmail}
                        readOnly
                        required
                        title="User email"
                        placeholder="User email"
                      />
                    </div>
                    <div className="flex flex-row items-start gap-2 w-full">
                      <label htmlFor="serviceArea" className="w-40 font-medium pt-2">
                        Service Area
                      </label>
                      <select
                        id="serviceArea"
                        name="serviceArea"
        className="flex-1 w-full max-w-md bg-background border border-input rounded px-2 py-1 text-lg focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
                        value={serviceArea}
                        onChange={e => setServiceArea(e.target.value)}
                        required
                        title="Select Service Area"
                      >
                        <option value="">Select Service Area</option>
                        {categories.map((cat) => (
                          <option key={cat.id} value={cat.id}>{cat.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-row items-start gap-2 w-full">
                      <label htmlFor="visitMeeting" className="w-40 font-medium pt-2">
                        Service Function / Meeting
                      </label>
                      <select
                        id="visitMeeting"
                        name="visitMeeting"
        className={`flex-1 w-full max-w-md border border-input rounded px-2 py-1 text-lg focus:ring-2 focus:ring-primary focus:border-primary transition-colors bg-background ${!serviceArea ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : ''}`}
                        value={visitMeeting}
                        onChange={e => setVisitMeeting(e.target.value)}
                        required
                        disabled={!serviceArea}
                        title="Select Service Function"
                      >
                        <option value="">Select Service Function</option>
                        {subcategories.map((sub) => (
                          <option key={sub.id} value={sub.id}>{sub.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <hr className="my-2 border-muted" />
                  {/* Recording controls */}
      <div className="flex flex-col sm:flex-row justify-center gap-2 mb-2 w-full max-w-xl mx-auto">
                    {!recording ? (
                      <button
                        type="button"
                        className="w-full sm:w-48 bg-primary text-primary-foreground font-semibold rounded py-2 disabled:opacity-50 transition-colors"
        onClick={handleRestartClick}
                        disabled={!caseId || !serviceArea || !visitMeeting || uploading}
                      >
        {restartEligible ? "Restart" : "Start"}
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="w-full sm:w-40 bg-muted text-foreground font-semibold rounded py-2 transition-colors"
                          onClick={paused ? resumeRecording : pauseRecording}
                        >
                          {paused ? "Resume" : "Pause"}
                        </button>
                        <button
                          type="button"
                          className="w-full sm:w-40 bg-destructive text-white font-semibold rounded py-2 transition-colors"
                          onClick={stopRecording}
                        >
                          Stop
                        </button>
                      </>
                    )}
                    {/* inline restart warning removed; confirmation dialog is sufficient */}
                  </div>
                  <div className="flex flex-col sm:flex-row items-center justify-between mb-2 w-full gap-2 max-w-xl mx-auto">
                    <span className="font-medium">Session Time</span>
                    <span className="text-2xl font-mono">{formatTime(sessionTime)}</span>
                  </div>
                   <button
                    type="submit"
                    className="block w-full sm:w-48 bg-primary text-primary-foreground font-bold rounded py-2 mt-2 disabled:opacity-50 transition-colors mx-auto"
                    disabled={recording || uploading || !audioBlob}
                  >
                    {uploading ? "Uploading..." : "Submit"}
                  </button>
                  {audioUrl && (
                    <AudioPlayer src={audioUrl} className="max-w-xl mx-auto mt-4" />
                  )}
                </form>
              </div>
            </div>
          </div>
        </>
  )}
    </div>
  );
}

export const Route = createFileRoute("/_layout/record-audio/")({
  beforeLoad: () => {
    const role = getStorageItem("role", "standard");
    if (role !== "admin" && role !== "standard") {
      return redirect({ to: "/" });
    }
  },
  component: RecordAudioPage,
});
