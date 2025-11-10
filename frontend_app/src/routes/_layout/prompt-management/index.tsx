import { PromptManagementHeader } from "@/components/prompt-management/prompt-management-header";
import { PromptManagementView } from "@/components/prompt-management/prompt-management-view";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEnhancedUnifiedAuth } from "@/lib/useEnhancedUnifiedAuth";
import { useEffect } from "react";

export const Route = createFileRoute("/_layout/prompt-management/")({
  component: PromptManagementPage,
});

function PromptManagementPage() {
  const { isAuthenticated, isLoading } = useEnhancedUnifiedAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.navigate({ to: "/login" });
    }
  }, [isAuthenticated, isLoading, router]);
  // Suppress debug auth banners; do not render during auth load or while redirecting
  if (isLoading || !isAuthenticated) return null;

  return (
    <div className="space-y-4 p-4 pt-6 md:p-8">
      <PromptManagementHeader />
      <PromptManagementView />
    </div>
  );
}
