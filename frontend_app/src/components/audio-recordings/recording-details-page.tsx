import { useUnifiedAccessToken, useFetchJobTranscription, type AudioRecording } from "@/lib/api";
import { TRANSCRIPTION_API, JOBS_API } from "@/lib/apiConstants";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAudioPlayer } from "@/hooks/use-audio-player";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useGetUserProfile } from "@/lib/enhancedApi";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Calendar,
  Download,
  FileAudio,
  FileText,
  Pause,
  Play,
  RefreshCw,
  Tag,
  User,
  Volume2,
  VolumeX,
} from "lucide-react";

interface ExtendedAudioRecording extends AudioRecording {
  analysis_text?: string;
  file_name?: string;
}

interface RecordingDetailsPageProps {
  recording: ExtendedAudioRecording;
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

export function RecordingDetailsPage({ recording }: RecordingDetailsPageProps) {
  const fetchTranscription = useFetchJobTranscription();
  const getToken = useUnifiedAccessToken();
  const getUserProfile = useGetUserProfile();
  const [userRole, setUserRole] = useState<string | null>(null);
  const [roleLoaded, setRoleLoaded] = useState(false);
  
  const { data: transcriptionText, refetch: refetchTranscription } = useQuery({
    queryKey: ["sonic-brief", "audio-recordings", "transcription", recording.id],
    queryFn: () => fetchTranscription(recording.id),
    enabled: !!recording.id,
  });

  const {
    audioRef,
    isPlaying,
    isMuted,
    currentTime,
    duration,
    displayVolume,
    togglePlayPause,
    toggleMute,
    handleTimeSliderChange,
    handleVolumeSliderChange,
    formattedCurrentTime,
    formattedDuration,
  } = useAudioPlayer(recording.file_path);

  // Load user role for conditional download controls
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const profile = await getUserProfile();
        if (!mounted) return;
        setUserRole(profile?.role || null);
      } catch {
        if (!mounted) return;
        setUserRole(null);
      } finally {
        if (mounted) setRoleLoaded(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="relative container mx-auto px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link to="/audio-recordings">
            <Button
              variant="outline"
              size="icon"
              className="hover:cursor-pointer"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Audio Recording Details</h1>
            <Breadcrumb className="text-muted-foreground text-sm">
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link to="/audio-recordings">Recordings</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{recording.id}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <span className="bg-primary/10 rounded-full p-2">
                  <FileAudio className="text-primary h-5 w-5" />
                </span>
                Recording
              </CardTitle>
            </CardHeader>
            <CardContent>
              <audio
                ref={audioRef}
                src={recording.file_path}
                preload="metadata"
                className="hidden"
              />

              <div className="bg-secondary/30 mb-4 rounded-lg p-4">
                <div className="mb-3 flex items-center gap-4">
                  <Button
                    size="icon"
                    className="bg-primary text-primary-foreground hover:bg-primary/80 h-10 w-10 rounded-full"
                    onClick={togglePlayPause}
                  >
                    {isPlaying ? (
                      <Pause className="size-5" />
                    ) : (
                      <Play className="size-5" />
                    )}
                  </Button>

                  <div className="flex flex-1 items-center gap-3">
                    <span className="text-sm">{formattedCurrentTime}</span>
                    <Slider
                      value={[currentTime]}
                      max={duration || 100}
                      step={1}
                      className="flex-1 cursor-pointer"
                      onValueChange={handleTimeSliderChange}
                    />
                    <span className="text-sm">{formattedDuration}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" onClick={toggleMute}>
                      {isMuted ? (
                        <VolumeX className="size-5" />
                      ) : (
                        <Volume2 className="size-5" />
                      )}
                    </Button>
                    <Slider
                      value={[displayVolume]}
                      max={100}
                      step={1}
                      className="w-20 cursor-pointer"
                      onValueChange={handleVolumeSliderChange}
                    />
                  </div>
                </div>

                <div className="flex justify-center">
                  <Button
                    className="w-full sm:w-auto"
                    disabled={!(roleLoaded && (userRole === "admin" || userRole === "power_user"))}
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
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download Audio
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Tag className="text-muted-foreground h-4 w-4 flex-shrink-0" />
                    <span className="flex-shrink-0 text-sm font-medium">
                      Job ID:
                    </span>
                    <code className="bg-secondary/50 rounded px-1.5 py-0.5 text-sm">
                      {recording.id}
                    </code>
                  </div>

                  <div className="flex items-center gap-2">
                    <User className="text-muted-foreground h-4 w-4 flex-shrink-0" />
                    <span className="flex-shrink-0 text-sm font-medium">
                      User ID:
                    </span>
                    <code className="bg-secondary/50 rounded px-1.5 py-0.5 text-sm">
                      {recording.user_id}
                    </code>
                  </div>

                  <div className="flex items-center gap-2">
                    <RefreshCw className="text-muted-foreground h-4 w-4 flex-shrink-0" />
                    <span className="flex-shrink-0 text-sm font-medium">
                      Status:
                    </span>
                    <Badge
                      className={cn(
                        "flex min-w-[100px] items-center justify-center rounded-md px-4 py-1 text-xs",
                        statusStyles[recording.status] || statusStyles.default,
                      )}
                    >
                      {recording.status.charAt(0).toUpperCase() +
                        recording.status.slice(1)}
                    </Badge>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Calendar className="text-muted-foreground h-4 w-4 flex-shrink-0" />
                    <span className="flex-shrink-0 text-sm font-medium">
                      Created:
                    </span>
                    <span className="text-sm">
                      {new Date(recording.created_at).toLocaleString()}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Calendar className="text-muted-foreground h-4 w-4 flex-shrink-0" />
                    <span className="flex-shrink-0 text-sm font-medium">
                      Updated:
                    </span>
                    <span className="text-sm">
                      {new Date(recording.updated_at).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <div className="flex items-start gap-2">
                  <Tag className="text-muted-foreground mt-1 h-4 w-4 flex-shrink-0" />
                  <div>
                    <div className="flex items-center">
                      <span className="mr-1 flex-shrink-0 text-sm font-medium">
                        Category:
                      </span>
                      <code className="bg-secondary/50 rounded px-2 py-1 text-sm break-all">
                        {recording.prompt_category_id || "N/A"}
                      </code>
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <Tag className="text-muted-foreground mt-1 h-4 w-4 flex-shrink-0" />
                  <div>
                    <div className="flex items-center">
                      <span className="mr-1 flex-shrink-0 text-sm font-medium">
                        Subcategory:
                      </span>
                      <code className="bg-secondary/50 rounded px-2 py-1 text-sm break-all">
                        {recording.prompt_subcategory_id || "N/A"}
                      </code>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="transcription" className="w-full">
            <TabsList className="mb-4 grid grid-cols-2">
              <TabsTrigger value="transcription">Transcription</TabsTrigger>
              <TabsTrigger value="analysis">Analysis</TabsTrigger>
            </TabsList>

            <TabsContent value="transcription" className="mt-0">
              <Card className="border-0 bg-transparent shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2">
                    <span className="bg-primary/10 rounded-full p-2">
                      <FileText className="text-primary h-5 w-5" />
                    </span>
                    Transcription
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {transcriptionText ? (
                    <div className="mb-4 rounded-lg bg-gray-100 p-4 shadow-md dark:bg-gray-800">
                      <pre className="text-sm whitespace-pre-wrap">
                        {transcriptionText}
                      </pre>
                    </div>
                  ) : (
                    <div className="mb-4">
                      <div className="flex flex-col items-center justify-center rounded-lg bg-gray-100 p-4 py-8 shadow-md dark:bg-gray-800">
                        <p className="text-muted-foreground mb-6 text-center">
                          Transcription data is not loaded. Click the button
                          below to load the transcription.
                        </p>
                        <Button
                          onClick={() => refetchTranscription()}
                          className="px-8"
                        >
                          Load Transcription
                        </Button>
                      </div>
                    </div>
                  )}

                  {recording.transcription_file_path && (
                    <div className="flex justify-center">
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
                        className="w-full max-w-md rounded-lg font-semibold shadow-md"
                        disabled={!recording.transcription_file_path}
                      >
                        <Download className="me-2 h-4 w-4" />
                        Download Transcription TXT
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="analysis" className="mt-0">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2">
                    <span className="bg-primary/10 rounded-full p-2">
                      <FileText className="text-primary h-5 w-5" />
                    </span>
                    Analysis Summary
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {recording.analysis_text ? (
                    <>
                      <div className="mb-4 rounded-lg bg-gray-100 p-4 shadow-md dark:bg-gray-800">
                        {recording.analysis_text
                          .split("\n\n")
                          .map((section: string, index: number) => {
                            const lines = section.split("\n");
                            const title = lines[0];
                            const content = lines.slice(1);

                            return (
                              <div key={index} className="mt-4">
                                <h4 className="text-md font-semibold">
                                  {title}
                                </h4>
                                <ul className="mt-2 list-inside list-disc text-sm text-gray-700 dark:text-gray-300">
                                  {content.map(
                                    (point: string, subIndex: number) => (
                                      <li key={subIndex}>{point}</li>
                                    ),
                                  )}
                                </ul>
                              </div>
                            );
                          })}
                      </div>
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
                        className="mt-2 w-full rounded-lg font-semibold shadow-md"
                        disabled={!recording.analysis_file_path}
                      >
                        <Download className="me-2 h-4 w-4" />
                        Download Analysis PDF
                      </Button>
                    </>
                  ) : (
                    <p className="text-muted-foreground">
                      No analysis available for this recording.
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
