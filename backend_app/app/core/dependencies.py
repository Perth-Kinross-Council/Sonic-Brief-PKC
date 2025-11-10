"""
Enhanced dependency injection module for Azure-optimized authentication system.
Provides singleton services, connection pooling, and optimized resource management.
"""
import logging
import hashlib
from typing import Dict, Any, Optional, TYPE_CHECKING
from functools import lru_cache
from fastapi import Depends
import time
from threading import Lock

from app.core.config import AppConfig, CosmosDB
from app.services.entra_auth import EntraAuthService
from app.services.cached_user_service import AzureCachedUserService

if TYPE_CHECKING:
    from app.services.user_management_service import UserManagementService

# Setup logging
logger = logging.getLogger(__name__)

# Global instances and locks for thread-safe singleton pattern
_config_instance: Optional[AppConfig] = None
_cosmos_instance: Optional[CosmosDB] = None
_entra_service_instance: Optional[EntraAuthService] = None
_cached_user_service_instance: Optional[AzureCachedUserService] = None
_config_lock = Lock()
_cosmos_lock = Lock()
_entra_lock = Lock()
_cached_user_lock = Lock()


def generate_token_hash(token: str) -> str:
    """
    Generate a SHA256 hash of the token for caching purposes.
    This provides a consistent key for caching without storing the actual token.
    """
    return hashlib.sha256(token.encode()).hexdigest()


@lru_cache(maxsize=1)
def get_app_config() -> AppConfig:
    """
    Get singleton AppConfig instance with caching.
    Thread-safe singleton pattern with LRU cache for performance.
    """
    global _config_instance
    
    if _config_instance is None:
        with _config_lock:
            # Double-check locking pattern
            if _config_instance is None:
                logger.info("[DEPS] Initializing AppConfig singleton")
                _config_instance = AppConfig()
                logger.info(f"[DEPS] AppConfig initialized with auth methods: {_config_instance.auth_config.get_enabled_methods()}")
    
    return _config_instance


def get_cosmos_db(config: AppConfig = Depends(get_app_config)) -> CosmosDB:
    """
    Get singleton CosmosDB instance with connection pooling.
    Thread-safe singleton pattern for database connections.
    """
    global _cosmos_instance
    
    if _cosmos_instance is None:
        with _cosmos_lock:
            # Double-check locking pattern
            if _cosmos_instance is None:
                logger.info("[DEPS] Initializing CosmosDB singleton")
                _cosmos_instance = CosmosDB(config)
                logger.info("[DEPS] CosmosDB initialized with connection pooling")
    
    return _cosmos_instance


def get_entra_service(config: AppConfig = Depends(get_app_config)) -> Optional[EntraAuthService]:
    """
    Get singleton EntraAuthService instance if Entra authentication is enabled.
    Returns None if Entra authentication is disabled.
    """
    global _entra_service_instance
    
    # Return None if Entra authentication is not enabled
    if not config.auth_config.is_entra_enabled():
        logger.debug("[DEPS] Entra authentication disabled, returning None")
        return None
    
    if _entra_service_instance is None:
        with _entra_lock:
            # Double-check locking pattern
            if _entra_service_instance is None:
                logger.info("[DEPS] Initializing EntraAuthService singleton")
                try:
                    _entra_service_instance = EntraAuthService(config)
                    logger.info("[DEPS] EntraAuthService initialized successfully")
                except Exception as e:
                    logger.error(f"[DEPS] Failed to initialize EntraAuthService: {e}")
                    # Don't raise exception, return None to allow fallback
                    return None
    
    return _entra_service_instance


class AuthenticationCache:
    """
    Simple in-memory cache for authentication results to reduce repeated validations.
    Implements TTL (Time To Live) for cache entries.
    """
    
    def __init__(self, ttl_seconds: int = 300):  # 5 minutes default TTL
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._ttl_seconds = ttl_seconds
        self._lock = Lock()
        logger.info(f"[DEPS] AuthenticationCache initialized with TTL: {ttl_seconds}s")
    
    def get(self, token_hash: str) -> Optional[Dict[str, Any]]:
        """Get cached authentication result if still valid"""
        with self._lock:
            if token_hash in self._cache:
                entry = self._cache[token_hash]
                if time.time() - entry["timestamp"] < self._ttl_seconds:
                    logger.debug(f"[DEPS] Cache hit for token hash: {token_hash[:10]}...")
                    return entry["user_data"]
                else:
                    # Expired, remove from cache
                    del self._cache[token_hash]
                    logger.debug(f"[DEPS] Cache expired for token hash: {token_hash[:10]}...")
            
            logger.debug(f"[DEPS] Cache miss for token hash: {token_hash[:10]}...")
            return None
    
    def set(self, token_hash: str, user_data: Dict[str, Any]) -> None:
        """Cache authentication result"""
        with self._lock:
            self._cache[token_hash] = {
                "user_data": user_data,
                "timestamp": time.time()
            }
            logger.debug(f"[DEPS] Cached authentication result for token hash: {token_hash[:10]}...")
    
    def invalidate(self, token_hash: str) -> None:
        """Invalidate cached entry"""
        with self._lock:
            if token_hash in self._cache:
                del self._cache[token_hash]
                logger.debug(f"[DEPS] Invalidated cache for token hash: {token_hash[:10]}...")
    
    def clear(self) -> None:
        """Clear all cached entries"""
        with self._lock:
            cache_size = len(self._cache)
            self._cache.clear()
            logger.info(f"[DEPS] Cleared authentication cache ({cache_size} entries)")
    
    def stats(self) -> Dict[str, Any]:
        """Get cache statistics"""
        with self._lock:
            current_time = time.time()
            valid_entries = sum(
                1 for entry in self._cache.values()
                if current_time - entry["timestamp"] < self._ttl_seconds
            )
            return {
                "total_entries": len(self._cache),
                "valid_entries": valid_entries,
                "expired_entries": len(self._cache) - valid_entries,
                "ttl_seconds": self._ttl_seconds
            }


# Global cache instance
_auth_cache_instance: Optional[AuthenticationCache] = None
_cache_lock = Lock()


def get_auth_cache() -> AuthenticationCache:
    """Get singleton AuthenticationCache instance"""
    global _auth_cache_instance
    
    if _auth_cache_instance is None:
        with _cache_lock:
            if _auth_cache_instance is None:
                logger.info("[DEPS] Initializing AuthenticationCache singleton")
                _auth_cache_instance = AuthenticationCache()
    
    return _auth_cache_instance


# Global user management service instance
_user_management_service_instance: Optional['UserManagementService'] = None
_user_management_lock = Lock()


def get_user_management_service(config: AppConfig = Depends(get_app_config)) -> 'UserManagementService':
    """
    Get singleton UserManagementService instance.
    Thread-safe singleton pattern for user management service.
    """
    global _user_management_service_instance
    
    if _user_management_service_instance is None:
        with _user_management_lock:
            # Double-check locking pattern
            if _user_management_service_instance is None:
                logger.info("[DEPS] Initializing UserManagementService singleton")
                try:
                    from app.services.user_management_service import UserManagementService
                    _user_management_service_instance = UserManagementService(config)
                    logger.info("[DEPS] UserManagementService initialized successfully")
                except Exception as e:
                    logger.error(f"[DEPS] Failed to initialize UserManagementService: {e}")
                    raise e
    
    return _user_management_service_instance


class ServiceContainer:
    """
    Service container for centralized dependency access and health monitoring.
    Provides a single point to check the health of all services.
    """
    
    def __init__(self):
        self.logger = logging.getLogger(__name__)
    
    def get_health_status(self) -> Dict[str, Any]:
        """Get comprehensive health status of all services (no DI functions)"""
        try:
            # Direct singleton access/instantiation
            from app.core.config import AppConfig, CosmosDB
            from app.services.entra_auth import EntraAuthService
            
            config = AppConfig()  # direct instantiation (singleton pattern inside)
            cosmos = CosmosDB(config)
            entra_service = None
            if config.auth_config.is_entra_enabled():
                try:
                    entra_service = EntraAuthService(config)
                except Exception as e:
                    self.logger.error(f"[SERVICE_CONTAINER] Failed to init EntraAuthService: {e}")
            auth_cache = get_auth_cache()  # Use the function instead of self-import

            return {
                "status": "healthy",
                "services": {
                    "app_config": {
                        "status": "healthy",
                        "auth_methods": config.auth_config.get_enabled_methods()
                    },
                    "cosmos_db": {
                        "status": "healthy" if cosmos else "unavailable",
                        "connection": bool(cosmos)
                    },
                    "entra_service": {
                        "status": "healthy" if entra_service else "disabled",
                        "enabled": config.auth_config.is_entra_enabled(),
                        "initialized": bool(entra_service)
                    },
                    "auth_cache": {
                        "status": "healthy",
                        "stats": auth_cache.stats()
                    }
                },
                "timestamp": time.time()
            }
        
        except Exception as e:
            self.logger.error(f"[SERVICE_CONTAINER] Health check failed: {e}")
            return {
                "status": "unhealthy",
                "error": str(e),
                "timestamp": time.time()
            }


# Global service container instance
_service_container_instance: Optional[ServiceContainer] = None
_container_lock = Lock()


def get_entra_auth_service(config: AppConfig = Depends(get_app_config)) -> Optional[EntraAuthService]:
    """
    Alias for get_entra_service for backward compatibility.
    Get singleton EntraAuthService instance if Entra authentication is enabled.
    """
    return get_entra_service(config)


def get_cached_user_service(config: AppConfig = Depends(get_app_config)) -> AzureCachedUserService:
    """
    Get singleton AzureCachedUserService instance.
    Thread-safe singleton pattern for user service with caching.
    """
    global _cached_user_service_instance
    
    if _cached_user_service_instance is None:
        with _cached_user_lock:
            # Double-check locking pattern
            if _cached_user_service_instance is None:
                logger.info("[DEPS] Initializing AzureCachedUserService singleton")
                try:
                    cosmos_db = get_cosmos_db(config)
                    _cached_user_service_instance = AzureCachedUserService(cosmos_db)
                    logger.info("[DEPS] AzureCachedUserService initialized successfully")
                except Exception as e:
                    logger.error(f"[DEPS] Failed to initialize AzureCachedUserService: {e}")
                    raise e
    return _cached_user_service_instance


def get_service_container() -> ServiceContainer:
    """Get singleton ServiceContainer instance"""
    global _service_container_instance
    
    if _service_container_instance is None:
        with _container_lock:
            if _service_container_instance is None:
                logger.info("[DEPS] Initializing ServiceContainer singleton")
                _service_container_instance = ServiceContainer()
    
    return _service_container_instance
