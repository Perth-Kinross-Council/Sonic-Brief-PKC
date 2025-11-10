import os
import time
import logging
from datetime import datetime, timedelta
from typing import Optional
from azure.identity import ManagedIdentityCredential
from azure.storage.blob import BlobServiceClient, generate_blob_sas, BlobSasPermissions


AZURE_STORAGE_ACCOUNT_URL = os.getenv("AZURE_STORAGE_ACCOUNT_URL")
AZURE_STORAGE_RECORDINGS_CONTAINER = os.getenv("AZURE_STORAGE_RECORDINGS_CONTAINER", "recordingcontainer")
AUDIO_FOLDER = os.getenv("AUDIO_FOLDER", "audios")

# Use System Assigned Managed Identity for Azure Functions
# Do not confuse AZURE_CLIENT_ID (Entra ID App Registration) with Managed Identity
credential = ManagedIdentityCredential()

blob_service_client = BlobServiceClient(account_url=AZURE_STORAGE_ACCOUNT_URL, credential=credential)

# Configure logging for the module (you can adjust as needed)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def get_blob_client(blob_name: str, container_name: str = AZURE_STORAGE_RECORDINGS_CONTAINER):
    """
    Return the BlobClient for a given blob name within a container.
    """
    return blob_service_client.get_blob_client(container=container_name, blob=blob_name)


def _parse_storage_conn_string(conn: str) -> dict:
    """Parse Azure Storage connection string into a dict."""
    parts = {}
    try:
        for segment in conn.split(';'):
            if not segment:
                continue
            if '=' in segment:
                k, v = segment.split('=', 1)
                parts[k.strip()] = v.strip()
    except Exception:
        pass
    return parts


def get_blob_sas_url(blob_name: str, expiry_minutes: int = 60) -> str:
    """Generate a time-limited SAS URL for a blob. Uses AccountKey from AzureWebJobsStorage when available; otherwise falls back to user delegation SAS if permitted.

    Returns the full https URL with SAS query string.
    """
    # Prefer using the AccountKey from the AzureWebJobsStorage app setting
    conn = os.getenv("AzureWebJobsStorage", "")
    account_name = None
    account_key = None

    # Try extract account name from URL if not in connection string
    if AZURE_STORAGE_ACCOUNT_URL:
        try:
            # https://<account>.blob.core.windows.net
            account_name = AZURE_STORAGE_ACCOUNT_URL.split('//')[1].split('.')[0]
        except Exception:
            account_name = None

    if conn:
        parts = _parse_storage_conn_string(conn)
        account_name = parts.get('AccountName', account_name)
        account_key = parts.get('AccountKey')

    expiry = datetime.utcnow() + timedelta(minutes=expiry_minutes)

    if account_name and account_key:
        sas = generate_blob_sas(
            account_name=account_name,
            container_name=AZURE_STORAGE_RECORDINGS_CONTAINER,
            blob_name=blob_name,
            account_key=account_key,
            permission=BlobSasPermissions(read=True),
            expiry=expiry,
        )
        return f"{AZURE_STORAGE_ACCOUNT_URL}/{AZURE_STORAGE_RECORDINGS_CONTAINER}/{blob_name}?{sas}"

    # Fallback to user delegation SAS via Managed Identity
    try:
        udk = blob_service_client.get_user_delegation_key(datetime.utcnow(), expiry)
        sas = generate_blob_sas(
            account_name=account_name,
            container_name=AZURE_STORAGE_RECORDINGS_CONTAINER,
            blob_name=blob_name,
            user_delegation_key=udk,
            permission=BlobSasPermissions(read=True),
            expiry=expiry,
        )
        return f"{AZURE_STORAGE_ACCOUNT_URL}/{AZURE_STORAGE_RECORDINGS_CONTAINER}/{blob_name}?{sas}"
    except Exception as e:
        logger.error(f"Failed to generate SAS for blob '{blob_name}': {e}")
        raise

# azure_storage.py  ───────────────
def download_blob_to_local_file(blob_name: str,
                                local_path: Optional[str] = None,
                                overwrite: bool = False,
                                max_retries: int = 5,
                                initial_backoff: float = 1.0) -> str:
    """Download a blob to a local file with logging and retry/backoff."""
    logger.info(f"Resolved blob_name: {blob_name}")
    logger.info(f"Resolved local_path: {local_path}")
    logger.info(f"Resolved AZURE_STORAGE_ACCOUNT_URL: {AZURE_STORAGE_ACCOUNT_URL}")
    logger.info(f"Resolved AZURE_STORAGE_RECORDINGS_CONTAINER: {AZURE_STORAGE_RECORDINGS_CONTAINER}")
    if not local_path:
        local_path = os.path.join('/tmp', os.path.basename(blob_name))
    else:
        # Force caller-supplied path into /tmp, to stay writable
        local_path = os.path.join('/tmp', os.path.basename(local_path))

    os.makedirs(os.path.dirname(local_path), exist_ok=True)

    logger.info(f"Resolved local path: {local_path}")

    if not overwrite and os.path.exists(local_path):
        logger.info(f"File already exists at {local_path} and overwrite is False. Skipping download.")
        return local_path

    attempt = 0
    backoff = initial_backoff

    while attempt < max_retries:
        try:
            logger.info(f"Attempting to download blob '{blob_name}' (attempt {attempt+1}/{max_retries})...")

            client = get_blob_client(blob_name)  # Assumed function

            if client.exists():
                with open(local_path, "wb") as download_file:
                    download_file.write(client.download_blob().readall())
                logger.info(f"Downloaded to {local_path}")
            else:
                logger.warning(f"Blob '{blob_name}' does not exist in container '{AZURE_STORAGE_RECORDINGS_CONTAINER}' SA: {AZURE_STORAGE_ACCOUNT_URL}.")


            logger.info(f"Downloaded blob '{blob_name}' to '{local_path}'.")
            return local_path

        except Exception as e:
            logger.error(f"Failed to download blob '{blob_name}' on attempt {attempt+1}: {e}", exc_info=True)
            attempt += 1
            if attempt < max_retries:
                logger.info(f"Retrying in {backoff} seconds...")
                time.sleep(backoff)
                backoff *= 2  # Exponential backoff
            else:
                logger.error(f"All {max_retries} attempts failed.")
                raise  # Reraise the last exception

    return local_path  # This line should never be reached


def download_audio_to_local_file(blob_name):
    logger.info(f"=== DOWNLOAD_AUDIO_TO_LOCAL_FILE DEBUGGING ===")
    logger.info(f"Input blob_name: {blob_name}")
    logger.info(f"Container: {AZURE_STORAGE_RECORDINGS_CONTAINER}")
    logger.info(f"Storage Account URL: {AZURE_STORAGE_ACCOUNT_URL}")
    
    result = download_blob_to_local_file(blob_name)
    logger.info(f"Download result: {result}")
    return result