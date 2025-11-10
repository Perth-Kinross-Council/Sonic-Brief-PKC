import os
from openai import AzureOpenAI
from azure.identity import ManagedIdentityCredential, get_bearer_token_provider
from dotenv import load_dotenv
import re
import logging
import base64

load_dotenv()
# Configure logging for the module (you can adjust as needed)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Use ManagedIdentityCredential for Azure Functions
client_id = os.getenv("AZURE_CLIENT_ID")
if client_id:
    credential = ManagedIdentityCredential(client_id=client_id)
else:
    credential = ManagedIdentityCredential()

token_provider = get_bearer_token_provider(credential, "https://cognitiveservices.azure.com/.default")    

AZURE_OPENAI_ENDPOINT=os.getenv("AZURE_OPENAI_ENDPOINT")
if not AZURE_OPENAI_ENDPOINT:
    raise ValueError("AZURE_OPENAI_ENDPOINT is not set.")

AZURE_OPENAI_DEPLOYMENT_NAME=os.environ["AZURE_OPENAI_DEPLOYMENT"]
AZURE_OPENAI_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION")

AZURE_AUDIO_MODEL=os.getenv("AZURE_AUDIO_MODEL", "")
AZURE_AUDIO_API_VERSION = os.getenv("AZURE_AUDIO_API_VERSION")

def get_oai_client():
    oai_client = AzureOpenAI(
        api_version= AZURE_OPENAI_API_VERSION,
        azure_endpoint= AZURE_OPENAI_ENDPOINT, 
        azure_ad_token_provider=token_provider
    )
    return oai_client

def get_audio_client():
    oai_client = AzureOpenAI(
        api_version= AZURE_AUDIO_API_VERSION,
        azure_endpoint= AZURE_OPENAI_ENDPOINT, 
        azure_ad_token_provider=token_provider
    )
    return oai_client

def build_prompt(prompt, transcript):
    logging.debug(f"[START] build_prompt with prompt: {prompt} and transcript length: {len(transcript)}")
    
    if prompt is None:
        return "No prompt file provided"
    elif prompt.endswith(".txt"):
        system_prompt = open(prompt, "r").read()
    else:
        system_prompt = prompt  

    messages = [
        {
        "role": "system",
        "content": system_prompt
        },
        {
        "role": "user",
        "content": (f"Here is the transcript:\n\n {transcript}") }
    ]
    return messages

def clean_json_string(json_string):
    pattern = r'^```json\s*(.*?)\s*```$'
    cleaned_string = re.sub(pattern, r'\1', json_string, flags=re.DOTALL)
    return cleaned_string.strip()

def call_llm(prompt, transcript, deployment=AZURE_OPENAI_DEPLOYMENT_NAME, response_format=None):
    logging.info(f"[START] call_llm with deployment: {deployment}")
    logging.debug(f"[INFO] Using prompt: {prompt}")
    logging.debug(f"[INFO] Using transcript: {transcript}")

    messages = build_prompt(prompt=prompt, transcript=transcript)
    logging.debug(f"[INFO] Built messages for LLM: {messages}")

    oai_client = get_oai_client()

    if response_format is not None:
        result = oai_client.beta.chat.completions.parse(model=deployment, 
                                                            temperature=0.2, 
                                                            messages=messages, 
                                                            response_format=response_format)
        
        return result.choices[0].message.parsed
    else:
        completion = oai_client.chat.completions.create(
            messages=messages,
            model=deployment,
            temperature=0.2,
            top_p=1,
            max_tokens=5000,
            stop=None,
        )

        return clean_json_string(completion.choices[0].message.content)

def parse_speakers_with_gpt4(transcribed_text: str) -> str:
    try:
        logging.info("[START] parse_speakers_with_gpt4")
        new_transcription = call_llm('./clean_transcription.txt', transcribed_text)
        return new_transcription
    except Exception as e:
        logging.error(f"Error cleaning transcription with 4o: {e}")
        return ""


def transcribe_gpt4_audio(audio_file):
    logging.info(f"[START] Requested transcription for audio file: {audio_file}")

    if not os.path.exists(audio_file):
        logging.error(f"[ERROR] Audio file not found: {audio_file}")
        raise FileNotFoundError(f"Audio file not found: {audio_file}")

    logging.info("[INFO] Initializing audio client...")
    oai_client = get_audio_client()
    logging.info("[INFO] Audio client initialized.")

    file_extension = os.path.splitext(audio_file)[1][1:]
    logging.info(f"[INFO] Detected file extension: .{file_extension}")

    try:
        with open(audio_file, "rb") as file:
            logging.info("[INFO] Reading audio file and encoding to base64...")
            encoded_string = base64.b64encode(file.read()).decode('utf-8')
        logging.info("[INFO] Audio file successfully encoded.")
    except Exception as e:
        logging.error(f"[ERROR] Failed to read or encode audio file: {e}")
        raise

    messages = [
        {
            "role": "user",
            "content": [
                { 
                    "type": "text",
                    "text": (
                        "Transcribe the audio as is. no explanation needed. "
                        "If you are able to detect the agent versus the service user, please label them as such. "
                        "use **SOCIAL_WORKER:** and **SERVICE_USER:** to label the speakers."
                    )
                },
                {
                    "type": "input_audio",
                    "input_audio": {
                        "data": encoded_string,
                        "format": file_extension
                    }
                }
            ]
        },
    ]

    logging.info("[INFO] Sending audio data to GPT-4o for transcription...")
    try:
        completion = oai_client.chat.completions.create(
            model=AZURE_AUDIO_MODEL,
            modalities=["text"],
            messages=messages
        )
        logging.info("[SUCCESS] Transcription received from GPT-4o.")
    except Exception as e:
        logging.error(f"[ERROR] Error during transcription request: {e}")
        raise

    transcript = completion.choices[0].message.content
    logging.info("[END] Returning transcription")
    return transcript


def chat_with_oai(messages, deployment=AZURE_OPENAI_DEPLOYMENT_NAME):

    oai_client = get_oai_client()

    completion = oai_client.chat.completions.create(
        messages=messages,
        model=deployment,   
        temperature=0.2,
        top_p=1,
        stream=True,
        max_tokens=5000,
        stop=None,
    )  

    # Iterate over the streamed response
    for chunk in completion:
        # Access the first choice from the chunk.
        # Since `chunk` is a Pydantic model, use attribute access instead of .get()
        if not chunk.choices:
            continue

        delta = chunk.choices[0].delta  # delta is also a Pydantic model
        # Get the content if available
        content = delta.content if delta and hasattr(delta, "content") else ""
        if content:
            yield content

def get_insights(summaries):

    system_prompt = """
    you will be provided with different call summaries, your task is to analyze all the summaries, and return key insights.

    What are the main topics? Issues? Insights and recommendations

    """
    oai_client = get_oai_client()
    
    messages = [
        {
            "role": "system",
            "content": system_prompt
        }
    ] + [
        {
            "role": "user",
            "content": f"call: {call} \n\n"
        } for call in summaries
    ]


    completion = oai_client.chat.completions.create(
        messages=messages,
        model=AZURE_OPENAI_DEPLOYMENT_NAME,   
        temperature=0.2,
        top_p=1,
        max_tokens=5000,
        stop=None,
    )  

    return completion.choices[0].message.content