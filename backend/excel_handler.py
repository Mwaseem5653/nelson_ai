"""
excel_handler.py - Handles saving orders to Excel.
"""
import os
import logging
from datetime import datetime
import pandas as pd
from openpyxl import load_workbook, Workbook

log = logging.getLogger("nelson.excel")
EXCEL_FILE = "orders.xlsx"

async def write_to_excel(items, pushname, group_name, sender_number, trading_name):
    """Saves order items to Excel file."""
    try:
        data = []
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        for item in items:
            if isinstance(item, str):
                prod_name = item
                unit_val = ""
                qty_val = 1
                is_ntf = False
            else:
                prod_name = (
                    item.get('product') or
                    item.get('name') or
                    item.get('product_name') or
                    item.get('fullName') or
                    item.get('item') or
                    ""
                )
                unit_val = item.get('unit') or item.get('size') or item.get('product_size') or ""
                qty_val = item.get('quantity') or item.get('qty') or 1
                is_ntf = item.get('is_ntf', False)
            
            data.append({
                'Date': now,
                'Customer Name': pushname or "Customer",
                'Phone Number': sender_number or "Unknown",
                'Trading Name': trading_name or "",
                'Product Name': prod_name,
                'Quantity (Pcs)': qty_val,
                'Unit': unit_val
            })
            
        df_new = pd.DataFrame(data)
        
        if os.path.exists(EXCEL_FILE):
            try:
                df_existing = pd.read_excel(EXCEL_FILE)
                df_final = pd.concat([df_existing, df_new], ignore_index=True)
            except Exception as read_err:
                log.warning(f"Could not read existing Excel file: {read_err}, creating new.")
                df_final = df_new
        else:
            df_final = df_new
            
        df_final.to_excel(EXCEL_FILE, index=False)
        log.info(f"✅ Saved {len(items)} items to Excel for {pushname} ({trading_name})")
        return True
    except Exception as e:
        log.error(f"❌ Excel saving error: {e}")
        return False
