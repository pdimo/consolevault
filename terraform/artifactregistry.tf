# Docker repository that holds the control-plane API image deployed to Cloud Run.
resource "google_artifact_registry_repository" "containers" {
  project       = var.project_id
  location      = var.region
  repository_id = var.app_name
  format        = "DOCKER"
  description   = "ConsoleVault container images."

  depends_on = [google_project_service.enabled]
}
