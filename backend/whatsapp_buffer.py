"""
whatsapp_buffer.py - Message buffering for WhatsApp
Debounces multiple rapid messages before processing
"""

import asyncio
import logging
from typing import Callable, Dict, List, Optional
from datetime import datetime, timezone

log = logging.getLogger("nelson.whatsapp")

class MessageBuffer:
    """Buffer messages from a sender with debouncing"""
    
    def __init__(self, sender_id: str, wait_ms: int = 500):
        self.sender_id = sender_id
        self.wait_ms = wait_ms
        self.messages: List = []
        self.timer: Optional[asyncio.Task] = None
        self.created_at = datetime.now(timezone.utc)
        self.last_activity = datetime.now(timezone.utc)
    
    def add_message(self, message) -> None:
        """Add message to buffer"""
        self.messages.append(message)
        self.last_activity = datetime.now(timezone.utc)
        log.info(f"📨 [{self.sender_id}] Buffered message #{len(self.messages)}")
    
    async def wait_and_get_messages(
        self,
        callback: Callable[[List], None]
    ) -> None:
        """Wait for debounce period, then call callback with all buffered messages"""
        
        # Cancel previous timer if exists
        if self.timer:
            self.timer.cancel()
        
        async def process_after_delay():
            try:
                await asyncio.sleep(self.wait_ms / 1000.0)
                if self.messages:
                    log.info(f"✅ [{self.sender_id}] Processing {len(self.messages)} buffered message(s)")
                    await callback(self.messages)
            except asyncio.CancelledError:
                log.info(f"⏸️  [{self.sender_id}] Debounce timer cancelled")
        
        self.timer = asyncio.create_task(process_after_delay())
    
    def clear(self) -> None:
        """Clear buffer"""
        if self.timer:
            self.timer.cancel()
        self.messages.clear()
        log.info(f"🧹 [{self.sender_id}] Buffer cleared")


class MessageBufferManager:
    """Manage message buffers for multiple senders"""
    
    def __init__(self, wait_ms: int = 500):
        self.buffers: Dict[str, MessageBuffer] = {}
        self.wait_ms = wait_ms
    
    def get_or_create(self, sender_id: str) -> MessageBuffer:
        """Get or create buffer for sender"""
        if sender_id not in self.buffers:
            self.buffers[sender_id] = MessageBuffer(sender_id, self.wait_ms)
            log.info(f"📦 Created new buffer for {sender_id}")
        return self.buffers[sender_id]
    
    def add_message(self, sender_id: str, message) -> MessageBuffer:
        """Add message to sender's buffer"""
        buffer = self.get_or_create(sender_id)
        buffer.add_message(message)
        return buffer
    
    async def process_buffered(
        self,
        sender_id: str,
        callback: Callable[[List], None]
    ) -> None:
        """Process messages with debouncing"""
        buffer = self.get_or_create(sender_id)
        await buffer.wait_and_get_messages(callback)
    
    def clear_sender(self, sender_id: str) -> None:
        """Clear buffer for specific sender"""
        if sender_id in self.buffers:
            self.buffers[sender_id].clear()
            del self.buffers[sender_id]
    
    async def cleanup_old_buffers(self, timeout_minutes: int = 30) -> None:
        """Clean up buffers older than timeout"""
        now = datetime.now(timezone.utc)
        to_remove = []
        
        for sender_id, buffer in self.buffers.items():
            age_minutes = (now - buffer.created_at).total_seconds() / 60
            if age_minutes > timeout_minutes:
                to_remove.append(sender_id)
        
        for sender_id in to_remove:
            log.info(f"🧹 Cleaning up old buffer for {sender_id}")
            self.clear_sender(sender_id)
