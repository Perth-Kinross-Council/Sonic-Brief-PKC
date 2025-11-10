import { TRANSCRIPTION_API } from "@/lib/apiConstants";
import { useUnifiedAccessToken } from "@/lib/api";

export function useFetchTranscription() {
  const getToken = useUnifiedAccessToken();
  return async (id: string): Promise<string> => {
    try {
  // Removed commented debug logging: fetching transcription by ID
      const token = await getToken();
      const url = `${TRANSCRIPTION_API}/${id}`;
  // Removed commented debug logging: transcription API URL

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

  // Removed commented debug logging: transcription API response status

      if (!response.ok) {
        const errorText = await response.text();
        // Gracefully handle not-ready transcripts
        if (response.status === 404) {
          // Transcription not available yet; return empty without throwing
          return "";
        }
        console.error('Transcription API error:', response.status, errorText);
        throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
      }

      const text = await response.text();
  // Removed commented debug logging: transcription length loaded
      return text;
    } catch (error) {
      // Avoid noisy logs during expected not-ready windows
      // Still rethrow for non-404 scenarios handled above
      console.error('Error in useFetchTranscription:', error);
      throw error;
    }
  };
}