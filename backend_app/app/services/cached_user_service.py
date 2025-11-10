"""
Enhanced cached user service for Azure-optimized user management.
Implements intelligent caching with background refresh and TTL management.
"""
import asyncio
import time
import hashlib
import logging
from typing import Dict, Any, Optional
from datetime import datetime, timezone
from threading import Lock

from app.core.config import CosmosDB

logger = logging.getLogger(__name__)


class AzureCachedUserService:
    """
    Azure-optimized cached user service with intelligent caching strategies.
    Designed for high-performance user lookups with minimal database queries.
    """
    
    def __init__(self, cosmos_db: CosmosDB):
        self.cosmos_db = cosmos_db
        
        # In-memory caches with TTL
        self.user_cache = {}  # {cache_key: {data, timestamp, ttl}}
        self.cache_lock = Lock()
        
        # Azure-optimized cache configuration
        self.default_ttl = 900  # 15 minutes for Azure App Service
        self.max_cache_size = 2000  # Increased for Azure scale
        self.background_refresh_threshold = 0.8  # 80% of TTL
        
        # Performance metrics for Azure monitoring
        self.cache_stats = {
            "hits": 0,
            "misses": 0,
            "evictions": 0,
            "background_refreshes": 0,
            "database_queries": 0,
            "errors": 0,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        
        # Background cleanup task
        self._start_background_cleanup()
        
        logger.info("[USER_CACHE][AZURE] Initialized Azure-optimized cached user service")

    def _get_cache_key(self, lookup_type: str, value: str) -> str:
        """Generate consistent cache key with SHA-256 hashing"""
        hash_value = hashlib.sha256(f"{lookup_type}:{value}".encode()).hexdigest()[:16]
        return f"{lookup_type}:{hash_value}"

    def _is_cache_valid(self, cache_entry: Dict) -> bool:
        """Check if cache entry is still valid"""
        current_time = time.time()
        return current_time - cache_entry["timestamp"] < cache_entry["ttl"]

    def _should_background_refresh(self, cache_entry: Dict) -> bool:
        """Check if background refresh should be triggered"""
        current_time = time.time()
        age = current_time - cache_entry["timestamp"]
        return age > (cache_entry["ttl"] * self.background_refresh_threshold)

    def _cleanup_expired_cache(self):
        """Remove expired entries and enforce size limits (thread-safe)"""
        with self.cache_lock:
            current_time = time.time()
            expired_keys = []
            
            # Find expired entries
            for key, entry in self.user_cache.items():
                if current_time - entry["timestamp"] > entry["ttl"]:
                    expired_keys.append(key)
            
            # Remove expired entries
            for key in expired_keys:
                del self.user_cache[key]
                self.cache_stats["evictions"] += 1
            
            # Enforce max cache size (LRU eviction)
            if len(self.user_cache) > self.max_cache_size:
                # Sort by timestamp, remove oldest
                sorted_items = sorted(
                    self.user_cache.items(),
                    key=lambda x: x[1]["timestamp"]
                )
                excess_count = len(self.user_cache) - self.max_cache_size
                
                for i in range(excess_count):
                    key, _ = sorted_items[i]
                    del self.user_cache[key]
                    self.cache_stats["evictions"] += 1
            
            if expired_keys:
                logger.debug(f"[USER_CACHE][AZURE] Cleaned up {len(expired_keys)} expired entries")

    def _start_background_cleanup(self):
        """Start background cleanup task for Azure App Service"""
        def cleanup_worker():
            import threading
            timer = threading.Timer(300.0, cleanup_worker)  # 5 minutes
            timer.daemon = True
            timer.start()
            try:
                self._cleanup_expired_cache()
            except Exception as e:
                logger.error(f"[USER_CACHE][AZURE] Background cleanup error: {e}")
        
        cleanup_worker()

    async def get_user_by_entra_oid(self, entra_oid: str, ttl: int = None) -> Optional[Dict[str, Any]]:
        """Get user by Entra Object ID with intelligent caching"""
        cache_key = self._get_cache_key("entra_oid", entra_oid)
        current_time = time.time()
        
        # Check cache first (thread-safe read)
        with self.cache_lock:
            if cache_key in self.user_cache:
                cache_entry = self.user_cache[cache_key]
                
                if self._is_cache_valid(cache_entry):
                    self.cache_stats["hits"] += 1
                    user_data = cache_entry["data"]
                    should_refresh = self._should_background_refresh(cache_entry)
                    
                    # Schedule background refresh if needed (outside lock)
                    if should_refresh:
                        asyncio.create_task(
                            self._background_refresh_user("entra_oid", entra_oid, cache_key)
                        )
                    
                    logger.debug(f"[USER_CACHE][AZURE] Cache hit for Entra OID: {entra_oid[:8]}...")
                    return user_data
        
        # Cache miss - fetch from database
        self.cache_stats["misses"] += 1
        logger.debug(f"[USER_CACHE][AZURE] Cache miss for Entra OID: {entra_oid[:8]}...")
        
        try:
            user = await self._fetch_user_by_entra_oid(entra_oid)
            
            # Cache the result (thread-safe write)
            with self.cache_lock:
                self.user_cache[cache_key] = {
                    "data": user,
                    "timestamp": current_time,
                    "ttl": ttl or self.default_ttl
                }
            
            return user
            
        except Exception as e:
            self.cache_stats["errors"] += 1
            logger.error(f"[USER_CACHE][AZURE] Error fetching user by Entra OID {entra_oid}: {e}")
            return None

    async def get_user_by_email(self, email: str, ttl: int = None) -> Optional[Dict[str, Any]]:
        """Get user by email with intelligent caching"""
        cache_key = self._get_cache_key("email", email.lower())
        current_time = time.time()
        
        # Check cache first
        with self.cache_lock:
            if cache_key in self.user_cache:
                cache_entry = self.user_cache[cache_key]
                
                if self._is_cache_valid(cache_entry):
                    self.cache_stats["hits"] += 1
                    user_data = cache_entry["data"]
                    should_refresh = self._should_background_refresh(cache_entry)
                    
                    if should_refresh:
                        asyncio.create_task(
                            self._background_refresh_user("email", email, cache_key)
                        )
                    
                    logger.debug(f"[USER_CACHE][AZURE] Cache hit for email: {email}")
                    return user_data
        
        # Cache miss - fetch from database
        self.cache_stats["misses"] += 1
        logger.debug(f"[USER_CACHE][AZURE] Cache miss for email: {email}")
        
        try:
            user = await self._fetch_user_by_email(email)
            
            # Cache the result
            with self.cache_lock:
                self.user_cache[cache_key] = {
                    "data": user,
                    "timestamp": current_time,
                    "ttl": ttl or self.default_ttl
                }
            
            return user
            
        except Exception as e:
            self.cache_stats["errors"] += 1
            logger.error(f"[USER_CACHE][AZURE] Error fetching user by email {email}: {e}")
            return None

    async def get_user_by_id(self, user_id: str, ttl: int = None) -> Optional[Dict[str, Any]]:
        """Get user by ID with intelligent caching"""
        cache_key = self._get_cache_key("user_id", user_id)
        current_time = time.time()
        
        # Check cache first
        with self.cache_lock:
            if cache_key in self.user_cache:
                cache_entry = self.user_cache[cache_key]
                
                if self._is_cache_valid(cache_entry):
                    self.cache_stats["hits"] += 1
                    user_data = cache_entry["data"]
                    should_refresh = self._should_background_refresh(cache_entry)
                    
                    if should_refresh:
                        asyncio.create_task(
                            self._background_refresh_user("user_id", user_id, cache_key)
                        )
                    
                    logger.debug(f"[USER_CACHE][AZURE] Cache hit for user ID: {user_id}")
                    return user_data
        
        # Cache miss - fetch from database
        self.cache_stats["misses"] += 1
        logger.debug(f"[USER_CACHE][AZURE] Cache miss for user ID: {user_id}")
        
        try:
            user = await self._fetch_user_by_id(user_id)
            
            # Cache the result
            with self.cache_lock:
                self.user_cache[cache_key] = {
                    "data": user,
                    "timestamp": current_time,
                    "ttl": ttl or self.default_ttl
                }
            
            return user
            
        except Exception as e:
            self.cache_stats["errors"] += 1
            logger.error(f"[USER_CACHE][AZURE] Error fetching user by ID {user_id}: {e}")
            return None

    async def create_user(self, user_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create user and invalidate related cache entries"""
        try:
            # Create user in database
            created_user = await self._create_user_in_db(user_data)
            
            # Invalidate cache entries that might be affected
            email = user_data.get("email")
            entra_oid = user_data.get("entra_oid")
            
            if email:
                self.invalidate_user_cache(email, "email")
            if entra_oid:
                self.invalidate_user_cache(entra_oid, "entra_oid")
            
            logger.info(f"[USER_CACHE][AZURE] User created and cache invalidated: {email}")
            return created_user
            
        except Exception as e:
            self.cache_stats["errors"] += 1
            logger.error(f"[USER_CACHE][AZURE] Error creating user: {e}")
            raise

    async def update_user(self, user_id: str, update_data: Dict[str, Any]) -> Dict[str, Any]:
        """Update user and invalidate related cache entries"""
        try:
            # Get current user to know what to invalidate
            current_user = await self._fetch_user_by_id(user_id)
            
            # Update user in database
            updated_user = await self._update_user_in_db(user_id, update_data)
            
            # Invalidate all cache entries for this user
            if current_user:
                self.invalidate_user_cache(user_id, "user_id")
                if current_user.get("email"):
                    self.invalidate_user_cache(current_user["email"], "email")
                if current_user.get("entra_oid"):
                    self.invalidate_user_cache(current_user["entra_oid"], "entra_oid")
            
            # Also invalidate new values if they changed
            if "email" in update_data:
                self.invalidate_user_cache(update_data["email"], "email")
            if "entra_oid" in update_data:
                self.invalidate_user_cache(update_data["entra_oid"], "entra_oid")
            
            logger.info(f"[USER_CACHE][AZURE] User updated and cache invalidated: {user_id}")
            return updated_user
            
        except Exception as e:
            self.cache_stats["errors"] += 1
            logger.error(f"[USER_CACHE][AZURE] Error updating user {user_id}: {e}")
            raise

    def invalidate_user_cache(self, identifier: str, lookup_type: str):
        """Invalidate specific cache entry"""
        cache_key = self._get_cache_key(lookup_type, identifier)
        
        with self.cache_lock:
            if cache_key in self.user_cache:
                del self.user_cache[cache_key]
                logger.debug(f"[USER_CACHE][AZURE] Invalidated cache for {lookup_type}: {identifier}")

    def clear_all_cache(self):
        """Clear all cached entries"""
        with self.cache_lock:
            cache_size = len(self.user_cache)
            self.user_cache.clear()
            logger.info(f"[USER_CACHE][AZURE] Cleared all user cache ({cache_size} entries)")

    async def cache_user(self, user_data: Dict[str, Any]) -> None:
        """Cache user data with multiple lookup keys"""
        if not user_data:
            return
            
        current_time = time.time()
        cache_entry = {
            "data": user_data,
            "timestamp": current_time,
            "ttl": self.default_ttl
        }
        
        with self.cache_lock:
            # Cache by ID if available
            if user_data.get("id"):
                cache_key = self._get_cache_key("user_id", user_data["id"])
                self.user_cache[cache_key] = cache_entry
                
            # Cache by email if available
            if user_data.get("email"):
                cache_key = self._get_cache_key("email", user_data["email"].lower())
                self.user_cache[cache_key] = cache_entry
                
            # Cache by Entra OID if available
            if user_data.get("entra_oid"):
                cache_key = self._get_cache_key("entra_oid", user_data["entra_oid"])
                self.user_cache[cache_key] = cache_entry
                
        logger.debug(f"[USER_CACHE][AZURE] Cached user data for multiple lookup keys: {user_data.get('email', user_data.get('id'))}")

    def get_cache_stats(self) -> Dict[str, Any]:
        """Get comprehensive cache statistics"""
        with self.cache_lock:
            current_time = time.time()
            valid_entries = sum(
                1 for entry in self.user_cache.values()
                if self._is_cache_valid(entry)
            )
            
            total_requests = self.cache_stats["hits"] + self.cache_stats["misses"]
            hit_rate = (self.cache_stats["hits"] / total_requests * 100) if total_requests > 0 else 0
            
            return {
                "cache_performance": {
                    "hits": self.cache_stats["hits"],
                    "misses": self.cache_stats["misses"],
                    "hit_rate_percent": round(hit_rate, 2),
                    "total_requests": total_requests
                },
                "cache_state": {
                    "total_entries": len(self.user_cache),
                    "valid_entries": valid_entries,
                    "expired_entries": len(self.user_cache) - valid_entries,
                    "cache_size_limit": self.max_cache_size
                },
                "operations": {
                    "database_queries": self.cache_stats["database_queries"],
                    "background_refreshes": self.cache_stats["background_refreshes"],
                    "evictions": self.cache_stats["evictions"],
                    "errors": self.cache_stats["errors"]
                },
                "configuration": {
                    "default_ttl_seconds": self.default_ttl,
                    "background_refresh_threshold": self.background_refresh_threshold,
                    "max_cache_size": self.max_cache_size
                },
                "timestamp": datetime.now(timezone.utc).isoformat()
            }

    async def _background_refresh_user(self, lookup_type: str, identifier: str, cache_key: str):
        """Background refresh of user data"""
        try:
            logger.debug(f"[USER_CACHE][AZURE] Background refresh for {lookup_type}: {identifier}")
            
            # Fetch fresh data
            if lookup_type == "entra_oid":
                fresh_data = await self._fetch_user_by_entra_oid(identifier)
            elif lookup_type == "email":
                fresh_data = await self._fetch_user_by_email(identifier)
            elif lookup_type == "user_id":
                fresh_data = await self._fetch_user_by_id(identifier)
            else:
                logger.warning(f"[USER_CACHE][AZURE] Unknown lookup type for background refresh: {lookup_type}")
                return
            
            # Update cache with fresh data
            with self.cache_lock:
                if cache_key in self.user_cache:  # Only update if still in cache
                    self.user_cache[cache_key] = {
                        "data": fresh_data,
                        "timestamp": time.time(),
                        "ttl": self.default_ttl
                    }
                    self.cache_stats["background_refreshes"] += 1
            
            logger.debug(f"[USER_CACHE][AZURE] Background refresh completed for {lookup_type}: {identifier}")
            
        except Exception as e:
            logger.error(f"[USER_CACHE][AZURE] Background refresh failed for {lookup_type}:{identifier}: {e}")

    # Database interaction methods (delegate to cosmos_db)
    async def _fetch_user_by_entra_oid(self, entra_oid: str) -> Optional[Dict[str, Any]]:
        """Fetch user from database by Entra Object ID"""
        self.cache_stats["database_queries"] += 1
        try:
            return await self.cosmos_db.get_user_by_entra_oid(entra_oid)
        except Exception as e:
            logger.error(f"[USER_CACHE][AZURE] Database query failed for Entra OID {entra_oid}: {e}")
            raise

    async def _fetch_user_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        """Fetch user from database by email"""
        self.cache_stats["database_queries"] += 1
        try:
            return await self.cosmos_db.get_user_by_email(email)
        except Exception as e:
            logger.error(f"[USER_CACHE][AZURE] Database query failed for email {email}: {e}")
            raise

    async def _fetch_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Fetch user from database by ID"""
        self.cache_stats["database_queries"] += 1
        try:
            return await self.cosmos_db.get_user_by_id(user_id)
        except Exception as e:
            logger.error(f"[USER_CACHE][AZURE] Database query failed for user ID {user_id}: {e}")
            raise

    async def _create_user_in_db(self, user_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create user in database"""
        self.cache_stats["database_queries"] += 1
        try:
            return await self.cosmos_db.create_user(user_data)
        except Exception as e:
            logger.error(f"[USER_CACHE][AZURE] Database create failed: {e}")
            raise

    async def _update_user_in_db(self, user_id: str, update_data: Dict[str, Any]) -> Dict[str, Any]:
        """Update user in database"""
        self.cache_stats["database_queries"] += 1
        try:
            return await self.cosmos_db.update_user(user_id, update_data)
        except Exception as e:
            logger.error(f"[USER_CACHE][AZURE] Database update failed for user {user_id}: {e}")
            raise
