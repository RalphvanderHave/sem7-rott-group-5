# /backend/utils.py
import os
from datetime import datetime
from typing import List, Optional

import numpy as np
from dotenv import load_dotenv
from fastapi import Header, HTTPException
from sentence_transformers import SentenceTransformer

# Load .env once here so all modules see env vars
load_dotenv()

DEBUG_LOG = os.getenv("DEBUG_LOG", "0") == "1"
MEM_MODEL_NAME = os.getenv("MEM_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
AUTH_TOKEN = os.getenv("AUTH_TOKEN", "")

_model: Optional[SentenceTransformer] = None


# -------------------- Auth --------------------
def auth(authorization: Optional[str] = Header(None)) -> None:
    """
    Simple bearer token auth.
    If AUTH_TOKEN is not set, auth is effectively disabled.
    """
    if not AUTH_TOKEN:
        return

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = authorization.split(" ", 1)[1]
    if token != AUTH_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid token")


# -------------------- Embeddings --------------------
def load_model() -> SentenceTransformer:
    """
    Lazy-load the embedding model (singleton).
    """
    global _model
    if _model is None:
        if DEBUG_LOG:
            print(f"[INFO] Loading embedding model: {MEM_MODEL_NAME}")
        _model = SentenceTransformer(MEM_MODEL_NAME)
    return _model


def embed(texts: List[str]) -> np.ndarray:
    """
    Encode text into normalized float32 vectors.
    """
    model = load_model()
    vecs = model.encode(texts, normalize_embeddings=True, convert_to_numpy=True)
    return vecs.astype(np.float32, copy=False)


# -------------------- Time helpers --------------------
def now_iso() -> str:
    """
    Current UTC time in ISO-8601 string.
    """
    return datetime.utcnow().isoformat()


def iso_datetime(dt: datetime) -> str:
    """
    Safe isoformat for a datetime.
    """
    try:
        return dt.isoformat()
    except Exception:
        return datetime.utcnow().isoformat()


def parse_ts(s: Optional[str]) -> datetime:
    """
    Parse ISO-8601 string (optionally with 'Z') to UTC datetime.
    Fallback: now().
    """
    if not s:
        return datetime.utcnow()
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt if dt.tzinfo else datetime.utcfromtimestamp(dt.timestamp())
    except Exception:
        return datetime.utcnow()
