variable "project_id" {
  type        = string
  description = "GCP project id (e.g. your-gcp-project-id)."
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

variable "default_partition_expiry_days" {
  type        = number
  description = "Default BigQuery table/partition expiry in days. null = never expire."
  default     = null
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
