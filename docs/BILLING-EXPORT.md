# Showing real spend (Cloud Billing export)

By default the **Costs** page shows a BigQuery _storage estimate_. To see **actual** spend (by GCP
service, last 30 days), opt in from the UI and complete one quick Cloud Console step. The export
dataset is always provisioned by Terraform; the opt-in and guidance live in the app, because Cloud
Billing export config isn't a Terraform/API resource.

## Opt in from the app

1. Open the **Costs** page → **Real spend** → **Set up real spend**.
2. The page links you straight to **Billing → Billing export → BigQuery export**. Under
   **Standard usage cost**, click **Edit settings**.
3. Set **Project** = your ConsoleVault project and **Dataset** = `billing_export` (shown on screen),
   then **Save**.
4. Back in the app, click **I've configured it — check now**.

Google then writes a `gcp_billing_export_v1_<BILLING_ACCOUNT_ID>` table to the `billing_export`
dataset. Data flows **forward only** (it isn't backfilled), so it usually appears within a few hours
(up to ~24h). The Costs page shows a "waiting" state until then, and switches to **real spend**
automatically once data arrives.

## Notes

- The `billing_export` dataset is created in your `bq_location` by Terraform and is read-only to the
  API service account — no extra setup needed.
- To go back to estimates, click **Use estimates instead** on the Costs page. (Optionally disable the
  export in the Cloud Console too if you no longer want billing data written.)
- Dataset id is configurable via the `billing_export_dataset` Terraform variable (default
  `billing_export`); the app reads whichever you set.
