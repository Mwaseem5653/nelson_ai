"""JWT authentication helpers for Nelson Order Chatbot."""
import os
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException, Request, Depends
from typing import Optional


JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")


def _secret() -> str:
    return os.environ["JWT_SECRET"]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(payload: dict) -> str:
    minutes = int(os.environ.get("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "480"))
    body = {
        **payload,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=minutes),
        "iat": datetime.now(timezone.utc),
        "type": "access",
    }
    return jwt.encode(body, _secret(), algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, _secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def get_token_from_request(request: Request) -> Optional[str]:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    return token


async def get_current_user(request: Request) -> dict:
    from db import get_db
    token = get_token_from_request(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")
    db = get_db()
    user = await db.users.find_one({"id": payload["sub"]})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user.get("status") != "Active":
        raise HTTPException(status_code=403, detail="User is disabled")
    user.pop("password_hash", None)
    user.pop("_id", None)

    # Attach effective permissions to user object
    permissions = []
    if user.get("type") == "SuperAdmin":
        forms = await db.forms.find({}, {"_id": 0}).to_list(200)
        permissions = [
            {"form_code": f["code"], "form_name": f["name"],
             "view": True, "add": True, "edit": True, "delete": True, "print": True}
            for f in forms
        ]
    elif user.get("role_id"):
        role = await db.roles.find_one({"id": user["role_id"]}, {"_id": 0})
        if role:
            permissions = role.get("permissions", [])
    user["permissions"] = permissions
    return user


async def check_form_permission(user: dict, form_code: str, action: str) -> bool:
    """Check if user has permission for a specific form action"""
    # SuperAdmin has all permissions
    if user.get("type") == "SuperAdmin":
        return True
    
    # Admin has all permissions
    if user.get("type") == "Admin":
        return True
    
    # If user has no role, deny
    if not user.get("role_id"):
        return False
    
    # Get the role from database
    from db import get_db
    db = get_db()
    role = await db.roles.find_one({"id": user["role_id"]})
    if not role or not role.get("permissions"):
        return False
    
    # Check if role name is Admin (grant all permissions)
    if role.get("name", "").lower() == "admin":
        return True
    
    # Find the permission for this form
    for perm in role["permissions"]:
        if perm.get("form_code") == form_code:
            return perm.get(action, False)
    
    return False


def require_type(*allowed_types: str):
    async def _dep(user: dict = Depends(get_current_user)) -> dict:
        if user.get("type") in allowed_types:
            return user
        
        # Check if user has a role with admin permissions
        if user.get("role_id"):
            from db import get_db
            db = get_db()
            role = await db.roles.find_one({"id": user["role_id"]})
            if role and role.get("name", "").lower() == "admin":
                return user
        
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return _dep


def require_permission(form_code: str, action: str = "view"):
    """Dependency that checks if user has permission for a specific form action"""
    async def _dep(user: dict = Depends(get_current_user)) -> dict:
        if not await check_form_permission(user, form_code, action):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return _dep


def scoped_company_filter(user: dict, filt: Optional[dict] = None) -> dict:
    """Return a MongoDB filter that scopes queries to the user's company (unless SuperAdmin)."""
    filt = dict(filt or {})
    if user.get("type") != "SuperAdmin":
        filt["company_id"] = user.get("company_id")
    return filt