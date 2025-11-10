import os
from datetime import datetime
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, Depends, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import requests

# ---------- Load environment variables ----------
load_dotenv()
PORT = int(os.getenv("PORT", "3000"))
AUTH_TOKEN = os.getenv("AUTH_TOKEN", "")

# ---------- Initialize FastAPI ----------
app = FastAPI(title="EL Agent Backend (Python)")

# ---------- Enable CORS ----------
# Allow your frontend (e.g., Vite dev server on port 5173) or any domain during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For production, replace "*" with your real frontend domain(s)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- Simple Bearer Authentication ----------
def auth(authorization: Optional[str] = Header(None)):
    # If AUTH_TOKEN is not set, skip validation (useful for local debugging)
    if not AUTH_TOKEN:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1]
    if token != AUTH_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid token")

# ---------- In-Memory "Database" ----------
# chats[userId] = [{"role": "user|assistant|system", "text": "...", "ts": "..."}]
chats: Dict[str, List[Dict[str, Any]]] = {}

def push_msg(user_id: str, role: str, text: str, ts: Optional[str] = None):
    ts = ts or datetime.utcnow().isoformat()
    chats.setdefault(user_id, []).append({"role": role, "text": text, "ts": ts})

# ---------- Pydantic Models ----------
class SaveReq(BaseModel):
    userId: str = "demo"
    role: str
    text: str
    ts: Optional[str] = None

class MemSearchReq(BaseModel):
    userId: str = "demo"
    query: Optional[str] = None

class MemAddReq(BaseModel):
    userId: str = "demo"
    text: str
    tags: Optional[List[str]] = None

# ---------- Health Check ----------
@app.get("/health")
def health():
    """Simple endpoint for checking backend status."""
    return {"ok": True, "time": datetime.utcnow().isoformat()}

# ---------- 1) Fetch Chat History ----------
@app.get("/history")
def get_history(
    userId: str = Query("demo"),
    limit: int = Query(20, ge=1, le=200),
    _=Depends(auth)
):
    msgs = chats.get(userId, [])
    return {"messages": msgs[-limit:]}

# ---------- 2) Save a Chat Message ----------
@app.post("/save")
def save_message(req: SaveReq, _=Depends(auth)):
    role = req.role.lower()
    if role not in {"user", "assistant", "system"}:
        raise HTTPException(status_code=400, detail="role must be user|assistant|system")
    push_msg(req.userId, role, req.text, req.ts)
    return {"ok": True}

# ---------- 3) Mem0 Search (stub for now; integrate real SDK/REST later) ----------
@app.post("/mem0/search")
def mem0_search(req: MemSearchReq, _=Depends(auth)):
    """
    Example of how you might later integrate Mem0 search:
    MEM0_API = os.getenv("MEM0_API_KEY")
    if MEM0_API:
        r = requests.post(
            "https://api.mem0.ai/v1/memories/search",
            headers={"Authorization": f"Bearer {MEM0_API}"},
            json={"user_id": req.userId, "query": req.query}
        )
        return r.json()
    """
    return {"items": []}  # Return empty data for now (no Mem0 integration yet)

# ---------- 4) Mem0 Add (stub for now) ----------
@app.post("/mem0/add")
def mem0_add(req: MemAddReq, _=Depends(auth)):
    """
    Example of how you might later integrate Mem0 add:
    MEM0_API = os.getenv("MEM0_API_KEY")
    if MEM0_API:
        r = requests.post(
            "https://api.mem0.ai/v1/memories",
            headers={"Authorization": f"Bearer {MEM0_API}"},
            json={"user_id": req.userId, "text": req.text, "tags": req.tags}
        )
        return r.json()
    """
    return {"id": "mock-mem0-id"}

# ---------- Run server ----------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=PORT, reload=True)
