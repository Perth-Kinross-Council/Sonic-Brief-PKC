import { UserManagementProvider } from "@/components/user-management/UserManagementContext";
import { UserManagementPage } from "@/components/user-management/UserManagementPage";
import { UserManagementErrorBoundary } from "@/components/user-management/UserManagementErrorBoundary";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/user-management/")({
  component: UserManagementRoute,
});

function UserManagementRoute() {
  return (
    <UserManagementErrorBoundary>
      <UserManagementProvider>
        <UserManagementPage />
      </UserManagementProvider>
    </UserManagementErrorBoundary>
  );
}
