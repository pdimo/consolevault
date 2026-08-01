# Connecting a native BigQuery Bulk Export (SPEC §12)

ConsoleVault normally **collects** Search Console data via the Search Analytics **API**. But
Google also offers a **native Bulk Export** that streams GSC data straight into a BigQuery dataset
you own. If you already run that export, ConsoleVault can read it directly — you get the whole
reporting layer (dashboards, opportunities, groups, wildcard views) **without ConsoleVault
collecting those properties at all**.

## API collection vs native Bulk Export

They're complementary — ConsoleVault supports both, side by side:

|                   | ConsoleVault API collection        | Native Bulk Export                                        |
| ----------------- | ---------------------------------- | --------------------------------------------------------- |
| **Backfill**      | ✅ ~16 months on first run         | ❌ forward-only (from the day you enable it)              |
| **Row limit**     | 50,000 rows/day/type (API ceiling) | ✅ no row limit                                           |
| **Setup**         | Connect a Google account           | Enable export in the GSC UI (owner, one BigQuery project) |
| **Who can do it** | Any account with property access   | Property **owner** only                                   |
| **Cost**          | Near-free API calls                | BigQuery streaming + storage                              |

**The play:** use ConsoleVault's API collection for backfilled, multi-account, multi-property
history; add native Bulk Export for the handful of very large properties that exceed the 50K/day
API ceiling. ConsoleVault's **Doctor** flags any property hitting that ceiling and points here.

> A full API-backfill **+** forward-export **union with overlap dedup** is on the roadmap (SPEC §12).
> Today the two live side by side: a property is either API-collected **or** native-export imported.

## How it works

For each native-export property, ConsoleVault creates two BigQuery **views** —
`gsc_byProperty.<name>` and `gsc_byPage.<name>` — that map the export tables
(`searchdata_site_impression`, `searchdata_url_impression`) into ConsoleVault's shared row schema
(position is derived as `SUM(sum_top_position)/SUM(impressions) + 1`, etc.). Because the whole
reporting layer resolves a property to those datasets, every report, filter, group and the wildcard
`_all` views work unchanged. The data is **read live** through the views — nothing is copied, and
there's no collection job.

## Setup

1. **Enable the export in Search Console** (Google's docs:
   <https://support.google.com/webmasters/answer/12917675>). Point it at **this deployment's GCP
   project** (cross-project export datasets are a post-v1 follow-up). The default dataset name is
   `searchconsole`.

2. **Grant ConsoleVault read access.** Add the dataset id to `native_export_datasets` in
   `terraform/terraform.tfvars` and re-apply:

   ```hcl
   native_export_datasets = ["searchconsole"]
   ```

   This grants `sa-api` and `sa-workflows` `dataViewer` on the export dataset (and they already have
   the `dataEditor` on `gsc_byProperty`/`gsc_byPage` needed to create the adapter views).

3. **Connect it in the UI.** Go to **Connections → Connect a BigQuery export**, enter the dataset id
   (and project, if different from this deployment), and click **Connect export**. ConsoleVault
   discovers every `site_url` in the export, imports each as a property, and builds its adapter
   views. They appear immediately in **Clients**/**Properties** with a **BigQuery export** badge.

4. **Verify.** The **Doctor** page shows a `BigQuery export: <dataset>` check with the latest
   exported day. If it fails, the dataset either doesn't exist, is in another project, or `sa-api`
   lacks read access (fix step 2).

## Notes & limits

- **Not collected.** Native-export properties never enter the planner/collector; there are no
  search-type/aggregation/backfill settings for them (Google's export controls that). Brand terms
  still apply — they're used at query time.
- **`totals`/anomaly delta** is an API-collection artefact and isn't produced for native-export
  properties, so the totals-based anomaly % doesn't show for them.
- **Freshness** follows Google's export schedule (see the `ExportLog` table); ConsoleVault reads
  whatever is present.
- **Removal** drops the adapter views and property docs and rebuilds the wildcard views; the
  underlying export dataset is never touched.
