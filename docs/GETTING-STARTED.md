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
   Shell** button. A browser terminal opens with the code already downloaded (in
   `~/cloudshell_open/consolevault`). If a guided panel opens on the right, you can follow that
   instead — but these four commands are all it does.
2. **Point it at your project** (use the project ID from “Before you start”):
   ```bash
   gcloud config set project YOUR_PROJECT_ID
   ```
3. **Authorize the deploy** (a link appears — open it, allow, paste the code back if asked):
   ```bash
   gcloud auth application-default login
   gcloud auth application-default set-quota-project "$(gcloud config get-value project)"
   ```
4. **Deploy:**
   ```bash
   ./setup.sh
   ```
   It **auto-detects your project and admin email** and prints a short summary, then waits.
   - Press **Enter** to deploy with those settings, or type **`edit`** to change anything.
   - The one thing to decide is **Location** (`bq_location`) — where your data lives (`US`, `EU`,
     `australia-southeast1`, …). ⚠️ **This is permanent.** It defaults to `US`; type `edit` to change it.
   - _First run in Cloud Shell?_ `setup.sh` **installs Terraform automatically** (Cloud Shell no
     longer ships it) — that's normal, just let it run.

The script does the rest: it builds and deploys everything and, after ~10–15 minutes, prints your
**Management UI** link. Leave the tab open.

> `./setup.sh` is safe to re-run at any time — you'll do that once more in Step 2.

---

## Step 2 — Finish the one-time OAuth setup (the app guides you)

Open the Management UI link. Because signing in uses your own Google account, ConsoleVault needs a
**Web OAuth client** — and Google only lets you create that in the Console. The good news: **the app
shows you the exact values to paste**, so there's no guesswork.

The first screen is a **setup wizard**. Follow its steps:

1. **Create the OAuth app** — it links you straight to Google Auth Platform → **Get started**. An
   app name, your email, and audience **External** (or **Internal** for a Workspace org).
   > You do **not** need to add a scope under Data Access. ConsoleVault asks for
   > `webmasters.readonly` during sign-in itself, so it appears on the consent screen either way.
2. **Publish the app** — under **Audience**, click **Publish app**. Skip this and Google blocks
   sign-in with “has not completed the Google verification process.”
   > Staying in “Testing” with yourself as a test user also works, but Google then expires your
   > login every 7 days and collection stops silently. This is the most common setup mistake.
3. **Create a Web OAuth client** — the wizard shows the exact **JavaScript origin** and **redirect
   URI** to paste (they're your app's own address). Click **Copy**, paste, create, and **download
   the JSON**.
4. **Upload it** — back in Cloud Shell, run `./setup.sh` again. It notices the missing client, asks
   for the file you just downloaded, and stores it securely. (On this Terraform path you can't yet
   sign in, so the upload happens in your own deploy context rather than the browser.)
5. **Come back and refresh** — click **“I've finished setup — check again.”** The sign‑in screen
   appears.

Full reference, including what each error means:
**[CONNECT-GOOGLE-ACCOUNT.md](./CONNECT-GOOGLE-ACCOUNT.md)**.

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
