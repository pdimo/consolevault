# Control-plane API on Cloud Run (Stage 0: serves only GET /health).
# Runs as sa-api. The service requires IAM auth to invoke (no allUsers binding — least
# privilege). Verify /health with an identity token (see plan §6 / README).
#
# var.api_image defaults to a public placeholder so `plan`/`apply` work before the real
# image exists; scripts/build-push.sh pushes the real image and passes -var api_image=...
resource "google_cloud_run_v2_service" "api" {
  project  = var.project_id
  name     = "${var.app_name}-api"
  location = var.region

  # Keep destroyable during early-stage iteration.
  deletion_protection = false

  ingress = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.api.email

    containers {
      image = var.api_image

      ports {
        container_port = 8080
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "GCP_REGION"
        value = var.region
      }
      env {
        name  = "BQ_LOCATION"
        value = var.bq_location
      }
      env {
        name  = "APP_NAME"
        value = var.app_name
      }
      env {
        name  = "STAGING_BUCKET"
        value = google_storage_bucket.staging.name
      }
      env {
        name  = "ADMIN_EMAILS"
        value = join(",", var.admin_emails)
      }
      env {
        name  = "BILLING_EXPORT_DATASET"
        value = var.enable_billing_export ? var.billing_export_dataset : ""
      }
      env {
        name = "SESSION_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.session.secret_id
            version = "latest"
          }
        }
      }
    }
  }

  depends_on = [
    google_project_service.enabled,
    google_project_iam_member.bindings,
    google_secret_manager_secret_version.session,
  ]
}

# Stage 4: the management UI is public-ingress but app-gated by Google Sign-In (admin allowlist).
resource "google_cloud_run_v2_service_iam_member" "api_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Orchestrator worker (Stage 3). SAME worker image as the collector, but runs as sa-workflows
# (cloudtasks + datastore + secretAccessor) and serves /discover-all, /reconcile, /enqueue.
# The daily Workflow calls it; it enqueues Cloud Tasks that target the collector.
resource "google_cloud_run_v2_service" "orchestrator" {
  project  = var.project_id
  name     = "${var.app_name}-orchestrator"
  location = var.region

  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.workflows.email
    # discover + reconcile can iterate many properties/days.
    timeout = "1800s"

    containers {
      image = var.worker_image

      ports {
        container_port = 8080
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "GCP_REGION"
        value = var.region
      }
      env {
        name  = "BQ_LOCATION"
        value = var.bq_location
      }
      env {
        name  = "STAGING_BUCKET"
        value = google_storage_bucket.staging.name
      }
      env {
        name  = "COLLECTOR_URL"
        value = google_cloud_run_v2_service.collector.uri
      }
      env {
        name  = "TASK_MAX_ATTEMPTS"
        value = tostring(var.task_max_attempts)
      }
    }
  }

  depends_on = [
    google_project_service.enabled,
    google_project_iam_member.bindings,
    google_cloud_run_v2_service.collector,
  ]
}

# Collector worker (Stage 2). Runs as sa-collector (the only SA with BigQuery dataEditor/jobUser
# + GCS objectAdmin). IAM-private; manual headless trigger now, Cloud Tasks/Workflows in Stage 3.
# var.worker_image defaults to a public placeholder so apply works before the image is built;
# scripts/build-push.sh pushes the real image and passes -var worker_image=...
resource "google_cloud_run_v2_service" "collector" {
  project  = var.project_id
  name     = "${var.app_name}-collector"
  location = var.region

  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.collector.email
    # Collection paginates + runs a BigQuery load job; allow headroom.
    timeout = "600s"

    containers {
      image = var.worker_image

      ports {
        container_port = 8080
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "GCP_REGION"
        value = var.region
      }
      env {
        name  = "BQ_LOCATION"
        value = var.bq_location
      }
      env {
        name  = "STAGING_BUCKET"
        value = google_storage_bucket.staging.name
      }
      env {
        name  = "TASK_MAX_ATTEMPTS"
        value = tostring(var.task_max_attempts)
      }
    }
  }

  depends_on = [
    google_project_service.enabled,
    google_project_iam_member.bindings,
  ]
}
