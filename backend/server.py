"""Nelson Order Chatbot — FastAPI backend.

Phase 1 + 2: Auth, Companies, Roles, Users, Departments, Routes, Brands, Products,
Units, Items, Customers, Employees (with Allowed Customers/Items), Forms master,
Dashboard stats, Sales Order (read-only skeleton for Phase 3).
"""
from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent / ".env")

import os
import logging
from typing import Optional, List, Any
from datetime import datetime, timezone

from fastapi import FastAPI, APIRouter, Depends, HTTPException, Response, Request
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from db import get_db, init_db, close_db, now_iso, new_id, audit_create, audit_update, clean_doc
from auth import (
    hash_password, verify_password, create_access_token, get_current_user,
    require_type, scoped_company_filter,
)
from seed import run_seed


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
logger = logging.getLogger("nelson")


app = FastAPI(title="Nelson Order Chatbot API", version="1.0.0")
api = APIRouter(prefix="/api")


# ---------- Startup / Shutdown ----------
@app.on_event("startup")
async def _startup():
    """Application startup handler"""
    try:
        # Initialize database connection
        init_db()
        logger.info("✅ Database connection initialized")
        
        # Run seed data
        await run_seed()
        logger.info("✅ Seed data loaded")
        
        # Initialize WhatsApp collections and indexes
        #await init_whatsapp_indexes()
        
        # Create upload directories
        upload_dir = os.environ.get("UPLOAD_DIR", "/app/backend/uploads")
        os.makedirs(upload_dir, exist_ok=True)
        
        wa_media_dir = os.path.join(upload_dir, "wa")
        os.makedirs(wa_media_dir, exist_ok=True)
        
        logger.info(f"📁 Upload directory: {upload_dir}")
        logger.info(f"📁 WhatsApp media directory: {wa_media_dir}")
        
        # Start WhatsApp session cleanup
        from whatsapp import start_session_cleanup
        start_session_cleanup()
        
        # Pre-load products into RAM at startup for fast searching
        from productSearch import load_products_from_db, load_keywords_dictionary
        load_keywords_dictionary()
        await load_products_from_db()
        logger.info("⚡ Products database pre-loaded into RAM on startup")
        logger.info("🔄 WhatsApp session cleanup started")
        
        logger.info("🚀 Nelson backend started successfully!")
        
    except Exception as e:
        logger.error(f"❌ Startup error: {e}")
        raise


@app.on_event("shutdown")
async def _shutdown():
    """Application shutdown handler"""
    try:
        close_db()
        logger.info("🛑 Database connection closed")
    except Exception as e:
        logger.error(f"❌ Shutdown error: {e}")


# ---------- Auth ----------
class LoginBody(BaseModel):
    login_id: str
    password: str


@api.post("/auth/login")
async def login(body: LoginBody, response: Response):
    db = get_db()
    print(f"Searching for login_id: '{body.login_id.strip()}'")
    user = await db.users.find_one({"login_id": body.login_id.strip()})

    if not user:
        print(f"User not found with login_id: '{body.login_id.strip()}'")
        raise HTTPException(status_code=401, detail="Invalid User")
    
    print(f"User found: {user.get('login_id')}")
    print(f"Password hash from DB: {user.get('password_hash', '')[:20]}...")

    if not verify_password(body.password, user.get("password_hash", "")):
        print("Password verification failed")
        raise HTTPException(status_code=401, detail="Invalid credentials")

    #if not user or not verify_password(body.password, user.get("password_hash", "")):
    #    raise HTTPException(status_code=401, detail="Invalid credentials")
    if user.get("status") != "Active":
        raise HTTPException(status_code=403, detail="User is disabled")
    token = create_access_token({"sub": user["id"], "login_id": user["login_id"], "type": user["type"]})
    # httpOnly cookie
    minutes = int(os.environ.get("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "480"))
    response.set_cookie(
        key="access_token", value=token, httponly=True, secure=True,
        samesite="none", max_age=minutes * 60, path="/",
    )
    user.pop("_id", None)
    user.pop("password_hash", None)
    return {"user": user, "access_token": token, "token_type": "bearer"}


@api.post("/auth/logout")
async def logout(response: Response, _user: dict = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


class ResetPasswordBody(BaseModel):
    user_id: str
    new_password: str


@api.post("/auth/reset-password")
async def admin_reset_password(body: ResetPasswordBody, user: dict = Depends(get_current_user)):
    """Admin-only password reset (SuperAdmin can reset anyone; Admin only own company)."""
    db = get_db()
    target = await db.users.find_one({"id": body.user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if user.get("type") == "SuperAdmin":
        pass
    elif user.get("type") == "Admin":
        if target.get("company_id") != user.get("company_id"):
            raise HTTPException(status_code=403, detail="Cannot reset password for user in another company")
    else:
        raise HTTPException(status_code=403, detail="Only Admin/SuperAdmin can reset passwords")
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    await db.users.update_one(
        {"id": body.user_id},
        {"$set": {"password_hash": hash_password(body.new_password), **audit_update(user)}},
    )
    return {"ok": True}


# ---------- Forms master (read-only) ----------
@api.get("/forms")
async def list_forms(_user: dict = Depends(get_current_user)):
    db = get_db()
    rows = await db.forms.find({}, {"_id": 0}).to_list(1000)
    return rows


# ---------- Companies (SuperAdmin only) ----------
class CompanyBody(BaseModel):
    code: str
    name: str
    address: Optional[str] = ""
    phone: Optional[str] = ""
    whatsapp: Optional[str] = ""
    email: Optional[str] = ""
    logo: Optional[str] = None
    status: str = "Active"


@api.get("/companies")
async def list_companies(user: dict = Depends(get_current_user)):
    db = get_db()
    if user.get("type") == "SuperAdmin":
        rows = await db.companies.find({}, {"_id": 0}).to_list(1000)
    else:
        rows = await db.companies.find({"id": user.get("company_id")}, {"_id": 0}).to_list(1)
    return rows


@api.post("/companies")
async def create_company(body: CompanyBody, user: dict = Depends(require_type("SuperAdmin"))):
    db = get_db()
    exists = await db.companies.find_one({"code": body.code})
    if exists:
        raise HTTPException(status_code=400, detail="Company code already exists")
    doc = {"id": new_id(), **body.model_dump(), **audit_create(user)}
    await db.companies.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/companies/{cid}")
async def update_company(cid: str, body: CompanyBody, user: dict = Depends(get_current_user)):
    db = get_db()
    if user.get("type") == "SuperAdmin":
        pass
    elif user.get("type") == "Admin" and user.get("company_id") == cid:
        pass
    else:
        raise HTTPException(status_code=403, detail="Not allowed")
    upd = {**body.model_dump(), **audit_update(user)}
    res = await db.companies.update_one({"id": cid}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    doc = await db.companies.find_one({"id": cid}, {"_id": 0})
    return doc


@api.delete("/companies/{cid}")
async def delete_company(cid: str, user: dict = Depends(require_type("SuperAdmin"))):
    db = get_db()
    res = await db.companies.delete_one({"id": cid})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ---------- Roles ----------
class Permission(BaseModel):
    form_code: str
    form_name: str
    view: bool = False
    add: bool = False
    edit: bool = False
    delete: bool = False
    print: bool = False


class RoleBody(BaseModel):
    company_id: Optional[str] = None  # SuperAdmin can pass; Admin ignored
    name: str
    status: str = "Active"
    permissions: List[Permission] = []


def _resolve_company_id(user: dict, provided: Optional[str]) -> str:
    if user.get("type") == "SuperAdmin":
        if not provided:
            raise HTTPException(status_code=400, detail="company_id required for SuperAdmin")
        return provided
    return user["company_id"]


@api.get("/roles")
async def list_roles(user: dict = Depends(get_current_user)):
    db = get_db()
    q = scoped_company_filter(user)
    rows = await db.roles.find(q, {"_id": 0}).to_list(1000)
    return rows


@api.post("/roles")
async def create_role(body: RoleBody, user: dict = Depends(require_type("SuperAdmin", "Admin"))):
    db = get_db()
    company_id = _resolve_company_id(user, body.company_id)
    doc = {
        "id": new_id(),
        "company_id": company_id,
        "name": body.name,
        "status": body.status,
        "permissions": [p.model_dump() for p in body.permissions],
        **audit_create(user),
    }
    await db.roles.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/roles/{rid}")
async def update_role(rid: str, body: RoleBody, user: dict = Depends(require_type("SuperAdmin", "Admin"))):
    db = get_db()
    q = scoped_company_filter(user, {"id": rid})
    upd = {
        "name": body.name,
        "status": body.status,
        "permissions": [p.model_dump() for p in body.permissions],
        **audit_update(user),
    }
    res = await db.roles.update_one(q, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    doc = await db.roles.find_one({"id": rid}, {"_id": 0})
    return doc


@api.delete("/roles/{rid}")
async def delete_role(rid: str, user: dict = Depends(require_type("SuperAdmin", "Admin"))):
    db = get_db()
    q = scoped_company_filter(user, {"id": rid})
    res = await db.roles.delete_one(q)
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ---------- Users ----------
class UserBody(BaseModel):
    company_id: Optional[str] = None
    full_name: str
    login_id: str
    password: Optional[str] = None
    email: Optional[str] = ""
    type: str  # Admin / Employee (SuperAdmin can create SuperAdmin)
    role_id: Optional[str] = None
    status: str = "Active"


@api.get("/users")
async def list_users(user: dict = Depends(require_type("SuperAdmin", "Admin"))):
    db = get_db()
    q = scoped_company_filter(user)
    rows = await db.users.find(q, {"_id": 0, "password_hash": 0}).to_list(2000)
    return rows


@api.post("/users")
async def create_user(body: UserBody, user: dict = Depends(require_type("SuperAdmin", "Admin"))):
    db = get_db()
    if user.get("type") == "SuperAdmin":
        company_id = body.company_id
        if body.type != "SuperAdmin" and not company_id:
            raise HTTPException(status_code=400, detail="company_id required for non-SuperAdmin user")
    else:
        company_id = user["company_id"]
        if body.type == "SuperAdmin":
            raise HTTPException(status_code=403, detail="Admins cannot create SuperAdmins")
    if body.type not in ("SuperAdmin", "Admin", "Employee"):
        raise HTTPException(status_code=400, detail="Invalid user type")
    if not body.password:
        raise HTTPException(status_code=400, detail="Password required")
    existing = await db.users.find_one({"login_id": body.login_id.strip()})
    if existing:
        raise HTTPException(status_code=400, detail="Login ID already exists")
    doc = {
        "id": new_id(),
        "company_id": company_id,
        "full_name": body.full_name,
        "login_id": body.login_id.strip(),
        "password_hash": hash_password(body.password),
        "email": body.email or "",
        "type": body.type,
        "role_id": body.role_id,
        "status": body.status,
        **audit_create(user),
    }
    await db.users.insert_one(doc)
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    return doc


@api.put("/users/{uid}")
async def update_user(uid: str, body: UserBody, user: dict = Depends(require_type("SuperAdmin", "Admin"))):
    db = get_db()
    q = scoped_company_filter(user, {"id": uid})
    target = await db.users.find_one(q)
    if not target:
        raise HTTPException(status_code=404, detail="Not found")
    upd = {
        "full_name": body.full_name,
        "email": body.email or "",
        "type": body.type,
        "role_id": body.role_id,
        "status": body.status,
        **audit_update(user),
    }
    if body.password:
        upd["password_hash"] = hash_password(body.password)
    await db.users.update_one({"id": uid}, {"$set": upd})
    doc = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
    return doc


@api.delete("/users/{uid}")
async def delete_user(uid: str, user: dict = Depends(require_type("SuperAdmin", "Admin"))):
    db = get_db()
    if uid == user.get("id"):
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    q = scoped_company_filter(user, {"id": uid})
    res = await db.users.delete_one(q)
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ---------- Generic master factory for simple entities ----------
async def _validate_parent(db, collection: str, parent_field: str, company_id: str,
                           node_id: Optional[str], parent_id: Optional[str],
                           parent_must_be_group: bool = False):
    """Ensure a self-parenting tree stays acyclic: parent must exist in the same company,
    must not be the node itself, and must not be one of the node's descendants."""
    if not parent_id:
        return
    if node_id and parent_id == node_id:
        raise HTTPException(status_code=400, detail="A record cannot be its own parent")
    parent = await db[collection].find_one({"company_id": company_id, "id": parent_id}, {"_id": 0, "id": 1, "is_group": 1})
    if not parent:
        raise HTTPException(status_code=400, detail="Parent record does not exist in this company")
    if parent_must_be_group and parent.get("is_group") is not True:
        raise HTTPException(status_code=400, detail="Parent must be a group (enable 'Is Group')")
    if not node_id:
        return
    stack = [node_id]
    while stack:
        cur = stack.pop()
        children = await db[collection].find({parent_field: cur}, {"_id": 0, "id": 1}).to_list(10000)
        for c in children:
            if c["id"] == parent_id:
                raise HTTPException(status_code=400, detail="Cannot set a descendant as its parent")
            stack.append(c["id"])


def _register_master(collection: str, path: str, extra_fields: dict = None, unique_by_code_name: bool = False,
                     delete_guards: List[tuple] = None, parent_field: Optional[str] = None,
                     parent_must_be_group: bool = False, defaults: dict = None):
    """
    Register CRUD routes for a simple master entity: code, name, status + extras.
    extra_fields: {field_name: default_value} -- values passed via request body dict.
    delete_guards: [(referencing_collection, referencing_field, referencing_label), ...]
                   Blocks deletion when a row in the referencing collection points at this record.
    parent_field: field name that references this same collection (self-parenting tree). When set,
                   cycles are rejected on create/update (self-parent and descendant-parent).
    parent_must_be_group: when True, the parent selected for a record must itself have is_group=True.
    defaults: {field_name: default_value} applied to create/update when the key is missing from the body.
    """
    extra_fields = extra_fields or {}
    delete_guards = delete_guards or []
    defaults = defaults or {}

    class Body(BaseModel):
        model_config = {"extra": "allow"}
        code: str
        name: str
        status: str = "Active"
        company_id: Optional[str] = None  # only SuperAdmin sets

    @api.get(f"/{path}")
    async def list_(user: dict = Depends(get_current_user)):
        db = get_db()
        q = scoped_company_filter(user)
        rows = await db[collection].find(q, {"_id": 0}).to_list(2000)
        if collection == "routes":
            route_map = {route["id"]: route for route in rows}
            for route in rows:
                parent_id = route.get("parent_id")
                if parent_id and parent_id in route_map:
                    route["parent_name"] = route_map[parent_id].get("name", "")
                else:
                    route["parent_name"] = ""
        return rows

    @api.post(f"/{path}")
    async def create_(body: Body, user: dict = Depends(require_type("SuperAdmin", "Admin"))):
        db = get_db()
        company_id = _resolve_company_id(user, body.company_id)
        data = body.model_dump()
        data["company_id"] = company_id
        for k, v in defaults.items():
            data.setdefault(k, v)
        # code uniqueness within company
        exists = await db[collection].find_one({"company_id": company_id, "code": data["code"]})
        if exists:
            raise HTTPException(status_code=400, detail=f"Code already exists for this company")
        if unique_by_code_name:
            name_exists = await db[collection].find_one({"company_id": company_id, "name": data["name"]})
            if name_exists:
                raise HTTPException(status_code=400, detail=f"Name already exists for this company")
        if parent_field:
            await _validate_parent(db, collection, parent_field, company_id, None, data.get(parent_field), parent_must_be_group)
        doc = {"id": new_id(), **data, **audit_create(user)}
        await db[collection].insert_one(doc)
        doc.pop("_id", None)
        return doc

    @api.put(f"/{path}/{{id}}")
    async def update_(id: str, body: Body, user: dict = Depends(require_type("SuperAdmin", "Admin"))):
        db = get_db()
        q = scoped_company_filter(user, {"id": id})
        target = await db[collection].find_one(q)
        if not target:
            raise HTTPException(status_code=404, detail="Not found")
        data = body.model_dump()
        data.pop("company_id", None)  # cannot change company
        for k, v in defaults.items():
            data.setdefault(k, v)
        # uniqueness re-check
        dup = await db[collection].find_one({"company_id": target["company_id"], "code": data["code"], "id": {"$ne": id}})
        if dup:
            raise HTTPException(status_code=400, detail=f"Code already exists for this company")
        if unique_by_code_name:
            ndup = await db[collection].find_one({"company_id": target["company_id"], "name": data["name"], "id": {"$ne": id}})
            if ndup:
                raise HTTPException(status_code=400, detail=f"Name already exists for this company")
        if parent_field:
            await _validate_parent(db, collection, parent_field, target["company_id"], id, data.get(parent_field), parent_must_be_group)
        await db[collection].update_one({"id": id}, {"$set": {**data, **audit_update(user)}})
        doc = await db[collection].find_one({"id": id}, {"_id": 0})
        return doc

    @api.delete(f"/{path}/{{id}}")
    async def delete_(id: str, user: dict = Depends(require_type("SuperAdmin", "Admin"))):
        db = get_db()
        q = scoped_company_filter(user, {"id": id})
        target = await db[collection].find_one(q, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="Not found")
        for ref_coll, ref_field, ref_label in delete_guards:
            ref = await db[ref_coll].find_one({ref_field: id}, {"_id": 0, "name": 1, "code": 1})
            if ref:
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot delete this {path.rstrip('s')}: it is used by {ref_label} "
                           f"'{ref.get('name') or ref.get('code') or id}'. "
                           f"Remove or reassign it before deleting.",
                )
        res = await db[collection].delete_one({"id": id})
        return {"ok": True}


# Departments, Routes, Brands, Products, Units
_register_master("departments", "departments", delete_guards=[("employees", "department_id", "employee")])
_register_master("routes", "routes", 
    unique_by_code_name=True, 
    delete_guards=[("customers", "route_id", "customer"), 
    ("routes", "parent_id", "child route")], 
    parent_field="parent_id", 
    parent_must_be_group=True, 
    defaults={"is_group": False})  
    # extra: group + parent_id (accepted via extra=allow)
_register_master("brands", "brands", unique_by_code_name=True)
_register_master("products", "products")
_register_master("units", "units", unique_by_code_name=True)


# ---------- Items (has product_id, brand_id, unit_id) ----------
class ItemBody(BaseModel):
    company_id: Optional[str] = None
    code: str
    name: str
    product_id: str
    brand_id: str
    unit_id: str
    status: str = "Active"


@api.get("/items")
async def list_items(user: dict = Depends(get_current_user)):
    db = get_db()
    q = scoped_company_filter(user)
    rows = await db.items.find(q, {"_id": 0}).to_list(5000)
    return rows


@api.post("/items")
async def create_item(body: ItemBody, user: dict = Depends(require_type("SuperAdmin", "Admin"))):
    db = get_db()
    company_id = _resolve_company_id(user, body.company_id)
    exists = await db.items.find_one({"company_id": company_id, "code": body.code})
    if exists:
        raise HTTPException(status_code=400, detail="Code already exists for this company")
    doc = {"id": new_id(), **body.model_dump(), "company_id": company_id, **audit_create(user)}
    await db.items.insert_one(doc)
    doc.pop("_id", None)
    from productSearch import load_products_from_db
    import asyncio
    asyncio.create_task(load_products_from_db())
    return doc


@api.put("/items/{iid}")
async def update_item(iid: str, body: ItemBody, user: dict = Depends(require_type("SuperAdmin", "Admin"))):
    db = get_db()
    q = scoped_company_filter(user, {"id": iid})
    target = await db.items.find_one(q)
    if not target:
        raise HTTPException(status_code=404, detail="Not found")
    data = body.model_dump()
    data.pop("company_id", None)
    dup = await db.items.find_one({"company_id": target["company_id"], "code": data["code"], "id": {"$ne": iid}})
    if dup:
        raise HTTPException(status_code=400, detail="Code already exists")
    await db.items.update_one({"id": iid}, {"$set": {**data, **audit_update(user)}})
    from productSearch import load_products_from_db
    import asyncio
    asyncio.create_task(load_products_from_db())
    return await db.items.find_one({"id": iid}, {"_id": 0})


@api.delete("/items/{iid}")
async def delete_item(iid: str, user: dict = Depends(require_type("SuperAdmin", "Admin"))):
    db = get_db()
    q = scoped_company_filter(user, {"id": iid})
    res = await db.items.delete_one(q)
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    from productSearch import load_products_from_db
    import asyncio
    asyncio.create_task(load_products_from_db())
    return {"ok": True}


# ---------- Customers ----------
class CustomerBody(BaseModel):
    company_id: Optional[str] = None
    code: str
    name: str
    route_id: Optional[str] = None
    phone: Optional[str] = ""
    whatsapp: Optional[str] = ""
    email: Optional[str] = ""
    address: Optional[str] = ""
    status: str = "Active"


@api.get("/customers")
async def list_customers(user: dict = Depends(get_current_user), route_id: Optional[str] = None):
    db = get_db()
    q = scoped_company_filter(user)
    if route_id:
        q["route_id"] = route_id
    rows = await db.customers.find(q, {"_id": 0}).to_list(10000)
    return rows


@api.post("/customers")
async def create_customer(body: CustomerBody, user: dict = Depends(require_type("SuperAdmin", "Admin"))):
    db = get_db()
    company_id = _resolve_company_id(user, body.company_id)
    exists = await db.customers.find_one({"company_id": company_id, "code": body.code})
    if exists:
        raise HTTPException(status_code=400, detail="Code already exists")
    doc = {"id": new_id(), **body.model_dump(), "company_id": company_id, **audit_create(user)}
    await db.customers.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/customers/{cid}")
async def update_customer(cid: str, body: CustomerBody, user: dict = Depends(require_type("SuperAdmin", "Admin"))):
    db = get_db()
    q = scoped_company_filter(user, {"id": cid})
    target = await db.customers.find_one(q)
    if not target:
        raise HTTPException(status_code=404, detail="Not found")
    data = body.model_dump()
    data.pop("company_id", None)
    dup = await db.customers.find_one({"company_id": target["company_id"], "code": data["code"], "id": {"$ne": cid}})
    if dup:
        raise HTTPException(status_code=400, detail="Code already exists")
    await db.customers.update_one({"id": cid}, {"$set": {**data, **audit_update(user)}})
    return await db.customers.find_one({"id": cid}, {"_id": 0})


@api.delete("/customers/{cid}")
async def delete_customer(cid: str, user: dict = Depends(require_type("SuperAdmin", "Admin"))):
    db = get_db()
    q = scoped_company_filter(user, {"id": cid})
    res = await db.customers.delete_one(q)
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ---------- Employees ----------
class EmployeeBody(BaseModel):
    company_id: Optional[str] = None
    code: str
    name: str
    whatsapp: str
    department_id: Optional[str] = None
    route_id: Optional[str] = None
    status: str = "Active"
    allowed_customers: List[str] = []
    allowed_items: List[str] = []


@api.get("/employees")
async def list_employees(user: dict = Depends(get_current_user)):
    db = get_db()
    q = scoped_company_filter(user)
    rows = await db.employees.find(q, {"_id": 0}).to_list(5000)
    return rows


@api.get("/employees/{eid}")
async def get_employee(eid: str, user: dict = Depends(get_current_user)):
    db = get_db()
    q = scoped_company_filter(user, {"id": eid})
    doc = await db.employees.find_one(q, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    return doc


@api.post("/employees")
async def create_employee(body: EmployeeBody, user: dict = Depends(require_type("SuperAdmin", "Admin"))):
    db = get_db()
    company_id = _resolve_company_id(user, body.company_id)
    exists = await db.employees.find_one({"company_id": company_id, "code": body.code})
    if exists:
        raise HTTPException(status_code=400, detail="Code already exists")
    doc = {"id": new_id(), **body.model_dump(), "company_id": company_id, **audit_create(user)}
    await db.employees.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.put("/employees/{eid}")
async def update_employee(eid: str, body: EmployeeBody, user: dict = Depends(require_type("SuperAdmin", "Admin"))):
    db = get_db()
    q = scoped_company_filter(user, {"id": eid})
    target = await db.employees.find_one(q)
    if not target:
        raise HTTPException(status_code=404, detail="Not found")
    data = body.model_dump()
    data.pop("company_id", None)
    dup = await db.employees.find_one({"company_id": target["company_id"], "code": data["code"], "id": {"$ne": eid}})
    if dup:
        raise HTTPException(status_code=400, detail="Code already exists")
    await db.employees.update_one({"id": eid}, {"$set": {**data, **audit_update(user)}})
    return await db.employees.find_one({"id": eid}, {"_id": 0})


@api.delete("/employees/{eid}")
async def delete_employee(eid: str, user: dict = Depends(require_type("SuperAdmin", "Admin"))):
    db = get_db()
    q = scoped_company_filter(user, {"id": eid})
    res = await db.employees.delete_one(q)
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


class AllowedListBody(BaseModel):
    ids: List[str]


@api.put("/employees/{eid}/allowed-customers")
async def set_allowed_customers(eid: str, body: AllowedListBody, user: dict = Depends(require_type("SuperAdmin", "Admin"))):
    db = get_db()
    q = scoped_company_filter(user, {"id": eid})
    res = await db.employees.update_one(q, {"$set": {"allowed_customers": body.ids, **audit_update(user)}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True, "allowed_customers": body.ids}


@api.put("/employees/{eid}/allowed-items")
async def set_allowed_items(eid: str, body: AllowedListBody, user: dict = Depends(require_type("SuperAdmin", "Admin"))):
    db = get_db()
    q = scoped_company_filter(user, {"id": eid})
    res = await db.employees.update_one(q, {"$set": {"allowed_items": body.ids, **audit_update(user)}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True, "allowed_items": body.ids}


# ---------- Sales Orders (Phase 3 receiver; here for read-only skeleton) ----------
@api.get("/orders")
async def list_orders(user: dict = Depends(get_current_user)):
    db = get_db()
    q = scoped_company_filter(user)
    rows = await db.order_master.find(q, {"_id": 0}).sort("order_date", -1).to_list(2000)
    return rows


@api.get("/orders/{oid}")
async def get_order(oid: str, user: dict = Depends(get_current_user)):
    db = get_db()
    q = scoped_company_filter(user, {"id": oid})
    master = await db.order_master.find_one(q, {"_id": 0})
    if not master:
        raise HTTPException(status_code=404, detail="Not found")
    details = await db.order_detail.find({"order_id": oid}, {"_id": 0}).to_list(1000)
    return {"master": master, "details": details}


# ---------- Dashboard ----------
@api.get("/dashboard/stats")
async def dashboard_stats(user: dict = Depends(get_current_user)):
    db = get_db()
    q = scoped_company_filter(user)
    today = datetime.now(timezone.utc).date().isoformat()

    orders_total = await db.order_master.count_documents(q)
    orders_today = await db.order_master.count_documents({**q, "order_date": {"$regex": f"^{today}"}})
    orders_pending = await db.order_master.count_documents({**q, "status": "Pending"})

    customers_total = await db.customers.count_documents(q)
    employees_total = await db.employees.count_documents(q)
    items_total = await db.items.count_documents(q)

    return {
        "orders_total": orders_total,
        "orders_today": orders_today,
        "orders_pending": orders_pending,
        "customers_total": customers_total,
        "employees_total": employees_total,
        "items_total": items_total,
    }


# ---------- Health ----------
@api.get("/")
async def root():
    return {"service": "nelson-order-chatbot-api", "version": "1.0.0"}


# ---------- Include & CORS ----------
from import_export import router as import_router
from whatsapp import router as whatsapp_router
app.include_router(import_router)
api.include_router(whatsapp_router)
app.include_router(api)

cors_origins_env = os.environ.get("CORS_ORIGINS", "*").strip()
if cors_origins_env == "*":
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=True,
        allow_origin_regex=r"^https?://.*",
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=True,
        allow_origins=[o.strip() for o in cors_origins_env.split(",") if o.strip()],
        allow_methods=["*"],
        allow_headers=["*"],
    )
