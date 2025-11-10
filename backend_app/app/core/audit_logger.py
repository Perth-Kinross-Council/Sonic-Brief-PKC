"""
Simple, centralized audit logger for Sonic Brief
Just logs actions to Cosmos DB - no complexity
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, Optional


class AuditLogger:
    """Simple audit logger - just write to Cosmos DB"""
    
    def __init__(self, cosmos_db):
        self.cosmos_db = cosmos_db
        self.logger = logging.getLogger(__name__)
    
    def log_action(self, user_id: str, action: str, details: Optional[Dict[str, Any]] = None) -> bool:
        """
        Log any user action to audit trail
        
        Args:
            user_id: ID of user performing action
            action: What they did (LOGIN, LOGOUT, CREATE_JOB, etc.)
            details: Any additional info
            
        Returns:
            bool: True if logged successfully
        """
        try:
            record = {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "action": action,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "details": details or {}
            }
            
            self.cosmos_db.audit_logs_container.create_item(body=record)
            self.logger.info(f"AUDIT: {action} by {user_id}")
            return True
            
        except Exception as e:
            self.logger.error(f"AUDIT FAILED: {action} by {user_id} - {e}")
            return False
    
    def log_login(self, user_id: str, user_email: str, auth_method: str = "unknown") -> bool:
        """Log user login"""
        return self.log_action(
            user_id=user_id,
            action="LOGIN",
            details={
                "email": user_email,
                "auth_method": auth_method
            }
        )
    
    def log_logout(self, user_id: str, user_email: str) -> bool:
        """Log user logout"""
        return self.log_action(
            user_id=user_id,
            action="LOGOUT",
            details={
                "email": user_email
            }
        )
    
    def log_job_created(self, user_id: str, job_id: str, job_type: str) -> bool:
        """Log job creation"""
        return self.log_action(
            user_id=user_id,
            action="JOB_CREATED",
            details={
                "job_id": job_id,
                "job_type": job_type
            }
        )
    
    def log_job_completed(self, user_id: str, job_id: str) -> bool:
        """Log job completion"""
        return self.log_action(
            user_id=user_id,
            action="JOB_COMPLETED",
            details={
                "job_id": job_id
            }
        )
