#!/usr/bin/env bash
# Build and push a ConsoleVault service image (api | workers) to Artifact Registry, then print
# the image ref to pass to Terraform (-var api_image=... or -var worker_image=...).
#
# Prereqs: the Artifact Registry repo must exist (run `terraform apply` once first), and gcloud
# must be authenticated.
#
# Usage:
#   scripts/build-push.sh <api|workers> [TAG] [PROJECT_ID] [REGION] [APP_NAME]
set -euo pipefail

APP="${1:?usage: build-push.sh <api|workers> [TAG] [PROJECT_ID] [REGION] [APP_NAME]}"
TAG="${2:-latest}"
PROJECT_ID="${3:-your-gcp-project-id}"
REGION="${4:-us-central1}"
APP_NAME="${5:-consolevault}"

case "${APP}" in
  api | workers) ;;
  *)
    echo "First arg must be 'api' or 'workers' (got '${APP}')" >&2
    exit 1
    ;;
esac

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${APP_NAME}/${APP}:${TAG}"
DOCKERFILE="apps/${APP}/Dockerfile"
TF_VAR=$([ "${APP}" = "api" ] && echo "api_image" || echo "worker_image")

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Building ${IMAGE} (${DOCKERFILE}) via Cloud Build..."
gcloud builds submit "${REPO_ROOT}" \
  --project "${PROJECT_ID}" \
  --gcs-source-staging-dir "gs://${PROJECT_ID}-staging/cloudbuild" \
  --config /dev/stdin <<EOF
steps:
  - name: gcr.io/cloud-builders/docker
    args: ['build', '-f', '${DOCKERFILE}', '-t', '${IMAGE}', '.']
images:
  - '${IMAGE}'
EOF

echo
echo "Pushed: ${IMAGE}"
echo "Now run:"
echo "  terraform -chdir=terraform apply -var ${TF_VAR}=${IMAGE}"
