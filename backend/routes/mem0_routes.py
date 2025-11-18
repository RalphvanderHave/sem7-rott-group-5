# /backend/routes/mem0_routes.py
import os
import re
from datetime import datetime
from typing import List, Optional, Dict, Any, Tuple

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from uuid import uuid4

import numpy as np
from sqlalchemy.orm import Session
from sqlalchemy import desc

from db import get_db
from models import Memory
from utils import embed, parse_ts, iso_datetime, DEBUG_LOG, auth

router = APIRouter(tags=["mem0"])

# ===== Pydantic models =====
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
    userId: Optional[str] = None
    utterance: str
    suggest_text: Optional[str] = None
    suggest_tags: Optional[List[str]] = None
    dedupe_threshold: float = 0.9


# ===== Auxiliary Functions =====
def _from_bytes(b: bytes) -> np.ndarray:
    return np.frombuffer(b, dtype=np.float32)


# ===== Internal memory storage logic =====
def _save_memory(
    db: Session,
    user_id: str,
    text: str,
    tags: Optional[List[str]] = None,
    created_ts: Optional[str] = None,
    dedupe_threshold: float = 0.9,
) -> Dict[str, Any]:
    # 🔥 user_id lower
    user_id = (user_id or "").strip().lower()
    if not user_id:
        raise HTTPException(status_code=400, detail="userId is required")

    text = (text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    q_vec = embed([text])[0]
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
        return {
            "ok": True,
            "skipped": "duplicate",
            "dup_id": best_id,
            "score": round(best_score, 4),
        }

    mem = Memory(
        id=str(uuid4()),
        user_id=user_id,
        text=text,
        tags=tags or [],
        created_at=parse_ts(created_ts),
        embedding=q_vec.tobytes(),
    )
    db.add(mem)
    db.commit()
    return {"ok": True, "id": mem.id}


# ===== Category & userId Inference =====
_PREF_WORDS = ["like", "love", "prefer", "enjoy", "dislike", "hate"]
_HABIT_WORDS = ["every day", "each morning", "each night", "routine", "habit", "every week", "weekly"]
_EVENT_WORDS = ["appointment", "meeting", "visit", "birthday", "doctor", "dentist"]
_RULE_WORDS = ["remember", "from now on", "always", "never", "please", "remind", "avoid"]

DATE_RE = re.compile(r"(20\d{2}-\d{2}-\d{2})")
TIME_RE = re.compile(r"\b([01]?\d|2[0-3]):([0-5]\d)\b")

_NAME_PATTERNS = [
    re.compile(r"\bmy name is\s+([A-Za-z][A-Za-z0-9_\- ]{1,40})", re.I),
    re.compile(r"\bi am\s+([A-Za-z][A-Za-z0-9_\- ]{1,40})", re.I),
    re.compile(r"\bi'm\s+([A-Za-z][A-Za-z0-9_\- ]{1,40})", re.I),
    re.compile(r"(?:我叫|我是)\s*([A-Za-z\u4e00-\u9fa5][A-Za-z0-9_\-\u4e00-\u9fa5 ]{0,40})", re.I),
]


def _classify_and_summarize(utterance: str) -> Tuple[bool, str, List[str]]:
    u = (utterance or "").strip()
    if not u:
        return False, "", []

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

        # Remove duplicates but preserve order
        seen = set()
        tags = [t for t in tags if not (t in seen or seen.add(t))]

    return should, summary, tags


def _infer_user_id_from_utterance(utter: str) -> Optional[str]:
    u = (utter or "").strip()
    for pat in _NAME_PATTERNS:
        m = pat.search(u)
        if m:
            name = m.group(1).strip()
            name = re.sub(r"\s+", " ", name)
            name = name.strip(".,!?:;，。！？：；")
            if name:
                return name
    return None


# ===== mem0 endpoints =====
@router.post("/mem0/add")
def mem0_add(req: MemAddReq, request: Request, db: Session = Depends(get_db), _=Depends(auth)):
    if DEBUG_LOG:
        print("\n[REQ] /mem0/add -----------------", flush=True)
        print("Headers:", dict(request.headers), flush=True)
        print("Body:", req.model_dump(), flush=True)
        print("[REQ END] -----------------------\n", flush=True)

    user_id = (req.userId or "").strip().lower()
    if not user_id:
        raise HTTPException(status_code=400, detail="userId is required")

    result = _save_memory(
        db=db,
        user_id=user_id,
        text=req.text,
        tags=req.tags,
        created_ts=req.ts,
        dedupe_threshold=0.9,
    )
    return result


@router.post("/mem0/search")
def mem0_search(req: MemSearchReq, request: Request, db: Session = Depends(get_db), _=Depends(auth)):
    if DEBUG_LOG:
        print("\n[REQ] /mem0/search -----------------", flush=True)
        print("Headers:", dict(request.headers), flush=True)
        print("Body:", req.model_dump(), flush=True)
        print("[REQ END] ------------------------\n", flush=True)

    user_id = (req.userId or "").strip().lower()
    if not user_id:
        raise HTTPException(status_code=400, detail="userId is required")

    top_k = max(1, req.top_k)

    # no query: return latest memories
    if not req.query or not req.query.strip():
        items = (
            db.query(Memory)
            .filter(Memory.user_id == user_id)
            .order_by(desc(Memory.created_at))
            .limit(top_k)
            .all()
        )
        return {
            "items": [
                {
                    "id": m.id,
                    "text": m.text,
                    "tags": m.tags or [],
                    "created_at": iso_datetime(m.created_at),
                    "score": None,
                }
                for m in items
            ]
        }

    q_vec = embed([req.query])[0]
    mems = db.query(Memory).filter(Memory.user_id == user_id).all()

    scored: List[Tuple[float, Memory]] = []
    for m in mems:
        v = _from_bytes(m.embedding)
        score = float(np.dot(q_vec, v))
        scored.append((score, m))

    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:top_k]

    return {
        "items": [
            {
                "id": m.id,
                "text": m.text,
                "tags": m.tags or [],
                "created_at": iso_datetime(m.created_at),
                "score": round(score, 4),
            }
            for score, m in top
        ]
    }


@router.post("/mem0/delete")
def mem0_delete(req: MemDeleteReq, request: Request, db: Session = Depends(get_db), _=Depends(auth)):
    if DEBUG_LOG:
        print("\n[REQ] /mem0/delete -----------------", flush=True)
        print("Headers:", dict(request.headers), flush=True)
        print("Body:", req.model_dump(), flush=True)
        print("[REQ END] ------------------------\n", flush=True)

    user_id = (req.userId or "").strip().lower()
    if not user_id:
        raise HTTPException(status_code=400, detail="userId is required")

    m = db.query(Memory).filter(Memory.user_id == user_id, Memory.id == req.id).first()
    if not m:
        raise HTTPException(status_code=404, detail="memory not found")

    db.delete(m)
    db.commit()
    return {"ok": True}


@router.post("/mem0/clear")
def mem0_clear(req: MemClearReq, request: Request, db: Session = Depends(get_db), _=Depends(auth)):
    if DEBUG_LOG:
        print("\n[REQ] /mem0/clear -----------------", flush=True)
        print("Headers:", dict(request.headers), flush=True)
        print("Body:", req.model_dump(), flush=True)
        print("[REQ END] ------------------------\n", flush=True)

    user_id = (req.userId or "").strip().lower()
    if not user_id:
        raise HTTPException(status_code=400, detail="userId is required")

    db.query(Memory).filter(Memory.user_id == user_id).delete()
    db.commit()
    return {"ok": True, "cleared": True}


@router.post("/mem0/auto")
def mem0_auto(
    req: MemAutoReq,
    request: Request,
    db: Session = Depends(get_db),
    _=Depends(auth),
    x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
):
    if DEBUG_LOG:
        print("\n[REQ] /mem0/auto -----------------", flush=True)
        print("Headers:", dict(request.headers), flush=True)
        print("Body:", req.model_dump(), flush=True)
        print("[REQ END] ------------------------\n", flush=True)

    utter = (req.utterance or "").strip()

    # unify userId & lower
    inferred = _infer_user_id_from_utterance(utter) if utter else None
    user_id = (req.userId or x_user_id or inferred or "guest").strip().lower()

    if not utter:
        return {
            "ok": True,
            "should_save": False,
            "saved": False,
            "reason": "empty utterance",
            "userId": user_id,
        }

    if req.suggest_text and req.suggest_text.strip():
        should = True
        summary = req.suggest_text.strip()
        tags = req.suggest_tags or []
    else:
        should, summary, tags = _classify_and_summarize(utter)

    try:
        dedupe_th = float(req.dedupe_threshold)
    except Exception:
        dedupe_th = 0.9
    dedupe_th = max(0.5, min(0.99, dedupe_th))

    if not should or not summary:
        if DEBUG_LOG:
            print(f"[AUTO] skip (not-worthy) user={user_id} text={utter[:80]!r}", flush=True)
        return {
            "ok": True,
            "should_save": False,
            "saved": False,
            "reason": "not memory-worthy",
            "userId": user_id,
            "summary": summary or "",
            "tags": tags or [],
        }

    result = _save_memory(
        db=db,
        user_id=user_id,
        text=summary,
        tags=tags,
        created_ts=None,
        dedupe_threshold=dedupe_th,
    )

    resp: Dict[str, Any] = {
        "ok": True,
        "should_save": True,
        "saved": bool(result.get("id")),
        "userId": user_id,
        "summary": summary,
        "tags": tags or [],
    }
    resp.update(result)

    if DEBUG_LOG:
        status = "SAVED" if resp.get("saved") else f"SKIP({resp.get('skipped')})"
        score = resp.get("score")
        extra = f" score={score}" if score is not None else ""
        print(
            f"[AUTO] {status} user={user_id} th={dedupe_th}{extra} "
            f"text={utter[:80]!r} -> summary={summary!r}",
            flush=True,
        )

    return resp
