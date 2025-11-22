import os
from dotenv import load_dotenv

load_dotenv()

# Load environment variables with quotes
VITE_ELEVENLABS_API_KEY = os.getenv("VITE_ELEVENLABS_API_KEY")
VITE_AGENT_ID = os.getenv("VITE_AGENT_ID")
VITE_GEMINI_API_KEY = os.getenv("VITE_GEMINI_API_KEY")

# Print for debugging (optional)
print(f"Loaded ELEVENLABS_API_KEY: {VITE_ELEVENLABS_API_KEY[:20]}..." if VITE_ELEVENLABS_API_KEY else "No API key")