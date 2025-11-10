// Debug: Print localStorage token at the very top before React runs
// COMMENTED OUT FOR SECURITY - PREVENTS TOKEN LEAKAGE IN CONSOLE
// if (typeof window !== "undefined") {
//   console.log("[AudioUploadPage][DEBUG][TOP] localStorage token:", window.localStorage.getItem("token"));
// }

import { AudioUploadForm } from "@/components/dashboard/audio-upload-form";
// Diagnostics panel removed to match SonicBrief-EID
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useUnifiedAuthParity } from "@/lib/useUnifiedAuthParity";
import { useEffect, useState } from "react";
import { FileUp } from "lucide-react";

export const Route = createFileRoute("/_layout/audio-upload/")({
  component: AudioUploadPage,
});


function AudioUploadPage() {
  if (typeof window === "undefined") {
    return null;
  }

  const { isAuthenticated, isLoading } = useUnifiedAuthParity();
  const router = useRouter();
  const [pathname, setPathname] = useState<string>(
    typeof window !== "undefined" ? window.location.pathname : ""
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      setPathname(window.location.pathname);
      // Debug: Print token and auth state on mount
      // COMMENTED OUT FOR SECURITY - PREVENTS TOKEN LEAKAGE IN CONSOLE
  // Removed commented debug logging: audio upload mount state
    }
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      // COMMENTED OUT FOR SECURITY - PREVENTS TOKEN LEAKAGE IN CONSOLE
  // Removed commented debug logging: audio upload effect state
    }
    if (!isLoading && !isAuthenticated && pathname !== "/login") {
      // Extra detailed debug log before redirect
      // COMMENTED OUT FOR SECURITY - PREVENTS TOKEN LEAKAGE IN CONSOLE
  // Removed commented debug logging: redirect to login details
      setTimeout(() => {
        if (window.location.pathname !== "/login") {
          router.navigate({ to: "/login" });
        }
      }, 100);
    }
  }, [isAuthenticated, isLoading, router, pathname]);

  if (isLoading) {
    return <div className="p-8 text-center text-yellow-700">Loading auth state...<br/>isLoading: {String(isLoading)}<br/>isAuthenticated: {String(isAuthenticated)}</div>;
  }
  if (!isAuthenticated) {
    return <div className="p-8 text-center text-red-700">Not authenticated. Redirecting to login...<br/>isLoading: {String(isLoading)}<br/>isAuthenticated: {String(isAuthenticated)}</div>;
  }
  return (
    <div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
      <nav
        className="flex items-center text-sm text-muted-foreground mb-1"
        aria-label="Breadcrumb"
      >
  <a href="/home" className="hover:underline">
          Home
        </a>
        <span className="mx-2">&gt;</span>
        <span className="font-semibold">Audio Upload</span>
      </nav>
      <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <FileUp className="h-5 w-5" />
        Audio Upload
      </h2>
      <p className="text-muted-foreground text-sm">
        Upload and manage audio files for your AI system. Acceptable formats:
        .mp3, .wav, .aac, .m4a, .ogg, .flac
        <br />
        <span className="block mt-1">
          <strong>Note:</strong> Audio files must be <strong>mono</strong>. If your
          file is stereo or another format, it will be automatically converted to
          mono and a supported format before uploading. This may increase upload
          time depending on file size and conversion needs.
        </span>
      </p>
  <Card className="w-full">
        <CardHeader>
          <CardTitle>Upload Audio File</CardTitle>
          <CardDescription>
            Upload an audio file and select prompts for processing
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AudioUploadForm />
        </CardContent>
      </Card>
    </div>
  );
}
