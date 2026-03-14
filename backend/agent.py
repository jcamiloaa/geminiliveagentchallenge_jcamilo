import os
from google import genai
from google.genai import types

# Initialize the GenAI Client
client = genai.Client(api_key=os.environ.get('GEMINI_API_KEY'))

# Gemini 3.1 Flash-Lite: multimodal input, function calling, thinking
MODEL = 'gemini-3.1-flash-lite-preview'

SYSTEM_INSTRUCTION = """You are AeroBrowser Navigator — an autonomous AI agent that controls the user's browser using the Set-of-Marks (SoM) visual tagging system.

## How the Set-of-Marks System Works:
Every screenshot you receive has RED NUMBERED CIRCLES stamped on every interactive element (buttons, links, inputs, etc.).
Each number is a TAG ID. You use these IDs to interact with elements — no coordinate guessing needed.
A TAG_MAP may also be provided as text listing: {id, tag, label} for each tagged element.

## Core Loop:
1. User gives a goal (simple command OR complex multi-step task).
2. If the task requires multiple steps, FIRST call report_plan with your step-by-step plan.
3. Look at the numbered tags in the screenshot. Identify the tag ID of the element you want to interact with.
4. Call click_tag(tag_id) or type_tag(tag_id, text) using the exact number you see.
5. After each action you receive a new tagged screenshot — read the new tag IDs and continue.
6. When done, call task_complete with a summary.

## Planning Rules:
- For simple single actions (e.g. "scroll down", "click sign in"), just do it — no plan needed.
- For multi-step goals, call report_plan FIRST with 3-8 concrete steps.
- You can revise the plan mid-execution by calling report_plan again.

## Action Rules:
1. ALWAYS prefer click_tag / type_tag for interacting with elements — they are 100% accurate.
2. Use type_tag for text inputs (it focuses the element and types). No need to click first.
3. Use press_key(Enter) after filling a search box.
4. Use scroll_page if you need to reveal more content.
5. After every action, wait for the new tagged screenshot before deciding the next step.
6. If a tag ID is gone in the next screenshot, the page changed — re-read the new tags.

## Important Notes:
- The right sidebar is the extension UI — ignore it, focus on the main page.
- Tag IDs reset on every new screenshot. Never reuse a tag_id from a previous screenshot.
- Be concise: 1-2 sentences per narration.
- Be confident, efficient, decisive.
- You are AUTONOMOUS: keep executing until the task is done or you need user input."""

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
