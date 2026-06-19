# Enable all Google APIs Stage 0 needs (SPEC §13) plus the two required to deploy a
# container to Cloud Run (artifactregistry + cloudbuild — see README/plan flagged deviation).
locals {
  enabled_apis = [
    "cloudresourcemanager.googleapis.com",
    "searchconsole.googleapis.com",
    "bigquery.googleapis.com",
    "firestore.googleapis.com",
    "run.googleapis.com",
    "cloudtasks.googleapis.com",
    "workflows.googleapis.com",
    "cloudscheduler.googleapis.com",
    "workflowexecutions.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "billingbudgets.googleapis.com",
    # Needed to build/host the Cloud Run image:
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
  ]
}

resource "google_project_service" "enabled" {
  for_each = toset(local.enabled_apis)

  project = var.project_id
  service = each.value

  # Keep APIs enabled even if this resource is destroyed; never auto-disable dependencies.
  disable_on_destroy         = false
  disable_dependent_services = false
}
