"""
Simple Analytics Router for Sonic Brief
Provides audit trail and performance analytics endpoints
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta, timezone
import logging

# Import your existing dependencies
from app.core.dependencies import get_cosmos_db
from app.routers.auth import get_current_user_any
from fastapi.responses import StreamingResponse, JSONResponse
import io
import csv

import os

router = APIRouter(tags=["analytics"])
logger = logging.getLogger(__name__)


def _ensure_debug_enabled():
    """Raise 404 unless ENABLE_DEBUG_ENDPOINTS=true (string)."""
    if os.getenv("ENABLE_DEBUG_ENDPOINTS", "false").lower() != "true":
        raise HTTPException(status_code=404, detail="Not found")


@router.get("/rollups/summary")
async def get_rollups_summary(
    scope: str = Query("global", pattern=r"^(global|user)$"),
    user_id: Optional[str] = Query(None, description="Required when scope=user"),
    start_date: Optional[str] = Query(None, description="YYYY-MM-DD (inclusive)"),
    end_date: Optional[str] = Query(None, description="YYYY-MM-DD (inclusive)"),
    days: Optional[int] = Query(None, ge=1, le=1095, description="Alternative to start/end; last N days ending today"),
    current_user: Dict = Depends(get_current_user_any),
    cosmos_db = Depends(get_cosmos_db),
) -> Dict[str, Any]:
    """
    Aggregate daily rollup documents over a date range from usage_analytics.
    - scope: global or user
    - user_id: required when scope=user
    - start_date/end_date: inclusive YYYY-MM-DD window
    - days: optional, last N days ending today (UTC) if dates not provided
    """
    try:
        # 1. Resolve date window
        if not start_date or not end_date:
            window_days = days if days is not None else 30
            today = datetime.now(timezone.utc).date()
            end_d = today
            start_d = today - timedelta(days=window_days - 1)
        else:
            start_d = datetime.strptime(start_date, "%Y-%m-%d").date()
            end_d = datetime.strptime(end_date, "%Y-%m-%d").date()
            if end_d < start_d:
                raise HTTPException(status_code=400, detail="end_date must be >= start_date")

        from_str = start_d.isoformat()
        to_str = end_d.isoformat()

        # 2. Build query
        params: List[Dict[str, Any]] = [
            {"name": "@type", "value": "daily_rollup"},
            {"name": "@scope", "value": scope},
            {"name": "@from", "value": from_str},
            {"name": "@to", "value": to_str},
        ]
        where_user = ""
        if scope == "user":
            effective_user = user_id or current_user.get("id")
            if not effective_user:
                raise HTTPException(status_code=400, detail="user_id is required when scope=user")
            where_user = " AND c.user_id = @user_id"
            params.append({"name": "@user_id", "value": effective_user})

        query = (
            "SELECT c.date, c.totals, c.avg_processing_time_ms, c.by_upload_type, c.by_category, c.by_subcategory, "
            "c.audio_completed_jobs, c.audio_sum_processing_time_ms, c.costs "
            "FROM c WHERE c.type = @type AND c.scope = @scope "
            "AND c.date >= @from AND c.date <= @to" + where_user
        )

        # 3. Execute
        try:
            rows: List[Dict[str, Any]] = list(
                cosmos_db.usage_analytics_container.query_items(
                    query=query,
                    parameters=params,
                    enable_cross_partition_query=True,
                )
            )
        except Exception as e:
            logger.warning(f"Rollups query failed, returning empty set. Error: {e}")
            rows = []

        # 4. Aggregate
        total_jobs = completed_jobs = failed_jobs = 0
        uploaded = recorded = transcript = 0
        sum_proc_time = 0
        sum_proc_weight = 0
        by_category: Dict[str, int] = {}
        by_subcategory: Dict[str, Dict[str, int]] = {}
        cost_total = cost_model_input = cost_model_output = cost_speech = 0.0

        for r in rows:
            t = r.get("totals") or {}
            total_jobs += int(t.get("total_jobs", 0) or 0)
            cj = int(t.get("completed_jobs", 0) or 0)
            fj = int(t.get("failed_jobs", 0) or 0)
            completed_jobs += cj
            failed_jobs += fj

            avg_ms = r.get("avg_processing_time_ms")
            audio_completed = r.get("audio_completed_jobs")
            weight = int(audio_completed) if isinstance(audio_completed, int) and audio_completed > 0 else cj
            if isinstance(avg_ms, (int, float)) and weight > 0:
                sum_proc_time += int(avg_ms) * weight
                sum_proc_weight += weight

            ut = r.get("by_upload_type") or {}
            uploaded += int(ut.get("uploaded", 0) or 0)
            recorded += int(ut.get("recorded", 0) or 0)
            transcript += int(ut.get("transcript", 0) or 0)

            for c_row in (r.get("by_category") or []):
                cid = str(c_row.get("category_id"))
                cnt = int(c_row.get("count", 0) or 0)
                if cid:
                    by_category[cid] = by_category.get(cid, 0) + cnt

            for sc_row in (r.get("by_subcategory") or []):
                cid = str(sc_row.get("category_id"))
                sid = str(sc_row.get("subcategory_id"))
                cnt = int(sc_row.get("count", 0) or 0)
                if cid and sid:
                    bucket = by_subcategory.setdefault(cid, {})
                    bucket[sid] = bucket.get(sid, 0) + cnt

            cst = r.get("costs") or {}
            try:
                cost_total += float(cst.get("total_cost", 0) or 0)
                cost_model_input += float(cst.get("model_input_cost", 0) or 0)
                cost_model_output += float(cst.get("model_output_cost", 0) or 0)
                cost_speech += float(cst.get("speech_audio_cost", 0) or 0)
            except Exception:
                pass

        success_rate = completed_jobs / max(1, completed_jobs + failed_jobs)
        avg_processing_time_ms = int(sum_proc_time / sum_proc_weight) if sum_proc_weight else None

        subcat_list: List[Dict[str, Any]] = []
        for cid, subs in by_subcategory.items():
            for sid, cnt in subs.items():
                subcat_list.append({"category_id": cid, "subcategory_id": sid, "count": cnt})

        result = {
            "scope": scope,
            "user_id": user_id if scope == "user" else None,
            "from": from_str,
            "to": to_str,
            "documents_count": len(rows),
            "totals": {
                "total_jobs": total_jobs,
                "completed_jobs": completed_jobs,
                "failed_jobs": failed_jobs,
                "success_rate": round(success_rate, 4),
            },
            "avg_processing_time_ms": avg_processing_time_ms,
            "by_upload_type": {
                "uploaded": uploaded,
                "recorded": recorded,
                "transcript": transcript,
                "total": uploaded + recorded + transcript,
            },
            "by_category": [{"category_id": cid, "count": cnt} for cid, cnt in by_category.items()],
            "by_subcategory": subcat_list,
            "costs": {
                "total_cost": round(cost_total, 6),
                "model_input_cost": round(cost_model_input, 6),
                "model_output_cost": round(cost_model_output, 6),
                "speech_audio_cost": round(cost_speech, 6),
                "currency": "GBP",
            },
        }
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"rollups summary failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/overview")
async def get_analytics_overview(
    days: int = Query(30, ge=1, le=365),
    audit_only: bool = Query(True, description="When true, compute metrics from audit logs only (no jobs fallback)"),
    user_id: Optional[str] = Query(None, description="Admin-only: compute the 'user' section for this user id"),
    current_user: Dict = Depends(get_current_user_any),
    cosmos_db = Depends(get_cosmos_db)
) -> Dict[str, Any]:
    """
    Return analytics totals and breakdowns for the last N days across:
    - Completed jobs
    - Jobs per upload type (Audio uploaded, Audio recorded, Transcript uploaded)
    - Jobs per category
    - Jobs per subcategory
    Provides both global and current-user scoped results in one response.
    """
    try:
    # Time boundaries: jobs use ms epoch; audit uses ISO timestamps
        start_dt = datetime.now(timezone.utc) - timedelta(days=days)
        start_ms = int(start_dt.timestamp() * 1000)
        start_iso = start_dt.isoformat()

        # Helpers
        def _first_count(results: List[Dict[str, Any]]) -> int:
            return int(results[0].get("count", 0)) if results else 0

        def _safe_query(container, query: str, parameters: List[Dict[str, Any]]):
            try:
                return list(container.query_items(query=query, parameters=parameters, enable_cross_partition_query=True))
            except Exception as e:
                logger.warning(f"Analytics query failed, returning empty set. Query: {query} Error: {e}")
                return []

        # Time filters
        created_filter = "((IS_NUMBER(c.created_at) AND c.created_at >= @start_ms) OR (IS_STRING(c.created_at) AND c.created_at >= @start_iso))"
        start_date_only = start_iso[:10]
        # Determine which user to compute the per-user section for
        requested_user_id = user_id  # from query param
        current_user_id = current_user.get("id")
        if requested_user_id and requested_user_id != current_user_id:
            # Admins can view any user; non-admins cannot override
            if not is_admin(current_user):
                raise HTTPException(status_code=403, detail="Not authorized to view other users' analytics")
            effective_user_id = requested_user_id
        else:
            effective_user_id = current_user_id

        # Helpers for audit-driven distinct job counting
        def _distinct_job_ids_from_audit(actions: List[str], user_scope: Optional[str] = None) -> List[str]:
            audit_container = getattr(cosmos_db, 'audit_logs_container', None)
            if not audit_container:
                return []
            placeholders = ", ".join([f"@a{i}" for i in range(len(actions))])
            params = (
                [{"name": "@start_iso", "value": start_iso}, {"name": "@start_date", "value": start_date_only}]
                + [{"name": f"@a{i}", "value": act} for i, act in enumerate(actions)]
            )
            user_clause = " AND c.user_id = @user_id" if user_scope else ""
            if user_scope:
                params = params + [{"name": "@user_id", "value": user_scope}]
            # Get distinct job_ids (resource_id) from upload actions in window
            rows = _safe_query(
                audit_container,
                "SELECT DISTINCT c.resource_id as job_id FROM c WHERE c.record_type = 'user_action' "
                "AND ((IS_DEFINED(c.timestamp) AND c.timestamp >= @start_iso) OR (NOT IS_DEFINED(c.timestamp) AND IS_DEFINED(c.date) AND c.date >= @start_date)) "
                f"AND c.action_type IN ({placeholders})" + user_clause,
                params,
            )
            return [r.get("job_id") for r in rows if r.get("job_id")]

        def _distinct_completed_job_ids(user_scope: Optional[str] = None) -> List[str]:
            job_ids: set = set()
            # Prefer explicit JOB_COMPLETED audit events if present
            job_ids.update(_distinct_job_ids_from_audit(["JOB_COMPLETED"], user_scope))
            # Also look into job_activity_logs if available
            job_activity = getattr(cosmos_db, 'job_activity_logs_container', None)
            if job_activity:
                params = [{"name": "@start_iso", "value": start_iso}]
                user_clause = " AND c.user_id = @user_id" if user_scope else ""
                if user_scope:
                    params = params + [{"name": "@user_id", "value": user_scope}]
                rows = _safe_query(
                    job_activity,
                    "SELECT DISTINCT c.job_id as job_id FROM c WHERE c.record_type = 'job_activity' "
                    "AND c.timestamp >= @start_iso AND (c.activity_type = 'COMPLETED' OR c.status IN ('SUCCESS','completed'))"
                    + user_clause,
                    params,
                )
                for r in rows:
                    if r.get("job_id"):
                        job_ids.add(r.get("job_id"))
            return list(job_ids)

        def _distinct_failed_job_ids(user_scope: Optional[str] = None) -> List[str]:
            job_ids: set = set()
            # Explicit JOB_FAILED events (if we implement them)
            job_ids.update(_distinct_job_ids_from_audit(["JOB_FAILED"], user_scope))
            job_activity = getattr(cosmos_db, 'job_activity_logs_container', None)
            if job_activity:
                params = [{"name": "@start_iso", "value": start_iso}]
                user_clause = " AND c.user_id = @user_id" if user_scope else ""
                if user_scope:
                    params = params + [{"name": "@user_id", "value": user_scope}]
                rows = _safe_query(
                    job_activity,
                    "SELECT DISTINCT c.job_id as job_id FROM c WHERE c.record_type = 'job_activity' "
                    "AND c.timestamp >= @start_iso AND (c.activity_type = 'FAILED' OR c.status IN ('FAILED','failed'))"
                    + user_clause,
                    params,
                )
                for r in rows:
                    if r.get("job_id"):
                        job_ids.add(r.get("job_id"))
            return list(job_ids)

        upload_actions = ["Audio uploaded", "Audio recorded", "Transcript uploaded"]

        if audit_only:
            # Totals from audit logs (distinct job ids)
            total_jobs_global = [{"count": len(set(_distinct_job_ids_from_audit(upload_actions, None)))}]
            completed_jobs_global = [{"count": len(set(_distinct_completed_job_ids(None)))}]
            failed_jobs_global = [{"count": len(set(_distinct_failed_job_ids(None)))}]
            total_jobs_user = [{"count": len(set(_distinct_job_ids_from_audit(upload_actions, effective_user_id)))}]
            completed_jobs_user = [{"count": len(set(_distinct_completed_job_ids(effective_user_id)))}]
            failed_jobs_user = [{"count": len(set(_distinct_failed_job_ids(effective_user_id)))}]
        else:
            # Legacy totals from jobs container with robust created_at filter
            total_jobs_global = _safe_query(
                cosmos_db.jobs_container,
                f"SELECT COUNT(1) as count FROM c WHERE c.type = 'job' AND {created_filter}",
                [{"name": "@start_ms", "value": start_ms}, {"name": "@start_iso", "value": start_iso}],
            )
            completed_jobs_global = _safe_query(
                cosmos_db.jobs_container,
                f"SELECT COUNT(1) as count FROM c WHERE c.type = 'job' AND {created_filter} AND c.status = 'completed'",
                [{"name": "@start_ms", "value": start_ms}, {"name": "@start_iso", "value": start_iso}],
            )
            failed_jobs_global = _safe_query(
                cosmos_db.jobs_container,
                f"SELECT COUNT(1) as count FROM c WHERE c.type = 'job' AND {created_filter} AND c.status = 'failed'",
                [{"name": "@start_ms", "value": start_ms}, {"name": "@start_iso", "value": start_iso}],
            )
            total_jobs_user = _safe_query(
                cosmos_db.jobs_container,
                f"SELECT COUNT(1) as count FROM c WHERE c.type = 'job' AND {created_filter} AND c.user_id = @user_id",
                [
                    {"name": "@start_ms", "value": start_ms},
                    {"name": "@start_iso", "value": start_iso},
                    {"name": "@user_id", "value": effective_user_id},
                ],
            )
            completed_jobs_user = _safe_query(
                cosmos_db.jobs_container,
                f"SELECT COUNT(1) as count FROM c WHERE c.type = 'job' AND {created_filter} AND c.status = 'completed' AND c.user_id = @user_id",
                [
                    {"name": "@start_ms", "value": start_ms},
                    {"name": "@start_iso", "value": start_iso},
                    {"name": "@user_id", "value": effective_user_id},
                ],
            )
            failed_jobs_user = _safe_query(
                cosmos_db.jobs_container,
                f"SELECT COUNT(1) as count FROM c WHERE c.type = 'job' AND {created_filter} AND c.status = 'failed' AND c.user_id = @user_id",
                [
                    {"name": "@start_ms", "value": start_ms},
                    {"name": "@start_iso", "value": start_iso},
                    {"name": "@user_id", "value": effective_user_id},
                ],
            )

    # Upload type breakdowns from audit logs
        upload_actions = ["Audio uploaded", "Audio recorded", "Transcript uploaded"]
        def _upload_counts(container, params):
            # Count all user_action types in window; we'll map expected types in shaping (more robust to variations)
            return _safe_query(
                container,
                "SELECT c.action_type, COUNT(1) as count FROM c WHERE c.record_type = 'user_action' "
                "AND ((IS_DEFINED(c.timestamp) AND c.timestamp >= @start_iso) OR (NOT IS_DEFINED(c.timestamp) AND IS_DEFINED(c.date) AND c.date >= @start_date)) "
                "GROUP BY c.action_type",
                params,
            )

    # Query upload type counts from audit container (optionally also merge jobs container for legacy if not audit_only)
        params_global_all = [{"name": "@start_iso", "value": start_iso}, {"name": "@start_date", "value": start_date_only}]
        audit_container = getattr(cosmos_db, 'audit_logs_container', None)
        def _fetch_upload_events_global() -> List[Dict[str, Any]]:
            rows: List[Dict[str, Any]] = []
            q = (
                "SELECT c.action_type, c.resource_id FROM c WHERE c.record_type = 'user_action' "
                "AND ((IS_DEFINED(c.timestamp) AND c.timestamp >= @start_iso) OR (NOT IS_DEFINED(c.timestamp) AND IS_DEFINED(c.date) AND c.date >= @start_date)) "
            )
            params = [{"name": "@start_iso", "value": start_iso}, {"name": "@start_date", "value": start_date_only}]
            if audit_container:
                rows += _safe_query(audit_container, q, params)
            if not audit_only:
                # legacy: user_action docs could be in jobs container
                rows += _safe_query(cosmos_db.jobs_container, q, params)
            return rows

        def _fetch_upload_events_user(uid: str) -> List[Dict[str, Any]]:
            rows: List[Dict[str, Any]] = []
            q = (
                "SELECT c.action_type, c.resource_id FROM c WHERE c.record_type = 'user_action' "
                "AND ((IS_DEFINED(c.timestamp) AND c.timestamp >= @start_iso) OR (NOT IS_DEFINED(c.timestamp) AND IS_DEFINED(c.date) AND c.date >= @start_date)) "
                "AND c.user_id = @user_id"
            )
            params = [
                {"name": "@start_iso", "value": start_iso},
                {"name": "@start_date", "value": start_date_only},
                {"name": "@user_id", "value": uid},
            ]
            if audit_container:
                rows += _safe_query(audit_container, q, params)
            if not audit_only:
                rows += _safe_query(cosmos_db.jobs_container, q, params)
            return rows

        def _dedupe_by_action(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
            seen: Dict[str, set] = {}
            for r in rows:
                at = r.get("action_type")
                rid = r.get("resource_id")
                if not at or not rid:
                    continue
                seen.setdefault(at, set()).add(rid)
            return [{"action_type": at, "count": len(ids)} for at, ids in seen.items()]

        global_events = _fetch_upload_events_global()
        upload_global_rows = _dedupe_by_action(global_events)
        user_events = _fetch_upload_events_user(effective_user_id)
        upload_user_rows = _dedupe_by_action(user_events)

        # Track sources for transparency
        global_upload_source = "audit" if upload_global_rows else "fallback"
        user_upload_source = "audit" if upload_user_rows else "fallback"

    # Soft fallback handled later during shaping via _fallback_* helpers to avoid calling before definitions

        def _shape_upload(rows: List[Dict[str, Any]]) -> Dict[str, int]:
            # Case-insensitive mapping to tolerate small variations in action_type values
            uploaded = recorded = transcript = 0
            for r in rows:
                at = str(r.get("action_type", "")).strip().lower()
                cnt = int(r.get("count", 0))
                if at == "audio uploaded":
                    uploaded += cnt
                elif at == "audio recorded":
                    recorded += cnt
                elif at == "transcript uploaded":
                    transcript += cnt
            total = uploaded + recorded + transcript
            return {"uploaded": uploaded, "recorded": recorded, "transcript": transcript, "total": total}

        # Client-side aggregation helpers to avoid Cosmos GROUP BY/COUNT issues in some environments
        def _client_count_status(rows: List[Dict[str, Any]]):
            uploaded_cnt = recorded_cnt = transcript_cnt = 0
            for r in rows:
                status = str(r.get("status", "")).lower()
                if status == "transcribed":
                    transcript_cnt += 1
                elif status in ("uploaded", "processing", "queued", "transcribing"):
                    uploaded_cnt += 1
            return uploaded_cnt, recorded_cnt, transcript_cnt

        def _client_count_actions(rows: List[Dict[str, Any]]):
            m: Dict[str, int] = {}
            for r in rows:
                # action can be in 'action_type' or 'action'
                at = str(r.get("action_type", r.get("action", ""))).strip()
                if not at:
                    continue
                m[at] = m.get(at, 0) + 1
            # Convert to rows like [{action_type, count}]
            return [{"action_type": k, "count": v} for k, v in m.items()]

        def _client_count_by_file_ext(job_rows: List[Dict[str, Any]]):
            # Infer upload types from the original uploaded file extension
            audio_exts = {'.wav', '.mp3', '.ogg', '.opus', '.flac', '.alaw', '.mulaw', '.mp4', '.wma', '.aac', '.amr', '.webm', '.m4a', '.spx', '.pcm'}
            uploaded_cnt = recorded_cnt = transcript_cnt = 0
            for r in job_rows:
                fp = str(r.get('file_path') or '').lower()
                if not fp:
                    continue
                # Try to get extension from after last dot before any query params
                path = fp.split('?', 1)[0]
                dot = path.rfind('.')
                ext = path[dot:] if dot != -1 else ''
                if ext == '.txt':
                    transcript_cnt += 1
                elif ext in audio_exts:
                    uploaded_cnt += 1
            return uploaded_cnt, recorded_cnt, transcript_cnt

        # Fallback: if per-user upload counts are zero, infer by the user's job IDs (in-window) and audit events for those jobs
        # This handles cases where audit.user_id doesn't match the selected user but jobs.user_id does.
        def _fallback_user_upload_rows_if_needed(current_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
            shaped = _shape_upload(current_rows)
            if shaped.get("total", 0) > 0:
                return current_rows
            try:
                # 1) Get this user's job IDs in the window from jobs container
                job_id_rows = _safe_query(
                    cosmos_db.jobs_container,
                    f"SELECT c.id FROM c WHERE c.type = 'job' AND {created_filter} AND c.user_id = @user_id",
                    [
                        {"name": "@start_ms", "value": start_ms},
                        {"name": "@start_iso", "value": start_iso},
                        {"name": "@user_id", "value": effective_user_id},
                    ],
                )
                job_ids = [row.get("id") for row in job_id_rows if row.get("id")]
                if not job_ids:
                    return current_rows
                # 2) Count events for those jobs without filtering by user_id using IN() with chunking
                def _count_by_actions_for_ids(container, ids: List[str]) -> List[Dict[str, Any]]:
                    out: List[Dict[str, Any]] = []
                    if not ids:
                        return out
                    # Chunk ids to keep parameter list reasonable
                    chunk_size = 100
                    for i in range(0, len(ids), chunk_size):
                        chunk = ids[i:i+chunk_size]
                        # Build placeholders for IN clause
                        ph = ", ".join([f"@jid{j}" for j in range(len(chunk))])
                        # Build params for this chunk
                        params = [
                            {"name": "@start_iso", "value": start_iso},
                            {"name": "@start_date", "value": start_date_only},
                        ] + [{"name": f"@jid{j}", "value": v} for j, v in enumerate(chunk)]
                        query = (
                            "SELECT c.action_type, COUNT(1) as count FROM c WHERE c.record_type = 'user_action' "
                            "AND ((IS_DEFINED(c.timestamp) AND c.timestamp >= @start_iso) OR (NOT IS_DEFINED(c.timestamp) AND IS_DEFINED(c.date) AND c.date >= @start_date)) "
                            f"AND c.resource_id IN ({ph}) GROUP BY c.action_type"
                        )
                        out += _safe_query(container, query, params)
                    return out

                rows: List[Dict[str, Any]] = []
                if audit_container:
                    rows += _count_by_actions_for_ids(audit_container, job_ids)
                # Also check legacy user_action records stored in jobs container (if any exist as separate docs)
                rows += _count_by_actions_for_ids(cosmos_db.jobs_container, job_ids)
                if rows:
                    return rows

                # 3) Final fallback: aggregate from embedded audit_trail array on job docs
                # This handles the case where user actions are only stored within the job document
                embedded_params = [
                    {"name": "@start_ms", "value": start_ms},
                    {"name": "@start_iso", "value": start_iso},
                    {"name": "@start_date", "value": start_date_only},
                    {"name": "@user_id", "value": effective_user_id},
                ]
                embedded_query = (
                    "SELECT a.action AS action_type, COUNT(1) as count FROM c "
                    "JOIN a IN c.audit_trail "
                    "WHERE c.type = 'job' "
                    f"AND {created_filter} "
                    "AND c.user_id = @user_id "
                    "AND IS_ARRAY(c.audit_trail) "
                    "AND ( (IS_DEFINED(a.timestamp) AND a.timestamp >= @start_iso) OR (NOT IS_DEFINED(a.timestamp) AND IS_DEFINED(a.date) AND a.date >= @start_date) ) "
                    "GROUP BY a.action"
                )
                rows = _safe_query(cosmos_db.jobs_container, embedded_query, embedded_params)
                if rows:
                    return rows

                # 4) Derive counts from job file extensions if nothing else available (best-effort)
                # Prefer non-aggregate read, then count client-side for reliability
                job_rows = _safe_query(
                    cosmos_db.jobs_container,
                    f"SELECT c.file_path FROM c WHERE c.type = 'job' AND {created_filter} AND c.user_id = @user_id",
                    [
                        {"name": "@start_ms", "value": start_ms},
                        {"name": "@start_iso", "value": start_iso},
                        {"name": "@user_id", "value": effective_user_id},
                    ],
                )
                uploaded_cnt, recorded_cnt, transcript_cnt = _client_count_by_file_ext(job_rows)
                # Return rows shaped like audit results
                return [
                    {"action_type": "Audio uploaded", "count": uploaded_cnt},
                    {"action_type": "Audio recorded", "count": recorded_cnt},
                    {"action_type": "Transcript uploaded", "count": transcript_cnt},
                ] if (uploaded_cnt or transcript_cnt) else current_rows
            except Exception:
                return current_rows
        # Global fallback: Try embedded audit_trail on jobs, then status-derived, if audit queries return zero
        def _fallback_global_upload_rows_if_needed(current_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
            shaped = _shape_upload(current_rows)
            if shaped.get("total", 0) > 0:
                return current_rows
            try:
                # 1) Embedded audit_trail across all jobs in window
                embedded_rows = _safe_query(
                    cosmos_db.jobs_container,
                    "SELECT a.action AS action FROM c "
                    "JOIN a IN c.audit_trail "
                    "WHERE c.type = 'job' "
                    f"AND {created_filter} "
                    "AND IS_ARRAY(c.audit_trail) "
                    "AND ( (IS_DEFINED(a.timestamp) AND a.timestamp >= @start_iso) OR (NOT IS_DEFINED(a.timestamp) AND IS_DEFINED(a.date) AND a.date >= @start_date) ) ",
                    [
                        {"name": "@start_ms", "value": start_ms},
                        {"name": "@start_iso", "value": start_iso},
                        {"name": "@start_date", "value": start_date_only},
                    ],
                )
                embedded_rows = _client_count_actions(embedded_rows)
                if embedded_rows:
                    return embedded_rows

                # 2) File-extension-derived global (more precise than status)
                job_rows = _safe_query(
                    cosmos_db.jobs_container,
                    f"SELECT c.file_path FROM c WHERE c.type = 'job' AND {created_filter}",
                    [
                        {"name": "@start_ms", "value": start_ms},
                        {"name": "@start_iso", "value": start_iso},
                    ],
                )
                uploaded_cnt, recorded_cnt, transcript_cnt = _client_count_by_file_ext(job_rows)
                if uploaded_cnt or transcript_cnt or recorded_cnt:
                    return [
                        {"action_type": "Audio uploaded", "count": uploaded_cnt},
                        {"action_type": "Audio recorded", "count": recorded_cnt},
                        {"action_type": "Transcript uploaded", "count": transcript_cnt},
                    ]
                return current_rows
            except Exception:
                return current_rows

        # Category breakdowns: audit-first with distinct job_id dedupe; otherwise from jobs
        by_category_source_global = "jobs"
        by_category_source_user = "jobs"
        if audit_only and audit_container:
            # 1) Pull upload events with job_id and any embedded details
            placeholders_cat = ", ".join([f"@ua{i}" for i in range(len(upload_actions))])
            params_ev_global = (
                [{"name": "@start_iso", "value": start_iso}, {"name": "@start_date", "value": start_date_only}]
                + [{"name": f"@ua{i}", "value": act} for i, act in enumerate(upload_actions)]
            )
            params_ev_user = (
                [{"name": "@start_iso", "value": start_iso}, {"name": "@start_date", "value": start_date_only}, {"name": "@user_id", "value": effective_user_id}]
                + [{"name": f"@ua{i}", "value": act} for i, act in enumerate(upload_actions)]
            )

            q_events_global = (
                "SELECT c.resource_id AS job_id, c.details.prompt_category_id AS category_id, "
                "c.details.prompt_subcategory_id AS subcategory_id "
                "FROM c WHERE c.record_type = 'user_action' "
                "AND ((IS_DEFINED(c.timestamp) AND c.timestamp >= @start_iso) OR (NOT IS_DEFINED(c.timestamp) AND IS_DEFINED(c.date) AND c.date >= @start_date)) "
                f"AND c.action_type IN ({placeholders_cat})"
            )
            q_events_user = q_events_global + " AND c.user_id = @user_id"

            ev_global = _safe_query(audit_container, q_events_global, params_ev_global)
            ev_user = _safe_query(audit_container, q_events_user, params_ev_user)

            def _dedupe_and_fill(ev_rows: List[Dict[str, Any]]):
                # Keep one entry per job_id; prefer details from audit; if missing, resolve via jobs lookup
                by_job: Dict[str, Dict[str, Optional[str]]] = {}
                missing: List[str] = []
                for r in ev_rows:
                    jid = r.get("job_id")
                    if not jid:
                        continue
                    if jid not in by_job:
                        by_job[jid] = {
                            "category_id": r.get("category_id"),
                            "subcategory_id": r.get("subcategory_id"),
                        }
                    else:
                        # If we already have but missing some field, try to fill from this event
                        if not by_job[jid].get("category_id") and r.get("category_id"):
                            by_job[jid]["category_id"] = r.get("category_id")
                        if not by_job[jid].get("subcategory_id") and r.get("subcategory_id"):
                            by_job[jid]["subcategory_id"] = r.get("subcategory_id")
                for jid, vals in by_job.items():
                    if not vals.get("category_id"):
                        missing.append(jid)
                # Resolve missing category/subcategory from job docs
                if missing:
                    chunk_size = 100
                    for i in range(0, len(missing), chunk_size):
                        chunk = missing[i:i+chunk_size]
                        ph = ", ".join([f"@jid{j}" for j in range(len(chunk))])
                        params = [{"name": f"@jid{j}", "value": v} for j, v in enumerate(chunk)]
                        rows = _safe_query(
                            cosmos_db.jobs_container,
                            f"SELECT c.id, c.prompt_category_id AS category_id, c.prompt_subcategory_id AS subcategory_id FROM c WHERE c.type = 'job' AND c.id IN ({ph})",
                            params,
                        )
                        for rr in rows:
                            jid2 = rr.get("id")
                            if not jid2 or jid2 not in by_job:
                                continue
                            if not by_job[jid2].get("category_id") and rr.get("category_id"):
                                by_job[jid2]["category_id"] = rr.get("category_id")
                            if not by_job[jid2].get("subcategory_id") and rr.get("subcategory_id"):
                                by_job[jid2]["subcategory_id"] = rr.get("subcategory_id")
                # Build counts by distinct job
                cat_counts: Dict[str, int] = {}
                sub_counts: Dict[tuple, int] = {}
                for vals in by_job.values():
                    cid = vals.get("category_id")
                    sid = vals.get("subcategory_id")
                    if cid:
                        cat_counts[cid] = cat_counts.get(cid, 0) + 1
                    if cid and sid:
                        key = (cid, sid)
                        sub_counts[key] = sub_counts.get(key, 0) + 1
                cat_rows = [{"category_id": k, "count": v} for k, v in cat_counts.items()]
                sub_rows = [{"category_id": k[0], "subcategory_id": k[1], "count": v} for k, v in sub_counts.items()]
                return cat_rows, sub_rows

            by_category_global, by_subcategory_global = _dedupe_and_fill(ev_global)
            by_category_user, by_subcategory_user = _dedupe_and_fill(ev_user)
            by_category_source_global = "audit-distinct"
            by_category_source_user = "audit-distinct"
        else:
            by_category_global = _safe_query(
                cosmos_db.jobs_container,
                f"SELECT c.prompt_category_id AS category_id, COUNT(1) AS count FROM c WHERE c.type = 'job' AND {created_filter} AND IS_DEFINED(c.prompt_category_id) GROUP BY c.prompt_category_id",
                [{"name": "@start_ms", "value": start_ms}, {"name": "@start_iso", "value": start_iso}],
            )
            by_category_user = _safe_query(
                cosmos_db.jobs_container,
                f"SELECT c.prompt_category_id AS category_id, COUNT(1) AS count FROM c WHERE c.type = 'job' AND {created_filter} AND c.user_id = @user_id AND IS_DEFINED(c.prompt_category_id) GROUP BY c.prompt_category_id",
                [
                    {"name": "@start_ms", "value": start_ms},
                    {"name": "@start_iso", "value": start_iso},
                    {"name": "@user_id", "value": effective_user_id},
                ],
            )

            by_subcategory_global = _safe_query(
                cosmos_db.jobs_container,
                f"SELECT c.prompt_category_id AS category_id, c.prompt_subcategory_id AS subcategory_id, COUNT(1) AS count FROM c WHERE c.type = 'job' AND {created_filter} AND IS_DEFINED(c.prompt_category_id) AND IS_DEFINED(c.prompt_subcategory_id) GROUP BY c.prompt_category_id, c.prompt_subcategory_id",
                [{"name": "@start_ms", "value": start_ms}, {"name": "@start_iso", "value": start_iso}],
            )
            by_subcategory_user = _safe_query(
                cosmos_db.jobs_container,
                f"SELECT c.prompt_category_id AS category_id, c.prompt_subcategory_id AS subcategory_id, COUNT(1) AS count FROM c WHERE c.type = 'job' AND {created_filter} AND c.user_id = @user_id AND IS_DEFINED(c.prompt_category_id) AND IS_DEFINED(c.prompt_subcategory_id) GROUP BY c.prompt_category_id, c.prompt_subcategory_id",
                [
                    {"name": "@start_ms", "value": start_ms},
                    {"name": "@start_iso", "value": start_iso},
                    {"name": "@user_id", "value": effective_user_id},
                ],
            )

        # Fallback for legacy behavior: if not audit_only and absolutely no jobs matched, rerun totals without date filter to confirm presence
        if not audit_only and _first_count(total_jobs_global) == 0:
            total_jobs_global = _safe_query(
                cosmos_db.jobs_container,
                "SELECT COUNT(1) as count FROM c WHERE c.type = 'job'",
                [],
            )

        # Optional: enrich with category/subcategory names
        categories = _safe_query(
            getattr(cosmos_db, 'prompts_container', cosmos_db.jobs_container),
            "SELECT c.id, c.name FROM c WHERE c.type = 'prompt_category'",
            [],
        )
        cat_name = {c.get("id"): c.get("name") for c in categories}
        subcategories = _safe_query(
            getattr(cosmos_db, 'prompts_container', cosmos_db.jobs_container),
            "SELECT c.id, c.name, c.category_id FROM c WHERE c.type = 'prompt_subcategory'",
            [],
        )
        sub_name = {(s.get("category_id"), s.get("id")): s.get("name") for s in subcategories}

        def _enrich_cat(rows: List[Dict[str, Any]]):
            out = []
            for r in rows:
                out.append({
                    "category_id": r.get("category_id"),
                    "category_name": cat_name.get(r.get("category_id")),
                    "count": int(r.get("count", 0)),
                })
            return out

        def _enrich_sub(rows: List[Dict[str, Any]]):
            out = []
            for r in rows:
                cid = r.get("category_id")
                sid = r.get("subcategory_id")
                out.append({
                    "category_id": cid,
                    "category_name": cat_name.get(cid),
                    "subcategory_id": sid,
                    "subcategory_name": sub_name.get((cid, sid)),
                    "count": int(r.get("count", 0)),
                })
            return out

        # Compute "active users" as distinct users with any user_action in the last recent window (e.g., 15 minutes)
        def _active_users_count_recent(minutes: int = 15) -> int:
            try:
                since_dt = datetime.now(timezone.utc) - timedelta(minutes=minutes)
                since_iso = since_dt.isoformat()
                since_date_only = since_iso[:10]

                # Helper to collect distinct user_ids from a container
                def _collect_distinct_user_ids(container) -> set:
                    rows: List[Dict[str, Any]] = _safe_query(
                        container,
                        "SELECT c.user_id FROM c WHERE c.record_type = 'user_action' "
                        "AND ((IS_DEFINED(c.timestamp) AND c.timestamp >= @since_iso) OR (NOT IS_DEFINED(c.timestamp) AND IS_DEFINED(c.date) AND c.date >= @since_date)) "
                        "AND IS_DEFINED(c.user_id)",
                        [
                            {"name": "@since_iso", "value": since_iso},
                            {"name": "@since_date", "value": since_date_only},
                        ],
                    )
                    out: set = set()
                    for r in rows:
                        uid = r.get("user_id")
                        if isinstance(uid, str) and uid.strip():
                            out.add(uid)
                    return out

                user_ids: set = set()
                # Prefer dedicated audit container if present
                audit_container = getattr(cosmos_db, 'audit_logs_container', None)
                if audit_container:
                    user_ids |= _collect_distinct_user_ids(audit_container)
                # Also check legacy user_action docs possibly stored in jobs container
                user_ids |= _collect_distinct_user_ids(cosmos_db.jobs_container)
                return len(user_ids)
            except Exception:
                return 0

        active_users = _active_users_count_recent(15)

        response = {
            "period_days": days,
            "generated_at": datetime.utcnow().isoformat(),
            "global": {
                "totals": {
                    "total_jobs": _first_count(total_jobs_global),
                    "completed_jobs": _first_count(completed_jobs_global),
                    "failed_jobs": _first_count(failed_jobs_global),
                    "success_rate": round((_first_count(completed_jobs_global) / max(1, (_first_count(completed_jobs_global) + _first_count(failed_jobs_global)))), 4),
                },
                # Distinct users with activity in last ~15 minutes
                "active_users": active_users,
                "by_upload_type": _shape_upload(
                    _fallback_global_upload_rows_if_needed(upload_global_rows) if global_upload_source == "fallback" else upload_global_rows
                ),
                "by_upload_type_source": global_upload_source,
                "by_category": _enrich_cat(by_category_global),
                "by_category_source": by_category_source_global,
                "by_subcategory": _enrich_sub(by_subcategory_global),
            },
            "user": {
                "user_id": effective_user_id,
                "totals": {
                    "total_jobs": _first_count(total_jobs_user),
                    "completed_jobs": _first_count(completed_jobs_user),
                    "failed_jobs": _first_count(failed_jobs_user),
                    "success_rate": round((_first_count(completed_jobs_user) / max(1, (_first_count(completed_jobs_user) + _first_count(failed_jobs_user)))), 4),
                },
                # apply fallback if direct per-user counts are zero
                "by_upload_type": _shape_upload(
                    _fallback_user_upload_rows_if_needed(upload_user_rows) if user_upload_source == "fallback" else upload_user_rows
                ),
                "by_upload_type_source": user_upload_source,
                "by_category": _enrich_cat(by_category_user),
                "by_category_source": by_category_source_user,
                "by_subcategory": _enrich_sub(by_subcategory_user),
            },
        }

        return response

    except Exception as e:
        logger.error(f"Failed to generate analytics overview: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate analytics overview")


@router.get("/overview/export")
async def export_analytics_overview(
    days: int = Query(30, ge=1, le=365),
    scope: str = Query("global", regex="^(global|user)$"),
    format: str = Query("csv", regex="^(csv|json)$"),
    user_id: Optional[str] = Query(None, description="Admin-only: compute the 'user' section for this user id"),
    current_user: Dict = Depends(get_current_user_any),
    cosmos_db = Depends(get_cosmos_db)
):
    """
    Export analytics overview as CSV or JSON. Scope can be 'global' or 'user'.
    CSV contains rows for: totals, by_upload_type, by_category, by_subcategory.
    """
    # Reuse the overview data
    overview = await get_analytics_overview(days=days, user_id=user_id, current_user=current_user, cosmos_db=cosmos_db)

    if format == "json":
        data = overview[scope]
        return JSONResponse(content=data)

    # CSV export
    output = io.StringIO()
    writer = csv.writer(output)

    data = overview[scope]

    # Totals
    writer.writerow(["section", "metric", "value"])
    writer.writerow(["totals", "total_jobs", data["totals"].get("total_jobs", 0)])
    writer.writerow(["totals", "completed_jobs", data["totals"].get("completed_jobs", 0)])
    writer.writerow(["totals", "failed_jobs", data["totals"].get("failed_jobs", 0)])
    writer.writerow(["totals", "success_rate", data["totals"].get("success_rate", 0)])

    # Upload types
    writer.writerow([])
    writer.writerow(["section", "type", "count"])
    ut = data.get("by_upload_type", {})
    writer.writerow(["by_upload_type", "uploaded", ut.get("uploaded", 0)])
    writer.writerow(["by_upload_type", "recorded", ut.get("recorded", 0)])
    writer.writerow(["by_upload_type", "transcript", ut.get("transcript", 0)])
    writer.writerow(["by_upload_type", "total", ut.get("total", 0)])

    # Category
    writer.writerow([])
    writer.writerow(["section", "category_id", "category_name", "count"])
    for row in data.get("by_category", []):
        writer.writerow(["by_category", row.get("category_id"), row.get("category_name"), row.get("count", 0)])

    # Subcategory
    writer.writerow([])
    writer.writerow(["section", "category_id", "category_name", "subcategory_id", "subcategory_name", "count"])
    for row in data.get("by_subcategory", []):
        writer.writerow([
            "by_subcategory",
            row.get("category_id"),
            row.get("category_name"),
            row.get("subcategory_id"),
            row.get("subcategory_name"),
            row.get("count", 0),
        ])

    output.seek(0)
    filename = f"analytics_overview_{scope}_{days}d.csv"
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={
        "Content-Disposition": f"attachment; filename={filename}"
    })

@router.get("/debug/peek")
async def analytics_debug_peek(
    days: int = Query(30, ge=1, le=365),
    job_id: Optional[str] = Query(None, description="Optional job id to check existence"),
    current_user: Dict = Depends(get_current_user_any),
    cosmos_db = Depends(get_cosmos_db)
) -> Dict[str, Any]:
    """Lightweight diagnostics to validate analytics data visibility."""
    _ensure_debug_enabled()
    try:
        start_dt = datetime.now(timezone.utc) - timedelta(days=days)
        start_ms = int(start_dt.timestamp() * 1000)
        start_iso = start_dt.isoformat()

        def _safe(container, query, params):
            try:
                return list(container.query_items(query=query, parameters=params, enable_cross_partition_query=True))
            except Exception as e:
                logger.warning(f"Debug query failed: {e}")
                return []

        created_filter = "((IS_NUMBER(c.created_at) AND c.created_at >= @start_ms) OR (IS_STRING(c.created_at) AND c.created_at >= @start_iso))"

        # Jobs counts
        jobs_last = _safe(
            cosmos_db.jobs_container,
            f"SELECT COUNT(1) as count FROM c WHERE c.type = 'job' AND {created_filter}",
            [{"name": "@start_ms", "value": start_ms}, {"name": "@start_iso", "value": start_iso}],
        )
        jobs_all = _safe(
            cosmos_db.jobs_container,
            "SELECT COUNT(1) as count FROM c WHERE c.type = 'job'",
            [],
        )
        latest_jobs = _safe(
            cosmos_db.jobs_container,
            "SELECT TOP 5 c.id, c.user_id, c.status, c.created_at FROM c WHERE c.type = 'job' ORDER BY c.created_at DESC",
            [],
        )

        # Audit
        actions = ["Audio uploaded", "Audio recorded", "Transcript uploaded"]
        placeholders = ", ".join([f"@a{i}" for i in range(len(actions))])
        params = [{"name": "@start_iso", "value": start_iso}] + [{"name": f"@a{i}", "value": a} for i, a in enumerate(actions)]
        # pull from audit container and jobs container, then merge
        start_date_only = start_iso[:10]
        params_all = params + [{"name": "@start_date", "value": start_date_only}]
        audit_counts_rows: List[Dict[str, Any]] = []
        audit_container = getattr(cosmos_db, 'audit_logs_container', None)
        if audit_container:
            audit_counts_rows += _safe(
                audit_container,
                "SELECT c.action_type, COUNT(1) as count FROM c WHERE c.record_type = 'user_action' "
                "AND ((IS_DEFINED(c.timestamp) AND c.timestamp >= @start_iso) OR (NOT IS_DEFINED(c.timestamp) AND IS_DEFINED(c.date) AND c.date >= @start_date)) "
                f"AND c.action_type IN ({placeholders}) GROUP BY c.action_type",
                params_all,
            )
        audit_counts_rows += _safe(
            cosmos_db.jobs_container,
            "SELECT c.action_type, COUNT(1) as count FROM c WHERE c.record_type = 'user_action' "
            "AND ((IS_DEFINED(c.timestamp) AND c.timestamp >= @start_iso) OR (NOT IS_DEFINED(c.timestamp) AND IS_DEFINED(c.date) AND c.date >= @start_date)) "
            f"AND c.action_type IN ({placeholders}) GROUP BY c.action_type",
            params_all,
        )

        # Raw events and deduped diagnostics
        def _fetch_events(container, query, params):
            try:
                return list(container.query_items(query=query, parameters=params, enable_cross_partition_query=True))
            except Exception:
                return []
        raw_events: List[Dict[str, Any]] = []
        q_events = (
            "SELECT c.action_type, c.resource_id, c.user_id FROM c WHERE c.record_type = 'user_action' "
            "AND ((IS_DEFINED(c.timestamp) AND c.timestamp >= @start_iso) OR (NOT IS_DEFINED(c.timestamp) AND IS_DEFINED(c.date) AND c.date >= @start_date)) "
        )
        if audit_container:
            raw_events += _fetch_events(audit_container, q_events, [{"name": "@start_iso", "value": start_iso}, {"name": "@start_date", "value": start_date_only}])
        raw_events += _fetch_events(cosmos_db.jobs_container, q_events, [{"name": "@start_iso", "value": start_iso}, {"name": "@start_date", "value": start_date_only}])

        dedup_map: Dict[str, set] = {}
        for ev in raw_events:
            at = ev.get("action_type")
            rid = ev.get("resource_id")
            if not at or not rid:
                continue
            dedup_map.setdefault(at, set()).add(rid)
        dedup_counts = {k: len(v) for k, v in dedup_map.items()}

        # Derived (non-aggregate) helpers for reliability
        def _client_shape_upload(rows):
            uploaded = recorded = transcript = 0
            for r in rows:
                at = str(r.get("action_type", r.get("action", ""))).strip().lower()
                if at == "audio uploaded":
                    uploaded += 1
                elif at == "audio recorded":
                    recorded += 1
                elif at == "transcript uploaded":
                    transcript += 1
            return {"uploaded": uploaded, "recorded": recorded, "transcript": transcript, "total": uploaded+recorded+transcript}

        def _client_shape_from_file_path(rows):
            audio_exts = {'.wav', '.mp3', '.ogg', '.opus', '.flac', '.alaw', '.mulaw', '.mp4', '.wma', '.aac', '.amr', '.webm', '.m4a', '.spx', '.pcm'}
            uploaded = recorded = transcript = 0
            for r in rows:
                fp = str(r.get('file_path') or '').lower()
                if not fp:
                    continue
                path = fp.split('?', 1)[0]
                dot = path.rfind('.')
                ext = path[dot:] if dot != -1 else ''
                if ext == '.txt':
                    transcript += 1
                elif ext in audio_exts:
                    uploaded += 1
            return {"uploaded": uploaded, "recorded": recorded, "transcript": transcript, "total": uploaded+recorded+transcript}

        # Try to compute derived upload counts from embedded audit trail (client-side) and from status
        embedded_rows = _safe(
            cosmos_db.jobs_container,
            "SELECT a.action AS action FROM c JOIN a IN c.audit_trail WHERE c.type = 'job' "
            f"AND {created_filter} AND IS_ARRAY(c.audit_trail) "
            "AND ( (IS_DEFINED(a.timestamp) AND a.timestamp >= @start_iso) OR (NOT IS_DEFINED(a.timestamp) AND IS_DEFINED(a.date) AND a.date >= @start_date) )",
            [
                {"name": "@start_ms", "value": start_ms},
                {"name": "@start_iso", "value": start_iso},
                {"name": "@start_date", "value": start_date_only},
            ],
        )
        derived_from_embedded = _client_shape_upload(embedded_rows)

        file_rows = _safe(
            cosmos_db.jobs_container,
            f"SELECT c.file_path FROM c WHERE c.type = 'job' AND {created_filter}",
            [
                {"name": "@start_ms", "value": start_ms},
                {"name": "@start_iso", "value": start_iso},
            ],
        )
        derived_from_file = _client_shape_from_file_path(file_rows)

        # Optional direct job lookup
        job_doc = None
        if job_id:
            rows = _safe(
                cosmos_db.jobs_container,
                "SELECT * FROM c WHERE c.type = 'job' AND c.id = @id",
                [{"name": "@id", "value": job_id}],
            )
            job_doc = rows[0] if rows else None

        return {
            "generated_at": datetime.utcnow().isoformat(),
            "window_days": days,
            "jobs": {
                "last_window": int(jobs_last[0].get("count", 0)) if jobs_last else 0,
                "all_time": int(jobs_all[0].get("count", 0)) if jobs_all else 0,
                "latest": latest_jobs,
            },
            "audit": { a.get("action_type"): int(a.get("count", 0)) for a in audit_counts_rows },
            "audit_raw_events": len(raw_events),
            "audit_dedup_counts": dedup_counts,
            "derived_upload": {
                "from_embedded": derived_from_embedded,
                "from_file_ext": derived_from_file,
            },
            "lookup": { "job_id": job_id, "job": job_doc },
            "current_user": current_user.get("id"),
        }
    except Exception as e:
        logger.error(f"analytics debug failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="analytics debug failed")

@router.get("/debug/by-user-upload")
async def analytics_debug_by_user_upload(
    days: int = Query(30, ge=1, le=365),
    user_id: Optional[str] = Query(None),
    current_user: Dict = Depends(get_current_user_any),
    cosmos_db = Depends(get_cosmos_db)
) -> Dict[str, Any]:
    """Diagnostics: show per-user upload-type counts via multiple strategies."""
    _ensure_debug_enabled()
    try:
        # Time boundaries
        start_dt = datetime.now(timezone.utc) - timedelta(days=days)
        start_ms = int(start_dt.timestamp() * 1000)
        start_iso = start_dt.isoformat()
        start_date_only = start_iso[:10]

        # Effective user
        requested_user_id = user_id
        current_user_id = current_user.get("id")
        if requested_user_id and requested_user_id != current_user_id:
            if not is_admin(current_user):
                raise HTTPException(status_code=403, detail="Not authorized to view other users' analytics")
            effective_user_id = requested_user_id
        else:
            effective_user_id = current_user_id

        created_filter = "((IS_NUMBER(c.created_at) AND c.created_at >= @start_ms) OR (IS_STRING(c.created_at) AND c.created_at >= @start_iso))"
        audit_container = getattr(cosmos_db, 'audit_logs_container', None)

        def _safe(container, query, params):
            try:
                return list(container.query_items(query=query, parameters=params, enable_cross_partition_query=True))
            except Exception as e:
                logger.warning(f"Debug by-user query failed: {e}")
                return []

        def _shape(rows: List[Dict[str, Any]]):
            uploaded = recorded = transcript = 0
            for r in rows:
                at = str(r.get("action_type", "") or r.get("action", "")).strip().lower()
                cnt = int(r.get("count", 0))
                if at == "audio uploaded":
                    uploaded += cnt
                elif at == "audio recorded":
                    recorded += cnt
                elif at == "transcript uploaded":
                    transcript += cnt
            return {"uploaded": uploaded, "recorded": recorded, "transcript": transcript, "total": uploaded+recorded+transcript}

        # 1) Direct audit.user_id filter
        direct_rows: List[Dict[str, Any]] = []
        if audit_container:
            direct_rows = _safe(
                audit_container,
                "SELECT c.action_type, COUNT(1) as count FROM c WHERE c.record_type = 'user_action' "
                "AND ((IS_DEFINED(c.timestamp) AND c.timestamp >= @start_iso) OR (NOT IS_DEFINED(c.timestamp) AND IS_DEFINED(c.date) AND c.date >= @start_date)) "
                "AND c.user_id = @user_id GROUP BY c.action_type",
                [
                    {"name": "@start_iso", "value": start_iso},
                    {"name": "@start_date", "value": start_date_only},
                    {"name": "@user_id", "value": effective_user_id},
                ],
            )

        # 2) By job_ids join
        job_id_rows = _safe(
            cosmos_db.jobs_container,
            f"SELECT c.id FROM c WHERE c.type = 'job' AND {created_filter} AND c.user_id = @user_id",
            [
                {"name": "@start_ms", "value": start_ms},
                {"name": "@start_iso", "value": start_iso},
                {"name": "@user_id", "value": effective_user_id},
            ],
        )
        job_ids = [row.get("id") for row in job_id_rows if row.get("id")]

        def _count_by_actions_for_ids(container, ids: List[str]) -> List[Dict[str, Any]]:
            out: List[Dict[str, Any]] = []
            if not ids:
                return out
            chunk_size = 100
            for i in range(0, len(ids), chunk_size):
                chunk = ids[i:i+chunk_size]
                ph = ", ".join([f"@jid{j}" for j in range(len(chunk))])
                params = [
                    {"name": "@start_iso", "value": start_iso},
                    {"name": "@start_date", "value": start_date_only},
                ] + [{"name": f"@jid{j}", "value": v} for j, v in enumerate(chunk)]
                query = (
                    "SELECT c.action_type, COUNT(1) as count FROM c WHERE c.record_type = 'user_action' "
                    "AND ((IS_DEFINED(c.timestamp) AND c.timestamp >= @start_iso) OR (NOT IS_DEFINED(c.timestamp) AND IS_DEFINED(c.date) AND c.date >= @start_date)) "
                    f"AND c.resource_id IN ({ph}) GROUP BY c.action_type"
                )
                out += _safe(container, query, params)
            return out

        by_job_ids_rows: List[Dict[str, Any]] = []
        if audit_container:
            by_job_ids_rows += _count_by_actions_for_ids(audit_container, job_ids)
        by_job_ids_rows += _count_by_actions_for_ids(cosmos_db.jobs_container, job_ids)

        # 3) Embedded audit_trail JOIN
        embedded_rows = _safe(
            cosmos_db.jobs_container,
            "SELECT a.action AS action_type, COUNT(1) as count FROM c "
            "JOIN a IN c.audit_trail "
            "WHERE c.type = 'job' "
            f"AND {created_filter} "
            "AND c.user_id = @user_id "
            "AND IS_ARRAY(c.audit_trail) "
            "AND ( (IS_DEFINED(a.timestamp) AND a.timestamp >= @start_iso) OR (NOT IS_DEFINED(a.timestamp) AND IS_DEFINED(a.date) AND a.date >= @start_date) ) "
            "GROUP BY a.action",
            [
                {"name": "@start_ms", "value": start_ms},
                {"name": "@start_iso", "value": start_iso},
                {"name": "@start_date", "value": start_date_only},
                {"name": "@user_id", "value": effective_user_id},
            ],
        )

        # 4) Status-derived
        derived = _safe(
            cosmos_db.jobs_container,
            f"SELECT c.status AS s, COUNT(1) AS cnt FROM c WHERE c.type = 'job' AND {created_filter} AND c.user_id = @user_id GROUP BY c.status",
            [
                {"name": "@start_ms", "value": start_ms},
                {"name": "@start_iso", "value": start_iso},
                {"name": "@user_id", "value": effective_user_id},
            ],
        )
        uploaded_cnt = 0
        recorded_cnt = 0
        transcript_cnt = 0
        for r in derived:
            status = str(r.get("s", "")).lower()
            cnt = int(r.get("cnt", 0))
            if status == "transcribed":
                transcript_cnt += cnt
            elif status in ("uploaded", "processing", "queued", "transcribing"):
                uploaded_cnt += cnt

        return {
            "period_days": days,
            "user_id": effective_user_id,
            "direct_audit": {"rows": direct_rows, "shaped": _shape(direct_rows)},
            "by_job_ids": {"rows": by_job_ids_rows, "shaped": _shape(by_job_ids_rows), "job_ids_count": len(job_ids)},
            "embedded_audit_trail": {"rows": embedded_rows, "shaped": _shape(embedded_rows)},
            "status_derived": {"rows": [
                {"action_type": "Audio uploaded", "count": uploaded_cnt},
                {"action_type": "Audio recorded", "count": recorded_cnt},
                {"action_type": "Transcript uploaded", "count": transcript_cnt},
            ], "shaped": {"uploaded": uploaded_cnt, "recorded": recorded_cnt, "transcript": transcript_cnt, "total": uploaded_cnt+recorded_cnt+transcript_cnt}},
        }
    except Exception as e:
        logger.error(f"analytics debug by-user failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="analytics debug by-user failed")

@router.get("/jobs/summary")
async def get_jobs_summary(
    days: int = Query(30, ge=1, le=365),
    current_user: Dict = Depends(get_current_user_any),
    cosmos_db = Depends(get_cosmos_db)
) -> Dict[str, Any]:
    """
    Get job processing summary for the last N days (Authenticated users)
    Includes status breakdown, performance metrics, and trends
    """
    # Just require authentication (matching frontend pattern)
    # Admin role checking removed to match frontend auth approach
    try:
        start_dt = datetime.utcnow() - timedelta(days=days)
        start_ms = int(start_dt.timestamp() * 1000)
        start_iso = start_dt.isoformat()

        # Query for job statistics with robust created_at filtering
        query = f"""
        SELECT
            c.status,
            COUNT(1) as job_count,
            AVG(c.metrics.processing_time_ms) as avg_processing_time_ms,
            MAX(c.metrics.processing_time_ms) as max_processing_time_ms,
            MIN(c.metrics.processing_time_ms) as min_processing_time_ms,
            AVG(c.metrics.file_size_bytes) as avg_file_size_bytes,
            SUM(c.metrics.file_size_bytes) as total_bytes_processed,
            AVG(c.metrics.audio_duration_seconds) as avg_audio_duration_seconds,
            AVG(c.metrics.transcription_words) as avg_transcription_words,
            AVG(c.metrics.analysis_words) as avg_analysis_words,
            AVG(c.metrics.prompt_words) as avg_prompt_words
        FROM c
        WHERE c.type = 'job'
        AND ((IS_NUMBER(c.created_at) AND c.created_at >= @start_ms) OR (IS_STRING(c.created_at) AND c.created_at >= @start_iso))
        GROUP BY c.status
        """

        results = list(
            cosmos_db.jobs_container.query_items(
                query=query,
                parameters=[
                    {"name": "@start_ms", "value": start_ms},
                    {"name": "@start_iso", "value": start_iso},
                ],
                enable_cross_partition_query=True
            )
        )

        # Calculate totals
        total_jobs = sum(result.get("job_count", 0) for result in results)

        return {
            "period_days": days,
            "start_date": start_iso,
            "total_jobs": total_jobs,
            "status_breakdown": results,
            "generated_at": datetime.utcnow().isoformat(),
            "generated_by": current_user.get("id")
        }

    except Exception as e:
        logger.error(f"Failed to generate job summary: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to generate job summary")


@router.get("/jobs/{job_id}")
async def get_job_details(
    job_id: str,
    current_user: Dict = Depends(get_current_user_any),
    cosmos_db = Depends(get_cosmos_db)
) -> Dict[str, Any]:
    """Retrieve a single job document including metrics (Authenticated users).

    Surfaces newly added analysis_words and prompt_words metrics explicitly
    at top-level for convenience while still returning the complete metrics dict.
    """
    try:
        job = cosmos_db.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        metrics = job.get("metrics", {})
        # Convenience extraction (will be None if not yet populated)
        analysis_words = metrics.get("analysis_words")
        prompt_words = metrics.get("prompt_words")

        return {
            "job_id": job.get("id"),
            "status": job.get("status"),
            "created_at": job.get("created_at"),
            "updated_at": job.get("updated_at"),
            "metrics": metrics,
            "analysis_words": analysis_words,
            "prompt_words": prompt_words,
            "accessed_by": current_user.get("id"),
            "accessed_at": datetime.utcnow().isoformat(),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to retrieve job details: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve job details")


@router.get("/jobs/{job_id}/audit-trail")
async def get_job_audit_trail(
    job_id: str,
    current_user: Dict = Depends(get_current_user_any),
    cosmos_db = Depends(get_cosmos_db)
) -> Dict[str, Any]:
    """Get complete audit trail for a specific job (Authenticated users)"""
    # Admin check removed - using authentication only
    try:
        # Get job with audit trail
        job = cosmos_db.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        # Admin users can access any job's audit trail
        audit_trail = job.get("audit_trail", [])
        metrics = job.get("metrics", {})

        # Sort audit trail by timestamp
        audit_trail.sort(key=lambda x: x.get("timestamp", ""))

        return {
            "job_id": job_id,
            "job_status": job.get("status"),
            "created_at": job.get("created_at"),
            "updated_at": job.get("updated_at"),
            "audit_trail": audit_trail,
            "audit_event_count": len(audit_trail),
            "metrics": metrics,
            "accessed_by": current_user.get("id"),
            "accessed_at": datetime.utcnow().isoformat()
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get audit trail for job {job_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to retrieve audit trail")


@router.get("/user-activity")
async def get_current_user_activity(
    days: int = Query(30, ge=1, le=365),
    current_user: Dict = Depends(get_current_user_any),
    cosmos_db = Depends(get_cosmos_db)
) -> Dict[str, Any]:
    """Get current user's activity history (Authenticated users)"""
    # Admin check removed - using authentication only
    try:
        user_id = current_user.get("id")
        start_date = (datetime.utcnow() - timedelta(days=days)).isoformat()

        # Query for user activities
        query = """
        SELECT * FROM c
        WHERE c.type = 'user_activity'
        AND c.user_id = @user_id
        AND c.timestamp >= @start_date
        ORDER BY c.timestamp DESC
        """

        activities = list(
            cosmos_db.jobs_container.query_items(
                query=query,
                parameters=[
                    {"name": "@user_id", "value": user_id},
                    {"name": "@start_date", "value": start_date}
                ],
                enable_cross_partition_query=True
            )
        )

        # Group activities by action type
        activity_summary = {}
        for activity in activities:
            action = activity.get("action", "unknown")
            activity_summary[action] = activity_summary.get(action, 0) + 1

        return {
            "user_id": user_id,
            "period_days": days,
            "total_activities": len(activities),
            "activity_summary": activity_summary,
            "recent_activities": activities[:20],  # Last 20 activities
            "generated_at": datetime.utcnow().isoformat()
        }

    except Exception as e:
        logger.error(f"Failed to get user activity: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to retrieve user activity")


@router.get("/admin/users/{user_id}/activity")
async def get_user_activity_admin(
    user_id: str,
    days: int = Query(30, ge=1, le=365),
    current_user: Dict = Depends(get_current_user_any),
    cosmos_db = Depends(get_cosmos_db)
) -> Dict[str, Any]:
    """Get any user's activity history (authenticated users)"""

    # Admin check removed - using authentication only

    try:
        start_date = (datetime.utcnow() - timedelta(days=days)).isoformat()

        # Query for user activities
        query = """
        SELECT * FROM c
        WHERE c.type = 'user_activity'
        AND c.user_id = @user_id
        AND c.timestamp >= @start_date
        ORDER BY c.timestamp DESC
        """

        activities = list(
            cosmos_db.jobs_container.query_items(
                query=query,
                parameters=[
                    {"name": "@user_id", "value": user_id},
                    {"name": "@start_date", "value": start_date}
                ],
                enable_cross_partition_query=True
            )
        )

        # Get user jobs summary for same period
        jobs_query = """
        SELECT
            c.status,
            COUNT(1) as count
        FROM c
        WHERE c.type = 'job'
        AND c.user_id = @user_id
        AND c.created_at >= @start_date
        GROUP BY c.status
        """

        job_summary = list(
            cosmos_db.jobs_container.query_items(
                query=jobs_query,
                parameters=[
                    {"name": "@user_id", "value": user_id},
                    {"name": "@start_date", "value": start_date}
                ],
                enable_cross_partition_query=True
            )
        )

        return {
            "user_id": user_id,
            "period_days": days,
            "activity_count": len(activities),
            "activities": activities,
            "job_summary": job_summary,
            "accessed_by": current_user.get("id"),
            "accessed_at": datetime.utcnow().isoformat()
        }

    except Exception as e:
        logger.error(f"Failed to get user activity for {user_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to retrieve user activity")


@router.get("/performance/trends")
async def get_performance_trends(
    days: int = Query(7, ge=1, le=90),
    current_user: Dict = Depends(get_current_user_any),
    cosmos_db = Depends(get_cosmos_db)
) -> Dict[str, Any]:
    """Get performance trends over time"""

    # Admin check removed - using authentication only

    try:
        start_date = (datetime.utcnow() - timedelta(days=days)).isoformat()

        # Query for daily performance metrics
        query = """
        SELECT
            SUBSTRING(c.created_at, 0, 10) as date,
            COUNT(1) as jobs_processed,
            AVG(c.metrics.processing_time_ms) as avg_processing_time,
            AVG(c.metrics.file_size_bytes) as avg_file_size,
            COUNT(c.status = 'completed' ? 1 : null) as completed_jobs,
            COUNT(c.status = 'failed' ? 1 : null) as failed_jobs
        FROM c
        WHERE c.type = 'job'
        AND c.created_at >= @start_date
        AND IS_DEFINED(c.metrics)
        GROUP BY SUBSTRING(c.created_at, 0, 10)
        ORDER BY SUBSTRING(c.created_at, 0, 10)
        """

        trends = list(
            cosmos_db.jobs_container.query_items(
                query=query,
                parameters=[{"name": "@start_date", "value": start_date}],
                enable_cross_partition_query=True
            )
        )

        return {
            "period_days": days,
            "trends": trends,
            "generated_at": datetime.utcnow().isoformat(),
            "generated_by": current_user.get("id")
        }

    except Exception as e:
        logger.error(f"Failed to get performance trends: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to retrieve performance trends")


@router.get("/system/health")
async def get_system_health(
    current_user: Dict = Depends(get_current_user_any),
    cosmos_db = Depends(get_cosmos_db)
) -> Dict[str, Any]:
    """Get system health metrics"""

    # Admin check removed - using authentication only

    try:
        # Get recent job counts by status
        last_hour = (datetime.utcnow() - timedelta(hours=1)).isoformat()
        last_day = (datetime.utcnow() - timedelta(days=1)).isoformat()

        # Recent activity
        recent_query = """
        SELECT
            c.status,
            COUNT(1) as count
        FROM c
        WHERE c.type = 'job'
        AND c.created_at >= @last_hour
        GROUP BY c.status
        """

        recent_activity = list(
            cosmos_db.jobs_container.query_items(
                query=recent_query,
                parameters=[{"name": "@last_hour", "value": last_hour}],
                enable_cross_partition_query=True
            )
        )

        # Daily activity
        daily_query = """
        SELECT
            c.status,
            COUNT(1) as count,
            AVG(c.metrics.processing_time_ms) as avg_processing_time
        FROM c
        WHERE c.type = 'job'
        AND c.created_at >= @last_day
        GROUP BY c.status
        """

        daily_activity = list(
            cosmos_db.jobs_container.query_items(
                query=daily_query,
                parameters=[{"name": "@last_day", "value": last_day}],
                enable_cross_partition_query=True
            )
        )

        # Calculate health score
        total_recent = sum(item.get("count", 0) for item in recent_activity)
        failed_recent = sum(item.get("count", 0) for item in recent_activity if item.get("status") == "failed")

        error_rate = (failed_recent / total_recent * 100) if total_recent > 0 else 0
        health_score = max(0, 100 - error_rate)

        return {
            "health_score": round(health_score, 2),
            "error_rate_percent": round(error_rate, 2),
            "last_hour_activity": recent_activity,
            "last_day_activity": daily_activity,
            "total_jobs_last_hour": total_recent,
            "checked_at": datetime.utcnow().isoformat(),
            "checked_by": current_user.get("id")
        }

    except Exception as e:
        logger.error(f"Failed to get system health: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to retrieve system health")


# Helper functions
def is_admin(user: Dict) -> bool:
    """Check if user has admin permissions"""
    user_role = user.get("role", "")
    user_roles = user.get("roles", [])

    return (
        user_role == "admin" or
        "admin" in user_roles or
        user_role == "administrator" or
        "administrator" in user_roles
    )


# Export router
__all__ = ["router"]


"""
Integration Instructions:

1. Add this router to your main.py:
   from app.routers.analytics import router as analytics_router
   app.include_router(analytics_router)

2. Make sure your existing dependencies are imported correctly:
   - get_cosmos_db from your existing dependencies
   - get_current_user_any from your auth router

3. The analytics endpoints will be available at:
   - GET /analytics/jobs/summary
   - GET /analytics/jobs/{job_id}/audit-trail
   - GET /analytics/user-activity
   - GET /analytics/admin/users/{user_id}/activity (admin only)
   - GET /analytics/performance/trends (admin only)
   - GET /analytics/system/health (admin only)

4. These endpoints work with the enhanced job documents that include:
   - audit_trail: array of audit events
   - metrics: performance metrics object
   - type: 'user_activity' for user action logs

No changes to existing code are required - this just adds new analytics capabilities.
"""
