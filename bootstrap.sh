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
# GHCR tags carry no leading "v" (docker/metadata-action strips it), so accept either form.
IMAGE_TAG="${CV_VERSION:-latest}"; IMAGE_TAG="${IMAGE_TAG#v}"
API_IMAGE="ghcr.io/${IMAGE_OWNER}/consolevault-api:${IMAGE_TAG}"
WORKER_IMAGE="ghcr.io/${IMAGE_OWNER}/consolevault-workers:${IMAGE_TAG}"
APP_NAME="consolevault"

bold "ConsoleVault bootstrap (no Terraform, no build)"

# --- Preflight (gcloud only — no terraform, no docker) -----------------------
command -v gcloud >/dev/null || die "gcloud CLI not found. Use Cloud Shell (it has gcloud) or install the Google Cloud SDK."
active_account() { gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null || true; }
ACCOUNT="$(active_account)"
# A fresh Cloud Shell session hasn't authorized gcloud yet — sign the user in for them (interactive
# only; automation should pre-authenticate and set CV_YES=1).
if [ -z "${ACCOUNT}" ] && [ "${CV_YES:-}" != "1" ]; then
  bold "Let's sign you in to Google Cloud — approve the authorization prompt that appears."
  gcloud auth login || true
  ACCOUNT="$(active_account)"
fi
[ -n "${ACCOUNT}" ] || die "Sign-in didn't complete. Run 'gcloud auth login', then re-run ./bootstrap.sh."
info "gcloud account: ${ACCOUNT}"

# --- Config (friendly menus for non-technical users; CV_* + CV_YES for automation) ---
# The target user isn't technical and won't know region ids, so location + project are PICKERS,
# not free text. Automation can still pass CV_PROJECT_ID / CV_BQ_LOCATION / CV_REGION / CV_YES=1.
PROJECT_ID="${CV_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"; [ "${PROJECT_ID}" = "(unset)" ] && PROJECT_ID=""
ADMINS="${CV_ADMIN_EMAILS:-${ACCOUNT}}"
REGION="${CV_REGION:-}"
BQ_LOCATION="${CV_BQ_LOCATION:-}"
FIRESTORE_LOCATION=""
BILLING="${CV_BILLING_ACCOUNT:-}"

# A "location" bundles the BigQuery/Firestore location, the Cloud Run region, and the Firestore
# location id — co-located by default (US/EU are multi-regions; everything else is one region).
set_location() { BQ_LOCATION="$1"; REGION="$2"; FIRESTORE_LOCATION="$3"; }
set_location_from_input() {
  case "${1^^}" in
    US) set_location US us-central1 nam5 ;;
    EU) set_location EU europe-west1 eur3 ;;
    *) echo "$1" | grep -Eq '^[a-z]+-[a-z]+[0-9]+$' || return 1; set_location "$1" "$1" "$1" ;;
  esac
}

choose_location() {
  bold "Where should your data live?  (PERMANENT — pick the option closest to you)"
  info "  1) United States"
  info "  2) Europe"
  info "  3) Australia — Sydney"
  info "  4) United Kingdom — London"
  info "  5) Canada — Montréal"
  info "  6) Asia — Singapore"
  info "  7) Other (type a Google Cloud region id)"
  local c loc
  read -r -p "  Choose 1-7: " c
  case "${c}" in
    1) set_location US us-central1 nam5 ;;
    2) set_location EU europe-west1 eur3 ;;
    3) set_location australia-southeast1 australia-southeast1 australia-southeast1 ;;
    4) set_location europe-west2 europe-west2 europe-west2 ;;
    5) set_location northamerica-northeast1 northamerica-northeast1 northamerica-northeast1 ;;
    6) set_location asia-southeast1 asia-southeast1 asia-southeast1 ;;
    7) read -r -p "  Region id (e.g. asia-south1, southamerica-east1): " loc
       set_location_from_input "${loc}" || { info "…'${loc}' isn't a valid location — try again."; choose_location; } ;;
    *) info "…please type a number from 1 to 7."; choose_location ;;
  esac
}

choose_project() {
  local pick i=1; local projs=()
  # Newest first, so a just-created project is option 1.
  while IFS= read -r p; do projs+=("$p"); done < <(gcloud projects list --sort-by=~createTime --format='value(projectId)' 2>/dev/null)
  if [ "${#projs[@]}" -eq 0 ]; then
    read -r -p "  Enter your GCP project id: " PROJECT_ID; return
  fi
  bold "Which Google Cloud project should ConsoleVault deploy into?"
  for p in "${projs[@]}"; do info "  ${i}) ${p}"; i=$((i + 1)); done
  read -r -p "  Choose a number (or type a project id): " pick
  if printf '%s' "${pick}" | grep -Eq '^[0-9]+$' && [ "${pick}" -ge 1 ] && [ "${pick}" -le "${#projs[@]}" ]; then
    PROJECT_ID="${projs[$((pick - 1))]}"
  elif [ -n "${pick}" ]; then
    PROJECT_ID="${pick}"
  fi
}

show_summary() {
  bold "Bootstrap settings"
  info "project id    : ${PROJECT_ID:-<none>}"
  info "location      : ${BQ_LOCATION} (data) · ${REGION} (app)   — PERMANENT"
  info "admin email(s): ${ADMINS}"
  info "images        : ${API_IMAGE%:*}:${IMAGE_TAG} + workers"
}

if [ "${CV_YES:-}" = "1" ]; then
  # Non-interactive: fill from env / defaults, then validate.
  set_location_from_input "${BQ_LOCATION:-US}" || die "Invalid CV_BQ_LOCATION '${BQ_LOCATION}'. Use US, EU, or a region like australia-southeast1."
  [ -n "${CV_REGION:-}" ] && REGION="${CV_REGION}"
else
  [ -n "${PROJECT_ID}" ] || choose_project
  choose_location
  read -r -p "  Admin email(s) for sign-in [${ADMINS}]: " x; ADMINS="${x:-$ADMINS}"
  while :; do
    show_summary
    printf '  Press Enter to deploy, or type "edit" to change anything: '
    read -r ans || ans=""
    case "${ans}" in
      "" | y | Y | yes) break ;;
      edit | e | E) choose_project; choose_location; read -r -p "  Admin email(s) [${ADMINS}]: " x; ADMINS="${x:-$ADMINS}" ;;
      *) info "…press Enter to deploy, or type 'edit'." ;;
    esac
  done
fi

[ -n "${PROJECT_ID}" ] || die "No project selected."
[ -n "${REGION}" ] && [ -n "${BQ_LOCATION}" ] && [ -n "${FIRESTORE_LOCATION}" ] || die "No location selected."
echo "${REGION}" | grep -Eq '^[a-z]+-[a-z]+[0-9]+$' || die "Invalid region '${REGION}'."

gcloud config set project "${PROJECT_ID}" >/dev/null 2>&1 || true
# Set the ADC quota project too, so bq/storage calls don't hit a missing-quota-project error.
gcloud auth application-default set-quota-project "${PROJECT_ID}" >/dev/null 2>&1 || true

# Billing is the #1 thing a non-technical user forgets — check it now with a clear message rather
# than failing cryptically on the first resource. (Best-effort: skip the check if it can't be read.)
BILLING_ON="$(gcloud billing projects describe "${PROJECT_ID}" --format='value(billingEnabled)' 2>/dev/null || echo unknown)"
if [ "${BILLING_ON}" = "False" ] || [ "${BILLING_ON}" = "false" ]; then
  die "Billing isn't enabled on '${PROJECT_ID}'. Turn it on here, then re-run ./bootstrap.sh:
       https://console.cloud.google.com/billing/linkedaccount?project=${PROJECT_ID}"
fi

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
  bold "Admin password (save it now)"
  info "${ADMIN_PW}"
fi
info "Retrieve the password any time: gcloud secrets versions access latest --secret=admin-password --project=${PROJECT_ID}"
echo
bold "Next steps (all in the browser — no OAuth client, no consent screen)"
info "1. Open ${API_URL} and sign in with the admin password above."
info "2. In Search Console, add this collector as a user (Restricted) on each property you manage:"
info "     ${SA_COLLECTOR}"
info "3. In the UI: Connections → Set up → Check for properties."
info "4. Properties → switch on the ones you want. Collection starts straight away."
