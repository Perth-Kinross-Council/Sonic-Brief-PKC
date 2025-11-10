"""
Structured Logging Configuration for Sonic Brief
Provides JSON-formatted logging that works well with Azure Log Analytics
"""

import logging
import json
import sys
from datetime import datetime
from typing import Dict, Any, Optional


class StructuredFormatter(logging.Formatter):
    """JSON formatter for Azure Log Analytics compatible logging"""
    
    def format(self, record):
        """Format log record as JSON for structured logging"""
        
        # Base log entry
        log_entry = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "level": record.levelname,
            "logger_name": record.name,
            "message": record.getMessage()
        }
        
        # Add component information
        component = getattr(record, 'component', None)
        if component:
            log_entry["component"] = component
        
        # Add contextual information if available
        context_fields = ['job_id', 'user_id', 'action', 'blob_url', 'file_size', 'processing_time']
        for field in context_fields:
            if hasattr(record, field):
                log_entry[field] = getattr(record, field)
        
        # Add exception information if present
        if record.exc_info:
            log_entry["exception"] = self.formatException(record.exc_info)
        
        # Add any extra fields passed via 'extra' parameter
        if hasattr(record, 'extra_fields'):
            log_entry.update(record.extra_fields)
        
        return json.dumps(log_entry, default=str)


def setup_structured_logging(component_name: str, level: str = "INFO") -> logging.Logger:
    """
    Setup structured logging for a component
    
    Args:
        component_name: Name of the component (e.g., 'azure_function', 'backend_api')
        level: Logging level (DEBUG, INFO, WARNING, ERROR)
    
    Returns:
        Configured logger instance
    """
    logger = logging.getLogger(component_name)
    
    # Clear any existing handlers to avoid duplicates
    logger.handlers.clear()
    
    # Create console handler with structured formatter
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(StructuredFormatter())
    
    # Set log level
    log_level = getattr(logging, level.upper(), logging.INFO)
    logger.setLevel(log_level)
    handler.setLevel(log_level)
    
    logger.addHandler(handler)
    
    # Prevent propagation to avoid duplicate messages
    logger.propagate = False
    
    return logger


class AuditLoggerMixin:
    """Mixin class to add structured logging capabilities to any class"""
    
    def __init__(self, component_name: str):
        self.audit_logger = setup_structured_logging(component_name)
        self.component_name = component_name
    
    def log_audit_event(self, level: str, message: str, **context):
        """
        Log an audit event with structured context
        
        Args:
            level: Log level (info, warning, error, debug)
            message: Log message
            **context: Additional context fields
        """
        log_method = getattr(self.audit_logger, level.lower(), self.audit_logger.info)
        
        # Add component to context
        context['component'] = self.component_name
        
        log_method(message, extra={'extra_fields': context})
    
    def log_job_event(self, job_id: str, action: str, message: str, **details):
        """Log a job-related event"""
        self.log_audit_event(
            level='info',
            message=message,
            job_id=job_id,
            action=action,
            **details
        )
    
    def log_user_action(self, user_id: str, action: str, message: str, **details):
        """Log a user action"""
        self.log_audit_event(
            level='info', 
            message=message,
            user_id=user_id,
            action=action,
            **details
        )
    
    def log_error(self, message: str, error: Exception, **context):
        """Log an error with exception details"""
        context['error_type'] = type(error).__name__
        context['error_message'] = str(error)
        
        self.audit_logger.error(message, exc_info=error, extra={'extra_fields': context})


# Pre-configured loggers for common components
def get_azure_function_logger() -> logging.Logger:
    """Get logger for Azure Functions"""
    return setup_structured_logging("azure_function")


def get_backend_api_logger() -> logging.Logger:
    """Get logger for Backend API"""
    return setup_structured_logging("backend_api")


def get_storage_service_logger() -> logging.Logger:
    """Get logger for Storage Service"""
    return setup_structured_logging("storage_service")


# Context manager for adding audit context to logs
class audit_context:
    """Context manager to add common fields to all logs within a block"""
    
    def __init__(self, logger: logging.Logger, **context):
        self.logger = logger
        self.context = context
        self.old_filter = None
    
    def __enter__(self):
        # Create a filter that adds context to all log records
        def add_context_filter(record):
            for key, value in self.context.items():
                setattr(record, key, value)
            return True
        
        self.old_filter = getattr(self.logger, '_context_filter', None)
        self.logger.addFilter(add_context_filter)
        self.logger._context_filter = add_context_filter
        
        return self.logger
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if hasattr(self.logger, '_context_filter'):
            self.logger.removeFilter(self.logger._context_filter)
            delattr(self.logger, '_context_filter')
        
        if self.old_filter:
            self.logger.addFilter(self.old_filter)


# Example usage functions
def log_function_start(logger: logging.Logger, function_name: str, **context):
    """Log function start with context"""
    logger.info(f"Function {function_name} started", extra={
        'extra_fields': {
            'function_name': function_name,
            'action': 'function_start',
            **context
        }
    })


def log_function_end(logger: logging.Logger, function_name: str, duration_ms: float, **context):
    """Log function completion with duration"""
    logger.info(f"Function {function_name} completed", extra={
        'extra_fields': {
            'function_name': function_name,
            'action': 'function_end',
            'duration_ms': duration_ms,
            **context
        }
    })


def log_function_error(logger: logging.Logger, function_name: str, error: Exception, **context):
    """Log function error"""
    logger.error(f"Function {function_name} failed", exc_info=error, extra={
        'extra_fields': {
            'function_name': function_name,
            'action': 'function_error',
            'error_type': type(error).__name__,
            'error_message': str(error),
            **context
        }
    })


# Performance monitoring helpers
class PerformanceTimer:
    """Context manager to time operations and log performance metrics"""
    
    def __init__(self, logger: logging.Logger, operation_name: str, **context):
        self.logger = logger
        self.operation_name = operation_name
        self.context = context
        self.start_time = None
    
    def __enter__(self):
        import time
        self.start_time = time.time()
        
        self.logger.info(f"Starting {self.operation_name}", extra={
            'extra_fields': {
                'operation': self.operation_name,
                'action': 'operation_start',
                **self.context
            }
        })
        
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        import time
        duration_ms = (time.time() - self.start_time) * 1000
        
        if exc_type is None:
            # Success
            self.logger.info(f"Completed {self.operation_name}", extra={
                'extra_fields': {
                    'operation': self.operation_name,
                    'action': 'operation_complete',
                    'duration_ms': duration_ms,
                    **self.context
                }
            })
        else:
            # Error occurred
            self.logger.error(f"Failed {self.operation_name}", exc_info=exc_val, extra={
                'extra_fields': {
                    'operation': self.operation_name,
                    'action': 'operation_error',
                    'duration_ms': duration_ms,
                    'error_type': exc_type.__name__ if exc_type else None,
                    **self.context
                }
            })


# Initialize default loggers
def init_default_logging():
    """Initialize default structured logging for the application"""
    # Set up root logger to use structured format
    root_logger = logging.getLogger()
    
    # Clear existing handlers
    root_logger.handlers.clear()
    
    # Add structured handler
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(StructuredFormatter())
    
    root_logger.addHandler(handler)
    root_logger.setLevel(logging.INFO)
    
    # Suppress noisy loggers
    logging.getLogger('azure.core.pipeline.policies.http_logging_policy').setLevel(logging.WARNING)
    logging.getLogger('azure.storage.blob').setLevel(logging.WARNING)
    logging.getLogger('azure.cosmos').setLevel(logging.WARNING)


# Export commonly used items
__all__ = [
    'setup_structured_logging',
    'AuditLoggerMixin', 
    'audit_context',
    'PerformanceTimer',
    'get_azure_function_logger',
    'get_backend_api_logger', 
    'get_storage_service_logger',
    'init_default_logging'
]
