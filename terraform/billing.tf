# Cloud Billing export → BigQuery (SPEC §11, opt-in). Terraform creates the dataset and grants the
# API read access; pointing the actual billing export at it is a one-time manual Console step
# (docs/BILLING-EXPORT.md), since Cloud Billing export config isn't a Terraform resource.
resource "google_bigquery_dataset" "billing_export" {
  count       = var.enable_billing_export ? 1 : 0
  project     = var.project_id
  dataset_id  = var.billing_export_dataset
  location    = var.bq_location
  description = "Cloud Billing export (read by the ConsoleVault Costs panel)."
}

resource "google_bigquery_dataset_iam_member" "api_billing_viewer" {
  count      = var.enable_billing_export ? 1 : 0
  project    = var.project_id
  dataset_id = google_bigquery_dataset.billing_export[0].dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.api.email}"
}
