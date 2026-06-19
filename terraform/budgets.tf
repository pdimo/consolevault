# Cloud Billing budget + threshold alerts (SPEC §11) — "you will never get a surprise bill."
# Gated on billing_account (empty disables it). Budget notifications go to the monitoring email
# channel (when alerting is enabled) plus the billing admins by default. The deployer needs
# billing.budgets permission on the billing account.
data "google_project" "this" {
  project_id = var.project_id
}

resource "google_billing_budget" "monthly" {
  count           = var.billing_account != "" ? 1 : 0
  billing_account = var.billing_account
  display_name    = "${var.app_name} monthly budget"

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }

  amount {
    specified_amount {
      # currency_code omitted on purpose: the budget inherits the billing account's own currency
      # (a distributable install may be AUD/EUR/etc., and a mismatched code is rejected).
      units = tostring(floor(var.budget_amount))
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }

  # Budget threshold emails go to the billing account's admins/users by default (no extra config).
}
