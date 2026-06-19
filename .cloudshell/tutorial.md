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

## 4. Open the UI and connect accounts

When setup finishes it prints the **Management UI** URL. Open it, sign in with an admin email you
configured, then:

- **Connect your Google account(s)** — see `docs/AUTH.md` for the OAuth client setup. Tokens are
  written only to Secret Manager.
- In **Settings**, set your **alert email** and collection defaults.
- Include the properties you want, then run the pipeline from **Jobs → Run now**.

## Done

<walkthrough-conclusion-trophy></walkthrough-conclusion-trophy>

ConsoleVault is collecting into your BigQuery. Connect Looker Studio to the `gsc_views.*_all`
wildcard views (`docs/LOOKER.md`) to report across every property at once.
