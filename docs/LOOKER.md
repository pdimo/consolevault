# Looker Studio (and other BI) on ConsoleVault data

ConsoleVault writes one BigQuery table per property, plus **wildcard views** that span every
property. Point your BI tool at the views, not the raw tables, so new properties appear
automatically.

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

## Connect Looker Studio

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
- **CTR / position never SUM** — they're ratios; average them (impression-weighted) across rows.
- A published, ready-made template URL isn't something this repo can mint for you, but the query
  above is all a fresh Looker Studio report needs to get going.
