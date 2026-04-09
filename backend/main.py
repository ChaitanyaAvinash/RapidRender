from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Response
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import json
import httpx
import boto3
import random
import time
import os 
from dotenv import load_dotenv 
from amazon_transcribe.client import TranscribeStreamingClient
from amazon_transcribe.handlers import TranscriptResultStreamHandler
from amazon_transcribe.model import TranscriptEvent

#LOADING THE KEYS
load_dotenv()

app = FastAPI()
@app.get("/")
async def root():
    return {"status": "RapidRender is awake and running!"}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SERPER_API_KEY = os.getenv("SERPER_API_KEY")

bedrock_client = boto3.client(service_name='bedrock-runtime', region_name='us-east-1')

# --- IMAGE PROXY  ---
@app.get("/proxy-image")
async def proxy_image(url: str):
    async with httpx.AsyncClient() as client:
        try:
            r = await client.get(url)
            return Response(content=r.content, media_type=r.headers.get("content-type", "image/jpeg"))
        except Exception as e:
            return Response(status_code=400)

# --- SERPER SEARCH  ---
async def get_google_image(keyword: str):
    print(f"Serper Search: {keyword}")
    url = "https://google.serper.dev/images"
    payload = json.dumps({"q": keyword})
    headers = {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json'
    }
    
    async with httpx.AsyncClient() as client:
        try:
            r = await client.post(url, headers=headers, content=payload)
            if r.status_code == 200:
                images = r.json().get("images", [])
                if images:
                    top_images = images[:10] 
                    chosen_image = random.choice(top_images)
                    
                    # Grab BOTH URLs for Progressive Loading
                    thumb_url = chosen_image.get("thumbnailUrl") or chosen_image.get("imageUrl")
                    high_res_url = chosen_image.get("imageUrl") or thumb_url
                    
                    print(f"✅ Found Image! Thumb: {thumb_url} | High-Res: {high_res_url}")
                    return {"success": True, "type": "image", "thumb_url": thumb_url, "high_res_url": high_res_url}
        except Exception as e: 
            print(f"Serper Error: {e}")
            
    return {"success": False}

# --- THE SMART DIRECTOR ---
class MyEventHandler(TranscriptResultStreamHandler):
    def __init__(self, stream, websocket: WebSocket, highlights: str, description: str):
        super().__init__(stream)
        self.websocket = websocket
        self.highlights = highlights
        self.description = description
        self.last_keyword = ""
        self.last_keyword_time = 0.0
        
    async def handle_transcript_event(self, transcript_event: TranscriptEvent):
        for result in transcript_event.transcript.results:
            for alt in result.alternatives:
                text = alt.transcript.strip()
                try:
                    if result.is_partial: 
                        await self.websocket.send_json({"partial_transcript": text})
                    else:
                        print(f"🎤 You said: {text}")
                        await self.websocket.send_json({"transcript": text})
                        if len(text.split()) >= 2: 
                            asyncio.create_task(self.run_director(text))
                except Exception: pass

    async def run_director(self, text):
        prompt = f"""You are the strict visual director for a live broadcast. 
        
        BACKGROUND INFO FOR THIS VIDEO:
        - Main Highlights: {self.highlights}
        - Video Description: {self.description}
        
        Read this spoken sentence fragment: "{text}"
        
        RULES:
        1. THE VIP VISUALS: ONLY extract entities that make good TV B-roll (physical objects, specific people, company logos, data visualizations).
        2. BAN METAPHORS & FILLER: Completely ignore verbs and abstract concepts (e.g., "groundwork", "synergy", "leap", "shift"). Return [] for these.
        3. EMPTY ARRAY: If no VIP visual exists, return []. Do not force it.
        4. THE CONTEXT GLUE RULE (ANTI-AMBIGUITY): You MUST inject the Background Info into the search term. Never output ambiguous words alone. Translate generic words into highly visual search terms.
        
        CRITICAL EXAMPLES:
        - Text: "building material" -> Output: ["Futuristic Mars space colony base"]
        - Text: "the rockets" -> Output: ["NASA SpaceX space rocket launch"] 
        - Text: "laying the groundwork" -> Output: [] 
        - Text: "slashing the cost" -> Output: [] 
        
        Respond ONLY in valid JSON format. Example: {{"keywords": ["NASA Mars space rover"]}}"""
        
        body = json.dumps({
            "anthropic_version": "bedrock-2023-05-31", 
            "max_tokens": 100, 
            "messages": [{"role": "user", "content": prompt}]
        })
        
        try:
            res = bedrock_client.invoke_model(modelId="anthropic.claude-3-haiku-20240307-v1:0", body=body)
            decision = json.loads(json.loads(res.get('body').read())['content'][0]['text'])
            print(f"AI Montage Decision: {decision}")
            
            keywords = decision.get('keywords', [])
            
            if keywords and isinstance(keywords, list):
                current_time = time.time()
                
                for keyword in keywords[:1]: # Grab the first valid keyword
                    if keyword.strip():
                        if keyword == self.last_keyword and (current_time - self.last_keyword_time) < 10:
                            print(f"Skipping '{keyword}' (Already shown recently)")
                            continue 
                            
                        self.last_keyword = keyword
                        self.last_keyword_time = current_time
                        
                        asset = await get_google_image(keyword)
                        if asset and asset['success']:
                            await self.websocket.send_json({
                                "action": "new_asset", 
                                "thumb_url": asset['thumb_url'], 
                                "high_res_url": asset['high_res_url'], 
                                "type": "image"
                            })
                    
        except Exception as e: 
            print(f"AI Error: {e}")

# --- WEBSOCKET AUDIO STREAM ---
@app.websocket("/ws/audio")
async def websocket_endpoint(websocket: WebSocket, highlights: str = "", description: str = ""):
    await websocket.accept()
    print(f"🔌 Client connected! Highlights: {highlights}")

    if highlights:
        async def fetch_preload():
            print("🚀 Pre-loading Cover Art...")
            asset = await get_google_image(highlights) 
            if asset and asset['success']:
                await websocket.send_json({
                    "action": "new_asset", 
                    "thumb_url": asset['thumb_url'], 
                    "high_res_url": asset['high_res_url'], 
                    "type": "image"
                })
        
        asyncio.create_task(fetch_preload())

    client = TranscribeStreamingClient(region="us-east-1")
    stream = await client.start_stream_transcription(
        language_code="en-US",
        media_sample_rate_hz=16000,
        media_encoding="pcm"
    )
    
    handler = MyEventHandler(stream.output_stream, websocket, highlights, description)
    asyncio.create_task(handler.handle_events())
    
    try:
        while True:
            data = await websocket.receive_bytes()
            await stream.input_stream.send_audio_event(audio_chunk=data)
    except WebSocketDisconnect:
        print("❌ Client disconnected")
        await stream.input_stream.end_stream()