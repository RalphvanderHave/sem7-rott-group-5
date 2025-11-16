import os
import json
import subprocess
import time
from datetime import datetime
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, Depends, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from uuid import uuid4
import numpy as np
from sentence_transformers import SentenceTransformer

from db import init_db, get_db
from sqlalchemy.orm import Session
from sqlalchemy import desc

from models import Message

# 引入 mem0 路由（你放在 routes/mem0_routes.py 里）
from routes.mem0_routes import router as mem0_router

# -------------------- Environment --------------------
load_dotenv()
PORT = int(os.getenv("PORT", "3000"))
AUTH_TOKEN = os.getenv("AUTH_TOKEN", "")
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./alfred.db")
DEBUG_LOG = os.getenv("DEBUG_LOG", "0") == "1"
MEM_MODEL_NAME = os.getenv("MEM_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
DISABLE_CHAT_SAVE = os.getenv("DISABLE_CHAT_SAVE", "1") == "1"

# Tailscale & Funnel switches
ENABLE_TAILSCALE_FUNNEL = os.getenv("ENABLE_TAILSCALE_FUNNEL", "0") == "1"
TAILSCALE_FUNNEL_PORT = int(os.getenv("TAILSCALE_FUNNEL_PORT", str(PORT)))

# Load Tailscale auth key from .tailscale file if present
from dotenv import dotenv_values

TAILSCALE_AUTH_KEY: Optional[str] = None
if os.path.exists(".tailscale"):
    try:
        tailscale_env = dotenv_values(".tailscale")
        TAILSCALE_AUTH_KEY = tailscale_env.get("TAILSCALE")
        if TAILSCALE_AUTH_KEY:
            print("[INFO] Loaded Tailscale auth key from .tailscale")
    except Exception as e:
        print(f"[WARN] Could not load .tailscale file: {e}")

# -------------------- FastAPI --------------------
app = FastAPI(title="Alfred Backend (Mem0-local)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境记得收紧
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册 mem0 路由
app.include_router(mem0_router)


# -------------------- Authentication --------------------
def auth(authorization: Optional[str] = Header(None)):
    """
    Simple bearer token auth.
    If AUTH_TOKEN is not set, auth is disabled.
    """
    if not AUTH_TOKEN:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1]
    if token != AUTH_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid token")


# -------------------- Embedding utils (仅用于启动时预加载模型，可选) --------------------
_model: SentenceTransformer = None


def _load_model() -> SentenceTransformer:
    """Lazy-load the embedding model (singleton)."""
    global _model
    if _model is None:
        if DEBUG_LOG:
            print(f"[INFO] Loading embedding model (app): {MEM_MODEL_NAME}")
        _model = SentenceTransformer(MEM_MODEL_NAME)
    return _model


def _embed(texts: List[str]) -> np.ndarray:
    """Encode text into normalized float32 vectors."""
    model = _load_model()
    vecs = model.encode(texts, normalize_embeddings=True, convert_to_numpy=True)
    return vecs.astype(np.float32, copy=False)


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def _iso(dt: datetime) -> str:
    try:
        return dt.isoformat()
    except Exception:
        return datetime.utcnow().isoformat()


def _parse_ts(s: Optional[str]) -> datetime:
    if not s:
        return datetime.utcnow()
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt if dt.tzinfo else datetime.utcfromtimestamp(dt.timestamp())
    except Exception:
        return datetime.utcnow()


# -------------------- Request models --------------------
class SaveReq(BaseModel):
    userId: str
    role: str
    text: str
    ts: Optional[str] = None
    chatId: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None


# -------------------- Tailscale helpers --------------------
def _start_tailscale_service_windows() -> None:
    """
    Ensure Tailscale Windows service is running and logged in.
    Idempotent: safe to call multiple times.
    """
    try:
        # Start the Windows service (no-op if already running)
        subprocess.run(
            ["sc", "start", "Tailscale"],
            check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )

        # Check login state
        st = subprocess.run(["tailscale", "status"], capture_output=True, text=True)
        logged_in = (st.returncode == 0 and "logged out" not in (st.stdout + st.stderr).lower())
        if not logged_in:
            if TAILSCALE_AUTH_KEY:
                print("[INFO] Logging into Tailscale with auth key...")
                subprocess.run(["tailscale", "up", f"--authkey={TAILSCALE_AUTH_KEY}"], check=False)
            else:
                print("[WARN] Tailscale not logged in and no auth key is set. Run `tailscale up` once.")
    except FileNotFoundError:
        print("[WARN] `tailscale` CLI not found. Install Tailscale and ensure it's in PATH.")
    except Exception as e:
        print(f"[WARN] Unable to start/login Tailscale: {e}")


def _parse_funnel_url_from_status_text(text: str) -> Optional[str]:
    """
    Parse the public https URL from `tailscale funnel status` output.
    """
    if not text:
        return None
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("https://") and ".ts.net" in s:
            return s.split()[0]
    return None


def _get_funnel_url() -> Optional[str]:
    """Return the current Funnel URL if Funnel is active on this node."""
    try:
        j = subprocess.run(["tailscale", "funnel", "status", "--json"], capture_output=True, text=True)
        if j.returncode == 0 and j.stdout.strip():
            try:
                data = json.loads(j.stdout)
                txt = json.dumps(data)
                return _parse_funnel_url_from_status_text(txt.replace("\\n", "\n"))
            except Exception:
                pass

        # Fallback: plain text
        t = subprocess.run(["tailscale", "funnel", "status"], capture_output=True, text=True)
        if t.returncode == 0:
            return _parse_funnel_url_from_status_text(t.stdout)
    except Exception:
        pass
    return None


def _enable_tailscale_funnel(port: int) -> None:
    """
    Enable Tailscale Funnel for a local HTTP server on 127.0.0.1:<port>.
    """
    try:
        subprocess.run(
            ["tailscale", "funnel", "reset"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )

        cmd = ["tailscale", "funnel", "--bg", f"{port}"]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            print(f"[WARN] `{' '.join(cmd)}` failed: {res.stderr.strip() or res.stdout.strip()}")
            res2 = subprocess.run(
                ["tailscale", "funnel", "--bg", "--https=443", f"localhost:{port}"],
                capture_output=True, text=True
            )
            if res2.returncode != 0:
                print(
                    f"[WARN] Fallback `tailscale funnel --https=443 localhost:{port}` failed: "
                    f"{res2.stderr.strip() or res2.stdout.strip()}"
                )

        url = _get_funnel_url()
        if url:
            print(f"[INFO] Funnel available: {url}")
            print(f"[INFO] Mapping: {url} -> http://127.0.0.1:{port}")
        else:
            print("[WARN] Could not detect Funnel URL. Run `tailscale funnel status` to view it.")
    except FileNotFoundError:
        print("[WARN] `tailscale` CLI not found. Please install Tailscale and ensure it's in PATH.")
    except Exception as e:
        print(f"[WARN] Could not enable Tailscale Funnel: {e}")


def ensure_funnel_if_enabled():
    """
    Called on startup and __main__:
      - Start Tailscale service on Windows; login via .tailscale auth key if needed.
      - If ENABLE_TAILSCALE_FUNNEL=1, enable Funnel for TAILSCALE_FUNNEL_PORT.
    """
    if not ENABLE_TAILSCALE_FUNNEL:
        return
    _start_tailscale_service_windows()
    _enable_tailscale_funnel(TAILSCALE_FUNNEL_PORT)


# -------------------- Middleware (debug logging) --------------------
@app.middleware("http")
async def debug_logger(request: Request, call_next):
    """
    Lightweight access log when DEBUG_LOG=1.
    Example:
      [DEBUG] 127.0.0.1 GET /health -> 200 (3.2 ms)
    """
    start = time.perf_counter()
    try:
        response = await call_next(request)
        if DEBUG_LOG:
            dur_ms = (time.perf_counter() - start) * 1000
            client = getattr(request.client, "host", "-")
            print(
                f"[DEBUG] {client} {request.method} {request.url.path} -> "
                f"{response.status_code} ({dur_ms:.1f} ms)",
                flush=True
            )
        return response
    except Exception as e:
        if DEBUG_LOG:
            client = getattr(request.client, "host", "-")
            print(f"[DEBUG] {client} {request.method} {request.url.path} !! {e}", flush=True)
        raise


# -------------------- Health --------------------
@app.get("/health")
def health():
    return {
        "ok": True,
        "time": _now_iso(),
        "db": DATABASE_URL,
        "chat_save": not DISABLE_CHAT_SAVE,
        "model": MEM_MODEL_NAME,
        "funnel": {"enabled": ENABLE_TAILSCALE_FUNNEL, "port": TAILSCALE_FUNNEL_PORT},
    }


# -------------------- Chat history (optional, disabled by default) --------------------
@app.get("/history")
def get_history(
        userId: str = Query(...),
        limit: int = Query(20, ge=1, le=200),
        db: Session = Depends(get_db),
        _=Depends(auth)
):
    rows = (
        db.query(Message)
        .filter(Message.user_id == userId)
        .order_by(desc(Message.ts))
        .limit(limit)
        .all()
    )
    rows = list(reversed(rows))
    return {"messages": [{"role": r.role, "text": r.text, "ts": _iso(r.ts)} for r in rows]}


# -------------------- /save (with printing body) --------------------
@app.post("/save")
def save_message(req: SaveReq, request: Request, db: Session = Depends(get_db), _=Depends(auth)):
    """
    Disabled by default unless DISABLE_CHAT_SAVE=0.
    """
    if DEBUG_LOG:
        print("\n[REQ] /save -----------------", flush=True)
        print("Headers:", dict(request.headers), flush=True)
        print("Body:", req.model_dump(), flush=True)
        print("[REQ END] -------------------\n", flush=True)

    if DISABLE_CHAT_SAVE:
        return {"ok": True, "skipped": "chat-saving disabled"}

    role = req.role.lower()
    if role not in {"user", "assistant", "system"}:
        raise HTTPException(status_code=400, detail="role must be user|assistant|system")

    msg = Message(
        id=str(uuid4()),
        user_id=req.userId,
        chat_id=req.chatId,
        role=role,
        text=req.text,
        ts=_parse_ts(req.ts),
        meta=req.meta,
    )
    db.add(msg)
    db.commit()
    return {"ok": True}


# -------------------- Startup --------------------
@app.on_event("startup")
def on_startup():
    init_db()
    # 预加载 embedding 模型，避免第一次请求时卡顿（可选）
    _load_model()
    print("[INFO] Alfred backend ready.")
    print(f"[INFO] Database: {DATABASE_URL}")
    print(f"[INFO] Auth: {'ON' if AUTH_TOKEN else 'OFF'}")
    print(f"[INFO] Chat saving: {'DISABLED' if DISABLE_CHAT_SAVE else 'ENABLED'}")
    # Best-effort: enable Tailscale Serve + Funnel
    ensure_funnel_if_enabled()


if __name__ == "__main__":
    import uvicorn

    # Best-effort: enable Tailscale Serve + Funnel before binding the port
    ensure_funnel_if_enabled()
    uvicorn.run("app:app", host="0.0.0.0", port=PORT, reload=True)
