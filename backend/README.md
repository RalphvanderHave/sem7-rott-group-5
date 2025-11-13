# 🧠 Alfred Voice Companion (with Mem0 Memory System)

Alfred is a **warm, empathetic AI voice companion** designed for older adults.  
It remembers conversations, habits, and preferences over time — enabling natural, human-like interactions with long-term memory.  

This project combines:
- 🗣️ **ElevenLabs Voice Agent** for natural speech interaction  
- ⚡ **FastAPI Backend (Mem0)** for long-term memory storage and retrieval  
- 🔗 **Tailscale Funnel** for secure remote webhook access  
- 🧩 **Memory Intelligence Layer** (`auto_mem0`, `search_mem0`, etc.) for self-updating AI context

---

## 🚀 Features

### 🤖 Intelligent Memory System
- Automatically detects important information in each user utterance.  
- Saves meaningful facts (e.g., “I go snowboarding every week with my wife Siyi”) to the local database.  
- Avoids duplicates with **semantic similarity filtering** (SentenceTransformer embeddings).  
- Supports memory search, manual add/delete, and full clearing.

### 💬 Personalized Conversations
- At session start, Alfred asks the user’s name (or infers it from speech).  
- Retrieves personal facts and preferences via `search_mem0`.  
- Uses these to greet and respond in a natural, familiar way.  
- New memories are added automatically using `auto_mem0`.

### 🔐 Local-first & Secure
- All data stored locally in **SQLite (`alfred.db`)**.  
- Webhook access protected via **Bearer Token Authentication**.  
- External access (for ElevenLabs or UI) secured via **Tailscale Funnel HTTPS tunnel**.

---

## 🧩 System Architecture

```
User ↔ ElevenLabs Voice Agent ↔ Alfred Webhook (FastAPI)
                                 ↓
                       ┌───────────────────┐
                       │  Memory Database  │
                       │  (SQLite + Embeds)│
                       └───────────────────┘
```

**Memory Endpoints**
| Endpoint | Method | Description |
|-----------|--------|-------------|
| `/mem0/auto` | POST | Auto-detect and save memory after each user utterance |
| `/mem0/add` | POST | Manually add a short fact |
| `/mem0/search` | POST | Semantic search user memories |
| `/mem0/delete` | POST | Delete a memory by ID |
| `/mem0/clear` | POST | Clear all user memories |
| `/health` | GET | Health check and environment info |

---

## 🧱 Project Structure

```
├── app.py                # Main FastAPI backend
├── db.py                 # Database initialization (SQLAlchemy)
├── models.py             # ORM models: Message, Memory
├── .env                  # Environment variables
├── .tailscale            # Optional: Tailscale auth key
├── requirements.txt       # Dependencies
└── README.md
```

---

## ⚙️ Environment Setup

### 1️⃣ Clone and Install
```bash
git clone https://github.com/<your_repo>/alfred-mem0.git
cd alfred-mem0
pip install -r requirements.txt
```

### 2️⃣ Configure `.env`
```bash
PORT=3000
AUTH_TOKEN=your_api_token
DATABASE_URL=sqlite:///./alfred.db
MEM_MODEL=sentence-transformers/all-MiniLM-L6-v2
DEBUG_LOG=1
ENABLE_TAILSCALE_FUNNEL=1
TAILSCALE_FUNNEL_PORT=3000
```

### 3️⃣ (Optional) Add `.tailscale`
```bash
TAILSCALE=tskey-xxxxxxx
```

### 4️⃣ Run Backend
```bash
python app.py
```

You should see:
```
[INFO] Alfred backend ready.
[INFO] Funnel available: https://lt-xxxxxx.ts.net
```

---

## 🌐 Webhook Configuration (for ElevenLabs / External Agent)

| Tool Name | Endpoint | Method | Required Fields |
|------------|-----------|--------|----------------|
| `auto_mem0` | `/mem0/auto` | POST | utterance, (optional) userId |
| `search_mem0` | `/mem0/search` | POST | userId, query |
| `add_mem0` | `/mem0/add` | POST | userId, text, tags |
| `mem0_delete` | `/mem0/delete` | POST | userId, id |
| `mem0_clear` | `/mem0/clear` | POST | userId |

Base URL:  
```
https://lt-001434231557.tailb2509f.ts.net
```

Each tool uses a header:
```
Authorization: Bearer <AUTH_TOKEN>
```

---

## 🧠 Memory Behavior

### Startup Flow
1. If no userId → Alfred asks “What’s your name?”  
2. Once known → Calls `search_mem0` to recall memories  
3. Greets user personally based on past data

### Conversation Flow
- After each utterance → silently call `auto_mem0`
- Backend decides whether to store new memory
- If saved → Alfred says “I’ll remember that.”

---

## 🧩 Example Interaction

**User:**  
> My name is Sky.  
> I love snowboarding.  
> I go with my wife Siyi every weekend.  

**Alfred:**  
> Hello, Sky! It’s nice to meet you.  
> That sounds wonderful. I’ll remember that you and Siyi love snowboarding together every weekend.

(Next session…)

**Alfred:**  
> Hi Sky, good to see you again.  
> Are you planning another trip to Sölden with Siyi this weekend?

---

## 🧰 API Reference

### `/mem0/auto`
Decides whether to save a new memory.  
Automatically deduplicates by cosine similarity.

**Body Example:**
```json
{
  "utterance": "I enjoy playing piano every night.",
  "userId": "Sky",
  "dedupe_threshold": 0.9
}
```

**Response:**
```json
{
  "ok": true,
  "should_save": true,
  "saved": true,
  "summary": "I enjoy playing piano every night.",
  "tags": ["habit","music"],
  "id": "c8e9aef0-34f9-4b27-bd88-ef2e58e1e123"
}
```

---

## 🧪 Testing Locally
You can test all endpoints using **cURL** or **VSCode REST Client**.

```bash
curl -X POST https://lt-xxxxxx.ts.net/mem0/auto   -H "Authorization: Bearer <AUTH_TOKEN>"   -H "Content-Type: application/json"   -d '{"utterance":"I love coffee","userId":"Sky"}'
```

---


