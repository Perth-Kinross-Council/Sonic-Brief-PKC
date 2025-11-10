import os
import logging
import json
import azure.functions as func


def main(req: func.HttpRequest) -> func.HttpResponse:
    """Get high-level retention summary"""
    logging.info('Retention summary endpoint triggered')
    
    try:
        summary = {
            "retention_policies": {
                "job_retention_days": os.getenv("JOB_RETENTION_DAYS", "30"),
                "failed_job_retention_days": os.getenv("FAILED_JOB_RETENTION_DAYS", "30"),
                "delete_mode": os.getenv("DELETE_COMPLETED_JOBS", "true"),
                "dry_run": os.getenv("RETENTION_DRY_RUN", "false")
            },
            "schedule": {
                "daily_cleanup": "2:00 AM UTC",
                "weekly_report": "Sunday 6:00 AM UTC"
            },
            "enabled": os.getenv("ENABLE_AUTOMATIC_RETENTION", "true"),
            "function_status": "v1_model_working",
            "runtime": "python_v1"
        }
        
        return func.HttpResponse(
            body=json.dumps(summary, indent=2),
            status_code=200,
            mimetype="application/json"
        )
    except Exception as e:
        logging.error(f"Retention summary failed: {str(e)}")
        return func.HttpResponse(
            body=json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json"
        )
