import { useUnifiedAuth } from "@/lib/useUnifiedAuth";
import { useEffect, useState } from "react";
import { useRouter, createFileRoute } from "@tanstack/react-router";
import { TranscriptUploadView } from "@/components/transcript-upload/transcript-upload-view";

export const Route = createFileRoute("/_layout/transcript-upload/")({
  component: TranscriptUploadPage,
});

function TranscriptUploadPage() {
  const { authenticated, pending } = useUnifiedAuth();
  const router = useRouter();
  const [pathname, setPathname] = useState<string>(
    typeof window !== "undefined" ? window.location.pathname : ""
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      setPathname(window.location.pathname);
    }
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!pending && !authenticated && pathname !== "/login") {
      setTimeout(() => {
        if (window.location.pathname !== "/login") {
          router.navigate({ to: "/login" });
        }
      }, 100);
    }
  }, [authenticated, pending, router, pathname]);

  if (pending) {
    return <div className="p-8 text-center">Checking authentication...</div>;
  }
  if (!authenticated) {
    return <div className="p-8 text-center">Not authenticated. Redirecting to login...</div>;
  }
  return <TranscriptUploadView />;
}
