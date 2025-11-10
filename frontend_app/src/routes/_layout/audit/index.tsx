import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEnhancedUnifiedAuth } from "@/lib/useEnhancedUnifiedAuth";
import { useUserManagementApi, type User } from "@/api/user-management";
import { useAuditApi, type AuditLogEntry } from "@/api/audit";
import { useUnifiedAccessToken } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Search, Eye } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_layout/audit/")({
  component: AuditPage,
});

const dayOptions = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
  { label: "180 days", value: 180 },
];

// Helper to decode email from JWT without extra network calls
function getEmailFromToken(jwt: string | null): string | null {
  if (!jwt) return null;
  try {
    const [, payloadBase64] = jwt.split(".");
    if (!payloadBase64) return null;
    const payload = JSON.parse(atob(payloadBase64.replace(/-/g, "+").replace(/_/g, "/")));
    return (
      payload.email ||
      payload.preferred_username ||
      payload.upn ||
      payload.unique_name ||
      null
    );
  } catch {
    return null;
  }
}

function AuditPage() {
  const { isAuthenticated, isLoading } = useEnhancedUnifiedAuth();
  const router = useRouter();

  const userApi = useUserManagementApi();
  const auditApi = useAuditApi();
  const getToken = useUnifiedAccessToken();

  // isAdmin: null = still determining (prevents false 'Access denied' flash)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [userFilter, setUserFilter] = useState<string>("");
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [days, setDays] = useState<number>(30);
  const [allActions, setAllActions] = useState<boolean>(true);
  // Canonical action options. Use LOGIN_GROUP to represent Login+Logout
  const actionOptions = useMemo(() => [
    { label: "Login/Logout", value: "LOGIN_GROUP" },
    // Job lifecycle
    { label: "Completed", value: "JOB_COMPLETED" },
    { label: "Job viewed", value: "JOB_VIEWED" },
    // Upload/Record
    { label: "Audio uploaded", value: "AUDIO UPLOADED" },
    { label: "Audio recorded", value: "AUDIO RECORDED" },
    { label: "Transcript uploaded", value: "TRANSCRIPT UPLOADED" },
    // Account management
    { label: "Account deleted", value: "ACCOUNT DELETED" },
    { label: "Account updated", value: "ACCOUNT UPDATED" },
    // Prompt management
    { label: "Prompt created", value: "PROMPT CREATED" },
    { label: "Prompt updated", value: "PROMPT UPDATED" },
    { label: "Prompt deleted", value: "PROMPT DELETED" },
  ], []);
  const [selectedActions, setSelectedActions] = useState<string[]>([actionOptions[0].value]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const pageSize = 50; // fixed per requirement
  // Modal state
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<AuditLogEntry | null>(null);
  const openDetails = (item: AuditLogEntry) => { setDetailItem(item); setDetailOpen(true); };

  // Redirect unauthenticated users
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.navigate({ to: "/login" });
    }
  }, [isAuthenticated, isLoading, router]);

  // Admin detection + initial users list
  useEffect(() => {
    let mounted = true;
    // Reset when auth state changes
    if (!isAuthenticated) {
      setIsAdmin(null);
      setUsers([]);
      return () => { mounted = false; };
    }
    (async () => {
      try {
        const list = await userApi.fetchUsers(userFilter);
        if (!mounted) return;
        setIsAdmin(true);
        setUsers(list);
      } catch (e: any) {
        if (!mounted) return;
        const msg = e?.message || "";
        if (msg.toLowerCase().includes("admin") || msg.includes("403") || msg.toLowerCase().includes("access denied")) {
          setIsAdmin(false);
          setUsers([]);
        } else {
          // Network/other error – treat as non-admin for now (could refine)
          setIsAdmin(false);
          setUsers([]);
        }
      }
    })();
    return () => { mounted = false; };
  }, [isAuthenticated]);

  // Preselect current user by decoding email from token once users are available
  useEffect(() => {
    let active = true;
    (async () => {
      if (!isAuthenticated || !isAdmin || selectedUser || users.length === 0) return;
      try {
        const token = await getToken();
        const email = (getEmailFromToken(token) || "").toLowerCase();
        if (!active || !email) return;
        const found = users.find(u => (u.email || "").toLowerCase() === email);
        if (found) setSelectedUser(found);
      } catch {
        // ignore
      }
    })();
  return () => { active = false; };
  }, [isAuthenticated, isAdmin, users.length]);

  // Live predictive filtering – refetch users when filter changes (admin only)
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

  const filteredUsers = useMemo(() => {
    const f = userFilter.trim().toLowerCase();
    if (!f) return users.slice(0, 25);
    return users.filter(u => (u.email || "").toLowerCase().includes(f)).slice(0, 25);
  }, [userFilter, users]);

  // Human-friendly selected user label for display (mirror Analytics behavior)
  const selectedUserLabel = useMemo(() => {
    if (selectedUser) return selectedUser.email || selectedUser.display_name || selectedUser.id;
    return "Pick a user";
  }, [selectedUser]);

  const loadLogs = useCallback(async (targetPage?: number) => {
    if (!selectedUser) return;
    setLoading(true);
    setError(null);
    try {
      const { logs: rows, totalPages: tp } = await auditApi.listPaged(
        selectedUser.id,
        days,
        {
          actions: allActions ? undefined : selectedActions,
          page: targetPage ?? page,
          pageSize,
        }
      );
      setLogs(rows);
      setTotalPages(tp || 1);
    } catch (e: any) {
      setError(e?.message || "Failed to load audit logs");
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [auditApi, selectedUser?.id, days, allActions, selectedActions, page]);

  // Reset to page 1 when filters change (user, days, actions)
  useEffect(() => {
    setPage(1);
  }, [selectedUser?.id, days, allActions, selectedActions.join("|")]);

  // One-time initial fetch on page load with all actions (after user/admin context ready)
  const initialFetchDone = useRef(false);
  useEffect(() => {
    if (!isAuthenticated || !isAdmin || !selectedUser) return;
    if (initialFetchDone.current) return;
    initialFetchDone.current = true;
  setPage(1);
  // Run initial filter fetch once
  void loadLogs(1);
  }, [isAuthenticated, isAdmin, selectedUser, loadLogs]);

  const onExport = async () => {
    if (!selectedUser) return;
    try {
      const blob = await auditApi.exportCsv(
        selectedUser.id,
        days,
        allActions ? undefined : selectedActions
      );
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const suffix = allActions ? "" : `_${selectedActions.join("-")}`;
      a.download = `audit_${selectedUser.email || selectedUser.id}_${days}d${suffix}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      console.error("Export failed", e);
    }
  };
  // Avoid flashing a loading message for very fast auth resolutions by using a delay
  const [showDelayedLoader, setShowDelayedLoader] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (isLoading) {
      timer = setTimeout(() => setShowDelayedLoader(true), 300); // show only if still loading after 300ms
    } else {
      setShowDelayedLoader(false);
    }
    return () => { if (timer) clearTimeout(timer); };
  }, [isLoading]);

  if (isLoading && showDelayedLoader) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  if (!isLoading && !isAuthenticated) return null; // unauth redirect handled above
  // Wait until isAdmin is resolved (null means still checking)
  if (!isLoading && isAdmin === false) return <div className="p-4">Access denied. Admin role required.</div>;
  if (isAdmin === null) {
    return <div className="p-4 text-sm text-muted-foreground">Preparing audit view…</div>;
  }

  return (
  <div className="space-y-4 p-4 pt-6 md:p-8">
    {/* Constrained content width while preserving left alignment (no mx-auto) */}
  <div className="space-y-1 max-w-5xl">
          <nav className="flex items-center text-sm text-muted-foreground mb-1" aria-label="Breadcrumb">
            <a href="/home" className="hover:underline">Home</a>
            <span className="mx-2">&gt;</span>
            <span className="font-semibold flex items-center gap-1"><Search className="inline h-5 w-5 md:h-6 md:w-6 mr-1" />Audit</span>
          </nav>
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2"><Search className="inline h-5 w-5 md:h-6 md:w-6 mr-1" />Audit</h2>
          <p className="text-muted-foreground text-sm">View and export user audit logs</p>
        </div>
  {/* Primary filter card constrained to design width */}
  <Card className="w-full max-w-5xl">
          <CardContent className="pt-6">
        <div className="space-y-3">
          {/* Top row: Date range + buttons */}
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <label className="block text-sm font-medium mb-1 text-muted-foreground">Date range</label>
              <select
                title="Select date range"
                value={days}
                onChange={(e) => setDays(parseInt(e.target.value, 10))}
                className="min-w-[180px] rounded-md border border-input bg-background px-2 py-2 text-sm text-foreground shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {dayOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="ml-auto flex gap-2">
              <button onClick={() => { setPage(1); loadLogs(1); }} className="px-3 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90">Filter</button>
              <button onClick={onExport} className="px-3 py-2 rounded bg-secondary text-secondary-foreground hover:bg-secondary/80">Export CSV</button>
            </div>
          </div>

          {/* Second row: User selector and Actions side by side */}
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1 min-w-[260px]">
              <label className="block text-sm font-medium mb-1 text-muted-foreground">User (email)</label>
              <input
                type="text"
                placeholder="Type to search by email..."
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="mt-2 max-h-48 overflow-auto rounded border border-border bg-popover text-popover-foreground">
                {filteredUsers.map((u) => (
                  <button
                    key={u.id}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-accent ${selectedUser?.id === u.id ? 'bg-accent' : ''}`}
                    onClick={() => setSelectedUser(u)}
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
            </div>
            <div className="min-w-[260px]">
              <label className="block text-sm font-medium mb-1 text-muted-foreground">Actions</label>
              <div className="flex items-center gap-3 mb-2">
                <label className="inline-flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={allActions}
                    onChange={(e) => setAllActions(e.target.checked)}
                  />
                  All actions
                </label>
              </div>
              <div className={`rounded border border-border bg-background p-2 ${allActions ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="flex flex-wrap gap-2">
                  {actionOptions.map(opt => {
                    const checked = selectedActions.includes(opt.value);
                    return (
                      <label key={opt.value} className={`inline-flex items-center gap-2 rounded border px-2 py-1 text-sm cursor-pointer ${checked ? 'bg-accent' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const c = e.target.checked;
                            setSelectedActions(prev => {
                              const set = new Set(prev);
                              if (c) set.add(opt.value); else set.delete(opt.value);
                              return Array.from(set);
                            });
                          }}
                        />
                        {opt.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
          </CardContent>
        </Card>

        {error && (
          <div className="w-full max-w-5xl p-2 rounded border border-destructive/30 bg-destructive/10 text-destructive">{error}</div>
        )}

  <div className="w-full max-w-5xl">
          <div className="rounded-lg border bg-card shadow">
            <table className="w-full border-0 text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="border-b p-2 text-left font-semibold w-[150px]">Timestamp</th>
                  <th className="border-b p-2 text-left font-semibold w-[130px]">Action</th>
                  <th className="border-b p-2 text-left font-semibold w-[300px]">Message</th>
                  <th className="border-b p-2 text-left font-semibold w-[150px]">Resource</th>
                  <th className="border-b p-2 text-left font-semibold w-[150px]">Component</th>
                  <th className="border-b p-2 text-left font-semibold w-[80px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td className="p-3" colSpan={6}>Loading...</td></tr>
                ) : logs.length === 0 ? (
                  <tr><td className="p-3" colSpan={6}>No audit entries</td></tr>
                ) : (
                  logs.map((l, idx) => (
                    <tr key={l.id || idx} className="even:bg-muted/50">
                      <td className="border-b p-2 align-top text-xs w-[150px] max-w-[150px] truncate" title={l.timestamp || l.date}>{l.timestamp || l.date}</td>
                      <td className="border-b p-2 align-top text-xs w-[130px] max-w-[130px] break-words whitespace-pre-wrap" title={l.action_type}>{l.action_type}</td>
                      <td className="border-b p-2 w-[300px] max-w-[300px] whitespace-pre-wrap break-words text-xs leading-snug" title={l.message}>{l.message}</td>
                      <td className="border-b p-2 align-top text-xs break-words max-w-[150px] whitespace-pre-wrap" title={l.resource_id || '-'}>{l.resource_id || '-'}</td>
                      <td className="border-b p-2 align-top text-xs break-words max-w-[150px] whitespace-pre-wrap" title={l.component || '-'}>{l.component || '-'}</td>
                      <td className="border-b p-2 text-center align-top w-[80px]">
                        <button
                          type="button"
                          onClick={() => openDetails(l)}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border hover:bg-accent"
                          title="View full details"
                        >
                          <Eye className="h-3.5 w-3.5" /> View
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
  <div className="w-full max-w-5xl flex items-center justify-between gap-3 pt-2">
          <div className="text-sm text-muted-foreground">Page {page} of {totalPages}</div>
          <div className="flex items-center gap-2">
            <button
              className="px-3 py-2 rounded border disabled:opacity-50"
              onClick={() => {
                const np = Math.max(1, page - 1);
                if (np !== page && !loading) {
                  setPage(np);
                  loadLogs(np);
                }
              }}
              disabled={page <= 1 || loading}
            >Previous</button>
            <button
              className="px-3 py-2 rounded border disabled:opacity-50"
              onClick={() => {
                const np = Math.min(totalPages || 1, page + 1);
                if (np !== page && !loading) {
                  setPage(np);
                  loadLogs(np);
                }
              }}
              disabled={page >= (totalPages || 1) || loading}
            >Next</button>
          </div>
        </div>
  {/* Details Modal */}
  <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Audit Entry Details</DialogTitle>
      </DialogHeader>
      {!detailItem ? (
        <div className="text-sm text-muted-foreground">No entry selected.</div>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="font-medium text-muted-foreground">Timestamp</div>
              <div className="font-mono text-xs break-all">{detailItem.timestamp || detailItem.date}</div>
            </div>
            <div>
              <div className="font-medium text-muted-foreground">Action</div>
              <div><Badge variant="secondary" className="text-xs">{detailItem.action_type}</Badge></div>
            </div>
            <div>
              <div className="font-medium text-muted-foreground">User ID</div>
              <div className="font-mono text-xs break-all">{detailItem.user_id || '-'}</div>
            </div>
            <div>
              <div className="font-medium text-muted-foreground">Resource ID</div>
              <div className="font-mono text-xs break-all">{detailItem.resource_id || '-'}</div>
            </div>
            <div>
              <div className="font-medium text-muted-foreground">Component</div>
              <div className="font-mono text-xs break-all">{detailItem.component || '-'}</div>
            </div>
            <div>
              <div className="font-medium text-muted-foreground">Severity</div>
              <div className="font-mono text-xs break-all">{detailItem.severity || '-'}</div>
            </div>
          </div>
          <div>
            <div className="font-medium text-muted-foreground mb-1">Message</div>
            <div className="rounded border p-2 bg-muted/40 text-xs whitespace-pre-wrap break-words max-h-40 overflow-auto">{detailItem.message || '-'}</div>
          </div>
          {detailItem.details && (
            <div>
              <div className="font-medium text-muted-foreground mb-1">Details (JSON)</div>
              <pre className="rounded border p-2 bg-muted/40 text-xs max-h-56 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(detailItem.details, null, 2)}</pre>
            </div>
          )}
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => setDetailOpen(false)}
              className="px-3 py-2 rounded border text-sm hover:bg-accent"
            >Close</button>
          </div>
        </div>
      )}
    </DialogContent>
  </Dialog>
  </div>
  );
}
