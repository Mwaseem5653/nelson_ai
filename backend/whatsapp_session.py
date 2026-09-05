"""
whatsapp_session.py - Session management
NO circular imports
"""

from dataclasses import dataclass, field
from typing import Optional, List, Dict
from datetime import datetime
import logging

log = logging.getLogger("nelson.whatsapp")

@dataclass
class Session:
    wa_from: str
    sender_name: str
    employee_id: Optional[str] = None
    employee_name: Optional[str] = None
    company_id: Optional[str] = None
    customer_name: Optional[str] = None
    customer_id: Optional[str] = None
    extracted_items: List[Dict] = field(default_factory=list)
    pending_order: Optional[Dict] = None
    stage: str = "idle"
    customer_suggestions: List[Dict] = field(default_factory=list)
    product_suggestions: List[Dict] = field(default_factory=list)
    last_activity: float = field(default_factory=lambda: datetime.now().timestamp())
    confirmation_attempts: int = 0
    current_brand: Optional[str] = None

sessions: Dict[str, Session] = {}

def get_session(wa_from: str) -> Optional[Session]:
    return sessions.get(wa_from)

def create_session(wa_from: str, sender_name: str, employee_id: str, employee_name: str, company_id: str) -> Session:
    session = Session(
        wa_from=wa_from,
        sender_name=sender_name,
        employee_id=employee_id,
        employee_name=employee_name,
        company_id=company_id
    )
    sessions[wa_from] = session
    return session

def update_session(session: Session) -> None:
    session.last_activity = datetime.now().timestamp()
    sessions[session.wa_from] = session

def clear_session(wa_from: str) -> None:
    if wa_from in sessions:
        del sessions[wa_from]

def has_active_session(wa_from: str) -> bool:
    return wa_from in sessions