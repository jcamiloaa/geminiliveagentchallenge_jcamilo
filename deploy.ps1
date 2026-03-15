# deploy.ps1 — Automated deployment to Google Cloud Run (Windows PowerShell)
# Usage: .\deploy.ps1
#
# Prerequisites:
#   - gcloud CLI authenticated (gcloud auth login)
#   - Node.js 20+ and npm installed
#   - $env:GCP_PROJECT_ID set (your Google Cloud project ID)
#   - $env:GEMINI_API_KEY set
#
# This script:
#   1. Builds the React frontend → backend/static/
#   2. Submits the Docker build to Cloud Build
#   3. Deploys to Cloud Run with Playwright-compatible resources

$ErrorActionPreference = "Stop"

# ── Configuration ──────────────────────────────────────────────────
if (-not $env:GCP_PROJECT_ID) {
    Write-Error "GCP_PROJECT_ID is not set. Run: `$env:GCP_PROJECT_ID='your-project-id'"
    exit 1
}
if (-not $env:GEMINI_API_KEY) {
    Write-Error "GEMINI_API_KEY is not set. Run: `$env:GEMINI_API_KEY='your-key-here'"
    exit 1
}

$PROJECT_ID  = $env:GCP_PROJECT_ID
$REGION      = if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" }
$SERVICE     = if ($env:SERVICE_NAME) { $env:SERVICE_NAME } else { "aerobrowser-backend" }
$IMAGE       = "gcr.io/$PROJECT_ID/$SERVICE"

Write-Host "`n==> [1/3] Building frontend..." -ForegroundColor Cyan
Push-Location frontend
npm ci --silent
npm run build
Pop-Location

Write-Host "`n==> [2/3] Building Docker image via Cloud Build..." -ForegroundColor Cyan
Push-Location backend
gcloud builds submit --tag $IMAGE --project $PROJECT_ID --quiet
Pop-Location

Write-Host "`n==> [3/3] Deploying to Cloud Run ($REGION)..." -ForegroundColor Cyan
gcloud run deploy $SERVICE `
    --image $IMAGE `
    --project $PROJECT_ID `
    --region $REGION `
    --platform managed `
    --memory 2Gi `
    --cpu 2 `
    --timeout 900 `
    --set-env-vars "GEMINI_API_KEY=$($env:GEMINI_API_KEY)" `
    --allow-unauthenticated `
    --quiet

$SERVICE_URL = gcloud run services describe $SERVICE --project $PROJECT_ID --region $REGION --format "value(status.url)"

Write-Host "`n==> Deployment complete!" -ForegroundColor Green
Write-Host "    URL: $SERVICE_URL"
