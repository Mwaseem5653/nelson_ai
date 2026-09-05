"""
whatsapp.py - Main WhatsApp router
"""

import os
import re
import uuid
import logging
import asyncio
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

import httpx
from fastapi import APIRouter, Header, HTTPException, Depends, Request
from pydantic import BaseModel, Field

from auth import get_current_user
from db import get_db
from whatsapp_session import Session, get_session, create_session, update_session, sessions

# ... (rest of imports) ...

# ========== SESSION CLEANUP ==========
async def cleanup_sessions():
    while True:
        await asyncio.sleep(300)
        now = datetime.now().timestamp()
        timeout = 1800
        # Access 'sessions' directly as it is imported from whatsapp_session
        expired = [key for key, session in sessions.items() if now - session.last_activity > timeout]
        for key in expired:
            log.info(f"⏰ Session timeout for {key}")
            sessions.pop(key, None)

def start_session_cleanup():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.create_task(cleanup_sessions())
    log.info("🔄 WhatsApp session cleanup started")
from whatsapp_buffer import MessageBufferManager
from media import MediaHandler
from productSearch import search_product
from agent import OrderAgent

log = logging.getLogger("nelson.whatsapp")
router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])

# Initialize Media Handler & Agent Cache
media_handler = MediaHandler()
agent_cache = {}

# ========== CONFIGURATION ==========
BRIDGE_URL = os.environ.get("WA_BRIDGE_URL", "http://localhost:3100")
BRIDGE_SECRET = os.environ.get("WA_BRIDGE_SECRET", "change-me")

# ========== MESSAGE BUFFERING ==========
message_buffer_manager = MessageBufferManager(wait_ms=500)

# ========== HELPERS ==========
def format_phone_for_whatsapp(phone: str) -> str:
    if not phone: return phone
    if '@' in phone: return phone
    cleaned = re.sub(r'\D', '', phone)
    if not cleaned: return phone
    if cleaned.startswith('0'): cleaned = '92' + cleaned[1:]
    elif not cleaned.startswith('92') and len(cleaned) == 10: cleaned = '92' + cleaned
    return cleaned

def format_phone_number(phone: str) -> str:
    if not phone: return phone
    cleaned = re.sub(r'\D', '', phone)
    if not cleaned: return phone
    if cleaned.startswith('92') and len(cleaned) == 12: cleaned = cleaned[2:]
    if len(cleaned) == 10: cleaned = '0' + cleaned
    if len(cleaned) >= 11: return f"{cleaned[:4]}-{cleaned[4:]}"
    return cleaned

async def _bridge_get(path: str) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(
            f"{BRIDGE_URL}{path}",
            headers={"X-Bridge-Secret": BRIDGE_SECRET}
        )
        r.raise_for_status()
        return r.json()

async def _bridge_post(path: str, body: Optional[dict] = None) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{BRIDGE_URL}{path}",
            json=body or {},
            headers={"X-Bridge-Secret": BRIDGE_SECRET, "Content-Type": "application/json"}
        )
        r.raise_for_status()
        return r.json()

async def log_whatsapp_message(direction: str, wa_from: str, body: str, wa_id: str = None, type_: str = "chat", has_media: bool = False, media_mime: str = None):
    try:
        db = get_db()
        if db is not None:
            now = datetime.now(timezone.utc).isoformat()
            await db.whatsapp_messages.insert_one({
                "id": str(uuid.uuid4()),
                "direction": direction,
                "wa_id": wa_id,
                "wa_from": wa_from,
                "body": body,
                "type": type_,
                "has_media": has_media,
                "media_mime": media_mime,
                "created_at": now,
            })
    except Exception as e:
        log.error(f"Failed to log whatsapp message: {e}")

async def send_wa(to: str, body: str) -> None:
    try:
        formatted_to = format_phone_for_whatsapp(to)
        await _bridge_post("/send", {"to": formatted_to, "body": body})
        log.info(f"✅ Sent to {formatted_to}")
        await log_whatsapp_message(direction="out", wa_from=to, body=body)
    except Exception as e:
        log.error(f"send_wa failed: {e}")

# ========== DATABASE HELPERS ==========
async def find_employee_by_wa(wa_from: str) -> Optional[Dict]:
    db = get_db()
    digits = re.sub(r'\D', '', wa_from.split('@')[0] if '@' in wa_from else wa_from)
    if not digits: return None
    emp = await db.employees.find_one({"whatsapp": digits, "status": "Active"}, {"_id": 0})
    if not emp and len(digits) == 10:
        emp = await db.employees.find_one({"whatsapp": "92" + digits, "status": "Active"}, {"_id": 0})
    return emp

# ========== UNIFIED TEXT HANDLER ==========
async def handle_text_order(emp: Dict, session: Session, text: str, wa_from: str) -> str:
    """Unified handler to process text orders using the OrderAgent."""
    sender_name = session.sender_name or emp.get("name") or "Customer"
    phone_fmt = format_phone_number(wa_from)
    
    if wa_from not in agent_cache:
        agent_cache[wa_from] = OrderAgent(sender_number=phone_fmt, pushname=sender_name)
    
    agent = agent_cache[wa_from]
    agent.sender_number = phone_fmt
    agent.pushname = sender_name
    
    response = await agent.chat_with_user(text)
    return response

# ========== MAIN INBOUND HANDLER ==========
class InboundPayload(BaseModel):
    wa_id: Optional[str] = None
    from_: str = Field(..., alias="from")
    from_jid: Optional[str] = None
    push_name: Optional[str] = None
    to: Optional[str] = None
    body: str = ""
    type: str = "chat"
    timestamp: Optional[int] = None
    has_media: bool = False
    media_path: Optional[str] = None
    media_mime: Optional[str] = None
    media_filename: Optional[str] = None

    class Config:
        populate_by_name = True

@router.post("/inbound")
async def inbound(payload: InboundPayload, request: Request):
    wa_from = payload.from_
    body_text = (payload.body or "").strip()
    
    await log_whatsapp_message(
        direction="in",
        wa_from=wa_from,
        body=body_text,
        wa_id=payload.wa_id,
        type_=payload.type,
        has_media=payload.has_media,
        media_mime=payload.media_mime
    )
    
    emp = await find_employee_by_wa(wa_from)
    if not emp:
        await send_wa(wa_from, f"🚫 Number {format_phone_number(wa_from)} not registered.")
        return {"ok": True}
    
    session = get_session(wa_from) or create_session(wa_from, payload.push_name or "Customer", emp.get("id"), emp.get("name"), emp.get("company_id"))
    update_session(session)
    
    # Media Processing
    if payload.has_media and payload.media_path:
        is_image = payload.type == "image" or (payload.media_mime and "image" in payload.media_mime.lower()) or (payload.media_path and payload.media_path.lower().endswith(('.jpg', '.jpeg', '.png', '.webp', '.heic')))
        is_audio = payload.type == "audio" or (payload.media_mime and "audio" in payload.media_mime.lower()) or (payload.media_path and payload.media_path.lower().endswith(('.ogg', '.mp3', '.m4a', '.wav', '.opus')))

        if is_image:
            extracted_text = await media_handler.process_image(payload.media_path, payload.media_mime)
            caption = body_text if body_text and body_text != "📷 Image received" else ""
            full_prompt = f"{caption}\n{extracted_text}".strip() if caption else extracted_text
            response = await handle_text_order(emp, session, full_prompt, wa_from)
        elif is_audio:
            extracted_text = await media_handler.process_voice(payload.media_path, payload.media_mime)
            response = await handle_text_order(emp, session, extracted_text, wa_from)
        else:
            response = "🚫 Unsupported media type. Please send an image or voice note."
            
        await send_wa(wa_from, response)
        return {"ok": True}
    
    # Text Processing
    response = await handle_text_order(emp, session, body_text, wa_from)
    await send_wa(wa_from, response)
    
    return {"ok": True}

# ========== UI ENDPOINTS ==========
@router.get("/status")
async def wa_status(user: dict = Depends(get_current_user)):
    try:
        data = await _bridge_get("/status")
        return {"ok": True, **data}
    except Exception as e:
        return {"ok": False, "status": "bridge_unreachable", "error": str(e)}

@router.post("/restart")
async def wa_restart(user: dict = Depends(get_current_user)):
    if user.get("type") not in ("SuperAdmin", "Admin"):
        raise HTTPException(403, "Only admins can restart the WhatsApp session")
    try:
        return await _bridge_post("/restart")
    except Exception as e:
        raise HTTPException(502, f"Bridge unreachable: {e}")

class SimulatePayload(BaseModel):
    from_number: str
    body: str = ""

@router.post("/simulate")
async def simulate(payload: SimulatePayload, user: dict = Depends(get_current_user)):
    fake = InboundPayload(
        wa_id=f"sim-{uuid.uuid4().hex[:8]}",
        **{"from": payload.from_number},
        body=payload.body,
        type="chat",
        timestamp=int(datetime.now(timezone.utc).timestamp()),
        has_media=False,
    )
    captured = []
    async def _capture(to, body):
        captured.append({"to": to, "body": body})
    
    import sys
    module = sys.modules[__name__]
    orig = module.send_wa
    module.send_wa = _capture
    try:
        result = await inbound(fake, request=None)
    finally:
        module.send_wa = orig
    return {"result": result, "reply": captured}

@router.get("/messages")
async def list_messages(user: dict = Depends(get_current_user), limit: int = 50):
    db = get_db()
    if db is None:
        return []
    rows = await db.whatsapp_messages.find({}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return rows
