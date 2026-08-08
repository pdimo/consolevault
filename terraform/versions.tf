terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.43"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State lives in the pre-existing, versioned GCS bucket (CLAUDE.md: do NOT create it).
  # Backends cannot reference variables, so the bucket is set here directly. A different
  # deployer overrides it with `terraform init -backend-config="bucket=<their-bucket>"`
  # (redistributability is templatized in Stage 5). `prefix` namespaces this project's state.
  backend "gcs" {
    bucket = "your-gcp-project-id-tfstate" # overridden by setup.sh via -backend-config="bucket=…"
    prefix = "consolevault/stage0"
  }
}
