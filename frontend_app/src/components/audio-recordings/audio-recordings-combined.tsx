import type { AudioListValues } from "@/schema/audio-list.schema";
import { useMemo, useState, useRef, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Toggle } from "@/components/ui/toggle";

import { cn } from "@/lib/utils";
import { useFetchJobs, useFetchCategories, useFetchSubcategories } from "@/lib/api";
import { audioListSchema, statusEnum } from "@/schema/audio-list.schema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Eye, RefreshCcw, List, Grid3X3, Play, Square, FileAudio, Upload } from "lucide-react";
import { useForm } from "react-hook-form";
import { ViewDetailsDialog } from "./view-details-dialog";

// Get retention days from env (default to 30 if not set)
const RETENTION_DAYS = Number(import.meta.env.VITE_JOB_RETENTION_DAYS) || 30;

const statusVariants: Record<string, string> = {
  completed: "bg-green-500 text-white",
  processing: "bg-yellow-500 text-black",
  uploaded: "bg-blue-500 text-white",
  failed: "bg-red-500 text-white",
  default: "bg-gray-400 text-white",
};

const RECORDS_PER_PAGE = 9;

// Supported audio file extensions based on Azure Function configuration
const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  '.wav', '.pcm', '.mp3', '.ogg', '.opus', '.flac', '.alaw', '.mulaw',
  '.mp4', '.wma', '.aac', '.amr', '.webm', '.m4a', '.spx'
]);

// Improved helper function to check if file extension is supported for audio playback
const isSupportedAudioFile = (filePath: string): boolean => {
  if (!filePath) return false;
  // Remove query params and fragments
  const cleanPath = filePath.split('?')[0].split('#')[0];
  const lastDot = cleanPath.lastIndexOf('.');
  if (lastDot === -1) return false;
  const extension = cleanPath.substring(lastDot).toLowerCase();
  return SUPPORTED_AUDIO_EXTENSIONS.has(extension);
};

// Helper function to get the file type icon based on file extension
const getFileTypeIcon = (filePath: string) => {
  if (!filePath) return null;

  // Remove query params and fragments
  const cleanPath = filePath.split('?')[0].split('#')[0];
  const lastDot = cleanPath.lastIndexOf('.');
  if (lastDot === -1) return null;

  const extension = cleanPath.substring(lastDot).toLowerCase();
    // Check if it's a supported audio file
  if (SUPPORTED_AUDIO_EXTENSIONS.has(extension)) {
    return <FileAudio className="h-5 w-5 text-blue-600" />;
  }

  // Check if it's a text file
  if (extension === '.txt') {
    return <Upload className="h-5 w-5 text-green-600" />;
  }

  return null;
};

export function AudioRecordingsCombined({
  initialFilters,
}: {
  initialFilters: AudioListValues;
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedRecording, setSelectedRecording] = useState<any>(null);
  // Default to cards view on mobile, list view on desktop, but allow manual override
  const [viewMode, setViewMode] = useState<'list' | 'cards'>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 768 ? 'cards' : 'list';
    }
    return 'list';
  });

  // Audio playback state
  const [currentlyPlayingId, setCurrentlyPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const router = useRouter();

  const form = useForm<AudioListValues>({
    defaultValues: initialFilters,
    resolver: zodResolver(audioListSchema),
  });

  const watchedFilters = form.watch();

  const cleanedFilters = useMemo(() => {
    const { job_id, case_id, status, created_at, prompt_category_id, prompt_subcategory_id } = watchedFilters;
    return {
      job_id: job_id || undefined,
      case_id: case_id || undefined,
      status: status === "all" ? undefined : status,
      created_at: created_at || undefined,
      prompt_category_id: prompt_category_id || undefined,
      prompt_subcategory_id: prompt_subcategory_id || undefined,
    };
  }, [watchedFilters]);

  const fetchJobs = useFetchJobs();
  const fetchCategories = useFetchCategories();
  const fetchSubcategories = useFetchSubcategories();

  const {
    data: audioRecordings,
    isLoading,
    refetch: refetchJobs,
  } = useQuery({
    queryKey: ["sonic-brief", "audio-recordings", cleanedFilters],
    queryFn: () => fetchJobs(cleanedFilters),
    select: (data) => data.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    ),
  });

  // Fetch categories and subcategories
  const { data: categories } = useQuery({
    queryKey: ["sonic-brief", "prompt-management", "categories"],
    queryFn: fetchCategories,
  });

  const { data: subcategories } = useQuery({
    queryKey: ["sonic-brief", "prompt-management", "subcategories"],
    queryFn: () => fetchSubcategories(),
  });

  // Refresh Handler (Keep Filters)
  const handleRefresh = async () => {
    await refetchJobs();
  };

  // Audio playback handlers
  const handlePlayAudio = (recording: any) => {
    if (currentlyPlayingId === recording.id) {
      // If the same audio is playing, stop it
      handleStopAudio();
    } else {
      // Stop any currently playing audio
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }

      // Create new audio element for the selected recording
      const audio = new Audio(recording.file_path);
      audioRef.current = audio;
      setCurrentlyPlayingId(recording.id);

      // Set up event listeners
      audio.addEventListener('ended', () => {
        setCurrentlyPlayingId(null);
        audioRef.current = null;
      });

      audio.addEventListener('error', () => {
        console.error('Error playing audio:', recording.file_path);
        setCurrentlyPlayingId(null);
        audioRef.current = null;
      });

      // Play the audio
      audio.play().catch((error) => {
        console.error('Error playing audio:', error);
        setCurrentlyPlayingId(null);
        audioRef.current = null;
      });
    }
  };

  const handleStopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setCurrentlyPlayingId(null);
    audioRef.current = null;
  };

  // Cleanup audio when component unmounts
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Reset button handler - clears filters
  const handleReset = async () => {
    form.reset({ job_id: "", case_id: "", status: "all", created_at: "", prompt_category_id: "", prompt_subcategory_id: "" });
    setFilterCategory("");
    setFilterSubcategory("");
    await refetchJobs();
  };

  // Build ID-to-name maps for fast lookup
  const categoryMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (categories) {
      for (const cat of categories) {
        map[cat.id] = cat.name;
      }
    }
    return map;
  }, [categories]);

  const subcategoryMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (subcategories) {
      for (const sub of subcategories) {
        map[sub.id] = sub.name;
      }
    }
    return map;
  }, [subcategories]);

  // Service Area (category) and Service Function (subcategory) filter state
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [filterSubcategory, setFilterSubcategory] = useState<string>("");

  // Filter subcategories based on selected category for display purposes
  const filteredSubcategories = useMemo(() => {
    if (!subcategories) return [];

    // If no category is selected, show all subcategories
    if (!filterCategory) {
      return subcategories;
    }

    // Filter subcategories to only show those belonging to the selected category
    return subcategories.filter(sub => sub.category_id === filterCategory);
  }, [subcategories, filterCategory]);

  // Pagination Logic
  const totalPages = Math.ceil(
    (audioRecordings?.length || 0) / RECORDS_PER_PAGE,
  );

  const paginatedData = audioRecordings?.slice(
    (currentPage - 1) * RECORDS_PER_PAGE,
    currentPage * RECORDS_PER_PAGE,
  );

  return (
    // Wrapper uses only vertical spacing; parent layout supplies container width & padding like other pages
    <div className="space-y-6">
  {/* Search Filters Section */}
  <Card className="audio-recordings-filters-card w-full">
        <CardHeader>
          <CardTitle>Search & Filter Audio Recordings</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className="audio-recordings-filter-form w-full">
              {/* Responsive flex grid layout that allows wrapping */}
              <div className="flex flex-wrap gap-4 items-end">
                <div className="flex-1 min-w-[200px] max-w-[280px]">
                  <FormField
                    control={form.control}
                    name="job_id"
                    render={({ field }) => (
                      <FormItem className="w-full">
                        <FormLabel>Job ID</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter Job ID" {...field} className="w-full" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="flex-1 min-w-[200px] max-w-[280px]">
                  <FormField
                    control={form.control}
                    name="case_id"
                    render={({ field }) => (
                      <FormItem className="w-full">
                        <FormLabel>Case ID</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter Case ID" {...field} className="w-full" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="flex-1 min-w-[180px] max-w-[250px]">
                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem className="w-full">
                        <FormLabel>Status</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                          <SelectContent>
                            {statusEnum.options.map((status) => (
                              <SelectItem key={status} value={status}>
                                {status.charAt(0).toUpperCase() + status.slice(1)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="flex-1 min-w-[200px] max-w-[280px]">
                  <FormField
                    control={form.control}
                    name="created_at"
                    render={({ field }) => (
                      <DatePicker
                        field={field}
                        label="Upload Date"
                        placeholder="Pick an upload date"
                      />
                    )}
                  />
                </div>
                {/* Service Area (Category) Filter */}
                <div className="flex-1 min-w-[220px] max-w-[300px]">
                  <FormItem className="w-full">
                    <FormLabel>Service Area</FormLabel>
                    <Select
                      value={filterCategory}
                      onValueChange={(val) => {
                        const newVal = val === "all-category" ? "" : val;
                        setFilterCategory(newVal);
                        form.setValue("prompt_category_id", newVal);

                        // Check if current subcategory belongs to the new category
                        if (filterSubcategory && newVal && subcategories) {
                          const currentSubcategory = subcategories.find(sub => sub.id === filterSubcategory);
                          if (currentSubcategory && currentSubcategory.category_id !== newVal) {
                            // Reset subcategory if it doesn't belong to the new category
                            setFilterSubcategory("");
                            form.setValue("prompt_subcategory_id", "");
                          }
                        }
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select Service Area" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all-category">All</SelectItem>
                        {categories?.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                </div>
                {/* Service Function (Subcategory) Filter */}
                <div className="flex-1 min-w-[220px] max-w-[300px]">
                  <FormItem className="w-full">
                    <FormLabel>Service Function</FormLabel>
                    <Select
                      value={filterSubcategory}
                      onValueChange={(val) => {
                        const newVal = val === "all-subcategory" ? "" : val;
                        setFilterSubcategory(newVal);
                        form.setValue("prompt_subcategory_id", newVal);
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select Service Function" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all-subcategory">All</SelectItem>
                        {filteredSubcategories.map((sub) => (
                          <SelectItem key={sub.id} value={sub.id}>{sub.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                </div>
              </div>
            </form>
          </Form>

          {/* Control Buttons */}
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mt-6 pt-4 border-t">
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={isLoading}
              type="reset"
            >
              <RefreshCcw className="mr-2 h-4 w-4" />
              {isLoading ? "Resetting..." : "Reset Filters"}
            </Button>

            <Button
              variant="outline"
              onClick={handleRefresh}
              disabled={isLoading}
              type="button"
            >
              <RefreshCcw className="mr-2 h-4 w-4" />
              {isLoading ? "Refreshing..." : "Refresh Data"}
            </Button>
          </div>
        </CardContent>
      </Card>

  {/* Jobs Section */}
  <Card className="audio-recordings-jobs-card w-full mt-2">
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <CardTitle>Audio Recording Jobs</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Showing {paginatedData?.length || 0} of {audioRecordings?.length || 0} jobs
              </p>
            </div>

            {/* View Toggle Controls */}
            <div className="flex items-center gap-2">
              <div className="flex items-center border rounded-lg p-1 bg-muted/50">
                <Toggle
                  pressed={viewMode === 'list'}
                  onPressedChange={() => setViewMode('list')}
                  aria-label="List view"
                  size="sm"
                  className="h-8 w-8 p-0 data-[state=on]:bg-background data-[state=on]:text-foreground"
                >
                  <List className="h-4 w-4" />
                </Toggle>
                <Toggle
                  pressed={viewMode === 'cards'}
                  onPressedChange={() => setViewMode('cards')}
                  aria-label="Card view"
                  size="sm"
                  className="h-8 w-8 p-0 data-[state=on]:bg-background data-[state=on]:text-foreground"
                >
                  <Grid3X3 className="h-4 w-4" />
                </Toggle>
              </div>
            </div>
          </div>
  </CardHeader>
  <CardContent>
          {isLoading && <Progress value={90} className="mb-4" />}

          {/* Card view */}
          {viewMode === 'cards' && (
            <div className="w-full">
              {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="rounded-lg border bg-card p-4 shadow-sm flex flex-col gap-3 animate-pulse">
                      <div className="flex items-center justify-between mb-2">
                        <div className="h-4 w-32 bg-gray-200 rounded" />
                        <div className="h-4 w-16 bg-gray-200 rounded" />
                      </div>
                      <div className="space-y-1">
                        <div className="h-3 w-40 bg-gray-200 rounded" />
                        <div className="h-3 w-24 bg-gray-200 rounded" />
                        <div className="h-3 w-32 bg-gray-200 rounded" />
                      </div>
                      <div className="flex gap-4 mt-3">
                        <div className="h-10 w-full bg-gray-200 rounded" />
                        <div className="h-10 w-full bg-gray-200 rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                paginatedData && paginatedData.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {paginatedData.map((row: any) => (
                      <div
                        key={row.id}
                        className="rounded-lg border bg-card p-4 shadow-sm flex flex-col gap-3 h-fit"
                      >
                        {/* Icon and status above filename */}
                        <div className="mb-2">
                          <div className="flex items-center justify-between mb-2">
                            {getFileTypeIcon(row.file_path)}
                            <Badge
                              className={cn(
                                "flex min-w-[70px] items-center justify-center rounded-md px-2 py-1 text-xs",
                                statusVariants[row.status] || statusVariants.default,
                              )}
                            >
                              {row.status}
                            </Badge>
                          </div>
                          <span
                            className="font-semibold text-primary break-words text-base line-clamp-2"
                            title={row.file_name || row.file_path.split("/").pop() || "Unnamed Recording"}
                          >
                            {row.file_name || row.file_path.split("/").pop() || "Unnamed Recording"}
                          </span>
                        </div>
                        <div className="space-y-1 flex-grow">
                          <div className="text-sm text-muted-foreground break-words">
                            <span className="font-medium text-foreground">Job ID:</span>{" "}
                            <span className="break-all">{row.id}</span>
                          </div>
                          <div className="text-sm text-muted-foreground break-words">
                            <span className="font-medium text-foreground">Case ID:</span>{" "}
                            <span className="break-all">{row.case_id || "-"}</span>
                          </div>
                          {/* Service Area (Category) */}
                          <div
                            className="text-sm text-muted-foreground break-words line-clamp-1"
                            title={categoryMap[row.prompt_category_id] || "-"}
                          >
                            <span className="font-medium text-foreground">Service Area:</span>{" "}
                            <span>{categoryMap[row.prompt_category_id] || "-"}</span>
                          </div>
                          {/* Service Function (Subcategory) */}
                          <div
                            className="text-sm text-muted-foreground break-words line-clamp-1"
                            title={subcategoryMap[row.prompt_subcategory_id] || "-"}
                          >
                            <span className="font-medium text-foreground">Service Function:</span>{" "}
                            <span>{subcategoryMap[row.prompt_subcategory_id] || "-"}</span>
                          </div>
                          <div className="text-sm text-muted-foreground break-words">
                            <span className="font-medium text-foreground">Upload Date:</span>{" "}
                            <span>{new Date(Number(row.created_at)).toLocaleDateString()}</span>
                          </div>
                          <div className="text-sm text-muted-foreground break-words">
                            <span className="font-medium text-foreground">Deletion Date:</span>{" "}
                            <span>{(() => {
                              const created = Number(row.created_at);
                              if (!created || isNaN(created)) return "-";
                              const deletionDate = new Date(created + RETENTION_DAYS * 24 * 60 * 60 * 1000);
                              return deletionDate.toLocaleDateString();
                            })()}</span>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-3">
                          {isSupportedAudioFile(row.file_path) && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-shrink-0"
                              onClick={() => handlePlayAudio(row)}
                              aria-label={currentlyPlayingId === row.id ? "Stop Audio" : "Play Audio"}
                            >
                              {currentlyPlayingId === row.id ? (
                                <>
                                  <Square className="h-4 w-4 mr-1" /> Stop
                                </>
                              ) : (
                                <>
                                  <Play className="h-4 w-4 mr-1" /> Play
                                </>
                              )}
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-w-[90px]"
                            onClick={() => setSelectedRecording(row)}
                            aria-label="View Details"
                          >
                            <Eye className="h-4 w-4 mr-1" /> View
                          </Button>
                          {row.status === "uploaded" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1 min-w-0"
                              aria-label="Retry Processing"
                              onClick={() => null}
                            >
                              <RefreshCcw className="h-4 w-4 mr-1" /> Retry
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-gray-500 py-8">
                    No results found
                  </div>
                )
              )}
            </div>
          )}

          {/* List view (Table) */}
          {viewMode === 'list' && (
            <div className="audio-recordings-table-wrapper w-full overflow-x-auto [hyphens:auto] [word-break:break-word]">
              <Table className="audio-recordings-table w-full table-auto">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-center px-2">Job ID</TableHead>
                    <TableHead className="text-center px-2">Case ID</TableHead>
                    <TableHead className="text-center px-2">File Name</TableHead>
                    <TableHead className="text-center px-2">Service Area</TableHead>
                    <TableHead className="text-center px-2">Service Function</TableHead>
                    <TableHead className="text-center px-2">Status</TableHead>
                    <TableHead className="text-center px-2">Upload Date</TableHead>
                    <TableHead className="text-center px-2">Deletion Date</TableHead>
                    <TableHead className="text-center px-2">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                {isLoading ? (
                  <AudioTableSkeleton />
                ) : (
                  <TableBody>
                    {(paginatedData && paginatedData.length > 0) ? (
                      paginatedData.map((row: any) => (
                        <TableRow key={row.id}>
                          <TableCell className="break-words whitespace-normal hyphens-auto text-center align-middle px-2">{row.id}</TableCell>
                          <TableCell className="break-words whitespace-normal hyphens-auto text-center align-middle px-2">{row.case_id || "-"}</TableCell>
                          <TableCell className="font-medium text-blue-500 break-words whitespace-normal hyphens-auto text-center align-middle px-2">{row.file_name || row.file_path.split("/").pop() || "Unnamed Recording"}</TableCell>
                          {/* Service Area (Category) */}
                          <TableCell className="break-words whitespace-normal hyphens-auto text-center align-middle px-2">{categoryMap[row.prompt_category_id] || "-"}</TableCell>
                          {/* Service Function (Subcategory) */}
                          <TableCell className="break-words whitespace-normal hyphens-auto text-center align-middle px-2">{subcategoryMap[row.prompt_subcategory_id] || "-"}</TableCell>
                          <TableCell className="text-center align-middle px-2" style={{ minWidth: 120 }}>
                            <Badge
                              className={cn(
                                "flex min-w-[70px] items-center justify-center rounded-md px-2 py-1 text-xs mx-auto",
                                statusVariants[row.status] || statusVariants.default,
                              )}
                            >
                              {row.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center align-middle px-2">{new Date(Number(row.created_at)).toLocaleDateString()}</TableCell>
                          {/* Deletion Date column */}
                          <TableCell className="text-center align-middle px-2">
                            {(() => {
                              const created = Number(row.created_at);
                              if (!created || isNaN(created)) return "-";
                              const deletionDate = new Date(created + RETENTION_DAYS * 24 * 60 * 60 * 1000);
                              return deletionDate.toLocaleDateString();
                            })()}
                          </TableCell>
                          <TableCell className="text-center align-middle px-2">
                            {/* Action Dropdown */}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  onClick={() => setSelectedRecording(row)}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              {selectedRecording && selectedRecording.id === row.id && (
                                <DropdownMenuContent align="end">
                                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                  <DropdownMenuItem
                                    onClick={() => {
                                      localStorage.setItem("current_recording_id", row.id);
                                      router.navigate({
                                        to: `/audio-recordings/$id`,
                                        params: { id: row.id },
                                      });
                                    }}
                                  >
                                    <Eye className="mr-2 h-4 w-4" />
                                    View Details
                                  </DropdownMenuItem>
                                  {row.status === "uploaded" && (
                                    <DropdownMenuItem onClick={() => null}>
                                      <RefreshCcw className="mr-2 h-4 w-4" />
                                      Retry Processing
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              )}
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={8} className="py-4 text-center text-gray-500">
                          No results found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                )}
              </Table>
            </div>
          )}

          {/* Pagination Controls*/}
          <div className="audio-recordings-pagination mt-6 flex flex-col sm:flex-row items-center justify-between gap-2">
            <Button
              onClick={() => setCurrentPage(currentPage - 1)}
              disabled={currentPage === 1}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              onClick={() => setCurrentPage(currentPage + 1)}
              disabled={currentPage >= totalPages}
            >
              Next
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* View Details Dialog (shared for both views) */}
      {selectedRecording && (
        <ViewDetailsDialog
          recording={selectedRecording}
          open={!!selectedRecording}
          onOpenChange={(open: boolean) => {
            if (!open) setSelectedRecording(null);
          }}
        />
      )}
    </div>
  );
}

interface AudioTableSkeletonProps {
  rows?: number;
}

const DEFAULT_SKELETON_ROWS = 8;

export function AudioTableSkeleton({
  rows = DEFAULT_SKELETON_ROWS,
}: AudioTableSkeletonProps) {
  return (
    <TableBody>
      {Array.from({ length: rows }).map((_, index) => (
        <TableRow key={`skeleton-${index}`}>
          {/* Job ID */}
          <TableCell>
            <Skeleton className="h-5 w-24" />
          </TableCell>
          {/* Case ID */}
          <TableCell>
            <Skeleton className="h-5 w-24" />
          </TableCell>
          {/* File Name */}
          <TableCell>
            <Skeleton className="h-5 w-48" />
          </TableCell>
          {/* Service Area */}
          <TableCell>
            <Skeleton className="h-5 w-32" />
          </TableCell>
          {/* Service Function */}
          <TableCell>
            <Skeleton className="h-5 w-32" />
          </TableCell>
          {/* Status */}
          <TableCell>
            <Skeleton className="h-6 w-[100px] rounded-md" />{" "}
            {/* Mimic Badge */}
          </TableCell>
          {/* Upload Date */}
          <TableCell>
            <Skeleton className="h-5 w-28" />
          </TableCell>
          {/* Actions */}
          <TableCell>
            <Skeleton className="h-8 w-8 rounded-md" />{" "}
            {/* Mimic Icon Button */}
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  );
}
