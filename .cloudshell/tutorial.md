# Deploy ConsoleVault

This guided walkthrough deploys ConsoleVault into your own GCP project from Cloud Shell.

## 1. Pick your project

<walkthrough-project-setup></walkthrough-project-setup>

Make sure **billing is enabled** on it (ConsoleVault uses BigQuery, Cloud Run, Firestore, etc.).

## 2. Authenticate Application Default Credentials

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project "$(gcloud config get-value project)"
```

## 3. Run setup

```bash
./setup.sh
```

Answer the prompts (project id, location, region, admin email, optional billing account). The
script creates the Terraform state bucket, applies the infrastructure, builds and pushes the
container images, and deploys them. It is safe to re-run.

> **`bq_location` is permanent** — BigQuery and Firestore can't be relocated later. Choose once.

## 4. Finish OAuth setup in the app

When setup finishes it prints the **Management UI** URL. Open it — the first screen is a **setup
wizard** that shows the exact values to create a Google **Web OAuth client** (your app's own
redirect URI + JavaScript origin). Create it in the Console as the wizard instructs, download the
JSON, then run `./setup.sh` **again** — it detects the missing client and uploads the file for you.
Refresh, and the sign-in appears.

Then, signed in as an admin:

- **Connections → Connect Google account** — authorize; your properties are discovered automatically.
- **Settings** — set your **alert email**. (Or flip on **Sample data** to explore reports right away.)
- **Properties** — track the ones you want, then **Jobs → Run now**.

Full walkthrough: [`docs/GETTING-STARTED.md`](../docs/GETTING-STARTED.md).

## Done

<walkthrough-conclusion-trophy></walkthrough-conclusion-trophy>

ConsoleVault is collecting into your BigQuery. Connect Looker Studio to the `gsc_views.*_all`
wildcard views (`docs/LOOKER.md`) to report across every property at once.
