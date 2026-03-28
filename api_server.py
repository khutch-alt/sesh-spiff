#!/usr/bin/env python3
"""Sesh SPIFF App — Backend API (FastAPI + SQLite, Postgres-ready)"""

import csv
import io
import os
import sqlite3
import uuid
import hashlib
import hmac
import json
import time
import base64
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timezone, date

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List

# ── Config ──────────────────────────────────────────────────────────
JWT_SECRET = os.environ.get("JWT_SECRET", "sesh-spiff-secret-change-in-prod")
DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "spiff.db"))
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ── Database ────────────────────────────────────────────────────────
def get_db():
    db = sqlite3.connect(DB_PATH, check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA foreign_keys=ON")
    return db

def init_db(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS distributors (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            invite_code TEXT UNIQUE,
            initial_fund_amount REAL NOT NULL,
            current_fund_balance REAL NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('rep', 'admin')),
            distributor_id TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (distributor_id) REFERENCES distributors(id)
        );

        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            token TEXT NOT NULL UNIQUE,
            expires_at INTEGER NOT NULL,
            used INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS claim_types (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            label TEXT NOT NULL,
            description TEXT,
            base_payout REAL NOT NULL DEFAULT 0,
            min_rolls INTEGER DEFAULT 0,
            max_payout REAL,
            is_active INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            icon TEXT DEFAULT '📋',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS distributor_payout_overrides (
            id TEXT PRIMARY KEY,
            distributor_id TEXT NOT NULL,
            claim_type_id TEXT NOT NULL,
            payout_amount REAL NOT NULL,
            min_rolls INTEGER,
            max_payout REAL,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (distributor_id) REFERENCES distributors(id),
            FOREIGN KEY (claim_type_id) REFERENCES claim_types(id),
            UNIQUE(distributor_id, claim_type_id)
        );

        CREATE TABLE IF NOT EXISTS bonus_programs (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            claim_type_id TEXT,
            distributor_id TEXT,
            bonus_type TEXT NOT NULL CHECK(bonus_type IN ('FLAT_BONUS', 'MULTIPLIER', 'OVERRIDE')),
            bonus_value REAL NOT NULL,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (claim_type_id) REFERENCES claim_types(id),
            FOREIGN KEY (distributor_id) REFERENCES distributors(id)
        );

        CREATE TABLE IF NOT EXISTS claims (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            distributor_id TEXT NOT NULL,
            claim_type_id TEXT NOT NULL,
            store_name TEXT NOT NULL,
            store_city TEXT,
            store_state TEXT,
            order_date TEXT NOT NULL,
            rolls_count INTEGER NOT NULL DEFAULT 0,
            invoice_number TEXT,
            invoice_image_url TEXT,
            status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
            payout_amount REAL NOT NULL,
            bonus_applied TEXT,
            rejection_reason TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (distributor_id) REFERENCES distributors(id),
            FOREIGN KEY (claim_type_id) REFERENCES claim_types(id)
        );

        CREATE INDEX IF NOT EXISTS idx_claims_distributor ON claims(distributor_id);
        CREATE INDEX IF NOT EXISTS idx_claims_user ON claims(user_id);
        CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
    """)
    # Migrate: add invite_code column if upgrading from old DB
    try:
        db.execute("ALTER TABLE distributors ADD COLUMN invite_code TEXT UNIQUE")
        db.commit()
    except Exception:
        pass
    db.commit()

def seed_data(db):
    existing = db.execute("SELECT COUNT(*) FROM distributors").fetchone()[0]
    if existing > 0:
        # Ensure invite codes exist on old installs
        _ensure_invite_codes(db)
        return

    harbor_id = str(uuid.uuid4())
    snowball_id = str(uuid.uuid4())
    coremark_id = str(uuid.uuid4())
    kdn_id = str(uuid.uuid4())
    solimar_id = str(uuid.uuid4())

    db.execute("INSERT INTO distributors (id, name, invite_code, initial_fund_amount, current_fund_balance) VALUES (?, ?, ?, ?, ?)",
               (harbor_id, "Harbor Wholesale", "HARBOR2026", 15000, 15000))
    db.execute("INSERT INTO distributors (id, name, invite_code, initial_fund_amount, current_fund_balance) VALUES (?, ?, ?, ?, ?)",
               (snowball_id, "Snowball Distribution", "SNOWBALL2026", 7500, 7500))
    db.execute("INSERT INTO distributors (id, name, invite_code, initial_fund_amount, current_fund_balance) VALUES (?, ?, ?, ?, ?)",
               (coremark_id, "CoreMark", "COREMARK2026", 20000, 20000))
    db.execute("INSERT INTO distributors (id, name, invite_code, initial_fund_amount, current_fund_balance) VALUES (?, ?, ?, ?, ?)",
               (kdn_id, "KDN Distribution LLC", "KDN2026", 5000, 5000))
    db.execute("INSERT INTO distributors (id, name, invite_code, initial_fund_amount, current_fund_balance) VALUES (?, ?, ?, ?, ?)",
               (solimar_id, "Solimar Distributing", "SOLIMAR2026", 5000, 5000))

    new_door_id = str(uuid.uuid4())
    reorder_id = str(uuid.uuid4())
    chain_id = str(uuid.uuid4())

    db.execute("""INSERT INTO claim_types (id, name, label, description, base_payout, min_rolls, max_payout, is_active, sort_order, icon)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
               (new_door_id, "NEW_DOOR", "New Door", "First time a store orders Sesh", 20, 0, None, 1, 1, "🏪"))
    db.execute("""INSERT INTO claim_types (id, name, label, description, base_payout, min_rolls, max_payout, is_active, sort_order, icon)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
               (reorder_id, "REORDER", "Reorder", "Follow-up order meeting roll minimum", 10, 4, None, 1, 2, "🔄"))
    db.execute("""INSERT INTO claim_types (id, name, label, description, base_payout, min_rolls, max_payout, is_active, sort_order, icon)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
               (chain_id, "CHAIN_AUTHORIZATION", "Chain Authorization", "New chain account authorization", 500, 0, 500, 0, 3, "🏢"))

    admin_id = str(uuid.uuid4())
    db.execute("INSERT INTO users (id, email, password_hash, name, role, distributor_id) VALUES (?, ?, ?, ?, ?, ?)",
               (admin_id, "admin@sesh.com", hash_password("sesh2026"), "Karson Hutchinson", "admin", None))

    rep1_id = str(uuid.uuid4())
    db.execute("INSERT INTO users (id, email, password_hash, name, role, distributor_id) VALUES (?, ?, ?, ?, ?, ?)",
               (rep1_id, "rep@harbor.com", hash_password("harbor2026"), "Harbor Rep", "rep", harbor_id))

    rep2_id = str(uuid.uuid4())
    db.execute("INSERT INTO users (id, email, password_hash, name, role, distributor_id) VALUES (?, ?, ?, ?, ?, ?)",
               (rep2_id, "rep@snowball.com", hash_password("snowball2026"), "Snowball Rep", "rep", snowball_id))

    db.commit()

def _ensure_invite_codes(db):
    """Add invite codes to distributors that are missing them."""
    rows = db.execute("SELECT id, name, invite_code FROM distributors").fetchall()
    known = {
        "Harbor Wholesale": "HARBOR2026",
        "Snowball Distribution": "SNOWBALL2026",
        "CoreMark": "COREMARK2026",
        "KDN Distribution LLC": "KDN2026",
        "Solimar Distributing": "SOLIMAR2026",
    }
    for row in rows:
        if not row["invite_code"]:
            code = known.get(row["name"]) or row["name"].upper().replace(" ", "")[:10] + "2026"
            try:
                db.execute("UPDATE distributors SET invite_code = ? WHERE id = ?", (code, row["id"]))
            except Exception:
                pass
    db.commit()

# ── Auth helpers ────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def create_token(user_id: str, role: str) -> str:
    payload = {"user_id": user_id, "role": role, "exp": int(time.time()) + 86400 * 7}
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
    sig = hmac.new(JWT_SECRET.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"

def verify_token(token: str) -> dict:
    try:
        payload_b64, sig = token.rsplit(".", 1)
        expected = hmac.new(JWT_SECRET.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            raise HTTPException(status_code=401, detail="Invalid token")
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        if payload.get("exp", 0) < time.time():
            raise HTTPException(status_code=401, detail="Token expired")
        return payload
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

async def get_current_user(request: Request):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing auth token")
    token_data = verify_token(auth[7:])
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id = ?", (token_data["user_id"],)).fetchone()
    db.close()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return dict(user)

def require_admin(user):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

# ── Payout calculation ──────────────────────────────────────────────
def calculate_payout(db, claim_type_id: str, distributor_id: str, order_date: str, rolls_count: int = 0) -> dict:
    ct = db.execute("SELECT * FROM claim_types WHERE id = ?", (claim_type_id,)).fetchone()
    if not ct:
        return {"payout": 0, "bonus_info": None, "error": "Invalid claim type"}

    payout = ct["base_payout"]
    min_rolls = ct["min_rolls"]
    max_payout = ct["max_payout"]
    # Per-roll multiplication for REORDER type
    if ct["name"] == "REORDER" and rolls_count > 0:
        payout = ct["base_payout"] * rolls_count

    override = db.execute(
        "SELECT * FROM distributor_payout_overrides WHERE distributor_id = ? AND claim_type_id = ? AND is_active = 1",
        (distributor_id, claim_type_id)
    ).fetchone()
    if override:
        payout = override["payout_amount"]
        if override["min_rolls"] is not None:
            min_rolls = override["min_rolls"]
        if override["max_payout"] is not None:
            max_payout = override["max_payout"]

    bonus_info = None
    bonuses = db.execute(
        """SELECT * FROM bonus_programs
           WHERE is_active = 1
           AND (claim_type_id = ? OR claim_type_id IS NULL)
           AND (distributor_id = ? OR distributor_id IS NULL)
           AND start_date <= ? AND end_date >= ?
           ORDER BY created_at DESC""",
        (claim_type_id, distributor_id, order_date, order_date)
    ).fetchall()

    for b in bonuses:
        if b["bonus_type"] == "FLAT_BONUS":
            payout += b["bonus_value"]
            bonus_info = f"+${b['bonus_value']:.0f} ({b['name']})"
        elif b["bonus_type"] == "MULTIPLIER":
            payout = payout * b["bonus_value"]
            bonus_info = f"{b['bonus_value']}x ({b['name']})"
        elif b["bonus_type"] == "OVERRIDE":
            payout = b["bonus_value"]
            bonus_info = f"${b['bonus_value']:.0f} ({b['name']})"
        break

    if max_payout is not None and payout > max_payout:
        payout = max_payout

    return {"payout": payout, "min_rolls": min_rolls, "max_payout": max_payout, "bonus_info": bonus_info}

# ── App ─────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app):
    db = get_db()
    init_db(db)
    seed_data(db)
    _ensure_pop_requests_table(db)
    _ensure_door_lists_table(db)
    _ensure_notes_tables(db)
    db.close()
    yield

app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Models ──────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: str
    password: str

class SignupRequest(BaseModel):
    name: str
    email: str
    password: str
    invite_code: str

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

class ClaimReviewRequest(BaseModel):
    status: str
    rejection_reason: Optional[str] = None

class ClaimTypeCreate(BaseModel):
    name: str
    label: str
    description: Optional[str] = ""
    base_payout: float
    min_rolls: int = 0
    max_payout: Optional[float] = None
    is_active: bool = True
    icon: str = "📋"

class ClaimTypeUpdate(BaseModel):
    label: Optional[str] = None
    description: Optional[str] = None
    base_payout: Optional[float] = None
    min_rolls: Optional[int] = None
    max_payout: Optional[float] = None
    is_active: Optional[bool] = None
    icon: Optional[str] = None

class DistributorOverrideCreate(BaseModel):
    distributor_id: str
    claim_type_id: str
    payout_amount: float
    min_rolls: Optional[int] = None
    max_payout: Optional[float] = None

class BonusProgramCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    claim_type_id: Optional[str] = None
    distributor_id: Optional[str] = None
    bonus_type: str
    bonus_value: float
    start_date: str
    end_date: str

class DistributorFundUpdate(BaseModel):
    initial_fund_amount: Optional[float] = None
    add_funds: Optional[float] = None
    set_balance: Optional[float] = None
    invite_code: Optional[str] = None

class UserCreate(BaseModel):
    email: str
    password: str
    name: str
    role: str = "rep"
    distributor_id: Optional[str] = None

# ── Auth endpoints ──────────────────────────────────────────────────
@app.post("/api/auth/login")
def login(req: LoginRequest):
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email = ?", (req.email,)).fetchone()
    db.close()
    if not user or user["password_hash"] != hash_password(req.password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(user["id"], user["role"])
    return {
        "token": token,
        "user": {
            "id": user["id"], "email": user["email"], "name": user["name"],
            "role": user["role"], "distributor_id": user["distributor_id"],
        }
    }

@app.post("/api/auth/signup")
def signup(req: SignupRequest):
    db = get_db()
    # Validate invite code
    code = req.invite_code.strip().upper()
    distributor = db.execute(
        "SELECT * FROM distributors WHERE UPPER(invite_code) = ?", (code,)
    ).fetchone()
    if not distributor:
        db.close()
        raise HTTPException(status_code=400, detail="Invalid invite code. Ask your Sesh rep for the correct code.")

    # Check email not already taken
    existing = db.execute("SELECT id FROM users WHERE email = ?", (req.email.strip().lower(),)).fetchone()
    if existing:
        db.close()
        raise HTTPException(status_code=400, detail="An account with this email already exists.")

    if len(req.password) < 6:
        db.close()
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")

    uid = str(uuid.uuid4())
    db.execute(
        "INSERT INTO users (id, email, password_hash, name, role, distributor_id) VALUES (?, ?, ?, ?, ?, ?)",
        (uid, req.email.strip().lower(), hash_password(req.password), req.name.strip(), "rep", distributor["id"])
    )
    db.commit()
    token = create_token(uid, "rep")
    db.close()
    return {
        "token": token,
        "user": {
            "id": uid, "email": req.email.strip().lower(), "name": req.name.strip(),
            "role": "rep", "distributor_id": distributor["id"],
        }
    }

@app.post("/api/auth/forgot-password")
def forgot_password(req: ForgotPasswordRequest):
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email = ?", (req.email.strip().lower(),)).fetchone()
    if not user:
        db.close()
        # Don't reveal whether email exists
        return {"message": "If that email is registered, a reset token has been generated.", "token": None}

    # Invalidate old tokens
    db.execute("UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0", (user["id"],))

    token = secrets.token_urlsafe(32)
    expires = int(time.time()) + 3600  # 1 hour
    token_id = str(uuid.uuid4())
    db.execute(
        "INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)",
        (token_id, user["id"], token, expires)
    )
    db.commit()
    db.close()
    # In production you'd email this. For now return it directly so admin can relay.
    return {
        "message": "Reset token generated. Share this with the rep — it expires in 1 hour.",
        "token": token,
        "rep_name": user["name"],
        "rep_email": user["email"],
    }

@app.post("/api/auth/reset-password")
def reset_password(req: ResetPasswordRequest):
    db = get_db()
    record = db.execute(
        "SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0",
        (req.token,)
    ).fetchone()
    if not record:
        db.close()
        raise HTTPException(status_code=400, detail="Invalid or already-used reset token.")
    if record["expires_at"] < int(time.time()):
        db.close()
        raise HTTPException(status_code=400, detail="Reset token has expired. Request a new one.")
    if len(req.new_password) < 6:
        db.close()
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")

    db.execute("UPDATE users SET password_hash = ? WHERE id = ?",
               (hash_password(req.new_password), record["user_id"]))
    db.execute("UPDATE password_reset_tokens SET used = 1 WHERE id = ?", (record["id"],))
    db.commit()
    db.close()
    return {"message": "Password updated successfully. You can now log in."}

@app.get("/api/auth/me")
def get_me(user=Depends(get_current_user)):
    return {
        "id": user["id"], "email": user["email"], "name": user["name"],
        "role": user["role"], "distributor_id": user["distributor_id"],
    }

# ── Leaderboard ─────────────────────────────────────────────────────
@app.get("/api/leaderboard")
def get_leaderboard(user=Depends(get_current_user)):
    db = get_db()
    # Overall top 20 reps by approved new doors this month
    rows = db.execute("""
        SELECT
            u.id,
            u.name,
            d.name as distributor_name,
            COUNT(CASE WHEN ct.name = 'NEW_DOOR' AND c.status = 'APPROVED' THEN 1 END) as new_doors,
            COUNT(CASE WHEN c.status = 'APPROVED' THEN 1 END) as total_approved,
            SUM(CASE WHEN c.status = 'APPROVED' THEN c.payout_amount ELSE 0 END) as total_earned,
            COUNT(CASE WHEN ct.name = 'NEW_DOOR' AND c.status = 'APPROVED'
                  AND strftime('%Y-%m', c.order_date) = strftime('%Y-%m', 'now') THEN 1 END) as doors_this_month
        FROM users u
        LEFT JOIN claims c ON u.id = c.user_id
        LEFT JOIN claim_types ct ON c.claim_type_id = ct.id
        LEFT JOIN distributors d ON u.distributor_id = d.id
        WHERE u.role = 'rep'
        GROUP BY u.id, u.name, d.name
        ORDER BY doors_this_month DESC, new_doors DESC, total_earned DESC
        LIMIT 25
    """).fetchall()

    # Streak: count consecutive weeks with at least 1 approved claim
    result = []
    for i, r in enumerate(rows):
        streak = _calculate_streak(db, r["id"])
        result.append({
            **dict(r),
            "rank": i + 1,
            "streak_weeks": streak,
            "is_current_user": r["id"] == user["id"],
        })

    db.close()
    return result

def _calculate_streak(db, user_id: str) -> int:
    """Count consecutive weeks (Mon-Sun) with at least 1 approved claim, going back from current week."""
    weeks = db.execute("""
        SELECT DISTINCT strftime('%Y-%W', order_date) as week
        FROM claims
        WHERE user_id = ? AND status = 'APPROVED'
        ORDER BY week DESC
        LIMIT 52
    """, (user_id,)).fetchall()

    if not weeks:
        return 0

    from datetime import datetime, timedelta
    now = datetime.utcnow()
    current_week = now.strftime("%Y-%W")
    streak = 0
    check_week = current_week

    week_set = {w["week"] for w in weeks}
    for _ in range(52):
        if check_week in week_set:
            streak += 1
            # Go back one week
            dt = datetime.strptime(check_week + "-1", "%Y-%W-%w")
            dt -= timedelta(weeks=1)
            check_week = dt.strftime("%Y-%W")
        else:
            break

    return streak

# ── Rep stats with streak ───────────────────────────────────────────
@app.get("/api/stats/me")
def my_stats(user=Depends(get_current_user)):
    if user["role"] != "rep":
        raise HTTPException(status_code=403, detail="Rep only")
    db = get_db()
    dist = db.execute("SELECT * FROM distributors WHERE id = ?", (user["distributor_id"],)).fetchone()
    stats = db.execute("""
        SELECT
            COUNT(*) as total_claims,
            SUM(CASE WHEN status='APPROVED' THEN 1 ELSE 0 END) as approved_claims,
            SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END) as pending_claims,
            SUM(CASE WHEN status='REJECTED' THEN 1 ELSE 0 END) as rejected_claims,
            SUM(CASE WHEN status='APPROVED' THEN payout_amount ELSE 0 END) as total_earned
        FROM claims WHERE user_id = ?
    """, (user["id"],)).fetchone()

    # This month
    month_stats = db.execute("""
        SELECT
            COUNT(CASE WHEN ct.name='NEW_DOOR' AND c.status='APPROVED' THEN 1 END) as doors_this_month,
            SUM(CASE WHEN c.status='APPROVED' THEN c.payout_amount ELSE 0 END) as earned_this_month
        FROM claims c
        JOIN claim_types ct ON c.claim_type_id = ct.id
        WHERE c.user_id = ? AND strftime('%Y-%m', c.order_date) = strftime('%Y-%m', 'now')
    """, (user["id"],)).fetchone()

    # This week activity
    week_claims = db.execute("""
        SELECT COUNT(*) as count FROM claims
        WHERE user_id = ? AND status != 'REJECTED'
        AND order_date >= date('now', 'weekday 0', '-7 days')
    """, (user["id"],)).fetchone()

    # Rank among all reps (by doors this month)
    rank_row = db.execute("""
        SELECT COUNT(*) + 1 as rank FROM (
            SELECT u.id,
                COUNT(CASE WHEN ct.name='NEW_DOOR' AND c.status='APPROVED'
                      AND strftime('%Y-%m', c.order_date) = strftime('%Y-%m', 'now') THEN 1 END) as doors
            FROM users u
            LEFT JOIN claims c ON u.id = c.user_id
            LEFT JOIN claim_types ct ON c.claim_type_id = ct.id
            WHERE u.role = 'rep'
            GROUP BY u.id
        ) sub
        WHERE sub.doors > (
            SELECT COUNT(*) FROM claims c2
            JOIN claim_types ct2 ON c2.claim_type_id = ct2.id
            WHERE c2.user_id = ? AND ct2.name='NEW_DOOR' AND c2.status='APPROVED'
            AND strftime('%Y-%m', c2.order_date) = strftime('%Y-%m', 'now')
        )
    """, (user["id"],)).fetchone()

    type_counts = db.execute("""
        SELECT ct.label, COUNT(*) as count
        FROM claims c JOIN claim_types ct ON c.claim_type_id = ct.id
        WHERE c.user_id = ? AND c.status != 'REJECTED'
        GROUP BY ct.label
    """, (user["id"],)).fetchall()

    streak = _calculate_streak(db, user["id"])
    db.close()

    return {
        "distributor": dict(dist) if dist else None,
        "total_claims": stats["total_claims"] or 0,
        "approved_claims": stats["approved_claims"] or 0,
        "pending_claims": stats["pending_claims"] or 0,
        "rejected_claims": stats["rejected_claims"] or 0,
        "total_earned": stats["total_earned"] or 0,
        "doors_this_month": month_stats["doors_this_month"] or 0,
        "earned_this_month": month_stats["earned_this_month"] or 0,
        "claims_this_week": week_claims["count"] or 0,
        "streak_weeks": streak,
        "rank": rank_row["rank"] if rank_row else 1,
        "type_counts": {r["label"]: r["count"] for r in type_counts},
    }

@app.get("/api/stats/admin")
def admin_stats(user=Depends(get_current_user)):
    require_admin(user)
    db = get_db()
    stats = db.execute("""
        SELECT
            COUNT(*) as total_claims,
            SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END) as pending_claims,
            SUM(CASE WHEN status='APPROVED' THEN 1 ELSE 0 END) as approved_claims,
            SUM(CASE WHEN status='APPROVED' THEN payout_amount ELSE 0 END) as total_paid
        FROM claims
    """).fetchone()
    db.close()
    return dict(stats)

# ── Claim Types ────────────────────────────────────────────────────
@app.get("/api/claim-types")
def list_claim_types(user=Depends(get_current_user)):
    db = get_db()
    if user["role"] == "admin":
        rows = db.execute("SELECT * FROM claim_types ORDER BY sort_order, name").fetchall()
    else:
        rows = db.execute("SELECT * FROM claim_types WHERE is_active = 1 ORDER BY sort_order, name").fetchall()
    db.close()
    return [dict(r) for r in rows]

@app.post("/api/claim-types")
def create_claim_type(req: ClaimTypeCreate, user=Depends(get_current_user)):
    require_admin(user)
    db = get_db()
    existing = db.execute("SELECT id FROM claim_types WHERE name = ?", (req.name.upper().replace(" ", "_"),)).fetchone()
    if existing:
        db.close()
        raise HTTPException(status_code=400, detail="Claim type with this name already exists")
    ct_id = str(uuid.uuid4())
    max_order = db.execute("SELECT MAX(sort_order) as m FROM claim_types").fetchone()["m"] or 0
    db.execute(
        """INSERT INTO claim_types (id, name, label, description, base_payout, min_rolls, max_payout, is_active, sort_order, icon)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (ct_id, req.name.upper().replace(" ", "_"), req.label, req.description, req.base_payout,
         req.min_rolls, req.max_payout, 1 if req.is_active else 0, max_order + 1, req.icon)
    )
    db.commit()
    ct = db.execute("SELECT * FROM claim_types WHERE id = ?", (ct_id,)).fetchone()
    db.close()
    return dict(ct)

@app.put("/api/claim-types/{ct_id}")
def update_claim_type(ct_id: str, req: ClaimTypeUpdate, user=Depends(get_current_user)):
    require_admin(user)
    db = get_db()
    ct = db.execute("SELECT * FROM claim_types WHERE id = ?", (ct_id,)).fetchone()
    if not ct:
        db.close()
        raise HTTPException(status_code=404, detail="Claim type not found")
    updates = []
    params = []
    if req.label is not None: updates.append("label = ?"); params.append(req.label)
    if req.description is not None: updates.append("description = ?"); params.append(req.description)
    if req.base_payout is not None: updates.append("base_payout = ?"); params.append(req.base_payout)
    if req.min_rolls is not None: updates.append("min_rolls = ?"); params.append(req.min_rolls)
    if req.max_payout is not None: updates.append("max_payout = ?"); params.append(req.max_payout if req.max_payout > 0 else None)
    if req.is_active is not None: updates.append("is_active = ?"); params.append(1 if req.is_active else 0)
    if req.icon is not None: updates.append("icon = ?"); params.append(req.icon)
    if updates:
        updates.append("updated_at = datetime('now')")
        params.append(ct_id)
        db.execute(f"UPDATE claim_types SET {', '.join(updates)} WHERE id = ?", params)
        db.commit()
    result = db.execute("SELECT * FROM claim_types WHERE id = ?", (ct_id,)).fetchone()
    db.close()
    return dict(result)

# ── Distributor Override Payouts ────────────────────────────────────
@app.get("/api/distributor-overrides")
def list_overrides(user=Depends(get_current_user)):
    require_admin(user)
    db = get_db()
    rows = db.execute("""
        SELECT o.*, d.name as distributor_name, ct.label as claim_type_label
        FROM distributor_payout_overrides o
        JOIN distributors d ON o.distributor_id = d.id
        JOIN claim_types ct ON o.claim_type_id = ct.id
        ORDER BY d.name, ct.sort_order
    """).fetchall()
    db.close()
    return [dict(r) for r in rows]

@app.post("/api/distributor-overrides")
def create_override(req: DistributorOverrideCreate, user=Depends(get_current_user)):
    require_admin(user)
    db = get_db()
    existing = db.execute(
        "SELECT id FROM distributor_payout_overrides WHERE distributor_id = ? AND claim_type_id = ?",
        (req.distributor_id, req.claim_type_id)
    ).fetchone()
    if existing:
        db.execute(
            "UPDATE distributor_payout_overrides SET payout_amount = ?, min_rolls = ?, max_payout = ?, is_active = 1 WHERE id = ?",
            (req.payout_amount, req.min_rolls, req.max_payout, existing["id"])
        )
        db.commit()
        row = db.execute("SELECT * FROM distributor_payout_overrides WHERE id = ?", (existing["id"],)).fetchone()
    else:
        ov_id = str(uuid.uuid4())
        db.execute(
            """INSERT INTO distributor_payout_overrides (id, distributor_id, claim_type_id, payout_amount, min_rolls, max_payout)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (ov_id, req.distributor_id, req.claim_type_id, req.payout_amount, req.min_rolls, req.max_payout)
        )
        db.commit()
        row = db.execute("SELECT * FROM distributor_payout_overrides WHERE id = ?", (ov_id,)).fetchone()
    db.close()
    return dict(row)

@app.delete("/api/distributor-overrides/{ov_id}")
def delete_override(ov_id: str, user=Depends(get_current_user)):
    require_admin(user)
    db = get_db()
    db.execute("DELETE FROM distributor_payout_overrides WHERE id = ?", (ov_id,))
    db.commit()
    db.close()
    return {"deleted": ov_id}

# ── Bonus Programs ──────────────────────────────────────────────────
@app.get("/api/bonus-programs")
def list_bonus_programs(user=Depends(get_current_user)):
    db = get_db()
    rows = db.execute("""
        SELECT bp.*, ct.label as claim_type_label, d.name as distributor_name
        FROM bonus_programs bp
        LEFT JOIN claim_types ct ON bp.claim_type_id = ct.id
        LEFT JOIN distributors d ON bp.distributor_id = d.id
        ORDER BY bp.start_date DESC
    """).fetchall()
    db.close()
    return [dict(r) for r in rows]

@app.post("/api/bonus-programs")
def create_bonus_program(req: BonusProgramCreate, user=Depends(get_current_user)):
    require_admin(user)
    if req.bonus_type not in ("FLAT_BONUS", "MULTIPLIER", "OVERRIDE"):
        raise HTTPException(status_code=400, detail="Invalid bonus type")
    db = get_db()
    bp_id = str(uuid.uuid4())
    db.execute(
        """INSERT INTO bonus_programs (id, name, description, claim_type_id, distributor_id, bonus_type, bonus_value, start_date, end_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (bp_id, req.name, req.description, req.claim_type_id, req.distributor_id,
         req.bonus_type, req.bonus_value, req.start_date, req.end_date)
    )
    db.commit()
    row = db.execute("""
        SELECT bp.*, ct.label as claim_type_label, d.name as distributor_name
        FROM bonus_programs bp
        LEFT JOIN claim_types ct ON bp.claim_type_id = ct.id
        LEFT JOIN distributors d ON bp.distributor_id = d.id
        WHERE bp.id = ?""", (bp_id,)).fetchone()
    db.close()
    return dict(row)

@app.put("/api/bonus-programs/{bp_id}/toggle")
def toggle_bonus_program(bp_id: str, user=Depends(get_current_user)):
    require_admin(user)
    db = get_db()
    bp = db.execute("SELECT * FROM bonus_programs WHERE id = ?", (bp_id,)).fetchone()
    if not bp:
        db.close()
        raise HTTPException(status_code=404, detail="Bonus program not found")
    new_status = 0 if bp["is_active"] else 1
    db.execute("UPDATE bonus_programs SET is_active = ? WHERE id = ?", (new_status, bp_id))
    db.commit()
    db.close()
    return {"id": bp_id, "is_active": new_status}

@app.delete("/api/bonus-programs/{bp_id}")
def delete_bonus_program(bp_id: str, user=Depends(get_current_user)):
    require_admin(user)
    db = get_db()
    db.execute("DELETE FROM bonus_programs WHERE id = ?", (bp_id,))
    db.commit()
    db.close()
    return {"deleted": bp_id}

# ── Distributor endpoints ───────────────────────────────────────────
@app.get("/api/distributors")
def list_distributors(user=Depends(get_current_user)):
    db = get_db()
    if user["role"] == "admin":
        rows = db.execute("SELECT * FROM distributors ORDER BY name").fetchall()
    else:
        rows = db.execute("SELECT * FROM distributors WHERE id = ?", (user["distributor_id"],)).fetchall()
    results = []
    for r in rows:
        claim_counts = db.execute(
            "SELECT COUNT(*) as total, SUM(CASE WHEN status='APPROVED' THEN 1 ELSE 0 END) as approved FROM claims WHERE distributor_id = ?",
            (r["id"],)
        ).fetchone()
        results.append({
            **dict(r),
            "total_paid_out": r["initial_fund_amount"] - r["current_fund_balance"],
            "total_claims": claim_counts["total"] or 0,
            "approved_claims": claim_counts["approved"] or 0,
        })
    db.close()
    return results

@app.put("/api/distributors/{dist_id}/fund")
def update_distributor_fund(dist_id: str, req: DistributorFundUpdate, user=Depends(get_current_user)):
    require_admin(user)
    db = get_db()
    dist = db.execute("SELECT * FROM distributors WHERE id = ?", (dist_id,)).fetchone()
    if not dist:
        db.close()
        raise HTTPException(status_code=404, detail="Distributor not found")
    if req.add_funds is not None and req.add_funds > 0:
        db.execute(
            "UPDATE distributors SET initial_fund_amount = initial_fund_amount + ?, current_fund_balance = current_fund_balance + ?, updated_at = datetime('now') WHERE id = ?",
            (req.add_funds, req.add_funds, dist_id)
        )
    if req.initial_fund_amount is not None:
        diff = req.initial_fund_amount - dist["initial_fund_amount"]
        db.execute(
            "UPDATE distributors SET initial_fund_amount = ?, current_fund_balance = current_fund_balance + ?, updated_at = datetime('now') WHERE id = ?",
            (req.initial_fund_amount, diff, dist_id)
        )
    if req.set_balance is not None:
        db.execute(
            "UPDATE distributors SET current_fund_balance = ?, updated_at = datetime('now') WHERE id = ?",
            (req.set_balance, dist_id)
        )
    if req.invite_code is not None:
        code = req.invite_code.strip().upper()
        try:
            db.execute("UPDATE distributors SET invite_code = ?, updated_at = datetime('now') WHERE id = ?", (code, dist_id))
        except Exception:
            db.close()
            raise HTTPException(status_code=400, detail="Invite code already in use by another distributor.")
    db.commit()
    result = db.execute("SELECT * FROM distributors WHERE id = ?", (dist_id,)).fetchone()
    db.close()
    return dict(result)

# ── Claim endpoints ─────────────────────────────────────────────────
@app.post("/api/claims")
async def create_claim(
    claim_type_id: str = Form(...),
    store_name: str = Form(...),
    store_city: str = Form(default=""),
    store_state: str = Form(default=""),
    order_date: str = Form(...),
    rolls_count: int = Form(default=0),
    invoice_number: str = Form(default=""),
    invoice_image: Optional[UploadFile] = File(default=None),
    user=Depends(get_current_user),
):
    if user["role"] != "rep":
        raise HTTPException(status_code=403, detail="Only reps can submit claims")

    db = get_db()
    ct = db.execute("SELECT * FROM claim_types WHERE id = ? AND is_active = 1", (claim_type_id,)).fetchone()
    if not ct:
        db.close()
        raise HTTPException(status_code=400, detail="Invalid or inactive claim type")

    payout_info = calculate_payout(db, claim_type_id, user["distributor_id"], order_date, rolls_count)
    payout = payout_info["payout"]
    min_rolls = payout_info["min_rolls"]

    if min_rolls and min_rolls > 0 and rolls_count < min_rolls:
        db.close()
        raise HTTPException(status_code=400, detail=f"This claim type requires a minimum of {min_rolls} rolls.")

    dist = db.execute("SELECT * FROM distributors WHERE id = ?", (user["distributor_id"],)).fetchone()
    if not dist:
        db.close()
        raise HTTPException(status_code=400, detail="Distributor not found")

    if dist["current_fund_balance"] < payout:
        db.close()
        raise HTTPException(status_code=400, detail="Fund for this distributor is depleted. No additional SPIFFs are currently available.")

    existing = db.execute(
        "SELECT id FROM claims WHERE user_id = ? AND store_name = ? AND order_date = ? AND claim_type_id = ?",
        (user["id"], store_name.strip(), order_date, claim_type_id)
    ).fetchone()
    if existing:
        db.close()
        raise HTTPException(status_code=400, detail="A claim for this store, date, and type already exists.")

    image_url = None
    if invoice_image:
        ext = os.path.splitext(invoice_image.filename or "")[1] or ".jpg"
        filename = f"{uuid.uuid4()}{ext}"
        filepath = os.path.join(UPLOAD_DIR, filename)
        content = await invoice_image.read()
        with open(filepath, "wb") as f:
            f.write(content)
        image_url = f"/uploads/{filename}"

    claim_id = str(uuid.uuid4())
    db.execute(
        """INSERT INTO claims (id, user_id, distributor_id, claim_type_id, store_name, store_city, store_state,
           order_date, rolls_count, invoice_number, invoice_image_url, payout_amount, bonus_applied)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (claim_id, user["id"], user["distributor_id"], claim_type_id, store_name.strip(),
         store_city.strip(), store_state.strip(), order_date, rolls_count,
         invoice_number.strip(), image_url, payout, payout_info.get("bonus_info"))
    )
    db.commit()
    claim = db.execute("SELECT * FROM claims WHERE id = ?", (claim_id,)).fetchone()
    db.close()
    return dict(claim)

@app.get("/api/claims")
def list_claims(
    status: Optional[str] = None,
    distributor_id: Optional[str] = None,
    claim_type_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user=Depends(get_current_user),
):
    db = get_db()
    query = """
        SELECT c.*, u.name as rep_name, u.email as rep_email,
               d.name as distributor_name, ct.label as claim_type_label, ct.icon as claim_type_icon
        FROM claims c
        JOIN users u ON c.user_id = u.id
        JOIN distributors d ON c.distributor_id = d.id
        JOIN claim_types ct ON c.claim_type_id = ct.id
        WHERE 1=1
    """
    params = []
    if user["role"] == "rep":
        query += " AND c.user_id = ?"; params.append(user["id"])
    if status:
        query += " AND c.status = ?"; params.append(status)
    if distributor_id:
        query += " AND c.distributor_id = ?"; params.append(distributor_id)
    if claim_type_id:
        query += " AND c.claim_type_id = ?"; params.append(claim_type_id)
    if date_from:
        query += " AND c.order_date >= ?"; params.append(date_from)
    if date_to:
        query += " AND c.order_date <= ?"; params.append(date_to)
    query += " ORDER BY c.created_at DESC"
    rows = db.execute(query, params).fetchall()
    db.close()
    return [dict(r) for r in rows]

@app.put("/api/claims/{claim_id}/review")
def review_claim(claim_id: str, req: ClaimReviewRequest, user=Depends(get_current_user)):
    require_admin(user)
    if req.status not in ("APPROVED", "REJECTED"):
        raise HTTPException(status_code=400, detail="Status must be APPROVED or REJECTED")
    db = get_db()
    claim = db.execute("SELECT * FROM claims WHERE id = ?", (claim_id,)).fetchone()
    if not claim:
        db.close()
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim["status"] != "PENDING":
        db.close()
        raise HTTPException(status_code=400, detail="Claim already reviewed")
    if req.status == "APPROVED":
        dist = db.execute("SELECT * FROM distributors WHERE id = ?", (claim["distributor_id"],)).fetchone()
        if dist["current_fund_balance"] < claim["payout_amount"]:
            db.close()
            raise HTTPException(status_code=400, detail="Insufficient fund balance to approve this claim")
        db.execute(
            "UPDATE distributors SET current_fund_balance = current_fund_balance - ?, updated_at = datetime('now') WHERE id = ?",
            (claim["payout_amount"], claim["distributor_id"])
        )
    db.execute(
        "UPDATE claims SET status = ?, rejection_reason = ?, updated_at = datetime('now') WHERE id = ?",
        (req.status, req.rejection_reason if req.status == "REJECTED" else None, claim_id)
    )
    db.commit()
    updated = db.execute("""
        SELECT c.*, u.name as rep_name, d.name as distributor_name, ct.label as claim_type_label
        FROM claims c JOIN users u ON c.user_id = u.id JOIN distributors d ON c.distributor_id = d.id
        JOIN claim_types ct ON c.claim_type_id = ct.id WHERE c.id = ?""",
        (claim_id,)
    ).fetchone()
    db.close()
    return dict(updated)

@app.get("/api/claims/export")
def export_claims(
    distributor_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user=Depends(get_current_user),
):
    require_admin(user)
    db = get_db()
    query = """
        SELECT c.*, u.name as rep_name, u.email as rep_email,
               d.name as distributor_name, ct.label as claim_type_label
        FROM claims c JOIN users u ON c.user_id = u.id JOIN distributors d ON c.distributor_id = d.id
        JOIN claim_types ct ON c.claim_type_id = ct.id WHERE 1=1
    """
    params = []
    if distributor_id: query += " AND c.distributor_id = ?"; params.append(distributor_id)
    if date_from: query += " AND c.order_date >= ?"; params.append(date_from)
    if date_to: query += " AND c.order_date <= ?"; params.append(date_to)
    query += " ORDER BY c.created_at DESC"
    rows = db.execute(query, params).fetchall()
    db.close()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Claim ID","Rep Name","Rep Email","Distributor","Claim Type",
                     "Store Name","Store City","Store State","Order Date",
                     "Rolls","Invoice #","Payout","Bonus","Status","Rejection Reason","Submitted"])
    for r in rows:
        writer.writerow([r["id"],r["rep_name"],r["rep_email"],r["distributor_name"],
                         r["claim_type_label"],r["store_name"],r["store_city"],r["store_state"],
                         r["order_date"],r["rolls_count"],r["invoice_number"],
                         f"${r['payout_amount']:.2f}",r["bonus_applied"] or "",r["status"],
                         r["rejection_reason"] or "",r["created_at"]])
    output.seek(0)
    return StreamingResponse(
        output, media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=sesh_spiff_claims_{datetime.now().strftime('%Y%m%d')}.csv"}
    )

# ── Payout preview ──────────────────────────────────────────────────
@app.get("/api/payout-preview")
def payout_preview(claim_type_id: str, order_date: str, user=Depends(get_current_user)):
    db = get_db()
    info = calculate_payout(db, claim_type_id, user["distributor_id"], order_date)
    db.close()
    return info

# ── User Management (admin) ─────────────────────────────────────────
@app.get("/api/users")
def list_users(user=Depends(get_current_user)):
    require_admin(user)
    db = get_db()
    rows = db.execute("""
        SELECT u.id, u.email, u.name, u.role, u.distributor_id, u.created_at, d.name as distributor_name
        FROM users u LEFT JOIN distributors d ON u.distributor_id = d.id
        ORDER BY u.role, u.name
    """).fetchall()
    db.close()
    return [dict(r) for r in rows]

@app.post("/api/users")
def create_user(req: UserCreate, user=Depends(get_current_user)):
    require_admin(user)
    db = get_db()
    existing = db.execute("SELECT id FROM users WHERE email = ?", (req.email,)).fetchone()
    if existing:
        db.close()
        raise HTTPException(status_code=400, detail="Email already registered")
    uid = str(uuid.uuid4())
    db.execute(
        "INSERT INTO users (id, email, password_hash, name, role, distributor_id) VALUES (?, ?, ?, ?, ?, ?)",
        (uid, req.email, hash_password(req.password), req.name, req.role, req.distributor_id)
    )
    db.commit()
    db.close()
    return {"id": uid, "email": req.email, "name": req.name, "role": req.role}

# ── Static files ────────────────────────────────────────────────────
from fastapi.staticfiles import StaticFiles
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

STATIC_DIR = os.path.dirname(__file__)

@app.get("/")
def serve_index():
    from fastapi.responses import FileResponse
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

@app.get("/{filename}")
def serve_static(filename: str):
    from fastapi.responses import FileResponse
    filepath = os.path.join(STATIC_DIR, filename)
    if os.path.isfile(filepath) and not filename.startswith("."):
        return FileResponse(filepath)
    raise HTTPException(status_code=404, detail="Not found")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)

# ── POP / Sample Requests ───────────────────────────────────────────
POP_REQUEST_TYPES = [
    "POP Display",
    "Shelf Talker",
    "Product Samples",
    "Counter Display",
    "Window Cling",
    "Door Strike",
]

def _ensure_pop_requests_table(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS pop_requests (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            distributor_id TEXT NOT NULL,
            request_type TEXT NOT NULL,
            store_name TEXT NOT NULL,
            store_city TEXT,
            store_state TEXT,
            quantity INTEGER NOT NULL DEFAULT 1,
            notes TEXT,
            status TEXT NOT NULL DEFAULT 'PENDING'
                CHECK(status IN ('PENDING', 'IN_PROGRESS', 'FULFILLED', 'DECLINED')),
            admin_note TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (distributor_id) REFERENCES distributors(id)
        );
        CREATE INDEX IF NOT EXISTS idx_pop_user ON pop_requests(user_id);
        CREATE INDEX IF NOT EXISTS idx_pop_status ON pop_requests(status);
    """)
    db.commit()

# POP table is created at startup via the module-level call below
# (called once when the module loads so the table exists immediately)

class PopRequestCreate(BaseModel):
    request_type: str
    store_name: str
    store_city: Optional[str] = ""
    store_state: Optional[str] = ""
    quantity: int = 1
    notes: Optional[str] = ""

class PopRequestUpdate(BaseModel):
    status: str
    admin_note: Optional[str] = None

@app.get("/api/pop-request-types")
def list_pop_request_types(user=Depends(get_current_user)):
    return POP_REQUEST_TYPES

@app.post("/api/pop-requests")
def create_pop_request(req: PopRequestCreate, user=Depends(get_current_user)):
    if user["role"] != "rep":
        raise HTTPException(status_code=403, detail="Only reps can submit POP requests")
    if req.request_type not in POP_REQUEST_TYPES:
        raise HTTPException(status_code=400, detail="Invalid request type")
    if req.quantity < 1:
        raise HTTPException(status_code=400, detail="Quantity must be at least 1")
    db = get_db()
    req_id = str(uuid.uuid4())
    db.execute(
        """INSERT INTO pop_requests
           (id, user_id, distributor_id, request_type, store_name, store_city, store_state, quantity, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (req_id, user["id"], user["distributor_id"], req.request_type,
         req.store_name.strip(), req.store_city.strip(), req.store_state.strip(),
         req.quantity, req.notes.strip() if req.notes else "")
    )
    db.commit()
    row = db.execute("SELECT * FROM pop_requests WHERE id = ?", (req_id,)).fetchone()
    db.close()
    return dict(row)

@app.get("/api/pop-requests")
def list_pop_requests(user=Depends(get_current_user)):
    db = get_db()
    if user["role"] == "admin":
        rows = db.execute("""
            SELECT p.*, u.name as rep_name, u.email as rep_email, d.name as distributor_name
            FROM pop_requests p
            JOIN users u ON p.user_id = u.id
            JOIN distributors d ON p.distributor_id = d.id
            ORDER BY p.created_at DESC
        """).fetchall()
    else:
        rows = db.execute("""
            SELECT p.*, u.name as rep_name, u.email as rep_email, d.name as distributor_name
            FROM pop_requests p
            JOIN users u ON p.user_id = u.id
            JOIN distributors d ON p.distributor_id = d.id
            WHERE p.user_id = ?
            ORDER BY p.created_at DESC
        """, (user["id"],)).fetchall()
    db.close()
    return [dict(r) for r in rows]

@app.put("/api/pop-requests/{req_id}")
def update_pop_request(req_id: str, req: PopRequestUpdate, user=Depends(get_current_user)):
    require_admin(user)
    valid = ("PENDING", "IN_PROGRESS", "FULFILLED", "DECLINED")
    if req.status not in valid:
        raise HTTPException(status_code=400, detail=f"Status must be one of {valid}")
    db = get_db()
    row = db.execute("SELECT * FROM pop_requests WHERE id = ?", (req_id,)).fetchone()
    if not row:
        db.close()
        raise HTTPException(status_code=404, detail="Request not found")
    db.execute(
        "UPDATE pop_requests SET status = ?, admin_note = ?, updated_at = datetime('now') WHERE id = ?",
        (req.status, req.admin_note, req_id)
    )
    db.commit()
    updated = db.execute("""
        SELECT p.*, u.name as rep_name, u.email as rep_email, d.name as distributor_name
        FROM pop_requests p JOIN users u ON p.user_id = u.id JOIN distributors d ON p.distributor_id = d.id
        WHERE p.id = ?""", (req_id,)).fetchone()
    db.close()
    return dict(updated)

@app.get("/api/pop-requests/admin-stats")
def pop_admin_stats(user=Depends(get_current_user)):
    require_admin(user)
    db = get_db()
    stats = db.execute("""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END) as pending,
            SUM(CASE WHEN status='IN_PROGRESS' THEN 1 ELSE 0 END) as in_progress,
            SUM(CASE WHEN status='FULFILLED' THEN 1 ELSE 0 END) as fulfilled,
            SUM(CASE WHEN status='DECLINED' THEN 1 ELSE 0 END) as declined
        FROM pop_requests
    """).fetchone()
    db.close()
    return dict(stats)

# ── Rep store history (for autocomplete) ───────────────────────────
@app.get("/api/my-stores")
def my_stores(user=Depends(get_current_user)):
    """Return distinct stores from this rep's past claims for autocomplete."""
    if user["role"] != "rep":
        return []
    db = get_db()
    rows = db.execute("""
        SELECT DISTINCT store_name, store_city, store_state
        FROM claims
        WHERE user_id = ?
        ORDER BY store_name ASC
        LIMIT 100
    """, (user["id"],)).fetchall()
    db.close()
    return [dict(r) for r in rows]

# ── Door Lists ──────────────────────────────────────────────────────
DOOR_LIST_BONUS_AMOUNT = 10.0
DOOR_LIST_BONUS_NAME = "Door List Submission Bonus"

def _ensure_door_lists_table(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS rep_doors (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            distributor_id TEXT NOT NULL,
            door_type TEXT NOT NULL CHECK(door_type IN ('ACTIVE', 'TARGET')),
            store_name TEXT NOT NULL,
            store_city TEXT,
            store_state TEXT,
            verified INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (distributor_id) REFERENCES distributors(id)
        );
        CREATE INDEX IF NOT EXISTS idx_doors_user ON rep_doors(user_id);
        CREATE INDEX IF NOT EXISTS idx_doors_type ON rep_doors(door_type);

        CREATE TABLE IF NOT EXISTS rep_door_bonus (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL UNIQUE,
            distributor_id TEXT NOT NULL,
            claim_id TEXT,
            paid_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
    """)
    db.commit()


# ── Door List Models ────────────────────────────────────────────────
class DoorEntry(BaseModel):
    door_type: str   # "ACTIVE" | "TARGET"
    store_name: str
    store_city: Optional[str] = ""
    store_state: Optional[str] = ""

class DoorBulkCreate(BaseModel):
    doors: List[DoorEntry]

class DoorVerifyRequest(BaseModel):
    verified: bool

# ── Door List Endpoints ─────────────────────────────────────────────

def _check_and_award_door_bonus(db, user_id: str, distributor_id: str):
    """Award $10 bonus once both ACTIVE and TARGET lists have ≥1 door. Idempotent."""
    already = db.execute("SELECT id FROM rep_door_bonus WHERE user_id = ?", (user_id,)).fetchone()
    if already:
        return None  # Already awarded

    has_active = db.execute(
        "SELECT 1 FROM rep_doors WHERE user_id = ? AND door_type = 'ACTIVE' LIMIT 1", (user_id,)
    ).fetchone()
    has_target = db.execute(
        "SELECT 1 FROM rep_doors WHERE user_id = ? AND door_type = 'TARGET' LIMIT 1", (user_id,)
    ).fetchone()

    if not (has_active and has_target):
        return None

    # Find or create DOOR_LIST_BONUS claim type (inactive, internal use)
    ct = db.execute("SELECT id FROM claim_types WHERE name = 'DOOR_LIST_BONUS'").fetchone()
    if not ct:
        ct_id = str(uuid.uuid4())
        db.execute(
            """INSERT INTO claim_types (id, name, label, description, base_payout, is_active, sort_order, icon)
               VALUES (?, 'DOOR_LIST_BONUS', 'Door List Bonus', 'One-time bonus for submitting active + target door lists', ?, 0, 99, '🗺️')""",
            (ct_id, DOOR_LIST_BONUS_AMOUNT)
        )
        ct_id_val = ct_id
    else:
        ct_id_val = ct["id"]

    # Check distributor fund
    dist = db.execute("SELECT * FROM distributors WHERE id = ?", (distributor_id,)).fetchone()
    if not dist or dist["current_fund_balance"] < DOOR_LIST_BONUS_AMOUNT:
        return None  # Silently skip if insufficient funds

    # Create the claim
    claim_id = str(uuid.uuid4())
    db.execute(
        """INSERT INTO claims (id, user_id, distributor_id, claim_type_id, store_name, order_date,
           rolls_count, payout_amount, status, bonus_applied)
           VALUES (?, ?, ?, ?, 'Door List Submission', date('now'), 0, ?, 'APPROVED', ?)""",
        (claim_id, user_id, distributor_id, ct_id_val, DOOR_LIST_BONUS_AMOUNT, DOOR_LIST_BONUS_NAME)
    )
    db.execute(
        "UPDATE distributors SET current_fund_balance = current_fund_balance - ?, updated_at = datetime('now') WHERE id = ?",
        (DOOR_LIST_BONUS_AMOUNT, distributor_id)
    )
    # Record bonus awarded
    bonus_id = str(uuid.uuid4())
    db.execute(
        "INSERT INTO rep_door_bonus (id, user_id, distributor_id, claim_id) VALUES (?, ?, ?, ?)",
        (bonus_id, user_id, distributor_id, claim_id)
    )
    db.commit()
    return claim_id


@app.post("/api/doors")
def add_doors(req: DoorBulkCreate, user=Depends(get_current_user)):
    if user["role"] != "rep":
        raise HTTPException(status_code=403, detail="Reps only")
    if not req.doors:
        raise HTTPException(status_code=400, detail="No doors provided")
    for d in req.doors:
        if d.door_type not in ("ACTIVE", "TARGET"):
            raise HTTPException(status_code=400, detail=f"Invalid door_type: {d.door_type}")
        if not d.store_name.strip():
            raise HTTPException(status_code=400, detail="Store name required")

    db = get_db()
    inserted = 0
    skipped = 0
    for d in req.doors:
        # Deduplicate by user + type + store name (case-insensitive)
        existing = db.execute(
            "SELECT id FROM rep_doors WHERE user_id = ? AND door_type = ? AND LOWER(store_name) = LOWER(?)",
            (user["id"], d.door_type, d.store_name.strip())
        ).fetchone()
        if existing:
            skipped += 1
            continue
        door_id = str(uuid.uuid4())
        db.execute(
            "INSERT INTO rep_doors (id, user_id, distributor_id, door_type, store_name, store_city, store_state) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (door_id, user["id"], user["distributor_id"], d.door_type,
             d.store_name.strip(), (d.store_city or "").strip(), (d.store_state or "").strip())
        )
        inserted += 1

    db.commit()
    bonus_claim_id = _check_and_award_door_bonus(db, user["id"], user["distributor_id"])
    db.close()
    return {
        "inserted": inserted,
        "skipped": skipped,
        "bonus_awarded": bonus_claim_id is not None,
        "bonus_amount": DOOR_LIST_BONUS_AMOUNT if bonus_claim_id else 0,
    }


@app.get("/api/doors/me")
def my_doors(user=Depends(get_current_user)):
    if user["role"] != "rep":
        raise HTTPException(status_code=403, detail="Reps only")
    db = get_db()
    rows = db.execute(
        "SELECT * FROM rep_doors WHERE user_id = ? ORDER BY door_type, store_name",
        (user["id"],)
    ).fetchall()
    bonus = db.execute("SELECT * FROM rep_door_bonus WHERE user_id = ?", (user["id"],)).fetchone()
    db.close()
    return {
        "doors": [dict(r) for r in rows],
        "bonus_earned": bonus is not None,
        "active_count": sum(1 for r in rows if r["door_type"] == "ACTIVE"),
        "target_count": sum(1 for r in rows if r["door_type"] == "TARGET"),
    }


@app.get("/api/doors/admin")
def admin_doors(
    user_id: Optional[str] = None,
    distributor_id: Optional[str] = None,
    door_type: Optional[str] = None,
    user=Depends(get_current_user)
):
    require_admin(user)
    db = get_db()
    q = """
        SELECT d.*, u.name as rep_name, u.email as rep_email, dist.name as distributor_name
        FROM rep_doors d
        JOIN users u ON d.user_id = u.id
        JOIN distributors dist ON d.distributor_id = dist.id
        WHERE 1=1
    """
    params = []
    if user_id:  q += " AND d.user_id = ?";        params.append(user_id)
    if distributor_id: q += " AND d.distributor_id = ?"; params.append(distributor_id)
    if door_type: q += " AND d.door_type = ?";     params.append(door_type)
    q += " ORDER BY dist.name, u.name, d.door_type, d.store_name"
    rows = db.execute(q, params).fetchall()

    # Summary per rep
    summary = db.execute("""
        SELECT d.user_id, u.name as rep_name, dist.name as distributor_name,
            SUM(CASE WHEN d.door_type='ACTIVE' THEN 1 ELSE 0 END) as active_count,
            SUM(CASE WHEN d.door_type='TARGET' THEN 1 ELSE 0 END) as target_count,
            SUM(CASE WHEN d.verified=1 THEN 1 ELSE 0 END) as verified_count,
            b.id IS NOT NULL as bonus_earned
        FROM rep_doors d
        JOIN users u ON d.user_id = u.id
        JOIN distributors dist ON d.distributor_id = dist.id
        LEFT JOIN rep_door_bonus b ON b.user_id = d.user_id
        GROUP BY d.user_id, u.name, dist.name, b.id
        ORDER BY dist.name, u.name
    """).fetchall()

    db.close()
    return {
        "doors": [dict(r) for r in rows],
        "summary": [dict(r) for r in summary],
    }


@app.get("/api/doors/export")
def export_doors(user=Depends(get_current_user)):
    require_admin(user)
    db = get_db()
    rows = db.execute("""
        SELECT d.door_type, d.store_name, d.store_city, d.store_state,
               d.verified, d.created_at,
               u.name as rep_name, u.email as rep_email, dist.name as distributor_name
        FROM rep_doors d
        JOIN users u ON d.user_id = u.id
        JOIN distributors dist ON d.distributor_id = dist.id
        ORDER BY dist.name, u.name, d.door_type, d.store_name
    """).fetchall()
    db.close()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Type","Store Name","City","State","Verified","Rep Name","Rep Email","Distributor","Submitted"])
    for r in rows:
        writer.writerow([
            r["door_type"], r["store_name"], r["store_city"] or "", r["store_state"] or "",
            "Yes" if r["verified"] else "No",
            r["rep_name"], r["rep_email"], r["distributor_name"], r["created_at"]
        ])
    output.seek(0)
    return StreamingResponse(
        output, media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=sesh_doors_{datetime.now().strftime('%Y%m%d')}.csv"}
    )


@app.put("/api/doors/{door_id}/verify")
def verify_door(door_id: str, req: DoorVerifyRequest, user=Depends(get_current_user)):
    require_admin(user)
    db = get_db()
    row = db.execute("SELECT id FROM rep_doors WHERE id = ?", (door_id,)).fetchone()
    if not row:
        db.close()
        raise HTTPException(status_code=404, detail="Door not found")
    db.execute("UPDATE rep_doors SET verified = ? WHERE id = ?", (1 if req.verified else 0, door_id))
    db.commit()
    db.close()
    return {"id": door_id, "verified": req.verified}


@app.delete("/api/doors/{door_id}")
def delete_door(door_id: str, user=Depends(get_current_user)):
    if user["role"] != "rep":
        raise HTTPException(status_code=403, detail="Reps only")
    db = get_db()
    row = db.execute("SELECT id FROM rep_doors WHERE id = ? AND user_id = ?", (door_id, user["id"])).fetchone()
    if not row:
        db.close()
        raise HTTPException(status_code=404, detail="Door not found")
    db.execute("DELETE FROM rep_doors WHERE id = ?", (door_id,))
    db.commit()
    db.close()
    return {"deleted": door_id}

# ── Notes ───────────────────────────────────────────────────────────

def _ensure_notes_tables(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS rep_scratchpad (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL UNIQUE,
            content TEXT NOT NULL DEFAULT '',
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS store_notes (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            store_name TEXT NOT NULL,
            note TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_store_notes_user ON store_notes(user_id);
        CREATE INDEX IF NOT EXISTS idx_store_notes_store ON store_notes(user_id, store_name);
    """)
    db.commit()

class ScratchpadUpdate(BaseModel):
    content: str

class StoreNoteCreate(BaseModel):
    store_name: str
    note: str

# ── Scratchpad ──────────────────────────────────────────────────────
@app.get("/api/notes/scratchpad")
def get_scratchpad(user=Depends(get_current_user)):
    if user["role"] != "rep":
        raise HTTPException(status_code=403, detail="Reps only")
    db = get_db()
    _ensure_notes_tables(db)
    row = db.execute("SELECT * FROM rep_scratchpad WHERE user_id = ?", (user["id"],)).fetchone()
    db.close()
    return {"content": row["content"] if row else ""}

@app.put("/api/notes/scratchpad")
def save_scratchpad(req: ScratchpadUpdate, user=Depends(get_current_user)):
    if user["role"] != "rep":
        raise HTTPException(status_code=403, detail="Reps only")
    db = get_db()
    _ensure_notes_tables(db)
    existing = db.execute("SELECT id FROM rep_scratchpad WHERE user_id = ?", (user["id"],)).fetchone()
    if existing:
        db.execute(
            "UPDATE rep_scratchpad SET content = ?, updated_at = datetime('now') WHERE user_id = ?",
            (req.content, user["id"])
        )
    else:
        db.execute(
            "INSERT INTO rep_scratchpad (id, user_id, content) VALUES (?, ?, ?)",
            (str(uuid.uuid4()), user["id"], req.content)
        )
    db.commit()
    db.close()
    return {"saved": True}

# ── Store Notes ─────────────────────────────────────────────────────
@app.get("/api/notes/stores")
def get_store_notes(user=Depends(get_current_user)):
    """Return all store notes for this rep, plus list of stores they can add notes to."""
    if user["role"] != "rep":
        raise HTTPException(status_code=403, detail="Reps only")
    db = get_db()
    _ensure_notes_tables(db)

    # All notes for this rep
    notes = db.execute(
        "SELECT * FROM store_notes WHERE user_id = ? ORDER BY created_at DESC",
        (user["id"],)
    ).fetchall()

    # Unique store names from claims + door list for the picker
    claim_stores = db.execute(
        "SELECT DISTINCT store_name FROM claims WHERE user_id = ? ORDER BY store_name",
        (user["id"],)
    ).fetchall()
    door_stores = db.execute(
        "SELECT DISTINCT store_name FROM rep_doors WHERE user_id = ? ORDER BY store_name",
        (user["id"],)
    ).fetchall()

    all_stores = sorted({r["store_name"] for r in list(claim_stores) + list(door_stores)})
    db.close()

    return {
        "notes": [dict(r) for r in notes],
        "stores": all_stores,
    }

@app.post("/api/notes/stores")
def add_store_note(req: StoreNoteCreate, user=Depends(get_current_user)):
    if user["role"] != "rep":
        raise HTTPException(status_code=403, detail="Reps only")
    if not req.store_name.strip():
        raise HTTPException(status_code=400, detail="Store name required")
    if not req.note.strip():
        raise HTTPException(status_code=400, detail="Note cannot be empty")
    db = get_db()
    _ensure_notes_tables(db)
    note_id = str(uuid.uuid4())
    db.execute(
        "INSERT INTO store_notes (id, user_id, store_name, note) VALUES (?, ?, ?, ?)",
        (note_id, user["id"], req.store_name.strip(), req.note.strip())
    )
    db.commit()
    row = db.execute("SELECT * FROM store_notes WHERE id = ?", (note_id,)).fetchone()
    db.close()
    return dict(row)

@app.delete("/api/notes/stores/{note_id}")
def delete_store_note(note_id: str, user=Depends(get_current_user)):
    if user["role"] != "rep":
        raise HTTPException(status_code=403, detail="Reps only")
    db = get_db()
    row = db.execute(
        "SELECT id FROM store_notes WHERE id = ? AND user_id = ?", (note_id, user["id"])
    ).fetchone()
    if not row:
        db.close()
        raise HTTPException(status_code=404, detail="Note not found")
    db.execute("DELETE FROM store_notes WHERE id = ?", (note_id,))
    db.commit()
    db.close()
    return {"deleted": note_id}

# ── Admin: read all notes ───────────────────────────────────────────
@app.get("/api/notes/admin")
def admin_notes(user=Depends(get_current_user)):
    require_admin(user)
    db = get_db()
    _ensure_notes_tables(db)

    scratchpads = db.execute("""
        SELECT s.content, s.updated_at, u.name as rep_name, u.id as user_id,
               d.name as distributor_name
        FROM rep_scratchpad s
        JOIN users u ON s.user_id = u.id
        LEFT JOIN distributors d ON u.distributor_id = d.id
        WHERE s.content != ''
        ORDER BY u.name
    """).fetchall()

    store_notes = db.execute("""
        SELECT n.*, u.name as rep_name, d.name as distributor_name
        FROM store_notes n
        JOIN users u ON n.user_id = u.id
        LEFT JOIN distributors d ON u.distributor_id = d.id
        ORDER BY u.name, n.store_name, n.created_at DESC
    """).fetchall()

    db.close()
    return {
        "scratchpads": [dict(r) for r in scratchpads],
        "store_notes": [dict(r) for r in store_notes],
    }
