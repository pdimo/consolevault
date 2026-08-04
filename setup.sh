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

# Terraform is NO LONGER preinstalled in Cloud Shell (Google removed it). Worse, Cloud Shell ships
# a shim named `terraform` that just prints install hints and exits 0 — which would make our applies
# silently no-op. So verify a REAL terraform (its `version` output starts with "Terraform v"), and
# if it's missing/shimmed, install a pinned copy into the home dir and prepend it to PATH.
have_real_terraform() { terraform version 2>/dev/null | grep -qiE '^Terraform v'; }
ensure_terraform() {
  if have_real_terraform; then
    info "terraform: $(terraform version 2>/dev/null | head -1)"
    return 0
  fi
  local ver os arch tmp bindir="${HOME}/.consolevault/bin"
  ver="${CV_TF_VERSION:-}"
  if [ -z "${ver}" ]; then
    ver="$(curl -fsSL https://checkpoint-api.hashicorp.com/v1/check/terraform 2>/dev/null \
      | grep -o '"current_version":"[^"]*"' | head -1 | cut -d'"' -f4)"
    [ -n "${ver}" ] || ver="1.9.8"
  fi
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  case "$(uname -m)" in
    x86_64 | amd64) arch=amd64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) die "Unsupported CPU architecture $(uname -m). Install Terraform >= 1.5 manually and re-run." ;;
  esac
  command -v curl >/dev/null || die "curl not found; can't auto-install Terraform. Install it manually."
  command -v unzip >/dev/null || die "unzip not found; can't auto-install Terraform. Install it manually."
  bold "Installing Terraform ${ver} (Cloud Shell no longer ships it)…"
  mkdir -p "${bindir}"
  tmp="$(mktemp -d)"
  curl -fsSL -o "${tmp}/terraform.zip" \
    "https://releases.hashicorp.com/terraform/${ver}/terraform_${ver}_${os}_${arch}.zip" \
    || die "Failed to download Terraform ${ver}."
  unzip -oq "${tmp}/terraform.zip" -d "${bindir}" || die "Failed to unpack Terraform."
  rm -rf "${tmp}"
  export PATH="${bindir}:${PATH}"
  have_real_terraform || die "Terraform still not runnable after install."
  info "Installed terraform → ${bindir} ($(terraform version 2>/dev/null | head -1))"
}

# terraform apply: interactive first (you review the plan), then auto-retry transient failures.
# Fresh projects have API + service-agent propagation lag (e.g. the Workflows service agent), so a
# first bootstrap can need a retry even after the APIs are enabled.
tf_apply() {
  terraform -chdir=terraform apply -input=false && return 0
  local n=1
  while [ "${n}" -le 2 ]; do
    info "…transient new-project timing issue; retrying in 20s (retry ${n}/2)"
    sleep 20
    terraform -chdir=terraform apply -input=false -auto-approve && return 0
    n=$((n + 1))
  done
  return 1
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${REPO_ROOT}"

bold "ConsoleVault setup"

# --- Preflight ---------------------------------------------------------------
# Only gcloud + terraform are needed — images build in Cloud Build (no local Docker or Node).
# Cloud Shell ships gcloud; Terraform was removed from Cloud Shell, so ensure_terraform installs it.
command -v gcloud >/dev/null || die "gcloud CLI not found. Install the Google Cloud SDK, or run this in Cloud Shell."
ensure_terraform

ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null || true)"
[ -n "${ACCOUNT}" ] || die "Not authenticated. Run: gcloud auth login && gcloud auth application-default login"
info "gcloud account: ${ACCOUNT}"

# --- Config (terraform.tfvars) ----------------------------------------------
# Prompt-free by default: auto-detect the project + admin email from gcloud, apply
# sensible defaults, and show ONE summary to confirm. Override any value up front with
# an env var (CV_PROJECT_ID / CV_BQ_LOCATION / CV_REGION / CV_ADMIN_EMAILS /
# CV_BILLING_ACCOUNT) or by typing 'edit' at the confirm prompt. CV_YES=1 skips the
# confirm entirely (fully non-interactive, for CI/automation).
TFVARS="terraform/terraform.tfvars"
if [ -f "${TFVARS}" ]; then
  info "Using existing ${TFVARS} (delete it to reconfigure)."
else
  PROJECT_ID="${CV_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
  ADMINS="${CV_ADMIN_EMAILS:-$(gcloud config get-value account 2>/dev/null)}"
  REGION="${CV_REGION:-us-central1}"
  BQ_LOCATION="${CV_BQ_LOCATION:-US}"
  BILLING="${CV_BILLING_ACCOUNT:-}"
  # gcloud prints "(unset)" for an unset value — treat that as empty.
  [ "${PROJECT_ID}" = "(unset)" ] && PROJECT_ID=""
  [ "${ADMINS}" = "(unset)" ] && ADMINS=""

  prompt_config() {
    local x
    read -r -p "  GCP project id [${PROJECT_ID}]: " x; PROJECT_ID="${x:-$PROJECT_ID}"
    read -r -p "  BigQuery + Firestore location — PERMANENT [${BQ_LOCATION}]: " x; BQ_LOCATION="${x:-$BQ_LOCATION}"
    read -r -p "  Cloud Run region [${REGION}]: " x; REGION="${x:-$REGION}"
    read -r -p "  Admin email(s), comma-separated [${ADMINS}]: " x; ADMINS="${x:-$ADMINS}"
    read -r -p "  Billing account id (blank to skip the budget) [${BILLING}]: " x; BILLING="${x:-$BILLING}"
  }

  show_summary() {
    bold "Deploy settings"
    info "project id    : ${PROJECT_ID:-<none — run: gcloud config set project ID>}"
    info "bq_location   : ${BQ_LOCATION}   (PERMANENT — cannot change later)"
    info "region        : ${REGION}"
    info "admin email(s): ${ADMINS:-<none>}"
    info "billing acct  : ${BILLING:-<skip budget>}"
  }

  if [ "${CV_YES:-}" != "1" ]; then
    while :; do
      show_summary
      printf '  Press Enter to deploy, or type "edit" to change any value: '
      read -r ans || ans=""
      case "${ans}" in
        "" | y | Y | yes) break ;;
        edit | e | E) prompt_config ;;
        *) info "…press Enter to accept, or type 'edit'." ;;
      esac
    done
  fi

  [ -n "${PROJECT_ID}" ] || die "No project set. Run: gcloud config set project PROJECT_ID  (or set CV_PROJECT_ID), then re-run ./setup.sh"
  [ -n "${ADMINS}" ] || die "No admin email. Sign in with 'gcloud auth login' (or set CV_ADMIN_EMAILS), then re-run ./setup.sh"
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
fi

PROJECT_ID="$(awk -F'"' '/project_id/{print $2}' "${TFVARS}")"
REGION="$(awk -F'"' '/^region/{print $2}' "${TFVARS}")"; REGION="${REGION:-us-central1}"
STATE_BUCKET="$(awk -F'"' '/state_bucket/{print $2}' "${TFVARS}")"
gcloud config set project "${PROJECT_ID}" >/dev/null 2>&1 || true

# Billing budgets API requires a quota project under user ADC.
gcloud auth application-default set-quota-project "${PROJECT_ID}" >/dev/null 2>&1 || true

# --- Enable APIs BEFORE Terraform --------------------------------------------
# The Terraform google provider routes calls through this project (user_project_override), so the
# base APIs (Cloud Resource Manager, Service Usage) must be on first or the very first apply fails
# with a 403. Enabling everything up front also avoids per-resource enable races during apply.
bold "Enabling Google Cloud APIs (first time on a new project takes a minute)"
gcloud services enable \
  cloudresourcemanager.googleapis.com serviceusage.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com bigquery.googleapis.com \
  firestore.googleapis.com run.googleapis.com cloudtasks.googleapis.com \
  workflows.googleapis.com workflowexecutions.googleapis.com cloudscheduler.googleapis.com \
  secretmanager.googleapis.com storage.googleapis.com logging.googleapis.com \
  monitoring.googleapis.com billingbudgets.googleapis.com searchconsole.googleapis.com \
  --project="${PROJECT_ID}"

# --- State bucket ------------------------------------------------------------
if ! gcloud storage buckets describe "gs://${STATE_BUCKET}" >/dev/null 2>&1; then
  bold "Creating versioned Terraform state bucket gs://${STATE_BUCKET}"
  gcloud storage buckets create "gs://${STATE_BUCKET}" --project="${PROJECT_ID}" --location="${REGION}" --uniform-bucket-level-access
  gcloud storage buckets update "gs://${STATE_BUCKET}" --versioning
fi

# --- Terraform: bootstrap (creates Artifact Registry, datasets, SAs, APIs…) --
bold "terraform init"
terraform -chdir=terraform init -input=false -backend-config="bucket=${STATE_BUCKET}"

bold "terraform apply (bootstrap — creates the Artifact Registry repo + infra). Takes ~10–15 min."
tf_apply || die "Bootstrap apply failed after retries. New-project API/service-agent provisioning can lag — wait a minute and re-run ./setup.sh (it's safe to re-run)."

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
tf_apply || die "Deploy apply failed after retries — re-run ./setup.sh (it's safe to re-run)."

# --- Done --------------------------------------------------------------------
API_URL="$(terraform -chdir=terraform output -raw api_url 2>/dev/null || true)"
bold "✅ ConsoleVault is deployed."
info "Management UI: ${API_URL}"
echo

# --- Web OAuth client (needed for browser sign-in) ---------------------------
# The app can't create this (Google only allows it in the Console), but the in-app setup wizard
# shows the exact values to paste. Here we just upload the JSON you downloaded, as YOUR ADC —
# no secret ever transits the browser.
WEB_SECRET="oauth-web-client-config"
if gcloud secrets versions list "${WEB_SECRET}" --project="${PROJECT_ID}" --limit=1 \
    --format='value(name)' 2>/dev/null | grep -q .; then
  info "Web OAuth client: already configured."
else
  bold "One more step — the Web OAuth client for browser sign-in"
  info "Open ${API_URL} — the app shows the exact Console values to create a Web OAuth client"
  info "(Authorized JavaScript origin + redirect URI). Create it there, then download its JSON."
  read -r -p "  Path to the downloaded Web client JSON (blank to do this later): " WEBJSON
  if [ -n "${WEBJSON}" ]; then
    WEBJSON="${WEBJSON/#\~/$HOME}"
    [ -f "${WEBJSON}" ] || die "File not found: ${WEBJSON}"
    gcloud secrets create "${WEB_SECRET}" --project="${PROJECT_ID}" \
      --replication-policy=automatic >/dev/null 2>&1 || true
    gcloud secrets versions add "${WEB_SECRET}" --project="${PROJECT_ID}" \
      --data-file="${WEBJSON}" >/dev/null
    info "Uploaded. Browser sign-in is now enabled — refresh ${API_URL}."
  else
    info "Skipped. Re-run ./setup.sh with the file when ready (the app guides you at ${API_URL})."
  fi
fi
echo

bold "Next steps"
info "1. Open ${API_URL}. First run shows a guided OAuth setup wizard, then sign in as an admin."
info "2. Connect your Google account(s) with the in-app 'Connect Google account' button."
info "3. Set your alert email in Settings (enables token-health / error alerts)."
info "4. Include the properties you want, then run the pipeline (Jobs → Run now)."
