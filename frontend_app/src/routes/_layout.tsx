
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useUnifiedAuthParity } from "@/lib/useUnifiedAuthParity";
import UnifiedDebugDashboard from "@/components/debug/debug-panel";
import { debugConfig } from "@/env";
import { useState, useEffect } from "react";

function RouteComponent() {
  const { isAuthenticated, pending } = useUnifiedAuthParity();
  const [showDebugDashboard, setShowDebugDashboard] = useState(false);
  const navigate = useNavigate();

  // Handle redirect to login when not authenticated
  useEffect(() => {
  if (!pending && !isAuthenticated) {
      navigate({ to: '/login' });
    }
  }, [isAuthenticated, pending, navigate]);

  if (pending) {
  // Suppress loading UI to avoid page-load flicker
  return null;
  }

  if (!isAuthenticated) {
  // Navigate effect handles redirect; render nothing to avoid flicker
  return null;
  }

  return (
    <div className="flex min-h-screen">
      <AppSidebar />
      <main className="min-h-screen flex-1">
        <div className="container mx-auto p-4">
          <div className="mb-4 flex justify-between items-center">
            <div className="flex-1">
              {/* Cache refresh statistic removed */}
            </div>
            <div className="flex space-x-2">
              {/* Unified Debug Dashboard Toggle - Only show when debug is enabled */}
              {debugConfig.isEnabled() && (
                <button
                  onClick={() => setShowDebugDashboard(!showDebugDashboard)}
                  className="px-3 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600"
                >
                  {showDebugDashboard ? "Hide" : "Show"} Auth Monitor
                </button>
              )}
              <ThemeToggle />
            </div>
          </div>
          {/* Unified Debug Dashboard */}
          {debugConfig.isEnabled() && showDebugDashboard && (
            <UnifiedDebugDashboard location="Main Layout" />
          )}
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export const Route = createFileRoute("/_layout")({
  beforeLoad: () => {
    // Removed isUserAuthenticated usage
  },
  component: RouteComponent,
});
