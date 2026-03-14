from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import json
import base64
import traceback
import agent
from google.genai import types

app = FastAPI(title="AeroBrowser Navigator Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def log_event(session_id: str, event_type: str, **fields):
    payload = {
        "severity": "INFO",
        "source": "chrome_extension",
        "event_type": event_type,
        "session_id": session_id,
        **fields,
    }
    print(json.dumps(payload, ensure_ascii=False), flush=True)


@app.get("/health")
async def health():
    return {"status": "ok", "model": agent.MODEL}


@app.websocket("/ws/navigate")
async def navigate_ws(websocket: WebSocket):
    """
    WebSocket for UI Navigator sessions.
    Browser sends: user text + screenshot → Backend calls Gemini → returns text + tool_calls.
    Browser executes tool_calls → sends tool_responses → Backend forwards to Gemini → repeat.
    """
    await websocket.accept()
    language = websocket.query_params.get("language", "en-US")
    session_id = websocket.query_params.get("session_id", "unknown-session")
    page_url = websocket.query_params.get("page_url", "")
    config = agent.get_chat_config(language)
    log_event(session_id, "websocket_connected", language=language, page_url=page_url)

    # Create an async chat session (multi-turn with automatic history)
    chat = agent.client.aio.chats.create(model=agent.MODEL, config=config)

    # Store the latest screenshot to include with each user message
    latest_screenshot: dict | None = None

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            msg_type = data.get("type", "")

            if msg_type == "screenshot":
                # Browser sends periodic tagged screenshots — store for next user message
                latest_screenshot = data
                log_event(
                    session_id,
                    "screenshot_received",
                    tag_count=len(data.get("tag_map", [])),
                    page_url=page_url,
                )
                continue

            if msg_type == "text":
                log_event(
                    session_id,
                    "user_message",
                    message_type="text",
                    text_preview=data["text"][:160],
                    page_url=page_url,
                )
                # Build multimodal message: tagged screenshot + user text
                parts: list = []
                if latest_screenshot:
                    img_bytes = base64.b64decode(latest_screenshot["data"])
                    parts.append(types.Part.from_bytes(
                        data=img_bytes,
                        mime_type=latest_screenshot.get("mime_type", "image/jpeg"),
                    ))
                    # Include the tag manifest so Gemini can cross-reference IDs
                    tag_map = latest_screenshot.get("tag_map") or data.get("tag_map")
                    if tag_map:
                        parts.append(types.Part.from_text(text=f"TAG_MAP: {json.dumps(tag_map)}"))
                parts.append(types.Part.from_text(text=data["text"]))

                # Send to Gemini and process the response (may have tool calls)
                await _process_response(chat, parts, websocket, latest_screenshot, session_id, page_url)

            elif msg_type == "tool_responses":
                log_event(
                    session_id,
                    "tool_responses_received",
                    tool_names=[tr.get("name") for tr in data.get("responses", [])],
                    page_url=page_url,
                )
                # Browser executed tool calls and sent back results
                fn_responses = []
                for tr in data.get("responses", []):
                    fn_responses.append(types.Part.from_function_response(
                        name=tr["name"],
                        response=tr.get("result", {"success": True}),
                    ))
                # Also include the post-action tagged screenshot if provided
                parts = []
                if data.get("screenshot"):
                    img_bytes = base64.b64decode(data["screenshot"]["data"])
                    parts.append(types.Part.from_bytes(
                        data=img_bytes,
                        mime_type=data["screenshot"].get("mime_type", "image/jpeg"),
                    ))
                    latest_screenshot = data["screenshot"]
                    # New tag manifest for the new page state
                    if data.get("tag_map"):
                        parts.append(types.Part.from_text(text=f"TAG_MAP: {json.dumps(data['tag_map'])}"))
                parts.extend(fn_responses)

                await _process_response(chat, parts, websocket, latest_screenshot, session_id, page_url)

    except WebSocketDisconnect:
        log_event(session_id, "websocket_disconnected", page_url=page_url)
    except Exception as e:
        log_event(session_id, "backend_exception", error=str(e), page_url=page_url)
        traceback.print_exc()
        try:
            await websocket.close(code=1011, reason=str(e)[:120])
        except Exception:
            pass


async def _process_response(chat, parts, websocket, latest_screenshot, session_id: str, page_url: str):
    """Send parts to chat, relay text and tool_calls to browser.
    Handles report_plan and task_complete server-side (no browser execution needed).
    """
    response = await chat.send_message(parts)

    # Extract text and tool calls from response
    text_parts = []
    tool_calls = []        # browser actions
    plan_calls = []        # report_plan / task_complete (handled server-side)

    if response.candidates and response.candidates[0].content:
        for part in response.candidates[0].content.parts:
            if hasattr(part, 'function_call') and part.function_call:
                fc = part.function_call
                call_data = {
                    "name": fc.name,
                    "args": dict(fc.args) if fc.args else {},
                }
                if fc.name in ("report_plan", "task_complete"):
                    plan_calls.append(call_data)
                else:
                    tool_calls.append(call_data)
            elif hasattr(part, 'text') and part.text:
                text_parts.append(part.text)

    # Send text response
    full_text = " ".join(text_parts)
    if full_text.strip():
        log_event(session_id, "assistant_text", text_preview=full_text[:200], page_url=page_url)
        await websocket.send_json({"type": "text", "text": full_text})

    # Relay plan/complete as special messages to the UI
    for pc in plan_calls:
        if pc["name"] == "report_plan":
            log_event(
                session_id,
                "plan_reported",
                goal=pc["args"].get("goal", ""),
                step_count=len(pc["args"].get("steps", [])),
                current_step=pc["args"].get("current_step", 0),
                page_url=page_url,
            )
            await websocket.send_json({
                "type": "plan",
                "goal": pc["args"].get("goal", ""),
                "steps": pc["args"].get("steps", []),
                "current_step": pc["args"].get("current_step", 0),
            })
        elif pc["name"] == "task_complete":
            log_event(
                session_id,
                "task_complete",
                summary=pc["args"].get("summary", ""),
                page_url=page_url,
            )
            await websocket.send_json({
                "type": "task_complete",
                "summary": pc["args"].get("summary", ""),
            })

    # If there were plan calls, auto-respond so Gemini continues execution
    if plan_calls and not tool_calls:
        fn_responses = []
        for pc in plan_calls:
            fn_responses.append(types.Part.from_function_response(
                name=pc["name"],
                response={"success": True},
            ))
        # Include latest screenshot so Gemini sees current page state
        auto_parts = []
        if latest_screenshot:
            img_bytes = base64.b64decode(latest_screenshot["data"])
            auto_parts.append(types.Part.from_bytes(
                data=img_bytes,
                mime_type=latest_screenshot.get("mime_type", "image/jpeg"),
            ))
        auto_parts.extend(fn_responses)
        # Recurse — Gemini will continue with the next action
        await _process_response(chat, auto_parts, websocket, latest_screenshot, session_id, page_url)
        return

    # Send browser tool calls (browser will execute them and reply with tool_responses)
    if tool_calls:
        log_event(
            session_id,
            "tool_calls_emitted",
            tool_names=[tc.get("name") for tc in tool_calls],
            page_url=page_url,
        )
        # If there were also plan calls, auto-respond those first
        if plan_calls:
            fn_responses = []
            for pc in plan_calls:
                fn_responses.append(types.Part.from_function_response(
                    name=pc["name"],
                    response={"success": True},
                ))
            # We need to send plan responses AND browser tool calls together
            # But browser tool calls came in same response, so we respond to plan
            # and let the browser handle the action tools
            pass  # plan already relayed to UI above; browser will handle tool_calls
        await websocket.send_json({"type": "tool_calls", "calls": tool_calls})
    else:
        # No tool calls — turn is complete
        await websocket.send_json({"type": "turn_complete"})


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
