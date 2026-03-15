#!/usr/bin/env bash
# deploy.sh — Automated deployment to Google Cloud Run
# Usage: ./deploy.sh
#
# Prerequisites:
#   - gcloud CLI authenticated (gcloud auth login)
#   - Node.js 20+ and npm installed
#   - GCP_PROJECT_ID environment variable set (your Google Cloud project ID)
#   - GEMINI_API_KEY environment variable set
#
# This script:
#   1. Builds the React frontend → backend/static/
#   2. Submits the Docker build to Cloud Build
#   3. Deploys to Cloud Run with Playwright-compatible resources
set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────
if [ -z "${GCP_PROJECT_ID:-}" ]; then
  echo "ERROR: GCP_PROJECT_ID environment variable is not set."
  echo "  export GCP_PROJECT_ID='your-project-id'"
  exit 1
fi
if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "ERROR: GEMINI_API_KEY environment variable is not set."
  echo "  export GEMINI_API_KEY='your-key-here'"
  exit 1
fi

PROJECT_ID="${GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-aerobrowser-backend}"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "==> [1/3] Building frontend..."
cd frontend
npm ci --silent
npm run build
cd ..

echo "==> [2/3] Building Docker image via Cloud Build..."
cd backend
gcloud builds submit --tag "${IMAGE}" --project "${PROJECT_ID}" --quiet
cd ..

echo "==> [3/3] Deploying to Cloud Run (${REGION})..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --platform managed \
  --memory 2Gi \
  --cpu 2 \
  --timeout 900 \
  --set-env-vars "GEMINI_API_KEY=${GEMINI_API_KEY}" \
  --allow-unauthenticated \
  --quiet

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --format 'value(status.url)')

echo ""
echo "==> Deployment complete!"
echo "    URL: ${SERVICE_URL}"
