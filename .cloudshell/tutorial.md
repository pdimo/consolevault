# Deploy ConsoleVault

<walkthrough-tutorial-duration duration="10"></walkthrough-tutorial-duration>

ConsoleVault deploys into **your own** Google Cloud project — your Search Console data never
leaves it. **One command, no Terraform, no OAuth setup.** About 10 minutes, mostly waiting.

Click **Start**.

## Choose your project

Pick the project to deploy into — or create a new one:

<walkthrough-project-setup></walkthrough-project-setup>

Make sure **billing is enabled** on it (ConsoleVault uses BigQuery, Cloud Run and Firestore). If
you're not sure, open **Navigation menu → Billing** and confirm a billing account is linked.

Click **Next**.

## Authorize

Grant ConsoleVault your credentials to deploy on your behalf (a link appears — open it, allow,
paste the code back):

```sh
gcloud auth application-default login
```

## Deploy

Run the one-command installer:

```sh
./bootstrap.sh
```

It asks two simple things from a menu — **which project**, and **where your data should live**
(United States, Europe, Australia — Sydney, …) — then press **Enter**. No Terraform, no image
build, no region ids to memorize.

<walkthrough-footnote>The location is **permanent**, so pick the option closest to you. Everything else is
automatic — the app even generates its own admin password.</walkthrough-footnote>

After ~10 minutes it prints your **Management UI URL** and a **one-time admin password**. Copy both.

## Open your ConsoleVault

Open the printed URL and **sign in with the admin password** — no Google OAuth client, no consent
screen. Then connect your Search Console data the easy way:

1. **Connections** (left sidebar) → scroll to **Add a connection → Service account** → **Copy** the
   `sa-collector@…` email.
2. In [Search Console](https://search.google.com/search-console), open a property you manage →
   **Settings → Users and permissions → Add user** → paste that email (Restricted is enough).
3. Back in **Connections**, paste the same email into the Service-account card → **Register**
   (once — it then collects every property that grants it access).
4. **Jobs → Run now** — ConsoleVault discovers your properties and starts collecting.

Prefer to look around first? **Settings → Sample data** loads a demo client with no real data.

## You're done

<walkthrough-conclusion-trophy></walkthrough-conclusion-trophy>

ConsoleVault is running in your own project. 🎉

Re-print the URL or password any time:

```sh
gcloud run services describe consolevault-api --region YOUR_REGION --format='value(status.url)'
gcloud secrets versions access latest --secret=admin-password
```

Questions? Reach the maintainer at <https://dimo.com.au>.
