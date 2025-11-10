# Utils module
import html
import urllib.parse

def normalize_blob_url(blob_url: str) -> str:
    """Normalize a blob URL for consistent CosmosDB storage and lookup."""
    url = html.unescape(blob_url)
    url = urllib.parse.unquote(url)
    url = url.replace(' ', '_')
    url = urllib.parse.unquote(url)
    return url
