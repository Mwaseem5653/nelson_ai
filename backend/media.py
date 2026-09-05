"""
media.py - Unified handler for WhatsApp media (images, voice).
"""
import os
import asyncio
import logging
import google.generativeai as genai
from PIL import Image

log = logging.getLogger("nelson.media")

# Define the robust extraction prompt
IMAGE_EXTRACTION_PROMPT = """
This image contains a handwritten order slip from a Paint & Hardware wholesale shop.

MANDATORY ITEM EXTRACTION RULE:
- Every image sent is an order slip containing product items. You MUST extract all order items and products visible in the image into the "items" array.
- NEVER return only the trading_name without items. Extracting all order items and products is your primary mandatory requirement.

CRITICAL LAYOUT & QUANTITY EXTRACTION RULES:

1. INDEPENDENT COLUMN SEGREGATION:
- The sheet has multiple columns (e.g. 3 or 4 columns). Analyze each column completely independently.
- Headers are underlined (e.g. "xtra semi", "Xtra putt", "oil primer xtra", "bold putt", "bold water prim", "oil primer bold", "enamel xtra", "Stanles xtra", "9986", "9962", "9973", "51", "230", "66", "303", "301").
- DO NOT mix products from different columns. 

2. POSITION-BASED SLASH NOTATION (G / Q / D):
- Quantities are often written in positional slash notation: [Gallons] / [Quarters] / [Drums].
- This strictly maps to sizes in this exact order: Gallon / Quarter / Drum.
- Zero-quantity placeholders: Positions filled with a cursive loop/alpha symbol (α), cross (x), dot (.), dash (-), or left blank represent zero (0) quantity. Do NOT extract zero-quantity items.
- Examples:
  * "4 / α / α" under "9986" -> {"product": "9986", "size": "Gallon", "quantity": 4}
  * "20 / α / α" under "9973" -> {"product": "9973", "size": "Gallon", "quantity": 20}
  * "α / 4 / α" under "303" -> {"product": "303", "size": "Quarter", "quantity": 4}
  * "α / 2 / α" under "301" -> {"product": "301", "size": "Quarter", "quantity": 2}
  * "α / 6 / α" under "66" -> {"product": "66", "size": "Quarter", "quantity": 6}

3. STRICT CODE vs QUANTITY RULE (EXPLICIT SIZE LABELS):
- If a line starts with a code number, a slash, and then a quantity number with an explicit size label (e.g., "37/ 2 Qtr" or "66/ 4 Gln" or "51/ 2 Qtr" or "44/ 2 Gln"):
  * The first number is the **Product Code** (do NOT parse it as a quantity!).
  * The second number is the **Quantity** (e.g., 2, 4, 2, 2).
  * Examples:
    - "37/ 2 Qtr" under "xtra semi" -> {"product": "extra semi 37", "size": "Quarter", "quantity": 2}
    - "66/ 4 Gln" -> {"product": "extra enamel 66", "size": "Gallon", "quantity": 4}

4. GENERIC SHORTHAND SEPARATORS (NO CODES):
- Putty (e.g., "Xtra putt", "bold putt") and Primers (e.g., "oil primer bold", "bold water prim") DO NOT use numeric codes!
- For Putty and Primers, any numbers (like 10, 5, 4, 2) are ONLY quantities, NEVER product codes.
  * Example: "10/ 2tr" under "Xtra putt" means: 10 Gallons and 2 Quarters of "Extra Putty" (no code "10" or "2" exists).
  * "10/ Gln" under "Xtra putt" -> 10 Gallons.
  * "4/ 2tr" under "bold water prim" -> 4 Gallons and 2 Quarters.
- Shorthand units: "tr", "qtr", "q", "2tr", "2t" mean "Quarter". "Gln" means "Gallon". "Drm" means "Drum".

5. HANDWRITING TYPOS & SYNONYMS:
- "off wht" or "% wht" or "% mll" -> "Off White"
- "Ashwt" or "Ashut" or "Ashul" -> "Ash White"
- "putt" -> "Putty"
- "w"    -> "White"
- "xtra" or "xts" or "xto" -> "Extra"
- "enamel" or "ennamel" or "enamml" -> "Enamel"
- "Stanles" or "Stanl" -> "Stainless"
- "W/S" -> "Weather Shield"

6. TRADING NAME / SHOP NAME:
- Check for shop/customer name written at the top (e.g. "society Paint PECHS", "Nadeem colle"). Extract it as trading_name if present.

Extract ALL order items into the JSON schema "items" array. Split shorthand entries into separate items (one item per size). Do not omit any items.
"""

class MediaHandler:
    def __init__(self, model_name=None):
        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if api_key:
            genai.configure(api_key=api_key)
        self.model_name = model_name or os.environ.get("GEMINI_MODEL", "gemini-1.5-flash")
        self.model = genai.GenerativeModel(self.model_name)

    async def process_image(self, file_path, mime_type=None):
        """Processes image using Gemini OCR."""
        try:
            log.info(f"Processing image: {file_path}")
            
            # Load and resize image for faster transmission if large
            img = Image.open(file_path)
            if img.mode != 'RGB':
                img = img.convert('RGB')
            
            # Resize down to max 1280px while maintaining aspect ratio
            max_dim = 1280
            if max(img.size) > max_dim:
                img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
            
            # Call Gemini in a thread pool to avoid blocking asyncio loop
            response = await asyncio.to_thread(
                self.model.generate_content,
                [IMAGE_EXTRACTION_PROMPT, img]
            )
            
            return response.text
            
        except Exception as e:
            log.error(f"Image processing error: {e}")
            return "Error processing image."

    async def process_voice(self, file_path, mime_type="audio/ogg"):
        """Processes voice note using Gemini."""
        try:
            log.info(f"Processing voice: {file_path}")
            if not os.path.exists(file_path):
                return "Voice file not found."
            
            audio_file = genai.upload_file(file_path, mime_type=mime_type or "audio/ogg")
            response = self.model.generate_content([
                "Transcribe this voice order note completely. Extract shop/trading name, product items, quantities, and sizes in Roman Urdu:",
                audio_file
            ])
            return response.text
        except Exception as e:
            log.error(f"Voice processing error: {e}")
            return f"Voice processing error: {e}"
