import logging
import json
from datetime import datetime
import azure.functions as func


def main(req: func.HttpRequest) -> func.HttpResponse:
    """Simple health check endpoint"""
    logging.info('Health check endpoint triggered')
    
    try:
        response_data = {
            "status": "healthy",
            "timestamp": datetime.now().isoformat(),
            "function_app": "v1_model_test",
            "runtime": "python_v1"
        }
        
        return func.HttpResponse(
            body=json.dumps(response_data, indent=2),
            status_code=200,
            mimetype="application/json"
        )
    except Exception as e:
        logging.error(f"Health check failed: {str(e)}")
        return func.HttpResponse(
            body=json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json"
        )
