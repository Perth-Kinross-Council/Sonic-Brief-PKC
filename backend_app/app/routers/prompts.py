from fastapi import APIRouter, HTTPException, Depends
from typing import Dict, Any, Optional, List
from pydantic import BaseModel
import logging
import os
from datetime import datetime, timezone

from app.core.config import AppConfig, CosmosDB, DatabaseError
from app.core.dependencies import get_app_config, get_cosmos_db
from app.routers.auth import get_current_user_any
from app.services.cosmos_audit_service import CosmosAuditService

logger = logging.getLogger(__name__)
_lvl = getattr(logging, os.getenv("BACKEND_LOG_LEVEL", "INFO").upper(), logging.INFO)
logger.setLevel(_lvl)
router = APIRouter()


class PromptKey(BaseModel):
    key: str
    prompt: str


class CategoryBase(BaseModel):
    name: str


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(CategoryBase):
    pass


class CategoryResponse(CategoryBase):
    id: str
    created_at: int
    updated_at: int


class SubcategoryBase(BaseModel):
    name: str
    prompts: Dict[str, str]


class SubcategoryCreate(SubcategoryBase):
    category_id: str


class SubcategoryUpdate(SubcategoryBase):
    pass


class SubcategoryResponse(SubcategoryBase):
    id: str
    category_id: str
    created_at: int
    updated_at: int


# Category CRUD operations
@router.post("/categories", response_model=CategoryResponse)
async def create_category(
    category: CategoryCreate,
    current_user: Dict[str, Any] = Depends(get_current_user_any),
    config: AppConfig = Depends(get_app_config),
    cosmos_db: CosmosDB = Depends(get_cosmos_db),
) -> Dict[str, Any]:
    """Create a new prompt category"""
    try:
        logger.debug("CosmosDB client initialized for category creation")
        timestamp = int(datetime.now(timezone.utc).timestamp() * 1000)

        # Check if category already exists
        existing_category_query = {
            "query": "SELECT * FROM c WHERE c.type = 'prompt_category' AND c.name = @name",
            "parameters": [{"name": "@name", "value": category.name}],
        }
        existing_categories = list(
            cosmos_db.prompts_container.query_items(
                query=existing_category_query["query"],
                parameters=existing_category_query["parameters"],
                enable_cross_partition_query=True,
            )
        )

        if existing_categories:
            raise HTTPException(
                status_code=400,
                detail=f"Category with name '{category.name}' already exists",
            )

        category_id = f"category_{timestamp}"
        category_data = {
            "id": category_id,
            "type": "prompt_category",
            "name": category.name,
            "created_at": timestamp,
            "updated_at": timestamp,
        }

        created_category = cosmos_db.prompts_container.create_item(body=category_data)

        # Audit: Prompt category created
        try:
            audit = CosmosAuditService(cosmos_db)
            user_id = current_user.get("id") or current_user.get("email") or "unknown"
            audit.log_user_action(
                user_id=user_id,
                action_type="Prompt category created",
                message=f"Category '{category.name}' created",
                resource_id=category_id,
                details={"category_id": category_id, "name": category.name},
            )
        except Exception:
            logger.warning("Audit log failed for create_category", exc_info=True)

        return created_category

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating category: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create category: {str(e)}",
        )


@router.get("/categories")
async def list_categories(
    current_user: Dict[str, Any] = Depends(get_current_user_any),
    config: AppConfig = Depends(get_app_config),
    cosmos_db: CosmosDB = Depends(get_cosmos_db),
):
    """List all prompt categories"""
    try:
        logger.info(f"[CATEGORIES] Authenticated user: {current_user}")

        query = "SELECT * FROM c WHERE c.type = 'prompt_category'"
        logger.info(f"[CATEGORIES] Executing query: {query}")
        categories = list(
            cosmos_db.prompts_container.query_items(
                query=query,
                enable_cross_partition_query=True,
            )
        )
        logger.info(f"[CATEGORIES] Found {len(categories)} categories: {categories}")

        return categories

    except Exception as e:
        logger.error(f"Error listing categories: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list categories: {str(e)}",
        )


@router.get("/categories/{category_id}", response_model=CategoryResponse)
async def get_category(
    category_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user_any),
) -> Dict[str, Any]:
    """Get a specific prompt category"""
    try:
        config = AppConfig()
        cosmos_db = CosmosDB(config)

        query = {
            "query": "SELECT * FROM c WHERE c.type = 'prompt_category' AND c.id = @id",
            "parameters": [{"name": "@id", "value": category_id}],
        }

        categories = list(
            cosmos_db.prompts_container.query_items(
                query=query["query"],
                parameters=query["parameters"],
                enable_cross_partition_query=True,
            )
        )

        if not categories:
            raise HTTPException(
                status_code=404,
                detail=f"Category with id '{category_id}' not found",
            )

        return categories[0]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving category: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve category: {str(e)}",
        )


@router.put("/categories/{category_id}", response_model=CategoryResponse)
async def update_category(
    category_id: str,
    category: CategoryUpdate,
    current_user: Dict[str, Any] = Depends(get_current_user_any),
) -> Dict[str, Any]:
    """Update a prompt category"""
    try:
        config = AppConfig()
        cosmos_db = CosmosDB(config)

        # Check if category exists
        query = {
            "query": "SELECT * FROM c WHERE c.type = 'prompt_category' AND c.id = @id",
            "parameters": [{"name": "@id", "value": category_id}],
        }

        categories = list(
            cosmos_db.prompts_container.query_items(
                query=query["query"],
                parameters=query["parameters"],
                enable_cross_partition_query=True,
            )
        )

        if not categories:
            raise HTTPException(
                status_code=404,
                detail=f"Category with id '{category_id}' not found",
            )

        category_data = categories[0]
        old_name = category_data.get("name")
        category_data["name"] = category.name
        category_data["updated_at"] = int(datetime.now(timezone.utc).timestamp() * 1000)

        updated_category = cosmos_db.prompts_container.upsert_item(body=category_data)

        # Audit: Prompt category updated
        try:
            audit = CosmosAuditService(cosmos_db)
            user_id = current_user.get("id") or current_user.get("email") or "unknown"
            audit.log_user_action(
                user_id=user_id,
                action_type="Prompt category updated",
                message=f"Category '{old_name}' updated to '{category.name}'",
                resource_id=category_id,
                details={"category_id": category_id, "old_name": old_name, "new_name": category.name},
            )
        except Exception:
            logger.warning("Audit log failed for update_category", exc_info=True)

        return updated_category

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating category: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update category: {str(e)}",
        )


@router.delete("/categories/{category_id}")
async def delete_category(
    category_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user_any),
) -> Dict[str, Any]:
    """Delete a prompt category and all its subcategories"""
    try:
        config = AppConfig()
        cosmos_db = CosmosDB(config)

        # Fetch category for audit details
        category_info = None
        try:
            cat_query = {
                "query": "SELECT * FROM c WHERE c.type = 'prompt_category' AND c.id = @id",
                "parameters": [{"name": "@id", "value": category_id}],
            }
            results = list(
                cosmos_db.prompts_container.query_items(
                    query=cat_query["query"],
                    parameters=cat_query["parameters"],
                    enable_cross_partition_query=True,
                )
            )
            category_info = results[0] if results else None
        except Exception:
            category_info = None

        # Delete all subcategories first
        subcategories_query = {
            "query": "SELECT * FROM c WHERE c.type = 'prompt_subcategory' AND c.category_id = @category_id",
            "parameters": [{"name": "@category_id", "value": category_id}],
        }

        subcategories = list(
            cosmos_db.prompts_container.query_items(
                query=subcategories_query["query"],
                parameters=subcategories_query["parameters"],
                enable_cross_partition_query=True,
            )
        )

        for subcategory in subcategories:
            cosmos_db.prompts_container.delete_item(
                item=subcategory["id"],
                partition_key=subcategory["id"],
            )

        # Delete the category
        try:
            cosmos_db.prompts_container.delete_item(
                item=category_id,
                partition_key=category_id,
            )
        except Exception as e:
            if "404" in str(e):
                raise HTTPException(
                    status_code=404,
                    detail=f"Category with id '{category_id}' not found",
                )
            raise

        # Audit: Prompt category deleted
        try:
            audit = CosmosAuditService(cosmos_db)
            user_id = current_user.get("id") or current_user.get("email") or "unknown"
            audit.log_user_action(
                user_id=user_id,
                action_type="Prompt category deleted",
                message=f"Category '{category_info.get('name') if category_info else category_id}' deleted",
                resource_id=category_id,
                details={
                    "category_id": category_id,
                    "name": (category_info or {}).get("name"),
                    "deleted_subcategories": len(subcategories),
                },
            )
        except Exception:
            logger.warning("Audit log failed for delete_category", exc_info=True)

        return {
            "status": 200,
            "message": f"Category '{category_id}' and its subcategories deleted successfully",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting category: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete category: {str(e)}",
        )


# Subcategory CRUD operations
@router.post("/subcategories", response_model=SubcategoryResponse)
async def create_subcategory(
    subcategory: SubcategoryCreate,
    current_user: Dict[str, Any] = Depends(get_current_user_any),
) -> Dict[str, Any]:
    """Create a new prompt subcategory"""
    try:
        config = AppConfig()
        cosmos_db = CosmosDB(config)

        # Check if category exists
        category_query = {
            "query": "SELECT * FROM c WHERE c.type = 'prompt_category' AND c.id = @id",
            "parameters": [{"name": "@id", "value": subcategory.category_id}],
        }

        categories = list(
            cosmos_db.prompts_container.query_items(
                query=category_query["query"],
                parameters=category_query["parameters"],
                enable_cross_partition_query=True,
            )
        )

        if not categories:
            raise HTTPException(
                status_code=404,
                detail=f"Category with id '{subcategory.category_id}' not found",
            )

        timestamp = int(datetime.now(timezone.utc).timestamp() * 1000)
        subcategory_id = f"subcategory_{timestamp}_{subcategory.name}"

        subcategory_data = {
            "id": subcategory_id,
            "type": "prompt_subcategory",
            "category_id": subcategory.category_id,
            "name": subcategory.name,
            "prompts": subcategory.prompts,
            "created_at": timestamp,
            "updated_at": timestamp,
        }

        created_subcategory = cosmos_db.prompts_container.create_item(
            body=subcategory_data
        )

        # Audit: Prompt subcategory created
        try:
            audit = CosmosAuditService(cosmos_db)
            user_id = current_user.get("id") or current_user.get("email") or "unknown"
            audit.log_user_action(
                user_id=user_id,
                action_type="Prompt subcategory created",
                message=f"Subcategory '{subcategory.name}' created in category '{subcategory.category_id}'",
                resource_id=subcategory_id,
                details={
                    "subcategory_id": subcategory_id,
                    "category_id": subcategory.category_id,
                    "name": subcategory.name,
                    "initial_prompt_keys": list((subcategory.prompts or {}).keys()),
                },
            )
        except Exception:
            logger.warning("Audit log failed for create_subcategory", exc_info=True)

        return created_subcategory

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating subcategory: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create subcategory: {str(e)}",
        )


@router.get("/subcategories", response_model=List[SubcategoryResponse])
async def list_subcategories(
    category_id: Optional[str] = None,
    current_user: Dict[str, Any] = Depends(get_current_user_any),
) -> List[Dict[str, Any]]:
    """List all prompt subcategories, optionally filtered by category_id"""
    try:
        config = AppConfig()
        cosmos_db = CosmosDB(config)

        if category_id:
            query = {
                "query": "SELECT * FROM c WHERE c.type = 'prompt_subcategory' AND c.category_id = @category_id",
                "parameters": [{"name": "@category_id", "value": category_id}],
            }
            subcategories = list(
                cosmos_db.prompts_container.query_items(
                    query=query["query"],
                    parameters=query["parameters"],
                    enable_cross_partition_query=True,
                )
            )
        else:
            query = "SELECT * FROM c WHERE c.type = 'prompt_subcategory'"
            subcategories = list(
                cosmos_db.prompts_container.query_items(
                    query=query,
                    enable_cross_partition_query=True,
                )
            )

        return subcategories

    except Exception as e:
        logger.error(f"Error listing subcategories: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list subcategories: {str(e)}",
        )


@router.get("/subcategories/{subcategory_id}", response_model=SubcategoryResponse)
async def get_subcategory(
    subcategory_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user_any),
) -> Dict[str, Any]:
    """Get a specific prompt subcategory"""
    try:
        config = AppConfig()
        cosmos_db = CosmosDB(config)

        query = {
            "query": "SELECT * FROM c WHERE c.type = 'prompt_subcategory' AND c.id = @id",
            "parameters": [{"name": "@id", "value": subcategory_id}],
        }

        subcategories = list(
            cosmos_db.prompts_container.query_items(
                query=query["query"],
                parameters=query["parameters"],
                enable_cross_partition_query=True,
            )
        )

        if not subcategories:
            raise HTTPException(
                status_code=404,
                detail=f"Subcategory with id '{subcategory_id}' not found",
            )

        return subcategories[0]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving subcategory: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve subcategory: {str(e)}",
        )


@router.put("/subcategories/{subcategory_id}", response_model=SubcategoryResponse)
async def update_subcategory(
    subcategory_id: str,
    subcategory: SubcategoryUpdate,
    current_user: Dict[str, Any] = Depends(get_current_user_any),
) -> Dict[str, Any]:
    """Update a prompt subcategory"""
    try:
        config = AppConfig()
        cosmos_db = CosmosDB(config)

        # Check if subcategory exists
        query = {
            "query": "SELECT * FROM c WHERE c.type = 'prompt_subcategory' AND c.id = @id",
            "parameters": [{"name": "@id", "value": subcategory_id}],
        }

        subcategories = list(
            cosmos_db.prompts_container.query_items(
                query=query["query"],
                parameters=query["parameters"],
                enable_cross_partition_query=True,
            )
        )

        if not subcategories:
            raise HTTPException(
                status_code=404,
                detail=f"Subcategory with id '{subcategory_id}' not found",
            )

        subcategory_data = subcategories[0]
        old_name = subcategory_data.get("name")
        old_prompts = dict(subcategory_data.get("prompts", {}))
        new_prompts = dict(subcategory.prompts or {})

        subcategory_data["name"] = subcategory.name
        subcategory_data["prompts"] = new_prompts
        subcategory_data["updated_at"] = int(
            datetime.now(timezone.utc).timestamp() * 1000
        )

        updated_subcategory = cosmos_db.prompts_container.upsert_item(
            body=subcategory_data
        )

        # Audit: Prompt subcategory updated
        try:
            audit = CosmosAuditService(cosmos_db)
            user_id = current_user.get("id") or current_user.get("email") or "unknown"

            # Overall subcategory update (e.g., rename)
            if old_name != subcategory.name:
                audit.log_user_action(
                    user_id=user_id,
                    action_type="Prompt subcategory updated",
                    message=f"Subcategory '{old_name}' renamed to '{subcategory.name}'",
                    resource_id=subcategory_id,
                    details={
                        "subcategory_id": subcategory_id,
                        "old_name": old_name,
                        "new_name": subcategory.name,
                    },
                )

            # Prompt-level diffs
            old_keys = set(old_prompts.keys())
            new_keys = set(new_prompts.keys())

            added = new_keys - old_keys
            removed = old_keys - new_keys
            possibly_updated = old_keys & new_keys

            for key in sorted(added):
                audit.log_user_action(
                    user_id=user_id,
                    action_type="Prompt created",
                    message=f"Prompt '{key}' created in subcategory '{subcategory_id}'",
                    resource_id=f"{subcategory_id}:{key}",
                    details={
                        "subcategory_id": subcategory_id,
                        "prompt_key": key,
                    },
                )

            for key in sorted(removed):
                audit.log_user_action(
                    user_id=user_id,
                    action_type="Prompt deleted",
                    message=f"Prompt '{key}' deleted from subcategory '{subcategory_id}'",
                    resource_id=f"{subcategory_id}:{key}",
                    details={
                        "subcategory_id": subcategory_id,
                        "prompt_key": key,
                    },
                )

            for key in sorted(possibly_updated):
                if (old_prompts.get(key) or "") != (new_prompts.get(key) or ""):
                    audit.log_user_action(
                        user_id=user_id,
                        action_type="Prompt updated",
                        message=f"Prompt '{key}' updated in subcategory '{subcategory_id}'",
                        resource_id=f"{subcategory_id}:{key}",
                        details={
                            "subcategory_id": subcategory_id,
                            "prompt_key": key,
                        },
                    )
        except Exception:
            logger.warning("Audit log failed for update_subcategory", exc_info=True)

        return updated_subcategory

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating subcategory: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update subcategory: {str(e)}",
        )


@router.delete("/subcategories/{subcategory_id}")
async def delete_subcategory(
    subcategory_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user_any),
) -> Dict[str, Any]:
    """Delete a prompt subcategory"""
    try:
        config = AppConfig()
        cosmos_db = CosmosDB(config)

        # Fetch subcategory for audit details
        subcat_info = None
        try:
            q = {
                "query": "SELECT * FROM c WHERE c.type = 'prompt_subcategory' AND c.id = @id",
                "parameters": [{"name": "@id", "value": subcategory_id}],
            }
            res = list(
                cosmos_db.prompts_container.query_items(
                    query=q["query"],
                    parameters=q["parameters"],
                    enable_cross_partition_query=True,
                )
            )
            subcat_info = res[0] if res else None
        except Exception:
            subcat_info = None

        try:
            cosmos_db.prompts_container.delete_item(
                item=subcategory_id,
                partition_key=subcategory_id,
            )
        except Exception as e:
            if "404" in str(e):
                raise HTTPException(
                    status_code=404,
                    detail=f"Subcategory with id '{subcategory_id}' not found",
                )
            raise

        # Audit: Prompt subcategory deleted
        try:
            audit = CosmosAuditService(cosmos_db)
            user_id = current_user.get("id") or current_user.get("email") or "unknown"
            audit.log_user_action(
                user_id=user_id,
                action_type="Prompt subcategory deleted",
                message=f"Subcategory '{(subcat_info or {}).get('name') or subcategory_id}' deleted",
                resource_id=subcategory_id,
                details={
                    "subcategory_id": subcategory_id,
                    "category_id": (subcat_info or {}).get("category_id"),
                    "name": (subcat_info or {}).get("name"),
                    "prompt_keys": list(((subcat_info or {}).get("prompts") or {}).keys()),
                },
            )
        except Exception:
            logger.warning("Audit log failed for delete_subcategory", exc_info=True)

        return {
            "status": 200,
            "message": f"Subcategory '{subcategory_id}' deleted successfully",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting subcategory: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete subcategory: {str(e)}",
        )


# Hierarchical API for retrieving all data
class PromptSubcategoryResponse(BaseModel):
    subcategory_name: str
    subcategory_id: str
    prompts: Dict[str, str]


class PromptCategoryResponse(BaseModel):
    category_name: str
    category_id: str
    subcategories: List[PromptSubcategoryResponse]


class AllPromptsResponse(BaseModel):
    status: int
    data: List[PromptCategoryResponse]


@router.get("/retrieve_prompts", response_model=AllPromptsResponse)
async def retrieve_prompts(
    current_user: Dict[str, Any] = Depends(get_current_user_any),
) -> Dict[str, Any]:
    """Retrieve all prompts, categories, and subcategories in a hierarchical structure"""
    try:
        config = AppConfig()
        try:
            cosmos_db = CosmosDB(config)
            logger.debug("CosmosDB client initialized for retrieval")
        except DatabaseError as e:
            logger.error(f"Database initialization failed: {str(e)}")
            return {"status": 503, "message": "Database service unavailable"}

        # Query all categories
        categories_query = "SELECT * FROM c WHERE c.type = 'prompt_category'"
        categories = list(
            cosmos_db.prompts_container.query_items(
                query=categories_query, enable_cross_partition_query=True
            )
        )

        # Query all subcategories
        subcategories_query = "SELECT * FROM c WHERE c.type = 'prompt_subcategory'"
        subcategories = list(
            cosmos_db.prompts_container.query_items(
                query=subcategories_query, enable_cross_partition_query=True
            )
        )

        # Organize data
        results = []
        for category in categories:
            category_data = {
                "category_name": category["name"],
                "category_id": category["id"],
                "subcategories": [],
            }
            for subcategory in subcategories:
                if subcategory["category_id"] == category["id"]:
                    category_data["subcategories"].append(
                        {
                            "subcategory_name": subcategory["name"],
                            "subcategory_id": subcategory["id"],
                            "prompts": subcategory["prompts"],
                        }
                    )
            results.append(category_data)

        return {"status": 200, "data": results}

    except Exception as e:
        logger.error(f"Error retrieving prompts: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve prompts: {str(e)}",
        )
