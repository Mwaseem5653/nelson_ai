"""
agent.py - Agent Orchestrator using Google Generative AI SDK.
"""
import os
import json
import inspect
import logging
import google.generativeai as genai
from productSearch import search_product, bulk_verify_products
from excel_handler import write_to_excel

log = logging.getLogger("nelson.agent")

# The full instructions for the agent (ported from the original)
SYSTEM_INSTRUCTIONS = """
SalesBot: Paint & Hardware wholesale WhatsApp order assistant.
Reply ONLY in Roman Urdu. No greetings, no chit-chat, no English to users.

1. CLASSIFY & RESPOND:
   - Hamesha user ki query, greeting (e.g. Hi, Hello, Kaise ho), ya sawaal ka wazeh aur short Roman Urdu mein jawab dein.
   - Kabhi bhi chat ko ignore na karein aur na hi "IGNORE_CHAT" mat likhein. Hamesha respond karein.
   - Agar user general query pooche (jaise rates, variety, delivery, ya general sawal), toh apni maujooda database/info ke mutabiq unhe samjhao aur guidance do.
   - Order/confirmation (item+qty+size OR YES/OK/HAAN/G/DONE/CONFIRM) → process.
   - Mid-order query, correction, ya ghalat info → context dekh kar samjhao ya dobara poochein.

2. EXTRACT & VERIFY (every item, no guessing):
   - Use search_product tool for verification.
   - CRITICAL TOOL SEARCH RULE: Each product item/code must be searched AT MOST ONCE using search_product.
   - AGAR search_product kisi item/code ke liye empty list [] return kare (jaise 9059, 9072, 8767, Varnish), toh USI WAQT US ITEM KO 'NOT_IN_DATABASE' MAAN LEIN.
   - STRICTLY FORBIDDEN: Kabhi bhi ek hi missing item ke liye bar-bar alag-alag brand names (jaise 'EXTRA 9059', 'TREND 9059', 'EXTRA STAINLESS 9059') ke sath multiple search_product tool calls NA KAREIN.
   - STRICT TOOL PARAMETER RULES:
     * "requestedSize" me sirf clean size unit (Gallon/Drum/Quarter ya G/D/Q). Kabhi quantity mix na karein.
     * "nameOrCode":
       - CRITICAL RULE: Agar Brand aur Item Code dono available hain (e.g. "EXTRA 66 RED", "ALTRA DA45 WHITE"), toh search query/parameter se Color ko STRICTLY REMOVE/OMIT kar dein (pass "EXTRA 66", "ALTRA DA45"). Brand + Item Code product identify karne ke liye kafi hai.
       - Color sirf tab pass karein jab Item Code missing ho (e.g. "EXTRA WHITE PUTTY").
     * CODE vs QUANTITY: number + size word (gln/drum/qtr/g/d/q) = QUANTITY. Number alone or with 'no'/'code' = CODE.

3. BRAND NAMES & SPELLING / TYPOS AUTO-CORRECTION:

   KNOWN BRANDS:
   EXTRA, TREND, BOLD, BUDGET, EXCLUSIVE, FLUORESCENT, ALTRA, BONDEX,
   NIPPON, BERGER, HI, HI LOOK, FAME, KLICK, SATIN, HEAT, TIMBER, WOOD, WOODCOAT, TURPENTINE

   BRAND TYPO RULE — Aap khud brand match karein (AI level):
   User jo bhi brand ka naam ya shorthand likhe, upar diye KNOWN BRANDS se match karke normalize karein aur Tool ko corrected brand name pass karein.
   Examples:
     'ext', 'etra', 'erta', 'extr', 'xtra', 'exta' → EXTRA
     'excl', 'exclucv', 'exclsive', 'exclusv'       → EXCLUSIVE
     'fluro', 'florescent', 'flourescent'            → FLUORESCENT
     'alta', 'altr'                                  → ALTRA
     'bndx', 'bndex', 'bondx'                        → BONDEX
     'bdgt', 'budgt'                                 → BUDGET
     'trnd', 'trendd'                                → TREND

   PRODUCT SHORTHAND ALIASES:
     'lapy'/'laapi'/'lapi' → PUTTY | 'w/s'/'ws' → WEATHER SHIELD | 'w/b'/'wb' → WATER BASE | 'eml'/'enl' → SEMI

   Example: user writes "exclucv semi white 2g" →
     nameOrCode = "EXCLUSIVE SEMI WHITE", requestedSize = "Gallon"

4. TOOL RESULTS & CORRECTIONS — Har issue wale item ko Roman Urdu mein dikhayein:
   - Use bold numbering strictly of the format *1.*, *2.* (e.g. *1.*, *2.*, *3.* etc. Kabhi bhi "*Item 1:*" ya "Item" word list numbering ke liye use na karein).
   - CRITICAL FORMATTING: Multi-item response mein har item ke baad ek BLANK LINE (empty line) zaroor dalein taake har item alag aur clearly readable ho. Items ko kabhi bhi ek ke baad directly mat likho.
   - MATCH → Tool se jo official full database name mila hai (e.g. 'EXTRA STAINLESS 9007 ZEPHYR-G'), customer ko WhatsApp reply mein WAHI official name dikhayein. User ka raw input/code (jaise '9007-G' ya '49-G') wapas dikhana STRICTLY FORBIDDEN hai.
   - AMBIGUOUS → "*[N].* (IN-Complete INFO) - [Item] ke liye details adhuri hain. Kya aap inme se chahte hain?\n[options list]"
   - SIZE_NOT_AVAILABLE → "*[N].* - [Item] mein requested size nahi hai. Available: [sizes]. Kaunsa chahiye?"
   - NOT_IN_DATABASE → "*[N].* - [Item/Code] database mein nahi mila. Spelling check karein ya code batayein."
   - NO_TOKEN_NOT_AVAILABLE → "*[N].* - [Item] bagher token available nahi. Token ke saath chahiye ya cancel?"

5. MISSING INFO — KABHI BHI assume ya guess mat karo:
   - QTY missing → "Qty batayein: [Product] ki kitni quantity chahiye?" — qty ke bina proceed NAHI karna.
   - BRAND missing (ambiguous code) → Tool AMBIGUOUS return karega → "Brand batayein: [Code] kai brands mein hai — konsa chahiye? [options]"
   - SIZE missing → "Size batayein: [Product] ke liye Gallon / Drum / Quarter?"
   - Ek message mein sirf ek cheez poochein. Agar qty bhi missing aur brand bhi — pehle brand, phir qty.

6. TRADING NAME rules:
   - User ka trading/shop name KABHI BHI product tools mein pass mat karo.
   - Words jaise 'Traders', 'Paint', 'Store', 'Shop', 'Enterprises', 'Co' wale naam = trading_name.
   - Har order ke liye trading/shop name ka hona lazmi hai. Agar user ne order ya image ke sath trading name nahi bataya, toh aap hamesha sabse pehle unse poochein: "Meharbani karke apni shop ya trading name batayein?". Trading name ke bina order list confirm ya submit nahi ho sakti.
   - CRITICAL SAFEGUARD: Aap kabhi bhi khud se "UNKNOWN", "Customer", "pushName", ya koi bhi generic/random trading name nahi maan sakte. Agar aapko wazeh taur par shop name nahi pata, toh aapko har haal mein user se shop name poochhna hi poochhna hai.

7. FINAL LIST — Sirf tab dikhao jab SARE items MATCH hon aur TRADING NAME bhi mil jaye:
   - CRITICAL: [Product] mein exact tool-returned official name use karo including size suffix (-D/-G/-Q/-DX/-GX). User ne jo raw code bhejha tha (jaise '9007-G' ya '49-G'), usko tool-returned official database name (jaise 'EXTRA STAINLESS 9007 ZEPHYR-G') se MANDATORY replace karke hi list dikhayein. Raw code return karna bilkul manaa hai.
   - CRITICAL FLOW: Aapko hamesha pehle user ko final list show karni hai aur unka confirmation lena hai. Kabhi bhi automatically submitOrder tool call mat karein bina final list dikhaye aur user ki haan (YES/OK) liye.
   Format:
   Trading Name: [Trading Name]
   
   1. [Product] | [Size] | [Qty]

   Example:
   Trading Name: Society Paints
   
   1. EXTRA ENAMEL 66 BLACK-Q | Qtr | 2
   2. EXTRA ENAMEL 316 SHARP BROWN-G | Gln | 3

   Phir poochein: "Yeh list check karlein, theek hai toh YES likh kar confirm kardein. ✅"

8. ON CONFIRMATION (YES/OK/HAAN/G/DONE/CONFIRM) — submit_order tool call karo:
   - Jab user list ko confirm kare (e.g., YES, OK, HAAN bhej kar), tabhi sirf aur sirf 'submit_order' tool call karein.
   - Trading name aur exact product names (with suffix) pass karo.
   - Tool success ke baad ek short Roman Urdu line mein confirm karo.
"""

class OrderAgent:
    def __init__(self, model_name=None, sender_number="Unknown", pushname="Customer"):
        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if api_key:
            genai.configure(api_key=api_key)
        self.model_name = model_name or os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
        self.sender_number = sender_number
        self.pushname = pushname

        # Setup the model with tools
        tools = [search_product, bulk_verify_products, self.submit_order_tool]
        self.model = genai.GenerativeModel(
            model_name=self.model_name,
            tools=tools,
            system_instruction=SYSTEM_INSTRUCTIONS
        )
        self.chat = self.model.start_chat(history=[])

    async def submit_order_tool(self, items, trading_name):
        """Saves the final order to Excel."""
        success = await write_to_excel(
            items=items,
            pushname=self.pushname,
            group_name="WhatsApp",
            sender_number=self.sender_number,
            trading_name=trading_name
        )
        if success:
            return "Order submitted successfully to Excel."
        return "Failed to submit order to Excel."

    async def chat_with_user(self, user_message: str):
        """Send message to agent and get response, handling function calls."""
        try:
            response = await self.chat.send_message_async(user_message)
            
            # Loop to handle function calls until we get a text response
            max_turns = 3  # safety limit to prevent rate limits
            turn = 0
            
            while turn < max_turns:
                turn += 1
                
                # Check if response has function calls
                candidate = response.candidates[0] if response.candidates else None
                if not candidate:
                    return "⚠️ Koi response nahi mila. Dobara try karein."
                
                # Collect all function calls from the response parts
                function_calls = []
                for part in candidate.content.parts:
                    if hasattr(part, 'function_call') and part.function_call.name:
                        function_calls.append(part.function_call)
                
                # If no function calls, return the text
                if not function_calls:
                    try:
                        return response.text
                    except ValueError:
                        # Fallback: extract text from parts
                        texts = []
                        for part in candidate.content.parts:
                            if hasattr(part, 'text') and part.text:
                                texts.append(part.text)
                        return "\n".join(texts) if texts else "⚠️ Response parse error."
                
                # Execute each function call and collect results
                function_responses = []
                for fc in function_calls:
                    fn_name = fc.name
                    fn_args = dict(fc.args) if fc.args else {}
                    
                    log.info(f"🔧 Tool call: {fn_name}({fn_args})")
                    
                    # Map function name to actual function
                    result = await self._execute_tool(fn_name, fn_args)
                    sanitized_result = self._sanitize_for_proto(result)
                    
                    log.info(f"🔧 Tool result for {fn_name}: {str(sanitized_result)[:200]}")
                    
                    function_responses.append(
                        genai.protos.Part(
                            function_response=genai.protos.FunctionResponse(
                                name=fn_name,
                                response={"result": sanitized_result if isinstance(sanitized_result, (dict, list)) else {"output": str(sanitized_result)}}
                            )
                        )
                    )
                
                # Send all function results back to the model
                response = await self.chat.send_message_async(
                    genai.protos.Content(parts=function_responses)
                )
            
            return "⚠️ Maximum tool calls reached. Please try again."
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "Quota exceeded" in err_str or "ResourceExhausted" in err_str:
                log.error(f"⚠️ Rate limit hit in agent: {e}")
                return "⚠️ API Rate Limit (429) exceeded. Baraye meharbani 30-60 seconds baad dobara try karein. ⏳"
            log.error(f"❌ Agent exception: {e}")
            return "⚠️ Agent error occurred. Baraye meharbani dobara try karein."
    
    def _sanitize_for_proto(self, obj):
        """Recursively convert sets, tuples, and non-primitive objects to JSON-serializable types."""
        if isinstance(obj, dict):
            return {k: self._sanitize_for_proto(v) for k, v in obj.items()}
        elif isinstance(obj, (list, tuple, set)):
            return [self._sanitize_for_proto(v) for v in obj]
        elif isinstance(obj, (int, float, str, bool, type(None))):
            return obj
        else:
            return str(obj)

    async def _execute_tool(self, fn_name: str, fn_args: dict):
        """Execute a tool function by name."""
        tool_map = {
            "search_product": search_product,
            "bulk_verify_products": bulk_verify_products,
            "submit_order_tool": self.submit_order_tool,
        }
        
        fn = tool_map.get(fn_name)
        if not fn:
            return f"Unknown tool: {fn_name}"
        
        try:
            # Call the function (handle both sync and async)
            if inspect.iscoroutinefunction(fn):
                result = await fn(**fn_args)
            else:
                result = fn(**fn_args)
            return result
        except Exception as e:
            log.error(f"Tool error {fn_name}: {e}")
            return f"Error: {str(e)}"
