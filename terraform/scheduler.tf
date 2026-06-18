# Daily trigger (SPEC §5.1). Cloud Scheduler kicks a Workflow execution via the Workflows
# Executions API, authenticated as sa-workflows (which has workflows.invoker). Pacific Time so
# the run aligns with GSC's date boundaries (CLAUDE.md hard rule 7).
resource "google_cloud_scheduler_job" "daily" {
  project   = var.project_id
  name      = "${var.app_name}-daily"
  region    = var.region
  schedule  = "0 9 * * *"
  time_zone = "America/Los_Angeles"

  http_target {
    http_method = "POST"
    uri         = "https://workflowexecutions.googleapis.com/v1/projects/${var.project_id}/locations/${var.region}/workflows/${google_workflows_workflow.daily.name}/executions"

    oauth_token {
      service_account_email = google_service_account.workflows.email
    }
  }

  depends_on = [google_project_service.enabled]
}
