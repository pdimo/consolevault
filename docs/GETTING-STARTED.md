# Getting started — deploy ConsoleVault in ~30 minutes

This is the friendly, start-to-finish guide. **No coding required** — everything is copy‑paste, and
the app itself walks you through the fiddly bits. If you can follow a recipe, you can do this.

**What you'll end up with:** your own private copy of ConsoleVault running in your own Google Cloud
account, pulling your Search Console data into your own BigQuery, with a clean reporting UI on top.

**Who this is for:** agency owners, marketers, and anyone who wants complete, backdated Search
Console data without wiring scripts together. You do not need to be a developer.

---

## Before you start — the 3 things you need

1. **A Google account** (the one that can see your Search Console properties).
2. **A Google Cloud project with billing enabled.** This is where _your_ ConsoleVault lives. If you
   don't have one: open the [Cloud Console](https://console.cloud.google.com/), click the project
   dropdown → **New project**, give it a name, then enable billing under **Billing**. Note the
   **project ID** (looks like `my-company-seo-123456`).
3. **~30 minutes**, most of which is the deploy running by itself.

> **Will this cost money?** Very little. Collecting data is essentially free; storage is a few cents
> a month per site. The deploy automatically sets up a **budget alert** so you can never get a
> surprise bill. Most agencies run this for well under the cost of a coffee per month.

---

## The 5 steps at a glance

1. **Deploy** with one command (in your browser — nothing to install).
2. **Finish OAuth setup** — the app shows you exactly what to click.
3. **Sign in** with your admin email.
4. **Connect** your Google account and pick properties.
5. **See your first report.**

---

## Step 1 — Deploy (in your browser, nothing to install)

The easiest path uses **Cloud Shell** — a terminal that runs in your browser, with all the tools
already installed. You don't install anything on your computer.

> **On Windows, use Cloud Shell.** `setup.sh` is a bash script — Windows Command Prompt/PowerShell
> can't run it, but Cloud Shell (or WSL / Git Bash) can, and Cloud Shell needs zero setup. Mac and
> Linux can run it locally after installing `gcloud` + `terraform`, but Cloud Shell is still the
> simplest.

1. On the [ConsoleVault repo](https://github.com/pdimo/consolevault), click the **Open in Cloud
   Shell** button. A terminal opens with the code already downloaded.
2. Run:
   ```bash
   ./setup.sh
   ```
3. Answer the handful of prompts:
   - **Project ID** — from the step above.
   - **Location** — where your data lives (e.g. `US`, `EU`, `australia-southeast1`).
     ⚠️ **This is permanent** — it cannot be changed later, so pick the region closest to you.
   - **Region** — for the app itself (e.g. `us-central1`); the default is fine.
   - **Admin email(s)** — the Google account(s) allowed to sign in.
   - **Billing account** — optional, enables the budget alert (press Enter to skip).

The script does the rest: it builds and deploys everything and, after ~10–15 minutes, prints your
**Management UI** link. Leave the tab open.

> `./setup.sh` is safe to re-run at any time — you'll do that once more in Step 2.

---

## Step 2 — Finish the one-time OAuth setup (the app guides you)

Open the Management UI link. Because signing in uses your own Google account, ConsoleVault needs a
**Web OAuth client** — and Google only lets you create that in the Console. The good news: **the app
shows you the exact values to paste**, so there's no guesswork.

The first screen is a **setup wizard**. Follow its four steps:

1. **Consent screen** — it links you straight to the right page. Set an app name + your email, add
   the one read‑only scope it shows you, and **publish to “In production.”**
   > Why “In production”? An app left in “Testing” makes Google expire your login every 7 days.
   > Publishing (you can stay _unverified_) gives you a stable login. This is the single most common
   > setup mistake — the wizard reminds you.
2. **Create a Web OAuth client** — the wizard shows the exact **JavaScript origin** and **redirect
   URI** to paste (they're your app's own address). Click **Copy**, paste, create, and **download
   the JSON**.
3. **Upload it** — back in Cloud Shell, run `./setup.sh` again. It notices the missing client, asks
   for the file you just downloaded, and stores it securely. Nothing sensitive is ever pasted into
   the browser.
4. **Come back and refresh** — click **“I've finished setup — check again.”** The sign‑in screen
   appears.

> Prefer not to use a consent screen at all? There's a **service‑account** path too — add the
> collector's email (shown in the wizard) as a user on your Search Console property. See
> [AUTH.md](./AUTH.md).

---

## Step 3 — Sign in

Click the Google sign‑in button and choose an **admin email** you configured in Step 1. That's it —
you're in.

---

## Step 4 — Connect your Google account & pick properties

1. Go to **Connections** → **Connect Google account** → authorize. Your Search Console properties
   are discovered automatically.
2. Go to **Properties**, and flip on the ones you want to collect (bulk‑select works). Web data is
   collected by default; you can opt into image/video/news/etc. per property.

---

## Step 5 — See your first report

1. Go to **Jobs → Run now** to start collecting immediately (or just wait for the daily 9am run).
   ConsoleVault backfills up to **16 months** of history — this can take a little while the first
   time.
2. Open **Clients**, pick a property, and view its **Report**.

> **Want to look around right now, before collection finishes?** Go to **Settings → Sample data**
> and turn it on. A fully‑populated **demo client** appears so you can explore every report and
> chart immediately. Turn it off whenever you like.

---

## Optional — connect Looker Studio

Your data is plain BigQuery, so you can build your own dashboards too. Point Looker Studio at the
`gsc_views.*_all` wildcard views to report across every property at once — see
[LOOKER.md](./LOOKER.md).

---

## If something looks off — the Doctor

Open **Health** in the app. It runs a checklist (accounts connected, a live test query, BigQuery
reachable, the daily job, recent collection, the OAuth client, admin access) and tells you exactly
what's wrong. Most first‑run issues are the “publish to production” step from Step 2.

## Costs, in plain terms

Collection is near‑free. Storage is a few cents per site per month. The **Costs** page shows your
actual usage, and the budget alert from Step 1 emails you long before anything unexpected. Framing:
_you will never get a surprise five‑figure BigQuery bill._

---

Stuck? The [full deploy notes](./DEPLOY.md) and [auth scenarios](./AUTH.md) cover every edge case.
