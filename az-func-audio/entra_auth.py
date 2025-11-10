import os
import requests
import jwt
from jwt import PyJWKClient
import logging

class EntraAuthService:
    def __init__(self):
        self.tenant_id = os.getenv("AZURE_TENANT_ID")
        # Use ENTRA_CLIENT_ID for Entra ID App Registration authentication
        self.client_id = os.getenv("ENTRA_CLIENT_ID")
        self.authority = os.getenv("AZURE_AUTHORITY") or f"https://login.microsoftonline.com/{self.tenant_id}"
        self.audience = os.getenv("AZURE_AUDIENCE") or self.client_id
        self.jwks_uri = f"{self.authority}/discovery/v2.0/keys"
        self.jwk_client = PyJWKClient(self.jwks_uri)
        self.logger = logging.getLogger(__name__)

    def verify_token(self, token: str):
        try:
            signing_key = self.jwk_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256"],
                audience=self.audience,
                options={"verify_exp": True},
            )
            return payload
        except Exception as e:
            self.logger.error(f"Failed to verify Entra ID token: {e}")
            raise
