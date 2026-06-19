provider "google" {
  project = var.project_id
  region  = var.region

  # APIs like billingbudgets require a quota project under user ADC. Route it through this project.
  # Requires cloudresourcemanager.googleapis.com (enabled in apis.tf).
  billing_project       = var.project_id
  user_project_override = true
}
