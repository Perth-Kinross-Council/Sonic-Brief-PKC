from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from azure.cosmos import CosmosClient
from azure.storage.blob import BlobServiceClient
from azure.identity import ManagedIdentityCredential
from azure.core.exceptions import ResourceNotFoundError
import logging
import time
import os
import uuid
from functools import wraps
from config import AppConfig

# Retry decorator for resilience
def retry_on_failure(max_retries=3, delay=1):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    if attempt == max_retries - 1:
                        raise
                    time.sleep(delay * (2 ** attempt))
            return None
        return wrapper
    return decorator

class RetentionService:
    def __init__(self, config: AppConfig, audit_service=None):
        self.config = config
        self.audit_service = audit_service
        self.logger = logging.getLogger(__name__)

        # All retention behavior is environment-driven (Terraform/app settings). Defaults here are generic.
        self.job_retention_days = int(os.getenv("JOB_RETENTION_DAYS", "30"))
        self.failed_job_retention_days = int(os.getenv("FAILED_JOB_RETENTION_DAYS", "30"))
        self.delete_completed_jobs = os.getenv("DELETE_COMPLETED_JOBS", "true").lower() == "true"
        self.archive_completed_jobs = os.getenv("ARCHIVE_COMPLETED_JOBS", "false").lower() == "true"
        self.retention_dry_run = os.getenv("RETENTION_DRY_RUN", "false").lower() == "true"
        self.batch_size = int(os.getenv("RETENTION_BATCH_SIZE", "100"))
        self.max_errors = int(os.getenv("RETENTION_MAX_ERRORS", "10"))

        # Receipt cleanup configuration (also env-driven)
        self.cleanup_receipts_enabled = os.getenv("BLOB_RECEIPT_CLEANUP_ENABLED", "false").lower() == "true"
        self.receipt_retention_days = int(os.getenv("BLOB_RECEIPT_RETENTION_DAYS", str(self.job_retention_days)))
        self.receipt_cleanup_max = int(os.getenv("BLOB_RECEIPT_CLEANUP_MAX", "5000"))

        credential = ManagedIdentityCredential()
        self.cosmos_client = CosmosClient(url=config.cosmos_endpoint, credential=credential)
        self.database = self.cosmos_client.get_database_client(config.cosmos_database)
        self.jobs_container = self.database.get_container_client(config.cosmos_jobs_container)

        self.job_activity_logs_container = None
        self.blob_lifecycle_logs_container = None
        try:
            self.job_activity_logs_container = self.database.get_container_client(config.job_activity_logs_container)
        except Exception:
            self.logger.debug("job_activity_logs container not available (non-fatal)", exc_info=True)
        try:
            self.blob_lifecycle_logs_container = self.database.get_container_client(config.blob_lifecycle_logs_container)
        except Exception:
            self.logger.debug("blob_lifecycle_logs container not available (non-fatal)", exc_info=True)

        self.storage_client = BlobServiceClient(account_url=config.storage_account_url, credential=credential)
        self.container_client = self.storage_client.get_container_client(config.storage_recordings_container)

        self.logger.info(
            "RetentionService init: job=%sd failed=%sd delete=%s dry_run=%s batch=%s receipts_cleanup=%s receipts_days=%sd",
            self.job_retention_days,
            self.failed_job_retention_days,
            self.delete_completed_jobs,
            self.retention_dry_run,
            self.batch_size,
            self.cleanup_receipts_enabled,
            self.receipt_retention_days,
        )

    def apply_retention_policies(self):
        """Apply simplified retention policies based on configuration"""
        self.logger.info("Starting retention policy application")
        run_id = f"retention_{int(time.time())}_{uuid.uuid4().hex[:8]}"
        run_started = datetime.utcnow()

        # Simplified policies - only jobs and temp files (no archival)
        policies = {
            "completed_jobs": timedelta(days=self.job_retention_days),
            "failed_jobs": timedelta(days=self.failed_job_retention_days),
            "temp_files": timedelta(days=7),  # Fixed short period for temp files
        }

        results: Dict[str, Any] = {}
        for policy_name, retention_period in policies.items():
            try:
                result = self._apply_policy(policy_name, retention_period, run_id=run_id)
                results[policy_name] = result
                self._log_activity(
                    metric_type="RETENTION_POLICY",
                    component="retention_service",
                    value=result.get("processed_count", 0),
                    severity="INFO",
                    details={
                        "policy_name": policy_name,
                        "retention_days": retention_period.days,
                        "result": result
                    }
                )
            except Exception as e:
                self.logger.error(f"Failed to apply policy {policy_name}: {str(e)}")
                results[policy_name] = {"error": str(e)}

        # Persist run summary (best effort)
        if self.job_activity_logs_container:
            try:
                # Derive aggregate figures (combined across policies) for easier monitoring/alerting
                completed_eligible = results.get("completed_jobs", {}).get("total_eligible") or 0
                completed_processed = results.get("completed_jobs", {}).get("processed_count") or 0
                failed_eligible = results.get("failed_jobs", {}).get("total_eligible") or 0
                failed_processed = results.get("failed_jobs", {}).get("processed_count") or 0
                total_eligible_for_deletion = completed_eligible + failed_eligible
                total_processed_this_run = completed_processed + failed_processed
                # In dry-run mode, nothing is actually deleted so remaining == total eligible
                remaining_after_run = (
                    total_eligible_for_deletion if self.retention_dry_run else max(0, total_eligible_for_deletion - total_processed_this_run)
                )

                # Metric: completed jobs that were (or would be) deleted this run
                completed_jobs_to_be_deleted = completed_eligible if self.retention_dry_run else completed_processed

                receipts_cleanup_stats = None
                if self.cleanup_receipts_enabled:
                    try:
                        receipts_cleanup_stats = self._cleanup_blob_receipts()
                    except Exception:
                        self.logger.warning("Receipt cleanup step failed", exc_info=True)

                summary_doc = {
                    "id": f"{run_id}_summary",
                    "type": "retention_run_summary",
                    "run_id": run_id,
                    "started_at": run_started.isoformat(),
                    "finished_at": datetime.utcnow().isoformat(),
                    "dry_run": self.retention_dry_run,
                    "configuration": {
                        "job_retention_days": self.job_retention_days,
                        "failed_job_retention_days": self.failed_job_retention_days,
                        "batch_size": self.batch_size,
                        "max_errors": self.max_errors,
                    },
                    # Augment results with aggregate view for completed jobs (eligible vs processed/deleted)
                    "policy_results": results,
                    "aggregates": {
                        "completed_jobs": {
                            "eligible": results.get("completed_jobs", {}).get("total_eligible"),
                            "processed": results.get("completed_jobs", {}).get("processed_count"),
                            "dry_run": self.retention_dry_run,
                        },
                        "failed_jobs": {
                            "eligible": results.get("failed_jobs", {}).get("total_eligible"),
                            "processed": results.get("failed_jobs", {}).get("processed_count"),
                            "dry_run": self.retention_dry_run,
                        },
                        # New overall combined view across job policies
                        "overall": {
                            "total_eligible_for_deletion": total_eligible_for_deletion,
                            "processed_this_run": total_processed_this_run,
                            "remaining_after_run": remaining_after_run,
                            "dry_run": self.retention_dry_run,
                        },
                    },
                    "completed_jobs_to_be_deleted": completed_jobs_to_be_deleted,
                        "receipts_cleanup": receipts_cleanup_stats,
                }
                self.job_activity_logs_container.upsert_item(summary_doc)
                self.logger.info(
                    "Retention run summary: completed eligible=%s processed=%s to_be_deleted=%s | failed eligible=%s processed=%s | total eligible=%s processed=%s remaining=%s dry_run=%s",
                    completed_eligible,
                    completed_processed,
                    completed_jobs_to_be_deleted,
                    failed_eligible,
                    failed_processed,
                    total_eligible_for_deletion,
                    total_processed_this_run,
                    remaining_after_run,
                    self.retention_dry_run,
                )
            except Exception:
                self.logger.warning("Failed to persist retention run summary", exc_info=True)

        return results

    def _cleanup_blob_receipts(self) -> Dict[str, Any]:
        """Cleanup azure-webjobs-hosts/blobreceipts receipts older than receipt_retention_days.
        Safe rule: any receipt older than the longest job retention (e.g., 15 days prod) can be removed.
        Honors dry-run mode.
        """
        start_ts = datetime.utcnow()
        cutoff = start_ts - timedelta(days=self.receipt_retention_days)
        stats = {
            "enabled": True,
            "retention_days": self.receipt_retention_days,
            "cutoff_iso": cutoff.isoformat(),
            "scanned": 0,
            "deleted": 0,
            "would_delete": 0,
            "skipped_newer": 0,
            "errors": 0,
            "limit_reached": False,
        }
        try:
            hosts_container = self.storage_client.get_container_client("azure-webjobs-hosts")
            blobs_iter = hosts_container.list_blobs(name_starts_with="blobreceipts/")
            for idx, blob in enumerate(blobs_iter):
                if idx >= self.receipt_cleanup_max:
                    stats["limit_reached"] = True
                    break
                stats["scanned"] += 1
                if blob.last_modified and blob.last_modified.replace(tzinfo=None) < cutoff:
                    try:
                        if self.retention_dry_run:
                            stats["would_delete"] += 1
                        else:
                            hosts_container.delete_blob(blob.name)
                            stats["deleted"] += 1
                    except Exception:
                        stats["errors"] += 1
                        self.logger.debug("Failed deleting receipt blob %s", blob.name, exc_info=True)
                else:
                    stats["skipped_newer"] += 1
            stats["duration_ms"] = int((datetime.utcnow() - start_ts).total_seconds() * 1000)
            self.logger.info(
                "Receipt cleanup: scanned=%s deleted=%s would_delete=%s skipped=%s errors=%s cutoff=%s dry_run=%s limit_reached=%s",
                stats["scanned"],
                stats["deleted"],
                stats["would_delete"],
                stats["skipped_newer"],
                stats["errors"],
                stats["cutoff_iso"],
                self.retention_dry_run,
                stats["limit_reached"],
            )
            return stats
        except Exception as e:
            self.logger.warning("Receipt cleanup encountered error: %s", e, exc_info=True)
            stats["error"] = str(e)
            return stats

    def _log_activity(self, **kwargs):
        """Log activity if audit service is available"""
        if self.audit_service:
            self.audit_service.log_system_metric(**kwargs)
        else:
            self.logger.info(f"Audit log: {kwargs}")

    def _apply_policy(self, policy_name: str, retention_period: timedelta, run_id: Optional[str] = None) -> Dict[str, Any]:
        """Apply specific retention policy"""
        cutoff_date = datetime.utcnow() - retention_period

        if policy_name == "completed_jobs":
            # Only direct deletion - no archival
            if self.delete_completed_jobs:
                return self._delete_completed_jobs(cutoff_date, run_id=run_id, policy_name=policy_name)
            else:
                return {"processed_count": 0, "message": "Job deletion is disabled"}
        elif policy_name == "failed_jobs":
            return self._cleanup_failed_jobs(cutoff_date, run_id=run_id, policy_name=policy_name)
        elif policy_name == "temp_files":
            return self._cleanup_temp_blobs(cutoff_date, run_id=run_id, policy_name=policy_name)
        else:
            return {"error": f"Unknown policy: {policy_name}"}

    @retry_on_failure(max_retries=3, delay=1)
    def _process_jobs_in_batches(self, query: str, parameters: list):
        """Stream all matching jobs without OFFSET/LIMIT to avoid duplication and inefficiency.
        Cosmos DB OFFSET/LIMIT across partitions can re-scan and produce inconsistent windows when not paired with
        an ORDER BY. Here we iterate the result set directly with a server-side continuation.
        """
        collected: List[Dict[str, Any]] = []
        iterator = self.jobs_container.query_items(
            query=query,
            parameters=parameters,
            enable_cross_partition_query=True,
            max_item_count=self.batch_size,
        )
        for doc in iterator:
            collected.append(doc)
            if len(collected) % 500 == 0:
                self.logger.info(f"Scanned {len(collected)} jobs so far...")
        return collected

    def _delete_completed_jobs(self, cutoff_date: datetime, run_id: Optional[str], policy_name: str) -> Dict[str, Any]:
        """Delete completed jobs older than cutoff date and their associated files"""
        cutoff_ms = int(cutoff_date.timestamp() * 1000)
        cutoff_iso = cutoff_date.isoformat()
        self.logger.info(
            "Deleting completed jobs older than %s (cutoff_iso=%s cutoff_ms=%s)",
            cutoff_date,
            cutoff_iso,
            cutoff_ms,
        )

        # Support both legacy numeric epoch ms and ISO 8601 string created_at formats
        query = """
        SELECT * FROM c
        WHERE c.type = 'job'
        AND c.status = 'completed'
        AND (
            (IS_NUMBER(c.created_at) AND c.created_at < @cutoff_ms) OR
            (IS_STRING(c.created_at) AND c.created_at < @cutoff_iso)
        )
        """

        jobs_to_delete = self._process_jobs_in_batches(
            query,
            [
                {"name": "@cutoff_ms", "value": cutoff_ms},
                {"name": "@cutoff_iso", "value": cutoff_iso},
            ],
        )

        # Guard against duplicate logical jobs (should not happen, but defensive)
        unique_job_ids = {j.get('id') for j in jobs_to_delete if j.get('id')}

        deleted_count = 0
        for job in jobs_to_delete:
            try:
                job_blob_actions: List[Dict[str, Any]] = []
                blob_urls = [
                    job.get("file_path"),
                    job.get("transcription_file_path"),
                    job.get("analysis_file_path")
                ]
                for blob_url in blob_urls:
                    if blob_url:
                        outcome = self._delete_blob_safely(blob_url, run_id=run_id, policy_name=policy_name, job_id=job.get("id"))
                        job_blob_actions.append(outcome)
                # Delete job record (or skip in dry run mode)
                if not self.retention_dry_run:
                    self.jobs_container.delete_item(item=job["id"], partition_key=job["id"])
                    deleted_count += 1
                else:
                    self.logger.info(f"DRY RUN: Would delete completed job {job['id']}")
                    deleted_count += 1
                self._persist_job_action(run_id, policy_name, job, job_blob_actions)
            except Exception as e:
                self.logger.error(f"Failed to delete completed job {job.get('id')}: {str(e)}")

        return {
            "processed_count": deleted_count,
            "total_eligible": len(unique_job_ids),
            "unique_total_eligible": len(unique_job_ids),
            "raw_candidates": len(jobs_to_delete),
            "dry_run": self.retention_dry_run
        }

    def _cleanup_failed_jobs(self, cutoff_date: datetime, run_id: Optional[str], policy_name: str) -> Dict[str, Any]:
        """Clean up failed jobs older than cutoff date and their associated files"""
        cutoff_ms = int(cutoff_date.timestamp() * 1000)
        cutoff_iso = cutoff_date.isoformat()
        self.logger.info(
            "Cleaning up failed jobs older than %s (cutoff_iso=%s cutoff_ms=%s)",
            cutoff_date,
            cutoff_iso,
            cutoff_ms,
        )

        query = """
        SELECT * FROM c
        WHERE c.type = 'job'
        AND c.status = 'failed'
        AND (
            (IS_NUMBER(c.created_at) AND c.created_at < @cutoff_ms) OR
            (IS_STRING(c.created_at) AND c.created_at < @cutoff_iso)
        )
        """

        failed_jobs = self._process_jobs_in_batches(
            query,
            [
                {"name": "@cutoff_ms", "value": cutoff_ms},
                {"name": "@cutoff_iso", "value": cutoff_iso},
            ],
        )

        unique_failed_ids = {j.get('id') for j in failed_jobs if j.get('id')}

        deleted_count = 0
        for job in failed_jobs:
            try:
                job_blob_actions: List[Dict[str, Any]] = []
                blob_urls = [
                    job.get("file_path"),
                    job.get("transcription_file_path"),
                    job.get("analysis_file_path")
                ]
                for blob_url in blob_urls:
                    if blob_url:
                        outcome = self._delete_blob_safely(blob_url, run_id=run_id, policy_name=policy_name, job_id=job.get("id"))
                        job_blob_actions.append(outcome)
                if not self.retention_dry_run:
                    self.jobs_container.delete_item(item=job["id"], partition_key=job["id"])
                    deleted_count += 1
                else:
                    self.logger.info(f"DRY RUN: Would delete failed job {job['id']}")
                    deleted_count += 1
                self._persist_job_action(run_id, policy_name, job, job_blob_actions)
            except Exception as e:
                self.logger.error(f"Failed to delete failed job {job.get('id')}: {str(e)}")

        return {
            "processed_count": deleted_count,
            "total_eligible": len(unique_failed_ids),
            "unique_total_eligible": len(unique_failed_ids),
            "raw_candidates": len(failed_jobs),
            "dry_run": self.retention_dry_run
        }

    def _cleanup_temp_blobs(self, cutoff_date: datetime, run_id: Optional[str], policy_name: str) -> Dict[str, Any]:
        """Clean up temporary blobs older than cutoff date"""
        self.logger.info(f"Cleaning up temporary blobs older than {cutoff_date}")

        # Find blobs that match temp patterns
        temp_patterns = ["temp/", "tmp/", "_temp", "_tmp"]
        deleted_count = 0

        try:
            blobs = self.container_client.list_blobs(include=['metadata'])

            for blob in blobs:
                if any(pattern in blob.name.lower() for pattern in temp_patterns):
                    if blob.last_modified < cutoff_date.replace(tzinfo=blob.last_modified.tzinfo):
                        try:
                            if not self.retention_dry_run:
                                self.container_client.delete_blob(blob.name)
                                deleted_count += 1
                                self._persist_blob_action(run_id, policy_name, None, blob.name, action="delete", outcome="deleted")
                            else:
                                self.logger.info(f"DRY RUN: Would delete temp blob {blob.name}")
                                deleted_count += 1
                                self._persist_blob_action(run_id, policy_name, None, blob.name, action="would_delete", outcome="dry_run")

                        except Exception as e:
                            self.logger.error(f"Failed to delete temp blob {blob.name}: {str(e)}")
                            self._persist_blob_action(run_id, policy_name, None, blob.name, action="delete", outcome="error", error=str(e))

        except Exception as e:
            self.logger.error(f"Failed to list blobs for temp cleanup: {str(e)}")
            return {"error": str(e)}

        return {
            "processed_count": deleted_count,
            "dry_run": self.retention_dry_run
        }

    @retry_on_failure(max_retries=3, delay=1)
    def _delete_blob_safely(self, blob_url: str, run_id: Optional[str] = None, policy_name: Optional[str] = None, job_id: Optional[str] = None):
        """Safely delete a blob with error handling"""
        if self.retention_dry_run:
            # Only record blobs that would be deleted
            self.logger.info(f"DRY RUN: Would delete blob: {blob_url}")
            return self._persist_blob_action(run_id, policy_name, job_id, blob_url, action="would_delete", outcome="dry_run")

        try:
            blob_name = blob_url.split(f"{self.config.storage_recordings_container}/")[-1]
            self.container_client.delete_blob(blob_name)
            self.logger.info(f"Deleted blob: {blob_url}")
            return self._persist_blob_action(run_id, policy_name, job_id, blob_url, action="delete", outcome="deleted")
        except ResourceNotFoundError:
            # Suppress persistence for already deleted blobs to reduce noise
            self.logger.info(f"Blob already deleted (no log persisted): {blob_url}")
            return {"blob_url": blob_url, "action": "delete", "outcome": "not_found"}
        except Exception as e:
            # Suppress persistence for errors (only logging successful or would-delete actions)
            self.logger.error(f"Failed to delete blob {blob_url}: {str(e)}")
            return {"blob_url": blob_url, "action": "delete", "outcome": "error", "error": str(e)}

    # ---------------- Persistence helpers -----------------
    def _persist_job_action(self, run_id: Optional[str], policy_name: str, job: Dict[str, Any], blob_actions: List[Dict[str, Any]]):
        if not self.job_activity_logs_container or not run_id:
            return
        try:
            created_at_val = job.get("created_at")
            age_days: Optional[int] = None
            if created_at_val is not None:
                try:
                    if isinstance(created_at_val, (int, float)):
                        # Assume epoch ms
                        created_dt = datetime.utcfromtimestamp(created_at_val / 1000.0)
                    elif isinstance(created_at_val, str):
                        if 'T' in created_at_val:
                            created_dt = datetime.fromisoformat(created_at_val.replace('Z', '+00:00'))
                        else:
                            # Fallback legacy format
                            created_dt = datetime.strptime(created_at_val, '%Y-%m-%d %H:%M:%S')
                    else:
                        created_dt = None  # Unsupported type
                    if created_dt:
                        age_days = (datetime.utcnow() - created_dt).days
                except Exception:
                    self.logger.debug("Could not parse created_at for job action persistence", exc_info=True)
            # Extract additional metadata (best-effort) for richer auditability
            user_id = job.get("user_id") or job.get("created_by")
            category_id = job.get("prompt_category_id") or job.get("category_id")
            subcategory_id = job.get("prompt_subcategory_id") or job.get("subcategory_id")
            # Display names if backend stored them (future-safe keys)
            category_name = job.get("prompt_category_name") or job.get("category_name")
            subcategory_name = job.get("prompt_subcategory_name") or job.get("subcategory_name")
            doc = {
                "id": f"{run_id}:{job.get('id')}",
                "type": "retention_job_action",
                "run_id": run_id,
                "policy": policy_name,
                "job_id": job.get("id"),
                "job_status": job.get("status"),
                "age_days": age_days,
                "dry_run": self.retention_dry_run,
                "blob_actions": blob_actions,
                "user_id": user_id,
                "prompt_category_id": category_id,
                "prompt_category_name": category_name,
                "prompt_subcategory_id": subcategory_id,
                "prompt_subcategory_name": subcategory_name,
                "timestamp": datetime.utcnow().isoformat(),
            }
            self.job_activity_logs_container.upsert_item(doc)
        except Exception:
            self.logger.debug("Failed to persist job action (non-fatal)", exc_info=True)

    def _persist_blob_action(self, run_id: Optional[str], policy_name: Optional[str], job_id: Optional[str], blob_url: str, action: str, outcome: str, error: Optional[str] = None) -> Dict[str, Any]:
        record = {
            "blob_url": blob_url,
            "action": action,
            "outcome": outcome,
        }
        if not self.blob_lifecycle_logs_container or not run_id:
            return record
        try:
            doc = {
                "id": uuid.uuid4().hex,
                "type": "blob_retention_action",
                "run_id": run_id,
                "policy": policy_name,
                "job_id": job_id,
                "blob_url": blob_url,
                "action": action,
                "outcome": outcome,
                "dry_run": self.retention_dry_run,
                "error": error,
                "timestamp": datetime.utcnow().isoformat(),
            }
            self.blob_lifecycle_logs_container.upsert_item(doc)
        except Exception:
            self.logger.debug("Failed to persist blob action (non-fatal)", exc_info=True)
        return record

    def get_retention_health(self) -> Dict[str, Any]:
        """Health check for retention system"""
        try:
            # Test Cosmos DB connectivity
            test_query = "SELECT VALUE COUNT(1) FROM c WHERE c.type = 'job'"
            job_count = list(self.jobs_container.query_items(
                query=test_query,
                enable_cross_partition_query=True
            ))[0]

            # Test Storage connectivity
            try:
                self.container_client.get_container_properties()
                storage_healthy = True
            except:
                storage_healthy = False

            return {
                "status": "healthy" if storage_healthy else "degraded",
                "cosmos_jobs_count": job_count,
                "storage_accessible": storage_healthy,
                "configuration": {
                    "job_retention_days": self.job_retention_days,
                    "failed_job_retention_days": self.failed_job_retention_days,
                    "delete_mode": self.delete_completed_jobs,
                        "dry_run": self.retention_dry_run,
                        "batch_size": self.batch_size,
                        "max_errors": self.max_errors,
                },
                "last_check": datetime.utcnow().isoformat()
            }
        except Exception as e:
            return {
                "status": "unhealthy",
                "error": str(e)
            }

    def get_retention_status(self) -> Dict[str, Any]:
        """Get current retention status and statistics"""
        try:
            # Get basic job counts by status without complex date comparisons
            simple_query = """
            SELECT c.status, COUNT(1) as count
            FROM c
            WHERE c.type = 'job'
            GROUP BY c.status
            """

            job_stats = list(
                self.jobs_container.query_items(
                    query=simple_query,
                    enable_cross_partition_query=True,
                )
            )

            # Get all jobs with timestamps for manual analysis
            all_jobs_query = """
            SELECT c.id, c.status, c.created_at
            FROM c
            WHERE c.type = 'job'
            ORDER BY c.created_at DESC
            """

            all_jobs = list(
                self.jobs_container.query_items(
                    query=all_jobs_query,
                    enable_cross_partition_query=True,
                )
            )

            # Calculate age-based statistics manually
            now = datetime.utcnow()
            cutoff_date = now - timedelta(days=self.job_retention_days)

            jobs_for_deletion = []
            recent_jobs = []
            old_jobs = []

            for job in all_jobs:
                try:
                    created_val = job.get('created_at')
                    created_dt = None
                    created_render = created_val
                    if isinstance(created_val, (int, float)):
                        created_dt = datetime.utcfromtimestamp(created_val / 1000.0)
                        created_render = datetime.utcfromtimestamp(created_val / 1000.0).isoformat() + 'Z'
                    elif isinstance(created_val, str) and created_val:
                        if 'T' in created_val:
                            created_dt = datetime.fromisoformat(created_val.replace('Z', '+00:00'))
                        else:
                            created_dt = datetime.strptime(created_val, '%Y-%m-%d %H:%M:%S')
                    if created_dt:
                        if created_dt < cutoff_date:
                            if job.get('status') in ['completed', 'failed']:
                                jobs_for_deletion.append({
                                    'id': job.get('id'),
                                    'status': job.get('status'),
                                    'created_at': created_render,
                                    'age_days': (now - created_dt).days
                                })
                            old_jobs.append(job)
                        else:
                            recent_jobs.append(job)
                except Exception as e:
                    self.logger.debug(f"Could not parse created_at for job {job.get('id')}: {e}")

            # Get blob storage usage (approximate)
            blob_count = 0
            total_size = 0
            try:
                blobs = self.container_client.list_blobs(include=['metadata'])
                for blob in blobs:
                    blob_count += 1
                    total_size += blob.size or 0
            except Exception as e:
                self.logger.error(f"Failed to get blob statistics: {str(e)}")

            return {
                "timestamp": now.isoformat(),
                "cutoff_date": cutoff_date.isoformat(),
                "job_statistics_by_status": job_stats,
                "jobs_eligible_for_deletion": jobs_for_deletion,
                "total_jobs": len(all_jobs),
                "recent_jobs_count": len(recent_jobs),
                "old_jobs_count": len(old_jobs),
                "jobs_for_deletion_count": len(jobs_for_deletion),
                "blob_statistics": {
                    "total_blobs": blob_count,
                    "total_size_bytes": total_size,
                    "total_size_gb": round(total_size / (1024**3), 2)
                },
                "retention_configuration": {
                    "job_retention_days": self.job_retention_days,
                    "failed_job_retention_days": self.failed_job_retention_days,
                    "delete_completed_jobs": self.delete_completed_jobs,
                    "dry_run_mode": self.retention_dry_run,
                    "batch_size": self.batch_size,
                    "max_errors": self.max_errors,
                }
            }

        except Exception as e:
            self.logger.error(f"Failed to get retention status: {str(e)}")
            return {"error": str(e)}
