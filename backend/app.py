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

import hashlib
import hmac
import secrets

from db import init_db, get_db, DATABASE_URL
from models import Message, User
from routes.mem0_routes import router as mem0_router
from utils import (
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


def hash_password(password: str) -> str:
    """
    Hash password with a random salt using SHA-256.
    Format: "salt$hash"
    """
    if not isinstance(password, str):
        raise ValueError("password must be a string")

    # Generate a 16-byte random salt
    salt = secrets.token_hex(16)
    pw_bytes = (salt + password).encode("utf-8")
    digest = hashlib.sha256(pw_bytes).hexdigest()
    return f"{salt}${digest}"


def verify_password(plain_password: str, stored_hash: str) -> bool:
    """
    Verify password against stored "salt$hash".
    """
    try:
        salt, digest = stored_hash.split("$", 1)
    except ValueError:
        # Incorrect format will result in immediate failure.
        return False

    pw_bytes = (salt + plain_password).encode("utf-8")
    check = hashlib.sha256(pw_bytes).hexdigest()

    # Use hmac.compare_digest to prevent timing attacks
    return hmac.compare_digest(check, digest)


# -------------------- FastAPI --------------------
app = FastAPI(title="Alfred Backend (Mem0-local)")

origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://lt-001434231557.tailb2509f.ts.net",
]

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


class ConversationStartReq(BaseModel):
    username: str


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


def _configure_tailscale_funnel() -> None:
    """
    Configure Tailscale Funnel so that:

      - https://<name>.ts.net/        -> http://localhost:5173
      - https://<name>.ts.net/backend -> http://localhost:3000
    """
    try:
        # 1) Reset any previous funnel config (idempotent)
        subprocess.run(
            ["tailscale", "funnel", "reset"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        # 2) Root path /  -> localhost:5173 (前端)
        cmd_root = [
            "tailscale",
            "funnel",
            "--bg",
            "--https=443",
            "localhost:5173",
        ]
        res_root = subprocess.run(cmd_root, capture_output=True, text=True)
        if res_root.returncode != 0:
            print(
                f"[WARN] `{' '.join(cmd_root)}` failed: "
                f"{res_root.stderr.strip() or res_root.stdout.strip()}"
            )

        # 3) /backend -> localhost:3000 (后端 API)
        cmd_backend = [
            "tailscale",
            "funnel",
            "--bg",
            "--https=443",
            "--set-path=/backend",
            "localhost:3000",
        ]
        res_backend = subprocess.run(cmd_backend, capture_output=True, text=True)
        if res_backend.returncode != 0:
            print(
                f"[WARN] `{' '.join(cmd_backend)}` failed: "
                f"{res_backend.stderr.strip() or res_backend.stdout.strip()}"
            )

        # 4) Show funnel status for debugging
        f_status = subprocess.run(
            ["tailscale", "funnel", "status"],
            capture_output=True,
            text=True,
        )
        if f_status.returncode == 0:
            print("[INFO] Tailscale funnel status:\n" + f_status.stdout)
        else:
            print(
                "[WARN] `tailscale funnel status` failed: "
                f"{f_status.stderr.strip() or f_status.stdout.strip()}"
            )

    except FileNotFoundError:
        print("[WARN] `tailscale` CLI not found. Please install Tailscale and ensure it's in PATH.")
    except Exception as e:
        print(f"[WARN] Could not configure Tailscale Funnel: {e}")



def ensure_funnel_if_enabled() -> None:
    """
    Called on startup and __main__:
      - Start Tailscale service on Windows; login via .tailscale auth key if needed.
      - If ENABLE_TAILSCALE_FUNNEL=1, configure Funnel so that:
            /        -> http://127.0.0.1:5173
            /backend -> http://127.0.0.1:3000
    """
    if not ENABLE_TAILSCALE_FUNNEL:
        return

    _start_tailscale_service_windows()
    _configure_tailscale_funnel()


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
    Stores username + salted SHA-256 hashed password in the DB.
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
        created_at=datetime.now(timezone.utc),
    )
    db.add(user)
    db.commit()

    return AuthResp(userId=username)


@app.post("/login", response_model=AuthResp)
def login(req: LoginReq, db: Session = Depends(get_db)):
    """
    Simple username/password login.
    - Looks up user in DB
    - Verifies password using verify_password()
    """
    username = (req.username or "").strip().lower()

    if not username or not req.password:
        raise HTTPException(status_code=400, detail="username and password are required")

    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")

    if not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    return AuthResp(userId=username)


@app.post("/conversation/start")
def conversation_start(req: ConversationStartReq):
    """
    Logs when a user starts a new conversation.
    """
    print(f"[INFO] User '{req.username}' started a conversation at {now_iso()}")
    return {"ok": True, "message": f"Conversation started for {req.username}"}


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
        .filter(Message.username == userId)
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
        username =req.userId,
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
