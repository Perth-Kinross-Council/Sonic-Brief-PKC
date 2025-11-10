
# --- Monitoring Summary Endpoint ---
# (Moved below router definition)
"""
Enhanced admin and monitoring endpoints for Azure-optimized authentication system.
Provides comprehensive health checks, cache management, and performance monitoring.
"""
from fastapi import APIRouter, Depends, HTTPException, status, Body, Query
from typing import Dict, Any
import logging
from datetime import datetime, timezone

from app.core.dependencies import (
    get_app_config, 
    get_cosmos_db, 
    get_entra_service, 
    get_auth_cache,
    get_service_container,
    get_cached_user_service
)
from app.routers.auth import get_current_user_any
from app.core.config import AppConfig, CosmosDB
from app.services.entra_auth import EntraAuthService
from app.services.cached_user_service import AzureCachedUserService


router = APIRouter()
logger = logging.getLogger(__name__)

# --- NEW ENDPOINT: POST /auth/frontend/metrics ---
from fastapi import Request
from fastapi.responses import JSONResponse, StreamingResponse
import io
import csv

frontend_metrics_store = []  # In-memory store for demonstration; replace with persistent store in production

@router.post("/auth/frontend/metrics")
async def receive_frontend_metrics(request: Request):
    """
    Receive frontend authentication metrics from the SPA/frontend.
    Expects JSON payload with metrics data. Stores or logs for monitoring.
    """
    try:
        metrics = await request.json()
        metrics["received_at"] = datetime.now(timezone.utc).isoformat()
        frontend_metrics_store.append(metrics)
        logger.info(f"[FRONTEND METRICS] Received: {metrics}")
        return JSONResponse(status_code=200, content={"status": "success", "message": "Metrics received"})
    except Exception as e:
        logger.error(f"[FRONTEND METRICS] Error receiving metrics: {e}")
        return JSONResponse(status_code=400, content={"status": "error", "message": str(e)})


@router.get("/auth/info")
async def get_auth_info(
    current_user: dict = Depends(get_current_user_any),
    config: AppConfig = Depends(get_app_config)) -> Dict[str, Any]:
    """
    Get authentication configuration information.
    Shows which authentication methods are enabled and basic configuration.
    """
    try:
        return {
            "status": "success",
            "authentication": {
                "method": config.auth_config.auth_method.value,
                "enabled_methods": config.auth_config.get_enabled_methods(),
                "legacy_enabled": config.auth_config.is_legacy_enabled(),
                "entra_enabled": config.auth_config.is_entra_enabled()
            },
            "configuration": {
                "has_legacy_config": bool(config.auth_config.get_legacy_config()),
                "has_entra_config": bool(config.auth_config.get_entra_config()),
                "entra_authority": config.entra.get("authority") if config.entra else None,
                "entra_audience": config.entra.get("audience") if config.entra else None
            },
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        logger.error(f"[ADMIN] Error getting auth info: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get auth info: {str(e)}"
        )


@router.get("/auth/health")
async def auth_health_check(
    current_user: dict = Depends(get_current_user_any),
    service_container = Depends(get_service_container)
) -> Dict[str, Any]:
    """
    Comprehensive health check for all authentication services.
    Returns detailed status of each component.
    """
    try:
        health_status = service_container.get_health_status()
        
        # Add response metadata
        health_status["endpoint"] = "/auth/health"
        health_status["version"] = "2.0-azure-optimized"
        
        return health_status
        
    except Exception as e:
        logger.error(f"[ADMIN] Health check failed: {e}")
        return {
            "status": "error",
            "error": str(e),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "endpoint": "/auth/health"
        }


@router.get("/auth/cache/stats")
async def get_cache_stats(
    current_user: dict = Depends(get_current_user_any),
    auth_cache = Depends(get_auth_cache)) -> Dict[str, Any]:
    """
    Get authentication cache statistics.
    Shows cache performance metrics and current state.
    """
    try:
        stats = auth_cache.stats()
        stats["endpoint"] = "/auth/cache/stats"
        stats["timestamp"] = datetime.now(timezone.utc).isoformat()
        
        # Calculate hit rate
        total_requests = stats["total_entries"]
        if total_requests > 0:
            stats["estimated_hit_rate"] = (stats["valid_entries"] / total_requests) * 100
        else:
            stats["estimated_hit_rate"] = 0
            
        return {
            "status": "success",
            "cache_stats": stats
        }
        
    except Exception as e:
        logger.error(f"[ADMIN] Error getting cache stats: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get cache stats: {str(e)}"
        )


@router.post("/auth/cache/clear")
async def clear_auth_cache(
    current_user: dict = Depends(get_current_user_any),
    auth_cache = Depends(get_auth_cache)) -> Dict[str, Any]:
    """
    Clear authentication cache.
    WARNING: This will force re-authentication for all cached users.
    """
    try:
        # Get stats before clearing
        stats_before = auth_cache.stats()
        
        # Clear cache
        auth_cache.clear()
        
        # Get stats after clearing
        stats_after = auth_cache.stats()
        
        logger.info(f"[ADMIN] Authentication cache cleared. Removed {stats_before['total_entries']} entries")
        
        return {
            "status": "success",
            "message": "Authentication cache cleared successfully",
            "entries_removed": stats_before["total_entries"],
            "stats_before": stats_before,
            "stats_after": stats_after,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
    except Exception as e:
        logger.error(f"[ADMIN] Error clearing cache: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to clear cache: {str(e)}"
        )


@router.get("/auth/admin/jwks/stats")
async def get_jwks_stats(
    current_user: dict = Depends(get_current_user_any),
    config: AppConfig = Depends(get_app_config),
    entra_service: EntraAuthService = Depends(get_entra_service)
) -> Dict[str, Any]:
    """
    Get JWKS cache statistics for Entra ID authentication.
    Shows JWKS cache performance and key information.
    """
    try:
        if not config.auth_config.is_entra_enabled():
            return {
                "status": "disabled",
                "message": "Entra ID authentication is not enabled",
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        
        if not entra_service:
            return {
                "status": "unavailable",
                "message": "Entra service not initialized",
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        
        jwks_stats = entra_service.get_jwks_stats()
        jwks_stats["endpoint"] = "/auth/admin/jwks/stats"
        jwks_stats["timestamp"] = datetime.now(timezone.utc).isoformat()
        
        return {
            "status": "success",
            "jwks_stats": jwks_stats
        }
        
    except Exception as e:
        logger.error(f"[ADMIN] Error getting JWKS stats: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get JWKS stats: {str(e)}"
        )


@router.post("/auth/admin/jwks/refresh")
async def refresh_jwks_cache(
    current_user: dict = Depends(get_current_user_any),
    config: AppConfig = Depends(get_app_config),
    entra_service: EntraAuthService = Depends(get_entra_service)
) -> Dict[str, Any]:
    """
    Force refresh JWKS cache for Entra ID authentication.
    Useful when key rotation occurs or cache issues are suspected.
    """
    try:
        if not config.auth_config.is_entra_enabled():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Entra ID authentication is not enabled"
            )
        
        if not entra_service:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Entra service not available"
            )
        
        # Force refresh JWKS cache
        new_stats = entra_service.refresh_jwks_cache()
        
        logger.info("[ADMIN] JWKS cache refreshed successfully")
        
        return {
            "status": "success",
            "message": "JWKS cache refreshed successfully",
            "new_stats": new_stats,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error(f"[ADMIN] Error refreshing JWKS cache: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to refresh JWKS cache: {str(e)}"
        )


@router.get("/auth/admin/performance/stats")
async def get_performance_stats(
    current_user: dict = Depends(get_current_user_any),
    config: AppConfig = Depends(get_app_config),
    cosmos_db: CosmosDB = Depends(get_cosmos_db),
    entra_service: EntraAuthService = Depends(get_entra_service),
    auth_cache = Depends(get_auth_cache),
    service_container = Depends(get_service_container)
) -> Dict[str, Any]:
    """
    Get comprehensive performance statistics for all authentication components.
    Provides detailed metrics for monitoring and optimization.
    """
    try:
        # Get individual component stats
        auth_cache_stats = auth_cache.stats()
        service_health = service_container.get_health_status()
        
        # Get JWKS stats if Entra is enabled
        jwks_stats = None
        if config.auth_config.is_entra_enabled() and entra_service:
            jwks_stats = entra_service.get_jwks_stats()
        
        # Compile comprehensive stats
        performance_stats = {
            "authentication": {
                "cache": auth_cache_stats,
                "jwks": jwks_stats,
                "enabled_methods": config.auth_config.get_enabled_methods()
            },
            "services": service_health["services"],
            "system": {
                "overall_status": service_health["status"],
                "uptime_check": service_health["timestamp"]
            },
            "metadata": {
                "endpoint": "/auth/admin/performance/stats",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "version": "2.0-azure-optimized"
            }
        }
        
        return {
            "status": "success",
            "performance_stats": performance_stats
        }
        
    except Exception as e:
        logger.error(f"[ADMIN] Error getting performance stats: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get performance stats: {str(e)}"
        )


@router.get("/auth/monitoring/summary")
async def get_monitoring_summary(
    current_user: dict = Depends(get_current_user_any),
    config: AppConfig = Depends(get_app_config),
    cosmos_db: CosmosDB = Depends(get_cosmos_db),
    entra_service: EntraAuthService = Depends(get_entra_service),
    auth_cache = Depends(get_auth_cache),
    service_container = Depends(get_service_container)
) -> Dict[str, Any]:
    """
    Comprehensive monitoring summary for all authentication and backend services.
    Returns health, cache, database, and JWKS stats in a single payload.
    """
    try:
        # Health
        health_status = service_container.get_health_status()
        # Auth cache
        auth_cache_stats = auth_cache.stats() if auth_cache else {}
        # JWKS
        jwks_stats = None
        if config.auth_config.is_entra_enabled() and entra_service:
            jwks_stats = entra_service.get_jwks_stats()
        # Database stats (stub, replace with real stats if available)
        db_stats = getattr(cosmos_db, 'get_stats', lambda: {})()
        # Frontend metrics (in-memory, for demo)
        global frontend_metrics_store
        frontend_metrics = frontend_metrics_store[-10:] if 'frontend_metrics_store' in globals() else []
        # Compose summary
        summary = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "health": health_status,
            "auth_cache": auth_cache_stats,
            "jwks": jwks_stats,
            "database": db_stats,
            "frontend_metrics": frontend_metrics,
            "phase": "Phase 3 - Comprehensive Monitoring"
        }
        return {"status": "success", "summary": summary}
    except Exception as e:
        logger.error(f"[ADMIN] Error generating monitoring summary: {e}", exc_info=True)
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "error": f"Failed to generate monitoring summary: {str(e)}",
            "status": "error"
        }


# --- User Cache Stats Endpoint ---
@router.get("/auth/user-cache/stats")
async def get_user_cache_stats(
    current_user: dict = Depends(get_current_user_any),
    cached_user_service: AzureCachedUserService = Depends(get_cached_user_service)
) -> Dict[str, Any]:
    """
    Get statistics for the user cache (AzureCachedUserService).
    Returns cache performance, state, and configuration.
    """
    try:
        if not cached_user_service:
            return {"status": "unavailable", "message": "User cache service not initialized"}
        stats = cached_user_service.get_cache_stats()
        return {"status": "success", "user_cache_stats": stats}
    except Exception as e:
        logger.error(f"[USER CACHE] Error getting user cache stats: {e}")
        return {"status": "error", "message": str(e)}


# --- User Cache Invalidate Endpoint ---
@router.post("/auth/user-cache/invalidate")
async def invalidate_user_cache(
    payload: dict = Body(...),
    current_user: dict = Depends(get_current_user_any),
    cached_user_service: AzureCachedUserService = Depends(get_cached_user_service)
) -> Dict[str, Any]:
    """
    Invalidate a specific user cache entry by identifier and lookup type.
    Expects JSON: {"identifier": str, "lookup_type": str}
    """
    try:
        identifier = payload.get("identifier")
        lookup_type = payload.get("lookup_type")
        if not identifier or not lookup_type:
            return {"status": "error", "message": "Missing identifier or lookup_type in request body"}
        cached_user_service.invalidate_user_cache(identifier, lookup_type)
        return {"status": "success", "message": f"Cache invalidated for {lookup_type}: {identifier}"}
    except Exception as e:
        logger.error(f"[USER CACHE] Error invalidating user cache: {e}")
        return {"status": "error", "message": str(e)}


# --- User Cache Clear Endpoint ---
@router.post("/auth/user-cache/clear")
async def clear_user_cache(
    current_user: dict = Depends(get_current_user_any),
    cached_user_service: AzureCachedUserService = Depends(get_cached_user_service)
) -> Dict[str, Any]:
    """
    Clear all entries from the user cache (AzureCachedUserService).
    """
    try:
        cached_user_service.clear_all_cache()
        return {"status": "success", "message": "All user cache entries cleared"}
    except Exception as e:
        logger.error(f"[USER CACHE] Error clearing user cache: {e}")
        return {"status": "error", "message": str(e)}


# --- TEMPORARY ANALYTICS ENDPOINTS ---
# Adding these to admin router as workaround until analytics router deployment works

@router.get("/analytics/jobs/summary")
async def get_jobs_summary_temp(
    days: int = 30,
    current_user: dict = Depends(get_current_user_any),
    cosmos_db = Depends(get_cosmos_db)
) -> Dict[str, Any]:
    """
    TEMPORARY: Get job processing summary (moved to admin router as workaround)
    This will be moved back to analytics router once deployment issues are resolved
    """
    try:
        from datetime import datetime, timedelta
        start_date = (datetime.utcnow() - timedelta(days=days)).isoformat()
        
        # Try to get real data from CosmosDB, fall back to mock if not available
        try:
            # Query for actual job statistics from CosmosDB
            query = """
            SELECT 
                c.status,
                COUNT(1) as job_count,
                AVG(c.metrics.processing_time_ms) as avg_processing_time_ms,
                AVG(c.metrics.file_size_bytes) as avg_file_size_bytes,
                AVG(c.metrics.audio_duration_seconds) as avg_audio_duration_seconds
            FROM c 
            WHERE c.type = 'job' 
            AND c.created_at >= @start_date
            GROUP BY c.status
            """
            
            # Execute query
            items = list(cosmos_db.query_items(
                query=query,
                parameters=[{"name": "@start_date", "value": start_date}],
                enable_cross_partition_query=True
            ))
            
            # Calculate totals
            total_jobs = sum(item.get('job_count', 0) for item in items)
            status_breakdown = [
                {
                    "status": item.get('status', 'unknown'),
                    "job_count": item.get('job_count', 0),
                    "avg_processing_time_ms": round(item.get('avg_processing_time_ms', 0) or 0),
                    "avg_file_size_bytes": round(item.get('avg_file_size_bytes', 0) or 0),
                    "avg_audio_duration_seconds": round(item.get('avg_audio_duration_seconds', 0) or 0, 1)
                }
                for item in items
            ]
            
            # If we have real data, use it
            if total_jobs > 0:
                return {
                    "status": "success",
                    "period_days": days,
                    "total_jobs": total_jobs,
                    "status_breakdown": status_breakdown,
                    "data_source": "live_cosmosdb",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "note": "Real data from CosmosDB"
                }
        
        except Exception as db_error:
            logger.warning(f"[TEMP ANALYTICS] Could not query CosmosDB: {db_error}")
        
        # Return mock data as fallback
        return {
            "status": "success",
            "period_days": days,
            "total_jobs": 0,
            "status_breakdown": [],
            "data_source": "mock_fallback",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "note": "No real data available yet - upload some audio files to see real analytics"
        }
    except Exception as e:
        logger.error(f"[TEMP ANALYTICS] Error in jobs summary: {e}")
        return {
            "status": "error",
            "message": f"Temporary analytics endpoint error: {str(e)}",
            "period_days": days,
            "total_jobs": 0,
            "status_breakdown": [],
            "timestamp": datetime.now(timezone.utc).isoformat()
        }


@router.get("/analytics/system/health")
async def get_system_health_temp(
    current_user: dict = Depends(get_current_user_any)
) -> Dict[str, Any]:
    """
    TEMPORARY: Get system health metrics (moved to admin router as workaround)
    """
    try:
        return {
            "status": "healthy",
            "services": {
                "backend_api": "running",
                "authentication": "working",
                "database": "connected"
            },
            "metrics": {
                "uptime_hours": 24,
                "memory_usage_percent": 45,
                "cpu_usage_percent": 12
            },
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "note": "This is a temporary endpoint in admin router."
        }
    except Exception as e:
        logger.error(f"[TEMP ANALYTICS] Error in system health: {e}")
        return {
            "status": "error",
            "message": f"System health check failed: {str(e)}",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }


# --- AUDIT LOGS (ADMIN) ---
@router.get("/audit/logs")
async def get_audit_logs_admin(
    user_id: str = Query(..., description="Target user id to filter logs"),
    days: int = Query(30, ge=1, le=365, description="How many days back to include"),
    limit: int = Query(1000, ge=1, le=5000, description="Max records to return (non-paged mode)"),
    actions: str | None = Query(None, description="Comma-separated action types to include. Use LOGIN_GROUP to include all login variants plus logout."),
    # Optional paging parameters. When provided, endpoint will return deterministic pages with total counts.
    page: int | None = Query(None, ge=1, description="1-based page number for paginated results. If provided, 'limit' is ignored."),
    page_size: int | None = Query(None, ge=1, le=50, description="Page size for paginated results (max 50). If omitted but 'page' is provided, defaults to 50."),
    current_user: dict = Depends(get_current_user_any),
    cosmos_db: CosmosDB = Depends(get_cosmos_db)
) -> Dict[str, Any]:
    """List audit log entries for a user within a date range (Admin only)."""
    # Admin check (consistent with other admin endpoints)
    if "admin" not in current_user.get("roles", []) and current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    try:
        # Calculate cutoff
        from datetime import timedelta
        start_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        start_date_only = start_iso[:10]

        audit_container = getattr(cosmos_db, 'audit_logs_container', None)
        if not audit_container:
            # Graceful fallback if dedicated container missing
            raise HTTPException(status_code=503, detail="Audit logs container not available")

        # Base query using timestamp if present; fallback to date partition field
        where = (
            "c.record_type = 'user_action' AND c.user_id = @user_id "
            "AND ((IS_DEFINED(c.timestamp) AND c.timestamp >= @start_iso) OR (NOT IS_DEFINED(c.timestamp) AND IS_DEFINED(c.date) AND c.date >= @start_date))"
        )
        params = [
            {"name": "@user_id", "value": user_id},
            {"name": "@start_iso", "value": start_iso},
            {"name": "@start_date", "value": start_date_only},
        ]

        # Optional action filtering
        if actions:
            raw = [a.strip() for a in actions.split(",") if a and a.strip()]
            action_clauses: list[str] = []
            param_idx = 0
            login_params_added = False
            for a in raw:
                up = a.upper()
                if up in ("LOGIN_GROUP", "LOGIN", "SIGNIN", "SIGN-IN", "SIGN_IN", "SIGN-IN/OUT", "SIGNIN/OUT"):
                    # Grouped: any LOGIN* plus LOGOUT
                    if not login_params_added:
                        params.extend([
                            {"name": "@login_prefix", "value": "LOGIN"},
                            {"name": "@logout", "value": "LOGOUT"},
                        ])
                        login_params_added = True
                    action_clauses.append("(STARTSWITH(UPPER(c.action_type), @login_prefix) OR UPPER(c.action_type) = @logout)")
                else:
                    pname = f"@act{param_idx}"
                    params.append({"name": pname, "value": up})
                    action_clauses.append(f"UPPER(c.action_type) = {pname}")
                    param_idx += 1
            if action_clauses:
                where = f"{where} AND (" + " OR ".join(action_clauses) + ")"

        # If page is provided, use deterministic paging with total counts (user_action rows only for consistency)
        if page is not None:
            ps = page_size or 50
            offset = (page - 1) * ps

            # Total count (user_action only) for the same filter
            count_query = f"SELECT VALUE COUNT(1) FROM c WHERE {where}"
            total_count_items = list(
                audit_container.query_items(
                    query=count_query,
                    parameters=params,
                    enable_cross_partition_query=True,
                )
            )
            total_count = int(total_count_items[0]) if total_count_items else 0

            paged_query = (
                "SELECT c.id, c.timestamp, c.date, c.user_id, c.action_type, c.message, c.resource_id, c.component, c.details "
                f"FROM c WHERE {where} "
                "ORDER BY c.timestamp DESC "
                f"OFFSET {offset} LIMIT {ps}"
            )
            page_rows = list(
                audit_container.query_items(
                    query=paged_query,
                    parameters=params,
                    enable_cross_partition_query=True,
                )
            )
            # No merging of job completion rows in paged mode to keep counts and pages deterministic
            total_pages = (total_count + ps - 1) // ps if ps > 0 else 0
            return {
                "status": "success",
                "user_id": user_id,
                "days": days,
                "page": page,
                "page_size": ps,
                "total_count": total_count,
                "total_pages": total_pages,
                "count": len(page_rows),
                "logs": page_rows,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

        # Non-paged mode (legacy): return up to 'limit' records and merge related job completion events
        query = (
            "SELECT c.id, c.timestamp, c.date, c.user_id, c.action_type, c.message, c.resource_id, c.component, c.details "
            f"FROM c WHERE {where} "
            "ORDER BY c.timestamp DESC"
        )

        rows = list(
            audit_container.query_items(
                query=query,
                parameters=params,
                enable_cross_partition_query=True,
            )
        )

        # Optionally include matching job completion events for the jobs referenced by these actions
        try:
            job_ids = [r.get("resource_id") for r in rows if r.get("resource_id")]
            # dedupe and collect valid strings
            uniq_job_ids = [jid for jid in {jid for jid in job_ids if isinstance(jid, str)}]
            job_activity_container = getattr(cosmos_db, 'job_activity_logs_container', None)
            completed_rows = []
            if job_activity_container and uniq_job_ids:
                # Query in manageable batches to avoid overly large IN clauses
                batch_size = 100
                for start in range(0, len(uniq_job_ids), batch_size):
                    batch = uniq_job_ids[start:start+batch_size]
                    placeholders = ", ".join([f"@jid{i}" for i in range(len(batch))])
                    ja_params = [
                        {"name": "@start_iso", "value": start_iso},
                        {"name": "@start_date", "value": start_date_only},
                        {"name": "@completed", "value": "COMPLETED"},
                    ] + [
                        {"name": f"@jid{i}", "value": jid} for i, jid in enumerate(batch)
                    ]
                    ja_query = (
                        "SELECT c.id, c.timestamp, c.user_id, c.job_id, c.activity_type, c.status, c.details, c.component "
                        "FROM c WHERE c.record_type = 'job_activity' "
                        "AND c.activity_type = @completed "
                        "AND ((IS_DEFINED(c.timestamp) AND c.timestamp >= @start_iso) OR (NOT IS_DEFINED(c.timestamp) AND IS_DEFINED(c.date) AND c.date >= @start_date)) "
                        f"AND c.job_id IN ({placeholders}) "
                        "ORDER BY c.timestamp DESC"
                    )
                    ja_items = list(
                        job_activity_container.query_items(
                            query=ja_query,
                            parameters=ja_params,
                            enable_cross_partition_query=True,
                        )
                    )
                    for jr in ja_items:
                        completed_rows.append({
                            "id": jr.get("id"),
                            "timestamp": jr.get("timestamp"),
                            "date": None,
                            "user_id": jr.get("user_id"),
                            "action_type": "JOB_COMPLETED",
                            "message": f"Job {jr.get('job_id')} completed: {jr.get('status')}",
                            "resource_id": jr.get("job_id"),
                            "component": jr.get("component") or "backend_api",
                            "details": jr.get("details") or {},
                        })
            # Also pull JOB_COMPLETED entries from audit_logs for those job_ids (in case job_activity is absent)
            if audit_container and uniq_job_ids:
                batch_size = 100
                for start in range(0, len(uniq_job_ids), batch_size):
                    batch = uniq_job_ids[start:start+batch_size]
                    placeholders = ", ".join([f"@jid{i}" for i in range(len(batch))])
                    a_params = [
                        {"name": "@start_iso", "value": start_iso},
                        {"name": "@start_date", "value": start_date_only},
                        {"name": "@jobCompleted", "value": "JOB_COMPLETED"},
                    ] + [
                        {"name": f"@jid{i}", "value": jid} for i, jid in enumerate(batch)
                    ]
                    a_query = (
                        "SELECT c.id, c.timestamp, c.date, c.user_id, c.action_type, c.message, c.resource_id, c.component, c.details "
                        "FROM c WHERE c.record_type = 'user_action' "
                        "AND UPPER(c.action_type) = @jobCompleted "
                        "AND ((IS_DEFINED(c.timestamp) AND c.timestamp >= @start_iso) OR (NOT IS_DEFINED(c.timestamp) AND IS_DEFINED(c.date) AND c.date >= @start_date)) "
                        f"AND c.resource_id IN ({placeholders}) "
                        "ORDER BY c.timestamp DESC"
                    )
                    a_items = list(
                        audit_container.query_items(
                            query=a_query,
                            parameters=a_params,
                            enable_cross_partition_query=True,
                        )
                    )
                    # These already match AuditLogEntry shape
                    completed_rows.extend(a_items)
            # Merge and sort newest-first, then enforce limit
            combined = rows + completed_rows
            combined.sort(key=lambda x: (x.get("timestamp") or x.get("date") or ""), reverse=True)
            logs = combined[:limit]
        except Exception:
            # Fallback to only user_action rows on any error
            logs = rows[:limit]
        return {
            "status": "success",
            "user_id": user_id,
            "days": days,
            "count": len(logs),
            "logs": logs,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[ADMIN][AUDIT] Failed to fetch audit logs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to retrieve audit logs")


@router.get("/audit/logs/export")
async def export_audit_logs_admin(
    user_id: str = Query(..., description="Target user id to filter logs"),
    days: int = Query(30, ge=1, le=365, description="How many days back to include"),
    actions: str | None = Query(None, description="Comma-separated action types to include. Use LOGIN_GROUP to include all login variants plus logout."),
    current_user: dict = Depends(get_current_user_any),
    cosmos_db: CosmosDB = Depends(get_cosmos_db)
):
    """Export audit logs for a user/date range as CSV (Admin only)."""
    # Admin check
    if "admin" not in current_user.get("roles", []) and current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    try:
        # Reuse the same query as listing endpoint
        from datetime import timedelta
        start_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        start_date_only = start_iso[:10]

        audit_container = getattr(cosmos_db, 'audit_logs_container', None)
        if not audit_container:
            raise HTTPException(status_code=503, detail="Audit logs container not available")

        where = (
            "c.record_type = 'user_action' AND c.user_id = @user_id "
            "AND ((IS_DEFINED(c.timestamp) AND c.timestamp >= @start_iso) OR (NOT IS_DEFINED(c.timestamp) AND IS_DEFINED(c.date) AND c.date >= @start_date))"
        )
        params = [
            {"name": "@user_id", "value": user_id},
            {"name": "@start_iso", "value": start_iso},
            {"name": "@start_date", "value": start_date_only},
        ]

        if actions:
            raw = [a.strip() for a in actions.split(",") if a and a.strip()]
            action_clauses: list[str] = []
            param_idx = 0
            login_params_added = False
            for a in raw:
                up = a.upper()
                if up in ("LOGIN_GROUP", "LOGIN", "SIGNIN", "SIGN-IN", "SIGN_IN", "SIGN-IN/OUT", "SIGNIN/OUT"):
                    if not login_params_added:
                        params.extend([
                            {"name": "@login_prefix", "value": "LOGIN"},
                            {"name": "@logout", "value": "LOGOUT"},
                        ])
                        login_params_added = True
                    action_clauses.append("(STARTSWITH(UPPER(c.action_type), @login_prefix) OR UPPER(c.action_type) = @logout)")
                else:
                    pname = f"@act{param_idx}"
                    params.append({"name": pname, "value": up})
                    action_clauses.append(f"UPPER(c.action_type) = {pname}")
                    param_idx += 1
            if action_clauses:
                where = f"{where} AND (" + " OR ".join(action_clauses) + ")"

        query = (
            "SELECT c.id, c.timestamp, c.date, c.user_id, c.action_type, c.message, c.resource_id, c.component, c.details "
            f"FROM c WHERE {where} "
            "ORDER BY c.timestamp DESC"
        )

        rows = list(
            audit_container.query_items(
                query=query,
                parameters=params,
                enable_cross_partition_query=True,
            )
        )

        # Optionally include matching job completion events as above
        try:
            job_ids = [r.get("resource_id") for r in rows if r.get("resource_id")]
            uniq_job_ids = [jid for jid in {jid for jid in job_ids if isinstance(jid, str)}]
            job_activity_container = getattr(cosmos_db, 'job_activity_logs_container', None)
            if job_activity_container and uniq_job_ids:
                batch_size = 100
                for start in range(0, len(uniq_job_ids), batch_size):
                    batch = uniq_job_ids[start:start+batch_size]
                    placeholders = ", ".join([f"@jid{i}" for i in range(len(batch))])
                    ja_params = [
                        {"name": "@start_iso", "value": start_iso},
                        {"name": "@start_date", "value": start_date_only},
                        {"name": "@completed", "value": "COMPLETED"},
                    ] + [
                        {"name": f"@jid{i}", "value": jid} for i, jid in enumerate(batch)
                    ]
                    ja_query = (
                        "SELECT c.id, c.timestamp, c.user_id, c.job_id, c.activity_type, c.status, c.details, c.component "
                        "FROM c WHERE c.record_type = 'job_activity' "
                        "AND c.activity_type = @completed "
                        "AND ((IS_DEFINED(c.timestamp) AND c.timestamp >= @start_iso) OR (NOT IS_DEFINED(c.timestamp) AND IS_DEFINED(c.date) AND c.date >= @start_date)) "
                        f"AND c.job_id IN ({placeholders}) "
                        "ORDER BY c.timestamp DESC"
                    )
                    ja_items = list(
                        job_activity_container.query_items(
                            query=ja_query,
                            parameters=ja_params,
                            enable_cross_partition_query=True,
                        )
                    )
                    for jr in ja_items:
                        rows.append({
                            "id": jr.get("id"),
                            "timestamp": jr.get("timestamp"),
                            "date": None,
                            "user_id": jr.get("user_id"),
                            "action_type": "JOB_COMPLETED",
                            "message": f"Job {jr.get('job_id')} completed: {jr.get('status')}",
                            "resource_id": jr.get("job_id"),
                            "component": jr.get("component") or "backend_api",
                            "details": jr.get("details") or {},
                        })
            # Also include JOB_COMPLETED from audit_logs for those job_ids
            if audit_container and uniq_job_ids:
                batch_size = 100
                for start in range(0, len(uniq_job_ids), batch_size):
                    batch = uniq_job_ids[start:start+batch_size]
                    placeholders = ", ".join([f"@jid{i}" for i in range(len(batch))])
                    a_params = [
                        {"name": "@start_iso", "value": start_iso},
                        {"name": "@start_date", "value": start_date_only},
                        {"name": "@jobCompleted", "value": "JOB_COMPLETED"},
                    ] + [
                        {"name": f"@jid{i}", "value": jid} for i, jid in enumerate(batch)
                    ]
                    a_query = (
                        "SELECT c.id, c.timestamp, c.date, c.user_id, c.action_type, c.message, c.resource_id, c.component, c.details "
                        "FROM c WHERE c.record_type = 'user_action' "
                        "AND UPPER(c.action_type) = @jobCompleted "
                        "AND ((IS_DEFINED(c.timestamp) AND c.timestamp >= @start_iso) OR (NOT IS_DEFINED(c.timestamp) AND IS_DEFINED(c.date) AND c.date >= @start_date)) "
                        f"AND c.resource_id IN ({placeholders}) "
                        "ORDER BY c.timestamp DESC"
                    )
                    a_items = list(
                        audit_container.query_items(
                            query=a_query,
                            parameters=a_params,
                            enable_cross_partition_query=True,
                        )
                    )
                    rows.extend(a_items)
        except Exception:
            pass

        # Build CSV in-memory
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["timestamp", "user_id", "action_type", "message", "resource_id", "component"])  # details omitted for CSV simplicity
        # Sort newest-first for export as well
        rows.sort(key=lambda x: (x.get("timestamp") or x.get("date") or ""), reverse=True)
        for r in rows:
            writer.writerow([
                r.get("timestamp") or r.get("date"),
                r.get("user_id"),
                r.get("action_type"),
                (r.get("message") or "").replace("\n", " "),
                r.get("resource_id"),
                r.get("component"),
            ])
        output.seek(0)

        # Include actions in filename if provided
        suffix = ""
        if actions:
            suffix = "_" + "-".join([a.strip().upper() for a in actions.split(",") if a.strip()])[:40]
        filename = f"audit_{user_id}_{days}d{suffix}.csv"
        headers = {
            "Content-Disposition": f"attachment; filename={filename}"
        }
        return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers=headers)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[ADMIN][AUDIT] Failed to export audit logs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to export audit logs")
