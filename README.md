# AeroBrowser: The Cognitive Copilot Extension

AeroBrowser is an augmented browsing extension built for the **Gemini Live Agent Challenge**. It turns your standard web browser into a "UI Navigator" agent capable of seeing your screen and listening to conversational commands contextually.

## Features
1. **Camera HUD**: A Heads-Up Display injected into any webpage to show you the extension's live tracking and status.
2. **Contextual Voice Barge-in ("Gemini, qué es esto?")**: While looking at an element on a webpage, simply say "gemini" followed by your question (e.g., "gemini, can you summarize this image?"). The extension automatically takes a silent screenshot, transcodes your voice via the Web Speech API, and hits the Gemini Multimodal backend to give you an audio response.

## Architecture
- **Frontend**: Vite + React + Chrome Extension (Manifest V3). Uses Content Scripts to inject the HUD and an Options Page inside an Iframe to securely handle Camera & Microphone permissions.
- **Backend**: Python (FastAPI) utilizing the `google-genai` SDK (`gemini-2.5-flash`), packaged into a Docker container for deployment to Google Cloud Run.

---

## Spin-Up Instructions (Local Development)

### 1. Backend Setup
1. Open a terminal in the `backend/` folder.
2. Set your Gemini API Key in your environment variable:
   - Windows (PowerShell): `$env:GEMINI_API_KEY="your_api_key_here"`
   - Mac/Linux: `export GEMINI_API_KEY="your_api_key_here"`
3. Install dependencies: `pip install -r requirements.txt`
4. Run the server: `python -m uvicorn main:app --reload`
*The backend should now be listening on http://localhost:8000.*

### 2. Frontend Extension Setup
1. Open a terminal in the `extension/` folder.
2. Run `npm install` (if not done already).
3. Run `npm run build` to compile the extension.
4. Open Chrome and navigate to `chrome://extensions/`.
5. Enable "Developer mode" in the top right.
6. Click "Load unpacked" and select the `extension/dist` folder.
7. Navigate to any website (e.g., wikipedia.org). The **AeroBrowser HUD** will appear in the bottom right corner showing your camera. *Note: You will be prompted for Camera & Microphone permissions upon loading the extension.*

## Deployment to Google Cloud Run
This project includes a `Dockerfile` in the `/backend` directory.

1. Ensure you have the `gcloud` CLI installed and authenticated.
2. Navigate to `/backend`.
3. Submit the build to Google Cloud Build:
   `gcloud builds submit --tag gcr.io/[PROJECT-ID]/aerobrowser-backend`
4. Deploy to Cloud Run:
   `gcloud run deploy aerobrowser-backend --image gcr.io/[PROJECT-ID]/aerobrowser-backend --platform managed --allow-unauthenticated`
5. Once deployed, update the API URL `fetch('http://localhost:8000/api/barge-in')` in `extension/src/content/index.tsx` to the new Cloud Run URL and run `npm run build` again.
