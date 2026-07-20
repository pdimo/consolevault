# Cloud Billing export → BigQuery (SPEC §11). The empty dataset is ALWAYS provisioned (it costs
# nothing until used) so the Costs page can fully own the opt-in UX: the user toggles "real spend"
# in the UI, which reveals the one-time manual Console export step (docs/BILLING-EXPORT.md) — that
# step isn't a Terraform resource. The API reads this dataset once Google starts writing to it.
resource "google_bigquery_dataset" "billing_export" {
  project     = var.project_id
  dataset_id  = var.billing_export_dataset
  location    = var.bq_location
  description = "Cloud Billing export (read by the ConsoleVault Costs panel; opt-in via the UI)."
}

resource "google_bigquery_dataset_iam_member" "api_billing_viewer" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.billing_export.dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.api.email}"
}
