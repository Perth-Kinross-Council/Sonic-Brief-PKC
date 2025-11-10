"""
Cosmos DB Audit Service for Sonic Brief
Provides persistent audit logging to dedicated Cosmos DB containers
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, Optional
from azure.cosmos.exceptions import CosmosHttpResponseError, CosmosResourceNotFoundError


class CosmosAuditService:
    """Service for writing audit logs to dedicated Cosmos DB containers"""
    
    def __init__(self, cosmos_db_client):
        """
        Initialize the audit service with a Cosmos DB client
        
        Args:
            cosmos_db_client: Instance of CosmosDB class from core.config
        """
        self.cosmos_db = cosmos_db_client
        self.logger = logging.getLogger(__name__)
        
        # Validate that audit containers are available
        self._validate_audit_containers()
    
    def _validate_audit_containers(self):
        """Validate that all required audit containers are accessible"""
        required_containers = [
            'audit_logs_container',
            'job_activity_logs_container', 
            'blob_lifecycle_logs_container',
            'system_metrics_container',
            'usage_analytics_container'
        ]
        
        missing_containers = []
        for container_name in required_containers:
            if not hasattr(self.cosmos_db, container_name):
                self.logger.error(f"CRITICAL: Audit container {container_name} not available")
                missing_containers.append(container_name)
            else:
                try:
                    # Test container access by reading its properties
                    container = getattr(self.cosmos_db, container_name)
                    container_info = container.read()
                    self.logger.info(f"✅ Audit container {container_name} validated: {container_info.get('id')}")
                except Exception as e:
                    self.logger.error(f"CRITICAL: Audit container {container_name} exists but not accessible: {str(e)}")
                    missing_containers.append(container_name)
        
        if missing_containers:
            self.logger.error(f"AUDIT SERVICE DEGRADED: Missing containers: {missing_containers}")
        else:
            self.logger.info("✅ All audit containers validated successfully")
    
    def log_user_action(self, user_id: str, action_type: str, message: str = None,
                       details: Dict[str, Any] = None, request_info: Dict[str, Any] = None, 
                       resource_id: str = None) -> bool:
        """
        Log user action to audit_logs container
        
        Args:
            user_id: ID of the user performing the action
            action_type: Type of action (LOGIN, LOGOUT, UPLOAD, DOWNLOAD, etc.)
            message: Human-readable description of the action
            details: Additional details about the action
            request_info: Request information (IP, user agent, etc.)
            resource_id: ID of the resource being acted upon
            
        Returns:
            bool: True if logged successfully, False otherwise
        """
        try:
            # Check if audit_logs_container is available
            if not hasattr(self.cosmos_db, 'audit_logs_container'):
                self.logger.error("CRITICAL: audit_logs_container attribute not found on cosmos_db client")
                return False
            
            # Create partition key value (using date for distribution)
            current_date = datetime.now(timezone.utc).strftime('%Y-%m-%d')
            
            audit_record = {
                "id": str(uuid.uuid4()),
                "date": current_date,  # This is the partition key field
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "user_id": user_id,
                "action_type": action_type,
                "message": message or f"{action_type} action by {user_id}",
                "resource_id": resource_id,
                "component": "backend_api",
                "details": details or {},
                "request_info": request_info or {},
                "record_type": "user_action"
            }
            
            # Write to audit_logs container
            self.logger.info(f"Attempting to log user action: {action_type} by {user_id}")
            self.logger.debug(f"Audit record: {audit_record}")
            
            result = self.cosmos_db.audit_logs_container.create_item(body=audit_record)
            
            self.logger.info(f"User action logged successfully: {action_type} by {user_id}, record ID: {result.get('id')}")
            return True
            
        except CosmosHttpResponseError as e:
            self.logger.error(f"Cosmos HTTP error logging user action: Status {e.status_code}, Message: {e.message}")
            self.logger.error(f"Error details: {e}")
            return False
        except CosmosResourceNotFoundError as e:
            self.logger.error(f"Cosmos resource not found error: {e}")
            self.logger.error("This suggests the audit_logs container doesn't exist in Cosmos DB")
            return False
        except AttributeError as e:
            self.logger.error(f"Attribute error - likely missing container attribute: {e}")
            return False
        except Exception as e:
            self.logger.error(f"Unexpected error logging user action: {str(e)}")
            self.logger.error(f"Error type: {type(e).__name__}")
            import traceback
            self.logger.error(f"Traceback: {traceback.format_exc()}")
            return False
    
    def log_job_activity(self, job_id: str, activity_type: str, status: str, 
                        details: Dict[str, Any] = None, user_id: str = None) -> bool:
        """
        Log job activity to job_activity_logs container
        
        Args:
            job_id: ID of the job
            activity_type: Type of activity (CREATED, PROCESSING, COMPLETED, FAILED)
            status: Current status of the job
            details: Additional details about the activity
            user_id: ID of the user associated with the job
            
        Returns:
            bool: True if logged successfully, False otherwise
        """
        try:
            # Use a single timestamp for consistency within this record
            now_utc = datetime.now(timezone.utc)

            activity_record = {
                "id": str(uuid.uuid4()),
                "partition_key": job_id,  # Using job_id for partition key
                "timestamp": now_utc.isoformat(),
                "job_id": job_id,
                "activity_type": activity_type,
                "status": status,
                "user_id": user_id,
                "component": "backend_api",
                "details": details or {},
                "record_type": "job_activity"
            }

            # If this is a completion event, enrich with start/end timestamps and duration
            if str(activity_type).upper() == "COMPLETED":
                try:
                    # Get earliest activity (start) for this job to compute duration
                    query = (
                        "SELECT c.timestamp FROM c WHERE c.job_id = @job_id "
                        "ORDER BY c.timestamp ASC OFFSET 0 LIMIT 1"
                    )
                    parameters = [{"name": "@job_id", "value": job_id}]

                    results = list(
                        self.cosmos_db.job_activity_logs_container.query_items(
                            query=query,
                            parameters=parameters,
                            partition_key=job_id,
                        )
                    )

                    started_at: Optional[str] = None
                    if results:
                        started_at = results[0].get("timestamp")

                    completed_at = now_utc.isoformat()
                    activity_record["completed_at"] = completed_at
                    if started_at:
                        activity_record["started_at"] = started_at
                        try:
                            start_dt = datetime.fromisoformat(started_at)
                            duration_ms = int((now_utc - start_dt).total_seconds() * 1000)
                            # Store computed duration for downstream rollups
                            activity_record["processing_time_ms"] = duration_ms
                        except Exception:
                            # If parsing fails, still write the enriched fields we have
                            pass
                except Exception as e:
                    # Don't fail logging if enrichment fails; proceed with the base record
                    self.logger.warning(
                        f"Could not enrich COMPLETED job activity with duration for {job_id}: {e}"
                    )
            
            # Write to job_activity_logs container
            self.cosmos_db.job_activity_logs_container.create_item(body=activity_record)
            
            self.logger.info(f"Job activity logged: {activity_type} for job {job_id}")
            return True
            
        except CosmosHttpResponseError as e:
            self.logger.error(f"Failed to log job activity: {e.message}")
            return False
        except Exception as e:
            self.logger.error(f"Unexpected error logging job activity: {str(e)}")
            return False
    
    def log_blob_operation(self, blob_url: str, operation_type: str, job_id: str = None,
                          user_id: str = None, details: Dict[str, Any] = None) -> bool:
        """
        Log blob storage operation to blob_lifecycle_logs container
        
        Args:
            blob_url: URL of the blob
            operation_type: Type of operation (UPLOAD, DOWNLOAD, DELETE)
            job_id: Associated job ID if applicable
            user_id: User performing the operation
            details: Additional details about the operation
            
        Returns:
            bool: True if logged successfully, False otherwise
        """
        try:
            # Create partition key value (using date for distribution)
            current_date = datetime.now(timezone.utc).strftime('%Y-%m-%d')
            
            blob_record = {
                "id": str(uuid.uuid4()),
                "date": current_date,  # This is the partition key field for blob_lifecycle_logs
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "blob_url": blob_url,
                "operation_type": operation_type,
                "job_id": job_id,
                "user_id": user_id,
                "component": "backend_api",
                "details": details or {},
                "record_type": "blob_operation"
            }
            
            # Write to blob_lifecycle_logs container
            self.cosmos_db.blob_lifecycle_logs_container.create_item(body=blob_record)
            
            self.logger.info(f"Blob operation logged: {operation_type} for {blob_url}")
            return True
            
        except CosmosHttpResponseError as e:
            self.logger.error(f"Failed to log blob operation: {e.message}")
            return False
        except Exception as e:
            self.logger.error(f"Unexpected error logging blob operation: {str(e)}")
            return False
    
    def log_system_metric(self, metric_type: str, value: float, component: str,
                         severity: str = "INFO", details: Dict[str, Any] = None) -> bool:
        """
        Log system metric to system_metrics container
        
        Args:
            metric_type: Type of metric (PERFORMANCE, ERROR_RATE, MEMORY_USAGE)
            value: Numeric value of the metric
            component: Component generating the metric
            severity: Severity level (INFO, WARNING, ERROR)
            details: Additional metric details
            
        Returns:
            bool: True if logged successfully, False otherwise
        """
        try:
            metric_record = {
                "id": str(uuid.uuid4()),
                "partition_key": metric_type,  # Using metric_type for partition key
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "metric_type": metric_type,
                "value": value,
                "component": component,
                "severity": severity,
                "details": details or {},
                "record_type": "system_metric"
            }
            
            # Write to system_metrics container
            self.cosmos_db.system_metrics_container.create_item(body=metric_record)
            
            self.logger.debug(f"System metric logged: {metric_type} = {value}")
            return True
            
        except CosmosHttpResponseError as e:
            self.logger.error(f"Failed to log system metric: {e.message}")
            return False
        except Exception as e:
            self.logger.error(f"Unexpected error logging system metric: {str(e)}")
            return False
    
    def log_usage_analytics(self, user_id: str, event_type: str, job_id: str = None,
                           file_type: str = None, processing_status: str = None,
                           details: Dict[str, Any] = None) -> bool:
        """
        Log usage analytics to usage_analytics container
        
        Args:
            user_id: ID of the user
            event_type: Type of event (UPLOAD, TRANSCRIPTION, ANALYSIS, DOWNLOAD)
            job_id: Associated job ID if applicable
            file_type: Type of file being processed
            processing_status: Status of processing
            details: Additional analytics details
            
        Returns:
            bool: True if logged successfully, False otherwise
        """
        try:
            current_date = datetime.now(timezone.utc).strftime('%Y-%m-%d')
            
            analytics_record = {
                "id": str(uuid.uuid4()),
                "partition_key": user_id,  # Using user_id for partition key
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "date": current_date,
                "user_id": user_id,
                "event_type": event_type,
                "job_id": job_id,
                "file_type": file_type,
                "processing_status": processing_status,
                "component": "backend_api",
                "details": details or {},
                "record_type": "usage_analytics"
            }
            
            # Write to usage_analytics container
            self.cosmos_db.usage_analytics_container.create_item(body=analytics_record)
            
            self.logger.info(f"Usage analytics logged: {event_type} for user {user_id}")
            return True
            
        except CosmosHttpResponseError as e:
            self.logger.error(f"Failed to log usage analytics: {e.message}")
            return False
        except Exception as e:
            self.logger.error(f"Unexpected error logging usage analytics: {str(e)}")
            return False
    
    def get_user_audit_trail(self, user_id: str, limit: int = 100) -> list:
        """
        Retrieve audit trail for a specific user
        
        Args:
            user_id: ID of the user
            limit: Maximum number of records to return
            
        Returns:
            List of audit records for the user
        """
        try:
            query = """
                SELECT * FROM c 
                WHERE c.user_id = @user_id 
                ORDER BY c.timestamp DESC
                OFFSET 0 LIMIT @limit
            """
            
            parameters = [
                {"name": "@user_id", "value": user_id},
                {"name": "@limit", "value": limit}
            ]
            
            results = list(self.cosmos_db.audit_logs_container.query_items(
                query=query,
                parameters=parameters,
                enable_cross_partition_query=True
            ))
            
            return results
            
        except CosmosHttpResponseError as e:
            self.logger.error(f"Failed to retrieve user audit trail: {e.message}")
            return []
        except Exception as e:
            self.logger.error(f"Unexpected error retrieving audit trail: {str(e)}")
            return []
    
    def get_recent_user_audits(self, user_id: str, minutes: int = 5) -> list:
        """
        Retrieve recent audit records for a specific user within the specified timeframe
        
        Args:
            user_id: ID of the user
            minutes: Number of minutes back to search
            
        Returns:
            List of recent audit records for the user
        """
        try:
            from datetime import datetime, timezone, timedelta
            cutoff_time = datetime.now(timezone.utc) - timedelta(minutes=minutes)
            cutoff_iso = cutoff_time.isoformat()
            
            query = """
                SELECT * FROM c 
                WHERE c.user_id = @user_id 
                AND c.timestamp >= @cutoff_time
                ORDER BY c.timestamp DESC
            """
            
            parameters = [
                {"name": "@user_id", "value": user_id},
                {"name": "@cutoff_time", "value": cutoff_iso}
            ]
            
            results = list(self.cosmos_db.audit_logs_container.query_items(
                query=query,
                parameters=parameters,
                enable_cross_partition_query=True
            ))
            
            return results
            
        except CosmosHttpResponseError as e:
            self.logger.error(f"Failed to retrieve recent user audits: {e.message}")
            return []
        except Exception as e:
            self.logger.error(f"Unexpected error retrieving recent audits: {str(e)}")
            return []
    
    def get_job_activity_trail(self, job_id: str) -> list:
        """
        Retrieve complete activity trail for a specific job
        
        Args:
            job_id: ID of the job
            
        Returns:
            List of activity records for the job
        """
        try:
            query = """
                SELECT * FROM c 
                WHERE c.job_id = @job_id 
                ORDER BY c.timestamp ASC
            """
            
            parameters = [{"name": "@job_id", "value": job_id}]
            
            results = list(self.cosmos_db.job_activity_logs_container.query_items(
                query=query,
                parameters=parameters,
                partition_key=job_id
            ))
            
            return results
            
        except CosmosHttpResponseError as e:
            self.logger.error(f"Failed to retrieve job activity trail: {e.message}")
            return []
        except Exception as e:
            self.logger.error(f"Unexpected error retrieving job activity trail: {str(e)}")
            return []


class AuditLoggerMixin:
    """Enhanced mixin class that writes audit logs to Cosmos DB containers"""
    
    def __init__(self, cosmos_db_client, component_name: str = "backend_api"):
        """
        Initialize the audit logger mixin
        
        Args:
            cosmos_db_client: Instance of CosmosDB class from core.config
            component_name: Name of the component using this mixin
        """
        self.audit_service = CosmosAuditService(cosmos_db_client)
        self.component_name = component_name
        self.logger = logging.getLogger(__name__)
    
    def log_user_action(self, user_id: str, action_type: str, message: str = None,
                       resource_id: str = None, details: Dict[str, Any] = None,
                       request_info: Dict[str, Any] = None) -> bool:
        """
        Log user action with both console and Cosmos DB persistence
        
        Args:
            user_id: ID of the user performing the action
            action_type: Type of action being performed
            message: Optional descriptive message
            resource_id: ID of the resource being acted upon
            details: Additional details about the action
            request_info: Request information (IP, user agent, etc.)
            
        Returns:
            bool: True if logged successfully
        """
        # Log to console for immediate visibility
        if message:
            self.logger.info(f"User action: {action_type} by {user_id} - {message}")
        
        # Persist to Cosmos DB
        return self.audit_service.log_user_action(
            user_id=user_id,
            action_type=action_type,
            details=details,
            request_info=request_info,
            resource_id=resource_id
        )
    
    def log_job_activity(self, job_id: str, activity_type: str, status: str,
                        message: str = None, user_id: str = None,
                        details: Dict[str, Any] = None) -> bool:
        """
        Log job activity with both console and Cosmos DB persistence
        
        Args:
            job_id: ID of the job
            activity_type: Type of activity
            status: Current status
            message: Optional descriptive message
            user_id: Associated user ID
            details: Additional details
            
        Returns:
            bool: True if logged successfully
        """
        # Log to console for immediate visibility
        if message:
            self.logger.info(f"Job activity: {activity_type} for {job_id} - {message}")
        
        # Persist to Cosmos DB
        return self.audit_service.log_job_activity(
            job_id=job_id,
            activity_type=activity_type,
            status=status,
            details=details,
            user_id=user_id
        )
    
    def log_usage_analytics(self, user_id: str, event_type: str, **kwargs) -> bool:
        """
        Log usage analytics event
        
        Args:
            user_id: ID of the user
            event_type: Type of event
            **kwargs: Additional analytics data
            
        Returns:
            bool: True if logged successfully
        """
        return self.audit_service.log_usage_analytics(
            user_id=user_id,
            event_type=event_type,
            **kwargs
        )
