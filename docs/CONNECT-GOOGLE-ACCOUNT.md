# Connect a Google account

This is the one part of ConsoleVault that can't be automated. Google doesn't let an application
create its own OAuth client or publish its own consent screen, so you do it once, by hand, in the
Cloud Console. It takes about five minutes.

**The app walks you through this too** — **Connections → Connect a Google account** shows the same
steps with the exact values for your deployment already filled in and copy buttons next to them.
This page is the reference version, with the reasoning and the failure modes.

> **Do you even need this?** If you only manage clients' properties, the **service-account** path
> needs no Console setup at all: grant one email access in Search Console and you're done. See
> [AUTH.md](./AUTH.md#scenario-c--service-account-only) or just open **Connections** in the app.
> Use a Google account when you want everything a login can already see, without touching each
> property.

---

## Step 1 — Create the OAuth app

Open **[Google Auth Platform](https://console.cloud.google.com/auth/overview)** (pick your project
in the top bar) and click **Get started**.

<!-- PENDING ASSET — uncomment once the file exists:
![Google Auth Platform, not configured yet](./images/oauth/01-get-started.png)
-->

You'll be asked for four things:

| Field                   | What to put                                                                    |
| ----------------------- | ------------------------------------------------------------------------------ |
| **App Information**     | Any app name, and your email as the support contact. Only you ever see these.  |
| **Audience**            | **External** — unless your project is in a Google Workspace organisation and you'll sign in with an account inside it, in which case choose **Internal** and skip step 2 entirely. |
| **Contact Information** | Your email again.                                                              |
| **Finish**              | Agree to the policy, then **Create**.                                          |

<!-- PENDING ASSET — uncomment once the file exists:
![Project configuration — App Information, Audience, Contact Information, Finish](./images/oauth/02-project-configuration.png)
-->

### You do not need to add a scope

Older guidance (including ConsoleVault's own, before this was corrected) told you to add
`https://www.googleapis.com/auth/webmasters.readonly` under **Data Access**. You don't need to, and
the page it used to link to doesn't even offer the control.

ConsoleVault requests that scope as part of the sign-in itself, so Google shows it on the consent
screen whether or not it's registered here. Registering scopes under Data Access only matters if
you submit the app for Google **verification** — which self-deploying is specifically designed to
avoid ([why](../README.md#why-self-deploy-the-oauth--casa-advantage)).

---

## Step 2 — Let yourself in

**This is the step that trips everyone up.** A brand-new app is in *Testing* with no users, and
Google will refuse to let you sign in:

```text
Access blocked: <your-app> has not completed the Google verification process
Error 403: access_denied
```

<!-- PENDING ASSET — uncomment once the file exists:
![Access blocked — has not completed the Google verification process](./images/oauth/05-access-blocked.png)
-->

Open **[Audience](https://console.cloud.google.com/auth/audience)** and do **one** of these:

<!-- PENDING ASSET — uncomment once the file exists:
![Audience — Publishing status, User type, Test users](./images/oauth/06-audience.png)
-->

### Publish app — recommended

Click **Publish app**. Your sign-in then keeps working indefinitely.

The app stays **unverified**, which is fine for your own data. At sign-in Google shows a notice
that it hasn't verified the app and that you won't see links to a privacy policy or terms — click
**Continue**.

<!-- PENDING ASSET — uncomment once the file exists:
![Consent screen — View Search Console data for your verified sites](./images/oauth/07-consent.png)
-->

### Or add yourself as a test user

Under **Test users → Add users**, add your own Google address.

This works, but Google issues refresh tokens that **expire after 7 days** to External apps left in
Testing. When that token dies, collection stops — and it stops *silently*, which is the single
worst failure mode in this product. Fine for a look around; don't run on it.

---

## Step 3 — Create the Web client

Open **[Clients](https://console.cloud.google.com/auth/clients)** → **Create client** →
application type **Web application**. Name it anything.

Two values need to match your deployment exactly. The app shows both with copy buttons under
**Connections → Connect a Google account**, step 3:

| Field                         | Value                                       |
| ----------------------------- | ------------------------------------------- |
| **Authorized JavaScript origins** | `https://<your-api-url>`                |
| **Authorized redirect URIs**      | `https://<your-api-url>/api/oauth/callback` |

<!-- PENDING ASSET — uncomment once the file exists:
![Create OAuth client ID — Web application with origin and redirect URI](./images/oauth/04-create-client.png)
-->

Click **Create**, then **Download JSON** for the client you just made.

> Google notes that client changes can take five minutes to a few hours to take effect. In practice
> it's usually immediate; if sign-in fails with a `redirect_uri_mismatch` right after creating the
> client, wait a few minutes and retry before changing anything.

---

## Step 4 — Upload it and connect

Back in ConsoleVault, on the last step of the wizard, choose the JSON file you downloaded and click
**Connect to Google**.

The client is stored in your deployment's own Secret Manager and never leaves your project. You'll
be taken to Google's sign-in, where you approve the Search Console permission, and land back on
**Connections** with your properties discovered.

---

## If something goes wrong

| What you see                                                     | What it means                                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `Access blocked: … has not completed the Google verification process` | Step 2 wasn't done — publish the app, or add yourself as a test user.                             |
| `redirect_uri_mismatch`                                          | The redirect URI in the client doesn't exactly match your deployment's. Copy it again from the wizard; it must include `/api/oauth/callback` and no trailing slash. |
| `The JSON needs a client_id and client_secret`                   | Wrong file, or a **Desktop** client instead of a **Web application** one. Re-download from the Web client. |
| Sign-in worked, then stopped ~7 days later                       | The app is still in *Testing*. Publish it (step 2) and reconnect the account.                          |
| Connection succeeded but no properties appeared                  | That Google account has no Search Console properties, or they're owned by a different login. Use **Discover** on the connection row to retry.  |

The **Doctor** page (`/health`) checks token health, the Web client, and recent collection, and
names the likely cause when one of them is unhappy.
