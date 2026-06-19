# API efficiency (how we collect best-practice)

ConsoleVault follows Google's Search Console API performance guidance
(<https://developers.google.com/webmaster-tools/v1/how-tos/performance>) to keep collection fast and
quota-light. The binding constraint is **queries**, so the goal is **fewer and smaller requests**.

## What we do

- **gzip** — requests carry a `(gzip)` User-Agent so responses are compressed (gaxios decompresses
  transparently). `packages/gsc/src/client.ts` (`REQUEST_OPTS`).
- **Partial response (`fields`)** — we ask only for the fields we use:
  - data queries: `fields=rows(keys,clicks,impressions,ctr,position)`;
  - the finality **probe**: `fields=metadata` with `rowLimit=1` — we only need
    `first_incomplete_date`, so the probe response is tiny.
- **Probe once, reuse** — `first_incomplete_date` is property/type-wide. A daily run collects many
  recent days for the same property; instead of re-probing per day, we cache the probe for 60 min in
  Firestore (`packages/store/src/probe-cache.ts`), collapsing N probes to one GSC call per
  (property, type) per run. A Firestore read is far cheaper than a GSC query and **doesn't** count
  against GSC quota.
- **Only probe recent days** — days older than the look-back window are definitively final, so they
  skip the probe entirely.
- **Pagination to the ceiling** — 25K rows/page, stop at the 50K/day/type exposure ceiling.

## Why we do NOT batch

Google's batch endpoint combines calls into one HTTP request, but
[the docs are explicit](https://developers.google.com/webmaster-tools/v1/how-tos/batch): _"A set of
n requests batched together counts toward your usage limit as n requests, not as one request."_ So
batching gives **no quota relief** — it only saves HTTP round-trips while _concentrating_ load into a
burst (which is worse for the per-minute caps and harder to rate-limit per account). Our per-account
Cloud Tasks queues already pace dispatch smoothly under the limit, so we deliberately don't batch.

## Measuring it

Every collection records the number of GSC API calls it made (`api_calls` in `task_logs`), surfaced
on the **Quota** page (see [QUOTA.md](./QUOTA.md)).
