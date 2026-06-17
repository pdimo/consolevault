# The five BigQuery datasets (SPEC §6.1). Stage 0 creates them EMPTY — no tables, no views,
# no data (CLAUDE.md hard rule 3). Tables/views land in Stage 2+.
locals {
  # partitioned = true => apply default_partition_expiry_days (the GSC data datasets).
  datasets = {
    gsc_byProperty = { description = "GSC query-level rows (byProperty aggregation).", partitioned = true }
    gsc_byPage     = { description = "GSC page-level rows (byPage aggregation).", partitioned = true }
    gsc_totals     = { description = "GSC daily totals + anonymized-query delta.", partitioned = true }
    gsc_views      = { description = "Wildcard union views across properties.", partitioned = false }
    task_logs      = { description = "Append-only task attempt log.", partitioned = false }
  }
}

resource "google_bigquery_dataset" "datasets" {
  for_each = local.datasets

  project     = var.project_id
  dataset_id  = each.key
  location    = var.bq_location
  description = each.value.description

  # Apply the optional default partition expiry only to the partitioned data datasets.
  default_partition_expiration_ms = (each.value.partitioned && var.default_partition_expiry_days != null
    ? var.default_partition_expiry_days * 24 * 60 * 60 * 1000
  : null)

  depends_on = [google_project_service.enabled]
}
