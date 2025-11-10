import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileUp, Upload, Mic, FileAudio, Home as HomeIcon, FileText, Users, BarChart3, Search } from "lucide-react";
import { useEnhancedUnifiedAuth } from "@/lib/useEnhancedUnifiedAuth";
import { getUserInfo } from "@/lib/user-info-util";
import { useMsal } from "@azure/msal-react";
import { env } from "@/env";
import { fetchJsonStrict } from "@/lib/api";
import { apiUrl } from "@/lib/apiUrl";
// Role helpers (copied from sidebar)
function getStorageItem(key: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function hasElevatedPrivileges(userRole: string | null) {
  if (userRole === "admin" || userRole === "power_user") return true;
  const role = getStorageItem("role", "");
  if (role === "admin" || role === "power_user") return true;
  return false;
}

function isAdmin(userRole: string | null) {
  if (userRole === "admin") return true;
  const role = getStorageItem("role", "");
  if (role === "admin") return true;
  return false;
}


// Use centralized apiUrl helper

type UploadTypeBreakdown = { uploaded: number; recorded: number; transcript: number; total?: number };

export const Route = createFileRoute("/_layout/home/" as any)({
  component: HomePage,
});

function HomePage() {
  const { isAuthenticated, isLoading } = useEnhancedUnifiedAuth();
  const { instance: msalInstance } = useMsal();

  const [displayName, setDisplayName] = useState<string>("User");
  const [userRole, setUserRole] = useState<string | null>(null);
  // Fetch user role (copied from sidebar)
  useEffect(() => {
    async function fetchUserRole() {
      try {
        let token = null;
        if (typeof window !== "undefined" && (window as any).authManager) {
          try {
            token = await (window as any).authManager.getToken();
          } catch {}
        }
        if (!token && typeof window !== "undefined") {
          token = window.localStorage.getItem("token");
        }
        if (!token) return null;
        let data: any;
        try {
          data = await fetchJsonStrict(apiUrl("/auth/me"), {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            credentials: "include",
          });
        } catch {
          return null;
        }
        return data.role || (data.roles && data.roles[0]) || null;
      } catch {
        return null;
      }
    }
    fetchUserRole().then(setUserRole);
  }, []);
  const [dayRange, setDayRange] = useState<number>(30);
  const [breakdown, setBreakdown] = useState<UploadTypeBreakdown>({ uploaded: 0, recorded: 0, transcript: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  // Resolve user display name
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const w: any = typeof window !== "undefined" ? window : {};
        const token = (w.authManager && (await w.authManager.getToken?.())) || w.localStorage?.getItem("token") || null;
        const info = getUserInfo(msalInstance, token);
        if (!isMounted) return;
        setDisplayName(info.displayName || info.username || info.email || "User");
      } catch {
        if (!isMounted) return;
        setDisplayName("User");
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [msalInstance]);

  // Fetch user metrics for selected day range
  useEffect(() => {
    if (!isAuthenticated || isLoading) return;
    let mounted = true;
    (async () => {
      try {
        setError(null);
        const w: any = typeof window !== "undefined" ? window : {};
        let token: string | null = null;
        if (w.authManager && typeof w.authManager.getToken === "function") {
          token = await w.authManager.getToken();
        }
        if (!token) token = w.localStorage?.getItem("token") || null;
        if (!token) throw new Error("No authentication token available");

        const data: any = await fetchJsonStrict(apiUrl(`/analytics/overview?days=${dayRange}`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!mounted) return;
        const userBreakdown = data?.user?.by_upload_type || { uploaded: 0, recorded: 0, transcript: 0 };
        setBreakdown({
          uploaded: Number(userBreakdown.uploaded || 0),
          recorded: Number(userBreakdown.recorded || 0),
          transcript: Number(userBreakdown.transcript || 0),
          total: Number(userBreakdown.total || (Number(userBreakdown.uploaded || 0) + Number(userBreakdown.recorded || 0) + Number(userBreakdown.transcript || 0))),
        });
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || "Failed to load metrics");
      }
    })();
    return () => {
      mounted = false;
    };
  }, [isAuthenticated, isLoading, dayRange]);

  return (
    <div className="space-y-6 p-4 pt-6 md:p-8 max-w-7xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="space-y-1">
          <nav className="flex items-center text-sm text-muted-foreground mb-1" aria-label="Breadcrumb">
            <span className="font-semibold">Home</span>
          </nav>
          <h2 className="flex items-center gap-2 text-2xl md:text-3xl font-semibold tracking-tight">
            <HomeIcon className="h-5 w-5 md:h-6 md:w-6" />
            Home
          </h2>
          <p className="text-muted-foreground text-base md:text-lg">Welcome to {env.VITE_APP_SUBTITLE}.</p>
        </div>
  </div>

      {/* Welcome */}
      <div className="text-lg md:text-xl font-medium">Welcome, {displayName}!</div>

      {/* Metrics */}
      <div className="grid grid-cols-1 gap-4">
        <Card>
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <CardTitle className="text-lg md:text-xl">Your Jobs (last {dayRange} days)</CardTitle>
              <div className="w-full md:w-[160px]">
                <Select value={String(dayRange)} onValueChange={(v) => setDayRange(Number(v))}>
                  <SelectTrigger aria-label="Select day range">
                    <SelectValue placeholder="Select days" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="30">Last 30 days</SelectItem>
                    <SelectItem value="90">Last 90 days</SelectItem>
                    <SelectItem value="180">Last 180 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm md:text-base">
              <div className="flex justify-between"><span>Audio uploaded</span><span className="font-semibold">{breakdown.uploaded}</span></div>
              <div className="flex justify-between"><span>Audio recorded</span><span className="font-semibold">{breakdown.recorded}</span></div>
              <div className="flex justify-between"><span>Transcript uploaded</span><span className="font-semibold">{breakdown.transcript}</span></div>
              <div className="flex justify-between text-muted-foreground border-t pt-2"><span>Total</span><span className="font-semibold">{breakdown.total}</span></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {error && (
        <div className="text-red-600 text-sm">{error}</div>
      )}

  {/* Action Prompt */}
  <div className="text-base md:text-xl font-semibold">What action do you want to do?</div>

  {/* Quick Actions */}
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-2">
    <Button asChild className="h-16 md:h-24 text-base md:text-lg font-semibold flex items-center justify-center gap-2">
          <Link to="/audio-upload">
      <FileUp className="h-5 w-5 md:h-6 md:w-6" />
            Audio Upload
          </Link>
        </Button>
    <Button asChild className="h-16 md:h-24 text-base md:text-lg font-semibold flex items-center justify-center gap-2">
          <Link to="/transcript-upload">
      <Upload className="h-5 w-5 md:h-6 md:w-6" />
            Transcription Upload
          </Link>
        </Button>
    <Button asChild className="h-16 md:h-24 text-base md:text-lg font-semibold flex items-center justify-center gap-2">
          <Link to="/record-audio">
      <Mic className="h-5 w-5 md:h-6 md:w-6" />
            Record Audio
          </Link>
        </Button>
    <Button asChild className="h-16 md:h-24 text-base md:text-lg font-semibold flex items-center justify-center gap-2">
          <Link to="/audio-recordings">
      <FileAudio className="h-5 w-5 md:h-6 md:w-6" />
            Audio Recordings
          </Link>
        </Button>
      </div>

      {/* Role-based Management Buttons */}
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        {/* Prompt Management: admin, power_user */}
        {hasElevatedPrivileges(userRole) && (
      <Button asChild className="h-16 md:h-24 text-base md:text-lg font-semibold flex items-center justify-center gap-2">
            <Link to="/prompt-management" className="flex flex-col items-center justify-center">
              <span className="flex items-center gap-2">
        <FileText className="h-5 w-5 md:h-6 md:w-6" />
                <span>Prompt Management</span>
              </span>
              <span className="text-xs font-normal text-muted-foreground mt-1">(Power User, Admin)</span>
            </Link>
          </Button>
        )}
        {/* User Management: admin only */}
        {isAdmin(userRole) && (
      <Button asChild className="h-16 md:h-24 text-base md:text-lg font-semibold flex items-center justify-center gap-2">
            <Link to="/user-management" className="flex flex-col items-center justify-center">
              <span className="flex items-center gap-2">
        <Users className="h-5 w-5 md:h-6 md:w-6" />
                <span>User Management</span>
              </span>
              <span className="text-xs font-normal text-muted-foreground mt-1">(Admin)</span>
            </Link>
          </Button>
        )}
        {/* Analytics: admin only */}
        {isAdmin(userRole) && (
      <Button asChild className="h-16 md:h-24 text-base md:text-lg font-semibold flex items-center justify-center gap-2">
            <Link to="/analytics" className="flex flex-col items-center justify-center">
              <span className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 md:h-6 md:w-6" />
                <span>Analytics</span>
              </span>
              <span className="text-xs font-normal text-muted-foreground mt-1">(Admin)</span>
            </Link>
          </Button>
        )}
        {/* Audit: admin only */}
        {isAdmin(userRole) && (
      <Button asChild className="h-16 md:h-24 text-base md:text-lg font-semibold flex items-center justify-center gap-2">
            <Link to="/audit" className="flex flex-col items-center justify-center">
              <span className="flex items-center gap-2">
        <Search className="h-5 w-5 md:h-6 md:w-6" />
                <span>Audit</span>
              </span>
              <span className="text-xs font-normal text-muted-foreground mt-1">(Admin)</span>
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
