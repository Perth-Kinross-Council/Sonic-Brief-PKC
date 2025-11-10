import { createFileRoute, useRouter } from "@tanstack/react-router";
import AnalyticsDashboard from "@/components/analytics/AnalyticsDashboard";
import { useEnhancedUnifiedAuth } from "@/lib/useEnhancedUnifiedAuth";
import { useEffect } from "react";
import { BarChart3 } from "lucide-react";

function AnalyticsPage() {
  const { isAuthenticated, isLoading } = useEnhancedUnifiedAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.navigate({ to: "/login" });
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="space-y-4 p-4 pt-6 md:p-8">
      <nav
        className="flex items-center text-sm text-muted-foreground mb-1"
        aria-label="Breadcrumb"
      >
        <a href="/home" className="hover:underline">Home</a>
        <span className="mx-2">&gt;</span>
        <span className="font-semibold">Analytics</span>
      </nav>
      <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <BarChart3 className="h-5 w-5" />
        Analytics
      </h2>
      <p className="text-muted-foreground text-sm">
        System performance and usage metrics
      </p>

      {/* Now using the same authentication pattern as User Management */}
      <AnalyticsDashboard />
    </div>
  );
}

export const Route = createFileRoute("/_layout/analytics/")({
  component: AnalyticsPage,
});
