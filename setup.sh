#!/usr/bin/env bash
# ConsoleVault one-command deploy.
#
# Stands up the whole product in your own GCP project: Firestore + BigQuery + 3 least-privilege
# service accounts + Cloud Run (api/collector/orchestrator) + Cloud Tasks/Workflows/Scheduler +
# Secret Manager + Monitoring alerts + a billing budget — all via Terraform.
#
# Safe to re-run (idempotent). It NEVER writes secrets to disk or the repo. After it finishes,
# connect your Google accounts in the UI (see docs/AUTH.md).
#
# Usage:  ./setup.sh
set -euo pipefail

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '  %s\n' "$1"; }
die() { printf '\033[31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${REPO_ROOT}"

bold "ConsoleVault setup"

# --- Preflight ---------------------------------------------------------------
command -v gcloud >/dev/null || die "gcloud CLI not found. Install the Google Cloud SDK."
command -v terraform >/dev/null || die "terraform not found. Install Terraform >= 1.5."
command -v pnpm >/dev/null || die "pnpm not found. Install Node 20+ and 'npm i -g pnpm'."
command -v docker >/dev/null || die "docker not found (needed to build images)."

ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null || true)"
[ -n "${ACCOUNT}" ] || die "Not authenticated. Run: gcloud auth login && gcloud auth application-default login"
info "gcloud account: ${ACCOUNT}"

# --- Config (terraform.tfvars) ----------------------------------------------
TFVARS="terraform/terraform.tfvars"
if [ ! -f "${TFVARS}" ]; then
  bold "No terraform/terraform.tfvars yet — let's create one."
  read -r -p "  GCP project id: " PROJECT_ID
  [ -n "${PROJECT_ID}" ] || die "project id is required."
  read -r -p "  BigQuery + Firestore location [US]: " BQ_LOCATION; BQ_LOCATION="${BQ_LOCATION:-US}"
  read -r -p "  Cloud Run region [us-central1]: " REGION; REGION="${REGION:-us-central1}"
  read -r -p "  Admin email(s) for UI sign-in (comma-separated): " ADMINS
  read -r -p "  Billing account id for the budget (blank to skip): " BILLING
  STATE_BUCKET="${PROJECT_ID}-tfstate"

  ADMIN_JSON="$(printf '%s' "${ADMINS}" | awk -F, '{for(i=1;i<=NF;i++){gsub(/^ +| +$/,"",$i);printf "%s\"%s\"",(i>1?", ":""),$i}}')"
  cat > "${TFVARS}" <<EOF
project_id   = "${PROJECT_ID}"
state_bucket = "${STATE_BUCKET}"
bq_location  = "${BQ_LOCATION}"
region       = "${REGION}"
admin_emails = [${ADMIN_JSON}]
billing_account = "${BILLING}"
EOF
  info "Wrote ${TFVARS}"
else
  info "Using existing ${TFVARS}"
fi

PROJECT_ID="$(awk -F'"' '/project_id/{print $2}' "${TFVARS}")"
REGION="$(awk -F'"' '/^region/{print $2}' "${TFVARS}")"; REGION="${REGION:-us-central1}"
STATE_BUCKET="$(awk -F'"' '/state_bucket/{print $2}' "${TFVARS}")"
gcloud config set project "${PROJECT_ID}" >/dev/null 2>&1 || true

# Billing budgets API requires a quota project under user ADC.
gcloud auth application-default set-quota-project "${PROJECT_ID}" >/dev/null 2>&1 || true

# --- State bucket ------------------------------------------------------------
if ! gcloud storage buckets describe "gs://${STATE_BUCKET}" >/dev/null 2>&1; then
  bold "Creating versioned Terraform state bucket gs://${STATE_BUCKET}"
  gcloud storage buckets create "gs://${STATE_BUCKET}" --project="${PROJECT_ID}" --location="${REGION}" --uniform-bucket-level-access
  gcloud storage buckets update "gs://${STATE_BUCKET}" --versioning
fi

# --- Terraform: bootstrap (creates Artifact Registry, datasets, SAs, APIs…) --
bold "terraform init"
terraform -chdir=terraform init -input=false -backend-config="bucket=${STATE_BUCKET}"

bold "terraform apply (bootstrap — creates the Artifact Registry repo + infra)"
terraform -chdir=terraform apply -input=false

# --- Build + push images, then deploy them -----------------------------------
bold "Building & pushing images"
TAG="$(git rev-parse --short HEAD 2>/dev/null || date +%s)"
APP_NAME="$(awk -F'"' '/^app_name/{print $2}' "${TFVARS}")"; APP_NAME="${APP_NAME:-consolevault}"
scripts/build-push.sh api     "${TAG}" "${PROJECT_ID}" "${REGION}" "${APP_NAME}"
scripts/build-push.sh workers "${TAG}" "${PROJECT_ID}" "${REGION}" "${APP_NAME}"

# Persist the deployed image refs (auto-loaded, gitignored) so future `terraform apply` redeploys
# the CURRENT images, never the placeholder.
cat > terraform/images.auto.tfvars <<EOF
api_image    = "${REGION}-docker.pkg.dev/${PROJECT_ID}/${APP_NAME}/api:${TAG}"
worker_image = "${REGION}-docker.pkg.dev/${PROJECT_ID}/${APP_NAME}/workers:${TAG}"
EOF

bold "terraform apply (deploy the application images)"
terraform -chdir=terraform apply -input=false

# --- Done --------------------------------------------------------------------
API_URL="$(terraform -chdir=terraform output -raw api_url 2>/dev/null || true)"
bold "✅ ConsoleVault is deployed."
info "Management UI: ${API_URL}"
echo
bold "Next steps"
info "1. Open the UI and sign in with an admin email you configured."
info "2. Connect your Google account(s): see docs/AUTH.md (OAuth client setup)."
info "3. Set your alert email in Settings (enables token-health / error alerts)."
info "4. Include the properties you want, then run the pipeline (Jobs → Run now)."
