"""AI Digital Workforce Swarm - ADK (Agent Development Kit) wrapper.

Defines the agent using Google's ADK framework. The WebSocket session in main.py
uses the GenAI SDK for streaming. The ADK agent provides
the canonical agent definition and metadata for introspection.
"""
import os
from google.adk import Agent
from google.adk.tools import FunctionTool
from google.genai import types

MODEL = 'models/gemini-3.1-flash-lite-preview'


# --- Tool function stubs (executed browser-side, resolved via function_call/response) ---
# ADK requires Python callables. These are placeholders — real execution happens in the browser.

def click_tag(tag_id: int, description: str) -> dict:
    """Click an interactive element by its Set-of-Marks tag ID (the red number in the screenshot)."""
    return {"status": "pending_browser_execution", "tool": "click_tag", "tag_id": tag_id}


def type_tag(tag_id: int, text: str) -> dict:
    """Focus a tagged input element and type text into it."""
    return {"status": "pending_browser_execution", "tool": "type_tag", "tag_id": tag_id}


def press_key(key: str) -> dict:
    """Press a keyboard key on the currently focused element."""
    return {"status": "pending_browser_execution", "tool": "press_key", "key": key}


def scroll_page(direction: str, amount: int = 400) -> dict:
    """Scroll the page up or down to reveal more content."""
    return {"status": "pending_browser_execution", "tool": "scroll_page", "direction": direction}


def go_back() -> dict:
    """Navigate back to the previous page in browser history."""
    return {"status": "pending_browser_execution", "tool": "go_back"}


def navigate_to(url: str) -> dict:
    """Navigate the browser to a specific URL."""
    return {"status": "pending_browser_execution", "tool": "navigate_to", "url": url}


def wait_for_page(timeout_ms: int = 5000) -> dict:
    """Wait for the current page to finish loading after navigation."""
    return {"status": "pending_browser_execution", "tool": "wait_for_page"}


def extract_text(selector: str = "", max_length: int = 3000) -> dict:
    """Extract visible text content from the current page or a specific CSS selector region."""
    return {"status": "pending_browser_execution", "tool": "extract_text"}


def report_plan(goal: str, steps: list[str], current_step: int = 0) -> dict:
    """Report a step-by-step plan for a multi-step task."""
    return {"status": "plan_reported", "goal": goal, "steps": steps}


def task_complete(summary: str) -> dict:
    """Signal that the task is fully done."""
    return {"status": "completed", "summary": summary}


def request_user_confirmation(action_description: str, risk_level: str = "medium") -> dict:
    """Ask user for confirmation before a destructive or irreversible action."""
    return {"status": "pending_user_confirmation", "action": action_description}


# --- System instruction ---
SYSTEM_INSTRUCTION = """You are the Web Scout of an AI Digital Workforce Swarm — an autonomous browser agent
that navigates websites and extracts data using the Set-of-Marks (SoM) visual tagging system.

You work alongside specialist agents (Data Analyst, Strategy Consultant, Report Builder, Quality Auditor)
who analyze the data you collect. Your job is to navigate, extract, and report back.

Every screenshot has RED NUMBERED CIRCLES on interactive elements. Use tag IDs to interact.
For multi-step tasks, call report_plan first. Use click_tag/type_tag for elements, navigate_to for URLs,
extract_text for reading content. Always call request_user_confirmation before destructive actions.
When done, call task_complete with a summary."""

# --- ADK Agent definition ---
aero_navigator_agent = Agent(
    model=MODEL,
    name="AI_Workforce_Swarm",
    description="AI Digital Workforce Swarm — multiple specialized agents collaborate through a single browser tab to perform complex research, analysis, and reporting tasks.",
    instruction=SYSTEM_INSTRUCTION,
    tools=[
        click_tag,
        type_tag,
        press_key,
        scroll_page,
        go_back,
        navigate_to,
        wait_for_page,
        extract_text,
        report_plan,
        task_complete,
        request_user_confirmation,
    ],
)
