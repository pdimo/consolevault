output "project_id" {
  value       = var.project_id
  description = "GCP project id."
}

output "region" {
  value       = var.region
  description = "Compute region."
}

output "bq_location" {
  value       = var.bq_location
  description = "Permanent BigQuery + Firestore location."
}

output "firestore_location" {
  value       = local.firestore_location
  description = "Firestore database location id."
}

output "bigquery_datasets" {
  value       = [for d in google_bigquery_dataset.datasets : d.dataset_id]
  description = "Created BigQuery dataset ids."
}

output "staging_bucket" {
  value       = google_storage_bucket.staging.name
  description = "GCS staging bucket name."
}

output "artifact_registry_repo" {
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.containers.repository_id}"
  description = "Docker repository path for pushing images."
}

output "service_account_emails" {
  value = {
    api       = google_service_account.api.email
    collector = google_service_account.collector.email
    workflows = google_service_account.workflows.email
  }
  description = "Service account emails."
}

output "api_url" {
  value       = google_cloud_run_v2_service.api.uri
  description = "Cloud Run URL of the control-plane API (append /health)."
}
