# Deploy ConsoleVault

<walkthrough-tutorial-duration duration="15"></walkthrough-tutorial-duration>

ConsoleVault deploys entirely into **your own** Google Cloud project — your Search Console
data never leaves it. This guided walkthrough takes about 15 minutes, most of which is just
waiting on the build.

Click **Start** to begin.

## Choose your project

Pick the Google Cloud project ConsoleVault will deploy into — or create a new one:

<walkthrough-project-setup></walkthrough-project-setup>

Make sure **billing is enabled** on that project (ConsoleVault uses BigQuery, Cloud Run,
Firestore and Cloud Tasks). If you're not sure, open the **Navigation menu → Billing** in the
Cloud Console and confirm a billing account is linked.

Click **Next** once your project is selected.

## Authorize the deployment

ConsoleVault runs Terraform as **you**, using your own credentials — nothing is uploaded to a
third party. Grant those credentials (a browser authorization link will appear — click it and
allow):

```sh
gcloud auth application-default login
```

Then point them at your project (needed for the billing-budget API):

```sh
gcloud auth application-default set-quota-project "$(gcloud config get-value project)"
```

## Deploy

Run the one-command deploy:

```sh
./setup.sh
```

It **auto-detects your project and admin email**, shows a short summary, and asks you to
confirm **once** — just press **Enter**. To change anything (region, extra admins, a billing
account for the budget), type `edit` at that prompt.

<walkthrough-footnote>The **BigQuery + Firestore location is permanent** — it defaults to `US`. For a different
region (e.g. `australia-southeast1`), type `edit` and set it before confirming.</walkthrough-footnote>

The build takes ~10–15 minutes. On a brand-new project some APIs take a moment to propagate,
so if it stops early, just run `./setup.sh` again — it's safe to re-run.

## Open your ConsoleVault

When it finishes, `./setup.sh` prints your **Management UI** URL. From here, everything is in
the browser:

1. The first screen is a **setup wizard** showing the exact values to create your Google
   **Web OAuth client** (redirect URI + JavaScript origin). Create it in the Console as shown,
   download the JSON, then run `./setup.sh` **one more time** — it detects and uploads the
   client for you.
2. Refresh, **sign in** with your admin Google account, click **Connect Google account**, set
   your **alert email** in Settings, **include** the properties you want, then **Jobs → Run now**.

Prefer to explore first? **Settings → Sample data** loads a fully-populated demo client with no
real data.

## You're done

<walkthrough-conclusion-trophy></walkthrough-conclusion-trophy>

ConsoleVault is now running in your own project. 🎉

Re-print the Management UI URL any time:

```sh
terraform -chdir=terraform output -raw api_url
```

Connect Looker Studio to the `gsc_views.*_all` wildcard views (`docs/LOOKER.md`) to report
across every property at once. Questions? Reach the maintainer at <https://dimo.com.au>.
