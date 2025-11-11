import os
import re
import json
import subprocess
from datetime import datetime
from typing import List, Optional, Dict, Any, Tuple

from fastapi import FastAPI, Depends, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv, dotenv_values

from uuid import uuid4
import numpy as np
from sentence_transformers import SentenceTransformer

from db import init_db, get_db
from sqlalchemy.orm import Session
from sqlalchemy import desc

from models import Message, Memory

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
    allow_origins=["*"],  # tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -------------------- Authentication --------------------
def auth(authorization: Optional[str] = Header(None)):
    """Simple bearer token auth."""
    if not AUTH_TOKEN:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1]
    if token != AUTH_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid token")


# -------------------- Embedding utils --------------------
_model: SentenceTransformer = None


def _load_model() -> SentenceTransformer:
    """Lazy-load the embedding model."""
    global _model
    if _model is None:
        if DEBUG_LOG:
            print(f"[INFO] Loading embedding model: {MEM_MODEL_NAME}")
        _model = SentenceTransformer(MEM_MODEL_NAME)
    return _model


def _embed(texts: List[str]) -> np.ndarray:
    """Encode text into normalized vectors (float32)."""
    model = _load_model()
    vecs = model.encode(texts, normalize_embeddings=True, convert_to_numpy=True)
    return vecs.astype(np.float32, copy=False)


def _from_bytes(b: bytes) -> np.ndarray:
    """Convert stored bytes back to numpy vector."""
    return np.frombuffer(b, dtype=np.float32)


# -------------------- Time helpers --------------------
def _parse_ts(s: Optional[str]) -> datetime:
    if not s:
        return datetime.utcnow()
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt if dt.tzinfo else datetime.utcfromtimestamp(dt.timestamp())
    except Exception:
        return datetime.utcnow()


def _iso(dt: datetime) -> str:
    try:
        return dt.isoformat()
    except Exception:
        return datetime.utcnow().isoformat()


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


# -------------------- Request models --------------------
class SaveReq(BaseModel):
    userId: str
    role: str
    text: str
    ts: Optional[str] = None
    chatId: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None


class MemSearchReq(BaseModel):
    userId: str
    query: Optional[str] = None
    top_k: int = 5


class MemAddReq(BaseModel):
    userId: str
    text: str
    tags: Optional[List[str]] = None
    ts: Optional[str] = None


class MemDeleteReq(BaseModel):
    userId: str
    id: str


class MemClearReq(BaseModel):
    userId: str


class MemAutoReq(BaseModel):
    userId: str
    utterance: str
    suggest_text: Optional[str] = None
    suggest_tags: Optional[List[str]] = None
    dedupe_threshold: float = 0.9


# -------------------- Tailscale helpers (NEW) --------------------
def _start_tailscale_service_windows() -> None:
    """
    Ensure Tailscale Windows service is running and logged in.
    Idempotent: safe to call multiple times.
    """
    try:
        # Start the Windows service (no-op if already running)
        subprocess.run(["sc", "start", "Tailscale"],
                       check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

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
    Parse the public https URL from `tailscale funnel status` output (text mode).
    Lines often look like:
      Available on the internet:
      https://<device>.ts.net
    or mapping lines like:
      https://<device>.ts.net -> http://127.0.0.1:3000 ...
    """
    if not text:
        return None
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("https://") and ".ts.net" in s:
            # keep only the URL token
            return s.split()[0]
    return None


def _get_funnel_url() -> Optional[str]:
    """
    Return the current Funnel URL if Funnel is active on this node.
    Prefer JSON; fall back to plain text parsing.
    """
    try:
        j = subprocess.run(["tailscale", "funnel", "status", "--json"], capture_output=True, text=True)
        if j.returncode == 0 and j.stdout.strip():
            try:
                data = json.loads(j.stdout)
                # Newer clients expose a top-level or nested mapping of https sites.
                # We search for any "https://" hostname present.
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
    New CLI (≥1.52):
      - Public internet:   `tailscale funnel 3000`
      - Limit to tailnet:  `tailscale serve --http=80 localhost:3000`
    Notes:
      * Only http://127.0.0.1 proxies are supported for reverse proxy.
      * If you need a fixed HTTPS listener port, use: `tailscale funnel --https=443 localhost:3000`.
    """
    try:
        # Reset old funnel config (optional but helps when migrating)
        subprocess.run(["tailscale", "funnel", "reset"], check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        # Start Funnel in background for the local app on 127.0.0.1:<port>
        # (default HTTPS listener is an allowed port; examples show plain `tailscale funnel 3000`)
        cmd = ["tailscale", "funnel", "--bg", f"{port}"]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            # Try explicit mapping with allowed HTTPS port
            print(f"[WARN] `{' '.join(cmd)}` failed: {res.stderr.strip() or res.stdout.strip()}")
            res2 = subprocess.run(
                ["tailscale", "funnel", "--bg", "--https=443", f"localhost:{port}"],
                capture_output=True, text=True
            )
            if res2.returncode != 0:
                print(f"[WARN] Fallback `tailscale funnel --https=443 localhost:{port}` failed: "
                      f"{res2.stderr.strip() or res2.stdout.strip()}")

        # Print the URL (if we can detect it)
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
    Entrypoint used by startup & __main__:
      - Start Tailscale service on Windows; login via .tailscale auth key if needed.
      - If ENABLE_TAILSCALE_FUNNEL=1, enable Funnel for TAILSCALE_FUNNEL_PORT.
    """
    if not ENABLE_TAILSCALE_FUNNEL:
        return
    _start_tailscale_service_windows()
    _enable_tailscale_funnel(TAILSCALE_FUNNEL_PORT)


# -------------------- Middleware (debug logging) --------------------
import time

@app.middleware("http")
async def debug_logger(request: Request, call_next):
    start = time.perf_counter()
    try:
        response = await call_next(request)
        if DEBUG_LOG:
            dur_ms = (time.perf_counter() - start) * 1000
            # 例如: [DEBUG] 127.0.0.1 GET /health -> 200 (3.2 ms)
            client = getattr(request.client, "host", "-")
            print(f"[DEBUG] {client} {request.method} {request.url.path} -> {response.status_code} ({dur_ms:.1f} ms)", flush=True)
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
        "funnel": {"enabled": ENABLE_TAILSCALE_FUNNEL, "port": TAILSCALE_FUNNEL_PORT}
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


@app.post("/save")
def save_message(req: SaveReq, db: Session = Depends(get_db), _=Depends(auth)):
    """Disabled by default. Set DISABLE_CHAT_SAVE=0 to enable."""
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


# -------------------- Internal memory save helper --------------------
def _save_memory(
        db: Session,
        user_id: str,
        text: str,
        tags: Optional[List[str]] = None,
        created_ts: Optional[str] = None,
        dedupe_threshold: float = 0.9
) -> Dict[str, Any]:
    text = (text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    q_vec = _embed([text])[0]
    mems = db.query(Memory).filter(Memory.user_id == user_id).all()

    best_score = -1.0
    best_id = None
    for m in mems:
        v = _from_bytes(m.embedding)
        score = float(np.dot(q_vec, v))
        if score > best_score:
            best_score = score
            best_id = m.id

    if best_score >= dedupe_threshold:
        return {"ok": True, "skipped": "duplicate", "dup_id": best_id, "score": round(best_score, 4)}

    mem = Memory(
        id=str(uuid4()),
        user_id=user_id,
        text=text,
        tags=tags or [],
        created_at=_parse_ts(created_ts),
        embedding=q_vec.tobytes(),
    )
    db.add(mem)
    db.commit()
    return {"ok": True, "id": mem.id}


# -------------------- /mem0/add --------------------
@app.post("/mem0/add")
def mem0_add(req: MemAddReq, db: Session = Depends(get_db), _=Depends(auth)):
    result = _save_memory(
        db=db,
        user_id=req.userId,
        text=req.text,
        tags=req.tags,
        created_ts=req.ts,
        dedupe_threshold=0.9
    )
    return result


# -------------------- /mem0/search --------------------
@app.post("/mem0/search")
def mem0_search(req: MemSearchReq, db: Session = Depends(get_db), _=Depends(auth)):
    if not req.query or not req.query.strip():
        items = (
            db.query(Memory)
            .filter(Memory.user_id == req.userId)
            .order_by(desc(Memory.created_at))
            .limit(max(1, req.top_k))
            .all()
        )
        return {
            "items": [
                {
                    "id": m.id,
                    "text": m.text,
                    "tags": m.tags or [],
                    "created_at": _iso(m.created_at),
                    "score": None
                } for m in items
            ]
        }

    q_vec = _embed([req.query])[0]
    mems = db.query(Memory).filter(Memory.user_id == req.userId).all()

    scored: List[Tuple[float, Memory]] = []
    for m in mems:
        v = _from_bytes(m.embedding)
        score = float(np.dot(q_vec, v))
        scored.append((score, m))

    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[: max(1, req.top_k)]

    return {
        "items": [
            {
                "id": m.id,
                "text": m.text,
                "tags": m.tags or [],
                "created_at": _iso(m.created_at),
                "score": round(score, 4)
            } for score, m in top
        ]
    }


# -------------------- /mem0/delete --------------------
@app.post("/mem0/delete")
def mem0_delete(req: MemDeleteReq, db: Session = Depends(get_db), _=Depends(auth)):
    m = db.query(Memory).filter(Memory.user_id == req.userId, Memory.id == req.id).first()
    if not m:
        raise HTTPException(status_code=404, detail="memory not found")
    db.delete(m)
    db.commit()
    return {"ok": True}


# -------------------- /mem0/clear --------------------
@app.post("/mem0/clear")
def mem0_clear(req: MemClearReq, db: Session = Depends(get_db), _=Depends(auth)):
    db.query(Memory).filter(Memory.user_id == req.userId).delete()
    db.commit()
    return {"ok": True, "cleared": True}


# -------------------- /mem0/auto --------------------
_PREF_WORDS = ["like", "love", "prefer", "enjoy", "dislike", "hate"]
_HABIT_WORDS = ["every day", "each morning", "each night", "routine", "habit"]
_EVENT_WORDS = ["appointment", "meeting", "visit", "birthday", "doctor", "dentist"]
_RULE_WORDS = ["remember", "from now on", "always", "never", "please", "remind", "avoid"]

DATE_RE = re.compile(r"(20\d{2}-\d{2}-\d{2})")
TIME_RE = re.compile(r"\b([01]?\d|2[0-3]):([0-5]\d)\b")


def _classify_and_summarize(utterance: str) -> Tuple[bool, str, List[str]]:
    """
    Heuristic classification + short summarization for memory-worthiness.
    Keeps the summary under 120 chars and assigns tags.
    """
    u = (utterance or "").strip()
    if not u:
        return (False, "", [])

    u_lower = u.lower()
    tags: List[str] = []
    should = False

    if any(w in u_lower for w in _PREF_WORDS):
        should = True
        tags.append("preference")
    if any(w in u_lower for w in _HABIT_WORDS):
        should = True
        tags.extend(["habit", "schedule"])
    if any(w in u_lower for w in _EVENT_WORDS):
        should = True
        tags.append("event")
    if any(w in u_lower for w in _RULE_WORDS):
        should = True
        if "preference" not in tags:
            tags.append("preference")

    date_match = DATE_RE.search(u)
    time_match = TIME_RE.search(u)
    dt_text = ""
    if date_match:
        dt_text = date_match.group(1)
    if time_match:
        t = ":".join(time_match.groups())
        dt_text = (dt_text + " " + t).strip()

    summary = ""
    if should:
        summary = f"{dt_text} {u}".strip() if dt_text else u
        if len(summary) > 120:
            summary = summary[:117] + "..."
        if any(x in u_lower for x in ["music", "song", "piano"]):
            tags.append("music")
        if any(x in u_lower for x in ["sleep", "bed"]):
            tags.append("sleep")
        if any(x in u_lower for x in ["coffee", "tea", "food"]):
            tags.append("food")
        if any(x in u_lower for x in ["doctor", "medicine"]):
            tags.append("health")
        # Deduplicate tags while preserving order
        tags = list(dict.fromkeys(tags))

    return (should, summary, tags)


@app.post("/mem0/auto")
def mem0_auto(req: MemAutoReq, db: Session = Depends(get_db), _=Depends(auth)):
    utter = (req.utterance or "").strip()
    if not utter:
        return {"should_save": False, "reason": "empty utterance"}

    if req.suggest_text:
        should = True
        summary = req.suggest_text.strip()
        tags = req.suggest_tags or []
        if not summary:
            return {"should_save": False, "reason": "empty suggest_text"}
    else:
        should, summary, tags = _classify_and_summarize(utter)

    if not should:
        return {"should_save": False, "reason": "not memory-worthy"}

    result = _save_memory(
        db=db,
        user_id=req.userId,
        text=summary,
        tags=tags,
        created_ts=None,
        dedupe_threshold=max(0.5, min(0.99, req.dedupe_threshold))
    )

    resp = {"should_save": True, "summary": summary, "tags": tags}
    resp.update(result)
    return resp


# -------------------- Startup --------------------
@app.on_event("startup")
def on_startup():
    init_db()
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
