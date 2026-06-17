#!/usr/bin/env bash
# Build and push the ConsoleVault API image to Artifact Registry, then print the image ref
# to pass to Terraform as -var api_image=...
#
# Prereqs: the Artifact Registry repo must exist (run `terraform apply` once first, or apply
# the artifactregistry resource), and gcloud must be authenticated.
#
# Usage:
#   scripts/build-push.sh [PROJECT_ID] [REGION] [APP_NAME] [TAG]
set -euo pipefail

PROJECT_ID="${1:-your-gcp-project-id}"
REGION="${2:-us-central1}"
APP_NAME="${3:-consolevault}"
TAG="${4:-latest}"

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${APP_NAME}/api:${TAG}"

# Build from the repo root (monorepo build context).
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Building ${IMAGE} via Cloud Build..."
gcloud builds submit "${REPO_ROOT}" \
  --project "${PROJECT_ID}" \
  --gcs-source-staging-dir "gs://${PROJECT_ID}-staging/cloudbuild" \
  --config /dev/stdin <<EOF
steps:
  - name: gcr.io/cloud-builders/docker
    args: ['build', '-f', 'apps/api/Dockerfile', '-t', '${IMAGE}', '.']
images:
  - '${IMAGE}'
EOF

echo
echo "Pushed: ${IMAGE}"
echo "Now run:"
echo "  terraform -chdir=terraform apply -var api_image=${IMAGE}"
