# /backend/app.py
from datetime import datetime, timezone
import os
import json
import subprocess
import time
from typing import Optional, Dict, Any

from fastapi import FastAPI, Depends, Query, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import dotenv_values

from uuid import uuid4
from sqlalchemy.orm import Session
from sqlalchemy import desc
from passlib.context import CryptContext

from .db import init_db, get_db, DATABASE_URL
from .models import Message, User
from .routes.mem0_routes import router as mem0_router
from .utils import (
    auth,
    load_model,
    now_iso,
    iso_datetime,
    parse_ts,
    DEBUG_LOG,
    MEM_MODEL_NAME,
    AUTH_TOKEN,
)

# -------------------- Environment --------------------
PORT = int(os.getenv("PORT", "3000"))
DISABLE_CHAT_SAVE = os.getenv("DISABLE_CHAT_SAVE", "1") == "1"

# Tailscale & Funnel switches
ENABLE_TAILSCALE_FUNNEL = os.getenv("ENABLE_TAILSCALE_FUNNEL", "0") == "1"
TAILSCALE_FUNNEL_PORT = int(os.getenv("TAILSCALE_FUNNEL_PORT", str(PORT)))

# Load Tailscale auth key from .tailscale file if present
TAILSCALE_AUTH_KEY: Optional[str] = None
if os.path.exists(".tailscale"):
    try:
        tailscale_env = dotenv_values(".tailscale")
        TAILSCALE_AUTH_KEY = tailscale_env.get("TAILSCALE")
        if TAILSCALE_AUTH_KEY:
            print("[INFO] Loaded Tailscale auth key from .tailscale")
    except Exception as e:
        print(f"[WARN] Could not load .tailscale file: {e}")

# Password hash configuration (for user registration/login)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        return False


# -------------------- FastAPI --------------------
app = FastAPI(title="Alfred Backend (Mem0-local)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register mem0 router
app.include_router(mem0_router)


# -------------------- Request models --------------------
class SaveReq(BaseModel):
    userId: str
    role: str
    text: str
    ts: Optional[str] = None
    chatId: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None


class RegisterReq(BaseModel):
    username: str
    password: str


class LoginReq(BaseModel):
    username: str
    password: str


class AuthResp(BaseModel):
    userId: str


# -------------------- Tailscale helpers --------------------
def _start_tailscale_service_windows() -> None:
    """
    Ensure Tailscale Windows service is running and logged in.
    Idempotent: safe to call multiple times.
    Only relevant on Windows hosts.
    """
    if os.name != "nt":
        return

    try:
        # Start the Windows service (no-op if already running)
        subprocess.run(
            ["sc", "start", "Tailscale"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        # Check login state
        st = subprocess.run(["tailscale", "status"], capture_output=True, text=True)
        output = (st.stdout + st.stderr).lower()
        logged_in = st.returncode == 0 and "logged out" not in output

        if not logged_in:
            if TAILSCALE_AUTH_KEY:
                print("[INFO] Logging into Tailscale with auth key...")
                subprocess.run(
                    ["tailscale", "up", f"--authkey={TAILSCALE_AUTH_KEY}"],
                    check=False,
                )
            else:
                print(
                    "[WARN] Tailscale not logged in and no auth key is set. "
                    "Run `tailscale up` once manually."
                )
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
    """
    Return the current Funnel URL if Funnel is active on this node.
    """
    try:
        # Prefer JSON output
        j = subprocess.run(
            ["tailscale", "funnel", "status", "--json"],
            capture_output=True,
            text=True,
        )
        if j.returncode == 0 and j.stdout.strip():
            try:
                data = json.loads(j.stdout)
                txt = json.dumps(data)
                return _parse_funnel_url_from_status_text(txt.replace("\\n", "\n"))
            except Exception:
                pass

        # Fallback: plain text
        t = subprocess.run(
            ["tailscale", "funnel", "status"],
            capture_output=True,
            text=True,
        )
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
            stderr=subprocess.DEVNULL,
        )

        cmd = ["tailscale", "funnel", "--bg", str(port)]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            print(f"[WARN] `{' '.join(cmd)}` failed: {res.stderr.strip() or res.stdout.strip()}")
            # Fallback to explicit HTTPS mapping
            res2 = subprocess.run(
                ["tailscale", "funnel", "--bg", "--https=443", f"localhost:{port}"],
                capture_output=True,
                text=True,
            )
            if res2.returncode != 0:
                print(
                    "[WARN] Fallback `tailscale funnel --https=443 localhost:{port}` failed: "
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


def ensure_funnel_if_enabled() -> None:
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
                flush=True,
            )
        return response
    except Exception as e:
        if DEBUG_LOG:
            client = getattr(request.client, "host", "-")
            print(f"[DEBUG] {client} {request.method} {request.url.path} !! {e}", flush=True)
        raise


# -------------------- User Register & Login --------------------
@app.post("/register", response_model=AuthResp)
def register(req: RegisterReq, db: Session = Depends(get_db)):
    """
    Register a new user.
    Stores username + bcrypt-hashed password in the DB.
    """
    username = (req.username or "").strip().lower()
    if not username or not req.password:
        raise HTTPException(status_code=400, detail="username and password are required")

    # Check if user exists
    existing = db.query(User).filter(User.username == username).first()
    if existing:
        raise HTTPException(status_code=409, detail="username already exists")

    user = User(
        id=str(uuid4()),
        username=username,
        password_hash=hash_password(req.password),
        created_at=datetime.utcnow(),
    )
    db.add(user)
    db.commit()

    return AuthResp(userId=username)


@app.post("/login", response_model=AuthResp)
def login(req: LoginReq, db: Session = Depends(get_db)):
    """
    Simple username/password login.
    - Looks up user in DB
    - Verifies bcrypt password
    - Returns userId for the frontend
    """
    username = (req.username or "").strip().lower()
    if not username or not req.password:
        raise HTTPException(status_code=400, detail="username and password are required")

    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    return AuthResp(userId=username)


# -------------------- Health --------------------
@app.get("/health")
def health():
    return {
        "ok": True,
        "time": now_iso(),
        "db": DATABASE_URL,
        "chat_save": not DISABLE_CHAT_SAVE,
        "model": MEM_MODEL_NAME,
        "funnel": {"enabled": ENABLE_TAILSCALE_FUNNEL, "port": TAILSCALE_FUNNEL_PORT},
    }


# -------------------- Chat history (optional) --------------------
@app.get("/history")
def get_history(
        userId: str = Query(...),
        limit: int = Query(20, ge=1, le=200),
        db: Session = Depends(get_db),
        _=Depends(auth),
):
    rows = (
        db.query(Message)
        .filter(Message.user_id == userId)
        .order_by(desc(Message.ts))
        .limit(limit)
        .all()
    )
    rows = list(reversed(rows))
    return {"messages": [{"role": r.role, "text": r.text, "ts": iso_datetime(r.ts)} for r in rows]}


# -------------------- /save --------------------
@app.post("/save")
def save_message(req: SaveReq, request: Request, db: Session = Depends(get_db), _=Depends(auth)):
    """
    Persist chat messages when DISABLE_CHAT_SAVE=0.
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
        ts=parse_ts(req.ts),
        meta=req.meta,
    )
    db.add(msg)
    db.commit()
    return {"ok": True}


# -------------------- Startup --------------------
@app.on_event("startup")
def on_startup():
    init_db()
    # Optional: preload embedding model to avoid first-request latency
    load_model()

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
    uvicorn.run("backend.app:app", host="0.0.0.0", port=PORT, reload=True)
