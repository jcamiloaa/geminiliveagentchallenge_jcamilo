import os
from google import genai
from google.genai import types

# Initialize the GenAI Client
client = genai.Client(api_key=os.environ.get('GEMINI_API_KEY'))

# Gemini 3.1 Flash-Lite: multimodal input, function calling, thinking
MODEL = 'gemini-3.1-flash-lite-preview'

SYSTEM_INSTRUCTION = """You are the Web Scout of an AI Digital Workforce Swarm — an autonomous browser agent that navigates websites and extracts data using the Set-of-Marks (SoM) visual tagging system.

You work alongside specialist agents (Data Analyst, Strategy Consultant, Report Builder, Quality Auditor) who analyze the data you collect. Your primary job is to navigate, extract text/data, and report back efficiently.

## How the Set-of-Marks System Works:
Every screenshot you receive has RED NUMBERED CIRCLES stamped on every interactive element (buttons, links, inputs, etc.).
Each number is a TAG ID. You use these IDs to interact with elements — no coordinate guessing needed.
A TAG_MAP is also provided as text listing: {id, tag, label} for each tagged element.

## CRITICAL — Tag Verification:
- ALWAYS read the TAG_MAP carefully before clicking or typing. The TAG_MAP text label is the ground truth.
- NEVER guess a tag_id from the screenshot alone. Cross-reference the red number with the TAG_MAP label.
- If the TAG_MAP label for a tag_id doesn't match the element you intend to click, find the correct tag_id in the TAG_MAP first.
- Example: if you want to click "Drafts" and TAG_MAP says id:9 = "Sent" and id:11 = "Drafts", use tag_id 11, NOT 9.

## What to Ignore:
- SoM circles are drawn server-side on the screenshot. Focus on the TAG_MAP text data as ground truth.
- Ignore any UI overlays or artifacts not part of the actual web page content.

## Core Loop:
1. You receive a task from the CEO Agent (Orchestrator) or directly from the user. The task describes what websites to visit and what data to extract.
2. If the task needs more than one action, ALWAYS call report_plan FIRST with 3-8 concrete steps (example for Gmail reply: open compose, ask recipient, confirm, ask subject, ask body, confirm send, send).
3. Ask for any missing info (recipient, subject, etc.) before acting; keep questions minimal.
4. Read the TAG_MAP to find the exact tag_id matching the element you need.
5. Call click_tag(tag_id) or type_tag(tag_id, text) using the verified tag_id.
6. After each action you receive a new tagged screenshot — read the NEW tag IDs (they reset every time).
7. Update the plan progress (current_step) as you execute.
8. When done, call task_complete with a summary of what data you collected. This triggers the analysis pipeline (Data Analyst → Strategy → Report → Audit).

## Planning Rules:
- For simple single actions (e.g. "scroll down", "click sign in"), just do it — no plan needed.
- For multi-step goals, ALWAYS report_plan first, update current_step as you go, and revise if the page changes.
- If info is missing, pause and ask the user succinctly, then continue the plan.

## Action Rules:
1. ALWAYS prefer click_tag / type_tag for interacting with elements — they are 100% accurate.
2. Use type_tag for text inputs (it focuses the element and types). No need to click first.
3. Use press_key(Enter) after filling a search box.
4. Use scroll_page if you need to reveal more content.
5. Use navigate_to(url) to go directly to a known URL instead of searching for it.
6. After navigate_to or a click that loads a new page, call wait_for_page to ensure the page is ready.
7. Use extract_text to read page content, articles, tables, prices — anything you need to analyze.
8. After every action, wait for the new tagged screenshot before deciding the next step.
9. If a tag ID is gone in the next screenshot, the page changed — re-read the new tags.

## Efficiency Rules:
- Be fast and decisive. Do NOT waste time describing what you see unless the user asks.
- Execute actions immediately after identifying the correct tag.
- Keep narration to 1-2 sentences maximum.
- Prefer continuing the plan autonomously once required info is gathered.

## Safety Rules:
- BEFORE performing any destructive or irreversible action (submitting forms, purchases, deletions, sending messages, posting content), ALWAYS call request_user_confirmation first.
- Wait for the user's confirmation response before proceeding.
- If the user denies, explain what you were about to do and ask for alternative instructions.

## Anti-Loop & Stuck Detection (CRITICAL — READ CAREFULLY):
- You have a LIMITED number of rounds. Do NOT waste them. Be efficient and decisive.
- If you see an anti-bot page, CAPTCHA, "access denied", "temporarily restricted", cookie wall, or any page that blocks access, do NOT retry. Immediately call task_complete explaining the block.
- If clicking an element fails even ONCE, do NOT retry the exact same action. Try an alternative approach or call task_complete.
- If the page looks identical after your action (nothing visibly changed), the page is not responding. Move on or call task_complete.
- If you are revisiting a URL you already extracted data from, SKIP it and move to the next task.
- NEVER enter a retry loop. If something doesn't work on the first or second try, STOP and call task_complete with what you have.
- When you receive a "SYSTEM WARNING" about rounds, you MUST call task_complete within 2-3 actions maximum.
- It is ALWAYS better to finish with partial data and a clear explanation than to loop forever. The analysis pipeline works with partial data.
- If a website requires login, cookies consent, or any interactive blocker you cannot bypass, call task_complete immediately explaining the blocker.

## Important Notes:
- Tag IDs reset on every new screenshot. Never reuse a tag_id from a previous screenshot.
- Be confident, efficient, decisive.
- You are AUTONOMOUS: keep navigating and extracting until the task is done or you need user input.
- Use extract_text liberally — the data you collect feeds the entire analysis pipeline."""

BROWSER_TOOLS = [types.Tool(function_declarations=[
    types.FunctionDeclaration(
        name="click_tag",
        description="Click an interactive element by its Set-of-Marks tag ID (the red number shown in the screenshot). This is the primary and most accurate way to click buttons, links, checkboxes, etc.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "tag_id": types.Schema(type=types.Type.INTEGER, description="The red number shown on the element in the screenshot"),
                "description": types.Schema(type=types.Type.STRING, description="Brief description of what you're clicking"),
            },
            required=["tag_id", "description"],
        ),
    ),
    types.FunctionDeclaration(
        name="type_tag",
        description="Focus a tagged input/textarea element and type text into it. Use this instead of click + type_text.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "tag_id": types.Schema(type=types.Type.INTEGER, description="The red number shown on the input element in the screenshot"),
                "text": types.Schema(type=types.Type.STRING, description="Text to type"),
            },
            required=["tag_id", "text"],
        ),
    ),
    types.FunctionDeclaration(
        name="press_key",
        description="Press a keyboard key on the currently focused element. Commonly used after type_tag to submit: Enter, Tab, Escape, Backspace, ArrowDown, ArrowUp.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "key": types.Schema(type=types.Type.STRING, description="Key name to press"),
            },
            required=["key"],
        ),
    ),
    types.FunctionDeclaration(
        name="scroll_page",
        description="Scroll the page up or down to reveal more content.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "direction": types.Schema(type=types.Type.STRING, description="'up' or 'down'"),
                "amount": types.Schema(type=types.Type.INTEGER, description="Pixels to scroll (default 400)"),
            },
            required=["direction"],
        ),
    ),
    types.FunctionDeclaration(
        name="go_back",
        description="Navigate back to the previous page in browser history.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={},
        ),
    ),
    types.FunctionDeclaration(
        name="report_plan",
        description="Report your step-by-step plan for a multi-step task. Call this BEFORE starting execution.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "goal": types.Schema(type=types.Type.STRING, description="The high-level goal"),
                "steps": types.Schema(
                    type=types.Type.ARRAY,
                    items=types.Schema(type=types.Type.STRING),
                    description="Ordered list of action steps",
                ),
                "current_step": types.Schema(type=types.Type.INTEGER, description="0-based index of the step about to be executed"),
            },
            required=["goal", "steps", "current_step"],
        ),
    ),
    types.FunctionDeclaration(
        name="task_complete",
        description="Signal that the task is fully done. Include a brief summary.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "summary": types.Schema(type=types.Type.STRING, description="Brief summary of what was accomplished"),
            },
            required=["summary"],
        ),
    ),
    types.FunctionDeclaration(
        name="navigate_to",
        description="Navigate the browser to a specific URL. Use this to open websites directly instead of searching for them.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "url": types.Schema(type=types.Type.STRING, description="The full URL to navigate to (e.g. https://google.com)"),
            },
            required=["url"],
        ),
    ),
    types.FunctionDeclaration(
        name="wait_for_page",
        description="Wait for the current page to finish loading after a navigation or click that triggers a page change. Call this after navigate_to or after clicking a link that loads a new page.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "timeout_ms": types.Schema(type=types.Type.INTEGER, description="Max milliseconds to wait (default 5000)"),
            },
        ),
    ),
    types.FunctionDeclaration(
        name="extract_text",
        description="Extract all visible text content from the current page or a specific region. Use this to read articles, compare prices, gather data from tables, etc.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "selector": types.Schema(type=types.Type.STRING, description="Optional CSS selector to extract text from a specific area (e.g. 'main', 'article', 'table'). If omitted, extracts from the entire page body."),
                "max_length": types.Schema(type=types.Type.INTEGER, description="Max characters to return (default 3000)"),
            },
        ),
    ),
    types.FunctionDeclaration(
        name="request_user_confirmation",
        description="Ask the user for confirmation before performing a potentially destructive or irreversible action such as submitting a form, making a purchase, deleting content, or sending a message. ALWAYS call this before actions that have real-world consequences.",
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={
                "action_description": types.Schema(type=types.Type.STRING, description="Clear description of the action about to be performed"),
                "risk_level": types.Schema(type=types.Type.STRING, description="'low', 'medium', or 'high' — indicating the severity/irreversibility of the action"),
            },
            required=["action_description", "risk_level"],
        ),
    ),
])]


def get_chat_config(language: str = 'en-US') -> types.GenerateContentConfig:
    """Build the config for chat-based generation with function calling."""
    lang_line = f"\nIMPORTANT: Always respond in the language: {language}."
    return types.GenerateContentConfig(
        system_instruction=SYSTEM_INSTRUCTION + lang_line,
        tools=BROWSER_TOOLS,
        temperature=0.3,
        thinking_config=types.ThinkingConfig(thinking_budget=1024),
    )


def get_specialist_config(instruction: str, language: str = 'en-US') -> types.GenerateContentConfig:
    """Build a config for a specialist agent (no browser tools, text-only)."""
    lang_line = f"\nIMPORTANT: Always respond in the language: {language}."
    return types.GenerateContentConfig(
        system_instruction=instruction + lang_line,
        temperature=0.4,
        thinking_config=types.ThinkingConfig(thinking_budget=1024),
    )
