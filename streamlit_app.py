"""
Primorix AI — Streamlit Version
Install deps: pip install streamlit groq bcrypt pypdf
Run: streamlit run streamlit_app.py
"""

import streamlit as st
import streamlit.components.v1 as components
import sqlite3
import os
import json
import re
import base64
import uuid
import io
from datetime import datetime
from groq import Groq

# bcrypt for password hashing
try:
    import bcrypt
    HAS_BCRYPT = True
except ImportError:
    HAS_BCRYPT = False

# pypdf for PDF parsing
try:
    from pypdf import PdfReader
    HAS_PDF = True
except ImportError:
    HAS_PDF = False

# ─────────────────────────────────────────────────────────
# Page config — MUST be first Streamlit call
# ─────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Primorix AI",
    page_icon="✨",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ─────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────
CHAT_API_KEY = os.getenv("GROQ_API_KEY", "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")
CODE_API_KEY = os.getenv("GROQ_CODE_API_KEY", "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")
CHAT_MODEL   = "llama-3.3-70b-versatile"
CODE_MODEL   = "qwen/qwen3-32b"
VISION_MODELS = [
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "llama-3.2-11b-vision-preview",
    "llama-3.2-90b-vision-preview",
]
DB_PATH = "primorix.db"

chat_client = Groq(api_key=CHAT_API_KEY)
code_client  = Groq(api_key=CODE_API_KEY)

# ─────────────────────────────────────────────────────────
# Database
# ─────────────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def init_db():
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT    UNIQUE NOT NULL,
                email         TEXT,
                password_hash TEXT,
                is_guest      INTEGER DEFAULT 0,
                memory_summary TEXT   DEFAULT '',
                created_at    TEXT    DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS conversations (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL,
                title      TEXT    DEFAULT 'New Conversation',
                model      TEXT    DEFAULT 'primorix-1.0',
                created_at TEXT    DEFAULT (datetime('now')),
                updated_at TEXT    DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS messages (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL,
                role            TEXT    NOT NULL,
                content         TEXT    NOT NULL,
                created_at      TEXT    DEFAULT (datetime('now')),
                FOREIGN KEY (conversation_id) REFERENCES conversations(id)
            );
            CREATE TABLE IF NOT EXISTS user_memory (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id      INTEGER NOT NULL,
                memory_key   TEXT    NOT NULL,
                memory_value TEXT    NOT NULL,
                updated_at   TEXT    DEFAULT (datetime('now')),
                UNIQUE (user_id, memory_key),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
        """)

# ── User helpers ──────────────────────────────────────────
def register_user(username, email, password):
    if not HAS_BCRYPT:
        raise RuntimeError("bcrypt not installed — run: pip install bcrypt")
    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    try:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
                (username, email or None, hashed),
            )
            user = dict(conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone())
        return user
    except sqlite3.IntegrityError:
        raise ValueError("Username or email already taken")

def login_user(username, password):
    if not HAS_BCRYPT:
        raise RuntimeError("bcrypt not installed — run: pip install bcrypt")
    with get_db() as conn:
        row = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    if not row:
        raise ValueError("Invalid username or password")
    if not bcrypt.checkpw(password.encode(), row["password_hash"].encode()):
        raise ValueError("Invalid username or password")
    return dict(row)

def create_guest_user():
    sid = uuid.uuid4().hex[:8]
    with get_db() as conn:
        conn.execute("INSERT INTO users (username, is_guest) VALUES (?, 1)", (f"guest_{sid}",))
        row = conn.execute("SELECT * FROM users WHERE username=?", (f"guest_{sid}",)).fetchone()
    return dict(row)

# ── Conversation helpers ───────────────────────────────────
def get_user_conversations(user_id):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM conversations WHERE user_id=? ORDER BY updated_at DESC",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]

def create_conversation(user_id, title="New Conversation"):
    with get_db() as conn:
        conn.execute("INSERT INTO conversations (user_id, title) VALUES (?, ?)", (user_id, title))
        row = conn.execute(
            "SELECT * FROM conversations WHERE user_id=? ORDER BY id DESC LIMIT 1", (user_id,)
        ).fetchone()
    return dict(row)

def get_conversation_messages(conv_id, limit=50):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at ASC LIMIT ?",
            (conv_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]

def add_message(conv_id, role, content):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)",
            (conv_id, role, content),
        )
        conn.execute(
            "UPDATE conversations SET updated_at=datetime('now') WHERE id=?", (conv_id,)
        )

def update_conv_title(conv_id, title):
    with get_db() as conn:
        conn.execute("UPDATE conversations SET title=? WHERE id=?", (title, conv_id))

def delete_conversation_db(conv_id):
    with get_db() as conn:
        conn.execute("DELETE FROM messages WHERE conversation_id=?", (conv_id,))
        conn.execute("DELETE FROM conversations WHERE id=?", (conv_id,))

# ── Memory helpers ─────────────────────────────────────────
def get_user_memory(user_id):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM user_memory WHERE user_id=? ORDER BY updated_at DESC", (user_id,)
        ).fetchall()
    return [dict(r) for r in rows]

def set_user_memory(user_id, key, value):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO user_memory (user_id, memory_key, memory_value) VALUES (?,?,?) "
            "ON CONFLICT(user_id, memory_key) DO UPDATE SET memory_value=?, updated_at=datetime('now')",
            (user_id, key, value, value),
        )

def delete_user_memory(user_id, key):
    with get_db() as conn:
        conn.execute("DELETE FROM user_memory WHERE user_id=? AND memory_key=?", (user_id, key))

# ─────────────────────────────────────────────────────────
# AI helpers
# ─────────────────────────────────────────────────────────
def build_chat_prompt(user, memory_facts):
    is_guest = user.get("is_guest", False)
    mem_section = ""
    if not is_guest and memory_facts:
        lines = "\n".join(f"  - {f['memory_key']}: {f['memory_value']}" for f in memory_facts)
        mem_section = f"\nWHAT YOU KNOW ABOUT THIS USER:\n{lines}\n"
    return f"""You are Primorix AI, a highly capable and personable AI assistant with genuine long-term memory.

You are currently talking to {'a guest user (not logged in)' if is_guest else user['username'] + ' (a registered user)'}.{mem_section}
CORE BEHAVIOR:
- Be warm, helpful, and genuinely intelligent
- Reference things you know about the user naturally when relevant
- Be concise unless depth is requested
- Format code with triple backticks and the language name
- If asked to remember something, confirm you noted it

Your personality: Curious, helpful, slightly witty, never condescending."""

def build_code_prompt(user):
    name = "the user" if user.get("is_guest") else user["username"]
    return f"""You are Primorix AI in Code Mode — an expert software engineer helping {name}.

CODE GUIDELINES:
- Always use fenced code blocks with the correct language tag
- Write complete, working code — never truncate or use placeholders
- Add inline comments only where logic isn't obvious
- Prefer modern, idiomatic patterns for each language
- Point out edge cases or security issues

Keep explanations focused and technical."""

def build_canvas_prompt(user):
    name = "the user" if user.get("is_guest") else user["username"]
    return f"""You are Primorix AI in Canvas Mode — you generate complete, self-contained, runnable HTML applications for {name}.

RULES (follow strictly):
- Always output a SINGLE, complete HTML file with all CSS and JavaScript embedded inline
- One full ```html ... ``` block only — never split code
- CDN links (e.g. unpkg, cdnjs) are allowed
- Make it visually polished: good colors, spacing, typography
- Add interactivity and animations where it makes sense
- When asked for changes, output the FULL updated HTML file"""

def strip_think(text):
    return re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE).strip()

def extract_html(text):
    m = re.search(r"```(?:html|HTML|htm)\s*([\s\S]*?)```", text)
    if m: return m.group(1).strip()
    m = re.search(r"```\s*(<!DOCTYPE[\s\S]*?)```", text, re.IGNORECASE)
    if m: return m.group(1).strip()
    m = re.search(r"(<!DOCTYPE\s+html[\s\S]*?</html>)", text, re.IGNORECASE)
    if m: return m.group(1).strip()
    m = re.search(r"(<html[\s\S]*?</html>)", text, re.IGNORECASE)
    if m: return m.group(1).strip()
    return None

def call_ai(user, history, user_message, mode, memory_facts=None):
    if mode == "code":
        system = build_code_prompt(user)
        client, model, temp, max_tok = code_client, CODE_MODEL, 0.3, 4096
    elif mode == "canvas":
        system = build_canvas_prompt(user)
        client, model, temp, max_tok = chat_client, CHAT_MODEL, 0.9, 8192
    else:
        system = build_chat_prompt(user, memory_facts or [])
        client, model, temp, max_tok = chat_client, CHAT_MODEL, 0.9, 8192

    api_msgs = [{"role": "system", "content": system}]
    for m in history:
        api_msgs.append({"role": "assistant" if m["role"] == "model" else "user", "content": m["content"]})
    api_msgs.append({"role": "user", "content": user_message})

    resp = client.chat.completions.create(
        model=model, messages=api_msgs, temperature=temp, max_tokens=max_tok, top_p=0.95
    )
    content = resp.choices[0].message.content
    if mode in ("code", "canvas"):
        content = strip_think(content)
    return content

def call_vision(user, history, message, img_bytes, mime_type):
    system = build_chat_prompt(user, [])
    history_msgs = [{"role": "assistant" if m["role"] == "model" else "user", "content": m["content"]} for m in history]
    b64 = base64.b64encode(img_bytes).decode()
    user_content = [
        {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64}"}},
        {"type": "text", "text": message or "Describe this image in detail."},
    ]
    msgs = [{"role": "system", "content": system}] + history_msgs + [{"role": "user", "content": user_content}]
    for vmodel in VISION_MODELS:
        try:
            r = chat_client.chat.completions.create(model=vmodel, messages=msgs, max_tokens=2048, temperature=0.7)
            return r.choices[0].message.content
        except Exception:
            continue
    return "Sorry, I couldn't process this image. Please try describing it in text."

def generate_title(user_msg, ai_msg):
    try:
        r = chat_client.chat.completions.create(
            model=CHAT_MODEL,
            messages=[{"role": "user", "content": f"Generate a short title (max 6 words, no quotes):\nUser: {user_msg[:200]}\nAI: {ai_msg[:200]}\nTitle:"}],
            max_tokens=20, temperature=0.5,
        )
        return r.choices[0].message.content.strip()[:60] or "New Conversation"
    except Exception:
        return user_msg[:40] or "New Conversation"

def auto_extract_memory(user, conv_id):
    if user.get("is_guest"):
        return
    msgs = get_conversation_messages(conv_id, limit=8)
    if len(msgs) < 4 or len(msgs) % 4 != 0:
        return
    conversation = "\n".join(
        f"{'User' if m['role'] == 'user' else 'AI'}: {m['content']}" for m in msgs
    )
    try:
        r = chat_client.chat.completions.create(
            model=CHAT_MODEL,
            messages=[{"role": "user", "content": f"Extract important personal facts about the user from this conversation. Return ONLY a JSON array like [{{\"key\":\"name\",\"value\":\"Alex\"}}]. Return [] if nothing meaningful.\n\nConversation:\n{conversation[:3000]}"}],
            max_tokens=500, temperature=0.3,
        )
        text = r.choices[0].message.content.strip()
        m = re.search(r"\[[\s\S]*\]", text)
        if m:
            facts = json.loads(m.group(0))
            for f in facts:
                if f.get("key") and f.get("value"):
                    set_user_memory(user["id"], f["key"], f["value"])
    except Exception:
        pass

# ─────────────────────────────────────────────────────────
# Session state initialiser
# ─────────────────────────────────────────────────────────
def init_session():
    defaults = {
        "user": None,
        "current_conv_id": None,
        "mode": "chat",
        "canvas_html": None,
        "canvas_store": {},
    }
    for k, v in defaults.items():
        if k not in st.session_state:
            st.session_state[k] = v

# ─────────────────────────────────────────────────────────
# Custom CSS
# ─────────────────────────────────────────────────────────
CUSTOM_CSS = """
<style>
/* Global */
html, body, .stApp { background-color: #0f0f13; color: #e2e8f0; }

/* Sidebar */
[data-testid="stSidebar"] {
    background-color: #141420 !important;
    border-right: 1px solid #1e1e2e;
}
[data-testid="stSidebar"] .stButton > button {
    background: #1e1e3a;
    color: #e2e8f0;
    border: 1px solid #2d2d4e;
    border-radius: 8px;
    text-align: left;
    font-size: 13px;
}
[data-testid="stSidebar"] .stButton > button:hover {
    background: #7c3aed;
    border-color: #7c3aed;
}

/* Main chat area */
.stChatMessage {
    background: #1a1a2e;
    border-radius: 12px;
    border: 1px solid #1e1e2e;
    padding: 12px 16px;
    margin-bottom: 8px;
}
[data-testid="stChatInput"] > div {
    background: #1a1a2e !important;
    border: 1px solid #2d2d4e !important;
    border-radius: 12px !important;
}

/* Welcome screen */
.welcome-box {
    text-align: center;
    padding: 80px 20px 40px;
    color: #64748b;
}
.welcome-icon { font-size: 48px; margin-bottom: 16px; }
.welcome-title { font-size: 20px; font-weight: 600; color: #94a3b8; margin-bottom: 8px; }
.welcome-sub { font-size: 14px; }

/* Mode badges */
.badge {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 12px;
}
.badge-canvas { background: rgba(251,146,60,.2); color: #fb923c; }
.badge-code   { background: rgba(34,197,94,.2);  color: #22c55e; }
.badge-chat   { background: rgba(124,58,237,.2); color: #a78bfa; }

/* Canvas panel */
.canvas-panel {
    background: #1a1a2e;
    border: 1px solid #2d2d4e;
    border-radius: 12px;
    overflow: hidden;
}
.canvas-empty {
    height: 480px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #64748b;
    text-align: center;
}

/* Auth */
.auth-logo {
    text-align: center;
    padding: 32px 0 20px;
}
.auth-logo .name { font-size: 28px; font-weight: 700; color: #e2e8f0; }
.auth-logo .badge-ai {
    font-size: 13px; font-weight: 600; color: #7c3aed;
    background: rgba(124,58,237,.15); padding: 2px 8px;
    border-radius: 4px; margin-left: 6px;
}
.auth-tagline { color: #94a3b8; text-align: center; margin-bottom: 24px; }

/* Divider */
hr { border-color: #1e1e2e !important; }

/* Inputs */
.stTextInput input, .stTextArea textarea {
    background: #1a1a2e !important;
    color: #e2e8f0 !important;
    border: 1px solid #2d2d4e !important;
    border-radius: 8px !important;
}
.stTextInput input:focus, .stTextArea textarea:focus {
    border-color: #7c3aed !important;
    box-shadow: 0 0 0 2px rgba(124,58,237,.2) !important;
}

/* File uploader */
[data-testid="stFileUploader"] {
    background: #1a1a2e;
    border: 1px dashed #2d2d4e;
    border-radius: 8px;
}
</style>
"""

# ─────────────────────────────────────────────────────────
# Auth screen
# ─────────────────────────────────────────────────────────
def show_auth():
    st.markdown(CUSTOM_CSS, unsafe_allow_html=True)
    col = st.columns([1, 1.2, 1])[1]
    with col:
        st.markdown("""
        <div class="auth-logo">
            <span class="name">Primorix</span><span class="badge-ai">AI</span>
        </div>
        <p class="auth-tagline">Your AI with real memory</p>
        """, unsafe_allow_html=True)

        tab_login, tab_reg, tab_guest = st.tabs(["Sign In", "Create Account", "Guest"])

        with tab_login:
            with st.form("login_form", clear_on_submit=False):
                username = st.text_input("Username", placeholder="Enter username")
                password = st.text_input("Password", type="password", placeholder="Enter password")
                if st.form_submit_button("Sign In", use_container_width=True, type="primary"):
                    if username and password:
                        try:
                            user = login_user(username, password)
                            st.session_state.user = user
                            st.rerun()
                        except (ValueError, RuntimeError) as e:
                            st.error(str(e))
                    else:
                        st.error("Please fill in all fields")

        with tab_reg:
            with st.form("register_form", clear_on_submit=False):
                new_user = st.text_input("Username", placeholder="Choose a username", key="ru")
                new_email = st.text_input("Email (optional)", placeholder="your@email.com", key="re")
                new_pass = st.text_input("Password", type="password", placeholder="Min. 6 characters", key="rp")
                if st.form_submit_button("Create Account", use_container_width=True, type="primary"):
                    if len(new_user) < 3:
                        st.error("Username must be at least 3 characters")
                    elif len(new_pass) < 6:
                        st.error("Password must be at least 6 characters")
                    else:
                        try:
                            user = register_user(new_user, new_email or None, new_pass)
                            st.session_state.user = user
                            st.rerun()
                        except (ValueError, RuntimeError) as e:
                            st.error(str(e))

        with tab_guest:
            st.info("Try Primorix AI without an account. Conversations won't be saved after the session ends.")
            if st.button("Continue as Guest", use_container_width=True, type="primary"):
                user = create_guest_user()
                st.session_state.user = user
                st.rerun()

# ─────────────────────────────────────────────────────────
# Sidebar
# ─────────────────────────────────────────────────────────
def show_sidebar():
    user = st.session_state.user

    with st.sidebar:
        # Logo
        st.markdown("""
        <div style="display:flex;align-items:center;gap:10px;padding:4px 0 16px">
            <div style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#2563eb);
                        display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">✨</div>
            <span style="font-size:17px;font-weight:700;color:#e2e8f0">Primorix AI</span>
        </div>
        """, unsafe_allow_html=True)

        if st.button("＋ New Chat", use_container_width=True, key="new_chat"):
            st.session_state.current_conv_id = None
            st.session_state.canvas_html = None
            st.rerun()

        st.divider()

        # Mode selector
        st.caption("MODE")
        mode_opts = ["💬  Chat", "💻  Code", "🎨  Canvas"]
        mode_map  = {"💬  Chat": "chat", "💻  Code": "code", "🎨  Canvas": "canvas"}
        rev_map   = {v: k for k, v in mode_map.items()}
        selected = st.radio("mode", mode_opts, index=mode_opts.index(rev_map[st.session_state.mode]), label_visibility="collapsed")
        new_mode = mode_map[selected]
        if new_mode != st.session_state.mode:
            st.session_state.mode = new_mode
            st.rerun()

        st.divider()

        # Conversations
        st.caption("CONVERSATIONS")
        if not user.get("is_guest"):
            convs = get_user_conversations(user["id"])
            if not convs:
                st.caption("No conversations yet")
            for conv in convs:
                c1, c2 = st.columns([5, 1])
                with c1:
                    label = conv["title"][:32] + ("…" if len(conv["title"]) > 32 else "")
                    btn_type = "primary" if st.session_state.current_conv_id == conv["id"] else "secondary"
                    if st.button(label, key=f"c_{conv['id']}", use_container_width=True, type=btn_type):
                        st.session_state.current_conv_id = conv["id"]
                        st.session_state.canvas_html = st.session_state.canvas_store.get(conv["id"])
                        st.rerun()
                with c2:
                    if st.button("🗑", key=f"d_{conv['id']}"):
                        delete_conversation_db(conv["id"])
                        st.session_state.canvas_store.pop(conv["id"], None)
                        if st.session_state.current_conv_id == conv["id"]:
                            st.session_state.current_conv_id = None
                            st.session_state.canvas_html = None
                        st.rerun()
        else:
            st.caption("Sign in to save conversations")

        st.divider()

        # Memory
        if not user.get("is_guest"):
            with st.expander("🧠 Memory"):
                facts = get_user_memory(user["id"])
                if facts:
                    for f in facts:
                        fc1, fc2 = st.columns([5, 1])
                        with fc1:
                            st.markdown(f"**{f['memory_key']}**: {f['memory_value']}")
                        with fc2:
                            if st.button("×", key=f"m_{f['id']}"):
                                delete_user_memory(user["id"], f["memory_key"])
                                st.rerun()
                else:
                    st.caption("No memories yet")

                with st.form("add_mem", clear_on_submit=True):
                    mk = st.text_input("Label", placeholder="e.g. name, city", label_visibility="collapsed")
                    mv = st.text_input("Value", placeholder="Value", label_visibility="collapsed")
                    if st.form_submit_button("Add Memory", use_container_width=True):
                        if mk and mv:
                            clean_key = re.sub(r"\s+", "_", mk.strip().lower())[:50]
                            set_user_memory(user["id"], clean_key, mv.strip()[:500])
                            st.rerun()

        st.divider()

        # User / logout
        badge = "👤 Guest" if user.get("is_guest") else f"👋 {user['username']}"
        st.caption(badge)
        if st.button("Sign Out", use_container_width=True):
            for k in ("user", "current_conv_id", "canvas_html", "canvas_store", "mode"):
                st.session_state.pop(k, None)
            st.rerun()

# ─────────────────────────────────────────────────────────
# Canvas panel
# ─────────────────────────────────────────────────────────
def show_canvas():
    html = st.session_state.canvas_html

    st.markdown("**🎨 Canvas Preview**")

    if html:
        c1, c2, _, c3 = st.columns([2, 1, 3, 1])
        with c2:
            if st.button("🔄", help="Refresh canvas"):
                st.rerun()
        with c3:
            if st.button("🗑", help="Clear canvas"):
                st.session_state.canvas_html = None
                cid = st.session_state.current_conv_id
                if cid:
                    st.session_state.canvas_store.pop(cid, None)
                st.rerun()

        st.markdown('<div class="canvas-panel">', unsafe_allow_html=True)
        components.html(html, height=500, scrolling=True)
        st.markdown("</div>", unsafe_allow_html=True)

        # Open in new tab button
        b64 = base64.b64encode(html.encode()).decode()
        st.markdown(
            f'<a href="data:text/html;base64,{b64}" target="_blank" '
            f'style="font-size:12px;color:#7c3aed;text-decoration:none">↗ Open in new tab</a>',
            unsafe_allow_html=True,
        )
    else:
        st.markdown("""
        <div class="canvas-panel canvas-empty">
            <div style="font-size:36px;margin-bottom:12px">🎨</div>
            <div style="font-size:14px;font-weight:600;color:#94a3b8">Canvas is empty</div>
            <div style="font-size:12px;margin-top:6px;color:#64748b">Ask Primorix AI to build something</div>
        </div>
        """, unsafe_allow_html=True)

# ─────────────────────────────────────────────────────────
# Main chat view
# ─────────────────────────────────────────────────────────
def show_app():
    st.markdown(CUSTOM_CSS, unsafe_allow_html=True)
    show_sidebar()

    user = st.session_state.user
    mode = st.session_state.mode

    # Mode badge
    badge_cls = {"chat": "badge-chat", "code": "badge-code", "canvas": "badge-canvas"}[mode]
    badge_lbl = {"chat": "💬 Chat Mode", "code": "💻 Code Mode", "canvas": "🎨 Canvas Mode"}[mode]
    st.markdown(f'<span class="badge {badge_cls}">{badge_lbl}</span>', unsafe_allow_html=True)

    # Layout: canvas mode → 2 columns
    if mode == "canvas":
        chat_col, canvas_col = st.columns([1, 1], gap="medium")
    else:
        chat_col = st.container()
        canvas_col = None

    # ── Messages ──────────────────────────────────────────
    conv_id = st.session_state.current_conv_id
    with chat_col:
        if conv_id:
            limit = 6 if mode in ("code", "canvas") else 50
            messages = get_conversation_messages(conv_id, limit=limit)
        else:
            messages = []

        if not messages:
            st.markdown("""
            <div class="welcome-box">
                <div class="welcome-icon">✨</div>
                <div class="welcome-title">How can I help you today?</div>
                <div class="welcome-sub">Start a conversation below</div>
            </div>
            """, unsafe_allow_html=True)
        else:
            for msg in messages:
                role = "assistant" if msg["role"] == "model" else "user"
                with st.chat_message(role):
                    st.markdown(msg["content"])

    # ── Canvas panel ──────────────────────────────────────
    if canvas_col:
        with canvas_col:
            show_canvas()

    # ── File uploader (collapsed by default) ─────────────
    with st.expander("📎 Attach file", expanded=False):
        uploaded = st.file_uploader(
            "Upload a file",
            type=["jpg","jpeg","png","gif","webp","pdf","txt","md","py","js","ts",
                  "jsx","tsx","html","css","json","csv","yaml","yml","go","rs","rb","php"],
            label_visibility="collapsed",
        )

    # ── Chat input ────────────────────────────────────────
    placeholder = {"chat": "Message Primorix AI...", "code": "Ask a coding question...", "canvas": "Ask to build something..."}[mode]
    prompt = st.chat_input(placeholder)

    if prompt is not None:
        # Ensure conversation exists
        if not conv_id:
            conv = create_conversation(user["id"])
            st.session_state.current_conv_id = conv["id"]
            conv_id = conv["id"]

        # Build display message
        display_msg = prompt
        if uploaded:
            tag = "🖼️" if uploaded.type.startswith("image/") else "📄"
            display_msg = f"{prompt}\n\n{tag} {uploaded.name}" if prompt else f"{tag} {uploaded.name}"

        # Get history
        hist_limit = 6 if mode in ("code", "canvas") else 25
        history = get_conversation_messages(conv_id, limit=hist_limit)

        # Save user message
        add_message(conv_id, "user", display_msg)

        # Show spinner while calling API
        with st.spinner("Thinking..."):
            try:
                if uploaded and uploaded.type.startswith("image/"):
                    ai_response = call_vision(user, history, prompt or "Describe this image.", uploaded.getvalue(), uploaded.type)
                else:
                    api_message = prompt or ""
                    if uploaded:
                        if uploaded.type == "application/pdf" and HAS_PDF:
                            reader = PdfReader(io.BytesIO(uploaded.getvalue()))
                            pdf_text = "\n".join(p.extract_text() or "" for p in reader.pages)[:12000]
                            api_message += f"\n\n[Attached PDF: {uploaded.name}]\n\n{pdf_text}"
                        else:
                            file_text = uploaded.getvalue().decode("utf-8", errors="replace")[:12000]
                            api_message += f"\n\n[Attached file: {uploaded.name}]\n```\n{file_text}\n```"

                    memory_facts = get_user_memory(user["id"]) if not user.get("is_guest") else []
                    ai_response = call_ai(user, history, api_message, mode, memory_facts)
            except Exception as e:
                ai_response = f"⚠️ Error: {str(e)}"

        # Save AI response
        add_message(conv_id, "model", ai_response)

        # Auto-generate title for new conversations
        if not history:
            try:
                title = generate_title(display_msg, ai_response)
                update_conv_title(conv_id, title)
            except Exception:
                pass

        # Auto-extract memory
        auto_extract_memory(user, conv_id)

        # Canvas: extract and store HTML
        if mode == "canvas":
            html = extract_html(ai_response)
            if html:
                st.session_state.canvas_html = html
                st.session_state.canvas_store[conv_id] = html

        st.rerun()

# ─────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────
init_db()
init_session()

if not st.session_state.user:
    show_auth()
else:
    show_app()
