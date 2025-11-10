import json
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone

import azure.functions as func

# Import audit logging
from simple_audit_logger import SimpleAuditLogger
from cosmos_service import CosmosService
from durable_audit import DurableAudit

app = func.FunctionApp()


# Helpers for metrics
def _get_audio_duration_seconds(local_path: str) -> float | None:
    """Best-effort audio duration detection without external services.

    Tries mutagen for common formats (mp3, m4a, aac, flac, ogg, wma, etc.),
    then falls back to wave for WAV files. Returns None if not determinable.
    """
    try:
        from mutagen import File as MutagenFile  # type: ignore

        mf = MutagenFile(local_path)
        dur = getattr(getattr(mf, "info", None), "length", None)
        if isinstance(dur, (int, float)) and dur > 0:
            return float(dur)
    except Exception:
        # Mutagen not available or file unsupported
        pass
    # Fallback for WAV
    try:
        import contextlib
        import wave

        with contextlib.closing(wave.open(local_path, "rb")) as wf:
            frames = wf.getnframes()
            rate = wf.getframerate()
            if rate:
                return frames / float(rate)
    except Exception:
        pass
    return None


@app.blob_trigger(
    arg_name="myblob",
    path="recordingcontainer/{date}/{folder}/{name}",
    connection="AzureWebJobsStorage",
)
def blob_trigger(myblob: func.InputStream, context: func.Context = None):
    """Blob trigger entry point.

    Note: Converted from async to sync. Previous implementation declared `async def` but
    performed only blocking (synchronous) I/O (network requests to OpenAI, file downloads,
    Cosmos queries). In the in-process Python worker this can starve the event loop and
    effectively serialize executions. Using a synchronous function lets the Azure Functions
    host dispatch multiple invocations via its thread pool, restoring intra-instance
    concurrency. If/when true async I/O (with awaits) is introduced, we can revisit.
    """
    logging.debug("Entered process_audio_file function (sync mode)")
    try:
        logging.info(
            "CONCURRENCY_DIAG pid=%s active_threads=%s instance_id=%s",
            os.getpid(),
            __import__('threading').active_count(),
            os.getenv('WEBSITE_INSTANCE_ID','unknown')
        )
    except Exception:
        pass
    _proc_start = time.perf_counter()
    user_info = None

    # Entra ID token validation (if Authorization header is present)
    try:
        token = None
        if context and hasattr(context, "binding_data"):
            headers = context.binding_data.get("Headers") or context.binding_data.get("headers")
            if headers:
                auth_header = headers.get("Authorization") or headers.get("authorization")
                if auth_header and auth_header.startswith("Bearer "):
                    token = auth_header.split(" ", 1)[1]
        if token:
            from entra_auth import EntraAuthService

            entra_auth = EntraAuthService()
            payload = entra_auth.verify_token(token)
            user_info = {
                "entra_oid": payload.get("oid"),
                "email": payload.get("preferred_username") or payload.get("email"),
                "roles": payload.get("roles", []),
            }
            logging.info(f"Entra ID user validated: {user_info['email']}")
    except Exception as e:
        logging.error(f"Entra ID token validation failed: {e}")
        return

    # Initialize services
    logging.debug("Initializing configuration and services...")
    try:
        from config import AppConfig
        from transcription_service import TranscriptionService
        from analysis_service import AnalysisService
        from storage_service import StorageService
        import azure_storage
        import azure_oai
    except Exception as e:
        logging.error(f"Failed to import services: {e}")
        return

    try:
        config = AppConfig()
        blob_path = myblob.name

        # Extract the file extension
        blob_path_without_extension, blob_extension = os.path.splitext(blob_path)

        # Check if the file has a valid audio extension, or is a direct transcript upload (.txt)
        audio_exts = set(x.lower() for x in getattr(config, "supported_audio_extensions", []))
        is_transcript_upload = blob_extension.lower() == ".txt"
        if (blob_extension.lower() not in audio_exts) and not is_transcript_upload:
            logging.info(
                f"Skipping file '{myblob.name}' (unsupported extension: {blob_extension})"
            )
            return

        # The blob path has structure: date/folder/filename
        path_parts = blob_path.split("/")
        if len(path_parts) >= 3:
            date_part = path_parts[0]
            folder_part = path_parts[1]
            filename = path_parts[2]
            path_without_container = folder_part
        else:
            path_without_container = blob_path_without_extension
            date_part = "unknown_date"
            folder_part = path_without_container
            filename = os.path.basename(blob_path)
            logging.warning(
                f"Unexpected blob path structure: {blob_path}. Using fallback naming."
            )

        transcription_model = os.getenv("TRANSCRIPTION_MODEL", "gpt-4o")
        logging.info(f"Using transcription model: {transcription_model}")

        cosmos_service = CosmosService(config)

        # Initialize audit logger
        audit_logger = SimpleAuditLogger(cosmos_service)

        transcription_service = TranscriptionService(config)
        analysis_service = AnalysisService(config)
        storage_service = StorageService(config)

        # Generate SAS URL for Azure Speech access and use cleaned relative path for downloads
        from azure_storage import get_blob_sas_url

        sas_blob_url = None
        try:
            # Relative path within recordings container
            relative_blob_path = blob_path
            if config.storage_recordings_container and blob_path.startswith(
                config.storage_recordings_container + "/"
            ):
                relative_blob_path = blob_path[
                    len(config.storage_recordings_container) + 1 :
                ]
            sas_blob_url = get_blob_sas_url(relative_blob_path)
        except Exception:
            logging.debug(
                "Could not generate SAS URL; will fall back to direct URL where applicable",
                exc_info=True,
            )
        blob_url = sas_blob_url or f"{config.storage_account_url}/{blob_path}"

        # Remove container name from blob_path if present to get the internal path
        blob_path_without_container = blob_path
        if blob_path.startswith(config.storage_recordings_container + "/"):
            blob_path_without_container = blob_path[
                len(config.storage_recordings_container + "/") :
            ]

        # Re-parse the path parts from the cleaned path
        clean_path_parts = blob_path_without_container.split("/")
        if len(clean_path_parts) >= 3:
            date_part = clean_path_parts[0]
            folder_part = clean_path_parts[1]
            filename = clean_path_parts[2]
            logging.info(
                f"Cleaned path structure - Date: {date_part}, Folder: {folder_part}, File: {filename}"
            )
        else:
            logging.warning(
                f"Unexpected cleaned path structure: {blob_path_without_container}"
            )

        logging.debug("Retrieving file document from CosmosDB...")
        # Always construct the full blob URL for lookup (do not duplicate container)
        full_blob_url = f"{config.storage_account_url}/{blob_path}"
        logging.info(f"Looking for file with full blob URL: {full_blob_url}")
        file_doc = cosmos_service.get_file_by_blob_url(full_blob_url)
        if not file_doc:
            # Try alternate blob URL formats in case of mismatch (remove container if present)
            alt_blob_url = f"{config.storage_account_url}/{blob_path.lstrip(config.storage_recordings_container + '/')}"
            logging.info(f"Trying alternate blob URL: {alt_blob_url}")
            file_doc = cosmos_service.get_file_by_blob_url(alt_blob_url)
        if not file_doc:
            logging.error(f"File document not found for: {blob_path}")
            logging.error(f"Tried URLs: {full_blob_url}, {alt_blob_url}")
            raise ValueError(f"File document not found: {blob_path}")

        job_id = file_doc["id"]

        # AUDIT: Log processing started
        audit_logger.log_job_event(
            job_id,
            "processing_started",
            "azure_function",
            user_info.get("email") if user_info else None,
            {
                "blob_name": myblob.name,
                "blob_path": blob_path,
                "transcription_model": transcription_model,
            },
        )

        formatted_text = ""
        audio_duration_seconds: float | None = None
        file_size_bytes: int | None = None

        if is_transcript_upload:
            # Transcript text was uploaded directly as a .txt file; read and use as formatted_text
            try:
                local_txt = azure_storage.download_blob_to_local_file(relative_blob_path)
                with open(local_txt, "r", encoding="utf-8", errors="ignore") as f:
                    formatted_text = f.read()
                try:
                    if os.path.exists(local_txt):
                        file_size_bytes = os.path.getsize(local_txt)
                finally:
                    if os.path.exists(local_txt):
                        os.remove(local_txt)
            except Exception as e:
                raise ValueError(f"Error reading uploaded transcript {blob_url}: {e}")
        elif transcription_model == "AZURE_AI_SPEECH":
            # 1. Start transcription
            logging.info("Starting transcription process...")
            transcription_id = transcription_service.submit_transcription_job(blob_url)

            # Update job status to transcribing
            cosmos_service.update_job_status(
                job_id, "transcribing", transcription_id=transcription_id
            )

            # 2. Wait for transcription completion
            logging.info("Waiting for transcription to complete...")
            status_data = transcription_service.check_status(transcription_id)

            formatted_text = transcription_service.get_results(status_data)
            # For duration metrics, download the audio briefly to inspect locally
            try:
                # Use the relative path within recordings container
                local_for_metrics = azure_storage.download_audio_to_local_file(relative_blob_path)
                try:
                    audio_duration_seconds = _get_audio_duration_seconds(local_for_metrics)
                    if os.path.exists(local_for_metrics):
                        file_size_bytes = os.path.getsize(local_for_metrics)
                finally:
                    # Clean up temp file
                    if os.path.exists(local_for_metrics):
                        os.remove(local_for_metrics)
            except Exception:
                logging.debug("Could not compute audio duration for AZURE_AI_SPEECH path", exc_info=True)
        else:
            # Step 1: Transcribe using Whisper or GPT-4-AUDIO
            try:
                # download the blob to local storage and pass to azure_oai
                logging.info(
                    f"Downloading audio file from recordings container relative_blob_path= {relative_blob_path}"
                )
                local_file = azure_storage.download_audio_to_local_file(
                    relative_blob_path
                )

                logging.info(f"Audio file downloaded to local path: {local_file}")
                transcription_text = azure_oai.transcribe_gpt4_audio(local_file)
                logging.info("Transcription text retrieved ")

                formatted_text = azure_oai.parse_speakers_with_gpt4(transcription_text)
                logging.info("Formatted text retrieved")
                # Compute audio metrics before deleting the local file
                try:
                    audio_duration_seconds = _get_audio_duration_seconds(local_file)
                    if os.path.exists(local_file):
                        file_size_bytes = os.path.getsize(local_file)
                except Exception:
                    logging.debug("Could not compute audio duration for GPT-4 audio path", exc_info=True)
                # Delete the file
                if os.path.exists(local_file):
                    os.remove(local_file)
                logging.info(f"Local file deleted: {local_file}")
            except Exception as e:
                raise ValueError(f"Error transcribing {blob_url}: {e}")

        # Save or reference transcription text
        if is_transcript_upload:
            # The uploaded .txt is the transcription source; use its URL directly
            transcription_blob_url = f"{config.storage_account_url}/{blob_path}"
            logging.info(
                f"Using uploaded transcript as transcription file: {transcription_blob_url}"
            )
        else:
            logging.info("Uploading transcription text to storage...")
            # Maintain the same folder structure as the original audio file
            transcription_blob_name = (
                f"{date_part}/{folder_part}/{folder_part}_transcription.txt"
            )
            transcription_blob_url = storage_service.upload_text(
                container_name=config.storage_recordings_container,
                blob_name=transcription_blob_name,
                text_content=formatted_text,
            )
            logging.info(f"Transcription saved to: {transcription_blob_name}")

        # Update job with transcription complete
        cosmos_service.update_job_status(
            job_id, "transcribed", transcription_file_path=transcription_blob_url
        )

        # 3. Get analysis prompts
        logging.info("Retrieving analysis prompts...")
        try:
            prompt_dict = cosmos_service.get_prompts(file_doc["prompt_subcategory_id"])
        except Exception as e:
            logging.error(f"Failed to retrieve prompts for subcategory {file_doc.get('prompt_subcategory_id')}: {e}")
            raise
        if not prompt_dict:
            logging.error("No prompts found for analysis")
            raise ValueError("No prompts found")

        # 4. Analyze transcription
        logging.info("Starting analysis of transcription...")
        # For analysis service provide full prompt dictionary
        analysis_result = analysis_service.analyze_conversation(
            formatted_text, prompt_dict
        )
        # Compute word counts for analysis output & prompt (best-effort, simple tokenization)
        try:
            analysis_text_for_count = analysis_result.get("analysis_text", "") or ""
            analysis_words = len(re.findall(r"\b\w+\b", analysis_text_for_count))
        except Exception:
            analysis_words = None
        try:
            combined_prompts_text = ""
            if isinstance(prompt_dict, dict):
                combined_prompts_text = "\n".join(
                    v for v in prompt_dict.values() if isinstance(v, str) and v.strip()
                )
            elif isinstance(prompt_dict, list):
                combined_prompts_text = "\n".join(
                    v for v in prompt_dict if isinstance(v, str) and v.strip()
                )
            prompt_words = (
                len(re.findall(r"\b\w+\b", combined_prompts_text)) if combined_prompts_text else 0
            )
        except Exception:
            prompt_words = None
        logging.info(
            f"Metrics interim: analysis_words={analysis_words}, prompt_words={prompt_words}, combined_prompts_chars={len(combined_prompts_text) if 'combined_prompts_text' in locals() else 'n/a'}"
        )

        # 5. Generate and upload DOCX
        logging.info("Generating and uploading analysis DOCX...")
        analysis_blob_name = f"{date_part}/{folder_part}/{folder_part}_analysis.docx"
        docx_blob_url = storage_service.generate_and_upload_docx(
            analysis_result["analysis_text"],
            analysis_blob_name,
        )

        # 6. Final update to job (completed)
        cosmos_service.update_job_status(
            job_id,
            "completed",
            analysis_file_path=docx_blob_url,
            analysis_text=analysis_result["analysis_text"],
        )

        # Compute and persist metrics on the job before durable audit
        try:
            processing_time_ms = int((time.perf_counter() - _proc_start) * 1000)
            # Rough word count from formatted text
            words = re.findall(r"\b\w+\b", formatted_text or "")
            transcription_words = len(words)
            metrics_payload = {
                "processing_time_ms": processing_time_ms,
                "audio_duration_seconds": audio_duration_seconds,
                "transcription_words": transcription_words,
            }
            # Add new metrics if available
            if analysis_words is not None:
                metrics_payload["analysis_words"] = analysis_words
            if prompt_words is not None:
                metrics_payload["prompt_words"] = prompt_words
            if file_size_bytes is not None:
                metrics_payload["file_size_bytes"] = file_size_bytes
            # Costing
            # Previous heuristic used tokens = words * 0.75 (which actually converts tokens->words).
            # OpenAI guidance: ~100 tokens ≈ 75 English words => tokens ≈ words * (100/75) ≈ words * 1.3333.
            # Ref: https://platform.openai.com/docs/concepts/tokens
            try:
                from config import AppConfig as _CostCfg
                _cfg_cost = _CostCfg()
                # Inputs: transcription + prompt words -> input tokens
                input_words = (transcription_words or 0) + (prompt_words or 0)
                output_words = (analysis_words or 0)
                # Use round for better symmetry; ensure non-negative ints
                input_tokens = max(0, int(round(input_words * (100.0/75.0))))
                output_tokens = max(0, int(round(output_words * (100.0/75.0))))
                model_input_cost = (
                    (input_tokens / 1_000_000) * _cfg_cost.model_input_cost_per_million
                    if _cfg_cost.model_input_cost_per_million > 0 else 0
                )
                model_output_cost = (
                    (output_tokens / 1_000_000) * _cfg_cost.model_output_cost_per_million
                    if _cfg_cost.model_output_cost_per_million > 0 else 0
                )
                audio_seconds = audio_duration_seconds or 0
                speech_cost = (
                    (audio_seconds / 3600.0) * _cfg_cost.speech_audio_cost_per_hour
                    if _cfg_cost.speech_audio_cost_per_hour > 0 else 0
                )
                total_cost = model_input_cost + model_output_cost + speech_cost
                metrics_payload.update({
                    "costing": {
                        "input_tokens": input_tokens,
                        "output_tokens": output_tokens,
                        "model_input_cost": round(model_input_cost, 6),
                        "model_output_cost": round(model_output_cost, 6),
                        "speech_audio_cost": round(speech_cost, 6),
                        "total_cost": round(total_cost, 6),
                    }
                })
            except Exception:
                logging.debug("Cost computation failed; continuing without cost metrics", exc_info=True)
            # Persist into job document
            audit_logger.add_job_metrics(job_id, metrics_payload)
        except Exception:
            logging.debug("Failed to capture/persist metrics", exc_info=True)

        # AUDIT (legacy in-job trail)
        audit_logger.log_job_event(
            job_id,
            "processing_completed",
            "azure_function",
            user_info.get("email") if user_info else None,
            {
                "status": "success",
                "analysis_file_path": docx_blob_url,
                "docx_blob_name": analysis_blob_name,
            },
        )

        # AUDIT (durable audit & job_activity containers)
        try:
            durable_audit = DurableAudit(cosmos_service)
            job_doc = cosmos_service.get_job_by_id(job_id) or {}
            metrics = job_doc.get("metrics", {})
            durable_details = {
                "job_id": job_id,
                "prompt_category_id": job_doc.get("prompt_category_id"),
                "prompt_subcategory_id": job_doc.get("prompt_subcategory_id"),
                "processing_time_ms": metrics.get("processing_time_ms"),
                "audio_duration_seconds": metrics.get("audio_duration_seconds"),
                "transcription_words": metrics.get("transcription_words"),
                "analysis_words": metrics.get("analysis_words", analysis_words),
                "prompt_words": metrics.get("prompt_words", prompt_words),
                "analysis_file_path": docx_blob_url,
                "status": "completed",
            }
            # Attach cost details if present
            cost_details = (metrics.get("costing") if isinstance(metrics.get("costing"), dict) else None)
            if cost_details:
                durable_details["costing"] = cost_details
            durable_audit.log_terminal(
                user_id=job_doc.get("user_id"),
                job_id=job_id,
                action="JOB_COMPLETED",
                status="completed",
                details=durable_details,
            )
        except Exception:
            logging.debug("Durable completion audit failed", exc_info=True)

        logging.info(f"Processing completed successfully for file: {blob_path}")

    except Exception as e:
        logging.error(f"Error processing file: {str(e)}", exc_info=True)
        try:
            if "job_id" in locals():
                from config import AppConfig

                cosmos_service = CosmosService(AppConfig())
                cosmos_service.update_job_status(job_id, "failed", error_message=str(e))

                # AUDIT (legacy trail)
                audit_logger = SimpleAuditLogger(cosmos_service)
                audit_logger.log_job_event(
                    job_id,
                    "processing_failed",
                    "azure_function",
                    user_info.get("email") if user_info else None,
                    {
                        "error": str(e),
                        "blob_path": blob_path if "blob_path" in locals() else "unknown",
                    },
                )

                # AUDIT (durable completion failure)
                try:
                    durable_audit = DurableAudit(cosmos_service)
                    job_doc = cosmos_service.get_job_by_id(job_id) or {}
                    durable_details = {
                        "job_id": job_id,
                        "prompt_category_id": job_doc.get("prompt_category_id"),
                        "prompt_subcategory_id": job_doc.get("prompt_subcategory_id"),
                        "error": str(e),
                        "status": "failed",
                    }
                    durable_audit.log_terminal(
                        user_id=job_doc.get("user_id"),
                        job_id=job_id,
                        action="JOB_FAILED",
                        status="failed",
                        details=durable_details,
                    )
                except Exception:
                    logging.debug("Durable failure audit failed", exc_info=True)
        finally:
            # re-raise for platform visibility
            raise


# Daily rollup timer: run every 10 minutes; on startup to ensure immediate execution
@app.function_name("daily_rollup")
@app.schedule(schedule="0 */10 * * * *", arg_name="timer", run_on_startup=True)
def daily_rollup(timer: func.TimerRequest) -> None:
    try:
        from config import AppConfig
        from cosmos_service import CosmosService

        config = AppConfig()
        cs = CosmosService(config)

        if not getattr(cs, "usage_analytics_container", None):
            logging.warning(
                "usage_analytics container not available; skipping daily rollup"
            )
            return

        # Determine target day window:
        # - Between 00:00–00:30 UTC: finalize previous day
        # - Otherwise: roll current UTC day to keep it up-to-date
        now = datetime.now(timezone.utc)
        if now.hour == 0 and now.minute < 30:
            target_day = (now - timedelta(days=1)).date()
        else:
            target_day = now.date()
        day_str = target_day.isoformat()  # YYYY-MM-DD
        start_dt = datetime(
            target_day.year, target_day.month, target_day.day, 0, 0, 0, tzinfo=timezone.utc
        )
        end_dt = start_dt + timedelta(days=1)
        start_ms = int(start_dt.timestamp() * 1000)
        end_ms = int(end_dt.timestamp() * 1000)
        start_iso = start_dt.isoformat()
        end_iso = end_dt.isoformat()

        def safe_query(container, query, params):
            try:
                return list(
                    container.query_items(
                        query=query,
                        parameters=params,
                        enable_cross_partition_query=True,
                    )
                )
            except Exception as e:
                logging.warning(f"daily_rollup query failed: {e}")
                return []

        # Robust created_at time filter supporting ms or ISO
        created_filter = (
            "((IS_NUMBER(c.created_at) AND c.created_at >= @start_ms AND c.created_at < @end_ms) "
            "OR (IS_STRING(c.created_at) AND c.created_at >= @start_iso AND c.created_at < @end_iso))"
        )

        # Pull jobs for the day
        jobs = safe_query(
            cs.jobs_container,
            f"SELECT c.id, c.user_id, c.status, c.metrics, c.prompt_category_id, c.prompt_subcategory_id, c.file_path FROM c WHERE c.type = 'job' AND {created_filter}",
            [
                {"name": "@start_ms", "value": start_ms},
                {"name": "@end_ms", "value": end_ms},
                {"name": "@start_iso", "value": start_iso},
                {"name": "@end_iso", "value": end_iso},
            ],
        )

        # Helper: resolve processing time for a completed job
        def resolve_processing_time_ms(job_doc: dict) -> int | None:
            try:
                mt = (job_doc.get("metrics") or {})
                pt = mt.get("processing_time_ms")
                if isinstance(pt, (int, float)) and pt >= 0:
                    return int(pt)
                # Fallback: try job_activity_logs COMPLETED record (enriched by DurableAudit/backend)
                jal = getattr(cs, "job_activity_logs_container", None)
                if not jal:
                    return None
                job_id = job_doc.get("id")
                if not job_id:
                    return None
                query = (
                    "SELECT TOP 1 c.processing_time_ms, c.started_at, c.completed_at "
                    "FROM c WHERE c.job_id = @job_id AND c.activity_type = 'COMPLETED' "
                    "ORDER BY c.timestamp DESC"
                )
                params = [{"name": "@job_id", "value": job_id}]
                try:
                    rows = list(
                        jal.query_items(
                            query=query,
                            parameters=params,
                            partition_key=job_id,
                        )
                    )
                except Exception:
                    rows = []
                if rows:
                    pt2 = rows[0].get("processing_time_ms")
                    if isinstance(pt2, (int, float)) and pt2 >= 0:
                        return int(pt2)
                return None
            except Exception:
                return None

        # Aggregate
        total_jobs = 0
        completed_jobs = 0
        failed_jobs = 0
        proc_times = []  # type: ignore[var-annotated]

        # upload type inference from file extension
        audio_exts = {
            ".wav",
            ".mp3",
            ".ogg",
            ".opus",
            ".flac",
            ".alaw",
            ".mulaw",
            ".mp4",
            ".wma",
            ".aac",
            ".amr",
            ".webm",
            ".m4a",
            ".spx",
            ".pcm",
        }
        uploaded = recorded = transcript = 0

        by_category = {}
        by_subcategory = {}

        per_user = {}

        for j in jobs:
            total_jobs += 1
            status = str(j.get("status") or "").lower()

            # Determine upload type via file_path extension early so we can use it for averages
            fp = str(j.get("file_path") or "").lower()
            path = fp.split("?", 1)[0]
            ext = path[path.rfind(".") :] if "." in path else ""

            if status == "completed":
                completed_jobs += 1
            elif status == "failed":
                failed_jobs += 1

            # avg processing time (completed audio uploads only; exclude transcript-only jobs)
            if status == "completed" and ext in audio_exts:
                pt_val = resolve_processing_time_ms(j)
                if isinstance(pt_val, int) and pt_val >= 0:
                    proc_times.append(pt_val)

            # upload type counters
            if ext == ".txt":
                transcript += 1
            elif ext in audio_exts:
                uploaded += 1

            # categories
            cid = j.get("prompt_category_id")
            sid = j.get("prompt_subcategory_id")
            if cid:
                by_category[cid] = by_category.get(cid, 0) + 1
            if cid and sid:
                key = (cid, sid)
                by_subcategory[key] = by_subcategory.get(key, 0) + 1

            # per-user rollup prep
            uid = j.get("user_id") or "__unknown__"
            pu = per_user.setdefault(
                uid,
                {
                    "total_jobs": 0,
                    "completed_jobs": 0,
                    "failed_jobs": 0,
                    "proc_times": [],
                    "uploaded": 0,
                    "recorded": 0,
                    "transcript": 0,
                    "cost_total": 0.0,
                    "cost_model_input": 0.0,
                    "cost_model_output": 0.0,
                    "cost_speech": 0.0,
                },
            )
            pu["total_jobs"] += 1
            if status == "completed":
                pu["completed_jobs"] += 1
                # Only include audio uploads in per-user processing time average
                if ext in audio_exts:
                    pt_u = resolve_processing_time_ms(j)
                    if isinstance(pt_u, int) and pt_u >= 0:
                        pu["proc_times"].append(pt_u)
            elif status == "failed":
                pu["failed_jobs"] += 1
            if ext == ".txt":
                pu["transcript"] += 1
            elif ext in audio_exts:
                pu["uploaded"] += 1

            # Accumulate costs if metrics present
            try:
                mt = j.get("metrics") or {}
                cst = mt.get("costing") or {}
                pu["cost_total"] += float(cst.get("total_cost", 0) or 0)
                pu["cost_model_input"] += float(cst.get("model_input_cost", 0) or 0)
                pu["cost_model_output"] += float(cst.get("model_output_cost", 0) or 0)
                pu["cost_speech"] += float(cst.get("speech_audio_cost", 0) or 0)
            except Exception:
                pass

            # Global cost aggregates (reuse separate running totals via global namespace)
            try:
                if 'global_costs' not in locals():
                    global_costs = {"total": 0.0, "model_input": 0.0, "model_output": 0.0, "speech": 0.0}
                cmt = j.get("metrics") or {}
                gcst = cmt.get("costing") or {}
                global_costs["total"] += float(gcst.get("total_cost", 0) or 0)
                global_costs["model_input"] += float(gcst.get("model_input_cost", 0) or 0)
                global_costs["model_output"] += float(gcst.get("model_output_cost", 0) or 0)
                global_costs["speech"] += float(gcst.get("speech_audio_cost", 0) or 0)
            except Exception:
                pass

        success_rate = completed_jobs / max(1, completed_jobs + failed_jobs)
        # Aggregate processing times: store both avg and sum for downstream weighted computations
        # Audio-only processing time aggregation
        total_processing_time_ms = int(sum(proc_times)) if proc_times else 0
        audio_completed_jobs = len(proc_times)
        avg_pt = (
            int(total_processing_time_ms / max(1, audio_completed_jobs)) if proc_times else None
        )

        global_doc = {
            "id": f"rollup_{day_str}_global",
            "type": "daily_rollup",
            "scope": "global",
            "user_id": "__global__",
            "partition_key": "__global__",
            "date": day_str,
            "totals": {
                "total_jobs": total_jobs,
                "completed_jobs": completed_jobs,
                "failed_jobs": failed_jobs,
                "success_rate": round(success_rate, 4),
            },
            # Average is now audio-only (excludes transcript-only jobs)
            "avg_processing_time_ms": avg_pt,
            # Keep legacy sum (now audio-only) and add explicit audio sum/counter for consumers
            "sum_processing_time_ms": total_processing_time_ms,
            "audio_sum_processing_time_ms": total_processing_time_ms,
            "audio_completed_jobs": audio_completed_jobs,
            "by_upload_type": {
                "uploaded": uploaded,
                "recorded": recorded,
                "transcript": transcript,
                "total": uploaded + recorded + transcript,
            },
            "by_category": [
                {"category_id": k, "count": v} for k, v in by_category.items()
            ],
            "by_subcategory": [
                {"category_id": k[0], "subcategory_id": k[1], "count": v}
                for k, v in by_subcategory.items()
            ],
            "costs": {
                "total_cost": round((global_costs["total"] if 'global_costs' in locals() else 0), 6),
                "model_input_cost": round((global_costs["model_input"] if 'global_costs' in locals() else 0), 6),
                "model_output_cost": round((global_costs["model_output"] if 'global_costs' in locals() else 0), 6),
                "speech_audio_cost": round((global_costs["speech"] if 'global_costs' in locals() else 0), 6),
            },
            "generated_at": datetime.utcnow().isoformat(),
        }

        cs.usage_analytics_container.upsert_item(global_doc)

        # Per-user docs
        for uid, agg in per_user.items():
            user_total_processing_time_ms = int(sum(agg["proc_times"])) if agg["proc_times"] else 0
            user_audio_completed = len(agg["proc_times"])  # audio-only completed jobs
            user_doc = {
                "id": f"rollup_{day_str}_user_{uid}",
                "type": "daily_rollup",
                "scope": "user",
                "user_id": uid,
                "partition_key": uid,
                "date": day_str,
                "totals": {
                    "total_jobs": agg["total_jobs"],
                    "completed_jobs": agg["completed_jobs"],
                    "failed_jobs": agg["failed_jobs"],
                    "success_rate": round(
                        (
                            agg["completed_jobs"]
                            / max(1, agg["completed_jobs"] + agg["failed_jobs"])
                        ),
                        4,
                    ),
                },
                # Average is now audio-only (excludes transcript-only jobs)
                "avg_processing_time_ms": (
                    int(user_total_processing_time_ms / max(1, user_audio_completed))
                    if agg["proc_times"]
                    else None
                ),
                # Keep legacy sum (now audio-only) and add explicit audio fields
                "sum_processing_time_ms": user_total_processing_time_ms,
                "audio_sum_processing_time_ms": user_total_processing_time_ms,
                "audio_completed_jobs": user_audio_completed,
                "by_upload_type": {
                    "uploaded": agg["uploaded"],
                    "recorded": agg["recorded"],
                    "transcript": agg["transcript"],
                    "total": agg["uploaded"] + agg["recorded"] + agg["transcript"],
                },
                "costs": {
                    "total_cost": round(agg.get("cost_total", 0), 6),
                    "model_input_cost": round(agg.get("cost_model_input", 0), 6),
                    "model_output_cost": round(agg.get("cost_model_output", 0), 6),
                    "speech_audio_cost": round(agg.get("cost_speech", 0), 6),
                },
                "generated_at": datetime.utcnow().isoformat(),
            }
            cs.usage_analytics_container.upsert_item(user_doc)

        logging.info(
            f"Daily rollup written for {day_str}: global + {len(per_user)} user docs"
        )
    except Exception as e:
        logging.error(f"daily_rollup failed: {e}", exc_info=True)
        return


# Minimal Retention Management Functions


@app.function_name("retention_cleanup")
@app.schedule(schedule="0 0 2 * * *", arg_name="timer", run_on_startup=False)  # Daily at 2 AM
def retention_cleanup(timer: func.TimerRequest) -> None:
    """Automated retention policy enforcement - deletes jobs and associated files after 30 days"""
    logging.info("Starting automated retention cleanup")

    # Check if automatic retention is enabled
    if os.getenv("ENABLE_AUTOMATIC_RETENTION", "true").lower() != "true":
        logging.info("Automatic retention is disabled via ENABLE_AUTOMATIC_RETENTION")
        return

    try:
        # Try to import and use retention service
        from config import AppConfig
        from retention_service import RetentionService

        config = AppConfig()
        retention_service = RetentionService(config, audit_service=None)

        # Apply retention policies
        results = retention_service.apply_retention_policies()

        # Log overall retention activity
        total_processed = sum(
            result.get("processed_count", 0)
            for result in results.values()
            if isinstance(result, dict)
        )

        logging.info(f"Retention cleanup completed. Processed {total_processed} items.")
        logging.info(f"Detailed results: {json.dumps(results, indent=2)}")

    except ImportError as e:
        logging.error(f"Retention service not available due to import error: {e}")
        logging.info(
            "Function registered but retention service dependencies need to be resolved"
        )
    except Exception as e:
        logging.error(f"Retention cleanup failed: {str(e)}")
        raise


@app.function_name("retention_status_report")
@app.schedule(schedule="0 0 6 * * 0", arg_name="timer", run_on_startup=False)  # Weekly on Sunday at 6 AM
def retention_status_report(timer: func.TimerRequest) -> None:
    """
    Generate a weekly retention status report.

    Trigger: Scheduled (Sunday 06:00 UTC).
    Output: Writes summary details to function logs; no persistence or notifications.
    """
    logging.info("Generating retention status report")

    try:
        from config import AppConfig
        from retention_service import RetentionService

        config = AppConfig()
        retention_service = RetentionService(config, audit_service=None)

        # Get retention status
        status = retention_service.get_retention_status()
        health = retention_service.get_retention_health()

        logging.info(f"Retention status report:")
        logging.info(f"Health: {health.get('status', 'unknown')}")
        logging.info(f"Total jobs: {status.get('job_statistics', {})}")
        logging.info(f"Configuration: {status.get('retention_configuration', {})}")

    except ImportError as e:
        logging.error(f"Retention service not available: {e}")
        logging.info("Function registered but needs dependency resolution")
    except Exception as e:
        logging.error(f"Retention status report failed: {str(e)}")
        raise


@app.function_name("get_retention_status")
@app.route(route="retention/status", methods=["GET"], auth_level=func.AuthLevel.FUNCTION)
def get_retention_status(req: func.HttpRequest) -> func.HttpResponse:
    """
    HTTP GET retention/status.

    Input: none. Auth level: Function.
    Output: JSON with job stats, eligible deletions, blob stats, and configuration.
    """
    try:
        from config import AppConfig
        from retention_service import RetentionService

        config = AppConfig()
        retention_service = RetentionService(config, audit_service=None)

        status = retention_service.get_retention_status()

        return func.HttpResponse(
            body=json.dumps(status, indent=2),
            status_code=200,
            mimetype="application/json",
        )

    except ImportError as e:
        logging.error(f"Retention service not available: {e}")
        return func.HttpResponse(
            body=json.dumps(
                {
                    "error": "Retention service dependencies not available",
                    "details": str(e),
                    "status": "function_registered_but_dependencies_missing",
                }
            ),
            status_code=503,
            mimetype="application/json",
        )
    except Exception as e:
        logging.error(f"Failed to get retention status: {str(e)}")
        return func.HttpResponse(
            body=json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json",
        )


@app.function_name("get_retention_health")
@app.route(route="retention/health", methods=["GET"], auth_level=func.AuthLevel.FUNCTION)
def get_retention_health(req: func.HttpRequest) -> func.HttpResponse:
    """
    HTTP GET retention/health.

    Input: none. Auth level: Function.
    Output: JSON health summary including Cosmos reachability and storage access.
    """
    try:
        from config import AppConfig
        from retention_service import RetentionService

        config = AppConfig()
        retention_service = RetentionService(config, audit_service=None)

        health = retention_service.get_retention_health()

        return func.HttpResponse(
            body=json.dumps(health, indent=2),
            status_code=200,
            mimetype="application/json",
        )

    except ImportError as e:
        logging.error(f"Retention service not available: {e}")
        return func.HttpResponse(
            body=json.dumps(
                {
                    "error": "Retention service dependencies not available",
                    "details": str(e),
                    "status": "function_registered_but_dependencies_missing",
                }
            ),
            status_code=503,
            mimetype="application/json",
        )
    except Exception as e:
        logging.error(f"Failed to get retention health: {str(e)}")
        return func.HttpResponse(
            body=json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json",
        )


@app.function_name("get_retention_summary")
@app.route(route="retention/summary", methods=["GET"], auth_level=func.AuthLevel.FUNCTION)
def get_retention_summary(req: func.HttpRequest) -> func.HttpResponse:
    """
    HTTP GET retention/summary.

    Input: none. Auth level: Function.
    Output: Static JSON snapshot of configured retention toggles and schedules.
    """
    try:
        summary = {
            "retention_policies": {
                "job_retention_days": os.getenv("JOB_RETENTION_DAYS", "30"),
                "failed_job_retention_days": os.getenv(
                    "FAILED_JOB_RETENTION_DAYS", "30"
                ),
                "delete_mode": os.getenv("DELETE_COMPLETED_JOBS", "true"),
                "dry_run": os.getenv("RETENTION_DRY_RUN", "false"),
            },
            "schedule": {
                "daily_cleanup": "2:00 AM UTC",
                "weekly_report": "Sunday 6:00 AM UTC",
            },
            "enabled": os.getenv("ENABLE_AUTOMATIC_RETENTION", "true"),
            "function_status": "registered_successfully",
        }

        return func.HttpResponse(
            body=json.dumps(summary, indent=2),
            status_code=200,
            mimetype="application/json",
        )
    except Exception as e:
        return func.HttpResponse(
            body=json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json",
        )


@app.function_name("manual_retention_execution")
@app.route(route="retention/execute", methods=["POST"], auth_level=func.AuthLevel.ADMIN)
def manual_retention_execution(req: func.HttpRequest) -> func.HttpResponse:
    """Manual retention policy execution endpoint"""
    try:
        from config import AppConfig
        from retention_service import RetentionService

        config = AppConfig()
        retention_service = RetentionService(config, audit_service=None)

        # Apply retention policies
        results = retention_service.apply_retention_policies()

        return func.HttpResponse(
            body=json.dumps(results, indent=2),
            status_code=200,
            mimetype="application/json",
        )

    except ImportError as e:
        logging.error(f"Retention service not available: {e}")
        return func.HttpResponse(
            body=json.dumps(
                {
                    "error": "Retention service dependencies not available",
                    "details": str(e),
                    "status": "function_registered_but_dependencies_missing",
                }
            ),
            status_code=503,
            mimetype="application/json",
        )
    except Exception as e:
        logging.error(f"Manual retention execution failed: {str(e)}")
        return func.HttpResponse(
            body=json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json",
        )
