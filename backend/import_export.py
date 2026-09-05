"""Import / Download-Template endpoints for master entities.

Templates use human-friendly codes (not internal UUIDs) for foreign keys so that
users can fill in Excel with values they already know (e.g. product_code, brand_code).
"""
import io
import os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from typing import Callable, List, Tuple, Optional

from db import get_db, now_iso, new_id, audit_create
from auth import get_current_user, require_type, scoped_company_filter

router = APIRouter(prefix="/api")


def _resolve_company_id(user: dict, provided: Optional[str]) -> str:
    if user.get("type") == "SuperAdmin":
        if not provided:
            raise HTTPException(status_code=400, detail="company_id required for SuperAdmin")
        return provided
    return user["company_id"]


# ---------- Template + Import specs ----------
# Each entry: entity slug -> {
#   collection, columns (excel), example (single row), required (list),
#   resolve: callable(row_dict, company_id, db) -> (mongo_doc_partial, warning_list)
# }

TEMPLATES = {
    "departments": {
        "collection": "departments",
        "columns": ["code", "name", "status"],
        "example": ["SALES", "Sales", "Active"],
        "required": ["code", "name"],
    },
    "routes": {
        "collection": "routes",
        "columns": ["code", "name",     "is_group", "parent_name", "status"],
        "example": ["R01" , "North Zone", "No",       "North", "Active"],
        "required": ["code", "name"],
    },
    "brands": {
        "collection": "brands",
        "columns": ["code", "name", "status"],
        "example": ["NCC", "Nescafe", "Active"],
        "required": ["code", "name"],
    },
    "products": {
        "collection": "products",
        "columns": ["code", "name", "status"],
        "example": ["COFFEE", "Coffee", "Active"],
        "required": ["code", "name"],
    },
    "units": {
        "collection": "units",
        "columns": ["code", "name", "status"],
        "example": ["CTN", "Carton", "Active"],
        "required": ["code", "name"],
    },
    "items": {
        "collection": "items",
        "columns": ["code", "name", "product_code", "brand_code", "unit_code", "status"],
        "example": ["IT01", "Nescafe Classic 200g", "COFFEE", "NCC", "CTN", "Active"],
        "required": ["code", "name", "product_code", "brand_code", "unit_code"],
    },
    "customers": {
        "collection": "customers",
        "columns": ["code", "name", "route_code", "phone", "whatsapp", "email", "address", "status"],
        "example": ["C001", "Corner Store", "R01", "03001111111", "03001111111", "shop@x.com", "12 Market St", "Active"],
        "required": ["code", "name"],
    },
    "employees": {
        "collection": "employees",
        "columns": ["code", "name", "whatsapp", "department_code", "route_code", "status"],
        "example": ["E001", "Ali Khan", "+923001234567", "SALES", "R01", "Active"],
        "required": ["code", "name", "whatsapp"],
    },
}


async def _lookup_id(db, collection: str, company_id: str, code: str) -> Optional[str]:
    if not code:
        return None
    doc = await db[collection].find_one({"company_id": company_id, "code": code}, {"id": 1})
    return doc["id"] if doc else None


async def _resolve_row(entity: str, row: dict, company_id: str, db) -> Tuple[Optional[dict], Optional[str]]:
    """Convert a raw Excel row into a full Mongo insert doc (or return an error string)."""
    spec = TEMPLATES[entity]
    for req in spec["required"]:
        if not row.get(req):
            return None, f"Missing required field '{req}'"

    base = {"status": row.get("status") or "Active", "company_id": company_id}

    if entity in ("departments", "routes", "brands", "products", "units"):
        base["code"] = row["code"]
        base["name"] = row["name"]
        if entity == "routes":
            # Handle is_group (YES/NO/TRUE/FALSE)
            is_group_val = str(row.get("is_group") or "").strip().lower()
            base["is_group"] = is_group_val in ("yes", "true", "1", "y")
            base["group"] = ""  # You can set this if you have a group column
            
            # ✅ Handle parent_name -> parent_id lookup
            parent_name = row.get("parent_name")
            if parent_name and str(parent_name).strip():
                parent_val = str(parent_name).strip()
                
                # Try to find parent by name first
                parent = await db.routes.find_one({
                    "company_id": company_id,
                    "name": parent_val,
                    "is_group": True
                })
                
                # If not found by name, try by code
                if not parent:
                    parent = await db.routes.find_one({
                        "company_id": company_id,
                        "code": parent_val,
                        "is_group": True
                    })
                
                if parent:
                    base["parent_id"] = parent["id"]
                else:
                    # Parent not found - you can either:
                    # Option 1: Reject the import
                    return None, f"Parent route '{parent_val}' not found in this company"
                    # Option 2: Set to None and continue (with warning)
                    # base["parent_id"] = None
            else:
                base["parent_id"] = None

    elif entity == "items":
        product_id = await _lookup_id(db, "products", company_id, row["product_code"])
        brand_id = await _lookup_id(db, "brands", company_id, row["brand_code"])
        unit_id = await _lookup_id(db, "units", company_id, row["unit_code"])
        if not product_id:
            return None, f"Unknown product_code '{row['product_code']}'"
        if not brand_id:
            return None, f"Unknown brand_code '{row['brand_code']}'"
        if not unit_id:
            return None, f"Unknown unit_code '{row['unit_code']}'"
        base.update({
            "code": row["code"], "name": row["name"],
            "product_id": product_id, "brand_id": brand_id, "unit_id": unit_id,
        })

    elif entity == "customers":
        route_id = await _lookup_id(db, "routes", company_id, row.get("route_code")) if row.get("route_code") else None
        if row.get("route_code") and not route_id:
            return None, f"Unknown route_code '{row['route_code']}'"
        base.update({
            "code": row["code"], "name": row["name"],
            "route_id": route_id,
            "phone": row.get("phone") or "",
            "whatsapp": row.get("whatsapp") or "",
            "email": row.get("email") or "",
            "address": row.get("address") or "",
        })

    elif entity == "employees":
        dept_id = await _lookup_id(db, "departments", company_id, row.get("department_code")) if row.get("department_code") else None
        route_id = await _lookup_id(db, "routes", company_id, row.get("route_code")) if row.get("route_code") else None
        if row.get("department_code") and not dept_id:
            return None, f"Unknown department_code '{row['department_code']}'"
        if row.get("route_code") and not route_id:
            return None, f"Unknown route_code '{row['route_code']}'"
        base.update({
            "code": row["code"], "name": row["name"],
            "whatsapp": row["whatsapp"],
            "department_id": dept_id, "route_id": route_id,
            "allowed_customers": [], "allowed_items": [],
        })

    return base, None


# ---------- Template download ----------
def _build_template_xlsx(entity: str) -> bytes:
    spec = TEMPLATES[entity]
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = entity.capitalize()

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="0055FF")
    for i, col in enumerate(spec["columns"], start=1):
        cell = ws.cell(row=1, column=i, value=col)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="left", vertical="center")
        ws.column_dimensions[cell.column_letter].width = max(16, len(col) + 4)

    # Example row (row 2)
    for i, val in enumerate(spec["example"], start=1):
        ws.cell(row=2, column=i, value=val)

    # Instructions sheet
    inst = wb.create_sheet("Instructions")
    inst.append(["Nelson Order Chatbot — Import Template"])
    inst.append([f"Entity: {entity}"])
    inst.append([])
    inst.append(["- Row 1 is the header. DO NOT rename or reorder columns."])
    inst.append(["- Row 2 is a sample; delete it before uploading."])
    inst.append(["- 'status' defaults to Active if empty."])
    inst.append(["- For linked entities, use the *_code column (e.g. product_code, brand_code) matching an existing master."])
    inst.append(["- Duplicate codes within the same company will be skipped and reported."])
    inst["A1"].font = Font(bold=True, size=14)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()

    
@router.get("/import/{entity}/template")
async def download_template(entity: str, _user: dict = Depends(get_current_user)):
    if entity not in TEMPLATES:
        raise HTTPException(status_code=404, detail="Unknown entity")
    data = _build_template_xlsx(entity)
    filename = f"nelson_{entity}_template.xlsx"
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------- Helper function to check permissions ----------
async def check_import_permission(user: dict, entity: str) -> bool:
    """Check if user has permission to import this entity"""
    # SuperAdmin has all permissions
    if user.get("type") == "SuperAdmin":
        return True
    
    # Admin users have import permission
    if user.get("type") == "Admin":
        return True
    
    # For other users (Employee), check role permissions
    if not user.get("role_id"):
        return False
    
    db = get_db()
    role = await db.roles.find_one({"id": user["role_id"]})
    if not role or not role.get("permissions"):
        return False
    
    # Get the form_code for this entity (routes -> route, customers -> customer, etc.)
    form_code = entity.rstrip('s')  # Remove trailing 's'
    
    # Check if the user has 'add' permission for this form
    for perm in role["permissions"]:
        if perm.get("form_code") == form_code and perm.get("add"):
            return True
    
    return False


# ---------- Import (POST xlsx) ----------
@router.post("/import/{entity}")
async def import_entity(
    entity: str,
    file: UploadFile = File(...),
    company_id: Optional[str] = None,
    user: dict = Depends(get_current_user),  # ← Changed from require_type to get_current_user
):
    # Check if entity exists
    if entity not in TEMPLATES:
        raise HTTPException(status_code=404, detail="Unknown entity")
    
    # ✅ Check permissions using the helper function
    if not await check_import_permission(user, entity):
        raise HTTPException(
            status_code=403, 
            detail=f"Insufficient permissions: 'add' permission required for {entity}"
        )
    
    spec = TEMPLATES[entity]
    resolved_company = _resolve_company_id(user, company_id)

    content = await file.read()
    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True, read_only=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid Excel file: {e}")

    ws = wb.active  # first sheet
    rows_iter = ws.iter_rows(values_only=True)
    try:
        headers = [str(h).strip() if h is not None else "" for h in next(rows_iter)]
    except StopIteration:
        raise HTTPException(status_code=400, detail="Empty file")

    # Validate headers subset match
    expected = spec["columns"]
    if [h for h in headers if h] != expected:
        raise HTTPException(
            status_code=400,
            detail=f"Header row must be exactly: {expected}. Got: {[h for h in headers if h]}",
        )

    db = get_db()
    created = 0
    skipped_duplicates: List[dict] = []
    errors: List[dict] = []
    total = 0

    for row_num, raw in enumerate(rows_iter, start=2):
        if raw is None:
            continue
        if all((v is None or str(v).strip() == "") for v in raw):
            continue
        total += 1
        row = {h: (str(v).strip() if v is not None else "") for h, v in zip(headers, raw) if h}

        doc_partial, err = await _resolve_row(entity, row, resolved_company, db)
        if err:
            errors.append({"row": row_num, "code": row.get("code", ""), "error": err})
            continue

        # Skip if code already exists
        exists = await db[spec["collection"]].find_one(
            {"company_id": resolved_company, "code": doc_partial["code"]}
        )
        if exists:
            skipped_duplicates.append({"row": row_num, "code": doc_partial["code"]})
            continue

        # For brands/units also check name uniqueness
        if spec["collection"] in ("brands", "units"):
            name_dup = await db[spec["collection"]].find_one(
                {"company_id": resolved_company, "name": doc_partial["name"]}
            )
            if name_dup:
                errors.append({"row": row_num, "code": doc_partial["code"],
                               "error": f"Name '{doc_partial['name']}' already exists"})
                continue

        doc = {"id": new_id(), **doc_partial, **audit_create(user)}
        await db[spec["collection"]].insert_one(doc)
        created += 1

    return {
        "entity": entity,
        "total_rows": total,
        "created": created,
        "skipped_duplicates": skipped_duplicates,
        "errors": errors,
    }