# Daily orchestration workflow (SPEC §5.1). Runs as sa-workflows; calls the orchestrator's
# OIDC-protected endpoints. The orchestrator URL is injected into the YAML at apply time
# (replace() preserves the workflow's own ${...} expressions, which templatefile would clobber).
resource "google_workflows_workflow" "daily" {
  project         = var.project_id
  name            = "${var.app_name}-daily"
  region          = var.region
  service_account = google_service_account.workflows.email

  source_contents = replace(
    file("${path.module}/workflows/daily.yaml"),
    "__ORCHESTRATOR_URL__",
    google_cloud_run_v2_service.orchestrator.uri,
  )

  depends_on = [google_project_service.enabled]
}
