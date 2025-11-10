import { useUnifiedAccessToken, fetchJsonStrict } from "../lib/api";
import { apiUrl } from "../lib/apiUrl";
import { useMemo } from "react";

export interface AuditLogEntry {
  id?: string;
  timestamp?: string;
  date?: string;
  user_id: string;
  action_type: string;
  message?: string;
  resource_id?: string;
  component?: string;
  details?: Record<string, unknown>;
}

export function useAuditApi() {
  const getToken = useUnifiedAccessToken();
  return useMemo(() => ({
    listPaged: async (
      userId: string,
      days: number,
      opts?: { actions?: string[]; page?: number; pageSize?: number }
    ): Promise<{ logs: AuditLogEntry[]; page?: number; pageSize?: number; totalPages?: number; totalCount?: number }> => {
      const token = await getToken();
      if (!token) throw new Error("No authentication token available");
    const qs = new URLSearchParams({ user_id: userId, days: String(days) });
      if (opts?.actions && opts.actions.length) qs.set("actions", opts.actions.join(","));
      if (opts?.page) qs.set("page", String(opts.page));
      if (opts?.pageSize) qs.set("page_size", String(opts.pageSize));
  const url = apiUrl(`/admin/audit/logs?${qs.toString()}`);
  const data = await fetchJsonStrict(url, { headers: { Authorization: `Bearer ${token}` } });
      const rows = Array.isArray(data?.logs) ? (data.logs as AuditLogEntry[]) : [];
      // Already sorted by backend. Keep as-is.
      return {
        logs: rows,
        page: typeof data?.page === "number" ? data.page : undefined,
        pageSize: typeof data?.page_size === "number" ? data.page_size : undefined,
        totalPages: typeof data?.total_pages === "number" ? data.total_pages : undefined,
        totalCount: typeof data?.total_count === "number" ? data.total_count : undefined,
      };
    },
    list: async (userId: string, days: number, actions?: string[]): Promise<AuditLogEntry[]> => {
      const token = await getToken();
      if (!token) throw new Error("No authentication token available");
    const qs = new URLSearchParams({ user_id: userId, days: String(days) });
      if (actions && actions.length) qs.set("actions", actions.join(","));
  const url = apiUrl(`/admin/audit/logs?${qs.toString()}`);
  const data = await fetchJsonStrict(url, { headers: { Authorization: `Bearer ${token}` } });
      const rows = Array.isArray(data?.logs) ? data.logs as AuditLogEntry[] : [];
      // Ensure newest first
      return rows.sort((a, b) => (b.timestamp || b.date || "").localeCompare(a.timestamp || a.date || ""));
    },
    exportCsv: async (userId: string, days: number, actions?: string[]): Promise<Blob> => {
      const token = await getToken();
      if (!token) throw new Error("No authentication token available");
      const qs = new URLSearchParams({ user_id: userId, days: String(days) });
      if (actions && actions.length) qs.set("actions", actions.join(","));
  const url = apiUrl(`/admin/audit/logs/export?${qs.toString()}`);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      return await res.blob();
    }
  }), [getToken]);
}
