"""Seed super admin user, forms master, and a sample demo company for quick start."""
import os
from datetime import datetime, timezone
from db import get_db, now_iso, new_id
from auth import hash_password


FORMS = [
    {"code": "company", "name": "Company Profile", "group": "Setup"},
    {"code": "role", "name": "Role Profile", "group": "Setup"},
    {"code": "user", "name": "User Profile", "group": "Setup"},
    {"code": "department", "name": "Department Setup", "group": "Setup"},
    {"code": "route", "name": "Route Setup", "group": "Setup"},
    {"code": "brand", "name": "Brand Profile", "group": "Setup"},
    {"code": "product", "name": "Product Profile", "group": "Setup"},
    {"code": "unit", "name": "Unit Profile", "group": "Setup"},
    {"code": "item", "name": "Item Profile", "group": "Setup"},
    {"code": "customer", "name": "Customer Profile", "group": "Setup"},
    {"code": "employee", "name": "Employee Profile", "group": "Setup"},
    {"code": "sales_order", "name": "Sales Order", "group": "Transaction"},
    {"code": "dashboard", "name": "Dashboard", "group": "System"},
    {"code": "whatsapp", "name": "WhatsApp Connection", "group": "System"},
]


async def seed_forms(db):
    for f in FORMS:
        await db.forms.update_one(
            {"code": f["code"]},
            {"$set": f},
            upsert=True,
        )


async def seed_superadmin(db):
    login_id = os.environ.get("SUPERADMIN_LOGIN_ID", "superadmin")
    password = os.environ.get("SUPERADMIN_PASSWORD", "SuperAdmin@123")
    email = os.environ.get("SUPERADMIN_EMAIL", "superadmin@nelson.local")
    existing = await db.users.find_one({"login_id": login_id})
    new_hash = hash_password(password)
    if existing is None:
        ts = now_iso()
        await db.users.insert_one({
            "id": new_id(),
            "company_id": None,
            "full_name": "Super Admin",
            "login_id": login_id,
            "password_hash": new_hash,
            "email": email,
            "type": "SuperAdmin",
            "role_id": None,
            "status": "Active",
            "created_by": "system",
            "created_at": ts,
            "updated_by": "system",
            "updated_at": ts,
        })
    else:
        from auth import verify_password
        if not verify_password(password, existing["password_hash"]):
            await db.users.update_one(
                {"login_id": login_id},
                {"$set": {"password_hash": new_hash, "type": "SuperAdmin", "status": "Active", "updated_at": now_iso()}},
            )


async def seed_demo_company(db):
    """Create one demo company + admin + employee for immediate testing."""
    code = "DEMO"
    existing = await db.companies.find_one({"code": code})
    if existing:
        company_id = existing["id"]
    else:
        company_id = new_id()
        ts = now_iso()
        await db.companies.insert_one({
            "id": company_id,
            "code": code,
            "name": "Demo Trading Co.",
            "address": "12 Market Street",
            "phone": "+92-300-0000000",
            "whatsapp": "+92-300-0000000",
            "email": "admin@demo.local",
            "logo": None,
            "status": "Active",
            "created_by": "system",
            "created_at": ts,
            "updated_by": "system",
            "updated_at": ts,
        })

    # Default Admin role for this company (with all permissions)
    role = await db.roles.find_one({"company_id": company_id, "name": "Admin"})
    if not role:
        forms = await db.forms.find({}).to_list(1000)
        role_id = new_id()
        ts = now_iso()
        await db.roles.insert_one({
            "id": role_id,
            "company_id": company_id,
            "name": "Admin",
            "status": "Active",
            "permissions": [
                {"form_code": f["code"], "form_name": f["name"], "view": True, "add": True, "edit": True, "delete": True, "print": True}
                for f in forms
            ],
            "created_by": "system",
            "created_at": ts,
            "updated_by": "system",
            "updated_at": ts,
        })
    else:
        role_id = role["id"]

    # Employee role (view + add on transactions)
    emp_role = await db.roles.find_one({"company_id": company_id, "name": "Employee"})
    if not emp_role:
        forms = await db.forms.find({}).to_list(1000)
        ts = now_iso()
        await db.roles.insert_one({
            "id": new_id(),
            "company_id": company_id,
            "name": "Employee",
            "status": "Active",
            "permissions": [
                {"form_code": f["code"], "form_name": f["name"],
                 "view": f["code"] in ("sales_order", "dashboard"),
                 "add": f["code"] == "sales_order",
                 "edit": False, "delete": False, "print": False}
                for f in forms
            ],
            "created_by": "system",
            "created_at": ts,
            "updated_by": "system",
            "updated_at": ts,
        })

    # Default admin user for the demo company
    admin_user = await db.users.find_one({"login_id": "admin", "company_id": company_id})
    if not admin_user:
        ts = now_iso()
        await db.users.insert_one({
            "id": new_id(),
            "company_id": company_id,
            "full_name": "Demo Admin",
            "login_id": "admin",
            "password_hash": hash_password("Admin@123"),
            "email": "admin@demo.local",
            "type": "Admin",
            "role_id": role_id,
            "status": "Active",
            "created_by": "system",
            "created_at": ts,
            "updated_by": "system",
            "updated_at": ts,
        })


async def ensure_indexes(db):
    await db.users.create_index("login_id", unique=True)
    await db.companies.create_index("code", unique=True)
    await db.forms.create_index("code", unique=True)
    await db.brands.create_index([("company_id", 1), ("code", 1)], unique=True)
    await db.brands.create_index([("company_id", 1), ("name", 1)], unique=True)
    await db.units.create_index([("company_id", 1), ("code", 1)], unique=True)
    await db.units.create_index([("company_id", 1), ("name", 1)], unique=True)
    await db.products.create_index([("company_id", 1), ("code", 1)], unique=True)
    await db.departments.create_index([("company_id", 1), ("code", 1)], unique=True)
    await db.routes.create_index([("company_id", 1), ("code", 1)], unique=True)
    await db.items.create_index([("company_id", 1), ("code", 1)], unique=True)
    await db.customers.create_index([("company_id", 1), ("code", 1)], unique=True)
    await db.employees.create_index([("company_id", 1), ("code", 1)], unique=True)


async def run_seed():
    db = get_db()
    if db is None:
        import logging
        logging.getLogger("nelson.seed").warning("⚠️ No DB connection. Skipping database seeding/indexing.")
        return
    await ensure_indexes(db)
    await seed_forms(db)
    await seed_superadmin(db)
    await seed_demo_company(db)
