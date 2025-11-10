/**
 * Analytics Dashboard Component
 * Shows real audit logs and system metrics from backend API
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
// import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog"; // Debug Peek disabled
import { RefreshCw, AlertCircle, BarChart3, Users, Activity, Clock } from 'lucide-react';
import { useEnhancedUnifiedAuth } from '../../lib/useEnhancedUnifiedAuth';
import { useUserManagementApi, type User } from '@/api/user-management';
import { fetchJsonStrict } from "@/lib/api"; // Import fetchJsonStrict
import { apiUrl } from "@/lib/apiUrl";
import { debugConfig } from "@/env";
import { debugLog, debugWarn, debugError } from "@/lib/debug";

// Use centralized apiUrl helper

interface AnalyticsMetrics {
  totalJobs: number;
  completedJobs: number;
  activeUsers: number;
  averageProcessingTime: number;
  systemHealth: string;
}

interface UploadTypeBreakdown {
  uploaded: number;
  recorded: number;
  transcript: number;
}
interface CategoryRow {
  category_id: string;
  category_name?: string;
  count: number;
}

interface SubcategoryRow {
  category_id: string;
  category_name?: string;
  subcategory_id: string;
  subcategory_name?: string;
  count: number;
}

interface OverviewScopeData {
  totals: { total_jobs: number; completed_jobs: number; failed_jobs?: number; success_rate?: number };
  by_upload_type: UploadTypeBreakdown;
  by_category: CategoryRow[];
  by_subcategory: SubcategoryRow[];
  user_id?: string;
  // New optional field for active users (present on global only)
  active_users?: number;
}

interface OverviewResponse {
  period_days: number;
  generated_at: string;
  global: OverviewScopeData;
  user: OverviewScopeData & { user_id: string };
}

// Rollups summary response from backend /analytics/rollups/summary
interface RollupsSummaryResponse {
  scope: 'global' | 'user';
  user_id?: string | null;
  from: string;
  to: string;
  documents_count: number;
  totals: { total_jobs: number; completed_jobs: number; failed_jobs: number; success_rate: number };
  avg_processing_time_ms: number | null;
  by_upload_type: { uploaded: number; recorded: number; transcript: number; total: number };
  by_category: Array<{ category_id: string; count: number }>;
  by_subcategory: Array<{ category_id: string; subcategory_id: string; count: number }>;
  costs?: {
    total_cost: number;
    model_input_cost: number;
    model_output_cost: number;
    speech_audio_cost: number;
    currency: string;
  };
}

// interface DebugPeekResponse { /* Debug Peek disabled */
//   jobs_last_window?: number;
//   jobs_all_time?: number;
//   upload_types?: UploadTypeBreakdown;
//   latest_jobs?: any[];
//   job_lookup?: any;
//   [key: string]: any;
// }

const AnalyticsDashboard: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<AnalyticsMetrics>({
    totalJobs: 0,
    completedJobs: 0,
    activeUsers: 0,
    averageProcessingTime: 0,
    systemHealth: 'unknown'
  });
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [days, setDays] = useState<number>(30);
  // New: cost rollup state (GBP)
  const [globalCosts, setGlobalCosts] = useState<RollupsSummaryResponse['costs'] | null>(null);
  const [userCosts, setUserCosts] = useState<RollupsSummaryResponse['costs'] | null>(null);
  // Derived rollups are used only to compute averageProcessingTime; no need to store full responses in state
  // Debug Peek feature temporarily disabled
  // const [debugOpen, setDebugOpen] = useState(false);
  // const [debugLoading, setDebugLoading] = useState(false);
  // const [debugError, setDebugError] = useState<string | null>(null);
  // const [debugData, setDebugData] = useState<DebugPeekResponse | null>(null);

  // Admin/user selection state
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState<boolean>(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>(''); // empty => current user (me)
  // New: search-driven selector like Audit page
  const [userFilter, setUserFilter] = useState<string>('');
  // Stable timestamp for last successful data refresh (initial load or manual Refresh)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  // Track open/closed state for grouped accordions (Global/User) to show +/- indicators
  const [openCatsGlobal, setOpenCatsGlobal] = useState<Record<string, boolean>>({});
  const [openCatsUser, setOpenCatsUser] = useState<Record<string, boolean>>({});

  const { isAuthenticated } = useEnhancedUnifiedAuth();
  const userApi = useUserManagementApi();

  // Resolve the global auth manager used across the app
  const getAuthManager = (): any => {
    const w: any = typeof window !== 'undefined' ? window : {};
    return (
      w.authManager ||
      w.sonicBriefAuthManager ||
      w.enhancedAuthManager ||
      w.sonicBriefUnifiedAuth ||
      null
    );
  };

  // Note: Admin detection is done by probing /auth/admin/users; see effect below.

  // Optional: allow preselecting a user via ?user_id=...
  useEffect(() => {
    try {
      const usp = new URLSearchParams(window.location.search);
      const u = usp.get('user_id');
      if (u) setSelectedUserId(u);
    } catch {}
    // run once
  }, []);

  // Load admin flag and user list by probing the backend (authoritative)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setUsersLoading(true);
        setUsersError(null);
        // If the call succeeds, user is admin; populate list and show dropdown
        const list = await userApi.fetchUsers();
        if (!mounted) return;
        setIsAdmin(true);
        setUsers(list);
      } catch (e: any) {
        if (!mounted) return;
        const msg = e?.message || '';
        // 403 or explicit admin-required message => not admin; hide dropdown silently
        if (msg.toLowerCase().includes('admin') || msg.includes('403') || msg.toLowerCase().includes('access denied')) {
          setIsAdmin(false);
          setUsers([]);
          setUsersError(null);
        } else {
          // Other errors (network, server) -> surface a small error near the dropdown area
          setIsAdmin(false);
          setUsersError(msg || 'Failed to load users');
        }
      } finally {
        if (mounted) {
          setUsersLoading(false);
        }
      }
    })();
    return () => { mounted = false; };
  }, [isAuthenticated]);

  // New: live predictive filtering for user list (admin only), debounced like Audit page
  useEffect(() => {
    let mounted = true;
  const handler = setTimeout(async () => {
      if (!isAuthenticated || !isAdmin) return;
      // Reduce chatter: only query when filter is empty or has at least 2 chars
      if (userFilter && userFilter.trim().length < 2) return;
      try {
        const list = await userApi.fetchUsers(userFilter);
        if (!mounted) return;
        setUsers(list);
      } catch {
        // ignore filter errors to avoid noisy UI
      }
    }, 250);
    return () => { mounted = false; clearTimeout(handler); };
  }, [isAuthenticated, isAdmin, userFilter, userApi]);

  // New: local filtered slice for rendering quick suggestions (limit 25)
  const filteredUsers = useMemo(() => {
    const f = userFilter.trim().toLowerCase();
    if (!f) return users.slice(0, 25);
    return users.filter(u => (u.email || '').toLowerCase().includes(f)).slice(0, 25);
  }, [userFilter, users]);

  // Human-friendly selected user label for display
  const selectedUserLabel = useMemo(() => {
    if (!selectedUserId) return 'Me (current user)';
    const fromState = selectedUser?.email || selectedUser?.display_name;
    if (fromState) return fromState;
    const found = users.find(u => u.id === selectedUserId);
    return found?.email || found?.display_name || selectedUserId;
  }, [selectedUserId, users, selectedUser]);

  // Build Global hierarchical view: Service Area -> Service Functions
  type GlobalServiceFunction = { id: string; name: string; count: number };
  type GlobalServiceArea = { id: string; name: string; total: number; subfunctions: GlobalServiceFunction[] };

  // Important: declare hooks before any conditional returns to preserve hook order across renders
  const globalHierarchy = useMemo<GlobalServiceArea[]>(() => {
    try {
      const scope = overview?.global;
      if (!scope) return [];
      const catRows = Array.isArray(scope.by_category) ? scope.by_category : [];
      const subRows = Array.isArray(scope.by_subcategory) ? scope.by_subcategory : [];

      const map = new Map<string, GlobalServiceArea>();
      for (const row of catRows) {
        if (!row || !row.category_id) continue;
        const name = row.category_name || row.category_id;
        const count = typeof (row as any).count === 'number' ? (row as any).count : Number((row as any).count) || 0;
        map.set(row.category_id, { id: row.category_id, name, total: count, subfunctions: [] });
      }
      for (const row of subRows) {
        if (!row || !row.category_id || !row.subcategory_id) continue;
        const area = map.get(row.category_id) || {
          id: row.category_id,
          name: row.category_name || row.category_id,
          total: 0,
          subfunctions: [],
        };
        const count = typeof (row as any).count === 'number' ? (row as any).count : Number((row as any).count) || 0;
        area.subfunctions.push({ id: row.subcategory_id, name: row.subcategory_name || row.subcategory_id, count });
        map.set(row.category_id, area);
      }
      const list = Array.from(map.values());
      for (const a of list) {
        if (!a.total) a.total = a.subfunctions.reduce((acc, s) => acc + s.count, 0);
        a.subfunctions.sort((x, y) => (y.count - x.count) || x.name.localeCompare(y.name));
      }
      list.sort((x, y) => (y.total - x.total) || x.name.localeCompare(y.name));
      return list;
    } catch {
      return [];
    }
  }, [overview]);

  // Build User hierarchical view from overview.user
  const userHierarchy = useMemo<GlobalServiceArea[]>(() => {
    try {
      const scope = overview?.user;
      if (!scope) return [];
      const catRows = Array.isArray(scope.by_category) ? scope.by_category : [];
      const subRows = Array.isArray(scope.by_subcategory) ? scope.by_subcategory : [];

      const map = new Map<string, GlobalServiceArea>();
      for (const row of catRows) {
        if (!row || !row.category_id) continue;
        const name = row.category_name || row.category_id;
        const count = typeof (row as any).count === 'number' ? (row as any).count : Number((row as any).count) || 0;
        map.set(row.category_id, { id: row.category_id, name, total: count, subfunctions: [] });
      }
      for (const row of subRows) {
        if (!row || !row.category_id || !row.subcategory_id) continue;
        const area = map.get(row.category_id) || {
          id: row.category_id,
          name: row.category_name || row.category_id,
          total: 0,
          subfunctions: [],
        };
        const count = typeof (row as any).count === 'number' ? (row as any).count : Number((row as any).count) || 0;
        area.subfunctions.push({ id: row.subcategory_id, name: row.subcategory_name || row.subcategory_id, count });
        map.set(row.category_id, area);
      }
      const list = Array.from(map.values());
      for (const a of list) {
        if (!a.total) a.total = a.subfunctions.reduce((acc, s) => acc + s.count, 0);
        a.subfunctions.sort((x, y) => (y.count - x.count) || x.name.localeCompare(y.name));
      }
      list.sort((x, y) => (y.total - x.total) || x.name.localeCompare(y.name));
      return list;
    } catch {
      return [];
    }
  }, [overview]);

  const fetchAnalyticsData = async () => {
    if (!isAuthenticated) {
      setError('User not authenticated');
      return;
    }

    try {
      setLoading(true);
      setError(null);
  // Reset cost state to avoid showing stale values during refresh
  setGlobalCosts(null);
  setUserCosts(null);

      // Get auth token from the auth manager (support multiple globals + legacy)
      const authManager = getAuthManager();
      let token: string | null = null;
      if (authManager && typeof authManager.getToken === 'function') {
        token = await authManager.getToken();
      }
      if (!token && typeof window !== 'undefined') {
        token = window.localStorage?.getItem('token') || null;
      }
      if (!token) throw new Error('No authentication token available');

  const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      };
  // Fetch analytics overview (global + user breakdowns)
  const userQuery = isAdmin && selectedUserId ? `&user_id=${encodeURIComponent(selectedUserId)}` : '';
  const apiEndpoint = apiUrl(`/analytics/overview?days=${days}${userQuery}`);
      if (debugConfig.isEnabled()) {
        debugLog('🔍 Analytics API Debug:');
        debugLog('- API Endpoint:', apiEndpoint);
        debugLog('- Auth Token Available:', !!token);
        debugLog('- Headers:', headers);
      }

      try {
        const data = await fetchJsonStrict(apiEndpoint, { headers }) as OverviewResponse;
  debugLog('✅ Analytics Overview:', data);
        setOverview(data);

        // Derive top-level cards from global totals first
        setMetrics((m) => ({
          ...m,
          totalJobs: data.global.totals.total_jobs || 0,
          completedJobs: data.global.totals.completed_jobs || 0,
          systemHealth: 'healthy',
          activeUsers: typeof data.global.active_users === 'number' ? data.global.active_users : 0,
        }));

        // Fetch rollups summary for average processing time (global and optional user scope)
  try {
          const rollupGlobalUrl = apiUrl(`/analytics/rollups/summary?scope=global&days=${days}`);
          try {
            const roll = await fetchJsonStrict(rollupGlobalUrl, { headers }) as RollupsSummaryResponse;
            const avgSec = roll.avg_processing_time_ms ? Math.round((roll.avg_processing_time_ms / 1000) * 10) / 10 : 0;
            setMetrics((m) => ({ ...m, averageProcessingTime: avgSec }));
            if (roll.costs) setGlobalCosts(roll.costs);
          } catch {}
  } catch {}

        // Per-user rollup (always fetch for current user; include explicit user_id when admin selecting another user)
        try {
          const userParam = isAdmin && selectedUserId ? `&user_id=${encodeURIComponent(selectedUserId)}` : '';
          const rollupUserUrl = apiUrl(`/analytics/rollups/summary?scope=user&days=${days}${userParam}`);
          const userRoll = await fetchJsonStrict(rollupUserUrl, { headers }) as RollupsSummaryResponse;
          if (userRoll.costs) setUserCosts(userRoll.costs);
        } catch {}

        // Mark the last successful update time
        setLastUpdated(new Date());
      } catch (err: any) {
        // If analytics endpoint fails, show a helpful message instead of erroring
  debugWarn('❌ Analytics API Failed:', err?.status, err?.statusText, err?.body || err?.message);
        setMetrics({
          totalJobs: 0,
          completedJobs: 0,
          averageProcessingTime: 0,
          activeUsers: 0,
          systemHealth: `API Error ${err?.status || ''}`.trim()
        });
      }

    } catch (err: any) {
      debugError('🚨 Analytics Error Details:', {
        message: err.message,
        stack: err.stack,
        full: err
      });

      // Don't show error for API not being ready - show informational message instead
      setMetrics({
        totalJobs: 0,
        completedJobs: 0,
        averageProcessingTime: 0,
        activeUsers: 0,
        systemHealth: `Connection Error: ${err.message}`
      });
      setError(null); // Don't show error, just show the "connecting" state
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalyticsData();
  }, [isAuthenticated, days, isAdmin, selectedUserId]);

  const refreshData = () => {
    fetchAnalyticsData();
  };

  // const fetchDebugPeek = async () => { /* disabled */ };

  const downloadExport = async (scope: 'global' | 'user', format: 'csv' | 'json' = 'csv') => {
    try {
      const authManager = getAuthManager();
      let token: string | null = null;
      if (authManager && typeof authManager.getToken === 'function') {
        token = await authManager.getToken();
      }
      if (!token && typeof window !== 'undefined') {
        token = window.localStorage?.getItem('token') || null;
      }
      const headers: any = { 'Authorization': `Bearer ${token}` };
      const userQuery = scope === 'user' && isAdmin && selectedUserId ? `&user_id=${encodeURIComponent(selectedUserId)}` : '';
      const url = apiUrl(`/analytics/overview/export?days=${days}&scope=${scope}&format=${format}${userQuery}`);
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const userSuffix = scope === 'user' && isAdmin && selectedUserId ? `_${selectedUserId}` : '';
      a.download = `analytics_${scope}${userSuffix}_${days}d.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
  debugError('Export error', e);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-600">Loading analytics data...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <Card className="border-red-200 max-w-md">
          <CardContent className="pt-6">
            <div className="flex items-center text-red-600 mb-4">
              <AlertCircle className="h-6 w-6 mr-2" />
              <span className="font-semibold">Error Loading Analytics</span>
            </div>
            <p className="text-gray-600 mb-4">{error}</p>
            <button
              onClick={refreshData}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Retry
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const successRate = metrics.totalJobs > 0 ? (metrics.completedJobs / metrics.totalJobs * 100).toFixed(1) : '0';
  const formatCurrency = (v: number | undefined) => {
    if (typeof v !== 'number' || isNaN(v)) return '£0.00';
    if (v > 0 && v < 0.0001) return '<£0.0001';
    const small = v > 0 && v < 0.01;
    try {
      return new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: 'GBP',
        minimumFractionDigits: small ? 4 : 2,
        maximumFractionDigits: small ? 4 : 2,
      }).format(v);
    } catch {
      return `£${small ? v.toFixed(4) : v.toFixed(2)}`;
    }
  };

  // (Removed hierarchical grouped view to stabilize rendering)

  return (
    <div className="space-y-6">
      {/* Controls in a single top card */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <label htmlFor="analytics-range" className="text-sm text-muted-foreground">Range:</label>
              <select
                id="analytics-range"
                aria-label="Analytics range"
                className="min-w-[180px] rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={days}
                onChange={(e) => setDays(parseInt(e.target.value, 10))}
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
                <option value={180}>Last 180 days</option>
              </select>

              {/* Admin user selector moved to its own row below */}

              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={refreshData}
                  className="flex items-center gap-2 px-3 py-2 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </button>
                <div className="text-sm text-muted-foreground">
                  Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}
                </div>
              </div>
            </div>

            {/* Export buttons row below Refresh/Last updated */}
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => downloadExport('global', 'csv')} className="px-3 py-2 text-sm rounded bg-secondary text-secondary-foreground hover:bg-secondary/80">Export Global CSV</button>
              <button onClick={() => downloadExport('user', 'csv')} className="px-3 py-2 text-sm rounded bg-secondary text-secondary-foreground hover:bg-secondary/80">Export User CSV</button>
            </div>

            {/* Admin user selector row (below date selector, above user list) */}
            {isAdmin && (
              <div className="flex items-center gap-2">
                <label htmlFor="analytics-user" className="text-sm text-muted-foreground">User:</label>
                <input
                  id="analytics-user"
                  type="text"
                  placeholder="Type to search by email..."
                  value={userFilter}
                  onChange={(e) => setUserFilter(e.target.value)}
                  className="w-[260px] max-w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {selectedUserId && (
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded border border-input bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    onClick={() => { setSelectedUserId(''); setSelectedUser(null); setUserFilter(''); }}
                    title="Use current user"
                  >
                    Me
                  </button>
                )}
                {(usersLoading && users.length === 0) && <span className="text-xs text-muted-foreground">Loading…</span>}
                {usersError && <span className="text-xs text-red-600">{usersError}</span>}
              </div>
            )}

            {/* In-flow suggestions within the card so content below isn't masked */}
            {isAdmin && (
              <>
                <div className="mt-2 max-h-48 overflow-auto rounded border border-border bg-popover text-popover-foreground">
                  {filteredUsers.map((u) => (
                    <button
                      key={u.id}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-accent ${selectedUser?.id === u.id ? 'bg-accent' : ''}`}
                      onClick={() => { setSelectedUser(u); setSelectedUserId(u.id); }}
                    >
                      <div className="font-medium">{u.email}</div>
                      <div className="text-xs text-muted-foreground">{u.display_name || u.id}</div>
                    </button>
                  ))}
                  {filteredUsers.length === 0 && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No matches</div>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">Selected: {selectedUserLabel}</div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

        {/* Success panel removed per request */}

      {/* Global (left) and User (right) wrapped in top-level cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Global column card */}
        <Card className="h-full">
          <CardHeader>
            <CardTitle>Global</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {/* Global Cost Cards */}
                {globalCosts && (
                  <Card className="sm:col-span-2">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Total Cost (Global)</CardTitle>
                      <span className="text-xs text-muted-foreground">{globalCosts.currency || 'GBP'}</span>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{formatCurrency(globalCosts.total_cost)}</div>
                      <p className="text-xs text-muted-foreground">
                        Input {formatCurrency(globalCosts.model_input_cost)} • Output {formatCurrency(globalCosts.model_output_cost)} • Speech {formatCurrency(globalCosts.speech_audio_cost)}
                      </p>
                    </CardContent>
                  </Card>
                )}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Jobs</CardTitle>
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{metrics.totalJobs}</div>
                    <p className="text-xs text-muted-foreground">Last {overview?.period_days ?? days} days</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Completed Jobs</CardTitle>
                    <Activity className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{metrics.completedJobs}</div>
                    <p className="text-xs text-muted-foreground">{successRate}% success rate</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">System Status</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold capitalize">{metrics.systemHealth}</div>
                    <p className="text-xs text-muted-foreground">{metrics.activeUsers} connections</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Avg Processing Time</CardTitle>
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {metrics.averageProcessingTime === 0 && metrics.completedJobs > 0
                        ? 'N/A'
                        : `${metrics.averageProcessingTime}s`}
                    </div>
                    <p className="text-xs text-muted-foreground">Per audio file</p>
                  </CardContent>
                </Card>
              </div>

              {overview && (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle>Upload Types (Global)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between"><span>Audio uploaded</span><span className="font-semibold">{overview.global.by_upload_type.uploaded}</span></div>
                        <div className="flex justify-between"><span>Audio recorded</span><span className="font-semibold">{overview.global.by_upload_type.recorded}</span></div>
                        <div className="flex justify-between"><span>Transcript uploaded</span><span className="font-semibold">{overview.global.by_upload_type.transcript}</span></div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Hierarchical Service Areas (Global) with +/- indicator */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Service Areas (Global, grouped)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {globalHierarchy.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No data</div>
                      ) : (
                        <div className="w-full divide-y">
                          {globalHierarchy.map((cat) => (
                            <details
                              key={cat.id}
                              className="py-2"
                              onToggle={(e) => {
                                const open = (e.currentTarget as HTMLDetailsElement).open;
                                setOpenCatsGlobal((prev) => ({ ...prev, [cat.id]: open }));
                              }}
                            >
                              <summary className="flex w-full cursor-pointer list-none items-center justify-between py-2">
                                <div className="flex items-center gap-2">
                                  <span className="inline-block w-4 text-center align-middle select-none">
                                    {openCatsGlobal[cat.id] ? '−' : '+'}
                                  </span>
                                  <span>{cat.name}</span>
                                </div>
                                <span className="font-semibold">{cat.total}</span>
                              </summary>
                              <div className="space-y-2 text-sm pl-2">
                                {cat.subfunctions.length > 0 ? (
                                  cat.subfunctions.map((sf) => (
                                    <div key={sf.id} className="flex justify-between">
                                      <span className="text-muted-foreground">{sf.name}</span>
                                      <span className="font-medium">{sf.count}</span>
                                    </div>
                                  ))
                                ) : (
                                  <div className="text-muted-foreground">No Service Functions</div>
                                )}
                              </div>
                            </details>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* User column card */}
        <Card className="h-full">
          <CardHeader>
            <CardTitle>User</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {overview && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    {userCosts && (
                      <Card className="sm:col-span-2">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                          <CardTitle className="text-sm font-medium">Total Cost ({isAdmin && selectedUserId ? 'Selected user' : 'My activity'})</CardTitle>
                          <span className="text-xs text-muted-foreground">{userCosts.currency || 'GBP'}</span>
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-bold">{formatCurrency(userCosts.total_cost)}</div>
                          <p className="text-xs text-muted-foreground">
                            Input {formatCurrency(userCosts.model_input_cost)} • Output {formatCurrency(userCosts.model_output_cost)} • Speech {formatCurrency(userCosts.speech_audio_cost)}
                          </p>
                        </CardContent>
                      </Card>
                    )}
                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Jobs ({isAdmin && selectedUserId ? 'Selected user' : 'My activity'})</CardTitle>
                        <BarChart3 className="h-4 w-4 text-muted-foreground" />
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">{overview.user.totals.total_jobs}</div>
                        <p className="text-xs text-muted-foreground">Last {overview.period_days} days</p>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Completed Jobs ({isAdmin && selectedUserId ? 'Selected user' : 'My activity'})</CardTitle>
                        <Activity className="h-4 w-4 text-muted-foreground" />
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">{overview.user.totals.completed_jobs}</div>
                        <p className="text-xs text-muted-foreground">{Math.round((overview.user.totals.success_rate || 0) * 1000) / 10}% success rate</p>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle>Upload Types ({isAdmin && selectedUserId ? 'Selected user' : 'My activity'})</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between"><span>Audio uploaded</span><span className="font-semibold">{overview.user.by_upload_type.uploaded}</span></div>
                        <div className="flex justify-between"><span>Audio recorded</span><span className="font-semibold">{overview.user.by_upload_type.recorded}</span></div>
                        <div className="flex justify-between"><span>Transcript uploaded</span><span className="font-semibold">{overview.user.by_upload_type.transcript}</span></div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Hierarchical Service Areas (User) with +/- indicator */}
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        Service Areas ({isAdmin && selectedUserId ? 'Selected user' : 'My activity'}, grouped)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {userHierarchy.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No data</div>
                      ) : (
                        <div className="w-full divide-y">
                          {userHierarchy.map((cat) => (
                            <details
                              key={cat.id}
                              className="py-2"
                              onToggle={(e) => {
                                const open = (e.currentTarget as HTMLDetailsElement).open;
                                setOpenCatsUser((prev) => ({ ...prev, [cat.id]: open }));
                              }}
                            >
                              <summary className="flex w-full cursor-pointer list-none items-center justify-between py-2">
                                <div className="flex items-center gap-2">
                                  <span className="inline-block w-4 text-center align-middle select-none">
                                    {openCatsUser[cat.id] ? '−' : '+'}
                                  </span>
                                  <span>{cat.name}</span>
                                </div>
                                <span className="font-semibold">{cat.total}</span>
                              </summary>
                              <div className="space-y-2 text-sm pl-2">
                                {cat.subfunctions.length > 0 ? (
                                  cat.subfunctions.map((sf) => (
                                    <div key={sf.id} className="flex justify-between">
                                      <span className="text-muted-foreground">{sf.name}</span>
                                      <span className="font-medium">{sf.count}</span>
                                    </div>
                                  ))
                                ) : (
                                  <div className="text-muted-foreground">No Service Functions</div>
                                )}
                              </div>
                            </details>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

  {/* Recent Activity panel removed per request */}

  {/* Debug Peek Modal disabled */}
    </div>
  );
};

export default AnalyticsDashboard;
