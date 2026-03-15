"""
AI Digital Workforce Swarm — FastAPI Backend.

Architecture: Web App ↔ WebSocket ↔ FastAPI + Playwright + Gemini Swarm.
The browser runs server-side via Playwright. Screenshots are streamed to the
web app as base64 JPEG frames with SoM overlay. Gemini controls the browser
through function calls (click_tag, type_tag, etc.) executed by Playwright.
"""
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import uvicorn
import asyncio
import json
import base64
import traceback
import os

import agent
import cloud_logging
from browser import BrowserSession
from som import draw_som_overlay
from swarm import SwarmSession, AgentRole
from google.genai import types

app = FastAPI(title="AI Digital Workforce Swarm")

# Initialize structured Cloud Logging
cloud_logging.setup()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve the React frontend (built static files)
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(FRONTEND_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIR, "assets")), name="assets")

    @app.get("/")
    async def serve_index():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

    @app.get("/manifest.json")
    async def serve_manifest():
        return FileResponse(os.path.join(FRONTEND_DIR, "manifest.json"))

    @app.get("/sw.js")
    async def serve_sw():
        return FileResponse(os.path.join(FRONTEND_DIR, "sw.js"), media_type="application/javascript")


def log_event(session_id: str, event_type: str, **fields):
    payload = {
        "severity": "INFO",
        "source": "swarm_backend",
        "event_type": event_type,
        "session_id": session_id,
        **fields,
    }
    print(json.dumps(payload, ensure_ascii=False), flush=True)


@app.get("/health")
async def health():
    return {"status": "ok", "model": agent.MODEL}


@app.get("/api/agent-info")
async def agent_info():
    """Return ADK agent metadata for introspection."""
    try:
        from adk_agent import aero_navigator_agent
        return {
            "name": aero_navigator_agent.name,
            "description": aero_navigator_agent.description,
            "model": aero_navigator_agent.model,
            "tools": [t.__name__ if hasattr(t, '__name__') else str(t) for t in aero_navigator_agent.tools],
            "framework": "Google ADK (Agent Development Kit)",
        }
    except Exception as e:
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# Core helpers
# ---------------------------------------------------------------------------

async def _take_tagged_screenshot(browser: BrowserSession) -> tuple[str, list[dict]]:
    """Take screenshot, generate tag map, draw SoM overlay, return (b64, tag_map)."""
    tag_map = await browser.generate_tag_map()
    raw_bytes = await browser.page.screenshot(type="jpeg", quality=80, full_page=False)
    annotated_bytes = draw_som_overlay(raw_bytes, tag_map)
    b64 = base64.b64encode(annotated_bytes).decode("ascii")
    browser.set_tag_map(tag_map)
    return b64, tag_map


def _build_vision_parts(screenshot_b64: str, tag_map: list[dict]) -> list:
    """Build Gemini multimodal Parts from a screenshot + tag map."""
    img_bytes = base64.b64decode(screenshot_b64)
    return [
        types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"),
        types.Part.from_text(text=f"TAG_MAP: {json.dumps(tag_map)}"),
    ]


async def _execute_tool(browser: BrowserSession, name: str, args: dict) -> dict:
    """Execute a browser tool call via Playwright and return the result."""
    if name == "click_tag":
        return await browser.click_tag(args.get("tag_id", 0), args.get("description", ""))
    elif name == "type_tag":
        return await browser.type_tag(args.get("tag_id", 0), args.get("text", ""))
    elif name == "press_key":
        return await browser.press_key(args.get("key", ""))
    elif name == "scroll_page":
        return await browser.scroll_page(args.get("direction", "down"), args.get("amount", 400))
    elif name == "go_back":
        return await browser.go_back()
    elif name == "navigate_to":
        return await browser.navigate_to(args.get("url", ""))
    elif name == "wait_for_page":
        return await browser.wait_for_page(args.get("timeout_ms", 5000))
    elif name == "extract_text":
        return await browser.extract_text(args.get("selector", ""), args.get("max_length", 3000))
    else:
        return {"success": True}


SCREENSHOT_TOOLS = {"click_tag", "type_tag", "press_key", "scroll_page", "go_back", "navigate_to", "wait_for_page"}
META_TOOLS = {"report_plan", "task_complete", "request_user_confirmation"}


# ---------------------------------------------------------------------------
# Main WebSocket endpoint
# ---------------------------------------------------------------------------

@app.websocket("/ws/swarm")
async def swarm_ws(websocket: WebSocket):
    """
    Single WebSocket for the swarm web app.
    Flow:
      1. Client connects → backend launches Playwright browser
      2. User sends a goal → Orchestrator decomposes it
      3. Web Scout navigates via Playwright (screenshots streamed to client)
      4. Specialist agents analyze in parallel
      5. Final report sent to client
    """
    await websocket.accept()
    language = websocket.query_params.get("language", "en-US")
    session_id = websocket.query_params.get("session_id", "swarm-session")
    log_event(session_id, "websocket_connected", language=language)

    browser = BrowserSession()
    await browser.start()
    await browser.navigate_to("about:blank")

    config = agent.get_chat_config(language)
    chat = agent.client.aio.chats.create(model=agent.MODEL, config=config)
    swarm = SwarmSession(language, websocket.send_json)

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            msg_type = data.get("type", "")

            if msg_type == "text":
                user_goal = data["text"]
                log_event(session_id, "user_message", text_preview=user_goal[:160])

                await swarm.send_agent_status()
                plan = await swarm.run_orchestrator(user_goal)

                if plan and plan.get("web_tasks"):
                    web_steps = [t.get("objective", "") for t in plan.get("web_tasks", [])]
                    analysis_steps = [
                        "📊 Analyze collected data",
                        "🧠 Synthesize strategic insights",
                        "📝 Build final report",
                        "🔎 Quality audit",
                    ]
                    all_steps = web_steps + analysis_steps
                    await websocket.send_json({
                        "type": "plan",
                        "goal": plan.get("goal", user_goal),
                        "steps": all_steps,
                        "current_step": 0,
                    })
                    swarm.set_plan_tracking(all_steps, plan.get("goal", user_goal), len(web_steps))
                    scout_prompt = swarm.build_scout_prompt(plan)
                else:
                    scout_prompt = user_goal

                await swarm.emit(AgentRole.WEB_SCOUT, "thinking", "Starting browser navigation...")
                ss_b64, tag_map = await _take_tagged_screenshot(browser)
                await websocket.send_json({
                    "type": "screenshot",
                    "data": ss_b64,
                    "tag_map": tag_map,
                    "url": browser.page.url,
                })

                parts = _build_vision_parts(ss_b64, tag_map)
                parts.append(types.Part.from_text(text=scout_prompt))
                await _navigation_loop(browser, chat, swarm, websocket, parts, session_id)

            elif msg_type == "user_confirmation":
                confirmed = data.get("confirmed", False)
                fn_resp = types.Part.from_function_response(
                    name="request_user_confirmation",
                    response={"confirmed": confirmed},
                )
                ss_b64, tag_map = await _take_tagged_screenshot(browser)
                parts = _build_vision_parts(ss_b64, tag_map)
                parts.append(fn_resp)
                await _navigation_loop(browser, chat, swarm, websocket, parts, session_id)

            elif msg_type == "reset":
                log_event(session_id, "session_reset")
                await browser.stop()
                browser = BrowserSession()
                await browser.start()
                await browser.navigate_to("about:blank")
                chat = agent.client.aio.chats.create(model=agent.MODEL, config=config)
                swarm = SwarmSession(language, websocket.send_json)
                await websocket.send_json({"type": "reset_complete"})

    except WebSocketDisconnect:
        log_event(session_id, "websocket_disconnected")
    except Exception as e:
        log_event(session_id, "backend_exception", error=str(e))
        traceback.print_exc()
        try:
            await websocket.close(code=1011, reason=str(e)[:120])
        except Exception:
            pass
    finally:
        await browser.stop()


async def _navigation_loop(
    browser: BrowserSession,
    chat,
    swarm: SwarmSession,
    websocket: WebSocket,
    initial_parts: list,
    session_id: str,
):
    """
    Autonomous loop: send parts to Gemini → execute tool calls → screenshot → repeat.
    Exits on task_complete, no tool calls, safety limit, or stuck detection.
    """
    parts = initial_parts
    max_rounds = 30

    # --- Stuck / loop detection state ---
    _url_visits: dict[str, int] = {}       # url → navigation count (only real transitions)
    _last_seen_url: str | None = None      # track last URL to distinguish navigations from scrolls
    _consecutive_errors = 0                 # sequential tool-call failures
    _last_screenshot_hash: str | None = None
    _same_screenshot_count = 0             # sequential identical screenshots
    _rounds_since_new_artifact = 0         # rounds without new data
    _last_artifact_count = 0               # snapshot of artifact count
    MAX_URL_VISITS = 5                     # same URL navigated-to this many times → stuck
    MAX_CONSECUTIVE_ERRORS = 3             # sequential tool failures → stuck
    MAX_SAME_SCREENSHOT = 3                # identical screenshots in a row → stuck
    MAX_ROUNDS_NO_PROGRESS = 8             # rounds without new artifact → stuck
    SOFT_WARNING_ROUND = 12                # inject a "wrap up" hint to the model

    async def _force_graceful_exit(reason: str):
        """Emit a forced task_complete with an explanation of why the loop was stopped."""
        await swarm.emit(AgentRole.WEB_SCOUT, "message", f"⚠️ {reason}")
        await swarm.send_log(f"⛔ Loop breaker triggered: {reason}")
        log_event(session_id, "loop_breaker", reason=reason)

        # Still run the analysis pipeline if we collected any data
        if swarm.artifacts:
            await swarm.emit(AgentRole.WEB_SCOUT, "complete",
                             f"Navigation stopped early: {reason}. Proceeding with collected data.")
            result = await swarm.run_analysis_pipeline()
            if result.get("report"):
                await websocket.send_json({
                    "type": "swarm_report",
                    "report": result["report"],
                    "audit": result.get("audit", {}),
                })
            quality = result.get("audit", {}).get("quality_score", "?")
            await websocket.send_json({
                "type": "task_complete",
                "summary": f"Task stopped early: {reason}. "
                           f"Analyzed {len(swarm.artifacts)} source(s). Quality: {quality}/100.",
            })
        else:
            await swarm.emit(AgentRole.WEB_SCOUT, "complete",
                             f"Navigation stopped: {reason}. No data was collected.")
            await websocket.send_json({
                "type": "task_complete",
                "summary": f"Task could not be completed: {reason}",
            })

    for round_num in range(max_rounds):
        # --- No-progress detection ---
        current_artifact_count = len(swarm.artifacts)
        if current_artifact_count > _last_artifact_count:
            _rounds_since_new_artifact = 0
            _last_artifact_count = current_artifact_count
        else:
            _rounds_since_new_artifact += 1
        if _rounds_since_new_artifact >= MAX_ROUNDS_NO_PROGRESS:
            await _force_graceful_exit(
                f"No new data collected in the last {_rounds_since_new_artifact} rounds. "
                f"The agent appears stuck without making progress."
            )
            return

        # --- Soft warning: tell model to finish soon ---
        if round_num == SOFT_WARNING_ROUND:
            parts.append(types.Part.from_text(
                text="SYSTEM WARNING: You have been navigating for many rounds. "
                     "Wrap up now — extract any remaining data and call task_complete immediately. "
                     "Do NOT start new navigations."
            ))
            await swarm.send_log(f"⏰ Soft warning injected at round {round_num}")

        response = await chat.send_message(parts)

        text_parts = []
        browser_calls = []
        meta_calls = []

        if response.candidates and response.candidates[0].content:
            for part in response.candidates[0].content.parts:
                if hasattr(part, 'function_call') and part.function_call:
                    fc = part.function_call
                    call = {"name": fc.name, "args": dict(fc.args) if fc.args else {}}
                    if fc.name in META_TOOLS:
                        meta_calls.append(call)
                    else:
                        browser_calls.append(call)
                elif hasattr(part, 'text') and part.text:
                    text_parts.append(part.text)

        full_text = " ".join(text_parts).strip()
        if full_text:
            await swarm.emit(AgentRole.WEB_SCOUT, "message", full_text)
            await websocket.send_json({"type": "text", "text": full_text})
            log_event(session_id, "assistant_text", text_preview=full_text[:200])

        task_completed = False
        for mc in meta_calls:
            if mc["name"] == "report_plan":
                scout_steps = mc["args"].get("steps", [])
                analysis_steps = [
                    "📊 Analyze collected data", "🧠 Synthesize strategic insights",
                    "📝 Build final report", "🔎 Quality audit",
                ]
                await websocket.send_json({
                    "type": "plan",
                    "goal": mc["args"].get("goal", ""),
                    "steps": scout_steps + analysis_steps,
                    "current_step": mc["args"].get("current_step", 0),
                })

            elif mc["name"] == "task_complete":
                summary = mc["args"].get("summary", "")
                await swarm.emit(AgentRole.WEB_SCOUT, "complete", f"Navigation complete: {summary}")
                log_event(session_id, "web_scout_complete", summary=summary)

                if swarm.artifacts:
                    log_event(session_id, "analysis_pipeline_start", artifact_count=len(swarm.artifacts))
                    result = await swarm.run_analysis_pipeline()
                    if result.get("report"):
                        await websocket.send_json({
                            "type": "swarm_report",
                            "report": result["report"],
                            "audit": result.get("audit", {}),
                        })
                    audit = result.get("audit", {})
                    quality = audit.get("quality_score", "?")
                    await websocket.send_json({
                        "type": "task_complete",
                        "summary": f"Swarm analysis complete. Quality: {quality}/100. "
                                   f"{len(swarm.artifacts)} sources analyzed.",
                    })
                    log_event(session_id, "swarm_complete", quality_score=quality)
                else:
                    await websocket.send_json({"type": "task_complete", "summary": summary})
                task_completed = True

            elif mc["name"] == "request_user_confirmation":
                await websocket.send_json({
                    "type": "confirmation_request",
                    "action_description": mc["args"].get("action_description", ""),
                    "risk_level": mc["args"].get("risk_level", "medium"),
                })
                return  # Wait for user response

        if task_completed:
            return

        # Execute browser tool calls via Playwright
        fn_responses = []
        needs_screenshot = False
        page_url = browser.page.url

        for call in browser_calls:
            name, args = call["name"], call["args"]
            log_event(session_id, "tool_exec", tool=name, args=json.dumps(args)[:200])
            result = await _execute_tool(browser, name, args)
            fn_responses.append(types.Part.from_function_response(name=name, response=result))
            await swarm.send_log(f"🔧 {name}: {json.dumps(args, ensure_ascii=False)[:100]}")

            # Track consecutive errors for stuck detection
            if result.get("success"):
                _consecutive_errors = 0
            else:
                _consecutive_errors += 1
                await swarm.send_log(f"⚠️ Tool error ({_consecutive_errors}/{MAX_CONSECUTIVE_ERRORS}): {result.get('error', '')[:80]}")
                if _consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                    await _force_graceful_exit(
                        f"Too many consecutive tool failures ({_consecutive_errors}). "
                        f"Last error: {result.get('error', 'unknown')[:100]}"
                    )
                    return

            if name in SCREENSHOT_TOOLS:
                needs_screenshot = True

            if name == "extract_text" and result.get("success") and result.get("text"):
                existing_urls = {a.source_url for a in swarm.artifacts}
                is_new_source = page_url not in existing_urls
                swarm.add_artifact(page_url, result["text"])
                if is_new_source:
                    await swarm.advance_plan_step()
                await swarm.emit(
                    AgentRole.WEB_SCOUT, "finding",
                    f"Extracted {result.get('length', 0)} chars from {page_url}",
                )

        for mc in meta_calls:
            if mc["name"] != "task_complete":
                fn_responses.append(types.Part.from_function_response(
                    name=mc["name"], response={"success": True},
                ))

        if not fn_responses:
            await websocket.send_json({"type": "turn_complete"})
            return

        if needs_screenshot:
            await asyncio.sleep(0.5)
            ss_b64, tag_map = await _take_tagged_screenshot(browser)
            await websocket.send_json({
                "type": "screenshot",
                "data": ss_b64,
                "tag_map": tag_map,
                "url": browser.page.url,
            })

            # --- Stuck detection: URL repetition (only real navigations, not scrolls) ---
            current_url = browser.page.url
            if current_url != _last_seen_url:
                # URL actually changed — this is a real page transition
                _url_visits[current_url] = _url_visits.get(current_url, 0) + 1
                _last_seen_url = current_url

                if _url_visits[current_url] >= MAX_URL_VISITS:
                    await _force_graceful_exit(
                        f"Navigated to the same URL {_url_visits[current_url]} times ({current_url[:80]}). "
                        f"The agent keeps returning to this page, indicating a stuck loop."
                    )
                    return

            # --- Stuck detection: identical screenshots ---
            ss_hash = hash(ss_b64)
            if ss_hash == _last_screenshot_hash:
                _same_screenshot_count += 1
                if _same_screenshot_count >= MAX_SAME_SCREENSHOT:
                    await _force_graceful_exit(
                        f"Page appears unchanged after {_same_screenshot_count} consecutive actions. "
                        f"The agent may be stuck or the page is not responding."
                    )
                    return
            else:
                _same_screenshot_count = 0
            _last_screenshot_hash = ss_hash

            # --- Stuck detection: anti-bot / blocked page ---
            blocked = await browser.detect_blocked_page()
            if blocked:
                await _force_graceful_exit(
                    f"Access blocked by the target website: {blocked}. "
                    f"This is typically an anti-bot or CAPTCHA protection."
                )
                return

            parts = _build_vision_parts(ss_b64, tag_map)
            parts.extend(fn_responses)
        else:
            parts = fn_responses

    # Exhausted max_rounds
    await _force_graceful_exit(f"Reached maximum navigation rounds ({max_rounds}). Stopping to avoid infinite loop.")


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
