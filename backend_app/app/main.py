import logging
import logging.config
import sys
import os
from dotenv import load_dotenv
from contextlib import asynccontextmanager
from datetime import datetime, timezone

# Import FastAPI and routers after environment is configured
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi import HTTPException

# Import core routers with error handling for startup safety
try:
    from .routers import auth, upload, prompts, admin
except ImportError:
    # Fallback for Azure App Service deployment
    from app.routers import auth, upload, prompts, admin

# Try to import analytics router with error handling
try:
    try:
        from .routers import analytics
    except ImportError:
        from app.routers import analytics
    analytics_available = True
    logging.getLogger(__name__).info("✅ Analytics router imported successfully")
except Exception as e:
    logging.getLogger(__name__).error(f"❌ Failed to import analytics router: {e}")
    analytics_available = False

# Diagnostic router temporarily disabled
diagnostic_available = False

try:
    from .core.dependencies import get_service_container
except ImportError:
    from app.core.dependencies import get_service_container
from azure.identity import DefaultAzureCredential

# Environment setup for Azure App Service
default_credential = DefaultAzureCredential()

# Load environment variables first
load_dotenv()

# Feature flags / env toggles
ENABLE_SWAGGER_OAUTH = os.getenv("ENABLE_SWAGGER_OAUTH", "false").lower() == "true"

# Centralized logging configuration (single registration)
LOG_LEVEL = os.getenv("BACKEND_LOG_LEVEL", "INFO").upper()

LOG_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "standard": {
            "format": "%(asctime)s %(levelname)s %(name)s - %(message)s"
        },
        # Future: add json formatter here if needed
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "level": LOG_LEVEL,
            "formatter": "standard",
            "stream": "ext://sys.stdout",
        }
    },
    "loggers": {
        "": {  # root
            "handlers": ["console"],
            "level": LOG_LEVEL,
        },
        "uvicorn": {"level": "INFO", "handlers": ["console"], "propagate": False},
        "uvicorn.error": {"level": "INFO", "handlers": ["console"], "propagate": False},
        "uvicorn.access": {"level": "WARNING", "handlers": ["console"], "propagate": False},
    },
}

logging.config.dictConfig(LOG_CONFIG)

logger = logging.getLogger(__name__)

# (Levels enforced via dictConfig above; explicit setLevel removed)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("🚀 Starting Azure-hosted authentication service with enhanced dependency injection...")
    startup_start = datetime.now(timezone.utc)
    try:
        # Initialize services by creating a service container
        logger.info("Initializing service container...")
        service_container = get_service_container()
        # Perform comprehensive health check
        health_status = service_container.health_check()
        logger.info(f"Service startup health check: {health_status}")
        # Log enabled authentication methods for Azure monitoring
        enabled_methods = service_container.get_enabled_auth_methods()
        logger.info(f"✅ Authentication methods enabled: {enabled_methods}")
        # Azure-specific startup optimizations
        if service_container.cosmos_db:
            logger.info("✅ CosmosDB connection established")
        if service_container.entra_service:
            logger.info("✅ Entra ID service initialized")
        elif service_container.is_entra_enabled():
            logger.warning("⚠️  Entra ID enabled but service initialization failed")
        startup_duration = (datetime.now(timezone.utc) - startup_start).total_seconds()
        logger.info(f"🎉 All authentication services initialized successfully in {startup_duration:.2f}s")
        # Store service container in app state for access by endpoints
        app.state.service_container = service_container
    except Exception as e:
        logger.error(f"❌ Error during service startup: {e}", exc_info=True)
        # Don't raise exception to prevent app from failing to start in Azure
        # Azure App Service should still start even if some dependencies fail
    yield
    # Shutdown
    logger.info("🛑 Shutting down Azure authentication services...")
    shutdown_start = datetime.now(timezone.utc)
    try:
        # Cleanup is handled automatically by FastAPI dependency injection system
        shutdown_duration = (datetime.now(timezone.utc) - shutdown_start).total_seconds()
        logger.info(f"✅ Authentication services shutdown completed in {shutdown_duration:.2f}s")
    except Exception as e:
        logger.error(f"❌ Error during shutdown: {e}", exc_info=True)


# Create FastAPI app with enhanced configuration for Azure
app = FastAPI(
    title="SonicBrief Authentication API",
    description="Enhanced Azure-hosted authentication service with dependency injection and caching",
    version="2.0.0",
    lifespan=lifespan,
    # Configure OAuth2 for Swagger UI
    swagger_ui_oauth2_redirect_url="/docs/oauth2-redirect"
)

# Add OAuth2 security scheme to OpenAPI schema
def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema

    from fastapi.openapi.utils import get_openapi
    openapi_schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
    )

    # Add OAuth2 Implicit flow for Swagger UI (works better than Authorization Code)
    tenant_id = os.getenv('AZURE_TENANT_ID', 'common')
    client_id = os.getenv('ENTRA_CLIENT_ID', 'your-client-id')

    # Always provide HTTP Bearer scheme; optionally add OAuth2Implicit based on flag
    security_schemes = {
        "HTTPBearer": {
            "type": "http",
            "scheme": "bearer",
            "description": "Bearer token (JWT) authentication"
        }
    }
    if ENABLE_SWAGGER_OAUTH:
        security_schemes["OAuth2Implicit"] = {
            "type": "oauth2",
            "description": "OAuth2 Implicit flow for Swagger UI (enabled via ENABLE_SWAGGER_OAUTH)",
            "flows": {
                "implicit": {
                    "authorizationUrl": f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/authorize",
                    "scopes": {
                        "openid": "Sign you in",
                        "profile": "View your basic profile",
                        "email": "View your email address",
                        f"api://{client_id}/access_as_user": "Access the application"
                    }
                }
            }
        }
    openapi_schema.setdefault("components", {})["securitySchemes"] = security_schemes

    app.openapi_schema = openapi_schema
    return app.openapi_schema

app.openapi = custom_openapi

# Configure Swagger UI OAuth2 settings with proper security
@app.get("/docs", include_in_schema=False)
async def custom_swagger_ui_html():
    from fastapi.openapi.docs import get_swagger_ui_html
    client_id = os.getenv('ENTRA_CLIENT_ID', '41d9bfd4-9418-4abd-88eb-2a5b1e6330bf')
    if ENABLE_SWAGGER_OAUTH:
        logger.info("Swagger OAuth enabled: injecting OAuth2 client configuration into docs UI")
        return get_swagger_ui_html(
            openapi_url=app.openapi_url,
            title=app.title + " - Swagger UI",
            oauth2_redirect_url=app.swagger_ui_oauth2_redirect_url,
            init_oauth={
                "clientId": client_id,
                "appName": "Swagger UI",
                "scopeSeparator": " ",
                "scopes": f"api://{client_id}/access_as_user openid profile email"
            }
        )
    else:
        logger.info("Swagger OAuth disabled: serving docs without OAuth2 client configuration")
        return get_swagger_ui_html(
            openapi_url=app.openapi_url,
            title=app.title + " - Swagger UI",
            oauth2_redirect_url=app.swagger_ui_oauth2_redirect_url,
        )

# Include routers
app.include_router(auth.router, prefix="/auth", tags=["authentication"])
app.include_router(upload.router, prefix="/upload", tags=["upload"])
app.include_router(prompts.router, prefix="/prompts", tags=["prompts"])
app.include_router(admin.router, prefix="/admin", tags=["admin"])

# Include diagnostic router if available
# Temporarily disabled
# if diagnostic_available:
#     app.include_router(diagnostic.router, prefix="/diagnostic", tags=["diagnostic"])

# Include analytics router if available
if analytics_available:
    app.include_router(analytics.router, prefix="/analytics", tags=["analytics"])
    logging.getLogger(__name__).info("✅ Analytics router included in FastAPI app")
else:
    logging.getLogger(__name__).warning("❌ Analytics router NOT included - import failed")

# Add a simple test endpoint to verify deployment
@app.get("/test/deployment")
async def test_deployment():
    """Test endpoint to verify backend deployment and analytics availability"""
    return {
        "status": "Backend deployed successfully",
        "analytics_router_available": analytics_available,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "available_routers": ["auth", "upload", "prompts", "admin"] + (["analytics"] if analytics_available else [])
    }

# Azure-optimized CORS configuration (env-driven)
_default_cors = [
    # Local development defaults only; production origins must be supplied via ALLOW_ORIGINS env
    "http://localhost:5173",  # Vite dev server
    "http://localhost:3000",  # React dev server
]

raw_allow_origins = os.getenv("ALLOW_ORIGINS")
if raw_allow_origins:
    allow_origins = [o.strip() for o in raw_allow_origins.split(",") if o.strip()]
    if not allow_origins:
        allow_origins = _default_cors
        logger.warning("ALLOW_ORIGINS provided but parsed to empty list; falling back to defaults")
else:
    allow_origins = _default_cors

logger.info(f"Configured CORS origins: {allow_origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "Accept",
        "Origin",
        "X-Requested-With",
        "Access-Control-Request-Method",
        "Access-Control-Request-Headers",
    ],
)


# OAuth2 redirect endpoint for Swagger UI
@app.get("/docs/oauth2-redirect", include_in_schema=False)
async def swagger_ui_redirect():
    return """
    <!DOCTYPE html>
    <html>
    <head>
        <title>OAuth2 Redirect</title>
    </head>
    <body>
        <script>
            // This is handled by Swagger UI automatically
            window.close();
        </script>
    </body>
    </html>
    """


# Azure App Service health check and monitoring endpoints
@app.get("/")
async def root():
    """Root endpoint with service information"""
    return {
        "service": "SonicBrief Authentication API",
        "version": "2.0.0",
        "status": "running",
        "features": ["enhanced_auth", "dependency_injection", "caching", "azure_optimized"],
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.get("/health")
async def health_check():
    """Comprehensive health check for Azure monitoring"""
    try:
        service_container = get_service_container()
        health_status = service_container.health_check()
        # Add Azure-specific health indicators
        health_status.update({
            "azure_hosted": True,
            "environment": os.getenv("AZURE_ENV_NAME", "unknown"),
            "app_service": os.getenv("WEBSITE_SITE_NAME", "local"),
            "subscription": os.getenv("AZURE_SUBSCRIPTION_ID", "unknown")[:8] + "..." if os.getenv("AZURE_SUBSCRIPTION_ID") else "unknown"
        })
        return health_status
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {
            "status": "unhealthy",
            "error": str(e),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }


@app.get("/echo")
async def echo_request():
    """Simple echo endpoint for connectivity testing"""
    return {
        "message": "Echo successful",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "azure_hosted": True
    }


@app.get("/debug-audit")
async def debug_audit():
    """Debug audit logging system"""
    # Hide this endpoint unless explicitly enabled
    if os.getenv("ENABLE_DEBUG_ENDPOINTS", "false").lower() != "true":
        raise HTTPException(status_code=404, detail="Not found")
    result = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "test_results": {}
    }

    # Test 1: Check if audit service can be imported
    try:
        try:
            from .services.cosmos_audit_service import CosmosAuditService
        except ImportError:
            from app.services.cosmos_audit_service import CosmosAuditService
        result["test_results"]["audit_service_import"] = "✅ SUCCESS"
    except Exception as e:
        result["test_results"]["audit_service_import"] = f"❌ FAILED: {str(e)}"
        return result

    # Test 2: Check if service container works
    try:
        service_container = get_service_container()
        result["test_results"]["service_container"] = "✅ SUCCESS"
    except Exception as e:
        result["test_results"]["service_container"] = f"❌ FAILED: {str(e)}"
        return result

    # Test 3: Get cosmos DB using proper dependency functions
    try:
        try:
            from .core.dependencies import get_app_config, get_cosmos_db
        except ImportError:
            from app.core.dependencies import get_app_config, get_cosmos_db

        config = get_app_config()
        cosmos_db = get_cosmos_db(config)

        if cosmos_db:
            result["test_results"]["cosmos_db"] = "✅ AVAILABLE"

            # Test 4: Check specific containers
            containers = ["audit_logs_container", "job_activity_logs_container"]
            for container_name in containers:
                try:
                    if hasattr(cosmos_db, container_name):
                        container = getattr(cosmos_db, container_name)
                        container.read()  # Try to read container info
                        result["test_results"][f"{container_name}"] = "✅ EXISTS"
                    else:
                        result["test_results"][f"{container_name}"] = "❌ NOT FOUND ON COSMOS_DB"
                except Exception as e:
                    result["test_results"][f"{container_name}"] = f"❌ ERROR: {str(e)}"
        else:
            result["test_results"]["cosmos_db"] = "❌ NOT AVAILABLE"
            return result
    except Exception as e:
        result["test_results"]["cosmos_db"] = f"❌ FAILED: {str(e)}"
        return result

    # Test 5: Try to create audit service and log something
    try:
        audit_service = CosmosAuditService(cosmos_db)
        result["test_results"]["audit_service_creation"] = "✅ SUCCESS"

        # Test actual logging
        log_result = audit_service.log_user_action(
            user_id="debug_test",
            action_type="DEBUG_TEST",
            message="Testing audit logging from debug endpoint",
            details={"test": True, "endpoint": "/debug-audit"},
            request_info={"source": "debug_endpoint"}
        )

        result["test_results"]["audit_log_test"] = "✅ SUCCESS" if log_result else "❌ FAILED"
        result["overall_status"] = "✅ AUDIT WORKING" if log_result else "❌ AUDIT NOT WORKING"

    except Exception as e:
        result["test_results"]["audit_service_creation"] = f"❌ FAILED: {str(e)}"
        result["overall_status"] = f"❌ AUDIT SERVICE ERROR: {str(e)}"

    return result
