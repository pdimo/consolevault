# GCS staging bucket for NDJSON load jobs (SPEC §2, §6.3). The Terraform STATE bucket
# (var.state_bucket) already exists and is NOT managed here.
resource "google_storage_bucket" "staging" {
  project                     = var.project_id
  name                        = "${var.project_id}-staging"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false

  # Staging NDJSON is transient — clean it up after load jobs complete.
  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.enabled]
}
