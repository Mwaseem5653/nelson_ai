"""
productSearch.py - Full Intelligent product search (Ported from JS).
"""
import json
import os
import re
import logging
from db import get_db

log = logging.getLogger("nelson.productSearch")

# Constants
MAJOR_GROUPS = {
    'EXTRA', 'TREND', 'BOLD', 'BUDGET', 'EXCLUSIVE', 'FLUORESCENT',
    'ALTRA', 'BONDEX', 'NIPPON', 'BERGER', 'HI', 'FAME',
    'KLICK', 'SATIN', 'HEAT', 'TIMBER', 'WOOD', 'WOODCOAT', 'TURPENTINE'
}

STOP_WORDS = {
    'THE','AND','OR','OF','IN','OB','A','AN',
    'BAGHER','BINA','WITHOUT','TOKEN','TOKN','TX',
    'GALLON','DRUM','QUARTER','GLN','DRM','QTR',
    'BALTI','PCS','PIECE','KG',
    'KI','KA','KE','KO','SE','WALI','WALA','WALE','ME','MEIN',
    'HAI','HAIN','DEIN','DO','BHEJO','LAO','LAGA','CHAHIYE',
    'HO','AUR','YA','BHI','NAHI','NAHN','NA','JI','G'
}

# Base Synonyms (Ported from original JS SYNONYMS)
BASE_SYNONYMS = {
    'EXTA': 'EXTRA', 'EXT': 'EXTRA', 'ETRA': 'EXTRA', 'ERTA': 'EXTRA', 'XTRA': 'EXTRA',
    'FLORESCENT': 'FLUORESCENT', 'FLURO': 'FLUORESCENT',
    'LAPY': 'PUTTY', 'LAAPI': 'PUTTY', 'LAPI': 'PUTTY',
    'DIST': 'SEMI', 'DSIT': 'SEMI', 'DISTEMPR': 'SEMI', 'DISTEMPER': 'SEMI',
    'PRIMR': 'PRIMER',
    'THINER': 'THINNER', 'THINR': 'THINNER',
    'MAT': 'MATT',
    'ENAML': 'ENAMEL', 'ENAM': 'ENAMEL',
    'BASE': 'PRIMER',
    'PLASTIC': 'SEMI',
    'EXCLSIVE': 'EXCLUSIVE', 'EXCLUCV': 'EXCLUSIVE', 'EXCL': 'EXCLUSIVE',
    'ALTA': 'ALTRA',
    'BNDX': 'BONDEX',
    'WHATER': 'WATER', 'WTER': 'WATER', 'WATR': 'WATER', 'WATAR': 'WATER', 'WOTER': 'WATER', 'WATTER': 'WATER', 'WATERR': 'WATER',
    'WHI': 'WHITE', 'WH': 'WHITE',
    'BLK': 'BLACK',
    'GRY': 'GREY',
    'EMULSION': 'SEMI',
    'W': 'WHITE',
    'SHEATH': 'SHIELD', 'SHEET': 'SHIELD', 'SHEILD': 'SHIELD',
    'EML': 'SEMI', 'ENL': 'SEMI',
}

# --- State ---
DYNAMIC_SYNONYMS = BASE_SYNONYMS.copy()

def load_keywords_dictionary():
    """Load dynamic synonyms from JSON."""
    global DYNAMIC_SYNONYMS
    DYNAMIC_SYNONYMS = BASE_SYNONYMS.copy()
    dict_path = os.path.join(os.path.dirname(__file__), 'keywords_dictionary.json')
    
    if not os.path.exists(dict_path):
        return

    try:
        with open(dict_path, 'r') as f:
            data = json.load(f)
            for cat in ['brands', 'products', 'colors']:
                if cat in data and isinstance(data[cat], dict):
                    for k, v in data[cat].items():
                        DYNAMIC_SYNONYMS[k.upper().strip()] = v.upper().strip()
        log.info(f"✅ Loaded {len(DYNAMIC_SYNONYMS)} total keyword synonyms.")
    except Exception as e:
        log.error(f"🛑 Error loading keywords: {e}")

def tokenize(text: str) -> list:
    """Tokenize and normalize text."""
    clean_text = text.upper()

    # Aliases
    clean_text = re.sub(r'\b(A\.W|AW)\b', 'ASH WHITE', clean_text)
    clean_text = re.sub(r'\b(O\.W|OW)\b', 'OFF WHITE', clean_text)
    clean_text = re.sub(r'\b(W\/S|WS)\b', 'WEATHER SHIELD', clean_text)
    
    # Strip quantity pattern
    clean_text = re.sub(r'\b\d+\s*(GALLON|GLN|DRUM|DRM|QUARTER|QTR|BALTI|PCS|PIECE|KG)\b', ' ', clean_text)

    # Color Typos
    clean_text = re.sub(r'\b(ASHWITE|ASHWT|ASHUT|ASHUL|ASHWHITE|ASHWHT)\b', 'ASH WHITE', clean_text)
    clean_text = re.sub(r'\b(OFFWHT|OFFWITE|OFFWHITE)\b', 'OFF WHITE', clean_text)

    raw_tokens = re.split(r'[^A-Z0-9]', clean_text)
    raw_tokens = [t for t in raw_tokens if t]

    expanded = []
    for t in raw_tokens:
        expanded.append(t)
        # Alphanumeric split
        m = re.match(r'^([A-Z]{2,})(\d{2,})$', t)
        if m:
            expanded.append(m.group(1))
            expanded.append(m.group(2))

    normalized = []
    for t in expanded:
        token = DYNAMIC_SYNONYMS.get(t, t)
        
        # Plural/S stem check
        if len(token) > 3 and token.endswith('S'):
            without_s = token[:-1]
            if (without_s in MAJOR_GROUPS or DYNAMIC_SYNONYMS.get(without_s)):
                token = DYNAMIC_SYNONYMS.get(without_s, without_s)
        
        if token not in STOP_WORDS and len(token) >= 1:
            normalized.append(token)
            
    return normalized


# --- Product Data ---
PRODUCTS = []
CODE_SET = set()
BRAND_SET = set()

def load_products():
    """Legacy json loader fallback."""
    global PRODUCTS, CODE_SET, BRAND_SET
    json_path = os.path.join(os.path.dirname(__file__), 'products.json')
    if not os.path.exists(json_path):
        return

    with open(json_path, 'r') as f:
        data = json.load(f)

    CODE_SET = {p.get('code', '').upper().strip() for p in data if p.get('code')}
    BRAND_SET = {p.get('brand', '').upper().strip() for p in data if p.get('brand')}
    
    PRODUCTS = []
    for p in data:
        brand_upper = p.get('brand', '').upper().strip()
        raw_product = p.get('product', '').strip()
        product_upper = raw_product.upper()
        product_upper = re.sub(r'\b(W\/S|WS)\b', 'WEATHER SHIELD', product_upper)
        product_upper = re.sub(r'\b(W\/B|WB)\b', 'WATER BASE', product_upper)
        
        PRODUCTS.append({
            **p,
            'brandUpper': brand_upper,
            'productUpper': product_upper,
            'fullNameTokenSet': set(p.get('fullName', '').upper().split())
        })
    log.info(f"✅ Loaded {len(PRODUCTS)} products from json.")

async def load_products_from_db():
    """Load products from database items collection and build lookup sets."""
    global PRODUCTS, CODE_SET, BRAND_SET
    db = get_db()
    if db is None:
        return

    try:
        # Fetch brands and units for name lookup
        brands = await db.brands.find({}, {"id": 1, "name": 1}).to_list(None)
        brands_map = {b["id"]: b.get("name", "") for b in brands if "id" in b}

        units = await db.units.find({}, {"id": 1, "name": 1}).to_list(None)
        units_map = {u["id"]: u.get("name", "") for u in units if "id" in u}

        # Fetch active items from db.items
        items = await db.items.find({"status": "Active"}, {"_id": 0}).to_list(None)

        CODE_SET = {it.get("code", "").upper().strip() for it in items if it.get("code")}
        BRAND_SET = {brands_map.get(it.get("brand_id"), "").upper().strip() for it in items if it.get("brand_id")}

        loaded = []
        for it in items:
            raw_name = it.get("name", "").strip()
            name_upper = raw_name.upper()
            name_upper = re.sub(r'\b(W\/S|WS)\b', 'WEATHER SHIELD', name_upper)
            name_upper = re.sub(r'\b(W\/B|WB)\b', 'WATER BASE', name_upper)
            
            # Extract size suffix (-G, -D, -Q, -GX, -DX, -QX, -P)
            m_size = re.search(r'-(DX|GX|QX|D|G|Q|P)$', name_upper)
            size_suffix = m_size.group(1) if m_size else ''

            brand_name = brands_map.get(it.get("brand_id"), "")
            unit_name = units_map.get(it.get("unit_id"), "")

            loaded.append({
                "id": it.get("id"),
                "code": it.get("code", ""),
                "name": raw_name,
                "fullName": raw_name,
                "brand": brand_name,
                "unit": unit_name,
                "size": size_suffix,
                "brandUpper": brand_name.upper().strip(),
                "productUpper": name_upper,
                "fullNameTokenSet": set(name_upper.replace('-', ' ').split()),
                "color": it.get("color", "")
            })

        PRODUCTS = loaded
        log.info(f"✅ Loaded {len(PRODUCTS)} products from db.items.")
    except Exception as e:
        log.error(f"Error loading products from DB: {e}")

KNOWN_COLORS = {'WHITE', 'BLACK', 'GREY', 'GRAY', 'OFF WHITE', 'ASH WHITE', 'RED', 'BLUE', 'GREEN', 'YELLOW', 'BROWN', 'BEIGE', 'CAMEO', 'SILVER', 'GOLD', 'CREAM', 'PINK', 'PURPLE', 'ORANGE', 'ZEPHYR'}

def score_product(product, query_tokens, requested_size=None, raw_query: str = ""):
    """Score product based on tokens, brand, color, code, requested size, and no-token preference."""
    query_brand = None
    query_colors = set()
    for t in query_tokens:
        if t in MAJOR_GROUPS or t in BRAND_SET:
            query_brand = t
        elif t in KNOWN_COLORS:
            query_colors.add(t)

    p_brand = product.get('brandUpper', '')
    p_name = product.get('productUpper', '')
    p_size = product.get('size', '')

    # 1. Enforce strict brand match if query specifies brand
    if query_brand and p_brand and query_brand != p_brand:
        return 0

    # 2. Enforce color match if query specifies color
    if query_colors:
        p_colors = {c for c in KNOWN_COLORS if re.search(r'\b' + c + r'\b', p_name)}
        if p_colors and not p_colors.intersection(query_colors):
            return 0

    # 3. Size conflict check: if requested_size is specified, reject conflicting sizes
    if requested_size:
        req_upper = requested_size.upper().strip()
        if (req_upper.startswith('G') and p_size and not ('G' in p_size)) or \
           (req_upper.startswith('D') and p_size and not ('D' in p_size)) or \
           (req_upper.startswith('Q') and p_size and not ('Q' in p_size)):
            return 0

    # 4. Match tokens
    fn_tokens = product.get('fullNameTokenSet', set())
    p_code = product.get('code', '').upper()
    
    matched_count = 0
    for t in query_tokens:
        if t in fn_tokens or t == p_code:
            matched_count += 1
        elif t.isdigit() and re.search(r'\b[A-Za-z]*' + t + r'\b', p_name):
            matched_count += 1

    if matched_count == 0:
        return 0

    score = (matched_count / len(query_tokens)) * 20

    # Brand match bonus
    if query_brand and p_brand == query_brand:
        score += 25

    # Code / Shade match bonus
    raw_query_clean = ' '.join(query_tokens)
    p_code_clean = p_code.replace('-', ' ')
    if p_code and (p_code in raw_query_clean or p_code_clean == raw_query_clean or p_code.replace('-', '') == raw_query_clean.replace(' ', '')):
        score += 150

    for t in query_tokens:
        if t == p_code:
            score += 50
        elif t.isdigit():
            if re.search(r'\b[A-Za-z]*' + t + r'\b', p_name) or re.search(r'\b' + t + r'\b', p_code):
                score += 50

    # Requested size bonus
    if requested_size:
        req_upper = requested_size.upper().strip()
        if (req_upper.startswith('G') and 'G' in p_size) or \
           (req_upper.startswith('D') and 'D' in p_size) or \
           (req_upper.startswith('Q') and 'Q' in p_size):
            score += 50

    # 5. Strict Token vs No-Token filter
    raw_upper = (raw_query or "").upper()
    is_no_token_query = any(kw in raw_upper for kw in ['BAGHER TOKEN', 'BINA TOKEN', 'WITHOUT TOKEN', 'NO TOKEN', 'WO TOKEN', 'W/O TOKEN', 'TX', 'DX', 'GX'])
    is_no_token_product = p_size.endswith('X') or 'W.O.TOKEN' in p_name or 'TX' in p_name
    
    if is_no_token_query:
        if not is_no_token_product:
            return 0  # User asked for no-token, reject regular token products
        score += 100
    else:
        if is_no_token_product:
            return 0  # User asked for normal order, reject no-token products

    return score


async def search_product(query: str, requested_size: str = None):
    log.info(f"Searching for: {query} (size: {requested_size or 'ANY'})")
    global PRODUCTS
    
    # Auto load from DB if not loaded
    if not PRODUCTS:
        await load_products_from_db()

    # 1. Tokenize
    query_tokens = tokenize(query)
    if not query_tokens:
        return []

    # 2. Score Products
    scored_products = []
    for p in PRODUCTS:
        score = score_product(p, query_tokens, requested_size, raw_query=query)
        if score > 0:
            scored_products.append({**p, 'score': score})

    # 3. Sort by score
    scored_products.sort(key=lambda x: x['score'], reverse=True)
    
    # 4. Check DB for additional matches if low score
    if len(scored_products) < 3:
        db = get_db()
        if db is not None:
            cursor = db.items.find({"status": "Active", "name": {"$regex": re.escape(query), "$options": "i"}}, {"_id": 0})
            db_matches = await cursor.to_list(length=3)
            for m in db_matches:
                if not any(p.get('id') == m.get('id') for p in scored_products):
                    scored_products.append({**m, 'fullName': m.get('name'), 'score': 5})
                
    # Sort again and clean return items
    scored_products.sort(key=lambda x: x['score'], reverse=True)
    
    clean_results = []
    for p in scored_products[:5]:
        clean_results.append({
            "id": p.get("id"),
            "code": p.get("code", ""),
            "name": p.get("name", ""),
            "fullName": p.get("fullName", p.get("name", "")),
            "brand": p.get("brand", ""),
            "unit": p.get("unit", ""),
            "size": p.get("size", ""),
            "color": p.get("color", ""),
            "score": p.get("score", 0)
        })
    return clean_results


async def bulk_verify_products(items: list):
    """Verify multiple product queries at once in a single call."""
    log.info(f"Bulk verifying {len(items)} items")
    results = []
    for item in items:
        if isinstance(item, str):
            query = item
            size = ""
        else:
            query = item.get("nameOrCode") or item.get("query") or ""
            size = item.get("requestedSize") or ""
        
        matches = await search_product(query, requested_size=size)
        results.append({
            "original": query,
            "requestedSize": size,
            "matches": matches
        })
    return results
