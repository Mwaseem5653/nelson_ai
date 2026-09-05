"""MongoDB connection and helpers."""
import os
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, timezone
from typing import Optional
import uuid

_client: Optional[AsyncIOMotorClient] = None
_db = None


"""MongoDB connection and helpers."""
import os
import logging
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, timezone
from typing import Optional
import uuid

log = logging.getLogger("nelson.db")

_client: Optional[AsyncIOMotorClient] = None
_db = None


def init_db():
    global _client, _db
    mongo_url = os.environ.get("MONGO_URL")
    if not mongo_url:
        log.warning("⚠️ MONGO_URL not set. Running in JSON-only mode.")
        return None
        
    try:
        _client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=2000)
        _db = _client[os.environ.get("DB_NAME", "nelson")]
        # Trigger a command to check connection
        _client.admin.command('ping')
        log.info("✅ Database connection initialized")
    except Exception as e:
        log.error(f"❌ Database connection failed: {e}. Running in JSON-only mode.")
        _client = None
        _db = None
    return _db


def get_db():
    global _db
    if _db is None:
        init_db()
    return _db


def close_db():
    global _client
    if _client is not None:
        _client.close()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def audit_create(user: dict) -> dict:
    ts = now_iso()
    return {
        "created_by": user.get("id"),
        "created_at": ts,
        "updated_by": user.get("id"),
        "updated_at": ts,
    }


def audit_update(user: dict) -> dict:
    return {
        "updated_by": user.get("id"),
        "updated_at": now_iso(),
    }


def clean_doc(doc: Optional[dict]) -> Optional[dict]:
    if doc is None:
        return None
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    return doc
