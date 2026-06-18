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
    }
  }

  depends_on = [
    google_project_service.enabled,
    google_project_iam_member.bindings,
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
    }
  }

  depends_on = [
    google_project_service.enabled,
    google_project_iam_member.bindings,
  ]
}
