from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Request, Query
from fastapi.security import HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
import logging
import asyncio
import os
from app.core.config import AppConfig, CosmosDB, DatabaseError
from app.core.dependencies import (
    get_app_config,
    get_cosmos_db,
    get_entra_auth_service,
    get_cached_user_service,
    get_user_management_service,
    get_entra_auth_service,
    get_auth_cache,
    generate_token_hash
)
from app.services.entra_auth import EntraAuthService
from app.services.cached_user_service import AzureCachedUserService

# Global lock dictionary for user creation per email/entra_oid
_user_creation_locks = {}
_lock_cleanup_lock = asyncio.Lock()

async def get_or_create_user_lock(identifier: str) -> asyncio.Lock:
    """Get or create a lock for a specific user identifier (email or entra_oid)."""
    async with _lock_cleanup_lock:
        if identifier not in _user_creation_locks:
            _user_creation_locks[identifier] = asyncio.Lock()
        return _user_creation_locks[identifier]

async def cleanup_user_lock(identifier: str):
    """Clean up a user lock after use."""
    async with _lock_cleanup_lock:
        if identifier in _user_creation_locks:
            del _user_creation_locks[identifier]

# Setup logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Simple Bearer token scheme for API authentication
# This will show "Bearer Token" field in Swagger UI
oauth2_scheme = HTTPBearer(scheme_name="Bearer Authentication")


def _ensure_debug_enabled():
    """Raise 404 unless ENABLE_DEBUG_ENDPOINTS=true (string)."""
    if os.getenv("ENABLE_DEBUG_ENDPOINTS", "false").lower() != "true":
        raise HTTPException(status_code=404, detail="Not found")


class Token(BaseModel):
    access_token: str
    token_type: str


class TokenData(BaseModel):
    email: str | None = None


class UserBase(BaseModel):
    email: str
    entra_oid: str | None = None  # Add Entra OID as primary identifier
    roles: list[str] = []         # Add roles for Entra RBAC


class UserCreate(UserBase):
    password: str


class User(UserBase):
    id: str
    created_at: str
    updated_at: str


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


async def get_or_create_entra_user(cosmos_db, cached_user_service, email: str, entra_oid: str, roles: list = None) -> dict:
    """
    Get or create an Entra user with proper race condition handling.
    This function ensures only one user is created even if called simultaneously.
    Uses application-level locking to prevent concurrent user creation.
    """
    # Create a unique identifier for locking (prefer entra_oid, fallback to email)
    lock_identifier = entra_oid if entra_oid else email.lower().strip()

    # Get a lock for this specific user
    user_lock = await get_or_create_user_lock(lock_identifier)

    try:
        async with user_lock:
            logger.info(f"[AUTH][LOCK] Acquired lock for user creation: {lock_identifier}")

            # Double-check for existing user after acquiring lock
            existing_user = await cosmos_db.get_user_by_email(email)
            if existing_user:
                logger.info(f"[AUTH][LOCK] Found existing user by email after lock: {existing_user['id']}")
                # Update with Entra info if missing
                if not existing_user.get("entra_oid") and entra_oid:
                    existing_user["entra_oid"] = entra_oid
                    existing_user["auth_method"] = "entra"
                    existing_user["updated_at"] = datetime.now(timezone.utc).isoformat()
                    cosmos_db.auth_container.replace_item(item=existing_user, body=existing_user)
                    logger.info(f"[AUTH][LOCK] Updated existing user {existing_user['id']} with Entra info")
                return existing_user

            # Try to get by Entra OID
            if entra_oid:
                existing_user = await cosmos_db.get_user_by_entra_oid(entra_oid)
                if existing_user:
                    logger.info(f"[AUTH][LOCK] Found existing user by entra_oid after lock: {existing_user['id']}")
                    # Update email if different (case normalization)
                    if existing_user.get("email", "").lower() != email.lower():
                        existing_user["email"] = email.lower().strip()
                        existing_user["updated_at"] = datetime.now(timezone.utc).isoformat()
                        cosmos_db.auth_container.replace_item(item=existing_user, body=existing_user)
                        logger.info(f"[AUTH][LOCK] Updated existing user {existing_user['id']} with normalized email")
                    return existing_user

            # No existing user found, create new one
            timestamp = int(datetime.now(timezone.utc).timestamp() * 1000)  # milliseconds for uniqueness
            user_data = {
                "id": f"user_{timestamp}",
                "type": "user",
                "email": email.lower().strip(),
                "entra_oid": entra_oid,
                "roles": roles or ["standard"],
                "role": (roles[0] if roles and len(roles) > 0 else "standard"),  # Legacy compatibility
                "auth_method": "entra",
                "auth_type": "entra",  # Legacy compatibility
                "display_name": email.lower().strip(),
                "is_active": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }

            logger.info(f"[AUTH][LOCK] Creating new user with ID: {user_data['id']}")

            # Create user in database
            try:
                created_user = await cosmos_db.create_user(user_data)
                await cached_user_service.cache_user(created_user)
                logger.info(f"[AUTH][LOCK] Successfully created new Entra user: {created_user['id']} ({email})")
                return created_user
            except Exception as create_error:
                # If creation fails, try one more time to fetch existing user
                logger.warning(f"[AUTH][LOCK] User creation failed, checking for existing user: {create_error}")
                existing_user = await cosmos_db.get_user_by_email(email)
                if existing_user:
                    logger.info(f"[AUTH][LOCK] Found existing user after failed creation: {existing_user['id']}")
                    return existing_user
                else:
                    logger.error(f"[AUTH][LOCK] User creation failed and no existing user found: {create_error}")
                    raise create_error

    except Exception as e:
        logger.error(f"[AUTH][LOCK] Error in get_or_create_entra_user: {e}", exc_info=True)
        raise
    finally:
        # Clean up the lock after a delay to prevent immediate recreation
        asyncio.create_task(cleanup_user_lock_delayed(lock_identifier))

async def cleanup_user_lock_delayed(identifier: str):
    """Clean up a user lock after a delay to prevent immediate recreation."""
    await asyncio.sleep(5)  # Wait 5 seconds before cleanup
    await cleanup_user_lock(identifier)


def create_access_token(data: dict, config: AppConfig) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=config.auth["jwt_access_token_expire_minutes"]
    )
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(
        to_encode, config.auth["jwt_secret_key"], algorithm=config.auth["jwt_algorithm"]
    )
    return encoded_jwt


async def get_current_user(
    credentials = Depends(oauth2_scheme),
    config: AppConfig = Depends(get_app_config),
    cached_user_service: AzureCachedUserService = Depends(get_cached_user_service)
) -> Dict[str, Any]:
    """Legacy JWT authentication endpoint (cached)."""
    # Extract token from HTTPBearer credentials
    token = credentials.credentials if hasattr(credentials, 'credentials') else str(credentials)
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(
            token,
            config.auth["jwt_secret_key"],
            algorithms=[config.auth["jwt_algorithm"]],
        )
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
        token_data = TokenData(email=email)
    except JWTError:
        raise credentials_exception

    try:
        # Use cached user lookup
        user = await cached_user_service.get_user_by_email(email=token_data.email)
        if user is None:
            raise credentials_exception
        return user
    except Exception as e:
        raise credentials_exception


async def get_current_user_entra(
    credentials = Depends(oauth2_scheme),
    config: AppConfig = Depends(get_app_config),
    entra_auth: EntraAuthService = Depends(get_entra_auth_service),
    cached_user_service: AzureCachedUserService = Depends(get_cached_user_service),
    cosmos_db: CosmosDB = Depends(get_cosmos_db)
) -> Dict[str, Any]:
    """Validate Entra ID JWT, migrate user if needed, and extract user claims (cached)."""
    # Extract token from HTTPBearer credentials
    token = credentials.credentials if hasattr(credentials, 'credentials') else str(credentials)
    logger.info(f"[AUTH][ENTRA] get_current_user_entra called. Token (first 20 chars): {token[:20]}...")
    try:
        payload = entra_auth.verify_token(token)
        logger.info(f"[AUTH][ENTRA] Token verified. Claims: {payload}")
        # Extract user info (oid, email, roles)
        email = (
            payload.get("preferred_username")
            or payload.get("email")
            or payload.get("upn")
            or payload.get("unique_name")
        )
        # Normalize email to lowercase to ensure consistency
        if email:
            email = email.lower().strip()
        entra_oid = payload.get("oid")
        roles = payload.get("roles", [])
        if not email or not entra_oid:
            # Support application (app-only) tokens: identify by appidacr=1 or roles without scp
            app_id = payload.get("appid") or payload.get("azp")
            appidacr = str(payload.get("appidacr", "")).strip()
            scp = payload.get("scp")
            is_app_only = bool(app_id) and (appidacr == "1" or (roles and not scp))
            if is_app_only:
                logger.info(f"[AUTH][ENTRA] App-only token detected for appId={app_id}; roles={roles}")
                # Return a synthetic service principal identity; no Cosmos user lookup/creation
                return {
                    "id": f"app_{app_id}",
                    "email": None,
                    "entra_oid": None,
                    "roles": roles or [],
                    "auth_type": "entra_app",
                    "display_name": f"app:{app_id}",
                    "is_active": True,
                }
            logger.error(f"[AUTH][ENTRA] Missing email or Entra OID in token claims. Claims: {payload}")
            raise ValueError("Missing email or Entra OID in token claims.")

        logger.info(f"[AUTH][ENTRA] Processing user: {email} with OID: {entra_oid}")

        # Try to find user by entra_oid (cached)
        user = await cached_user_service.get_user_by_entra_oid(entra_oid)
        if user:
            logger.info(f"[AUTH][ENTRA] Found user by entra_oid: {user['id']}, roles: {user.get('roles', 'MISSING')}")

            # Ensure user has auth_type field for frontend compatibility
            user["auth_type"] = "entra"

            # Update last_login time
            user["last_login"] = datetime.now(timezone.utc).isoformat()

            # Ensure roles field exists and is not empty
            if not user.get("roles") or len(user.get("roles", [])) == 0:
                user["roles"] = ["standard"]
                logger.info(f"[AUTH][ENTRA] Set default roles for user: {user['id']}")

            # Update user in database with last_login
            try:
                await cosmos_db.update_user(user["id"], {"last_login": user["last_login"]})
                # Invalidate cache to ensure fresh data on next request
                cached_user_service.invalidate_user_cache(entra_oid, "entra_oid")
                if user.get("email"):
                    cached_user_service.invalidate_user_cache(user["email"], "email")
                logger.debug(f"[AUTH][ENTRA] Updated last_login for user: {user['id']}")
            except Exception as e:
                logger.warning(f"[AUTH][ENTRA] Failed to update last_login for user {user['id']}: {e}")

            logger.info(f"[AUTH][ENTRA] Returning existing user: {user['id']} with roles: {user.get('roles', [])}")
            logger.debug(f"[AUTH][ENTRA] Complete user data being returned: {user}")
            return user

        # Try to find user by email (legacy user - cached)
        user = await cached_user_service.get_user_by_email(email)
        if user:
            logger.info(f"[AUTH][ENTRA] Found user by email, migrating: {user['id']}")
            # Migrate legacy user: add entra_oid and preserve existing roles
            user["entra_oid"] = entra_oid

            # Only update roles if the token contains role information
            # Preserve existing roles if token has no roles or empty roles
            if roles and len(roles) > 0:
                logger.info(f"[AUTH][ENTRA] Updating user roles from token: {roles}")
                user["roles"] = roles
            elif "roles" not in user or not user.get("roles"):
                # User has no roles, set default
                logger.info(f"[AUTH][ENTRA] Setting default roles for user without roles")
                user["roles"] = ["standard"]
            else:
                # Keep existing roles
                logger.info(f"[AUTH][ENTRA] Preserving existing user roles: {user.get('roles', [])}")

            await cosmos_db.update_user(user)
            # Invalidate cache for this user
            await cached_user_service.invalidate_user_cache(user_id=user["id"], email=email, entra_oid=entra_oid)
            logger.info(f"[AUTH][ENTRA] Returning migrated user: {user['id']}, roles: {user.get('roles', 'MISSING')}")
            return user

        # Create new user using helper function to prevent race conditions
        logger.info(f"[AUTH][ENTRA] No existing user found, creating new user for: {email}")
        return await get_or_create_entra_user(cosmos_db, cached_user_service, email, entra_oid, roles)
    except Exception as e:
        logger.error(f"[AUTH] Exception in get_current_user_entra: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid Entra ID token or user migration error: {e}")


async def authenticate_user(
    cached_user_service: AzureCachedUserService, email: str, password: str
) -> Dict[str, Any] | bool:
    """Authenticate user credentials (cached)."""
    user = await cached_user_service.get_user_by_email(email)
    if not user:
        return False
    if not verify_password(password, user["hashed_password"]):
        return False
    return user


@router.post("/login")
async def login_for_access_token(
    request: Request,
    config: AppConfig = Depends(get_app_config),
    cached_user_service: AzureCachedUserService = Depends(get_cached_user_service)
):
    """Handle user login and token generation (cached)."""
    try:
        # If legacy auth is disabled, hide this endpoint
        if not config.auth_config.is_legacy_enabled():
            logger.info("/login called but legacy authentication is disabled; returning 404")
            raise HTTPException(status_code=404, detail="Not found")

        # Parse request data
        data = await request.json()
        email = data.get("email")
        password = data.get("password")

        # Normalize email to lowercase to ensure consistency
        if email:
            email = email.lower().strip()

        # Validate inputs
        if not email or not password:
            logger.warning("Login attempt with missing email or password")
            return {"status": 400, "message": "Email and password are required"}

        try:
            logger.debug("Cached user service initialized for login")
        except DatabaseError as e:
            logger.error(f"Service initialization failed: {str(e)}")
            return {"status": 503, "message": "Service unavailable"}

        # Authenticate user (cached)
        try:
            user = await authenticate_user(cached_user_service, email, password)
            if not user:
                logger.warning(f"Failed login attempt for email: {email}")
                return {"status": 401, "message": "Incorrect email or password"}

            # Generate access token
            access_token = create_access_token(
                data={"sub": user["email"]}, config=config
            )

            # Note: No legacy login audit emission to avoid noise in Entra-only flows

            logger.info(f"Successful login for user: {email}")
            return {
                "status": 200,
                "message": "Login successful",
                "access_token": access_token,
                "token_type": "bearer",
            }
        except Exception as e:
            logger.error(f"Error during authentication: {str(e)}", exc_info=True)
            return {"status": 500, "message": f"Authentication error: {str(e)}"}

    except Exception as e:
        logger.error(f"Unexpected error during login: {str(e)}", exc_info=True)
        return {"status": 500, "message": f"An unexpected error occurred: {str(e)}"}


@router.post("/register")
async def register_user(
    request: Request,
    config: AppConfig = Depends(get_app_config),
    cached_user_service: AzureCachedUserService = Depends(get_cached_user_service),
    cosmos_db: CosmosDB = Depends(get_cosmos_db)
) -> dict:
    """Handle user registration (cached)."""
    try:
        data = await request.json()
        email = data.get("email")
        password = data.get("password")

        # Normalize email to lowercase to ensure consistency
        if email:
            email = email.lower().strip()

        if not email or not password:
            logger.warning("Registration attempt with missing email or password")
            return {"status": 400, "message": "Email and password are required"}

        try:
            logger.debug("Cached user service initialized")
        except DatabaseError as e:
            logger.error(f"Service initialization failed: {str(e)}")
            return {"status": 503, "message": "Service unavailable"}

        # Check if user already exists (cached)
        try:
            existing_user = await cached_user_service.get_user_by_email(email)
            if existing_user:
                logger.warning(f"Registration attempt for existing email: {email}")
                return {"status": 400, "message": "Email already registered"}
        except ValueError as e:
            logger.error(f"Error checking existing user: {str(e)}", exc_info=True)
            return {
                "status": 500,
                "message": f"Error checking user existence: {str(e)}",
            }

        # Create new user document
        timestamp = int(
            datetime.now(timezone.utc).timestamp() * 1000
        )  # milliseconds since epoch
        user_data = {
            "id": f"user_{timestamp}",
            "type": "user",
            "email": email,
            "hashed_password": get_password_hash(password),
            "role": "standard",  # Default role for new legacy users
            "roles": ["standard"],  # Default roles array for compatibility
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        logger.debug(f"Attempting to create user with data: {user_data}")

        try:
            created_user = await cosmos_db.create_user(user_data)
            # Cache the new user
            await cached_user_service.cache_user(created_user)
            logger.info(f"User successfully created with ID: {created_user['id']}")
            return {"status": 200, "message": f"User {email} created successfully"}
        except ValueError as e:
            logger.error(f"Error creating user: {str(e)}", exc_info=True)
            return {"status": 500, "message": f"Error creating user: {str(e)}"}
        except Exception as e:
            logger.error(f"Unexpected error creating user: {str(e)}", exc_info=True)
            return {
                "status": 500,
                "message": f"Unexpected error creating user: {str(e)}",
            }

    except Exception as e:
        logger.error(f"Unexpected error during registration: {str(e)}", exc_info=True)
        return {"status": 500, "message": f"An unexpected error occurred: {str(e)}"}

def require_role(required_role: str):
    def role_checker(user=Depends(get_current_user_cached)):
        if required_role not in user.get("roles", []):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"User does not have required role: {required_role}"
            )
        return user
    return role_checker


def require_role_cached(required_roles: list[str]):
    """
    Role-based access control using cached authentication.
    Args:
        required_roles: List of roles that are allowed (e.g., ["admin", "moderator"])
    """
    def role_checker(user: Dict[str, Any] = Depends(get_current_user_cached)):
        user_roles = user.get("roles", [])
        # Debug log for admin/role check
        logger.warning(f"[ADMIN CHECK] User: {user.get('email')}, OID: {user.get('entra_oid')}, Roles: {user_roles}, Required: {required_roles}")
        if not any(role in user_roles for role in required_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"User does not have required role. Required: {required_roles}, User has: {user_roles}"
            )
        return user
    return role_checker


def require_admin_cached():
    """Shorthand for admin-only access using cached authentication."""
    return require_role_cached(["admin"])

# Example usage in a route:
# @router.post("/admin-action")
# async def admin_action(user=Depends(require_role("admin"))):
#     ...

@router.get("/me")
async def get_me(
    credentials = Depends(oauth2_scheme),
    config: AppConfig = Depends(get_app_config),
    cached_user_service: AzureCachedUserService = Depends(get_cached_user_service),
    entra_auth: EntraAuthService = Depends(get_entra_auth_service),
    user_mgmt_service = Depends(get_user_management_service),
    cosmos_db: CosmosDB = Depends(get_cosmos_db),
    audit_login: bool = Query(False, description="If true, emit a deduplicated LOGIN audit (12h window). Default false to avoid noise on profile calls."),
):
    """
    Return the current user's profile.

    Inputs:
    - Authorization: Bearer <token> (Entra ID access token preferred; legacy JWT supported)
    - audit_login (query, bool): if true, emits a deduplicated LOGIN audit (12h window)

    Output:
    - JSON user object with auth_type, roles, and identifiers; auto-creates a standard user when a valid Entra token is presented but the user record does not yet exist.
    """
    # Extract token from HTTPBearer credentials
    token = credentials.credentials if hasattr(credentials, 'credentials') else str(credentials)
    logger.info(f"[AUTH][ME] 🎯 /auth/me endpoint called - Token (first 20 chars): {token[:20] if token else 'missing'}")

    # Try Entra ID validation first
    try:
        payload = entra_auth.verify_token(token)
        # Extract user info (oid, email, roles)
        email = (
            payload.get("preferred_username")
            or payload.get("email")
            or payload.get("upn")
            or payload.get("unique_name")
        )
        entra_oid = payload.get("oid")
        roles = payload.get("roles", [])
        if not email or not entra_oid:
            app_id = payload.get("appid") or payload.get("azp")
            is_app_only = bool(app_id) and not payload.get("scp") and not payload.get("oid")
            if is_app_only:
                # Return a minimal profile for service principals
                return {
                    "id": f"app_{app_id}",
                    "auth_type": "entra_app",
                    "roles": roles or [],
                    "display_name": f"app:{app_id}",
                    "is_active": True,
                }
            raise ValueError("Missing email or Entra OID in token claims.")

        user = await cached_user_service.get_user_by_entra_oid(entra_oid)
        if not user:
            user = await cached_user_service.get_user_by_email(email)

        # Auto-create user if they don't exist but have valid Entra ID token
        if not user:
            # Extract name from token claims
            name = (
                payload.get("name")
                or payload.get("given_name", "") + " " + payload.get("family_name", "")
                or email.split("@")[0]
            ).strip()

            # Create new user with default role
            new_user = {
                "email": email,
                "name": name,
                "role": "standard",  # Default role
                "entra_oid": entra_oid,
                "auth_type": "entra",
                "roles": ["standard"],
                "created_via": "auto_entra_auth",
                "created_at": datetime.now(timezone.utc).isoformat()
            }

            # Try to save the new user to the database
            try:
                created_user = await user_mgmt_service.create_user({
                    "email": email,
                    "name": name,
                    "role": "standard"
                })
                if created_user:
                    user = created_user
                    user["auth_type"] = "entra"
                    user["entra_oid"] = entra_oid
                    user["roles"] = [user.get("role", "standard")]
                else:
                    # If creation failed, return the temporary user object
                    user = new_user
            except Exception as create_error:
                logger.warning(f"Warning: Could not auto-create user in database: {create_error}")
                # Return temporary user object even if DB creation fails
                user = new_user

        if user:
            user["auth_type"] = "entra"
            user["entra_oid"] = entra_oid
            user["roles"] = roles

            # Emit a deduplicated LOGIN audit only when explicitly requested via audit_login flag
            if audit_login:
                try:
                    now = datetime.now(timezone.utc)
                    last_login_iso = user.get("last_login")
                    should_log_login = True
                    if last_login_iso:
                        try:
                            from datetime import timedelta
                            last_login_dt = datetime.fromisoformat(last_login_iso)
                            # Only log again if it's been more than 12 hours
                            if now - last_login_dt < timedelta(hours=12):
                                should_log_login = False
                        except Exception:
                            # If parsing fails, proceed to log and reset
                            should_log_login = True
                    if should_log_login:
                        from app.services.cosmos_audit_service import CosmosAuditService
                        audit_service = CosmosAuditService(cosmos_db)
                        audit_service.log_user_action(
                            user_id=user.get("id", entra_oid),
                            action_type="LOGIN",
                            message=f"User {email} logged in via Entra ID",
                            details={"email": email, "auth_method": "entra_id"}
                        )
                        # Update last_login to suppress duplicates
                        try:
                            user["last_login"] = now.isoformat()
                            await user_mgmt_service.update_user(user.get("id"), {"last_login": user["last_login"]})
                        except Exception:
                            pass
                except Exception as audit_error:
                    logger.error(f"LOGIN AUDIT ERROR: {audit_error}")

            return user
    except Exception:
        pass  # Not a valid Entra token, try legacy

    # Try legacy JWT validation
    try:
        payload = jwt.decode(
            token,
            config.auth["jwt_secret_key"],
            algorithms=[config.auth["jwt_algorithm"]],
        )
        email: str = payload.get("sub")
        if not email:
            raise HTTPException(status_code=401, detail="Invalid legacy token: no subject")
        user = await cached_user_service.get_user_by_email(email=email)
        if user:
            user["auth_type"] = "legacy"
            # ALWAYS ensure legacy users have proper role fields for frontend compatibility
            current_role = user.get("role")

            # If no role field exists, default to "standard"
            if not current_role:
                user["role"] = "standard"
                current_role = "standard"

            # Always ensure roles array exists and matches the role field
            user["roles"] = [current_role]

            # Add timestamp to help with frontend caching issues
            user["_debug_timestamp"] = datetime.now(timezone.utc).isoformat()
            return user
        raise HTTPException(status_code=401, detail="User not found for legacy token")
    except Exception as e:
        raise HTTPException(status_code=401, detail="Invalid authentication token")


# Enhanced authentication dependencies using dependency injection
async def get_current_user_cached(
    credentials = Depends(oauth2_scheme),
    cached_user_service: AzureCachedUserService = Depends(get_cached_user_service),
    entra_auth: EntraAuthService = Depends(get_entra_auth_service),
    config: AppConfig = Depends(get_app_config),
    cosmos_db: CosmosDB = Depends(get_cosmos_db)
) -> Dict[str, Any]:
    """
    Enhanced universal authentication dependency with caching and dependency injection.
    Supports both Entra ID and legacy JWT tokens.
    """
    # Initialize audit logger
    try:
        from app.services.cosmos_audit_service import CosmosAuditService
        audit_service = CosmosAuditService(cosmos_db)
        logger.info(f"[AUTH][CACHED] ✅ Audit service initialized successfully")
    except ImportError as e:
        logger.error(f"[AUTH][CACHED] ❌ ImportError loading audit service: {e}")
        audit_service = None
    except Exception as e:
        logger.error(f"[AUTH][CACHED] ❌ Error initializing audit service: {e}", exc_info=True)
        audit_service = None

    # Extract token from HTTPBearer credentials
    token = credentials.credentials if hasattr(credentials, 'credentials') else str(credentials)

    # Try Entra ID validation first
    try:
        logger.info(f"[AUTH][CACHED] Attempting Entra token validation. Token (first 20 chars): {token[:20]}...")
        payload = entra_auth.verify_token(token)
        logger.info(f"[AUTH][CACHED] Entra token payload: {payload}")

        entra_oid = payload.get("oid")
        email = (
            payload.get("preferred_username")
            or payload.get("email")
            or payload.get("upn")
            or payload.get("unique_name")
        )
        roles = payload.get("roles", None)
        if not email or not entra_oid:
            # Support application (app-only) tokens: identify by appidacr=1 or roles without scp
            app_id = payload.get("appid") or payload.get("azp")
            appidacr = str(payload.get("appidacr", "")).strip()
            scp = payload.get("scp")
            is_app_only = bool(app_id) and (appidacr == "1" or (roles and not scp))
            if is_app_only:
                app_identity = {
                    "id": f"app_{app_id}",
                    "email": None,
                    "entra_oid": None,
                    "roles": (roles if isinstance(roles, list) else []) or [],
                    "auth_type": "entra_app",
                    "display_name": f"app:{app_id}",
                    "is_active": True,
                }
                logger.info(f"[AUTH][CACHED] App-only token accepted for appId={app_id}; roles={app_identity['roles']}")
                return app_identity
            logger.error(f"[AUTH][CACHED] Missing email or Entra OID in token claims. Claims: {payload}")
            raise ValueError("Missing email or Entra OID in token claims.")

        # Use cached lookup for Entra ID user
        user = await cached_user_service.get_user_by_entra_oid(entra_oid)
        if not user:
            user = await cached_user_service.get_user_by_email(email)

        if user:
            logger.warning(f"[AUTH][CACHED][DEBUG] User object after DB fetch: {user}")
            user["auth_type"] = "entra"
            user["entra_oid"] = entra_oid
            # Only overwrite roles if present in token and non-empty, otherwise preserve DB value
            if roles is not None and isinstance(roles, list) and len(roles) > 0:
                user["roles"] = roles
            # Defensive fallback: if roles is missing or empty, set to [user["role"]] or ["standard"]
            if "roles" not in user or not isinstance(user["roles"], list) or len(user["roles"]) == 0:
                fallback_role = user.get("role", "standard")
                user["roles"] = [fallback_role]
                logger.warning(f"[AUTH][CACHED][DEBUG] Defensive fallback: roles set to {user['roles']}")

            # NO audit logging here to prevent duplicates

            return user
        else:
            # Create new user record for Entra ID user using helper function
            logger.info(f"[AUTH][CACHED] Creating new Entra user: {email}")

            try:
                from app.core.config import CosmosDB
                from app.core.dependencies import get_cosmos_db

                # Get CosmosDB instance
                cosmos_db = CosmosDB(config)

                # Use helper function to prevent race conditions
                user_data = await get_or_create_entra_user(cosmos_db, cached_user_service, email, entra_oid, roles if roles else ["standard"])
                user_data["auth_type"] = "entra"

                # NO audit logging here to prevent duplicates

                logger.info(f"[AUTH][CACHED] Created new Entra user: {user_data.get('id', 'unknown')}")
                return user_data

            except Exception as create_error:
                logger.error(f"[AUTH][CACHED] Failed to create new Entra user: {create_error}")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Failed to create user account: {str(create_error)}"
                )

    except Exception as e:
        logger.debug(f"[AUTH][CACHED] Entra token validation failed: {e}")
        pass  # Not a valid Entra token, try legacy

    # Try legacy JWT validation
    try:
        logger.info(f"[AUTH][CACHED] Attempting legacy JWT validation. Token (first 20 chars): {token[:20]}...")
        payload = jwt.decode(
            token,
            config.auth["jwt_secret_key"],
            algorithms=[config.auth["jwt_algorithm"]],
        )
        logger.info(f"[AUTH][CACHED] Legacy JWT payload: {payload}")

        email: str = payload.get("sub")
        if not email:
            logger.error(f"[AUTH][CACHED] Invalid legacy token: no subject. Payload: {payload}")
            raise HTTPException(status_code=401, detail="Invalid legacy token: no subject")

        # Use cached lookup for legacy user
        user = await cached_user_service.get_user_by_email(email=email)
        if user:
            user["auth_type"] = "legacy"

            # Ensure proper role fields for legacy users
            current_role = user.get("role")
            if not current_role:
                user["role"] = "standard"
                current_role = "standard"

            # Always ensure roles array exists and matches the role field
            user["roles"] = [current_role]

            logger.info(f"[AUTH][CACHED] Authenticated legacy user: {email}")
            return user

        logger.error(f"[AUTH][CACHED] User not found for legacy token. Email: {email}")
        raise HTTPException(status_code=401, detail="User not found for legacy token")

    except Exception as e:
        logger.error(f"[AUTH][CACHED] Legacy JWT validation failed: {e}", exc_info=True)

        # NO audit logging for auth failures to reduce noise

        raise HTTPException(status_code=401, detail="Invalid authentication token")



# Reference implementation: get_current_user_any with dependency injection, caching, and config enforcement
async def get_current_user_any(
    credentials = Depends(oauth2_scheme),
    config: AppConfig = Depends(get_app_config),
    cosmos_db: CosmosDB = Depends(get_cosmos_db),
    entra_service: EntraAuthService = Depends(get_entra_auth_service),
    auth_cache = Depends(get_auth_cache)
):
    """
    Enhanced universal dependency for endpoints: supports both Entra ID and legacy JWT tokens.
    Returns user dict or raises HTTPException(401).
    Respects AUTH_METHOD environment variable configuration.
    Includes caching for improved performance.
    """
    # Extract token from HTTPBearer credentials
    token = credentials.credentials if hasattr(credentials, 'credentials') else str(credentials)

    # Generate token hash for caching
    token_hash = generate_token_hash(token)
    # Try to get cached result first
    cached_user = auth_cache.get(token_hash)
    if cached_user:
        logger.info(f"[AUTH][UNIFIED][CACHED] Using cached authentication for user: {cached_user.get('id', 'unknown')}")
        return cached_user
    # Log current configuration
    logger.info(f"[AUTH][UNIFIED] Auth method: {config.auth_config.auth_method.value}, "
               f"Enabled methods: {config.auth_config.get_enabled_methods()}")
    user = None
    auth_error = None
    # Try Entra ID validation first (if enabled)
    if config.auth_config.is_entra_enabled() and entra_service:
        try:
            logger.info(f"[AUTH][UNIFIED] Attempting Entra token validation. Token (first 20 chars): {token[:20]}...")
            payload = entra_service.verify_token(token)
            logger.info(f"[AUTH][UNIFIED] Entra token payload: {payload}")
            entra_oid = payload.get("oid")
            email = (
                payload.get("preferred_username")
                or payload.get("email")
                or payload.get("upn")
                or payload.get("unique_name")
            )
            roles = payload.get("roles", [])
            if not email or not entra_oid:
                # Accept application tokens (client credentials) by appidacr=1 or roles without scp
                app_id = payload.get("appid") or payload.get("azp")
                appidacr = str(payload.get("appidacr", "")).strip()
                scp = payload.get("scp")
                is_app_only = bool(app_id) and (appidacr == "1" or (roles and not scp))
                if is_app_only:
                    logger.info(f"[AUTH][UNIFIED] App-only token detected for appId={app_id}; roles={roles}")
                    app_identity = {
                        "id": f"app_{app_id}",
                        "email": None,
                        "entra_oid": None,
                        "roles": roles or [],
                        "auth_type": "entra_app",
                        "display_name": f"app:{app_id}",
                        "is_active": True,
                    }
                    # Cache the successful authentication
                    auth_cache.set(token_hash, app_identity)
                    return app_identity
                logger.error(f"[AUTH][UNIFIED] Missing email or Entra OID in token claims. Claims: {payload}")
                raise ValueError("Missing email or Entra OID in token claims.")
            user = await cosmos_db.get_user_by_entra_oid(entra_oid)
            if not user:
                user = await cosmos_db.get_user_by_email(email)
            if user:
                # Migrate legacy user: add entra_oid and preserve existing roles
                user["entra_oid"] = entra_oid

                # Only update roles if the token contains role information
                # Preserve existing roles if token has no roles or empty roles
                if roles and len(roles) > 0:
                    logger.info(f"[AUTH][UNIFIED] Updating user roles from token: {roles}")
                    user["roles"] = roles
                elif "roles" not in user or not user.get("roles"):
                    # User has no roles, set default
                    logger.info(f"[AUTH][UNIFIED] Setting default roles for user without roles")
                    user["roles"] = ["standard"]
                else:
                    # Keep existing roles
                    logger.info(f"[AUTH][UNIFIED] Preserving existing user roles: {user.get('roles', [])}")

                await cosmos_db.update_user(user)
                user["auth_type"] = "entra"
                logger.info(f"[AUTH][UNIFIED] Authenticated Entra user: {user.get('id', 'unknown')}")
                # Cache the successful authentication
                auth_cache.set(token_hash, user)
                return user
            else:
                # Create new user record for Entra ID user using helper function
                logger.info(f"[AUTH][UNIFIED] Creating new Entra user: {email}")

                # Use a dummy cached_user_service for the helper function
                from app.services.cached_user_service import AzureCachedUserService
                cached_user_service = AzureCachedUserService(config)

                user_data = await get_or_create_entra_user(cosmos_db, cached_user_service, email, entra_oid, roles)
                user_data["auth_type"] = "entra"
                logger.info(f"[AUTH][UNIFIED] Created new Entra user: {user_data.get('id', 'unknown')}")
                # Cache the successful authentication
                auth_cache.set(token_hash, user_data)
                return user_data
        except Exception as e:
            logger.info(f"[AUTH][UNIFIED] Entra token validation failed: {e}")
            auth_error = f"Entra authentication failed: {e}"
            # Only raise if Entra is the only enabled method
            if not config.auth_config.is_legacy_enabled():
                logger.error(f"[AUTH][UNIFIED] Entra authentication failed and no fallback available")
                raise HTTPException(status_code=401, detail="Entra ID authentication failed")
    # Try legacy JWT validation (if enabled)
    if config.auth_config.is_legacy_enabled():
        try:
            logger.info(f"[AUTH][UNIFIED] Attempting legacy JWT validation. Token (first 20 chars): {token[:20]}...")
            payload = jwt.decode(
                token,
                config.auth["jwt_secret_key"],
                algorithms=[config.auth["jwt_algorithm"]],
            )
            logger.info(f"[AUTH][UNIFIED] Legacy JWT payload: {payload}")
            email: str = payload.get("sub")
            if not email:
                logger.error(f"[AUTH][UNIFIED] Invalid legacy token: no subject. Payload: {payload}")
                raise ValueError("Invalid legacy token: no subject")
            user = await cosmos_db.get_user_by_email(email=email)
            if user:
                user["auth_type"] = "legacy"
                logger.info(f"[AUTH][UNIFIED] Authenticated legacy user: {user.get('id', 'unknown')}")
                # Cache the successful authentication
                auth_cache.set(token_hash, user)
                return user
            logger.error(f"[AUTH][UNIFIED] User not found for legacy token. Email: {email}")
            raise ValueError("User not found for legacy token")
        except Exception as e:
            logger.error(f"[AUTH][UNIFIED] Legacy JWT validation failed: {e}")
            if auth_error:
                auth_error += f"; Legacy authentication failed: {e}"
            else:
                auth_error = f"Legacy authentication failed: {e}"
    # No authentication method succeeded
    enabled_methods = config.auth_config.get_enabled_methods()
    logger.error(f"[AUTH][UNIFIED] All authentication methods failed. Enabled: {enabled_methods}")
    error_detail = f"Authentication failed. Enabled methods: {enabled_methods}"
    if auth_error:
        error_detail += f". Details: {auth_error}"
    raise HTTPException(status_code=401, detail=error_detail)

# Example migration endpoint (admin only)
@router.get("/admin/users")
async def admin_list_users(
    filter: str = "",
    role: str = "",
    auth_method: str = "",
    skip: int = 0,
    limit: int = 100,
    current_user: dict = Depends(get_current_user_any),
    user_service = Depends(get_user_management_service)
):
    """List users - admin only (hybrid authentication)."""
    if "admin" not in current_user.get("roles", []) and current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    import logging
    logging.warning(f"[ADMIN USERS] current_user: {current_user}")
    users = await user_service.list_users(filter, role, auth_method, skip, limit)
    # Map roles array to a single role string for frontend compatibility
    for user in users:
        roles = user.get("roles")
        if isinstance(roles, list):
            if "admin" in roles:
                user["role"] = "admin"
            elif "power_user" in roles:
                user["role"] = "power_user"
            else:
                user["role"] = roles[0] if roles else "standard"
        elif isinstance(roles, str):
            user["role"] = roles
        else:
            user["role"] = "standard"
    return users

@router.post("/admin/users")
async def admin_create_user(
    user: dict,
    current_user: dict = Depends(get_current_user_any),
    user_service = Depends(get_user_management_service),
    cosmos_db: CosmosDB = Depends(get_cosmos_db)
):
    """Create user - admin only (hybrid authentication)."""
    if "admin" not in current_user.get("roles", []) and current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    created = await user_service.create_user(user)
    # Audit: User created
    try:
        from app.services.cosmos_audit_service import CosmosAuditService
        audit_service = CosmosAuditService(cosmos_db)
        target_email = (created or user).get("email") if isinstance(created, dict) else user.get("email")
        target_id = (created or {}).get("id") if isinstance(created, dict) else None
        audit_service.log_user_action(
            user_id=current_user.get("id", current_user.get("entra_oid", "unknown")),
            action_type="User created",
            message=f"Admin {current_user.get('email')} created user {target_email}",
            details={
                "target_user_id": target_id or "unknown",
                "target_email": target_email,
                "roles": (created or user).get("roles") or [(created or user).get("role", "standard")]
            }
        )
    except Exception:
        pass
    return created

@router.patch("/admin/users/{user_id}/role")
async def admin_update_user_role(
    user_id: str,
    new_role: str = Query(..., description="New role to assign to the user"),
    current_user: dict = Depends(get_current_user_any),
    user_service = Depends(get_user_management_service),
    cosmos_db: CosmosDB = Depends(get_cosmos_db)
):
    """Update user role - admin only (hybrid authentication)."""
    if "admin" not in current_user.get("roles", []) and current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    result = await user_service.update_user_role(user_id, new_role)
    # Audit: User role updated
    try:
        from app.services.cosmos_audit_service import CosmosAuditService
        audit_service = CosmosAuditService(cosmos_db)
        # Try fetch target email for context
        try:
            target = await user_service.get_user(user_id)
        except Exception:
            target = None
        audit_service.log_user_action(
            user_id=current_user.get("id", current_user.get("entra_oid", "unknown")),
            action_type="User role updated",
            message=f"Admin {current_user.get('email')} set role for user {user_id} to {new_role}",
            details={
                "target_user_id": user_id,
                "target_email": (target or {}).get("email"),
                "new_role": new_role
            }
        )
    except Exception:
        pass
    return result

@router.patch("/admin/users/{user_id}/password")
async def admin_update_user_password(
    user_id: str,
    new_password: str = Query(..., description="New password for the user"),
    current_user: dict = Depends(get_current_user_any),
    user_service = Depends(get_user_management_service),
    cosmos_db: CosmosDB = Depends(get_cosmos_db)
):
    """Update user password - admin only (hybrid authentication)."""
    if "admin" not in current_user.get("roles", []) and current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    result = await user_service.update_user_password(user_id, new_password)
    # Audit: User password reset (do not include password)
    try:
        from app.services.cosmos_audit_service import CosmosAuditService
        audit_service = CosmosAuditService(cosmos_db)
        # Try fetch target email for context
        try:
            target = await user_service.get_user(user_id)
        except Exception:
            target = None
        audit_service.log_user_action(
            user_id=current_user.get("id", current_user.get("entra_oid", "unknown")),
            action_type="User password reset",
            message=f"Admin {current_user.get('email')} reset password for user {user_id}",
            details={
                "target_user_id": user_id,
                "target_email": (target or {}).get("email")
            }
        )
    except Exception:
        pass
    return result

@router.delete("/admin/users/{user_id}")
async def admin_delete_user(
    user_id: str,
    current_user: dict = Depends(get_current_user_any),
    user_service = Depends(get_user_management_service),
    cosmos_db: CosmosDB = Depends(get_cosmos_db)
):
    """Delete user - admin only (hybrid authentication)."""
    if "admin" not in current_user.get("roles", []) and current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    # Fetch target details before deletion for audit context
    try:
        target = await user_service.get_user(user_id)
    except Exception:
        target = None
    result = await user_service.delete_user(user_id)
    # Audit: User deleted
    try:
        from app.services.cosmos_audit_service import CosmosAuditService
        audit_service = CosmosAuditService(cosmos_db)
        audit_service.log_user_action(
            user_id=current_user.get("id", current_user.get("entra_oid", "unknown")),
            action_type="User deleted",
            message=f"Admin {current_user.get('email')} deleted user {user_id}",
            details={
                "target_user_id": user_id,
                "target_email": (target or {}).get("email")
            }
        )
    except Exception:
        pass
    return result


def role_required(roles: list[str]):
    def decorator(func):
        async def wrapper(*args, current_user: dict = Depends(get_current_user), **kwargs):
            user_roles = current_user.get("roles", [])
            if not any(role in user_roles for role in roles):
                raise HTTPException(status_code=403, detail="Insufficient role")
            return await func(*args, current_user=current_user, **kwargs)
        return wrapper
    return decorator

async def get_current_user_hybrid(
    credentials = Depends(oauth2_scheme),
    config: AppConfig = Depends(get_app_config),
    cached_user_service: AzureCachedUserService = Depends(get_cached_user_service),
    entra_auth: EntraAuthService = Depends(get_entra_auth_service)
) -> Dict[str, Any]:
    """Hybrid authentication: try both Entra ID and legacy JWT (cached)."""

    # Extract token from HTTPBearer credentials
    token = credentials.credentials if hasattr(credentials, 'credentials') else str(credentials)

    # Try Entra ID first
    try:
        payload = entra_auth.verify_token(token)
        entra_oid = payload.get("oid")
        if entra_oid:
            user = await cached_user_service.get_user_by_entra_oid(entra_oid)
            if user:
                return user
    except Exception:
        pass

    # Fallback to legacy JWT
    try:
        payload = jwt.decode(token, config.auth["jwt_secret_key"], algorithms=[config.auth["jwt_algorithm"]])
        email: str = payload.get("sub")
        if email:
            user = await cached_user_service.get_user_by_email(email=email)
            if user:
                return user
    except Exception:
        pass

    raise HTTPException(status_code=401, detail="Could not validate credentials")

async def get_current_user_logout_only(
    credentials = Depends(oauth2_scheme),
    config: AppConfig = Depends(get_app_config),
    entra_auth: EntraAuthService = Depends(get_entra_auth_service),
    cosmos_db: CosmosDB = Depends(get_cosmos_db)
) -> Dict[str, Any]:
    """Minimal authentication for logout - no caching, no audit logging."""

    # Extract token from HTTPBearer credentials
    token = credentials.credentials if hasattr(credentials, 'credentials') else str(credentials)

    # Try Entra ID first
    try:
        payload = entra_auth.verify_token(token)
        entra_oid = payload.get("oid")
        email = (
            payload.get("preferred_username")
            or payload.get("email")
            or payload.get("upn")
            or payload.get("unique_name")
        )
        if entra_oid and email:
            # Direct DB lookup without caching
            user = await cosmos_db.get_user_by_entra_oid(entra_oid)
            if not user:
                user = await cosmos_db.get_user_by_email(email)
            if user:
                return user
    except Exception:
        pass

    # Fallback to legacy JWT
    try:
        payload = jwt.decode(token, config.auth["jwt_secret_key"], algorithms=[config.auth["jwt_algorithm"]])
        email: str = payload.get("sub")
        if email:
            # Direct DB lookup without caching
            user = await cosmos_db.get_user_by_email(email)
            if user:
                return user
    except Exception:
        pass

    raise HTTPException(status_code=401, detail="Could not validate credentials")

def _extract_token_from_auth_header(request: Request) -> Optional[str]:
    auth_header = request.headers.get("authorization") or request.headers.get("Authorization")
    if not auth_header:
        return None
    parts = auth_header.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return auth_header.strip()

async def _resolve_user_for_logout(
    token: Optional[str],
    entra_auth: EntraAuthService,
    config: AppConfig,
    cosmos_db: CosmosDB,
    cached_user_service: AzureCachedUserService,
) -> tuple[str, str]:
    """Return (user_id, user_email) best-effort; never raises."""
    if not token:
        return "unknown", "unknown"
    # Try Entra first
    try:
        payload = entra_auth.verify_token(token)
        entra_oid = payload.get("oid")
        email = (
            payload.get("preferred_username")
            or payload.get("email")
            or payload.get("upn")
            or payload.get("unique_name")
        )
        if entra_oid or email:
            user = None
            if entra_oid:
                try:
                    user = await cached_user_service.get_user_by_entra_oid(entra_oid)
                except Exception:
                    user = None
            if (not user) and email:
                try:
                    user = await cached_user_service.get_user_by_email(email)
                except Exception:
                    user = None
            if (not user) and entra_oid:
                try:
                    user = await cosmos_db.get_user_by_entra_oid(entra_oid)
                except Exception:
                    user = None
            if (not user) and email:
                try:
                    user = await cosmos_db.get_user_by_email(email)
                except Exception:
                    user = None
            user_id = (user or {}).get("id") or entra_oid or "unknown"
            user_email = (user or {}).get("email") or (email or "unknown")
            return user_id, user_email
    except Exception:
        pass
    # Fallback to legacy
    try:
        payload = jwt.decode(token, config.auth["jwt_secret_key"], algorithms=[config.auth["jwt_algorithm"]])
        email: str = payload.get("sub")
        if email:
            user = None
            try:
                user = await cached_user_service.get_user_by_email(email=email)
            except Exception:
                user = None
            if not user:
                try:
                    user = await cosmos_db.get_user_by_email(email)
                except Exception:
                    user = None
            return (user or {}).get("id", "unknown"), email
    except Exception:
        pass
    return "unknown", "unknown"

@router.post("/logout")
@router.get("/logout")
async def logout(
    request: Request,
    cosmos_db: CosmosDB = Depends(get_cosmos_db),
    entra_auth: EntraAuthService = Depends(get_entra_auth_service),
    config: AppConfig = Depends(get_app_config),
    cached_user_service: AzureCachedUserService = Depends(get_cached_user_service),
):
    """Best-effort logout with audit logging (works even if token already cleared)."""

    token = _extract_token_from_auth_header(request)
    user_id, user_email = await _resolve_user_for_logout(token, entra_auth, config, cosmos_db, cached_user_service)

    logger.info(f"LOGOUT: {user_email} initiating logout (user_id={user_id})")

    audit_success = False
    try:
        from app.services.cosmos_audit_service import CosmosAuditService
        audit_service = CosmosAuditService(cosmos_db)

        result = audit_service.log_user_action(
            user_id=user_id,
            action_type="LOGOUT",
            message=f"User {user_email} logged out",
            details={
                "email": user_email,
                "had_token": bool(token),
                "token_prefix": (token[:12] + "...") if token else "",
            }
        )
        audit_success = bool(result)
    except Exception as e:
        logger.error(f"LOGOUT AUDIT ERROR: {e}", exc_info=True)

    return {"message": "Logged out successfully", "audit_logged": audit_success, "user": {"id": user_id, "email": user_email}}

@router.get("/session/validate")
async def validate_session(current_user: dict = Depends(get_current_user_hybrid)):
    return {"status": "active", "user": current_user}

@router.get("/admin/users/{user_id}/debug")
async def debug_user_data(
    user_id: str,
    current_user: dict = Depends(get_current_user_any),
    user_service = Depends(get_user_management_service)
):
    """Debug endpoint to see raw user data from database. Admin only (hybrid authentication)."""
    _ensure_debug_enabled()
    if "admin" not in current_user.get("roles", []) and current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    user = await user_service.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Return raw user data for debugging
    return {
        "user_data": user,
        "debug_info": {
            "has_role_field": "role" in user,
            "has_roles_field": "roles" in user,
            "role_value": user.get("role"),
            "roles_value": user.get("roles"),
            "role_type": type(user.get("role")).__name__,
            "roles_type": type(user.get("roles")).__name__,
            "last_updated": user.get("updated_at"),
            "user_id": user.get("id"),
            "email": user.get("email")
        }
    }

@router.get("/debug/me")
async def debug_me_endpoint(current_user: dict = Depends(get_current_user_cached)):
    """Debug version of /me endpoint with extra information (cached authentication)."""
    _ensure_debug_enabled()
    return {
        "user_data": current_user,
        "debug_info": {
            "has_role_field": "role" in current_user,
            "has_roles_field": "roles" in current_user,
            "role_value": current_user.get("role"),
            "roles_value": current_user.get("roles"),
            "role_type": type(current_user.get("role")).__name__,
            "roles_type": type(current_user.get("roles")).__name__,
            "auth_type": current_user.get("auth_type"),
            "email": current_user.get("email"),
            "user_id": current_user.get("id"),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    }

# Add legacy compatibility alias
get_current_user_any = get_current_user_cached

@router.get("/debug-audit-test")
async def debug_audit_test(cosmos_db: CosmosDB = Depends(get_cosmos_db)):
    """Test endpoint to verify audit logging is working."""
    _ensure_debug_enabled()
    try:
        from app.services.cosmos_audit_service import CosmosAuditService
        audit_service = CosmosAuditService(cosmos_db)

        logger.info("[DEBUG-AUDIT] 🔍 Testing audit logging...")

        # Check if cosmos_db has audit containers
        logger.info(f"[DEBUG-AUDIT] Cosmos DB attributes: {dir(cosmos_db)}")

        result = audit_service.log_user_action(
            user_id="debug_test_user",
            action_type="DEBUG_AUDIT_TEST",
            message="Debug audit test from /debug-audit-test endpoint",
            details={
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "test_type": "manual_test",
                "endpoint": "/debug-audit-test"
            }
        )
        logger.info(f"[DEBUG-AUDIT] ✅ Audit logging test result: {result}")

        return {
            "success": result,
            "message": "Audit log created successfully" if result else "Audit log failed",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "cosmos_db_attrs": [attr for attr in dir(cosmos_db) if 'container' in attr.lower()]
        }
    except Exception as e:
        logger.error(f"[DEBUG-AUDIT] ❌ Audit test failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
