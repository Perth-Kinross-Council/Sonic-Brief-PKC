#!/usr/bin/env python3
"""
Azure App Service startup script for SonicBrief Backend API
This file ensures proper module path resolution for Azure deployment
"""

import sys
import os
from pathlib import Path

# Add the current directory to Python path for proper module resolution
current_dir = Path(__file__).parent.absolute()
if str(current_dir) not in sys.path:
    sys.path.insert(0, str(current_dir))

# Ensure the app directory is in the Python path
app_dir = current_dir / "app"
if str(app_dir) not in sys.path:
    sys.path.insert(0, str(app_dir))

print(f"🚀 SonicBrief Backend starting from: {current_dir}")
print(f"📁 Python path includes: {sys.path[:3]}...")

# Now import and run the main application
try:
    from app.main import app
    print("✅ Successfully imported FastAPI app")
except ImportError as e:
    print(f"❌ Failed to import app: {e}")
    print(f"📁 Current working directory: {os.getcwd()}")
    print(f"📁 Files in current directory: {list(os.listdir('.'))}")
    print(f"📁 Files in app directory: {list(os.listdir('app')) if os.path.exists('app') else 'app directory not found'}")
    raise

# This is what gunicorn will import
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
