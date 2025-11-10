# Unified User Management Service for Hybrid Authentication
from datetime import datetime, timezone
from typing import Optional, List
from app.core.config import CosmosDB, AppConfig
from passlib.context import CryptContext
import logging

class UserManagementService:
    def __init__(self, config: AppConfig):
        self.config = config
        self.db = CosmosDB(config)
        self.logger = logging.getLogger(__name__)

    async def get_user(self, user_id: str) -> Optional[dict]:
        try:
            user = self.db.auth_container.read_item(user_id, partition_key=user_id)
            user.pop("hashed_password", None)
            return user
        except Exception as e:
            self.logger.error(f"Error getting user: {e}")
            return None

    async def get_user_by_email(self, email: str) -> Optional[dict]:
        return await self.db.get_user_by_email(email)

    async def get_user_by_entra_oid(self, entra_oid: str) -> Optional[dict]:
        return await self.db.get_user_by_entra_oid(entra_oid)

    async def create_user(self, user_data: dict) -> dict:
        # Add required fields for hybrid auth
        now = datetime.now(timezone.utc).isoformat()
        user_data.setdefault("type", "user")
        user_data.setdefault("created_at", now)
        user_data.setdefault("updated_at", now)
        user_data.setdefault("auth_method", "legacy")
        user_data.setdefault("display_name", user_data.get("displayName") or user_data.get("email"))
        user_data.setdefault("last_login", now)
        user_data.setdefault("is_active", True)
        # Ensure role fields are present - use provided role or default to "standard"
        default_role = user_data.get("role", "standard")
        user_data.setdefault("role", default_role)
        user_data.setdefault("roles", [default_role])
        return await self.db.create_user(user_data)

    async def update_user(self, user_data: dict) -> dict:
        user_data["updated_at"] = datetime.now(timezone.utc).isoformat()
        try:
            result = self.db.auth_container.upsert_item(body=user_data)
            self.logger.info(f"User updated/upserted: {user_data['id']}")
            return result
        except Exception as e:
            self.logger.error(f"Error updating user: {e}")
            raise

    async def delete_user(self, user_id: str) -> None:
        self.db.auth_container.delete_item(user_id, partition_key=user_id)

    async def list_users(self, filter: str = "", role: str = "", auth_method: str = "", skip: int = 0, limit: int = 100) -> List[dict]:
        query = "SELECT * FROM c WHERE c.type = 'user'"
        parameters = []
        if filter:
            query += " AND CONTAINS(c.email, @filter)"
            parameters.append({"name": "@filter", "value": filter})
        if role:
            query += " AND c.role = @role"
            parameters.append({"name": "@role", "value": role})
        if auth_method:
            query += " AND c.auth_method = @auth_method"
            parameters.append({"name": "@auth_method", "value": auth_method})
        query += " OFFSET @skip LIMIT @limit"
        parameters.append({"name": "@skip", "value": skip})
        parameters.append({"name": "@limit", "value": limit})
        users = list(self.db.auth_container.query_items(query=query, parameters=parameters, enable_cross_partition_query=True))
        for u in users:
            u.pop("hashed_password", None)
        return users

    async def update_user_role(self, user_id: str, new_role: str) -> dict:
        user = await self.get_user(user_id)
        if not user:
            self.logger.error(f"User not found for role update: {user_id}")
            raise ValueError("User not found")
        # Update both roles array and role string for compatibility
        user["roles"] = [new_role]
        user["role"] = new_role
        updated_user = await self.update_user(user)
        self.logger.info(f"Role updated for user {user_id}: {new_role}")
        return updated_user

    async def update_user_password(self, user_id: str, new_password: str) -> dict:
        pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
        user = await self.get_user(user_id)
        if not user:
            self.logger.error(f"User not found for password update: {user_id}")
            raise ValueError("User not found")
        user["hashed_password"] = pwd_context.hash(new_password)
        updated_user = await self.update_user(user)
        self.logger.info(f"Password updated for user {user_id}")
        return updated_user

    # Add more methods as needed for role management, migration, etc.
