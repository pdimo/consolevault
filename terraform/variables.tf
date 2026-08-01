variable "project_id" {
  type        = string
  description = "GCP project id (e.g. your-company-seo)."
}

variable "region" {
  type        = string
  description = "Region for Cloud Run / Tasks / Workflows / staging bucket (e.g. us-central1)."
  default     = "us-central1"
}

variable "bq_location" {
  type        = string
  description = "PERMANENT BigQuery + Firestore location. Chosen once; cannot be changed later. 'US' | 'EU' | a single region."
  default     = "US"
}

variable "state_bucket" {
  type        = string
  description = "Pre-existing, versioned GCS bucket holding Terraform state. Informational only — the backend bucket is set in versions.tf (backends cannot read variables)."
  default     = "your-gcp-project-id-tfstate"
}

variable "app_name" {
  type        = string
  description = "Logical app name / resource prefix."
  default     = "consolevault"
}

variable "admin_emails" {
  type        = list(string)
  description = "Google account emails allowed to sign in to the management UI (Stage 4)."
  default     = []
}

variable "billing_account" {
  type        = string
  description = "Cloud Billing account id (e.g. 000000-AAAAAA-BBBBBB) for the budget. Empty disables the budget."
  default     = ""
}

variable "budget_amount" {
  type        = number
  description = "Monthly billing budget amount in the billing account's own currency — alerts at 50/90/100%."
  default     = 50
}

variable "daily_schedule" {
  type        = string
  description = "Cron for the daily collection workflow."
  default     = "0 9 * * *"
}

variable "schedule_timezone" {
  type        = string
  description = "Time zone for the schedulers (collection date logic itself is always Pacific Time)."
  default     = "America/Los_Angeles"
}

variable "token_health_schedule" {
  type        = string
  description = "Cron for the token-health sweep (more frequent than the daily run)."
  default     = "0 */6 * * *"
}

variable "task_max_attempts" {
  type        = number
  description = "Cloud Tasks retry attempts before a collection task is dead-lettered (terminal error)."
  default     = 8
}

variable "billing_export_dataset" {
  type        = string
  description = "Dataset id that Cloud Billing export writes to (always provisioned; read by the Costs panel). Real spend is opted into from the UI — see docs/BILLING-EXPORT.md."
  default     = "billing_export"
}

variable "default_partition_expiry_days" {
  type        = number
  description = "Default BigQuery table/partition expiry in days. null = never expire."
  default     = null
}

variable "native_export_datasets" {
  type        = list(string)
  description = "GSC native Bulk Export dataset ids IN THIS PROJECT to grant the API/orchestrator read access to (SPEC §12 — 'Connect a BigQuery export'). Add each export dataset here (e.g. [\"searchconsole\"]) so ConsoleVault can read it and build adapter views. Cross-project export datasets are a post-v1 follow-up."
  default     = []
}

variable "api_image" {
  type        = string
  description = "Container image for the control-plane API Cloud Run service. Built and pushed by scripts/build-push.sh before apply."
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "worker_image" {
  type        = string
  description = "Container image for the collector worker Cloud Run service. Built and pushed by scripts/build-push.sh before apply."
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

# Firestore database location for the chosen bq_location. For multi-regions the Firestore
# location id differs from the BigQuery name (US -> nam5, EU -> eur3); single regions match.
locals {
  firestore_location = lookup(
    { "US" = "nam5", "EU" = "eur3" },
    var.bq_location,
    var.bq_location,
  )
}
