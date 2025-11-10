import type { AudioRecording, AudioListFilters } from "@/lib/api";
import { queryOptions } from "@tanstack/react-query";

function sortAudioRecordings(data: Array<AudioRecording>) {
  return data.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export function getAudioRecordingsQuery(filters?: AudioListFilters) {
  return queryOptions({
    queryKey: ["sonic-brief", "audio-recordings", filters],
    queryFn: async () => {
  // This approach won't work since we need to use the hook in a component context
      // We'll need to refactor the component to use the hook directly
      throw new Error("This query needs to be refactored to use hooks directly in the component");
    },
    select: (data) => sortAudioRecordings(data),
  });
}

export function getAudioTranscriptionQuery(id: string) {
  return queryOptions({
    queryKey: ["sonic-brief", "audio-recordings", "transcription", id],
    queryFn: async () => {
      // Same issue - needs to be refactored
      throw new Error("This query needs to be refactored to use hooks directly in the component");
    },
    enabled: !!id,
  });
}
