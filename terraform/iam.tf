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
    # secretmanager.admin: the in-UI connect flow creates per-account token secrets (bounded to this
    # project's own secrets), and account deletion destroys them (secrets.delete). workflows/cloudtasks
    # invoker power the Doctor, queue status, and "Run pipeline now".
    # cloudtasks.queueAdmin (supersedes viewer): account deletion deletes the per-account queue; the
    # narrowest predefined role that includes queues.delete while still covering get/list for status.
    api = [
      "roles/datastore.user",
      "roles/secretmanager.admin",
      "roles/bigquery.jobUser",
      "roles/workflows.invoker",
      "roles/workflows.viewer",
      "roles/cloudtasks.queueAdmin",
      "roles/logging.logWriter",
      "roles/monitoring.metricWriter",
      # Manage the alert email channel + attach it to the alert policies (runtime, on Settings save).
      "roles/monitoring.notificationChannelEditor",
      "roles/monitoring.alertPolicyEditor",
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
    # Orchestrator/planner: control-plane RW, read creds for discovery, manage per-account task
    # queues, invoke workflows + worker services. cloudtasks.admin covers dynamic queue creation
    # (and supersedes enqueuer).
    workflows = [
      "roles/datastore.user",
      "roles/secretmanager.secretAccessor",
      "roles/cloudtasks.admin",
      "roles/workflows.invoker",
      "roles/run.invoker",
      "roles/logging.logWriter",
      # Build materialized group tables (CREATE OR REPLACE TABLE in gsc_views from gsc_byProperty).
      "roles/bigquery.jobUser",
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

# API writes ONLY the views dataset (Stage 4 property-group union views).
resource "google_bigquery_dataset_iam_member" "api_views_editor" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.datasets["gsc_views"].dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.api.email}"
}

# Orchestrator builds materialized group tables: read byProperty, write gsc_views (Stage 6).
resource "google_bigquery_dataset_iam_member" "workflows_byproperty_viewer" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.datasets["gsc_byProperty"].dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.workflows.email}"
}

# Orchestrator runs the daily dedup invariant across the wildcard _all views (SPEC §9), which read
# gsc_totals too — so it needs read on totals (it already has byProperty/byPage via viewer/editor).
resource "google_bigquery_dataset_iam_member" "workflows_totals_viewer" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.datasets["gsc_totals"].dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.workflows.email}"
}

# Native Bulk Export adapter views (SPEC §12) live at gsc_byProperty.<name> / gsc_byPage.<name> so
# they drop into the reporting layer. Creating/replacing a VIEW needs dataEditor on the host
# dataset. Both the API (synchronous "Connect a BigQuery export" flow) and the orchestrator (daily
# re-provision) create them, so grant both dataEditor on the two data datasets.
locals {
  native_view_hosts = toset(["gsc_byProperty", "gsc_byPage"])
  native_view_editors = merge([
    for host in local.native_view_hosts : {
      "api:${host}"       = { sa = google_service_account.api.email, host = host }
      "workflows:${host}" = { sa = google_service_account.workflows.email, host = host }
    }
  ]...)
}

resource "google_bigquery_dataset_iam_member" "native_view_editors" {
  for_each   = local.native_view_editors
  project    = var.project_id
  dataset_id = google_bigquery_dataset.datasets[each.value.host].dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${each.value.sa}"
}

# Read access to each configured native-export dataset (SPEC §12). The datasets are created by
# Google's export (not Terraform), so they're referenced by id; list them in native_export_datasets.
locals {
  # Each entry is "dataset" (this project) or "PROJECT:dataset" (cross-project export, SPEC §12).
  native_export_parsed = [
    for ds in var.native_export_datasets : {
      raw     = ds
      project = length(split(":", ds)) > 1 ? split(":", ds)[0] : var.project_id
      dataset = length(split(":", ds)) > 1 ? split(":", ds)[1] : ds
    }
  ]
  native_export_readers = merge([
    for e in local.native_export_parsed : {
      "api:${e.raw}"       = { sa = google_service_account.api.email, project = e.project, dataset = e.dataset }
      "workflows:${e.raw}" = { sa = google_service_account.workflows.email, project = e.project, dataset = e.dataset }
    }
  ]...)
}

resource "google_bigquery_dataset_iam_member" "native_export_readers" {
  for_each   = local.native_export_readers
  project    = each.value.project
  dataset_id = each.value.dataset
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${each.value.sa}"
}

resource "google_bigquery_dataset_iam_member" "workflows_views_editor" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.datasets["gsc_views"].dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.workflows.email}"
}

# ---------------------------------------------------------------------------
# Bucket-level access — collector only, staging bucket only.
# ---------------------------------------------------------------------------
resource "google_storage_bucket_iam_member" "collector_staging" {
  bucket = google_storage_bucket.staging.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.collector.email}"
}

# ---------------------------------------------------------------------------
# Service-account impersonation (Stage 1).
# ---------------------------------------------------------------------------
# The API impersonates the GSC-facing collector SA to discover properties for
# service-account accounts (clients add sa-collector's email to their property).
# Stage 3's discover worker will run AS sa-collector directly and won't need this.
resource "google_service_account_iam_member" "api_impersonate_collector" {
  service_account_id = google_service_account.collector.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.api.email}"
}

# ---------------------------------------------------------------------------
# Orchestration wiring (Stage 3).
# ---------------------------------------------------------------------------
# The orchestrator (sa-workflows) sets Cloud Tasks' OIDC identity to sa-collector (actAs) and may
# impersonate sa-collector for service-account discovery.
resource "google_service_account_iam_member" "workflows_actas_collector" {
  service_account_id = google_service_account.collector.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.workflows.email}"
}

resource "google_service_account_iam_member" "workflows_impersonate_collector" {
  service_account_id = google_service_account.collector.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.workflows.email}"
}

# Cloud Tasks invokes the collector authenticated (OIDC) as sa-collector → it needs run.invoker
# on the collector service.
resource "google_cloud_run_v2_service_iam_member" "collector_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.collector.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.collector.email}"
}
