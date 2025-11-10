"""
Simple Audit Logger for Sonic Brief
Minimal-disruption audit logging that enhances existing job documents
"""

import logging
from datetime import datetime
from typing import Dict, Any, Optional, List
import uuid


class SimpleAuditLogger:
    """Lightweight audit logger that enhances existing job documents"""
    
    def __init__(self, cosmos_service):
        self.cosmos_service = cosmos_service
        self.logger = logging.getLogger(__name__)
        self.logger.setLevel(logging.INFO)
    
    def log_job_event(self, job_id: str, action: str, component: str, 
                     user_id: str = None, details: Dict[str, Any] = None):
        """
        Add audit event to job's audit trail
        
        Args:
            job_id: The job ID to audit
            action: Action being performed (e.g., 'created', 'processing_started', 'completed')
            component: Component performing the action (e.g., 'backend_api', 'azure_function')
            user_id: Optional user ID
            details: Optional additional details
        """
        try:
            # Get existing job
            job = self.cosmos_service.get_job_by_id(job_id)
            if not job:
                self.logger.warning(f"Job {job_id} not found for audit logging")
                return False
            
            # Initialize audit_trail if it doesn't exist (backward compatibility)
            if "audit_trail" not in job:
                job["audit_trail"] = []
            
            # Create audit event
            audit_event = {
                "id": str(uuid.uuid4()),
                "timestamp": datetime.utcnow().isoformat(),
                "action": action,
                "component": component,
                "details": details or {}
            }
            
            if user_id:
                audit_event["user_id"] = user_id
            
            # Add to audit trail
            job["audit_trail"].append(audit_event)
            
            # Keep audit trail to reasonable size (last 50 events)
            if len(job["audit_trail"]) > 50:
                job["audit_trail"] = job["audit_trail"][-50:]
            
            # Update job document
            self.cosmos_service.update_job(job)
            
            self.logger.info(f"Audit event logged: {action} for job {job_id}")
            return True
            
        except Exception as e:
            # IMPORTANT: Audit logging failures should not break main operations
            self.logger.error(f"Failed to log audit event for job {job_id}: {str(e)}")
            return False
    
    def add_job_metrics(self, job_id: str, metrics: Dict[str, Any]):
        """
        Add or update performance metrics for a job
        
        Args:
            job_id: The job ID
            metrics: Dictionary of metrics to add/update
        """
        try:
            job = self.cosmos_service.get_job_by_id(job_id)
            if not job:
                self.logger.warning(f"Job {job_id} not found for metrics logging")
                return False
            
            # Initialize metrics if it doesn't exist
            if "metrics" not in job:
                job["metrics"] = {}
            
            # Update metrics (merge with existing)
            job["metrics"].update(metrics)
            
            # Add metrics timestamp
            job["metrics"]["last_updated"] = datetime.utcnow().isoformat()
            
            # Update job document
            self.cosmos_service.update_job(job)
            
            self.logger.info(f"Metrics updated for job {job_id}: {list(metrics.keys())}")
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to add metrics for job {job_id}: {str(e)}")
            return False
    
    def log_user_action(self, user_id: str, action: str, resource_type: str, 
                       resource_id: str, details: Dict[str, Any] = None):
        """
        Log user actions for compliance (stores in separate user activity log)
        
        Args:
            user_id: User performing the action
            action: Action type (e.g., 'upload', 'download', 'delete')
            resource_type: Type of resource (e.g., 'job', 'file')
            resource_id: ID of the resource
            details: Additional details
        """
        try:
            # Create user activity record
            activity_record = {
                "id": str(uuid.uuid4()),
                "type": "user_activity",
                "timestamp": datetime.utcnow().isoformat(),
                "user_id": user_id,
                "action": action,
                "resource_type": resource_type,
                "resource_id": resource_id,
                "details": details or {}
            }
            
            # Store in jobs container with type='user_activity' for easy querying
            self.cosmos_service.jobs_container.create_item(body=activity_record)
            
            self.logger.info(f"User action logged: {action} by {user_id}")
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to log user action: {str(e)}")
            return False
    
    def get_job_audit_trail(self, job_id: str) -> List[Dict[str, Any]]:
        """Get the complete audit trail for a job"""
        try:
            job = self.cosmos_service.get_job_by_id(job_id)
            if not job:
                return []
            
            return job.get("audit_trail", [])
            
        except Exception as e:
            self.logger.error(f"Failed to get audit trail for job {job_id}: {str(e)}")
            return []
    
    def get_user_activity(self, user_id: str, days: int = 30) -> List[Dict[str, Any]]:
        """Get user activity for the last N days"""
        try:
            from datetime import timedelta
            
            start_date = (datetime.utcnow() - timedelta(days=days)).isoformat()
            
            query = """
            SELECT * FROM c 
            WHERE c.type = 'user_activity' 
            AND c.user_id = @user_id 
            AND c.timestamp >= @start_date 
            ORDER BY c.timestamp DESC
            """
            
            activities = list(
                self.cosmos_service.jobs_container.query_items(
                    query=query,
                    parameters=[
                        {"name": "@user_id", "value": user_id},
                        {"name": "@start_date", "value": start_date}
                    ],
                    enable_cross_partition_query=True
                )
            )
            
            return activities
            
        except Exception as e:
            self.logger.error(f"Failed to get user activity: {str(e)}")
            return []
    
    def get_system_metrics(self, days: int = 7) -> Dict[str, Any]:
        """Get system-wide metrics for the last N days"""
        try:
            from datetime import timedelta
            
            start_date = (datetime.utcnow() - timedelta(days=days)).isoformat()
            
            # Query for jobs with metrics
            query = """
            SELECT 
                c.status,
                COUNT(1) as job_count,
                AVG(c.metrics.processing_time_ms) as avg_processing_time,
                AVG(c.metrics.file_size_bytes) as avg_file_size,
                SUM(c.metrics.file_size_bytes) as total_bytes_processed,
                AVG(c.metrics.audio_duration_seconds) as avg_audio_duration
            FROM c 
            WHERE c.type = 'job' 
            AND c.created_at >= @start_date
            AND IS_DEFINED(c.metrics)
            GROUP BY c.status
            """
            
            results = list(
                self.cosmos_service.jobs_container.query_items(
                    query=query,
                    parameters=[{"name": "@start_date", "value": start_date}],
                    enable_cross_partition_query=True
                )
            )
            
            return {
                "period_days": days,
                "metrics_by_status": results,
                "generated_at": datetime.utcnow().isoformat()
            }
            
        except Exception as e:
            self.logger.error(f"Failed to get system metrics: {str(e)}")
            return {"error": str(e)}


# Convenience functions for easy integration
def create_audit_logger(cosmos_service) -> SimpleAuditLogger:
    """Factory function to create audit logger"""
    return SimpleAuditLogger(cosmos_service)


def log_job_start(audit_logger: SimpleAuditLogger, job_id: str, component: str, 
                 user_id: str = None, **details):
    """Convenience function to log job start"""
    return audit_logger.log_job_event(
        job_id=job_id,
        action="processing_started",
        component=component,
        user_id=user_id,
        details=details
    )


def log_job_complete(audit_logger: SimpleAuditLogger, job_id: str, component: str,
                    success: bool = True, **details):
    """Convenience function to log job completion"""
    action = "processing_completed" if success else "processing_failed"
    return audit_logger.log_job_event(
        job_id=job_id,
        action=action,
        component=component,
        details=details
    )


def log_upload(audit_logger: SimpleAuditLogger, user_id: str, job_id: str, 
              filename: str, file_size: int):
    """Convenience function to log file uploads"""
    return audit_logger.log_user_action(
        user_id=user_id,
        action="upload",
        resource_type="file",
        resource_id=job_id,
        details={
            "filename": filename,
            "file_size_bytes": file_size,
            "upload_method": "web"
        }
    )
