---
aliases:
  - ConsoleVault Scoping
  - ConsoleVault Build Spec
  - GSC API Cloud ETL Scope
tags:
  - type/project
  - domain/cloud_gcp
  - domain/seo
  - tech/gcp
  - tech/gsc
  - tech/bigquery
  - tech/firestore
  - tech/terraform
  - tech/nodejs
created: 2026-06-17
modified: 2026-06-17
maturity: budding
source: claude-research
---

# ConsoleVault — Scoping & Build Spec (v3)

> [!abstract]
> **ConsoleVault** is a self-deploy, open-source (Apache 2.0) product that extracts Google Search Console search-analytics data via the **API** into the user's own BigQuery, fully Terraform-deployed on GCP, managed through a Cloud Run UI. Built for agencies managing many GSC properties across multiple Google accounts who need **backdated, complete, multi-property** data in one warehouse. v3 finalises the architecture: Firestore control plane, batched-load ingestion with delete-then-load idempotency, provable coverage via a reconciliation planner, the query-vs-page aggregation model made explicit, web-only-by-default collection, single-admin UI, and the API+Bulk-Export hybrid as a roadmap item.

Supersedes v1 ([[Google Search Console (GSC) API Cloud ETL Pipeline]]) and v2. **This is the document to hand to Claude Code.**

---

## 0. Locked decisions

| Decision | Resolution |
|---|---|
| Product name | **ConsoleVault** |
| Language | **Node.js / TypeScript** end-to-end (UI, API, workers) |
| Control-plane store | **Firestore (Native mode)** — accounts, properties, config, groups, live task state |
| Analytics store | **BigQuery** — GSC data + immutable `task_logs` only |
| Ingestion | **Batched load jobs** with **delete-then-load per day-partition** (idempotent) |
| Orchestration | **Cloud Workflows** (DAG) + **Cloud Tasks** (per-account rate-limited fan-out) |
| Schema | **Table-per-property**, shared nullable columns, **wildcard views** for cross-client |
| Search types | **`web` only by default**; image/video/news/discover/googleNews **opt-in per property** |
| Aggregations | `byProperty` (query-level) + `byPage` (page-level) + `totals` (anomaly delta) |
| Auth | Multiple OAuth accounts **and** multiple service accounts; no primary; per-account failover |
| Property types | `url_prefix` and `domain` modelled distinctly; app-level property groups |
| UI access | **Single-admin first** (multi-user/roles later) |
| Licence | **Apache 2.0** |
| API + Bulk Export hybrid | **Roadmap only** (documented §12, not built now) |

---

## 1. Problem & wedge

Native **GSC → BigQuery Bulk Export** is forward-only (no backfill, confirmed by Google), owner-only per property, one Cloud project per property — unworkable for an agency with dozens-to-hundreds of client properties. The **Search Analytics API** exposes a rolling ~16-month window on demand, can be driven from the agency's existing common Google account(s), and lands data in whatever BigQuery project the agency controls.

No OSS project packages the API approach as a Terraform-deployed, multi-account, UI-managed, BigQuery-native, backfilling product — the field is single-file scripts or single-tenant dashboards. **The differentiation is packaging, operability, and provable completeness, not the API calls.**

**Self-deploy avoids OAuth verification + CASA.** `webmasters.readonly` is a *sensitive* scope; a central hosted SaaS would trigger brand verification + an annual CASA assessment ($500–$4,500/yr). Google **explicitly exempts internal-use-within-an-organization and dev/test/staging**. Each agency self-deploys its own OAuth client in its own GCP project for its own data → qualifies for the exception → no consent-screen verification, no CASA. Structural advantage; state it in the README; do not drift to central-hosted without budgeting CASA.

---

## 2. Architecture overview

```
Cloud Scheduler ──► Cloud Workflows (daily DAG: discover → reconcile/plan → enqueue)
                           │
                           ├─ Firestore (control plane: accounts, properties,
                           │             config, groups, task state)
                           │
                           ▼
                    Cloud Tasks (one queue per account, rate-limited)
                           │
                           ▼
                    Cloud Run "collector" (one task = one property×type×agg×day)
                           │  reads creds ◄── Secret Manager
                           │  writes NDJSON ─► GCS ─► batched LOAD ─► BigQuery
                           │                          (delete-then-load partition)
                           ▼
                    Cloud Run "log writer" ─► BigQuery task_logs (append-only)
                                            └► Firestore task state (terminal status)

Cloud Run "UI/API" (React SPA + control-plane API) ◄──► Firestore / BigQuery / Secret Manager
Cloud Monitoring + Logging (alerts); Billing export ─► BigQuery (cost panel)
All provisioned by Terraform (GCS backend + state locking).
```

**Why Firestore for the control plane (not BigQuery):** task state flips pending→queued→terminal hundreds of thousands of times during backfill. BigQuery is analytical — it has hard concurrent-DML and update-frequency limits and would contend badly. Firestore is serverless, scales to zero, and is built for high-frequency small writes. **BigQuery holds only the GSC data and the append-only `task_logs`** (never updated → no contention).

---

## 3. Authentication (multiple accounts, mixed auth)

`account` is first-class; a deployment holds **many** OAuth accounts **and** service accounts simultaneously.

- **Multiple OAuth accounts** — agencies have several common logins (legacy, acquired, regional). Each = one account doc, refresh token in **Secret Manager** only.
- **Multiple service accounts** — for clients who add a SA email to their property. Prefer workload-identity/impersonation over downloaded JSON keys; if a key is unavoidable, store in Secret Manager + document rotation.
- **Per-property failover** — a property reachable by several accounts records a preferred account and can fail over.

**Token lifecycle = the #1 operational risk.** A stale refresh token silently zeroes an account's collection. From MVP: scheduled `token_health` check per OAuth account, proactive refresh, UI badges (valid / expires-soon / broken / revoked), and a Cloud Monitoring alert on auth failure *before* a silent zero-row day.

The local auth helper writes tokens **straight to Secret Manager** — the tool never holds raw credentials in plaintext.

---

## 4. Property model (site vs domain; groups)

Two GSC property types, maintained distinctly:
- **URL-prefix** — `https://www.example.com/`; exact protocol+host+path.
- **Domain** — `sc-domain:example.com`; DNS-verified; auto-aggregates all protocols/subdomains/paths.

**Property sets are dead** (Google removed them; domain properties replaced them). There is **no native API grouping**. So combining arbitrary URL-prefix properties is an **app-level "property group"**: collect members raw, union at query time via a generated view (§6.4). UI warns if a group mixes a domain property with URL-prefix children of the same domain (double-count risk).

---

## 5. Orchestration: Workflows + Cloud Tasks

**Workflows = control flow** (daily DAG, ≤3 steps, observable, Terraform-able). **Cloud Tasks = fan-out** (hundreds of thousands of per-unit tasks, rate-limited). Google's own documented pattern. The collector is the **HTTP target** Cloud Tasks invokes.

### 5.1 Daily workflow (Scheduler → Workflows)

```
DAILY_WORKFLOW:
  1. discover_properties:
       for each enabled account (parallel, bounded):
         Sites:list → upsert Firestore properties; log add/remove; tag property_type
  2. reconcile_and_plan:           # see §8 — this is the heart
       for each included property × enabled aggregation × enabled type:
         expected_days = current rolling window (PT) minus offset_days
         missing = expected_days − days already in terminal state (Firestore)
         for each missing day: create task doc (status=pending, hash id)
  3. enqueue:
       for each pending task: create Cloud Task (name = hash) in account's queue
         → status=queued    (duplicate names rejected = free idempotency)
```

### 5.2 Collector (Cloud Tasks → Cloud Run)

```
COLLECTOR (one task = property × aggregation × type × day):
  load creds from Secret Manager(account_id)   # fail over if broken
  rows = []
  startRow = 0
  loop:
    body = build_query(property, aggregation, type, date, startRow,
                       rowLimit=25000, dataState="all")   # PT date; "all" → fresh + first_incomplete_date
    resp = searchanalytics.query(body)
    rows += resp.rows
    startRow += 25000
    until resp.rows.length == 0  OR  startRow >= 50000   # 50K/day/type ceiling
  if rows is empty:
     mark task collected_no_data (terminal); emit log; return
  add row_hash to every row
  write NDJSON → GCS
  DELETE the (property,type,agg,date) partition slice → LOAD the NDJSON   # idempotent
  if aggregation == "totals": compute + store anomaly/anonymized delta row
  mark task collected_with_data (terminal); emit log
  on quotaExceeded / 5xx: throw retryable → Cloud Tasks backoff
```

### 5.3 Rate-limit math (account-aware)

Binding constraint = **per-user 1,200 QPM** and per-site 1,200 QPM (not per-project's 40,000). All properties on one account share that account's budget → **one Cloud Tasks queue per account**, dispatch rate well under 1,200 QPM (target ~10–15 QPS = 600–900 QPM) to leave headroom and avoid short-term **load**-quota trips. Spread, don't burst (load quota measured in 10-min chunks).

---

## 6. BigQuery schema (table-per-property + wildcard views)

### 6.1 Layout

```
gsc_byProperty.<sanitized_property>   DATE-partitioned, cluster (query)
gsc_byPage.<sanitized_property>       DATE-partitioned, cluster (query, page)
gsc_totals.<sanitized_property>       DATE-partitioned
gsc_views.byProperty_all / byPage_all wildcard unions across properties
task_logs.attempts                    append-only, one row per task attempt
```

(Mutable control state — accounts, properties, config, groups, task status — lives in **Firestore**, not BigQuery.)

### 6.2 Shared row schema (nullable columns; one shape across types/aggregations)

`data_date` (DATE), `property` (STRING), `property_type`, `search_type` (web|image|…|discover|googleNews), `aggregation` (byProperty|byPage|totals), `query` (NULLABLE — absent for totals & Discover), `page` (NULLABLE — only byPage), `country`, `device`, `search_appearance` (NULLABLE), `clicks`, `impressions`, `ctr`, `position`, `is_anonymized` (BOOL), `row_hash` (STRING), `collected_at` (TIMESTAMP), `data_state` (final|fresh — per `first_incomplete_date`, see §8).

Nullable-shared (not per-type schemas) keeps wildcard views trivial and absorbs the fact that Discover/GoogleNews lack `query` and don't support `byProperty`.

### 6.3 Ingestion + idempotency (batched load, delete-then-load)

Load jobs append (can't MERGE), so dedup happens at the **partition** level. Because a task always collects **one whole day**, the day is the atomic unit:

> **Delete the (property, type, aggregation, date) partition slice, then load the freshly-collected rows.** Re-running a task *replaces* the day → identical result every time. This is idempotent by construction and **also the restatement mechanism** (re-collecting a Google-restated day just overwrites it).

`row_hash = sha256(property|data_date|search_type|aggregation|query|page|country|device|search_appearance)` is stored as a belt-and-braces guard and powers the dedup assertion (§13).

### 6.4 Combined properties: raw + query-time view (verified)

Store members raw; union in a view. Rationale: GSC has no native grouping (so it's *our* logic, best kept changeable); non-destructive (can ungroup/regroup/report standalone); **combining isn't SUM** — clicks/impressions add but **CTR and position must be re-weighted**, encoded once in the view; cheap/flexible; the view can prevent domain+child double-counting. Promote a heavy group's view to a scheduled materialised table only as an optimisation.

---

## 7. Search types & aggregations

### 7.1 Types — `web` default, rest opt-in per property

| type | byProperty? | query dim? | notes |
|---|---|---|---|
| `web` | yes | yes | **default, collected out of the box** |
| `image` | yes | yes | opt-in |
| `video` | yes | yes | opt-in |
| `news` | yes | yes | opt-in |
| `discover` | **no** | **no** | opt-in; restricted dimensions; high GEO/LLMO value |
| `googleNews` | **no** | yes | opt-in |

Type is part of the task hash and a stored column. `build_query` must encode per-type capability (no byProperty / no query where unsupported) so we never send invalid requests. **Don't hard-code search-appearance enums** — FAQ appearance is deprecated in the API Aug 2026; discover appearance values via the two-step query.

### 7.2 Aggregations — query-level and page-level are genuinely different (collect both)

Metrics are computed differently by aggregation, and the two **do not reconcile by design** — when one SERP shows several of your URLs, by-property counts one impression for the site while by-page counts one per page. Neither is wrong; they answer different questions.

- **`byProperty`** `[date, query, country, device]` → *"which queries drive my site?"* — **query-level**, property-accurate metrics.
- **`byPage`** `[date, query, page, country, device]` → *"which page ranks for which query?"* — **page-level**; adds `page`, **drops more data** (Google sheds rows on page+query grouping), page-accurate metrics.
- **`totals`** `[date]` only → true daily clicks/impressions → compute the **anonymized-query delta** and store as a labelled `is_anonymized` row.

These are three separate passes into three datasets. They will never sum to each other — pick the right table per question (strategy from `byProperty`, page↔query mapping from `byPage`). Matches the existing vault query patterns.

---

## 8. Backfill & provable coverage (the correctness core)

The job is a **reconciliation**, not a one-shot backfill — backfill, daily increment, gap-fill-after-outage, and restatement look-back are all the *same* operation, so steady-state can never drift from backfill.

**Dynamic window.** The available range is a *rolling* ~16 months (some accounts 14) that advances daily. Recompute every run: oldest available day and newest finalized day (= today − `offset_days`, in **Pacific Time** — all date logic uses a single shared PT utility or you'll request non-existent days and miss the newest day).

**Per-(property × type × aggregation × day) coverage.** Coverage is tracked per cell, not per day — a day can be complete for `web/byProperty` but pending for `web/byPage`. This is what the heatmap shows.

**Finality is data-driven, not time-driven.** Day collection uses **`dataState=all`** (fresh rows are stored, labelled); the finality boundary is **`metadata.first_incomplete_date`** (PT), fetched via one cheap multi-day `[date]` range probe for recent days only (the API omits `metadata` on single-day queries; old days skip the probe). A day `D` is **final** iff `D < first_incomplete_date` (locked, never re-collected); otherwise **fresh** (Google may still revise it). Each row is stamped `data_state` = `final|fresh`. States:
- `pending` / `queued` (non-terminal)
- `collected_fresh` (**non-terminal** — collected while fresh; re-collected each run until it finalizes)
- `collected_with_data` (terminal/**locked** — final + rows)
- `collected_no_data` (terminal/**locked** — final + no traffic; the API omits no-traffic days, so "nothing" on a **final** day means truly empty)
- `error` (retryable; dead-letter after N attempts)

**No look-back window.** There is deliberately no fixed re-collection window. The planner re-collects any day that isn't locked-final; `collected_fresh` days self-resolve to final within a few days as `first_incomplete_date` advances. This replaces the old (undocumented) "~30-day restatement" window — delete-then-load makes the fresh→final replacement safe. See [`docs/DATA-FRESHNESS.md`](docs/DATA-FRESHNESS.md).

The planner each run: `expected_days(window, PT) − cells already terminal` = the gaps to enqueue. New property and year-old property run identical logic.

---

## 9. Dedup — guarantees + tests

**Two independent layers** (different failure modes):
1. **Task idempotency** — task hash = Cloud Tasks task *name*; duplicate names rejected. Stops double-scheduling (overlapping backfill/daily, retries, crashes).
2. **Row/partition idempotency** — delete-then-load per (property,type,agg,date) partition; re-runs replace, never append. Protects against the write-succeeded-then-failed-before-ack retry.

**Tests (CI + runtime assertion):**
- *Replay:* run a task twice on a fixed date → row count + `row_hash` set identical (not doubled).
- *Standing invariant (scheduled):* `SELECT row_hash, COUNT(*) … HAVING COUNT(*)>1` returns zero; violation → UI alert.
- *Overlap:* simultaneous backfill + daily over same dates → no duplication.
- *Crash injection:* worker writes then throws pre-ack → retry replaces, not appends.

---

## 10. Management UI (single-admin first)

- **Accounts/auth:** add OAuth (guided) or service account; token-health badges; re-auth/remove; per-account property count + last success.
- **Properties/groups:** auto-discovered list with URL-prefix/Domain tags + permission level; include/exclude per property; per-property config (aggregations, **types — web on by default, others opt-in**, offset_days, backfill_months); property groups with double-count warning; failover/preferred-account.
- **Coverage & verification (make strong):** per-property **coverage heatmap** (16-month grid × cell state) — the "is my data actually complete?" view; backfill progress; totals-vs-detail **anomaly %** per property (turns the privacy gap into a visible trust metric); freshness indicator; **"Verify my setup" health check** (auth ok, test query returns rows, BQ writable, queue dispatching, scheduler firing — the "Doctor" pattern).
- **Jobs/logs:** live queue status; searchable task log + one-click re-collect; dead-letter view; per-account quota/throttle status.
- **Costs/settings:** cost panel (§11); safety-valve config; global defaults (offset, backfill window, schedule, dataset/location, partition expiry).
- **Later:** config export/import, Looker Studio template links (reuse [[Google Search Console via Bigquery]]), failure/gap webhooks, multi-user + roles.

---

## 11. Cost guardrails & visibility

- **Visibility:** enable **Billing export → BigQuery**; UI shows actual storage/query/Run/Tasks spend, trended. Estimated storage per property from row counts; estimated monthly run cost.
- **Guardrails (the "safety valve"):** product-run queries first issue a BigQuery **`dryRun`** → estimate bytes/cost → block/warn over a configurable threshold; daily query-cost **circuit breaker** against a user cap; **partition-expiry** defaults + clustering; optional Terraform-provisioned Cloud Billing **budget + alert**.
- Boundary: ingest writes are cheap/bounded; the valve mainly protects the user from their *own* downstream queries and runaway storage. Framing: "you will never get a surprise five-figure BigQuery bill."

---

## 12. Roadmap (not built now)

- **API + Bulk Export hybrid** *(documented future feature).* The API's hard limit is **50K rows/day/type** — very large sites can't get everything via API. Native Bulk Export has no row limit but no backfill. The complete-history play: ConsoleVault **backfills 16 months via API** *and* helps the user configure the native **Bulk Export** for forward-going complete data, then **unions both in BigQuery** (dedup on the overlap). Even just detecting "this property exceeds the API ceiling → here's how to add Bulk Export" in the UI is valuable. Turns the main weakness into a feature. **Roadmap only.**
- Extra types live (image/video/news/discover/googleNews already schema-ready).
- `hourly_all` near-real-time mode (last ~8 days; premium).
- Search-appearance two-step collection (mind Aug-2026 FAQ deprecation).
- **Bing Webmaster Tools** connector; **Google Business Profile**; broader [[MarketingOS (Open Source Marketing Data Layer)]] source set.
- Multi-user + roles.

---

## 13. Staged build plan (for Claude Code)

- **Stage 0 — Repo + Terraform bootstrap.** Turborepo (TS); `terraform/` GCS backend + locking; enable APIs (searchconsole, bigquery, firestore, run, cloudtasks, workflows, cloudscheduler, secretmanager, storage, logging, monitoring, billingbudgets); single `terraform.tfvars`; Apache 2.0 LICENSE; CI. → *`terraform apply` stands up an empty, permissioned project.*
- **Stage 1 — Accounts + property discovery.** Local OAuth helper → Secret Manager; service-account registration; **multiple accounts**; `discover_properties` (Sites:list) → Firestore `accounts`/`properties` with `property_type`; token-health check. → *"Added two Google accounts; it listed every property each can see, tagged URL-prefix vs Domain."*
- **Stage 2 — Collector + idempotent load.** One (property, byProperty, web, day): paginate to 50K, hash rows, NDJSON→GCS, **delete-then-load** partition; `collected_no_data` handling; manual trigger. → *"Real rows in BigQuery for one property/day; re-running replaces, never duplicates."*
- **Stage 3 — Workflows + Cloud Tasks + reconciliation + schedule.** Daily Workflow (discover→reconcile/plan→enqueue); per-account queues + backoff; log writer; Scheduler; add `byPage` + `totals`/anomaly-delta; rolling window + look-back; coverage states. → *"Backfilled 16 months across all properties/accounts, self-updates daily, rate-limited per account, provably complete."*
- **Stage 4 — Management UI.** Accounts/auth, properties/include-exclude/config (web default + opt-in types), property groups, **coverage heatmap + verify-setup**, jobs/logs/re-collect. → *"A PM manages everything and sees exactly how complete each client's data is."*
- **Stage 5 — Costs + docs + redistributability.** ✅ Cost panel (BigQuery storage estimate, no billing-export dependency) + Cloud Billing **budget** (50/90/100%); cross-property **wildcard views** (`gsc_views.*_all`, self-maintaining); **operational alerting** (token-health sweep + Monitoring alerts for unhealthy tokens / collector errors / no-collection-24h, with the alert email a **runtime Setting** so each install configures its own); `setup.sh` one-command deploy + **Cloud Shell** magic-link; README/DEPLOY/LOOKER docs. The dry-run query valve was **deferred** (no in-UI query runner; the budget + alerts cover the real risk). → *"Deploy into your own GCP in ~15 min, see costs, no surprise bills."*

---

## 14. Remaining open questions

- [x] ~~Look-back window~~ — **removed.** Replaced by data-state-driven re-collection
  (`first_incomplete_date`); fresh days re-collect until final. See `docs/DATA-FRESHNESS.md`.
- [ ] Dead-letter retry count before manual-only.
- [x] BQ dataset **location** — a permanent `bq_location` tfvar chosen once at deploy; documented in
  README/DEPLOY and prompted by `setup.sh`.
- [ ] Table-name sanitization rules (trailing slash, IDN/unicode domains, collision strategy).
- [x] Least-privilege IAM split — done: `sa-api` (UI/control), `sa-collector` (BQ writer + creds),
  `sa-workflows` (orchestration). SPEC §13 / §3.

---
## Related
- [[Google Search Console (GSC) API Cloud ETL Pipeline]]
- [[Google Search Console Tool]]
- [[Google Search Console via Bigquery]]
- [[Google Search Console Resources]]
- [[MarketingOS (Open Source Marketing Data Layer)]]
- [[Multi-Tenant Agentic Middleware for Agencies]]
- [[Self-Hosted GSC Analytics Platform (mddanishyusuf)]]
- [[BigQuery Data Transfer Service]]
- [[Projects MOC]]
