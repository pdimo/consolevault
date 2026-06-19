# Materialized property-group views

A **property group** unions several properties into one queryable result. By default that union is a
**view** (`gsc_views.group_<id>`) — always current, but it re-scans every member table on each query.
For groups you query a lot (dashboards, scheduled BI), you can opt into a **materialized table**.

## What it does

Toggle **Materialized** on a group (Groups page) and ConsoleVault maintains a table
`gsc_views.group_<id>_mat` — a `CREATE OR REPLACE TABLE` snapshot of the group's union — that BI
tools can read cheaply. It's refreshed:

- **immediately** when you toggle it on (or change membership), and
- **daily**, as the last step of the collection workflow (`/refresh-materialized`).

The live **view** still exists and is always current; the materialized table is the fast snapshot.

## When to use it

| Use the **view** (default)  | Use a **materialized table**  |
| --------------------------- | ----------------------------- |
| Ad-hoc / occasional queries | Frequently-queried dashboards |
| Always-fresh required       | A ≤1-cycle lag is fine        |
| Minimise storage            | Minimise query cost/latency   |

## Trade-offs

- **Cost:** the table duplicates the group's data in storage (small for query-level data; watch
  large `byPage` groups). It's rebuilt daily, so it incurs a daily query/write — still tiny at
  typical volumes. The **Costs** page tracks storage.
- **Freshness:** the snapshot lags by up to one collection cycle (it's rebuilt after each daily run
  from already-loaded data). For real-time, query the view.
- Turning it off (or deleting the group) drops the table automatically.

## Querying

```sql
SELECT data_date, query, SUM(clicks) AS clicks, SUM(impressions) AS impressions
FROM `YOUR_PROJECT.gsc_views.group_<id>_mat`
GROUP BY 1, 2
```

`ctr` and `position` in the union are already impression-weighted — average, don't SUM them.
