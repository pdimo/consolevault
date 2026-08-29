# Looker Studio (and other BI) on ConsoleVault data

ConsoleVault writes one BigQuery table per property, plus **wildcard views** that span every
property. Point your BI tool at the views, not the raw tables, so new properties appear
automatically.

## The one-click way

**Settings → Looker Studio → Open in Looker Studio.** ConsoleVault builds a
[Looker Studio Linking API](https://developers.google.com/looker-studio/integrate/linking-api) URL
for your deployment: it opens Looker Studio in your own account with the three views below already
connected as data sources, named and typed. Nothing leaves your project — the link is just a
pre-filled "create report" URL, and the report queries your BigQuery under your own Looker Studio
credentials.

A client's **Configure** tab has the same button scoped to that client. That link binds a query with
`source_table IN (…that client's properties)` baked in and the scan bounded to your backfill window,
so it's safe to hand to the client: they can't filter their way to another client's data, and they
can't leave a 16-month scan running on every chart.

### Reusing a report you've already built

Set **Settings → Looker Studio → Template report id** to any Looker Studio report id (it's the
`lookerstudio.google.com/reporting/<REPORT_ID>` part of the URL). Every link then _copies_ that
report and repoints its data sources at this deployment instead of starting blank — which is how you
roll one layout out across clients, or adopt someone else's published template.

Two requirements Looker Studio imposes, not us:

- whoever opens the link needs at least **view access** to the template report;
- the template's data sources must be **aliased** `queries`, `pages` and `totals` (Resource → Manage
  added data sources → the _Alias_ column). The alias is how the Linking API knows which source to
  repoint; a mismatched alias is silently left pointing at the original project.

Leave the field empty and the link still works — you get a fresh report with the data ready, which
is all a report needs to get going.

## The views to connect

In dataset `gsc_views` (in your project):

| View             | Grain                                                   | Use for               |
| ---------------- | ------------------------------------------------------- | --------------------- |
| `byProperty_all` | query × country × device × day, all properties          | most reporting        |
| `byPage_all`     | page-level, all properties                              | page/landing analysis |
| `totals_all`     | daily totals (+ anonymized-query delta), all properties | true totals           |

Every row carries a **`source_table`** column = the property's table name, plus a `data_state`
column (`final` or `fresh`) — filter `data_state = 'final'` for locked numbers, or include `fresh`
for the latest provisional days.

## Connect it by hand

Or connect any BI tool yourself — the link above is a convenience, not a dependency.

1. **Create → Data source → BigQuery → Custom query** (or pick the `gsc_views` table directly).
2. Project = your ConsoleVault project; run a query such as:
   ```sql
   SELECT data_date, source_table, query, country, device,
          clicks, impressions, ctr, position, data_state
   FROM `YOUR_PROJECT.gsc_views.byProperty_all`
   WHERE data_date >= DATE_SUB(CURRENT_DATE('America/Los_Angeles'), INTERVAL 16 MONTH)
   ```
3. Set `data_date` as a Date dimension; `clicks`/`impressions` as metrics; add `ctr` and
   `position` as **average/weighted** (don't SUM them). `source_table` is your per-property filter.
4. Build report pages: trend (clicks/impressions over `data_date`), top queries, top pages
   (`byPage_all`), and a property selector on `source_table`.

## Notes

- **Costs** — Looker queries scan BigQuery and are billed to _your_ project. Date-filter every
  query; the views are partitioned by `data_date` underneath. The in-app **Costs** page and the
  billing budget keep an eye on spend.
- **CTR / position never SUM, and never AVG either.** They're ratios, so the only correct rollup
  re-derives them from the summable columns. Add these as calculated fields (the in-app card has a
  copy button for each):

  | Field              | Formula                                          |
  | ------------------ | ------------------------------------------------ |
  | Avg position       | `SUM(position * impressions) / SUM(impressions)` |
  | CTR                | `SUM(clicks) / SUM(impressions)`                 |
  | Top 10 impressions | `SUM(IF(position < 11, impressions, 0))`         |

  `AVG(position)` averages averages: it weights a query with three impressions the same as one with
  thirty thousand, and the number it produces belongs to no query, no property and no day.

- **A cross-region BigQuery-export property isn't in the `_all` views.** Its data stays in a
  region-local landing dataset (see [NATIVE-EXPORT.md](./NATIVE-EXPORT.md)), so it shows in
  ConsoleVault's own reports but not in a Looker report built on the wildcard views. The in-app card
  names any property this affects.
