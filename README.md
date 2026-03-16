# AI Digital Workforce Swarm — Browser Agent

> **Gemini Live Agent Challenge**  
> **Redefining Interaction: From Static Chatbots to Immersive Experiences**  
> **Category: UI Navigator ☸️**

**Author:** Juan Camilo Atencia Amin  
**GDG Profile:** [https://gdg.community.dev/u/juan_camilo2](https://gdg.community.dev/u/juan_camilo2)

---

A **Progressive Web App (PWA)** that deploys a 6-agent AI swarm powered by **Gemini 3.1 Flash-Lite**. Type a research goal, and the swarm autonomously navigates the web via a server-side Playwright browser, analyzes findings, and delivers a professional report — all streamed in real-time over WebSocket.

The app is installable on desktop and mobile, works offline for the UI shell, and provides an immersive full-screen experience when launched from the home screen.

---

## Demo

### Screenshot — Workflow Pipeline + SoM Navigation

![Workflow pipeline and SoM-tagged browser view](evidence/Screenshot%202026-03-15%20182709.png)

> Left: the server-side browser showing red numbered SoM circles on interactive elements. Right: the animated hexagonal workflow pipeline with all 6 agents and real-time metrics.

### Cloud Run Deployment — Live Service + Build History + Cloud Logging

[![Cloud Run Deployment Proof](https://img.youtube.com/vi/fvQrBcp5cAc/maxresdefault.jpg)](https://youtu.be/fvQrBcp5cAc)

> Screen recording proving that the backend runs on Google Cloud: Cloud Run service details, live Cloud Logging output, and Cloud Build history.

Code references:
- [`cloudbuild.yaml`](cloudbuild.yaml) — CI/CD pipeline definition
- [`backend/cloud_logging.py`](backend/cloud_logging.py) — Cloud Logging API integration
- [`deploy.ps1`](deploy.ps1) / [`deploy.sh`](deploy.sh) — Automated deployment scripts
- [`backend/Dockerfile`](backend/Dockerfile) — Container image for Cloud Run

---

## Architecture

![Container Architecture](evidence/architecture-Container%20Architecture.drawio.png)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser (React 19 PWA)                                              │
│  ┌─────────────┐  ┌───────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ 💬 Chat      │  │ 🐝 Swarm  │  │ ⚡ Workflow   │  │ 📝 Report   │ │
│  │ Goal input   │  │ Agent feed│  │ Hex pipeline │  │ Markdown +  │ │
│  │ Plan tracker │  │ Live logs │  │ Canvas anim. │  │ PDF export  │ │
│  └──────┬───────┘  └─────┬─────┘  └──────┬───────┘  └──────┬──────┘ │
│         └────────────────┴───────────────┴──────────────────┘        │
│                              │ WebSocket                             │
└──────────────────────────────┼───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Backend (Cloud Run — Python FastAPI)                                │
│                                                                      │
│  ┌──────────────┐    ┌────────────────────────────────────────────┐  │
│  │ Playwright    │    │           Gemini 3.1 Flash-Lite            │  │
│  │ (headless     │    │                                            │  │
│  │  Chromium)    │◄──►│  🧠 Orchestrator ──► 🔍 Web Scout         │  │
│  │              │    │         │                   │               │  │
│  │ • Screenshot │    │         ▼                   ▼               │  │
│  │ • SoM tags   │    │  📊 Analyst ──► 💡 Strategy ──► 📝 Report  │  │
│  │ • Navigation │    │                                  │          │  │
│  └──────────────┘    │                           🔍 Auditor       │  │
│                      └────────────────────────────────────────────┘  │
│  ┌───────────────┐                                                   │
│  │ Cloud Logging  │                                                   │
│  └───────────────┘                                                   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## How the Agent "Sees" the Screen — Hybrid DOM + Vision (SoM)

The agent's perception system is a **hybrid approach** that combines **DOM analysis** with **pure visual understanding**. The system **does not require DOM access** but **enhances its accuracy when DOM is available** — fulfilling the challenge requirement of working "with or without relying on APIs or DOM access."

### The Set-of-Marks (SoM) Pipeline

```
┌──────────────────────────────────────────────────────────────────┐
│  STEP 1 — Element Discovery (DOM-enhanced, not DOM-dependent)    │
│                                                                  │
│  generate_tag_map() injects JS into the page to find interactive │
│  elements via selectors:                                         │
│    a[href], button, input, textarea, select, [role="button"],    │
│    [role="link"], [role="tab"], [onclick], [tabindex], ...       │
│                                                                  │
│  For each element, it extracts:                                  │
│    • CSS selector (for precise programmatic clicks)              │
│    • Bounding box coordinates (cx, cy, w, h)                    │
│    • Text label (textContent, aria-label, placeholder, alt)      │
│    • HTML tag type (button, input, a, etc.)                      │
│                                                                  │
│  ⚠️ If DOM is inaccessible: coordinates alone are sufficient.    │
│     The system falls back to mouse.click(cx, cy).                │
└──────────────────┬───────────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 2 — Visual Annotation (SoM Overlay — server-side)          │
│                                                                  │
│  som.py takes the raw screenshot (JPEG bytes) and the tag_map,   │
│  draws RED NUMBERED CIRCLES on each interactive element using     │
│  Pillow. This happens server-side — no browser injection needed.  │
│                                                                  │
│  Result: an annotated image where every clickable element has     │
│  a clear, numbered red circle over it.                           │
└──────────────────┬───────────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 3 — Multimodal Understanding (Gemini Vision)               │
│                                                                  │
│  The AI receives TWO inputs simultaneously:                      │
│    1. The annotated screenshot (visual — Gemini sees the page)   │
│    2. The TAG_MAP as structured text (semantic — labels + types)  │
│                                                                  │
│  Gemini cross-references the visual red numbers with the         │
│  TAG_MAP labels to make accurate decisions. This dual-channel    │
│  approach means the agent both SEES the page layout AND READS    │
│  the element metadata.                                           │
└──────────────────┬───────────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 4 — Action Execution (DOM-first, coordinate-fallback)      │
│                                                                  │
│  When Gemini calls click_tag(id) or type_tag(id, text):          │
│                                                                  │
│  1. Try CSS selector (from DOM) → el.click() / el.fill(text)    │
│     ✅ Most accurate — works even if element moved slightly      │
│                                                                  │
│  2. If selector fails → fall back to coordinate click:           │
│     page.mouse.click(cx, cy)                                     │
│     ✅ Works without any DOM access — pure visual positioning    │
│                                                                  │
│  This dual strategy means the agent works on ANY website,        │
│  including those with Shadow DOM, iframes, or canvas elements.   │
└──────────────────────────────────────────────────────────────────┘
```

### Why This Matters

| Approach | DOM Required? | Accuracy | Works on Canvas/Shadow DOM |
|---|:---:|:---:|:---:|
| **DOM-only agents** | Yes | High | No |
| **Pure-vision agents** | No | Medium | Yes |
| **Our Hybrid (SoM)** | **Optional** | **Highest** | **Yes** |

The hybrid approach gives us the **best of both worlds**: DOM metadata for precise element identification when available, and coordinate-based visual clicking as a universal fallback. The agent can operate on any website regardless of how it's built.

---

## PWA — Progressive Web App

The frontend is a full Progressive Web App:

- **Installable**: Add to home screen on mobile or desktop for an app-like experience
- **Offline shell**: The service worker caches the UI shell (HTML, CSS, JS) so the app loads instantly even offline (WebSocket data requires connectivity)
- **Standalone mode**: Launches without browser chrome when installed
- **Responsive**: Designed for desktop-first (split browser + sidebar) with landscape orientation

PWA assets:
- `frontend/public/manifest.json` — Web App Manifest with name, icons, theme color
- `frontend/public/sw.js` — Service Worker with offline-first caching strategy
- Service worker registration in `frontend/src/main.tsx`

---

## Key Features

| Feature | Description |
|---|---|
| **6-Agent Swarm** | Orchestrator → Web Scout → Data Analyst → Strategy Consultant → Report Builder → Quality Auditor — all powered by the same Gemini model with specialized system instructions |
| **Hybrid DOM + Vision** | Uses DOM selectors when available for precision, falls back to coordinate-based clicks for universal compatibility. No DOM access required. |
| **Server-Side Browser** | Headless Chromium via Playwright runs on the backend. Screenshots are streamed as base64 JPEG over WebSocket — no browser extension needed |
| **Set-of-Marks (SoM)** | Server-side Pillow overlay draws red numbered circles on interactive elements. Gemini reads tag IDs for pixel-perfect actions |
| **Real-Time Workflow** | Animated hexagonal pipeline visualization with data-flow particles, progress rings, and agent status indicators |
| **Multi-Language i18n** | Full UI + help system in 4 languages: English, Spanish, Portuguese, French |
| **PWA** | Installable, offline shell, standalone display mode |
| **PDF Export** | Professional multi-page PDF generation (jsPDF + jspdf-autotable) with tables, headers, and pagination |
| **Safety Confirmations** | Destructive actions trigger a confirmation dialog before execution |
| **Quality Audit** | Every report is scored (0–100) and given a verdict by the Quality Auditor agent |
| **Anti-Bot Stealth** | Stealth JS injection hides Playwright fingerprints (navigator.webdriver, plugins, chrome runtime), realistic user-agent, locale/timezone, HTTP headers, and random human-like delays before each action |
| **Intelligent Loop Breaker** | Automatic stuck detection: URL repetition (3×), identical screenshots (3×), consecutive errors (3×), no progress (8 rounds without new data), blocked page detection (CAPTCHA, anti-bot, 403). Soft warning injected at round 12. Forced graceful exit with clear explanation + analysis pipeline runs on partial data |

---

## The 6 Agents

| Agent | Role | What it does |
|---|---|---|
| 🧠 **Orchestrator** | CEO | Breaks the user goal into sub-tasks, coordinates the swarm, decides what to research |
| 🔍 **Web Scout** | Browser operator | Navigates sites, clicks, types, scrolls, extracts text — using SoM-tagged screenshots |
| 📊 **Data Analyst** | Analysis | Processes raw data, identifies patterns, creates structured comparisons |
| 💡 **Strategy Consultant** | Insights | Generates strategic recommendations and decision frameworks |
| 📝 **Report Builder** | Writer | Compiles findings into a professional Markdown report |
| 🔍 **Quality Auditor** | QA | Reviews the report for accuracy and completeness, assigns quality score |

---

## Tech Stack

| Layer | Technology |
|---|---|
| **AI Model** | Gemini 3.1 Flash-Lite (multimodal vision + function calling) |
| **Backend** | Python 3.11 · FastAPI · WebSocket · Playwright · Pillow |
| **Frontend** | React 19 · TypeScript · Vite · TailwindCSS · jsPDF (PWA) |
| **Internationalization** | Custom i18n system (EN, ES, PT, FR) |
| **Cloud** | Google Cloud Run · Cloud Build · Cloud Logging |
| **Cloud / Deploy** | Google Cloud Run · Cloud Build · Cloud Logging |
| **IaC / Automation** | `deploy.sh` (one-command) + `cloudbuild.yaml` (CI/CD pipeline) |

---

## Agent Tools (11)

| Tool | Description |
|---|---|
| `click_tag` | Click element by SoM tag ID (DOM selector → coordinate fallback) |
| `type_tag` | Focus & type into element by tag ID |
| `press_key` | Press keyboard key (Enter, Tab, Escape, etc.) |
| `scroll_page` | Scroll up/down |
| `go_back` | Browser history back |
| `navigate_to` | Go to a specific URL |
| `wait_for_page` | Wait for page load after navigation |
| `extract_text` | Extract visible text (full page or CSS selector) |
| `report_plan` | Declare multi-step execution plan |
| `task_complete` | Signal task completion with summary |
| `request_user_confirmation` | Safety gate for destructive actions |

---

## Automated Cloud Deployment

**Region:** `us-central1` (default, configurable)

> Deployment is fully automated via infrastructure-as-code scripts included in this repository.

### Option A — One-command deploy script

The `deploy.sh` / `deploy.ps1` scripts automate the **entire pipeline** in a single command:
1. Builds the React frontend → `backend/static/`
2. Submits the Docker image to Cloud Build (`gcr.io/<YOUR_PROJECT>/aerobrowser-backend`)
3. Deploys to Cloud Run with Playwright-compatible resources (2 CPU, 2 GiB RAM)

```bash
# macOS/Linux:
export GCP_PROJECT_ID="your-gcp-project-id"   # ← required
export GEMINI_API_KEY="your-gemini-api-key"    # ← required
chmod +x deploy.sh
./deploy.sh

# Windows PowerShell:
$env:GCP_PROJECT_ID="your-gcp-project-id"     # ← required
$env:GEMINI_API_KEY="your-gemini-api-key"      # ← required
.\deploy.ps1
```

| Variable | Required | Default | Description |
|---|:---:|---|---|
| `GCP_PROJECT_ID` | **Yes** | — | Your Google Cloud project ID |
| `GEMINI_API_KEY` | **Yes** | — | Your Gemini API key |
| `GCP_REGION` | No | `us-central1` | Cloud Run region |
| `SERVICE_NAME` | No | `aerobrowser-backend` | Cloud Run service name |

### Option B — CI/CD pipeline (`cloudbuild.yaml`)

The `cloudbuild.yaml` at the repo root defines a **4-step automated pipeline** for Cloud Build:

| Step | Action |
|:---:|---|
| 1 | Install frontend deps & build static assets (Node.js 20) |
| 2 | Build Docker image (Python 3.11 + Playwright + Chromium) |
| 3 | Push image to Container Registry (`gcr.io/$PROJECT_ID/aerobrowser-backend`) |
| 4 | Deploy to Cloud Run (2 CPU, 2 GiB, 900s timeout) |

Set up a Cloud Build trigger to run on every push to `main`:

```bash
gcloud builds triggers create github \
  --repo-name="Agent-Challenge-AntiGravity" \
  --repo-owner="YOUR_GITHUB_USER" \
  --branch-pattern="^main$" \
  --build-config="cloudbuild.yaml" \
  --substitutions="_GEMINI_API_KEY=your-key"
```

### Manual deployment (step-by-step reference)

If you prefer to run the commands individually:

```bash
# 1. Build frontend (if changed)
cd frontend && npm run build && cd ../backend

# 2. Build & push Docker image via Cloud Build
gcloud builds submit --tag gcr.io/$GCP_PROJECT_ID/aerobrowser-backend --project $GCP_PROJECT_ID

# 3. Deploy to Cloud Run
# macOS/Linux:
gcloud run deploy aerobrowser-backend \
  --image gcr.io/$GCP_PROJECT_ID/aerobrowser-backend \
  --project $GCP_PROJECT_ID \
  --set-env-vars GEMINI_API_KEY=$GEMINI_API_KEY \
  --platform managed --region us-central1 \
  --allow-unauthenticated --memory 2Gi --cpu 2 --timeout 900

# Windows PowerShell (single line):
gcloud run deploy aerobrowser-backend --image gcr.io/$env:GCP_PROJECT_ID/aerobrowser-backend --project $env:GCP_PROJECT_ID --set-env-vars GEMINI_API_KEY=$env:GEMINI_API_KEY --platform managed --region us-central1 --allow-unauthenticated --memory 2Gi --cpu 2 --timeout 900
```

### Deployment files

| File | Purpose |
|---|---|
| `deploy.sh` | **One-command automated deployment** — Linux/macOS (build → push → deploy) |
| `deploy.ps1` | **One-command automated deployment** — Windows PowerShell |
| `cloudbuild.yaml` | **Cloud Build CI/CD pipeline** (4-step IaC definition) |
| `backend/Dockerfile` | Container image (Python 3.11 + Playwright + Chromium + fonts) |

---

## Quick Start — Local Development

### 1. Frontend

```bash
cd frontend
npm install
npm run build    # outputs to backend/static/
```

### 2. Backend

```bash
cd backend
pip install -r requirements.txt
playwright install chromium
playwright install-deps chromium

# Set your Gemini API key
# Windows PowerShell:
$env:GEMINI_API_KEY="your_key_here"
# macOS/Linux:
export GEMINI_API_KEY="your_key_here"

python -m uvicorn main:app --reload
# → http://localhost:8000
```

Open `http://localhost:8000` in your browser — the full PWA loads from the backend's static files.

---

## Project Structure

```
├── cloudbuild.yaml           # ← Cloud Build CI/CD pipeline (IaC)
├── deploy.sh                 # ← One-command deployment script
├── backend/
│   ├── main.py               # FastAPI server + WebSocket + swarm orchestration
│   ├── agent.py              # Gemini agent config (tools + system prompt)
│   ├── swarm.py              # SwarmSession — multi-agent pipeline
│   ├── browser.py            # Playwright BrowserSession (screenshots, SoM, actions)
│   ├── som.py                # Set-of-Marks overlay — server-side Pillow drawing
│   ├── adk_agent.py          # ADK Agent definition
│   ├── cloud_logging.py      # Google Cloud Logging integration
│   ├── requirements.txt
│   ├── Dockerfile
│   └── static/               # ← frontend build output
├── frontend/
│   ├── index.html            # HTML entry point with PWA meta tags
│   ├── public/
│   │   ├── manifest.json     # ← PWA Web App Manifest
│   │   └── sw.js             # ← Service Worker (offline caching)
│   └── src/
│       ├── App.tsx            # Main React app (WebSocket, tabs, state)
│       ├── WorkflowView.tsx   # Animated hexagonal pipeline canvas
│       ├── HelpModal.tsx      # Multi-language help overlay
│       ├── i18n.ts            # Translations (4 languages) + help content
│       ├── pdfgen.ts          # Professional PDF generation
│       └── main.tsx           # React entry point + SW registration
└── README.md
```

---

## Google Cloud Services Used

1. **Cloud Run** — Containerized FastAPI + Playwright backend (auto-scaling, managed)
2. **Cloud Build** — Automated CI/CD pipeline for building and deploying container images
3. **Cloud Logging** — Structured logging with severity, session tracking, and event types
4. **Container Registry** — Docker image storage
5. **Gemini API** — Multimodal AI model for vision + function calling across all 6 agents

---

## How the Swarm Thinks

1. **User says**: "Compare pricing plans of Notion, Clickup, and Monday.com"
2. **Orchestrator plans**: Navigate to each site → extract pricing data → compare
3. **Web Scout navigates**: Tagged screenshots → `navigate_to("notion.so/pricing")` → `extract_text` → repeat for each site
4. **Data Analyst** processes raw data into structured comparison tables
5. **Strategy Consultant** adds market insights and recommendations
6. **Report Builder** compiles a professional Markdown report
7. **Quality Auditor** scores the report and issues a verdict

All steps stream in real-time via WebSocket — visible in Chat, Swarm, and Workflow tabs simultaneously.

---

## Author

Built for the Gemini Agent Challenge by **Juan Camilo Atencia Amin**.  
GDG Profile: [https://gdg.community.dev/u/juan_camilo2](https://gdg.community.dev/u/juan_camilo2)
