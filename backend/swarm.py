"""
AI Digital Workforce Swarm — Orchestrator & Specialist Agents.

Coordinates multiple AI agents working together on complex tasks.
All agents use the same Gemini model (gemini-3.1-flash-lite-preview) but
with specialized system instructions. Only the Web Scout (Browser Executor)
has access to UI tools — all other agents are text-only analysts.
"""
import asyncio
import json
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Awaitable

import agent
from google.genai import types


# ---------------------------------------------------------------------------
# Agent Roles
# ---------------------------------------------------------------------------

class AgentRole(str, Enum):
    ORCHESTRATOR = "orchestrator"
    WEB_SCOUT = "web_scout"
    DATA_ANALYST = "data_analyst"
    STRATEGY = "strategy"
    REPORT_BUILDER = "report_builder"
    CRITIC = "critic"


AGENT_PROFILES: dict[str, dict] = {
    AgentRole.ORCHESTRATOR: {
        "name": "CEO Agent",
        "emoji": "👨‍💼",
        "color": "#8B5CF6",
        "description": "Decomposes goals into actionable tasks",
    },
    AgentRole.WEB_SCOUT: {
        "name": "Web Scout",
        "emoji": "🔍",
        "color": "#3B82F6",
        "description": "Navigates websites and extracts data",
    },
    AgentRole.DATA_ANALYST: {
        "name": "Data Analyst",
        "emoji": "📊",
        "color": "#10B981",
        "description": "Structures and analyzes raw data",
    },
    AgentRole.STRATEGY: {
        "name": "Strategy Consultant",
        "emoji": "🧠",
        "color": "#F59E0B",
        "description": "Synthesizes strategic insights",
    },
    AgentRole.REPORT_BUILDER: {
        "name": "Report Builder",
        "emoji": "📝",
        "color": "#EC4899",
        "description": "Creates the final deliverable",
    },
    AgentRole.CRITIC: {
        "name": "Quality Auditor",
        "emoji": "🔎",
        "color": "#EF4444",
        "description": "Validates accuracy and completeness",
    },
}


# ---------------------------------------------------------------------------
# Specialist System Instructions
# ---------------------------------------------------------------------------

ORCHESTRATOR_INSTRUCTION = """You are the CEO/Orchestrator of an AI Digital Workforce Swarm.
Your job is to analyze the user's high-level goal and break it down into concrete sub-tasks.

You have a team of specialists:
- Web Scout: Navigates websites and extracts raw data from web pages
- Data Analyst: Analyzes extracted data, finds patterns, compares metrics
- Strategy Consultant: Synthesizes findings into strategic insights
- Report Builder: Creates the final deliverable
- Quality Auditor: Validates quality and completeness

IMPORTANT: You MUST respond with ONLY a JSON object (no markdown fences, no extra text):
{
  "goal": "high-level goal summary",
  "web_tasks": [
    {"url": "https://example.com", "objective": "what to extract from this page", "selectors": ["main", ".pricing"]}
  ],
  "analysis_instructions": {
    "data_analyst": "specific instructions for data analysis",
    "strategy": "specific instructions for strategic analysis"
  },
  "report_format": "description of desired output format"
}

Rules:
- Include 2-6 web_tasks with real, valid URLs relevant to the goal.
- Be specific about what data to extract from each URL.
- If the user mentions specific companies/products, include their actual websites.
- For comparisons, include one web_task per entity being compared.
- Always include pricing pages, feature pages, or review sites when relevant."""

DATA_ANALYST_INSTRUCTION = """You are a Data Analyst agent in an AI Digital Workforce Swarm.
You receive raw text extracted from web pages by the Web Scout agent.

Your job:
1. Parse and structure the raw data
2. Identify key metrics, prices, features
3. Find patterns and anomalies
4. Create structured findings

You MUST respond with ONLY a JSON object (no markdown fences):
{
  "findings": [
    {
      "category": "pricing|features|market|reviews|other",
      "claim": "concise finding statement",
      "evidence": "supporting data from the source",
      "confidence": 0.85,
      "source": "where this data came from"
    }
  ],
  "summary": "brief overview of analysis"
}

Be precise and data-driven. Only report what the evidence supports."""

STRATEGY_INSTRUCTION = """You are a Strategy Consultant agent in an AI Digital Workforce Swarm.
You receive structured findings from the Data Analyst.

Your job:
1. Synthesize findings into strategic insights
2. Identify competitive advantages and weaknesses
3. Spot opportunities and threats
4. Generate actionable recommendations

You MUST respond with ONLY a JSON object (no markdown fences):
{
  "insights": [
    {
      "title": "insight title",
      "description": "detailed explanation",
      "impact": "high|medium|low",
      "recommendation": "what to do about it"
    }
  ],
  "executive_summary": "2-3 sentence strategic overview"
}

Think like a top-tier management consultant. Be insightful and actionable."""

REPORT_BUILDER_INSTRUCTION = """You are a Report Builder agent in an AI Digital Workforce Swarm.
You receive strategic insights and raw findings from your team.

Create a comprehensive, well-structured report in Markdown with:
1. **Executive Summary** — 2-3 sentences
2. **Key Findings** — with data, use tables where useful
3. **Competitive Matrix** — comparison table if applicable
4. **Strategic Recommendations** — actionable, prioritized
5. **Conclusion**

Use tables, bullet points, and clear headings. Be concise but thorough.
The report should be ready to present to stakeholders."""

CRITIC_INSTRUCTION = """You are a Quality Auditor agent in an AI Digital Workforce Swarm.
You receive the final report and all supporting evidence.

Your job:
1. Check for unsupported claims
2. Identify gaps in the analysis
3. Verify logical consistency
4. Rate overall quality

You MUST respond with ONLY a JSON object (no markdown fences):
{
  "quality_score": 82,
  "issues": [
    {"severity": "high|medium|low", "description": "what's wrong", "suggestion": "how to fix"}
  ],
  "verdict": "approved|needs_revision",
  "summary": "brief quality assessment"
}

Be thorough but fair. Focus on factual accuracy and completeness."""


# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------

@dataclass
class Artifact:
    """Data extracted from a web page by the Browser Executor."""
    id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    source_url: str = ""
    content: str = ""
    created_at: float = field(default_factory=time.time)


@dataclass
class SwarmEvent:
    """A message from one agent to the swarm (visible to user)."""
    agent_role: str
    agent_name: str
    agent_emoji: str
    agent_color: str
    event_type: str  # "thinking", "finding", "message", "complete", "error"
    message: str
    data: dict | None = None
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {
            "type": "swarm_event",
            "agent_role": self.agent_role,
            "agent_name": self.agent_name,
            "agent_emoji": self.agent_emoji,
            "agent_color": self.agent_color,
            "event_type": self.event_type,
            "message": self.message,
            "data": self.data,
            "timestamp": self.timestamp,
        }


# ---------------------------------------------------------------------------
# Swarm Session
# ---------------------------------------------------------------------------

class SwarmSession:
    """Manages a multi-agent swarm working on a single user goal."""

    def __init__(self, language: str, send_fn: Callable[[dict], Awaitable[None]]):
        self.language = language
        self.send = send_fn  # async function to send JSON to the browser
        self.artifacts: list[Artifact] = []
        self.current_plan: dict | None = None

    # -- Helpers --

    async def emit(self, role: AgentRole, event_type: str, message: str, data: dict | None = None):
        """Send a swarm event to the browser."""
        profile = AGENT_PROFILES[role]
        evt = SwarmEvent(
            agent_role=role.value,
            agent_name=profile["name"],
            agent_emoji=profile["emoji"],
            agent_color=profile["color"],
            event_type=event_type,
            message=message,
            data=data,
        )
        await self.send(evt.to_dict())

    async def send_agent_status(self):
        """Send full agent roster with initial status to the browser."""
        agents = []
        for role in AgentRole:
            p = AGENT_PROFILES[role]
            agents.append({
                "role": role.value,
                "name": p["name"],
                "emoji": p["emoji"],
                "color": p["color"],
                "description": p["description"],
                "status": "idle",
            })
        await self.send({"type": "swarm_status", "agents": agents})

    def add_artifact(self, source_url: str, content: str):
        """Store extracted text as an artifact."""
        self.artifacts.append(Artifact(source_url=source_url, content=content))

    def set_plan_tracking(self, steps: list[str], goal: str, num_web_steps: int):
        """Store plan info for step-by-step progress updates."""
        self._plan_steps = steps
        self._plan_goal = goal
        self._num_web_steps = num_web_steps
        self._current_step = 0

    async def advance_plan_step(self, step: int | None = None):
        """Advance and broadcast the current plan step."""
        if not hasattr(self, '_plan_steps'):
            return
        if step is not None:
            self._current_step = step
        else:
            self._current_step += 1
        await self.send({
            "type": "plan",
            "goal": self._plan_goal,
            "steps": self._plan_steps,
            "current_step": self._current_step,
        })

    async def send_log(self, message: str):
        """Send a backend log entry to the frontend."""
        await self.send({"type": "backend_log", "message": message, "timestamp": time.time()})

    def _call_specialist(self, instruction: str, prompt: str) -> types.GenerateContentConfig:
        """Build config for a specialist (no browser tools)."""
        return agent.get_specialist_config(instruction, self.language)

    @staticmethod
    def _parse_json(text: str) -> dict | None:
        """Try to extract a JSON object from model output."""
        try:
            start = text.index('{')
            end = text.rindex('}') + 1
            return json.loads(text[start:end])
        except (ValueError, json.JSONDecodeError):
            return None

    # -- Orchestrator --

    async def run_orchestrator(self, user_goal: str) -> dict | None:
        """Decompose the user's goal into a structured plan."""
        await self.emit(AgentRole.ORCHESTRATOR, "thinking", "Analyzing your goal and assembling the team...")

        config = agent.get_specialist_config(ORCHESTRATOR_INSTRUCTION, self.language)
        response = await agent.client.aio.models.generate_content(
            model=agent.MODEL, contents=user_goal, config=config,
        )
        text = response.text or ""
        plan = self._parse_json(text)
        if plan:
            self.current_plan = plan
            await self.emit(
                AgentRole.ORCHESTRATOR, "complete",
                f"Plan ready — {len(plan.get('web_tasks', []))} web tasks identified.",
                data=plan,
            )
        else:
            await self.emit(AgentRole.ORCHESTRATOR, "message", text[:500])
        return plan

    def build_scout_prompt(self, plan: dict) -> str:
        """Convert orchestrator plan into instructions for the Web Scout."""
        web_tasks = plan.get("web_tasks", [])
        task_lines = []
        for i, t in enumerate(web_tasks, 1):
            sels = ", ".join(t.get("selectors", ["main"]))
            task_lines.append(
                f"{i}. Navigate to {t['url']} — Objective: {t['objective']}. "
                f"Use extract_text(selector) for these areas: {sels}."
            )
        return (
            f"The CEO Agent created this plan. Execute each web task in order:\n\n"
            + "\n".join(task_lines)
            + "\n\nAfter extracting data from all sources, call task_complete with a summary of what you collected."
        )

    # -- Specialist Agents --

    async def run_data_analyst(self) -> list[dict]:
        await self.emit(AgentRole.DATA_ANALYST, "thinking", f"Analyzing {len(self.artifacts)} data sources...")

        combined = "\n\n---\n\n".join(
            f"SOURCE: {a.source_url}\n{a.content[:4000]}" for a in self.artifacts
        )
        instructions = ""
        if self.current_plan:
            instructions = self.current_plan.get("analysis_instructions", {}).get(
                "data_analyst", "Analyze the data thoroughly."
            )
        prompt = f"INSTRUCTIONS: {instructions}\n\nDATA:\n{combined}"

        config = agent.get_specialist_config(DATA_ANALYST_INSTRUCTION, self.language)
        response = await agent.client.aio.models.generate_content(
            model=agent.MODEL, contents=prompt, config=config,
        )
        text = response.text or ""
        result = self._parse_json(text)
        findings = result.get("findings", []) if result else []
        summary = result.get("summary", "Analysis complete.") if result else text[:300]

        # Emit individual findings
        for f in findings:
            await self.emit(
                AgentRole.DATA_ANALYST, "finding",
                f"[{f.get('category', 'data')}] {f.get('claim', '')}",
                data=f,
            )
        await self.emit(AgentRole.DATA_ANALYST, "complete", summary, data={"findings_count": len(findings)})
        return findings

    async def run_strategy(self, findings: list[dict]) -> list[dict]:
        await self.emit(AgentRole.STRATEGY, "thinking", "Synthesizing strategic insights...")

        instructions = ""
        if self.current_plan:
            instructions = self.current_plan.get("analysis_instructions", {}).get(
                "strategy", "Provide strategic recommendations."
            )
        prompt = f"INSTRUCTIONS: {instructions}\n\nFINDINGS:\n{json.dumps(findings, indent=2, ensure_ascii=False)}"

        config = agent.get_specialist_config(STRATEGY_INSTRUCTION, self.language)
        response = await agent.client.aio.models.generate_content(
            model=agent.MODEL, contents=prompt, config=config,
        )
        text = response.text or ""
        result = self._parse_json(text)
        insights = result.get("insights", []) if result else []
        exec_summary = result.get("executive_summary", "") if result else text[:300]

        for ins in insights:
            await self.emit(
                AgentRole.STRATEGY, "finding",
                f"[{ins.get('impact', 'medium').upper()}] {ins.get('title', '')}",
                data=ins,
            )
        await self.emit(AgentRole.STRATEGY, "complete", exec_summary, data={"insights_count": len(insights)})
        return insights

    async def run_report_builder(self, findings: list[dict], insights: list[dict]) -> str:
        await self.emit(AgentRole.REPORT_BUILDER, "thinking", "Creating the final report...")

        report_format = "Professional markdown report"
        if self.current_plan:
            report_format = self.current_plan.get("report_format", report_format)

        prompt = (
            f"FORMAT: {report_format}\n\n"
            f"FINDINGS:\n{json.dumps(findings, indent=2, ensure_ascii=False)}\n\n"
            f"STRATEGIC INSIGHTS:\n{json.dumps(insights, indent=2, ensure_ascii=False)}"
        )
        config = agent.get_specialist_config(REPORT_BUILDER_INSTRUCTION, self.language)
        response = await agent.client.aio.models.generate_content(
            model=agent.MODEL, contents=prompt, config=config,
        )
        report = response.text or ""
        await self.emit(AgentRole.REPORT_BUILDER, "complete", "Report generated.", data={"report": report})
        return report

    async def run_critic(self, report: str, findings: list[dict]) -> dict:
        await self.emit(AgentRole.CRITIC, "thinking", "Auditing report quality...")

        prompt = (
            f"REPORT:\n{report}\n\n"
            f"EVIDENCE:\n{json.dumps(findings, indent=2, ensure_ascii=False)}"
        )
        config = agent.get_specialist_config(CRITIC_INSTRUCTION, self.language)
        response = await agent.client.aio.models.generate_content(
            model=agent.MODEL, contents=prompt, config=config,
        )
        text = response.text or ""
        audit = self._parse_json(text) or {}
        verdict = audit.get("verdict", "unknown")
        score = audit.get("quality_score", "?")
        await self.emit(
            AgentRole.CRITIC, "complete",
            f"Quality Score: {score}/100 — Verdict: {verdict}",
            data=audit,
        )
        return audit

    # -- Full Analysis Pipeline (runs after Web Scout finishes) --

    async def run_analysis_pipeline(self) -> dict:
        """Run the full analysis pipeline: Analyst → Strategy → Report → Critic."""
        if not self.artifacts:
            await self.emit(
                AgentRole.ORCHESTRATOR, "error",
                "No data was collected. Cannot run analysis.",
            )
            return {"error": "no_artifacts"}

        web_steps = self._num_web_steps if hasattr(self, '_num_web_steps') else 0

        # Phase 1: Data analysis
        await self.advance_plan_step(web_steps)
        await self.send_log("📊 Starting data analysis phase")
        findings = await self.run_data_analyst()
        if not findings:
            findings = [{"category": "general", "claim": "Limited data extracted", "confidence": 0.3}]

        # Phase 2: Strategy synthesis
        await self.advance_plan_step(web_steps + 1)
        await self.send_log("🧠 Starting strategy synthesis phase")
        insights = await self.run_strategy(findings)

        # Phase 3: Report generation
        await self.advance_plan_step(web_steps + 2)
        await self.send_log("📝 Starting report generation phase")
        report = await self.run_report_builder(findings, insights)

        # Phase 4: Quality audit
        await self.advance_plan_step(web_steps + 3)
        await self.send_log("🔎 Starting quality audit phase")
        audit = await self.run_critic(report, findings)

        # All steps complete
        await self.advance_plan_step(web_steps + 4)

        return {
            "findings": findings,
            "insights": insights,
            "report": report,
            "audit": audit,
        }
