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

Plus two **pre-aggregated rank views**, for ranking-distribution reporting:

| View                   | Grain                               | Use for               |
| ---------------------- | ----------------------------------- | --------------------- |
| `rank_buckets_daily`   | day × property × rank bucket        | ranking-segment trend |
| `rank_buckets_by_page` | day × property × page × rank bucket | rank-bucket heatmap   |

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

## Rank buckets instead of average position

`position` is one floating-point average per row, and it lies whenever the distribution is lopsided:
ranking 1st for one query and 25th for twenty averages to about 24, which describes neither outcome.
The rank views bucket instead — `1 · 2 · 3 · 4–5 · 6–10 · 11–20 · 21–50 · 51+` — so a chart shows the
shape rather than the average.

```sql
SELECT data_date, source_table, page, rank_bucket, rank_bucket_index,
       queries, impressions, clicks
FROM `YOUR_PROJECT.gsc_views.rank_buckets_by_page`
WHERE data_date >= DATE_SUB(CURRENT_DATE('America/Los_Angeles'), INTERVAL 28 DAY)
```

- **Sort on `rank_bucket_index`, not `rank_bucket`.** Looker Studio sorts a string dimension
  alphabetically, which puts '11–20' before '4–5'. Set `rank_bucket_index` as the sort field on every
  chart that uses the label.
- **Heatmap:** pivot table with `page` as rows, `rank_bucket` as columns, `queries` as the metric,
  conditional formatting on a single colour scale. Weight by `impressions` instead to answer "where
  does it matter" rather than "where do we rank".
- **Ranking-segment trend:** `rank_buckets_daily` as a 100% stacked area — `data_date` on x,
  `rank_bucket` as the breakdown, `impressions` as the metric.
- The rank views **don't carry device/country** — pre-aggregating them away is what keeps these fast.
  Slice by device or country against `byProperty_all` / `byPage_all` instead.
- Rows without a query (totals, Discover) are excluded: there's nothing to bucket.

## Notes

- **Costs** — Looker queries scan BigQuery and are billed to _your_ project. Date-filter every
  query; the views are partitioned by `data_date` underneath. The in-app **Costs** page and the
  billing budget keep an eye on spend.
- **CTR / position never SUM** — they're ratios; average them (impression-weighted) across rows.
- A published, ready-made template URL isn't something this repo can mint for you, but the query
  above is all a fresh Looker Studio report needs to get going.
