from typing import Dict, Any, Optional
from datetime import datetime
import logging
from azure.cosmos import CosmosClient
from config import AppConfig
from azure.identity import DefaultAzureCredential, ManagedIdentityCredential
import os
import urllib.parse
import html

logger = logging.getLogger(__name__)


def normalize_blob_url(blob_url: str) -> str:
    """Normalize blob URL by unescaping HTML entities, URL decoding, and replacing spaces"""
    url = html.unescape(blob_url)
    url = urllib.parse.unquote(url)
    url = url.replace(' ', '_')
    url = urllib.parse.unquote(url)
    return url


class CosmosService:
    def __init__(self, config: AppConfig):
        # Use System Assigned Managed Identity for Azure Functions
        # Do not confuse AZURE_CLIENT_ID (Entra ID App Registration) with Managed Identity
        credential = ManagedIdentityCredential(logging_enable=True)
            
        self.config = config
        self.client = CosmosClient(url=config.cosmos_endpoint, credential=credential)
        self.database = self.client.get_database_client(config.cosmos_database)
        self.jobs_container = self.database.get_container_client(
            config.cosmos_jobs_container
        )
        self.prompts_container = self.database.get_container_client(
            config.cosmos_prompts_container
        )
        # Optional audit containers (best-effort; function should still run if missing)
        try:
            self.audit_logs_container = self.database.get_container_client(config.audit_logs_container)
        except Exception:
            self.audit_logs_container = None
            logger.debug("audit_logs container not available to Function (non-fatal)", exc_info=True)
        try:
            self.job_activity_logs_container = self.database.get_container_client(config.job_activity_logs_container)
        except Exception:
            self.job_activity_logs_container = None
            logger.debug("job_activity_logs container not available to Function (non-fatal)", exc_info=True)
        try:
            self.usage_analytics_container = self.database.get_container_client(config.usage_analytics_container)
        except Exception:
            self.usage_analytics_container = None
            logger.debug("usage_analytics container not available to Function (non-fatal)", exc_info=True)

    def update_job(self, job: Dict[str, Any]) -> Dict[str, Any]:
        """Upsert the provided job document back into the jobs container.

        This is used by SimpleAuditLogger to persist audit trail and metrics.
        """
        try:
            if not job or not isinstance(job, dict):
                raise ValueError("Invalid job payload for update")
            if not job.get("id"):
                raise ValueError("Job must include an 'id' for update")
            # maintain updated_at timestamp
            job["updated_at"] = datetime.utcnow().isoformat()
            return self.jobs_container.upsert_item(body=job)
        except Exception as e:
            logger.error(f"Error updating job: {str(e)}")
            raise

    def get_file_by_blob_url(self, blob_url: str) -> Optional[Dict[str, Any]]:
        """Get file document by blob URL with URL normalization"""
        logger.info(f"Searching for file with blob URL: {blob_url}")
        normalized_url = normalize_blob_url(blob_url)
        query = "SELECT * FROM c WHERE c.file_path = @file_path"
        files = list(
            self.jobs_container.query_items(
                query=query,
                parameters=[{"name": "@file_path", "value": normalized_url}],
                enable_cross_partition_query=True,
            )
        )
        logger.info(f"Found {len(files)} files matching blob URL")
        if files:
            logger.info(f"Found file document: {files[0].get('id', 'unknown')}")
        return files[0] if files else None

    def get_file_by_analysis_path(self, analysis_blob_url: str) -> Optional[Dict[str, Any]]:
        """Get job document by analysis_file_path"""
        logger.info(f"Searching for file with analysis path: {analysis_blob_url}")
        normalized_url = normalize_blob_url(analysis_blob_url)
        query = "SELECT * FROM c WHERE c.analysis_file_path = @analysis_file_path"
        files = list(
            self.jobs_container.query_items(
                query=query,
                parameters=[{"name": "@analysis_file_path", "value": normalized_url}],
                enable_cross_partition_query=True,
            )
        )
        logger.info(f"Found {len(files)} files matching analysis path")
        return files[0] if files else None

    def get_file_by_transcription_path(self, transcription_blob_url: str) -> Optional[Dict[str, Any]]:
        """Get job document by transcription_file_path"""
        logger.info(f"Searching for file with transcription path: {transcription_blob_url}")
        normalized_url = normalize_blob_url(transcription_blob_url)
        query = "SELECT * FROM c WHERE c.transcription_file_path = @transcription_file_path"
        files = list(
            self.jobs_container.query_items(
                query=query,
                parameters=[{"name": "@transcription_file_path", "value": normalized_url}],
                enable_cross_partition_query=True,
            )
        )
        logger.info(f"Found {len(files)} files matching transcription path")
        return files[0] if files else None

    def get_job_by_id(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Get job by ID"""
        job = self.jobs_container.read_item(item=job_id, partition_key=job_id)
        return job if job else None

    def update_job_status(self, job_id: str, status: str, **kwargs) -> Dict[str, Any]:
        """Update job status and additional fields"""
        try:
            job = self.get_job_by_id(job_id)
            if not job:
                raise ValueError(f"Job not found: {job_id}")

            updates = {
                "status": status,
                "updated_at": datetime.utcnow().isoformat(),
                **kwargs,
            }
            job.update(updates)
            return self.jobs_container.upsert_item(body=job)
        except Exception as e:
            logger.error(f"Error updating job status: {str(e)}")
            raise

    def get_prompts(self, subcategory_id: str, excluded_title: str = None) -> Dict[str, Any]:
        """Get prompts for a subcategory, optionally excluding a specific title (OWD approach: always return full dictionary)"""
        try:
            query = """
                SELECT * FROM c 
                WHERE c.type = 'prompt_subcategory' 
                AND c.id = @subcategory_id
            """
            prompts = list(
                self.prompts_container.query_items(
                    query=query,
                    parameters=[{"name": "@subcategory_id", "value": subcategory_id}],
                    enable_cross_partition_query=True,
                )
            )

            if not prompts:
                raise ValueError(f"No prompts found for subcategory: {subcategory_id}")

            prompt_data = prompts[0].get("prompts", {})
            if not prompt_data:
                raise ValueError("No prompts found in subcategory")

            # OWD: Always return full dictionary, with optional filtering
            if excluded_title:
                filtered_prompts = {k: v for k, v in prompt_data.items() if k.lower() != excluded_title.lower()}
                if not filtered_prompts:
                    raise ValueError(f"No prompts found after excluding title: {excluded_title}")
                return filtered_prompts
            else:
                return prompt_data
        except Exception as e:
            logger.error(f"Error retrieving prompts: {str(e)}")
            raise

    def create_job(self, job_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new job document in jobs container"""
        try:
            # Ensure job has required type field
            job_data["type"] = "job"
            
            # Add timestamps if not present
            if "created_at" not in job_data:
                job_data["created_at"] = datetime.utcnow().isoformat()
            if "updated_at" not in job_data:
                job_data["updated_at"] = datetime.utcnow().isoformat()
            
            logger.info(f"Creating new job with ID: {job_data.get('id', 'unknown')}")
            return self.jobs_container.create_item(body=job_data)
        except Exception as e:
            logger.error(f"Error creating job: {str(e)}")
            raise
