import os
import logging
from typing import Dict, Any
from enum import Enum
from dotenv import load_dotenv
from azure.cosmos.exceptions import CosmosHttpResponseError
from azure.identity import ManagedIdentityCredential, CredentialUnavailableError
import azure.cosmos.cosmos_client as cosmos_client
from datetime import datetime, timezone

# Load environment variables
load_dotenv()

"""Configuration module.

Logging NOTE:
Module-level logging handlers have been removed to avoid duplicate handler
registration when this module is imported multiple times (e.g., by workers).
The application now configures logging once in `main.py` using dictConfig.
Here we only obtain a module logger reference.
"""

logger = logging.getLogger(__name__)


class AuthMethod(Enum):
    """Supported authentication methods"""
    LEGACY = "legacy"
    ENTRA = "entra"
    BOTH = "both"


class AuthConfig:
    """Enhanced authentication configuration with environment variable control"""

    def __init__(self):
        # Get authentication method from environment variable
        auth_method_str = os.getenv("AUTH_METHOD", "both").lower()

        try:
            self.auth_method = AuthMethod(auth_method_str)
        except ValueError:
            logger.warning(f"Invalid AUTH_METHOD '{auth_method_str}', defaulting to 'both'")
            self.auth_method = AuthMethod.BOTH

        logger.info(f"Authentication method configured: {self.auth_method.value}")

        # Validate required environment variables
        self._validate_config()

    def is_legacy_enabled(self) -> bool:
        """Check if legacy JWT authentication is enabled"""
        return self.auth_method in [AuthMethod.LEGACY, AuthMethod.BOTH]

    def is_entra_enabled(self) -> bool:
        """Check if Entra ID authentication is enabled"""
        return self.auth_method in [AuthMethod.ENTRA, AuthMethod.BOTH]

    def get_enabled_methods(self) -> list:
        """Get list of enabled authentication methods"""
        methods = []
        if self.is_legacy_enabled():
            methods.append("legacy")
        if self.is_entra_enabled():
            methods.append("entra")
        return methods

    def get_legacy_config(self) -> dict:
        """Get legacy authentication configuration"""
        if not self.is_legacy_enabled():
            return {}

        return {
            "jwt_secret_key": get_required_env_var("JWT_SECRET_KEY"),
            "jwt_algorithm": os.getenv("JWT_ALGORITHM", "HS256"),
            "jwt_access_token_expire_minutes": int(
                os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "30")
            ),
        }

    def get_entra_config(self) -> dict:
        """Get Entra ID authentication configuration (reference parity: always require explicit Entra ID vars)"""
        if not self.is_entra_enabled():
            return {}
        return {
            "client_id": get_required_env_var("ENTRA_CLIENT_ID"),
            "tenant_id": get_required_env_var("AZURE_TENANT_ID"),
            "authority": get_required_env_var("AZURE_AUTHORITY"),
            "audience": get_required_env_var("AZURE_AUDIENCE"),
        }

    def _validate_config(self):
        """Validate required environment variables for enabled auth methods (reference parity)"""
        errors = []
        if self.is_legacy_enabled():
            if not os.getenv("JWT_SECRET_KEY"):
                errors.append("JWT_SECRET_KEY required for legacy authentication")
        if self.is_entra_enabled():
            # Always require Entra ID auth variables when Entra is enabled
            required_vars = ["ENTRA_CLIENT_ID", "AZURE_TENANT_ID", "AZURE_AUTHORITY", "AZURE_AUDIENCE"]
            for var in required_vars:
                if not os.getenv(var):
                    errors.append(f"{var} required for Entra ID authentication")
        if errors:
            error_msg = f"Authentication configuration errors: {'; '.join(errors)}"
            logger.error(error_msg)
            raise ValueError(error_msg)


def get_required_env_var(var_name: str) -> str:
    """Get a required environment variable or raise an error with a helpful message"""
    value = os.getenv(var_name)
    if not value:
        logger.error(f"Required environment variable {var_name} is not set")
        raise ValueError(f"Required environment variable {var_name} is not set")
    return value


class StorageConfig:
    def __init__(self, account_url: str, recordings_container: str):
        self.account_url = account_url
        self.recordings_container = recordings_container


class AppConfig:
    def __init__(self):
        logger.debug("Initializing AppConfig")
        try:
            # Initialize enhanced authentication configuration
            self.auth_config = AuthConfig()

            # Get the prefix first
            prefix = os.getenv("AZURE_COSMOS_DB_PREFIX", "voice_")

            # Initialize cosmos configuration
            self.cosmos = {
                "endpoint": get_required_env_var("AZURE_COSMOS_ENDPOINT"),
                "database": os.getenv("AZURE_COSMOS_DB", "VoiceDB"),
                "containers": {
                    "auth": f"{prefix}auth",
                    "jobs": f"{prefix}jobs",
                    "prompts": f"{prefix}prompts",
                    # Audit containers (no prefix - exact names)
                    "audit_logs": "audit_logs",
                    "job_activity_logs": "job_activity_logs",
                    "blob_lifecycle_logs": "blob_lifecycle_logs",
                    "system_metrics": "system_metrics",
                    "usage_analytics": "usage_analytics",
                },
            }
            logger.debug(f"Cosmos config initialized: {self.cosmos}")

            # Use enhanced auth configuration for Entra ID
            self.entra = self.auth_config.get_entra_config()
            logger.debug(f"Entra ID config: {self.entra}")

            # Use enhanced auth configuration for legacy auth
            self.auth = self.auth_config.get_legacy_config()
            logger.debug(f"Legacy auth config: {bool(self.auth)}")  # Log presence, not secrets

            # Initialize storage configuration
            self.storage = StorageConfig(
                account_url=get_required_env_var("AZURE_STORAGE_ACCOUNT_URL"),
                recordings_container=get_required_env_var(
                    "AZURE_STORAGE_RECORDINGS_CONTAINER"
                ),
            )

            # Service principal role requirements (for specialized ingestion frontends)
            # Allows previously hardcoded role 'ndluploader' to be overridden per environment.
            # If not set, defaults to 'ndluploader' to maintain backward compatibility.
            self.sp_upload_role = os.getenv("SERVICE_PRINCIPAL_UPLOAD_ROLE", "ndluploader")
            if not self.sp_upload_role:
                # Defensive: empty string should not be allowed; revert to default
                self.sp_upload_role = "ndluploader"
            logger.debug(f"Service principal upload role requirement: {self.sp_upload_role}")

            logger.debug("AppConfig initialization completed successfully")
        except Exception as e:
            logger.error(f"Error initializing AppConfig: {str(e)}")
            raise


class DatabaseError(Exception):
    """Custom exception for database errors"""

    pass


class CosmosDB:
    def get_stats(self) -> dict:
        """Return basic statistics about the Cosmos DB instance (stub, extend as needed)."""
        try:
            stats = {
                "database": self.database.database_link if hasattr(self.database, 'database_link') else str(self.database),
                "containers": list(self.config.cosmos["containers"].values()),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "status": "ok"
            }
            return stats
        except Exception as e:
            self.logger.error(f"Error getting CosmosDB stats: {str(e)}")
            return {"status": "error", "error": str(e)}

    def reset_stats(self) -> dict:
        """Reset any tracked statistics for Cosmos DB (stub, extend as needed)."""
        # No persistent stats to reset in this stub; extend if you add tracking
        try:
            # Example: clear any in-memory counters if implemented
            return {"status": "reset", "timestamp": datetime.now(timezone.utc).isoformat()}
        except Exception as e:
            self.logger.error(f"Error resetting CosmosDB stats: {str(e)}")
            return {"status": "error", "error": str(e)}
    def __init__(self, config: AppConfig):
        self.logger = logging.getLogger(__name__)
        self.logger.setLevel(logging.DEBUG)

        self.config = config

        # Use ManagedIdentityCredential for Azure App Service (consistent with Azure Functions)
        try:
            # For managed identity authentication to Azure resources (Cosmos DB, etc.)
            # Do NOT use AZURE_CLIENT_ID here as it's meant for Entra ID app registration
            # System Assigned Managed Identity doesn't need a client ID
            credential = ManagedIdentityCredential(logging_enable=True)
            self.logger.debug("ManagedIdentityCredential initialized for system-assigned identity")

        except CredentialUnavailableError as e:
            self.logger.error(f"Credential unavailable: {str(e)}")
            raise DatabaseError(
                "Failed to authenticate with Azure: Credential unavailable."
            )
        except Exception as e:
            self.logger.error(f"Unexpected error during authentication: {str(e)}")
            raise DatabaseError(f"Authentication error: {str(e)}")

        try:
            self.client = cosmos_client.CosmosClient(
                url=config.cosmos["endpoint"], credential=credential
            )

            # Create database if it doesn't exist
            database_name = config.cosmos["database"]
            self.database = self.client.get_database_client(database_name)
            self.logger.info(f"Database {database_name} is ready")

            # Create containers if they don't exist
            containers = config.cosmos["containers"]

            # Auth container
            auth_container_name = containers["auth"]
            self.auth_container = self.database.get_container_client(
                auth_container_name
            )
            self.logger.info(f"Auth container {auth_container_name} is ready")

            # Jobs container
            jobs_container_name = containers["jobs"]
            self.jobs_container = self.database.get_container_client(
                jobs_container_name
            )
            self.logger.info(f"Jobs container {jobs_container_name} is ready")

            # Prompts container
            prompts_container_name = containers["prompts"]
            self.prompts_container = self.database.get_container_client(
                prompts_container_name
            )
            self.logger.info(f"Prompts container {prompts_container_name} is ready")

            # Audit containers
            audit_logs_container_name = containers["audit_logs"]
            self.audit_logs_container = self.database.get_container_client(
                audit_logs_container_name
            )
            self.logger.info(f"Audit logs container {audit_logs_container_name} is ready")

            job_activity_logs_container_name = containers["job_activity_logs"]
            self.job_activity_logs_container = self.database.get_container_client(
                job_activity_logs_container_name
            )
            self.logger.info(f"Job activity logs container {job_activity_logs_container_name} is ready")

            blob_lifecycle_logs_container_name = containers["blob_lifecycle_logs"]
            self.blob_lifecycle_logs_container = self.database.get_container_client(
                blob_lifecycle_logs_container_name
            )
            self.logger.info(f"Blob lifecycle logs container {blob_lifecycle_logs_container_name} is ready")

            system_metrics_container_name = containers["system_metrics"]
            self.system_metrics_container = self.database.get_container_client(
                system_metrics_container_name
            )
            self.logger.info(f"System metrics container {system_metrics_container_name} is ready")

            usage_analytics_container_name = containers["usage_analytics"]
            self.usage_analytics_container = self.database.get_container_client(
                usage_analytics_container_name
            )
            self.logger.info(f"Usage analytics container {usage_analytics_container_name} is ready")

        except KeyError as e:
            self.logger.error(f"Missing configuration key: {str(e)}")
            raise
        except CosmosHttpResponseError as e:
            self.logger.error(f"Cosmos DB HTTP error: {str(e)}")
            raise DatabaseError(f"Cosmos DB error: {str(e)}")
        except Exception as e:
            self.logger.error(f"Error initializing Cosmos DB: {str(e)}")
            raise

    async def get_user_by_email(self, email: str):
        try:
            # Normalize email to lowercase for consistent lookups
            normalized_email = email.lower().strip() if email else email

            query = "SELECT * FROM c WHERE c.type = 'user' AND c.email = @email"
            parameters = [{"name": "@email", "value": normalized_email}]
            results = list(
                self.auth_container.query_items(
                    query=query,
                    parameters=parameters,
                    enable_cross_partition_query=True,
                )
            )
            return results[0] if results else None
        except Exception as e:
            self.logger.error(f"Error retrieving user: {str(e)}")
            raise

    async def create_user(self, user_data: dict):
        try:
            # Normalize email to lowercase for consistent storage
            if "email" in user_data and user_data["email"]:
                user_data["email"] = user_data["email"].lower().strip()

            # Before creating, do a final check for existing user to prevent duplicates
            email = user_data.get("email")
            entra_oid = user_data.get("entra_oid")

            # Check by email first
            if email:
                existing_user = await self.get_user_by_email(email)
                if existing_user:
                    self.logger.warning(f"User already exists with email {email}, returning existing user")
                    return existing_user

            # Check by entra_oid if provided
            if entra_oid:
                existing_user = await self.get_user_by_entra_oid(entra_oid)
                if existing_user:
                    self.logger.warning(f"User already exists with entra_oid {entra_oid}, returning existing user")
                    return existing_user

            # Ensure all hybrid fields are present
            user_data["type"] = "user"
            user_data.setdefault("auth_method", user_data.get("auth_method", "legacy"))
            user_data.setdefault("display_name", user_data.get("displayName") or user_data.get("email"))
            user_data.setdefault("last_login", datetime.now(timezone.utc).isoformat())
            user_data.setdefault("is_active", True)
            user_data.setdefault("created_at", datetime.now(timezone.utc).isoformat())
            user_data.setdefault("updated_at", datetime.now(timezone.utc).isoformat())

            # Create the user
            created_user = self.auth_container.create_item(body=user_data)
            self.logger.info(f"Successfully created user with ID: {created_user['id']}")
            return created_user
        except Exception as e:
            self.logger.error(f"Error creating user: {str(e)}")
            raise

    # MIGRATION NOTE: To migrate existing users, iterate all user docs and add missing fields as above.
    # This can be done with a one-off script or as part of a migration endpoint.

    def create_job(self, job_data: Dict[str, Any]) -> Dict[str, Any]:
        try:
            job_data["type"] = "job"
            return self.jobs_container.create_item(body=job_data)
        except Exception as e:
            self.logger.error(f"Error creating job: {str(e)}")
            raise

    def get_job(self, job_id: str) -> Dict[str, Any] | None:
        """Get job by ID from jobs container"""
        query = "SELECT * FROM c WHERE c.type = 'job' AND c.id = @id"
        try:
            jobs = list(
                self.jobs_container.query_items(
                    query=query,
                    parameters=[{"name": "@id", "value": job_id}],
                    enable_cross_partition_query=True,
                )
            )
            return jobs[0] if jobs else None
        except Exception as e:
            logger.error(f"Error getting job: {str(e)}")
            raise ValueError(f"Error retrieving job: {str(e)}")

    def update_job(self, job_data: Dict[str, Any]) -> Dict[str, Any]:
        """Update job in jobs container"""
        try:
            return self.jobs_container.upsert_item(body=job_data)
        except Exception as e:
            logger.error(f"Error updating job: {str(e)}")
            raise ValueError(f"Error updating job: {str(e)}")

    def create_prompt_category(self, category_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create prompt category in prompts container"""
        try:
            return self.prompts_container.create_item(body=category_data)
        except Exception as e:
            logger.error(f"Error creating prompt category: {str(e)}")
            raise ValueError(f"Error creating prompt category: {str(e)}")

    def create_prompt_subcategory(
        self, subcategory_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Create prompt subcategory in prompts container"""
        try:
            return self.prompts_container.create_item(body=subcategory_data)
        except Exception as e:
            logger.error(f"Error creating prompt subcategory: {str(e)}")
            raise ValueError(f"Error creating prompt subcategory: {str(e)}")

    async def get_user_by_entra_oid(self, entra_oid: str):
        """Query the auth container for a user with the given Entra OID."""
        try:
            query = "SELECT * FROM c WHERE c.type = 'user' AND c.entra_oid = @entra_oid"
            parameters = [{"name": "@entra_oid", "value": entra_oid}]
            results = list(
                self.auth_container.query_items(
                    query=query,
                    parameters=parameters,
                    enable_cross_partition_query=True,
                )
            )
            return results[0] if results else None
        except Exception as e:
            self.logger.error(f"Error retrieving user by entra_oid: {str(e)}")
            raise

    async def update_user(self, user_id_or_data, update_data=None):
        """Update user in auth container. Supports two usage patterns:
        1. update_user(user_id, update_data) - update specific fields
        2. update_user(user_data) - update entire user object
        """
        try:
            if update_data is not None:
                # Pattern 1: update_user(user_id, update_data)
                user_id = user_id_or_data
                # Get existing user first
                existing_user = self.auth_container.read_item(user_id, partition_key=user_id)
                # Update specified fields
                existing_user.update(update_data)
                existing_user["updated_at"] = datetime.now(timezone.utc).isoformat()
                # Replace the user
                updated_user = self.auth_container.replace_item(item=existing_user, body=existing_user)
                self.logger.info(f"User fields updated: {user_id}")
                return updated_user
            else:
                # Pattern 2: update_user(user_data)
                user_data = user_id_or_data
                user_data["updated_at"] = datetime.now(timezone.utc).isoformat()
                # Upsert the entire user object
                updated_user = self.auth_container.upsert_item(body=user_data)
                self.logger.info(f"User updated/upserted: {user_data['id']}")
                return updated_user
        except Exception as e:
            self.logger.error(f"Error updating user: {str(e)}")
            raise


# Create the config instance
config = AppConfig()
