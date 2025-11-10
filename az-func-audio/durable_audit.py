import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


class DurableAudit:
    """Minimal durable audit writer for Azure Function.

    Writes user_action (JOB_COMPLETED / JOB_FAILED) to audit_logs and job lifecycle events to
    job_activity_logs if containers are available. Soft-fails so pipeline isn't broken if
    audit containers are absent (e.g., during early environment provisioning).
    """

    def __init__(self, cosmos_service):
        self.cosmos = cosmos_service

    def _now_iso(self):
        return datetime.now(timezone.utc).isoformat()

    def log_terminal(self, *, user_id: str, job_id: str, action: str, status: str, details: dict):
        date_str = datetime.now(timezone.utc).strftime('%Y-%m-%d')
        # user_action record (lazy-resolve container if missing on cosmos service)
        audit_container = getattr(self.cosmos, 'audit_logs_container', None)
        if not audit_container:
            try:
                audit_container = self.cosmos.database.get_container_client('audit_logs')
                logger.info('DurableAudit: lazily resolved audit_logs container client')
            except Exception:
                audit_container = None
                logger.warning('DurableAudit: audit_logs container not resolvable; user_action will be skipped', exc_info=True)
        else:
            logger.info('DurableAudit: using preconfigured audit_logs container client')
        if audit_container:
            try:
                # Deterministic id to make this operation idempotent per (date,user,job,action)
                deterministic_id = f"{date_str}:{user_id}:{job_id}:{action}"
                record = {
                    'id': deterministic_id,
                    'date': date_str,
                    'timestamp': self._now_iso(),
                    'user_id': user_id,
                    'action_type': action,
                    'resource_id': job_id,
                    'component': 'azure_function',
                    'details': details or {},
                    'record_type': 'user_action',
                    'terminal': True,
                }
                # Upsert to avoid duplicates on retries
                audit_container.upsert_item(body=record)
                logger.info(f"DurableAudit: upserted JOB terminal user_action {action} for job {job_id}")
            except Exception:
                logger.error('DurableAudit: failed to write audit_logs terminal event', exc_info=True)
        # job_activity record (lazy-resolve container if missing)
        job_activity_container = getattr(self.cosmos, 'job_activity_logs_container', None)
        if not job_activity_container:
            try:
                job_activity_container = self.cosmos.database.get_container_client('job_activity_logs')
                logger.info('DurableAudit: lazily resolved job_activity_logs container client')
            except Exception:
                job_activity_container = None
                logger.warning('DurableAudit: job_activity_logs container not resolvable; job_activity will be skipped', exc_info=True)
        else:
            logger.info('DurableAudit: using preconfigured job_activity_logs container client')
        if job_activity_container:
            try:
                # Deterministic id to make this operation idempotent per job terminal state
                activity_type = 'COMPLETED' if status == 'completed' else 'FAILED'
                deterministic_id = f"terminal:{activity_type}"
                now_iso = self._now_iso()
                record = {
                    'id': deterministic_id,
                    'job_id': job_id,
                    'timestamp': now_iso,
                    'activity_type': activity_type,
                    'status': status,
                    'user_id': user_id,
                    'component': 'azure_function',
                    'details': details or {},
                    'record_type': 'job_activity',
                    'terminal': True,
                }

                # If terminal is COMPLETED, enrich with started_at/completed_at and duration
                if activity_type == 'COMPLETED':
                    try:
                        # Query earliest activity for this job to infer start time (single-partition query)
                        query = (
                            "SELECT c.timestamp FROM c WHERE c.job_id = @job_id "
                            "ORDER BY c.timestamp ASC OFFSET 0 LIMIT 1"
                        )
                        params = [{"name": "@job_id", "value": job_id}]
                        results = list(
                            job_activity_container.query_items(
                                query=query,
                                parameters=params,
                                partition_key=job_id,
                            )
                        )
                        started_at = results[0].get('timestamp') if results else None
                        record['completed_at'] = now_iso
                        if started_at:
                            record['started_at'] = started_at
                            try:
                                # Compute duration in ms
                                start_dt = datetime.fromisoformat(started_at)
                                end_dt = datetime.fromisoformat(now_iso)
                                duration_ms = int((end_dt - start_dt).total_seconds() * 1000)
                                record['processing_time_ms'] = duration_ms
                            except Exception:
                                # Parsing issues shouldn't block logging
                                pass
                    except Exception:
                        # Enrichment is best-effort; continue with base record
                        logger.warning('DurableAudit: could not enrich COMPLETED event with duration', exc_info=True)
                # Upsert to avoid duplicates on retries
                job_activity_container.upsert_item(body=record)
                logger.info(f"DurableAudit: upserted job_activity {record['activity_type']} for job {job_id}")
            except Exception:
                logger.error('DurableAudit: failed to write job_activity_logs terminal event', exc_info=True)
