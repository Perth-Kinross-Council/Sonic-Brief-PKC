from datetime import datetime, timezone
import json
from typing import Dict, Any, Optional
from fastapi import (
    APIRouter,
    HTTPException,
    Depends,
    status,
    File,
    UploadFile,
    Query,
    Form,
)
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
import tempfile
import os
from urllib.parse import urlparse
import asyncio
import time

from app.core.config import AppConfig, CosmosDB, DatabaseError
from app.services.storage_service import StorageService
from app.services.cached_user_service import AzureCachedUserService
from app.services.cosmos_audit_service import CosmosAuditService
from app.routers.auth import get_current_user_any
from app.utils import normalize_blob_url
import logging
import traceback
from azure.core.exceptions import AzureError, ServiceRequestError
from azure.identity import CredentialUnavailableError
from app.core.dependencies import get_cosmos_db, get_cached_user_service
import os

# Setup logging
logger = logging.getLogger(__name__)
# Honor env-driven log level; default INFO
_lvl = getattr(logging, os.getenv("BACKEND_LOG_LEVEL", "INFO").upper(), logging.INFO)
logger.setLevel(_lvl)
router = APIRouter()

# Global instances for connection reuse
_config_instance = None
_cosmos_instance = None
_storage_instance = None
_last_init_time = None
_init_lock = asyncio.Lock()

# Cache TTL in seconds (5 minutes)
CACHE_TTL = 300


async def get_shared_config() -> AppConfig:
    """Get shared AppConfig instance with caching and error recovery"""
    global _config_instance, _last_init_time

    async with _init_lock:
        current_time = time.time()
        # Initialize or refresh if cache expired
        if (_config_instance is None or
            _last_init_time is None or
            current_time - _last_init_time > CACHE_TTL):

            try:
                logger.debug("Initializing/refreshing AppConfig instance")
                _config_instance = AppConfig()
                _last_init_time = current_time
                logger.debug("AppConfig instance initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize AppConfig: {str(e)}")
                if _config_instance is None:  # Only raise if no fallback
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="Configuration service temporarily unavailable"
                    )
                logger.warning("Using cached AppConfig instance due to refresh failure")

        return _config_instance

## Removed legacy POST /jobs/{job_id}/view endpoints.
## View auditing is now handled by GET /upload/jobs with the `view=true` flag.


async def get_shared_cosmos(config: AppConfig) -> CosmosDB:
    """Get shared CosmosDB instance with retry logic"""
    global _cosmos_instance

    if _cosmos_instance is None:
        max_retries = 3
        retry_delay = 1

        for attempt in range(max_retries):
            try:
                logger.debug(f"Initializing CosmosDB client (attempt {attempt + 1})")
                _cosmos_instance = CosmosDB(config)
                logger.debug("CosmosDB client initialized successfully")
                break
            except DatabaseError as e:
                logger.error(f"Database initialization failed (attempt {attempt + 1}): {str(e)}")
                if attempt == max_retries - 1:
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="Database service temporarily unavailable"
                    )
                await asyncio.sleep(retry_delay * (2 ** attempt))  # Exponential backoff
            except Exception as e:
                logger.error(f"Unexpected error initializing CosmosDB: {str(e)}")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Internal server error during database initialization"
                )

    return _cosmos_instance


async def get_shared_storage(config: AppConfig) -> StorageService:
    """Get shared StorageService instance with retry logic"""
    global _storage_instance

    if _storage_instance is None:
        max_retries = 3
        retry_delay = 1

        for attempt in range(max_retries):
            try:
                logger.debug(f"Initializing StorageService (attempt {attempt + 1})")
                _storage_instance = StorageService(config)
                logger.debug("StorageService initialized successfully")
                break
            except (CredentialUnavailableError, ServiceRequestError) as e:
                logger.error(f"Storage service initialization failed (attempt {attempt + 1}): {str(e)}")
                if attempt == max_retries - 1:
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="Storage service authentication failed - please check managed identity configuration"
                    )
                await asyncio.sleep(retry_delay * (2 ** attempt))
            except Exception as e:
                logger.error(f"Unexpected error initializing StorageService: {str(e)}")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Internal server error during storage initialization"
                )

    return _storage_instance


@router.post("/upload")
@router.post("")  # Alias: allows POST /upload as well as /upload/upload
async def upload_file(
    file: UploadFile = File(...),
    prompt_category_id: str = Form(None),
    prompt_subcategory_id: str = Form(None),
    case_id: Optional[str] = Form(None),
    recorded: Optional[bool] = Form(False),
    current_user: Dict[str, Any] = Depends(get_current_user_any),
) -> Dict[str, Any]:
    """
    Upload a file to Azure Blob Storage and create a job record.

    Args:
        file: The file to upload
        prompt_category_id: Category ID for the prompt
        prompt_subcategory_id: Subcategory ID for the prompt
        case_id: Optional case identifier for grouping related uploads
        current_user: Authenticated user from token

    Returns:
        Dict containing job ID and status
    """
    start_time = time.time()
    # If the caller is a service principal (app-only), enforce configured upload role
    if current_user.get("auth_type") == "entra_app":
        roles = current_user.get("roles", []) or []
        # Lazy-load config to obtain role requirement
        config = await get_shared_config()
        required_role = getattr(config, "sp_upload_role", "ndluploader")
        if required_role not in roles:
            logger.warning(f"[UPLOAD] App-only caller missing required role '{required_role}'. Roles: {roles}")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"App identity lacks required role: {required_role}")
    logger.info(f"Upload request started for user {current_user.get('id')} with file {file.filename} (case_id: {case_id})")

    # Validate required parameters
    if not prompt_category_id or not prompt_subcategory_id:
        logger.warning(f"Missing required parameters - category_id: {prompt_category_id}, subcategory_id: {prompt_subcategory_id}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Category and Subcategory IDs are required"
        )

    # Validate file size (limit to 100MB for now)
    if file.size and file.size > 100 * 1024 * 1024:
        logger.warning(f"File too large: {file.size} bytes")
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File size exceeds 100MB limit"
        )

    temp_file_path = None
    try:
        # Get shared instances
        config = await get_shared_config()
        cosmos_db = await get_shared_cosmos(config)
        storage_service = await get_shared_storage(config)

        logger.debug(f"Initialization time: {time.time() - start_time:.2f}s")

        # Validate prompt category and subcategory
        validation_start = time.time()
        await validate_prompt_categories(cosmos_db, prompt_category_id, prompt_subcategory_id)
        logger.debug(f"Validation time: {time.time() - validation_start:.2f}s")

        # Upload file to storage
        upload_start = time.time()
        temp_file_path = await save_temp_file(file)
        blob_url = await upload_to_storage(storage_service, temp_file_path, file.filename, case_id)
        logger.debug(f"Upload time: {time.time() - upload_start:.2f}s")

        # Determine file extension and set job status accordingly
        _, file_ext = os.path.splitext(file.filename)
        file_ext = file_ext.lower()
        # Get supported audio extensions from config (handle both set and list)
        supported_audio_exts = set()
        if hasattr(config, 'supported_audio_extensions'):
            supported_audio_exts = set(config.supported_audio_extensions)
        elif hasattr(config, 'storage') and hasattr(config.storage, 'supported_audio_extensions'):
            supported_audio_exts = set(config.storage.supported_audio_extensions)
        # Default fallback
        if not supported_audio_exts:
            supported_audio_exts = {'.wav', '.mp3', '.ogg', '.opus', '.flac', '.alaw', '.mulaw', '.mp4', '.wma', '.aac', '.amr', '.webm', '.m4a', '.spx', '.pcm'}

        if file_ext == '.txt':
            job_status = 'transcribed'  # transcript upload, skip transcription
        elif file_ext in supported_audio_exts:
            job_status = 'uploaded'     # audio upload, triggers transcription
        else:
            logger.warning(f"Unsupported file extension: {file_ext}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported file extension: {file_ext}"
            )

        # Create job record with correct status
        job_start = time.time()
        job_id = await create_job_record(
            cosmos_db, current_user, blob_url, prompt_category_id, prompt_subcategory_id, case_id, job_status,
            ingestion_source="web_ui"
        )
        logger.debug(f"Job creation time: {time.time() - job_start:.2f}s")

        # Audit: Audio uploaded or recorded (only for audio uploads; transcript handled separately)
        try:
            if job_status == 'uploaded':
                audit_service = CosmosAuditService(cosmos_db)
                audit_details = {
                    "filename": file.filename,
                    "file_ext": file_ext,
                    "file_size_bytes": getattr(file, "size", None),
                    "prompt_category_id": prompt_category_id,
                    "prompt_subcategory_id": prompt_subcategory_id,
                    "case_id": case_id,
                    "job_status": job_status,
                    "recorded": bool(recorded),
                    "ingestion_source": "web_ui",
                }
                audit_service.log_user_action(
                    user_id=current_user.get("id"),
                    action_type=("Audio recorded" if recorded else "Audio uploaded"),
                    resource_id=job_id,
                    details=audit_details,
                )
            elif job_status == 'transcribed':
                # Transcript uploaded via .txt file path
                audit_service = CosmosAuditService(cosmos_db)
                audit_details = {
                    "filename": file.filename,
                    "file_ext": file_ext,
                    "prompt_category_id": prompt_category_id,
                    "prompt_subcategory_id": prompt_subcategory_id,
                    "case_id": case_id,
                    "job_status": job_status,
                    "ingestion_source": "web_ui",
                }
                audit_service.log_user_action(
                    user_id=current_user.get("id"),
                    action_type="Transcript uploaded",
                    resource_id=job_id,
                    details=audit_details,
                )
        except Exception:
            # Best-effort audit: never fail the request due to audit logging issues
            logger.debug("Audit log (Audio uploaded) skipped due to error", exc_info=True)

        total_time = time.time() - start_time
        logger.info(f"Upload completed successfully in {total_time:.2f}s - Job ID: {job_id}")

        response_data = {
            "job_id": job_id,
            "status": job_status,
            "message": "File uploaded successfully",
            "prompt_category_id": prompt_category_id,
            "prompt_subcategory_id": prompt_subcategory_id,
        }

        # Include case_id in response if provided
        if case_id:
            response_data["case_id"] = case_id

        return response_data

    except HTTPException:
        # Re-raise HTTP exceptions (they have proper status codes)
        raise
    except Exception as e:
        logger.error(f"Unexpected error during upload: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred during file upload"
        )
    finally:
        # Clean up temporary file
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.unlink(temp_file_path)
                logger.debug("Temporary file cleaned up")
            except Exception as e:
                logger.warning(f"Failed to clean up temporary file: {str(e)}")


async def validate_prompt_categories(cosmos_db: CosmosDB, category_id: str, subcategory_id: str):
    """Validate prompt category and subcategory exist"""
    try:
        # Validate category
        category_query = "SELECT * FROM c WHERE c.type = 'prompt_category' AND c.id = @id"
        categories = list(
            cosmos_db.prompts_container.query_items(
                query=category_query,
                parameters=[{"name": "@id", "value": category_id}],
                enable_cross_partition_query=True,
            )
        )
        if not categories:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid prompt_category_id: {category_id}"
            )

        # Validate subcategory
        subcategory_query = """
            SELECT * FROM c
            WHERE c.type = 'prompt_subcategory'
            AND c.id = @id
            AND c.category_id = @category_id
        """
        subcategories = list(
            cosmos_db.prompts_container.query_items(
                query=subcategory_query,
                parameters=[
                    {"name": "@id", "value": subcategory_id},
                    {"name": "@category_id", "value": category_id},
                ],
                enable_cross_partition_query=True,
            )
        )
        if not subcategories:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid prompt_subcategory_id: {subcategory_id} for category: {category_id}"
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error validating prompt categories: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error validating prompt categories"
        )


async def save_temp_file(file: UploadFile) -> str:
    """Save uploaded file to temporary location"""
    try:
        with tempfile.NamedTemporaryFile(
            delete=False, suffix=os.path.splitext(file.filename)[1]
        ) as temp_file:
            content = await file.read()
            temp_file.write(content)
            return temp_file.name
    except Exception as e:
        logger.error(f"Error saving temporary file: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing uploaded file"
        )


async def upload_to_storage(storage_service: StorageService, file_path: str, filename: str, case_id: Optional[str] = None) -> str:
    """Upload file to Azure Blob Storage with retry logic and OWD naming convention"""
    max_retries = 3
    retry_delay = 1

    for attempt in range(max_retries):
        try:
            blob_url = storage_service.upload_file(file_path, filename, case_id)
            logger.debug(f"File uploaded to blob storage: {blob_url}")
            return blob_url
        except (AzureError, CredentialUnavailableError) as e:
            logger.error(f"Storage upload failed (attempt {attempt + 1}): {str(e)}")
            if attempt == max_retries - 1:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Storage service temporarily unavailable"
                )
            await asyncio.sleep(retry_delay * (2 ** attempt))
        except Exception as e:
            logger.error(f"Unexpected error uploading file: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error uploading file to storage"
            )


async def create_job_record(cosmos_db: CosmosDB, current_user: Dict, blob_url: str,
                          category_id: str, subcategory_id: str, case_id: Optional[str] = None, status: str = "uploaded",
                          ingestion_source: str = "web_ui") -> str:
    """Create job record in CosmosDB with retry logic"""
    timestamp = int(datetime.now(timezone.utc).timestamp() * 1000)
    job_id = f"job_{timestamp}"
    job_data = {
        "id": job_id,
        "type": "job",
        "user_id": current_user["id"],
        "file_path": blob_url,
        "transcription_file_path": None,
        "analysis_file_path": None,
        "prompt_category_id": category_id,
        "prompt_subcategory_id": subcategory_id,
        "status": status,
        "transcription_id": None,
        "created_at": timestamp,
        "updated_at": timestamp,
    # New field to differentiate ingestion channel
    "ingestion_source": ingestion_source,
    }

    # Add case_id if provided
    if case_id:
        job_data["case_id"] = case_id

    max_retries = 3
    retry_delay = 1

    for attempt in range(max_retries):
        try:
            job = cosmos_db.create_job(job_data)
            return job_id
        except Exception as e:
            logger.error(f"Job creation failed (attempt {attempt + 1}): {str(e)}")
            if attempt == max_retries - 1:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Database service temporarily unavailable"
                )
            await asyncio.sleep(retry_delay * (2 ** attempt))


@router.get("/jobs")
async def get_jobs(
    job_id: Optional[str] = Query(None, description="Filter by job ID"),
    status: Optional[str] = Query(None, description="Filter by job status"),
    file_path: Optional[str] = Query(None, description="Filter by file path"),
    created_at: Optional[str] = Query(
        None, description="Filter by creation date in YYYY-MM-DD format"
    ),
    prompt_subcategory_id: Optional[str] = Query(
        None, description="Filter by prompt subcategory ID"
    ),
    case_id: Optional[str] = Query(None, description="Filter by case ID"),
    ingestion_source: Optional[str] = Query(None, description="Filter by ingestion source (e.g. web_ui, mobile_sara_notes)"),
    view: bool = Query(False, description="If true and job_id provided, log a 'JOB_VIEWED' audit event"),
    download: bool = Query(False, description="If true, log '... downloaded' for returned SAS links"),
    download_resource: Optional[str] = Query(
        None,
        description="When logging downloads, limit audit to a specific resource: 'audio' or 'analysis'. Defaults to all when not provided.",
    ),
    current_user: Dict[str, Any] = Depends(get_current_user_any),
) -> Dict[str, Any]:
    """
    Get job details with optional filters.

    Args:
        job_id: Filter by job ID
        status: Filter by job status
        file_path: Filter by file path
        created_at: Filter by creation date (YYYY-MM-DD)
        prompt_subcategory_id: Filter by prompt subcategory ID
        case_id: Filter by case ID
        current_user: Authenticated user from token

    Returns:
        Dict containing jobs and status
    """
    start_time = time.time()
    # If the caller is a service principal (app-only), enforce configured upload role
    if current_user.get("auth_type") == "entra_app":
        roles = current_user.get("roles", []) or []
        config = await get_shared_config()
        required_role = getattr(config, "sp_upload_role", "ndluploader")
        if required_role not in roles:
            logger.warning(f"[JOBS] App-only caller missing required role '{required_role}'. Roles: {roles}")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"App identity lacks required role: {required_role}")
    logger.info(f"Jobs query started for user {current_user.get('id')} (case_id: {case_id})")

    try:
        # Get shared instances
        config = await get_shared_config()
        cosmos_db = await get_shared_cosmos(config)
        storage_service = await get_shared_storage(config)

        # Build query
        query = "SELECT * FROM c WHERE c.type = 'job'"
        parameters = []

        if job_id:
            query += " AND c.id = @job_id"
            parameters.append({"name": "@job_id", "value": job_id})

        if status:
            query += " AND c.status = @status"
            parameters.append({"name": "@status", "value": status})

        if file_path:
            query += " AND c.file_path = @file_path"
            parameters.append({"name": "@file_path", "value": file_path})

        if created_at:
            try:
                parsed_date = datetime.strptime(created_at, "%Y-%m-%d").date()
                # Convert date to start and end of day timestamps
                start_of_day = int(
                    datetime.combine(parsed_date, datetime.min.time())
                    .replace(tzinfo=timezone.utc)
                    .timestamp()
                    * 1000
                )
                end_of_day = int(
                    datetime.combine(parsed_date, datetime.max.time())
                    .replace(tzinfo=timezone.utc)
                    .timestamp()
                    * 1000
                )
                query += (
                    " AND c.created_at >= @start_date AND c.created_at <= @end_date"
                )
                parameters.extend(
                    [
                        {"name": "@start_date", "value": start_of_day},
                        {"name": "@end_date", "value": end_of_day},
                    ]
                )
            except ValueError:
                logger.warning(f"Invalid created_at format: {created_at}")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid created_at date. Expected format: YYYY-MM-DD."
                )

        if prompt_subcategory_id:
            query += " AND c.prompt_subcategory_id = @subcategory"
            parameters.append({"name": "@subcategory", "value": prompt_subcategory_id})

        if ingestion_source:
            query += " AND c.ingestion_source = @ingestion_source"
            parameters.append({"name": "@ingestion_source", "value": ingestion_source})

        if case_id:
            query += " AND c.case_id = @case_id"
            parameters.append({"name": "@case_id", "value": case_id})

        # Add user filter for security
        query += " AND c.user_id = @user_id"
        parameters.append({"name": "@user_id", "value": current_user["id"]})

        # Execute query with retry logic
        query_start = time.time()
        jobs = await execute_jobs_query(cosmos_db, query, parameters)
        logger.debug(f"Query execution time: {time.time() - query_start:.2f}s")

    # Add SAS tokens to file paths
        sas_start = time.time()
        for job in jobs:
            if job.get("file_path"):
                # Extract file name from the file path before adding SAS token
                file_path = job["file_path"]
                path_parts = urlparse(file_path).path.strip("/").split("/")
                job["file_name"] = path_parts[-1] if path_parts else None
                job["file_path"] = storage_service.add_sas_token_to_url(file_path)
                if download and (download_resource is None or str(download_resource).lower() in ("", "all", "audio")):
                    try:
                        base_url = file_path.split('?', 1)[0]
                        audit_service = CosmosAuditService(cosmos_db)
                        audit_service.log_user_action(
                            user_id=current_user.get("id"),
                            action_type="Audio downloaded",
                            resource_id=job.get("id"),
                            details={
                                "resource": "audio",
                                "file_name": job.get("file_name"),
                                "blob_url": base_url,
                                "via": "sas",
                            },
                        )
                    except Exception:
                        logger.debug("Audit log (Audio downloaded) skipped due to error", exc_info=True)

                # Only add SAS tokens to non-null paths
                if job.get("transcription_file_path"):
                    original_url = job["transcription_file_path"]
                    job["transcription_file_path"] = storage_service.add_sas_token_to_url(original_url)
                if job.get("analysis_file_path"):
                    original_url = job["analysis_file_path"]
                    job["analysis_file_path"] = storage_service.add_sas_token_to_url(original_url)
                    if download and (download_resource is None or str(download_resource).lower() in ("", "all", "analysis")):
                        try:
                            base_url = original_url.split('?', 1)[0]
                            a_parts = urlparse(base_url).path.strip('/').split('/')
                            a_name = a_parts[-1] if a_parts else None
                            audit_service = CosmosAuditService(cosmos_db)
                            audit_service.log_user_action(
                                user_id=current_user.get("id"),
                                action_type="Analysis downloaded",
                                resource_id=job.get("id"),
                                details={
                                    "resource": "analysis",
                                    "file_name": a_name,
                                    "blob_url": base_url,
                                    "via": "sas",
                                },
                            )
                        except Exception:
                            logger.debug("Audit log (Analysis downloaded) skipped due to error", exc_info=True)

        logger.debug(f"SAS token generation time: {time.time() - sas_start:.2f}s")

        # Optional: log a 'JOB_VIEWED' audit event when explicitly requested (admin views included)
        try:
            if view and job_id:
                audit_service = CosmosAuditService(cosmos_db)
                audit_service.log_user_action(
                    user_id=current_user.get("id"),
                    action_type="JOB_VIEWED",
                    resource_id=job_id,
                    details={
                        "via": "jobs_endpoint",
                        "reason": "details_view",
                    },
                )
        except Exception:
            # Best-effort; never fail the request due to audit
            logger.debug("Audit log (JOB_VIEWED) skipped due to error", exc_info=True)

        total_time = time.time() - start_time
        logger.info(f"Jobs query completed in {total_time:.2f}s - Found {len(jobs)} jobs")

        return {
            "status": 200,
            "message": "Jobs retrieved successfully",
            "count": len(jobs),
            "jobs": jobs,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error retrieving jobs: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while retrieving jobs"
        )


async def execute_jobs_query(cosmos_db: CosmosDB, query: str, parameters: list) -> list:
    """Execute jobs query with retry logic"""
    max_retries = 3
    retry_delay = 1

    for attempt in range(max_retries):
        try:
            jobs = list(
                cosmos_db.jobs_container.query_items(
                    query=query,
                    parameters=parameters,
                    enable_cross_partition_query=True,
                )
            )
            return jobs
        except Exception as e:
            logger.error(f"Jobs query failed (attempt {attempt + 1}): {str(e)}")
            if attempt == max_retries - 1:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Database service temporarily unavailable"
                )
            await asyncio.sleep(retry_delay * (2 ** attempt))


@router.get("/jobs/transcription/{job_id}")
async def get_job_transcription(
    job_id: str,
    download: bool = Query(False, description="If true, return as attachment and audit as 'Transcript downloaded'"),
    current_user: Dict[str, Any] = Depends(get_current_user_any),
) -> StreamingResponse:
    """
    Stream the transcription file content for a specific job.

    Args:
        job_id: The ID of the job
        current_user: Authenticated user from token

    Returns:
        StreamingResponse containing the transcription file content
    """
    request_id = f"transcription_req_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}_{job_id[:8]}"
    logger.info(
        f"[{request_id}] Transcription request received for job_id: {job_id} by user: {current_user.get('username')}"
    )

    try:
        config = await get_shared_config()
        cosmos_db = await get_shared_cosmos(config)
        logger.debug(
            f"[{request_id}] AppConfig and CosmosDB initialized via shared async. Environment: {config.environment if hasattr(config, 'environment') else 'not specified'}"
        )
        logger.debug(f"[{request_id}] Initializing StorageService for job: {job_id}")
        storage_service = await get_shared_storage(config)
        logger.debug(
            f"[{request_id}] StorageService initialized successfully. Account: {storage_service.account_name if hasattr(storage_service, 'account_name') else 'unknown'}"
        )
    except DatabaseError as e:
        error_details = str(e)
        logger.error(
            f"[{request_id}] Database initialization failed: {error_details}",
            exc_info=True,
        )
        logger.error(f"[{request_id}] Stack trace: {traceback.format_exc()}")
        raise HTTPException(status_code=503, detail="Database service unavailable")
    except Exception as e:
        error_details = str(e)
        logger.error(
            f"[{request_id}] Service initialization error: {error_details}",
            exc_info=True,
        )
        logger.error(f"[{request_id}] Stack trace: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail="Error initializing services")

    # Query the job with proper error handling
    try:
        # Build query to get the specific job
        query = "SELECT * FROM c WHERE c.type = 'job' AND c.id = @job_id"
        parameters = [{"name": "@job_id", "value": job_id}]

        logger.info(f"[{request_id}] Querying CosmosDB for job_id: {job_id}")
        logger.debug(
            f"[{request_id}] Query: {query}, Parameters: {json.dumps(parameters)}"
        )

        start_time = datetime.now(timezone.utc)
        jobs = list(
            cosmos_db.jobs_container.query_items(
                query=query,
                parameters=parameters,
                enable_cross_partition_query=True,
            )
        )
        query_duration = (datetime.now(timezone.utc) - start_time).total_seconds()
        logger.debug(
            f"[{request_id}] CosmosDB query completed in {query_duration:.3f} seconds"
        )

        if not jobs:
            logger.warning(f"[{request_id}] Job not found in database: {job_id}")
            raise HTTPException(status_code=404, detail="Job not found")

        job = jobs[0]
        logger.debug(
            f"[{request_id}] Job retrieved successfully. Job status: {job.get('status', 'unknown')}, Created: {job.get('created_at', 'unknown')}"
        )

        # Log job metadata for debugging (redacting sensitive information)
        safe_job_metadata = {
            k: v
            for k, v in job.items()
            if k not in ("user_details", "auth_token", "api_key", "password")
        }
        logger.debug(
            f"[{request_id}] Job metadata: {json.dumps(safe_job_metadata, default=str)}"
        )

        # Check if transcription exists
        if not job.get("transcription_file_path"):
            logger.warning(
                f"[{request_id}] Transcription file path not found for job: {job_id}"
            )
            raise HTTPException(
                status_code=404, detail="Transcription not available for this job"
            )

        logger.info(
            f"[{request_id}] Found transcription file path: {job.get('transcription_file_path')}"
        )
    except HTTPException:
        # Re-raise HTTP exceptions without additional logging (already logged above)
        raise
    except Exception as e:
        error_details = str(e)
        logger.error(
            f"[{request_id}] Error retrieving job: {error_details}", exc_info=True
        )
        logger.error(f"[{request_id}] Stack trace: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail="Error retrieving job information")

    # Stream the content
    try:
        # Get the blob URL
        transcription_url = job["transcription_file_path"]
        logger.info(
            f"[{request_id}] Preparing to stream transcription from: {transcription_url}"
        )

        # Extract file name for the content-disposition header
        path_parts = urlparse(transcription_url).path.strip("/").split("/")
        file_name = path_parts[-1] if path_parts else "transcription.txt"
        logger.debug(f"[{request_id}] Extracted file name: {file_name} from URL path")

        # Determine content type based on file extension
        content_type = "text/plain"  # Default
        if file_name.endswith(".json"):
            content_type = "application/json"
        elif file_name.endswith(".xml"):
            content_type = "application/xml"
        logger.debug(f"[{request_id}] Content type determined as: {content_type}")

        # Stream the blob content
        logger.info(f"[{request_id}] Initiating blob streaming from Storage Service")
        start_time = datetime.now(timezone.utc)
        content_stream = storage_service.stream_blob_content(transcription_url)
        logger.debug(
            f"[{request_id}] Storage service returned stream handle in {(datetime.now(timezone.utc) - start_time).total_seconds():.3f} seconds"
        )

        # Audit only when explicitly downloading
        if download:
            try:
                base_url = transcription_url.split('?', 1)[0]
                audit_service = CosmosAuditService(cosmos_db)
                audit_service.log_user_action(
                    user_id=current_user.get("id"),
                    action_type="Transcript downloaded",
                    resource_id=job_id,
                    details={
                        "resource": "transcript",
                        "file_name": file_name,
                        "content_type": content_type,
                        "blob_url": base_url,
                        "via": "stream",
                    },
                )
            except Exception:
                logger.debug("Audit log (Transcript downloaded) skipped due to error", exc_info=True)

        # Return as streaming response
        logger.info(
            f"[{request_id}] Successfully preparing StreamingResponse for client with content-type: {content_type}"
        )
        # Content disposition: attachment only when download is requested
        disposition_type = "attachment" if download else "inline"
        response = StreamingResponse(
            content_stream,
            media_type=content_type,
            headers={"Content-Disposition": f"{disposition_type}; filename={file_name}"},
        )

        logger.info(
            f"[{request_id}] Transcription streaming response ready to be sent to client"
        )
        return response
    except AzureError as e:
        error_details = str(e)
        logger.error(
            f"[{request_id}] Azure storage error: {error_details}", exc_info=True
        )
        logger.error(
            f"[{request_id}] Azure error code: {getattr(e, 'error_code', 'unknown')}"
        )
        logger.error(f"[{request_id}] Stack trace: {traceback.format_exc()}")
        raise HTTPException(status_code=502, detail="Error accessing storage service")
    except Exception as e:
        error_details = str(e)
        logger.error(
            f"[{request_id}] Error streaming transcription: {error_details}",
            exc_info=True,
        )
        logger.error(f"[{request_id}] Stack trace: {traceback.format_exc()}")
        raise HTTPException(
            status_code=500, detail="Error streaming transcription file"
        )


@router.post("/uploadmobile")
async def upload_file_mobile(
    file: UploadFile = File(...),
    prompt_category_id: str = Form(None),
    prompt_subcategory_id: str = Form(None),
    recording_user_email: str = Form(None),
    case_id: str = Form(None),
    current_user: Dict[str, Any] = Depends(get_current_user_any),
    cached_user_service: AzureCachedUserService = Depends(get_cached_user_service),
    cosmos_db: CosmosDB = Depends(get_cosmos_db),
) -> Dict[str, Any]:
    """
    Upload a file to Azure Blob Storage and create a job record (Mobile version).

    Args:
        file: The file to upload
        prompt_category_id: Category ID for the prompt
        prompt_subcategory_id: Subcategory ID for the prompt
        recording_user_email: Email of the user making the recording
        case_id: Case ID if provided
        current_user: Authenticated user UPN

    Returns:
        Dict containing job ID and status
    """
    # If the caller is a service principal (app-only), enforce configured upload role
    if current_user.get("auth_type") == "entra_app":
        roles = current_user.get("roles", []) or []
        config = await get_shared_config()
        required_role = getattr(config, "sp_upload_role", "ndluploader")
        if required_role not in roles:
            logger.warning(f"[UPLOAD MOBILE] App-only caller missing required role '{required_role}'. Roles: {roles}")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"App identity lacks required role: {required_role}")

    logger.debug(f"Received prompt_category_id: {prompt_category_id}")
    logger.debug(f"Received prompt_subcategory_id: {prompt_subcategory_id}")

    if not prompt_category_id or not prompt_subcategory_id:
        raise HTTPException(
            status_code=400, detail="Category and Subcategory IDs cannot be null"
        )

    try:
        try:
            # retrieve User ID from Auth DB based on supplied UPN (cached lookup)
            user_id = await cached_user_service.get_user_by_email(recording_user_email)
        except Exception as e:
            logger.error(f"User not found in Database: {str(e)}")
            return {"status": 401, "message": "User not found"}

        # Validate prompt category and subcategory if provided
        if prompt_category_id:
            category_query = (
                "SELECT * FROM c WHERE c.type = 'prompt_category' AND c.id = @id"
            )
            categories = list(
                cosmos_db.prompts_container.query_items(
                    query=category_query,
                    parameters=[{"name": "@id", "value": prompt_category_id}],
                    enable_cross_partition_query=True,
                )
            )
            if not categories:
                return {
                    "status": 400,
                    "message": f"Invalid prompt_category_id: {prompt_category_id}",
                }

            if prompt_subcategory_id:
                subcategory_query = """
                    SELECT * FROM c
                    WHERE c.type = 'prompt_subcategory'
                    AND c.id = @id
                    AND c.category_id = @category_id
                """
                subcategories = list(
                    cosmos_db.prompts_container.query_items(
                        query=subcategory_query,
                        parameters=[
                            {"name": "@id", "value": prompt_subcategory_id},
                            {"name": "@category_id", "value": prompt_category_id},
                        ],
                        enable_cross_partition_query=True,
                    )
                )
                if not subcategories:
                    return {
                        "status": 400,
                        "message": f"Invalid prompt_subcategory_id: {prompt_subcategory_id} for category: {prompt_category_id}",
                    }

        try:
            # Normalize filename: decode HTML entities, decode URL-encoded chars, replace spaces with underscores
            import html, urllib.parse
            clean_filename = html.unescape(file.filename)
            clean_filename = urllib.parse.unquote(clean_filename)
            clean_filename = clean_filename.replace(' ', '_')
            clean_filename = urllib.parse.unquote(clean_filename)

            # Save uploaded file to temporary location
            with tempfile.NamedTemporaryFile(
                delete=False, suffix=os.path.splitext(clean_filename)[1]
            ) as temp_file:
                content = await file.read()
                temp_file.write(content)
                temp_file_path = temp_file.name


            # Upload file to blob storage
            config = await get_shared_config()
            storage_service = await get_shared_storage(config)
            blob_url = storage_service.upload_file(temp_file_path, clean_filename)
            logger.debug(f"File uploaded to blob storage: {blob_url}")

            # Use shared normalization utility
            normalized_blob_url = normalize_blob_url(blob_url)
            logger.debug(f"Normalized blob URL for CosmosDB: {normalized_blob_url}")

            # Clean up temporary file
            os.unlink(temp_file_path)

        except AzureError as e:
            logger.error(f"Storage error: {str(e)}")
            return {"status": 504, "message": "Storage service unavailable"}
        except Exception as e:
            logger.error(f"Error uploading file: {str(e)}")
            return {"status": 505, "message": f"Error uploading file: {str(e)}"}

    # Create job document
        timestamp = int(datetime.now(timezone.utc).timestamp() * 1000)
        job_id = f"job_{timestamp}"
        job_data = {
            "id": job_id,
            "type": "job",
            "user_id": user_id['id'],
            "file_path": normalized_blob_url,
            "transcription_file_path": None,
            "analysis_file_path": None,
            "prompt_category_id": prompt_category_id,
            "prompt_subcategory_id": prompt_subcategory_id,
            "status": "uploaded",
            "transcription_id": None,
            "created_at": timestamp,
            "updated_at": timestamp,
            "case_id": case_id,
            "ingestion_source": "mobile_sara_notes",
        }
        logger.info(f"[MOBILE] Job data to be written to CosmosDB: {json.dumps({'file_path': job_data['file_path']})}")
        job = cosmos_db.create_job(job_data)

        # Audit: Audio recorded (mobile)
        try:
            audit_service = CosmosAuditService(cosmos_db)
            acting_identity_id = current_user.get("id")
            recording_user_id = user_id.get('id') if isinstance(user_id, dict) else None

            # If the acting identity is an app (service principal) we still want to attribute
            # the action primarily to the human recorder (recording_user_id / email), while
            # retaining the acting identity for traceability.
            if acting_identity_id and recording_user_id and acting_identity_id.startswith("app_") and acting_identity_id != recording_user_id:
                logger.debug(
                    f"[MOBILE AUDIT] Acting identity {acting_identity_id} differs from recording user {recording_user_id}; attributing audit to recording user."
                )

            audit_details = {
                "filename": clean_filename,
                "file_size_bytes": len(content) if 'content' in locals() else None,
                "recording_user_email": recording_user_email,
                "recording_user_id": recording_user_id,
                "acting_identity_id": acting_identity_id,
                "acting_identity_auth_type": current_user.get("auth_type"),
                "prompt_category_id": prompt_category_id,
                "prompt_subcategory_id": prompt_subcategory_id,
                "case_id": case_id,
                "ingestion_source": "mobile_sara_notes",
                "ingestion_label": "Uploaded via mobile frontend",
            }

            # Use the recording user as primary subject if available; fall back to acting identity
            primary_audit_user = recording_user_id or acting_identity_id

            audit_service.log_user_action(
                user_id=primary_audit_user,
                action_type="Audio recorded",
                resource_id=job_id,
                details=audit_details,
            )
        except Exception:
            logger.debug("Audit log (Audio recorded) skipped due to error", exc_info=True)

        return {
            "job_id": job_id,
            "status": "uploaded",
            "message": "File uploaded successfully",
            "prompt_category_id": prompt_category_id,
            "prompt_subcategory_id": prompt_subcategory_id,
        }

    except Exception as e:
        logger.error(f"Unexpected error during mobile upload: {str(e)}", exc_info=True)
        return {"status": 500, "message": f"Failed to upload file: {str(e)}"}


@router.get("/jobsmobilequery",
    summary="Get job details with optional filters (Mobile version)",
    response_model=Dict[str, Any],
    openapi_extra={
        "security": [
            {"OAuth2Implicit": ["api://71bea96c-7f27-4eae-9310-14aeb4ebd598/access_as_user"]},
            {"HTTPBearer": []}
        ]
    }
)
async def get_jobs_mobile(
    job_id: Optional[str] = Query(None, description="Filter by job ID"),
    status: Optional[str] = Query(None, description="Filter by job status"),
    file_path: Optional[str] = Query(None, description="Filter by file path"),
    created_at: Optional[str] = Query(
        None, description="Filter by creation date in YYYY-MM-DD format"
    ),
    prompt_subcategory_id: Optional[str] = Query(
        None, description="Filter by prompt subcategory ID"
    ),
    ingestion_source: Optional[str] = Query(None, description="Filter by ingestion source (e.g. web_ui, mobile_sara_notes)"),
    current_user: Dict[str, Any] = Depends(get_current_user_any),
) -> Dict[str, Any]:
    """
    Get job details with optional filters (Mobile version).

    Args:
        job_id: Filter by job ID
        status: Filter by job status
        file_path: Filter by file path
        created_at: Filter by creation date (YYYY-MM-DD)
        prompt_subcategory_id: Filter by prompt subcategory ID
        current_user: Authenticated user from token

    Returns:
        Dict containing jobs and status
    """
    # If the caller is a service principal (app-only), enforce configured upload role
    if current_user.get("auth_type") == "entra_app":
        roles = current_user.get("roles", []) or []
        config = await get_shared_config()
        required_role = getattr(config, "sp_upload_role", "ndluploader")
        if required_role not in roles:
            logger.warning(f"[JOBS MOBILE] App-only caller missing required role '{required_role}'. Roles: {roles}")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"App identity lacks required role: {required_role}")

    try:
        config = await get_shared_config()
        try:
            cosmos_db = await get_shared_cosmos(config)
            logger.debug("CosmosDB client initialized for mobile job query")
        except DatabaseError as e:
            logger.error(f"Database initialization failed: {str(e)}")
            return {"status": 503, "message": "Database service unavailable"}

        # Initialize storage service for SAS token generation
        storage_service = await get_shared_storage(config)

        # Build query
        query = "SELECT * FROM c WHERE c.type = 'job'"
        parameters = []

        if job_id:
            query += " AND c.id = @job_id"
            parameters.append({"name": "@job_id", "value": job_id})

        if status:
            query += " AND c.status = @status"
            parameters.append({"name": "@status", "value": status})

        if file_path:
            file_path = normalize_blob_url(file_path)
            query += " AND c.file_path = @file_path"
            parameters.append({"name": "@file_path", "value": file_path})

        if created_at:
            try:
                parsed_date = datetime.strptime(created_at, "%Y-%m-%d").date()
                # Convert date to start and end of day timestamps
                start_of_day = int(
                    datetime.combine(parsed_date, datetime.min.time())
                    .replace(tzinfo=timezone.utc)
                    .timestamp()
                    * 1000
                )
                end_of_day = int(
                    datetime.combine(parsed_date, datetime.max.time())
                    .replace(tzinfo=timezone.utc)
                    .timestamp()
                    * 1000
                )
                query += (
                    " AND c.created_at >= @start_date AND c.created_at <= @end_date"
                )
                parameters.extend(
                    [
                        {"name": "@start_date", "value": start_of_day},
                        {"name": "@end_date", "value": end_of_day},
                    ]
                )
            except ValueError:
                logger.warning("Invalid created_at format")
                return {
                    "status": 400,
                    "message": "Invalid created_at date. Expected format: YYYY-MM-DD.",
                }

        if prompt_subcategory_id:
            query += " AND c.prompt_subcategory_id = @subcategory"
            parameters.append({"name": "@subcategory", "value": prompt_subcategory_id})

        if ingestion_source:
            query += " AND c.ingestion_source = @ingestion_source"
            parameters.append({"name": "@ingestion_source", "value": ingestion_source})

        # Note: User filter removed for mobile admin complete job review
        # query += " AND c.user_id = @user_id"
        # parameters.append({"name": "@user_id", "value": current_user["id"]})

        try:
            jobs = list(
                cosmos_db.jobs_container.query_items(
                    query=query,
                    parameters=parameters,
                    enable_cross_partition_query=True,
                )
            )

            # Add SAS tokens to file paths
            for job in jobs:
                if job.get("file_path"):
                    # Extract file name from the file path before adding SAS token
                    file_path = job["file_path"]
                    path_parts = urlparse(file_path).path.strip("/").split("/")
                    job["file_name"] = path_parts[-1] if path_parts else None
                    job["file_path"] = storage_service.add_sas_token_to_url(file_path)
                    job["transcription_file_path"] = storage_service.add_sas_token_to_url(job["transcription_file_path"])
                    job["analysis_file_path"] = storage_service.add_sas_token_to_url(job["analysis_file_path"])

            return {
                "status": 200,
                "message": "Jobs retrieved successfully",
                "count": len(jobs),
                "jobs": jobs,
            }

        except Exception as e:
            logger.error(f"Error querying mobile jobs: {str(e)}")
            return {"status": 500, "message": f"Error retrieving jobs: {str(e)}"}

    except Exception as e:
        logger.error(f"Unexpected error getting mobile jobs: {str(e)}", exc_info=True)
        return {"status": 500, "message": f"An unexpected error occurred: {str(e)}"}
