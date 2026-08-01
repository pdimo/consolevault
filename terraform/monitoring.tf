# Operational alerting (SPEC §3). The alert email is a RUNTIME setting (Settings UI), not a deploy
# var — this is a distributable product and each operator sets their own. So Terraform owns the
# durable infra (log-based metrics + alert policy definitions) and the app (sa-api, on Settings save)
# creates the email notification channel and attaches it to these policies via the Monitoring API.
# Hence notification_channels is app-managed and ignored here. Alerts:
#   1. any account token unhealthy (the #1 risk — a stale token silently zeroes collection)
#   2. collector error spike
#   3. no successful collection in 24h (absence)
resource "google_logging_metric" "token_health_alert" {
  project = var.project_id
  name    = "${var.app_name}_token_health_alert"
  filter  = "resource.type=\"cloud_run_revision\" AND jsonPayload.alert=\"token_health\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_logging_metric" "collector_error" {
  project = var.project_id
  name    = "${var.app_name}_collector_error"
  filter  = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${var.app_name}-collector\" AND severity>=ERROR"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_logging_metric" "collected" {
  project = var.project_id
  name    = "${var.app_name}_collected"
  filter  = "resource.type=\"cloud_run_revision\" AND jsonPayload.event=\"collected\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

# Standing dedup invariant (SPEC §9): the daily /dedup-check step logs this marker if any row_hash
# appears more than once — a duplication bug slipping past both idempotency layers.
resource "google_logging_metric" "dedup_violation" {
  project = var.project_id
  name    = "${var.app_name}_dedup_violation"
  filter  = "resource.type=\"cloud_run_revision\" AND jsonPayload.alert=\"dedup_violation\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_monitoring_alert_policy" "token_health" {
  project      = var.project_id
  display_name = "ConsoleVault: account token unhealthy"
  combiner     = "OR"

  conditions {
    display_name = "token-health alert emitted"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${var.app_name}_token_health_alert\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_DELTA"
      }
    }
  }

  lifecycle {
    ignore_changes = [notification_channels]
  }
  depends_on = [google_logging_metric.token_health_alert]
}

resource "google_monitoring_alert_policy" "collector_error" {
  project      = var.project_id
  display_name = "ConsoleVault: collector error spike"
  combiner     = "OR"

  conditions {
    display_name = "collector errors in the last hour"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${var.app_name}_collector_error\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 20
      duration        = "0s"
      aggregations {
        alignment_period   = "3600s"
        per_series_aligner = "ALIGN_DELTA"
      }
    }
  }

  lifecycle {
    ignore_changes = [notification_channels]
  }
  depends_on = [google_logging_metric.collector_error]
}

resource "google_monitoring_alert_policy" "dedup_violation" {
  project      = var.project_id
  display_name = "ConsoleVault: duplicate row_hash detected (dedup invariant)"
  combiner     = "OR"

  conditions {
    display_name = "dedup invariant violated"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${var.app_name}_dedup_violation\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period   = "3600s"
        per_series_aligner = "ALIGN_DELTA"
      }
    }
  }

  lifecycle {
    ignore_changes = [notification_channels]
  }
  depends_on = [google_logging_metric.dedup_violation]
}

resource "google_monitoring_alert_policy" "no_collection" {
  project      = var.project_id
  display_name = "ConsoleVault: no successful collection in 24h"
  combiner     = "OR"

  conditions {
    display_name = "collected metric absent for 24h"
    condition_absent {
      filter   = "metric.type=\"logging.googleapis.com/user/${var.app_name}_collected\" AND resource.type=\"cloud_run_revision\""
      duration = "82800s" # 23h — Monitoring caps condition_absent at 23h30m
      aggregations {
        alignment_period   = "3600s"
        per_series_aligner = "ALIGN_DELTA"
        # Collapse the per-revision label: judge absence for the whole collector service, not each
        # Cloud Run revision. Without this, a normal redeploy retires the old revision's series and
        # trips a false "absent" alert ~23h later even while the new revision collects fine.
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.label.service_name"]
      }
    }
  }

  lifecycle {
    ignore_changes = [notification_channels]
  }
  depends_on = [google_logging_metric.collected]
}
