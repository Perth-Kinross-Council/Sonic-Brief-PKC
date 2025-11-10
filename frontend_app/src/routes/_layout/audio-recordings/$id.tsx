import { RecordingDetailsPage } from "@/components/audio-recordings/recording-details-page";
import { RecordingDetailsSkeleton } from "@/components/audio-recordings/recording-details-page-skeleton";
import { useFetchJobs } from "@/lib/api";
// No direct use of JOBS_API or manual token here; apiClient handles baseUrl + token
import { apiClient } from "@/lib/enhancedApi";
import { useUnifiedAuth } from "@/lib/useUnifiedAuth";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

export const Route = createFileRoute("/_layout/audio-recordings/$id")({
  component: RecordingDetailsComponent,
});

function RecordingDetailsComponent() {
  const isUnifiedAuthenticated = useUnifiedAuth();
  const router = useRouter();
  useEffect(() => {
    if (!isUnifiedAuthenticated) {
      router.navigate({ to: "/login" });
    }
  }, [isUnifiedAuthenticated, router]);
  if (!isUnifiedAuthenticated) return null;

  const { id } = Route.useParams();
  const fetchJobs = useFetchJobs();

  const {
    data: allRecordings,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["sonic-brief", "audio-recordings"],
    queryFn: () => fetchJobs(),
    select: (data) => data.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    ),
  });

  const recording = allRecordings?.find((r) => r.id === id);

  if (isLoading) {
    return <RecordingDetailsSkeleton />;
  }

  if (!recording || isError) {
    return (
      <div className="container mx-auto px-4 py-6">
        <div className="rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700">
          <p className="mt-2">
            <Link to="/audio-recordings" className="text-blue-500 underline">
              Return to recordings list
            </Link>
          </p>
        </div>
      </div>
    );
  }

  // Fire-and-forget audit event when details page is shown (server logs via GET /upload/jobs?job_id=...&view=true)
  const hasLoggedRef = useRef<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        if (!id) return;
        if (hasLoggedRef.current === id) return; // avoid duplicate log
        await apiClient.get(`/upload/jobs?job_id=${encodeURIComponent(id)}&view=true`, {
          cache: "no-store",
          signal: controller.signal,
        } as RequestInit);
        hasLoggedRef.current = id;
      } catch {
        // Best effort only
      }
    })();
    return () => {
      controller.abort();
    };
  }, [id]);

  return <RecordingDetailsPage recording={recording} />;
}
