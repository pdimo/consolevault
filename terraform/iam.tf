# Three least-privilege service accounts (SPEC §3, §13). Roles are scoped to dataset/bucket
# level where possible. "Correctly permissioned" = ready for each SA's function; the project
# stays empty (no data). Broad/admin/write-secret roles are deliberately NOT granted here —
# they are added in the stage that needs them (see plan §3.1).

resource "google_service_account" "collector" {
  project      = var.project_id
  account_id   = "sa-collector"
  display_name = "ConsoleVault collector worker"
  depends_on   = [google_project_service.enabled]
}

resource "google_service_account" "api" {
  project      = var.project_id
  account_id   = "sa-api"
  display_name = "ConsoleVault control-plane API / UI"
  depends_on   = [google_project_service.enabled]
}

resource "google_service_account" "workflows" {
  project      = var.project_id
  account_id   = "sa-workflows"
  display_name = "ConsoleVault workflows / planner"
  depends_on   = [google_project_service.enabled]
}

# ---------------------------------------------------------------------------
# Project-level role bindings (one binding per SA per role).
# ---------------------------------------------------------------------------
locals {
  project_roles = {
    # API/UI runtime: control-plane RW, read tokens (read only), run BQ read jobs, telemetry.
    api = [
      "roles/datastore.user",
      "roles/secretmanager.secretAccessor",
      "roles/bigquery.jobUser",
      "roles/logging.logWriter",
      "roles/monitoring.metricWriter",
    ]
    # Collector runtime: read creds, run BQ load jobs, control-plane RW, telemetry.
    # (Dataset dataEditor + staging objectAdmin are bound below at resource scope.)
    collector = [
      "roles/secretmanager.secretAccessor",
      "roles/bigquery.jobUser",
      "roles/datastore.user",
      "roles/logging.logWriter",
      "roles/monitoring.metricWriter",
    ]
    # Workflows/planner: control-plane RW, enqueue tasks, invoke workflows + worker services.
    workflows = [
      "roles/datastore.user",
      "roles/cloudtasks.enqueuer",
      "roles/workflows.invoker",
      "roles/run.invoker",
      "roles/logging.logWriter",
    ]
  }

  sa_emails = {
    api       = google_service_account.api.email
    collector = google_service_account.collector.email
    workflows = google_service_account.workflows.email
  }

  # Flatten {sa => [roles]} into individually addressable bindings.
  project_role_bindings = merge([
    for sa, roles in local.project_roles : {
      for role in roles : "${sa}:${role}" => { sa = sa, role = role }
    }
  ]...)
}

resource "google_project_iam_member" "bindings" {
  for_each = local.project_role_bindings

  project = var.project_id
  role    = each.value.role
  member  = "serviceAccount:${local.sa_emails[each.value.sa]}"
}

# ---------------------------------------------------------------------------
# Dataset-level BigQuery access (least privilege — not project-wide data roles).
# ---------------------------------------------------------------------------
# Collector writes data: dataEditor on every dataset.
resource "google_bigquery_dataset_iam_member" "collector_editor" {
  for_each = google_bigquery_dataset.datasets

  project    = var.project_id
  dataset_id = each.value.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.collector.email}"
}

# API reads data (coverage/cost panels): dataViewer on every dataset.
resource "google_bigquery_dataset_iam_member" "api_viewer" {
  for_each = google_bigquery_dataset.datasets

  project    = var.project_id
  dataset_id = each.value.dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.api.email}"
}

# ---------------------------------------------------------------------------
# Bucket-level access — collector only, staging bucket only.
# ---------------------------------------------------------------------------
resource "google_storage_bucket_iam_member" "collector_staging" {
  bucket = google_storage_bucket.staging.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.collector.email}"
}
