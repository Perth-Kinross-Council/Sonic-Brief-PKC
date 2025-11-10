import type { AudioListValues } from "@/schema/audio-list.schema";
import { AudioRecordingsCombined } from "@/components/audio-recordings/audio-recordings-combined";
import { AudioRecordingsHeader } from "@/components/audio-recordings/header";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEnhancedUnifiedAuth } from "@/lib/useEnhancedUnifiedAuth";
import { useEffect } from "react";

export const Route = createFileRoute("/_layout/audio-recordings/")({
  component: AudioRecordingsIndexComponent,
});

const initialFilters: AudioListValues = {
  job_id: "",
  status: "all",
  created_at: undefined,
};


function AudioRecordingsIndexComponent() {
  const { isAuthenticated, isLoading } = useEnhancedUnifiedAuth();
  const router = useRouter();
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.navigate({ to: "/login" });
    }
  }, [isAuthenticated, isLoading, router]);
  // Suppress transient auth debug banners; render nothing during auth load or redirect
  if (isLoading || !isAuthenticated) return null;

  return (
    <div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
      <AudioRecordingsHeader />
      <AudioRecordingsCombined initialFilters={initialFilters} />
    </div>
  );
}
