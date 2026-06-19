# Daily trigger (SPEC §5.1). Cloud Scheduler kicks a Workflow execution via the Workflows
# Executions API, authenticated as sa-workflows (which has workflows.invoker). Pacific Time so
# the run aligns with GSC's date boundaries (CLAUDE.md hard rule 7).
resource "google_cloud_scheduler_job" "daily" {
  project   = var.project_id
  name      = "${var.app_name}-daily"
  region    = var.region
  schedule  = var.daily_schedule
  time_zone = var.schedule_timezone

  http_target {
    http_method = "POST"
    uri         = "https://workflowexecutions.googleapis.com/v1/projects/${var.project_id}/locations/${var.region}/workflows/${google_workflows_workflow.daily.name}/executions"

    oauth_token {
      service_account_email = google_service_account.workflows.email
    }
  }

  depends_on = [google_project_service.enabled]
}

# Token-health sweep (SPEC §3): probe every account's credentials more often than the daily run,
# so a stale token alerts before it silently zeroes collection. Hits the orchestrator (IAM-private)
# via OIDC as sa-workflows.
resource "google_cloud_scheduler_job" "token_health" {
  project   = var.project_id
  name      = "${var.app_name}-token-health"
  region    = var.region
  schedule  = var.token_health_schedule
  time_zone = var.schedule_timezone

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.orchestrator.uri}/token-health-sweep"

    oidc_token {
      service_account_email = google_service_account.workflows.email
      audience              = google_cloud_run_v2_service.orchestrator.uri
    }
  }

  depends_on = [google_project_service.enabled]
}
