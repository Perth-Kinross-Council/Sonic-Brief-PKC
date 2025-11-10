
import { useUnifiedAuthParity } from "@/lib/useUnifiedAuthParity";
import { useEffect, useState } from "react";
import { useRouter, createFileRoute } from "@tanstack/react-router";

function RootRedirect() {
  const { isAuthenticated, pending } = useUnifiedAuthParity();
  const router = useRouter();
  const [pathname, setPathname] = useState<string>(typeof window !== "undefined" ? window.location.pathname : "");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setPathname(window.location.pathname);
    }
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      // Removed commented debug logging: root redirect state snapshot
    }
    if (pending) return;
    if (isAuthenticated && pathname !== "/home") {
      if (window.location.pathname !== "/home") {
        router.navigate({ to: "/home" as any });
      }
    } else if (!isAuthenticated && pathname !== "/login") {
      if (window.location.pathname !== "/login") {
        router.navigate({ to: "/login" });
      }
    }
  }, [isAuthenticated, pending, router, pathname]);
  return null;
}

export const Route = createFileRoute("/")({
  component: RootRedirect,
});
