import requests
import jwt
from jwt.algorithms import RSAAlgorithm
from fastapi import HTTPException, status
from typing import Dict, Any
from app.core.config import AppConfig
import logging
import time
import threading
from functools import lru_cache

logger = logging.getLogger(__name__)


class AzureOptimizedEntraAuthService:
    """
    Azure-optimized Entra ID authentication service with enhanced caching and connection pooling.
    Designed specifically for Azure App Service deployment.
    """
    def __init__(self, config: AppConfig):
        self.config = config
        self.jwks_uri = f"{self.config.entra['authority']}/discovery/v2.0/keys"
        # Azure-optimized caching configuration
        self.jwks_cache_ttl = 3600  # 1 hour cache for JWKS in Azure
        self.jwks_cache = {}
        self.jwks_cache_timestamp = 0
        self.jwks_lock = threading.Lock()
        # Connection pooling for Azure
        self.session = requests.Session()
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=10,
            pool_maxsize=10,
            max_retries=3
        )
        self.session.mount('https://', adapter)
        logger.info("[AUTH][AZURE] Initialized Azure-optimized Entra auth service")
        # Pre-fetch JWKS on initialization
        try:
            self._fetch_jwks_with_cache()
            logger.info("[AUTH][AZURE] JWKS pre-fetched successfully")
        except Exception as e:
            logger.error(f"[AUTH][AZURE] Failed to pre-fetch JWKS: {e}")

    def _fetch_jwks_with_cache(self) -> Dict[str, Any]:
        """
        Fetch JWKS with intelligent caching optimized for Azure App Service.
        Uses thread-safe caching with TTL.
        """
        current_time = time.time()
        # Check if cache is still valid
        if (self.jwks_cache and 
            current_time - self.jwks_cache_timestamp < self.jwks_cache_ttl):
            logger.debug("[AUTH][AZURE] Using cached JWKS")
            return self.jwks_cache
        # Need to fetch new JWKS
        with self.jwks_lock:
            # Double-check locking pattern
            if (self.jwks_cache and 
                current_time - self.jwks_cache_timestamp < self.jwks_cache_ttl):
                return self.jwks_cache
            try:
                logger.info(f"[AUTH][AZURE] Fetching JWKS from {self.jwks_uri}")
                # Azure-optimized request with timeout and retry
                response = self.session.get(
                    self.jwks_uri,
                    timeout=(5, 10),  # (connect_timeout, read_timeout)
                    headers={
                        'User-Agent': 'SonicBrief-Azure-Auth/2.0',
                        'Accept': 'application/json'
                    }
                )
                response.raise_for_status()
                jwks_data = response.json()
                # Update cache
                self.jwks_cache = jwks_data
                self.jwks_cache_timestamp = current_time
                logger.info(f"[AUTH][AZURE] JWKS fetched and cached successfully. Keys count: {len(jwks_data.get('keys', []))}")
                return jwks_data
            except requests.exceptions.RequestException as e:
                logger.error(f"[AUTH][AZURE] JWKS fetch failed: {e}")
                # If we have stale cache, use it as fallback
                if self.jwks_cache:
                    logger.warning("[AUTH][AZURE] Using stale JWKS cache as fallback")
                    return self.jwks_cache
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=f"Unable to fetch JWKS from Azure: {e}"
                )

    @lru_cache(maxsize=100)
    def _get_public_key_from_jwk(self, kid: str, jwk_data: str) -> Any:
        """
        Cache public keys by kid for performance.
        Uses LRU cache to avoid repeated RSA key parsing.
        """
        import json
        jwk = json.loads(jwk_data)
        return RSAAlgorithm.from_jwk(jwk)

    def verify_token(self, token: str) -> Dict[str, Any]:
        """
        Verify Entra ID JWT token with Azure-optimized caching and validation.
        """
        try:
            logger.debug(f"[AUTH][AZURE] Verifying token. Token (first 20 chars): {token[:20]}...")
            # Get unverified header
            unverified_header = jwt.get_unverified_header(token)
            kid = unverified_header.get("kid")
            if not kid:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Token missing 'kid' in header"
                )
            logger.debug(f"[AUTH][AZURE] Token header: {unverified_header}")
            # Fetch JWKS with caching
            jwks = self._fetch_jwks_with_cache()
            # Find matching key
            matching_key = None
            for key in jwks.get("keys", []):
                if key.get("kid") == kid:
                    matching_key = key
                    break
            if not matching_key:
                logger.error(f"[AUTH][AZURE] No matching key found for kid: {kid}")
                # Force refresh JWKS in case of key rotation
                self.jwks_cache_timestamp = 0
                jwks = self._fetch_jwks_with_cache()
                # Try again with fresh JWKS
                for key in jwks.get("keys", []):
                    if key.get("kid") == kid:
                        matching_key = key
                        break
                if not matching_key:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail=f"Unable to find appropriate key for token validation (kid: {kid})"
                    )
            # Get public key with caching
            import json
            jwk_string = json.dumps(matching_key)
            public_key = self._get_public_key_from_jwk(kid, jwk_string)
            # Azure-specific issuer validation
            allowed_issuers = [
                f"{self.config.entra['authority']}/v2.0",
                f"https://sts.windows.net/{self.config.entra['tenant_id']}/",
                f"https://login.microsoftonline.com/{self.config.entra['tenant_id']}/v2.0"
            ]
            # Decode and validate token
            payload = jwt.decode(
                token,
                public_key,
                algorithms=["RS256"],
                audience=self.config.entra["audience"],
                issuer=allowed_issuers,
                options={
                    "verify_exp": True,
                    "verify_iat": True,
                    "verify_nbf": True,
                    "verify_aud": True,
                    "verify_iss": True
                }
            )
            logger.info(f"[AUTH][AZURE] Token successfully validated for user: {payload.get('preferred_username', 'unknown')}")
            logger.debug(f"[AUTH][AZURE] Token payload: {payload}")
            return payload
        except jwt.ExpiredSignatureError:
            logger.warning("[AUTH][AZURE] Token has expired")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token has expired"
            )
        except jwt.InvalidAudienceError as e:
            logger.error(f"[AUTH][AZURE] Invalid audience: {e}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token audience"
            )
        except jwt.InvalidIssuerError as e:
            logger.error(f"[AUTH][AZURE] Invalid issuer: {e}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token issuer"
            )
        except jwt.PyJWTError as e:
            logger.error(f"[AUTH][AZURE] JWT validation error: {e}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Token validation error: {str(e)}"
            )
        except Exception as e:
            logger.error(f"[AUTH][AZURE] Unexpected error during token validation: {e}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal authentication error"
            )

    def get_cache_stats(self) -> Dict[str, Any]:
        """Get JWKS cache statistics for monitoring"""
        current_time = time.time()
        cache_age = current_time - self.jwks_cache_timestamp if self.jwks_cache_timestamp else 0
        return {
            "jwks_cached": bool(self.jwks_cache),
            "cache_age_seconds": cache_age,
            "cache_ttl_seconds": self.jwks_cache_ttl,
            "cache_valid": cache_age < self.jwks_cache_ttl,
            "keys_count": len(self.jwks_cache.get("keys", [])) if self.jwks_cache else 0,
            "public_key_cache_info": self._get_public_key_from_jwk.cache_info()._asdict()
        }

    def force_refresh_jwks(self) -> Dict[str, Any]:
        """Force refresh of JWKS cache (for admin operations)"""
        logger.info("[AUTH][AZURE] Forcing JWKS cache refresh")
        self.jwks_cache_timestamp = 0
        self._get_public_key_from_jwk.cache_clear()
        return self._fetch_jwks_with_cache()

    def cleanup(self):
        """Cleanup resources"""
        if hasattr(self, 'session'):
            self.session.close()
            logger.info("[AUTH][AZURE] HTTP session closed")

# For backward compatibility, alias the optimized service
EntraAuthService = AzureOptimizedEntraAuthService
