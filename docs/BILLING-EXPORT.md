# Showing real spend (Cloud Billing export)

By default the **Costs** page shows a BigQuery _storage estimate_. To see **actual** spend (by GCP
service, last 30 days), enable Cloud Billing export to BigQuery. This is opt-in because the export
itself is a one-time manual step in the Cloud Console — it isn't a Terraform resource.

## 1. Create the dataset (Terraform)

In `terraform/terraform.tfvars`:

```hcl
enable_billing_export  = true
billing_export_dataset = "billing_export"   # optional; this is the default
```

Then `terraform apply` (or re-run `./setup.sh`). This creates the `billing_export` dataset in your
`bq_location` and grants the API read access. It also sets `BILLING_EXPORT_DATASET` on the API so the
Costs panel knows where to look.

## 2. Point Cloud Billing at it (Console, one-time)

1. Console → **Billing** → **Billing export** → **BigQuery export**.
2. Under **Standard usage cost**, click **Edit settings**.
3. Project = your ConsoleVault project; Dataset = **billing_export**; **Save**.

Google then writes a `gcp_billing_export_v1_<BILLING_ACCOUNT_ID>` table to that dataset. Export data
starts flowing forward (it isn't backfilled), so spend appears within a day.

> Create the export dataset in the **same location** as your data (`bq_location`) so the Costs query
> can read it.

## 3. See it

The Costs page now shows an **Actual spend — last 30 days** table (per service, with a total),
alongside the storage estimate. If the export table isn't present yet, the page silently falls back
to the estimate.

## Turning it off

Set `enable_billing_export = false` and `terraform apply`. (Disable the export in the Console too if
you no longer want billing data written.) The Costs page returns to the estimate-only view.
