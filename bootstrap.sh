#!/usr/bin/env bash
# ConsoleVault one-command bootstrap — NO Terraform, NO local image build.
#
# Deploys ConsoleVault into your own GCP project using ONLY gcloud, pulling prebuilt public images
# from GitHub Container Registry (Cloud Run can deploy public GHCR images directly). This is the
# easy path aimed at agency owners; the Terraform path (setup.sh) remains for large/advanced installs.
#
# It auto-detects your project + admin email, shows one summary to confirm, then stands everything
# up. Safe to re-run (idempotent). Override anything via CV_* env vars; CV_YES=1 is non-interactive.
#
# Usage:  ./bootstrap.sh
set -euo pipefail

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '  %s\n' "$1"; }
die() { printf '\033[31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }

# Retry a command a few times — smooths over fresh-project service-agent / API propagation lag.
retry() {
  local n=1 max="$1"; shift
  while :; do
    if "$@"; then return 0; fi
    [ "$n" -ge "$max" ] && return 1
    info "…transient (fresh-project provisioning lag); retry ${n}/${max} in 20s"
    sleep 20; n=$((n + 1))
  done
}

# --- Image source (prebuilt, public GHCR) ------------------------------------
IMAGE_OWNER="${CV_IMAGE_OWNER:-pdimo}"
IMAGE_TAG="${CV_VERSION:-latest}"
API_IMAGE="ghcr.io/${IMAGE_OWNER}/consolevault-api:${IMAGE_TAG}"
WORKER_IMAGE="ghcr.io/${IMAGE_OWNER}/consolevault-workers:${IMAGE_TAG}"
APP_NAME="consolevault"

bold "ConsoleVault bootstrap (no Terraform, no build)"

# --- Preflight (gcloud only — no terraform, no docker) -----------------------
command -v gcloud >/dev/null || die "gcloud CLI not found. Use Cloud Shell (it has gcloud) or install the Google Cloud SDK."
ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null || true)"
[ -n "${ACCOUNT}" ] || die "Not authenticated. Run: gcloud auth login && gcloud auth application-default login"
info "gcloud account: ${ACCOUNT}"

# --- Config (auto-detect; CV_* overrides; one confirm) -----------------------
PROJECT_ID="${CV_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"; [ "${PROJECT_ID}" = "(unset)" ] && PROJECT_ID=""
ADMINS="${CV_ADMIN_EMAILS:-${ACCOUNT}}"
REGION="${CV_REGION:-us-central1}"
BQ_LOCATION="${CV_BQ_LOCATION:-US}"
BILLING="${CV_BILLING_ACCOUNT:-}"

prompt_config() {
  local x
  read -r -p "  GCP project id [${PROJECT_ID}]: " x; PROJECT_ID="${x:-$PROJECT_ID}"
  read -r -p "  BQ + Firestore location — PERMANENT (US, EU, or a region e.g. australia-southeast1) [${BQ_LOCATION}]: " x; BQ_LOCATION="${x:-$BQ_LOCATION}"
  read -r -p "  Cloud Run region (e.g. us-central1, australia-southeast1) [${REGION}]: " x; REGION="${x:-$REGION}"
  read -r -p "  Admin email(s), comma-separated [${ADMINS}]: " x; ADMINS="${x:-$ADMINS}"
}
show_summary() {
  bold "Bootstrap settings"
  info "project id    : ${PROJECT_ID:-<none — run: gcloud config set project ID>}"
  info "bq_location   : ${BQ_LOCATION}   (PERMANENT — cannot change later)"
  info "region        : ${REGION}"
  info "admin email(s): ${ADMINS}"
  info "images        : ${API_IMAGE%:*}:${IMAGE_TAG} + workers"
}
if [ "${CV_YES:-}" != "1" ]; then
  while :; do
    show_summary
    printf '  Press Enter to deploy, or type "edit" to change: '
    read -r ans || ans=""
    case "${ans}" in
      "" | y | Y | yes) break ;;
      edit | e | E) prompt_config ;;
      *) info "…press Enter to accept, or type 'edit'." ;;
    esac
  done
fi
[ -n "${PROJECT_ID}" ] || die "No project set. Run: gcloud config set project PROJECT_ID (or set CV_PROJECT_ID), then re-run."

# Validate region + the PERMANENT location BEFORE creating anything (Firestore can't be moved later).
echo "${REGION}" | grep -Eq '^[a-z]+-[a-z]+[0-9]+$' \
  || die "Invalid Cloud Run region '${REGION}'. Use a full region id like us-central1 or australia-southeast1 — not a country code."
case "${BQ_LOCATION^^}" in
  US) BQ_LOCATION="US"; FIRESTORE_LOCATION="nam5" ;;
  EU) BQ_LOCATION="EU"; FIRESTORE_LOCATION="eur3" ;;
  *)
    echo "${BQ_LOCATION}" | grep -Eq '^[a-z]+-[a-z]+[0-9]+$' \
      || die "Invalid location '${BQ_LOCATION}'. BigQuery/Firestore support US, EU, or a single region like australia-southeast1 — there is no 'AU' multi-region."
    FIRESTORE_LOCATION="${BQ_LOCATION}"
    ;;
esac

gcloud config set project "${PROJECT_ID}" >/dev/null 2>&1 || true
# Set the ADC quota project too, so bq/storage calls don't hit a missing-quota-project error.
gcloud auth application-default set-quota-project "${PROJECT_ID}" >/dev/null 2>&1 || true

SA_API="sa-api@${PROJECT_ID}.iam.gserviceaccount.com"
SA_COLLECTOR="sa-collector@${PROJECT_ID}.iam.gserviceaccount.com"
SA_WORKFLOWS="sa-workflows@${PROJECT_ID}.iam.gserviceaccount.com"
STAGING_BUCKET="${PROJECT_ID}-staging"
G="gcloud --project=${PROJECT_ID} --quiet"

# --- Enable APIs -------------------------------------------------------------
bold "Enabling Google Cloud APIs (first time on a new project takes a minute)"
${G} services enable \
  cloudresourcemanager.googleapis.com serviceusage.googleapis.com iam.googleapis.com \
  searchconsole.googleapis.com bigquery.googleapis.com firestore.googleapis.com \
  run.googleapis.com cloudtasks.googleapis.com workflows.googleapis.com \
  cloudscheduler.googleapis.com workflowexecutions.googleapis.com \
  secretmanager.googleapis.com storage.googleapis.com logging.googleapis.com \
  monitoring.googleapis.com billingbudgets.googleapis.com

# --- Service accounts --------------------------------------------------------
bold "Service accounts"
ensure_sa() { # id display
  ${G} iam service-accounts describe "$1@${PROJECT_ID}.iam.gserviceaccount.com" >/dev/null 2>&1 \
    || ${G} iam service-accounts create "$1" --display-name="$2" >/dev/null
  info "sa: $1"
}
ensure_sa sa-collector "ConsoleVault collector worker"
ensure_sa sa-api "ConsoleVault control-plane API / UI"
ensure_sa sa-workflows "ConsoleVault workflows / planner"

# --- Project IAM (mirrors terraform/iam.tf) ----------------------------------
# NOTE: for a simple single-tenant install, BigQuery data access is granted at PROJECT level
# (dataEditor) rather than per-dataset as the Terraform path does. The project holds only GSC data
# and only ConsoleVault's own SAs — an acceptable simplification for the easy path.
bold "IAM role bindings"
grant() { ${G} projects add-iam-policy-binding "${PROJECT_ID}" --member="serviceAccount:$1" --role="$2" --condition=None >/dev/null; }
API_ROLES=(datastore.user secretmanager.admin bigquery.user bigquery.dataEditor workflows.invoker workflows.viewer cloudtasks.queueAdmin logging.logWriter monitoring.metricWriter monitoring.notificationChannelEditor monitoring.alertPolicyEditor)
COLLECTOR_ROLES=(secretmanager.secretAccessor bigquery.jobUser bigquery.dataEditor datastore.user logging.logWriter monitoring.metricWriter)
WORKFLOWS_ROLES=(datastore.user secretmanager.secretAccessor cloudtasks.admin workflows.invoker run.invoker logging.logWriter bigquery.user bigquery.dataEditor)
for r in "${API_ROLES[@]}"; do grant "${SA_API}" "roles/${r}"; done
for r in "${COLLECTOR_ROLES[@]}"; do grant "${SA_COLLECTOR}" "roles/${r}"; done
for r in "${WORKFLOWS_ROLES[@]}"; do grant "${SA_WORKFLOWS}" "roles/${r}"; done

# SA impersonation / actAs (terraform/iam.tf §impersonation)
sa_grant() { ${G} iam service-accounts add-iam-policy-binding "$1" --member="serviceAccount:$2" --role="$3" >/dev/null; }
sa_grant "${SA_COLLECTOR}" "${SA_API}" roles/iam.serviceAccountTokenCreator
sa_grant "${SA_COLLECTOR}" "${SA_WORKFLOWS}" roles/iam.serviceAccountTokenCreator
sa_grant "${SA_COLLECTOR}" "${SA_WORKFLOWS}" roles/iam.serviceAccountUser
info "impersonation wired"

# --- Firestore (control plane; PERMANENT location) ---------------------------
bold "Firestore (Native) — location ${FIRESTORE_LOCATION} (permanent)"
${G} firestore databases describe --database='(default)' >/dev/null 2>&1 \
  || ${G} firestore databases create --location="${FIRESTORE_LOCATION}" --type=firestore-native >/dev/null
info "firestore ready"

# --- Session secret ----------------------------------------------------------
bold "Session secret"
if ! ${G} secrets describe session-secret >/dev/null 2>&1; then
  ${G} secrets create session-secret --replication-policy=automatic >/dev/null
  # 64-char hex secret; never printed. (openssl avoids a SIGPIPE-under-pipefail from head/tr.)
  printf '%s' "$(openssl rand -hex 32)" | ${G} secrets versions add session-secret --data-file=- >/dev/null
fi
info "session-secret ready"

# --- Admin password (the OAuth-client-free login) ----------------------------
# A bootstrap-generated password lets the admin sign in WITHOUT creating a Google OAuth client.
# Generated once and stored in Secret Manager; printed at the end only when freshly created.
bold "Admin login password"
ADMIN_PW=""
if ${G} secrets describe admin-password >/dev/null 2>&1; then
  info "already set — retrieve with: gcloud secrets versions access latest --secret=admin-password --project=${PROJECT_ID}"
else
  ${G} secrets create admin-password --replication-policy=automatic >/dev/null
  ADMIN_PW="$(openssl rand -hex 16)"
  printf '%s' "${ADMIN_PW}" | ${G} secrets versions add admin-password --data-file=- >/dev/null
  info "generated (shown at the end)"
fi

# --- Staging bucket ----------------------------------------------------------
bold "Staging bucket gs://${STAGING_BUCKET}"
if ! gcloud storage buckets describe "gs://${STAGING_BUCKET}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${STAGING_BUCKET}" --project="${PROJECT_ID}" --location="${REGION}" --uniform-bucket-level-access >/dev/null
fi
# 7-day lifecycle (transient NDJSON)
printf '{"rule":[{"action":{"type":"Delete"},"condition":{"age":7}}]}' >/tmp/cv-lifecycle.json
gcloud storage buckets update "gs://${STAGING_BUCKET}" --lifecycle-file=/tmp/cv-lifecycle.json >/dev/null 2>&1 || true
gcloud storage buckets add-iam-policy-binding "gs://${STAGING_BUCKET}" --member="serviceAccount:${SA_COLLECTOR}" --role=roles/storage.objectAdmin >/dev/null
info "staging bucket ready"

# --- BigQuery datasets -------------------------------------------------------
bold "BigQuery datasets (${BQ_LOCATION})"
ensure_ds() { bq --project_id="${PROJECT_ID}" show "${PROJECT_ID}:$1" >/dev/null 2>&1 || bq --project_id="${PROJECT_ID}" --location="${BQ_LOCATION}" mk --dataset "${PROJECT_ID}:$1" >/dev/null; info "dataset: $1"; }
for ds in gsc_byProperty gsc_byPage gsc_totals gsc_views task_logs billing_export; do ensure_ds "$ds"; done

# --- Cloud Run services (prebuilt GHCR images) -------------------------------
COMMON_ENV="BQ_LOCATION=${BQ_LOCATION},GCP_PROJECT_ID=${PROJECT_ID},GCP_REGION=${REGION},STAGING_BUCKET=${STAGING_BUCKET}"
run_deploy() { ${G} run deploy "$@" --region="${REGION}" --platform=managed >/dev/null; }

bold "Deploying collector (${WORKER_IMAGE})"
run_deploy "${APP_NAME}-collector" --image="${WORKER_IMAGE}" --service-account="${SA_COLLECTOR}" \
  --no-allow-unauthenticated --timeout=600 --set-env-vars="${COMMON_ENV},TASK_MAX_ATTEMPTS=8"
${G} run services add-iam-policy-binding "${APP_NAME}-collector" --region="${REGION}" \
  --member="serviceAccount:${SA_COLLECTOR}" --role=roles/run.invoker >/dev/null
COLLECTOR_URL="$(${G} run services describe "${APP_NAME}-collector" --region="${REGION}" --format='value(status.url)')"

bold "Deploying orchestrator (${WORKER_IMAGE})"
run_deploy "${APP_NAME}-orchestrator" --image="${WORKER_IMAGE}" --service-account="${SA_WORKFLOWS}" \
  --no-allow-unauthenticated --timeout=1800 --set-env-vars="${COMMON_ENV},TASK_MAX_ATTEMPTS=8,COLLECTOR_URL=${COLLECTOR_URL}"
ORCH_URL="$(${G} run services describe "${APP_NAME}-orchestrator" --region="${REGION}" --format='value(status.url)')"

bold "Deploying api (${API_IMAGE})"
# api's ADMIN_EMAILS may contain commas → use a custom (##) delimiter for --set-env-vars.
API_ENV="^##^ADMIN_EMAILS=${ADMINS}##APP_NAME=${APP_NAME}##BILLING_EXPORT_DATASET=billing_export##${COMMON_ENV//,/##}"
run_deploy "${APP_NAME}-api" --image="${API_IMAGE}" --service-account="${SA_API}" \
  --allow-unauthenticated --set-env-vars="${API_ENV}" --set-secrets="SESSION_SECRET=session-secret:latest,ADMIN_PASSWORD=admin-password:latest"
API_URL="$(${G} run services describe "${APP_NAME}-api" --region="${REGION}" --format='value(status.url)')"

# --- Daily orchestration (Workflow + Scheduler) ------------------------------
# "Run pipeline now" and the daily run both trigger this Workflow (apps/api/src/management.ts).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${SCRIPT_DIR}/terraform/workflows/daily.yaml" ]; then
  bold "Daily workflow + schedule"
  # Fresh projects lag in provisioning the Workflows service agent — force it, then retry the deploy.
  ${G} beta services identity create --service=workflows.googleapis.com >/dev/null 2>&1 || true
  TMP_WF="$(mktemp)"; sed "s#__ORCHESTRATOR_URL__#${ORCH_URL}#g" "${SCRIPT_DIR}/terraform/workflows/daily.yaml" >"${TMP_WF}"
  retry 6 ${G} workflows deploy "${APP_NAME}-daily" --source="${TMP_WF}" --location="${REGION}" --service-account="${SA_WORKFLOWS}"
  rm -f "${TMP_WF}"
  WF_URI="https://workflowexecutions.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/workflows/${APP_NAME}-daily/executions"
  ${G} scheduler jobs describe "${APP_NAME}-daily" --location="${REGION}" >/dev/null 2>&1 \
    || ${G} scheduler jobs create http "${APP_NAME}-daily" --location="${REGION}" --schedule="0 9 * * *" --time-zone="America/Los_Angeles" \
         --uri="${WF_URI}" --http-method=POST --oauth-service-account-email="${SA_WORKFLOWS}" >/dev/null
  ${G} scheduler jobs describe "${APP_NAME}-token-health" --location="${REGION}" >/dev/null 2>&1 \
    || ${G} scheduler jobs create http "${APP_NAME}-token-health" --location="${REGION}" --schedule="0 */6 * * *" --time-zone="America/Los_Angeles" \
         --uri="${ORCH_URL}/token-health-sweep" --http-method=POST \
         --oidc-service-account-email="${SA_WORKFLOWS}" --oidc-token-audience="${ORCH_URL}" >/dev/null
  info "daily schedule ready"
fi

# --- Done --------------------------------------------------------------------
echo
bold "✅ ConsoleVault is deployed."
info "Management UI: ${API_URL}"
echo
if [ -n "${ADMIN_PW}" ]; then
  bold "Admin password (save it now — shown only once)"
  info "${ADMIN_PW}"
  echo
fi
bold "Next steps (all in the browser — no OAuth client, no consent screen)"
info "1. Open ${API_URL} and sign in with the admin password above."
info "2. Add this collector as a user on each Search Console property you manage:"
info "     ${SA_COLLECTOR}"
info "3. Include the properties you want and run the pipeline (Jobs → Run now)."
