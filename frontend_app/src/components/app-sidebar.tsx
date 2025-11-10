import type { LinkOptions } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { getStorageItem, setStorageItem } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { Link, useRouter } from "@tanstack/react-router";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  FileAudio,
  FileText,
  FileUp,
  LogOut,
  Mic,
  Upload,
  User,
  Users,
  Home,
  Search,
} from "lucide-react";
import { useMsal } from "@azure/msal-react";
import { logoutAllAuth } from "@/lib/auth-util";
import { useEnhancedUnifiedAuth as useEnhancedAuth } from "@/lib/useEnhancedUnifiedAuth";
import { env } from "@/env";
import { fetchJsonStrict } from "@/lib/api";
import { apiUrl } from "@/lib/apiUrl";

// Patch fetchUserRole to store the last /me response on window for debugging
async function fetchUserRole(): Promise<string | null> {
  try {
    // Skip role fetch if logout is in progress to avoid triggering /auth/me and extra LOGIN logs
    if (typeof window !== 'undefined' && (window as any).__sbLogoutInProgress) {
      return null;
    }
  // Removed commented debug logging: starting fetchUserRole
    let token = null;

    // Try to get token from the global auth manager first
    if (typeof window !== "undefined" && (window as any).authManager) {
      try {
  // Removed commented debug logging: attempting token acquisition
        token = await (window as any).authManager.getToken();
  // Removed commented debug logging: token acquisition details

        // Debug token details
        // COMMENTED OUT FOR SECURITY - PREVENTS TOKEN PAYLOAD LEAKAGE
        // if (token) {
        //   try {
        //     const parts = token.split('.');
        //     if (parts.length === 3) {
  //       const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      } catch (error) {
  // Removed commented debug logging: failed token acquisition
      }
    } else {
  // Removed commented debug logging: no authManager present
    }

    // Fallback to legacy token from localStorage if no auth manager token
    if (!token && typeof window !== "undefined") {
      token = window.localStorage.getItem("token");
      if (token) {
        // COMMENTED OUT FOR SECURITY - PREVENTS TOKEN LEAKAGE
  // Removed commented debug logging: legacy token fallback
      }
    }

    if (!token) {
  // Removed commented debug logging: no token available
      return null;
    }

    const apiUrlPath = apiUrl("/auth/me");
    let data: any;
    try {
      data = await fetchJsonStrict(apiUrlPath, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      });
    } catch {
      return null;
    }
    if (typeof window !== "undefined") (window as any).__lastMeResponse = data;
    // COMMENTED OUT FOR SECURITY - PREVENTS USER DATA LEAKAGE
  // Removed commented debug logging: /me response data

    // Extract role from the response
    const computedRole = data.role || (data.roles && data.roles[0]) || null;
  // Removed commented debug logging: computed role
    return computedRole;
  } catch (err) {
    console.error("[Sidebar] ❌ Error fetching user role:", err);
    return null;
  }
}

interface MenuItem {
  icon: React.ElementType;
  label: string;
  to: LinkOptions["to"] | string;
}

const menuItems: Array<MenuItem> = [
  { icon: Home, label: "Home", to: "/home" as any },
  { icon: FileUp, label: "Audio Upload", to: "/audio-upload" },
  { icon: Upload, label: "Transcription Upload", to: "/transcript-upload" },
  { icon: Mic, label: "Record Audio", to: "/record-audio" },
  { icon: FileAudio, label: "Audio Recordings", to: "/audio-recordings" },
];

interface AppSidebarProps {
  children?: React.ReactNode;
}

export function AppSidebar({ children }: AppSidebarProps) {
  const [isOpen, setIsOpen] = useState(() => {
    const saved = getStorageItem("sidebarOpen", "true");
    return JSON.parse(saved);
  });
  const [userRole, setUserRole] = useState<string | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const router = useRouter();
  const { isAuthenticated, isLoading: pending, logout } = useEnhancedAuth();
  const roleFetchedRef = useRef(false);
  const { accounts } = useMsal();

  // Determine user info and auth method
  let userLabel = null;
  if (isAuthenticated && !pending) {
    let displayName = null;
    let authType = null;
    if (accounts && accounts.length > 0) {
      displayName = accounts[0].username;
      authType = (
        <span className="rounded bg-blue-700 px-2 py-0.5 text-[10px] font-medium text-white align-middle">
          Entra
        </span>
      );
    } else {
      // Legacy: try to get email from legacy token
      let legacyEmail = null;
      try {
        const token =
          typeof window !== "undefined"
            ? window.localStorage.getItem("token")
            : null;
        if (token) {
          const [, payloadBase64] = token.split(".");
          if (payloadBase64) {
            const payload = JSON.parse(
              atob(payloadBase64.replace(/-/g, "+").replace(/_/g, "/"))
            );
            legacyEmail = payload.sub || payload.email || null;
          }
        }
      } catch {}
      displayName = legacyEmail || "(unknown)";
      authType = (
        <span className="rounded bg-gray-700 px-2 py-0.5 text-[10px] font-medium text-white align-middle">
          Legacy
        </span>
      );
    }
    userLabel = (
      <div className="block text-xs text-gray-300 mt-2 text-center">
        <div className="font-semibold text-gray-400 mb-0.5">
          Logged in user:
        </div>
        <div className="font-semibold text-white break-all mb-1">
          {displayName}
        </div>
        <div className="font-semibold text-gray-400 mb-0.5">
          Authentication:
        </div>
        <div className="mb-0.5">{authType}</div>
        <div className="font-semibold text-gray-400 mb-0.5">Role:</div>
        <div className="mb-0.5 text-white">{userRole ?? "(none)"}</div>
      </div>
    );
  }

  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).__sbLogoutInProgress) {
      return;
    }
    if (!isAuthenticated) return;
    if (roleFetchedRef.current) return;
    roleFetchedRef.current = true;
    fetchUserRole().then(setUserRole).catch(() => {});
  }, [isAuthenticated]);

  const toggleSidebar = () => {
    const newState = !isOpen;
    setIsOpen(newState);
    setStorageItem("sidebarOpen", JSON.stringify(newState));
  };

  const handleLogout = async () => {
    try {
  // Removed commented debug logging: starting logout
      setUserRole(null); // Clear role immediately for UI feedback
      // Use enhanced auth logout for proper cleanup and navigation
      await logout();
  // Removed commented debug logging: logout successful
    } catch (error) {
      console.error("[AppSidebar] Logout error:", error);
      // Fallback: clear state and navigate manually only on error
      logoutAllAuth();
      window.location.href = "/login";
    }
  };

  // Check if user has elevated privileges (admin or power_user)
  const hasElevatedPrivileges = () => {
    if (userRole === "admin" || userRole === "power_user") return true;
    // Fallback to localStorage for legacy
    const role = getStorageItem("role", "");
    if (role === "admin" || role === "power_user") return true;
    return false;
  };

  // Add User Management menu item for admin users only
  const isAdmin = () => {
    if (userRole === "admin") return true;
    // Fallback to localStorage for legacy
    const role = getStorageItem("role", "");
    if (role === "admin") return true;
    return false;
  };

  // Build menu items based on user privileges
  const fullMenuItems = [...menuItems];

  // Add Prompt Management for admin and power users
  if (hasElevatedPrivileges()) {
    fullMenuItems.push({ icon: FileText, label: "Prompt Management", to: "/prompt-management" });
  }

  // Add User Management for admin users only
  if (isAdmin()) {
    fullMenuItems.push({ icon: Users, label: "User Management", to: "/user-management" });
    fullMenuItems.push({ icon: BarChart3, label: "Analytics", to: "/analytics" });
    fullMenuItems.push({ icon: Search, label: "Audit", to: "/audit" });
  }

  return (
    <div className="flex min-h-screen">
      <div
        className={cn(
          "fixed top-0 left-0 z-40 flex h-full flex-col bg-gray-900 text-white transition-all duration-300 ease-in-out",
          isOpen ? "w-64" : "w-16"
        )}
      >
        {/* Sidebar icon at the very top */}
        <div className="flex flex-col items-center pt-4 pb-2">
          <div className="rounded-full bg-white p-2 mb-2">
            <Mic className="h-8 w-8 text-gray-900" />
          </div>
        </div>
        {/* Title below icon, above user */}
        <div className="flex flex-col items-center justify-center px-2 pb-2">
          {isOpen ? (
            <>
              <span className="w-full text-center font-bold text-lg tracking-tight text-white leading-tight">
                {env.VITE_APP_TITLE}
              </span>
              <span className="w-full text-center font-bold text-lg tracking-tight text-white leading-tight -mt-1">
                {env.VITE_APP_SUBTITLE}
              </span>
            </>
          ) : (
            <>
              <span className="sr-only">{env.VITE_APP_TITLE}</span>
              <span className="sr-only">{env.VITE_APP_SUBTITLE}</span>
            </>
          )}
        </div>
        {/* User label below icon, or person icon if minimised */}
        <div className="flex flex-col items-center justify-start px-2 pb-2 min-h-[120px]">
          {isOpen ? (
            userLabel
          ) : (
            <div className="flex flex-col items-center mt-2 group relative">
              <User className="h-8 w-8 text-gray-300" />
              <div className="absolute left-8 top-1/2 z-50 w-56 -translate-y-1/2 rounded bg-gray-800 p-3 text-xs text-white shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity duration-200">
                {userLabel}
              </div>
            </div>
          )}
        </div>
        {/* Minimise icon below user details, hanging off the very right edge */}
        <div className="relative w-full h-10">
          <Button
            variant="ghost"
            className="h-8 w-8 rounded-full bg-gray-800 p-0 hover:bg-gray-700 absolute top-1/2 -translate-y-1/2"
            style={{ right: "-18px" }}
            onClick={toggleSidebar}
            aria-label={isOpen ? "Minimise sidebar" : "Expand sidebar"}
          >
            {isOpen ? <ChevronLeft /> : <ChevronRight />}
          </Button>
        </div>
        <nav className={cn("flex flex-col gap-1", isOpen ? "p-4 overflow-y-auto" : "p-2")}>
          {fullMenuItems.map((item, idx) => (
            <div key={item.label} className="relative group">
              <Link
                to={item.to}
                onMouseEnter={() => setHoveredIndex(idx)}
                onMouseLeave={() => setHoveredIndex(null)}
                className={cn(
                  "flex items-center gap-2 rounded text-sm font-medium transition-colors",
                  isOpen ? "px-3 py-2" : "p-2 justify-center",
                  hoveredIndex === idx
                    ? "bg-blue-800 text-white"
                    : router.state.location.pathname.startsWith(item.to as string)
                    ? "bg-blue-900 text-white"
                    : "text-gray-200 hover:bg-blue-800 hover:text-white"
                )}
              >
                <item.icon className={cn("flex-shrink-0", isOpen ? "h-6 w-6" : "h-8 w-8")} />
                {isOpen && item.label}
              </Link>
              {!isOpen && (
                <div className="absolute left-16 top-1/2 z-50 w-auto -translate-y-1/2 rounded bg-gray-800 px-2 py-1 text-xs text-white shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity duration-200 whitespace-nowrap">
                  {item.label}
                </div>
              )}
            </div>
          ))}
        </nav>
        <div className="flex flex-col items-center pb-6 mt-auto">
          <div className="relative group w-full">
            <Button
              variant="ghost"
              className={cn("w-full", isOpen ? "justify-start" : "justify-center p-2")}
              onClick={handleLogout}
            >
              <LogOut className={cn("flex-shrink-0", isOpen ? "h-6 w-6" : "h-8 w-8")} />
              {isOpen && <span className="ml-3">Logout</span>}
            </Button>
            {!isOpen && (
              <div className="absolute left-16 top-1/2 z-50 w-auto -translate-y-1/2 rounded bg-gray-800 px-2 py-1 text-xs text-white shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity duration-200 whitespace-nowrap">
                Logout
              </div>
            )}
          </div>
        </div>
      </div>
      <div
        className={cn(
          "flex-1 p-6 transition-all duration-300 ease-in-out",
          isOpen ? "ml-64" : "ml-16"
        )}
      >
        {children}
      </div>
    </div>
  );
}
