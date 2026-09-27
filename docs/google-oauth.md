# Google OAuth client — exact setup steps

Kikitai reads Gmail through **your own** Google OAuth client. The scope is
`https://www.googleapis.com/auth/gmail.readonly` (restricted), but a client in **Testing** mode that
only you authorize needs **no Google verification and no CASA assessment** — that's why self-hosting
ships first.

You will end up with two values for `.env`:

```env
GOOGLE_CLIENT_ID="…apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="…"
```

Total time: ~5 minutes. Follow the steps **in order** — a client ID can't be created before the
consent screen exists.

> The console menu labels below are the ones Google uses today. The old **OAuth consent screen** page
> is now called **Google Auth platform**, split into **Branding / Audience / Data Access**. If your
> console still shows the old layout, the equivalent pages are noted in parentheses.

---

## 1. Create a project

1. Open <https://console.cloud.google.com/> (sign in with the Google account whose mail you want to
   read).
2. Top-left project dropdown → **NEW PROJECT**.
3. Name it anything (e.g. `kikitai`) → **CREATE**. Wait for it to appear in the top bar and make sure
   it is the **selected** project — every step below applies to the currently selected project.

## 2. Enable the Gmail API

1. <https://console.cloud.google.com/apis/library> (**APIs & Services → Library**).
2. Search for **Gmail API** → click it → **ENABLE**.

Enabling it before creating credentials avoids a confusing `access_denied`/`gmail_not_allowed` error
on first sign-in.

## 3. Configure the consent screen (Google Auth platform)

1. <https://console.cloud.google.com/apis/credentials/consent> (**APIs & Services → OAuth consent
   screen**, a.k.a. **Google Auth platform**). If you see _Get started_, click it.
2. **App information**
   - **App name**: anything recognizable, e.g. `Kikitai` (this is what the consent popup shows).
   - **User support email**: your email.
3. **Audience** _(old label: "Audience" / "User type")_
   - Select **External** → **SAVE AND CONTINUE**.
   - Leave the app in **Testing** publishing status — do **not** click _Publish app_.
4. **Contact information**: your email → **SAVE AND CONTINUE**.
5. Agree to the **Google API Services User Data Policy** → **CONTINUE**.
6. **Data Access** _(old label: "Scopes")_ → **ADD OR REMOVE SCOPES**:
   - Search `gmail.readonly` and tick **`https://www.googleapis.com/auth/gmail.readonly`**
     (Gmail API → _Read all messages and settings_).
   - Search and tick **`https://www.googleapis.com/auth/userinfo.email`** and
     **`https://www.googleapis.com/auth/userinfo.profile`** (category _UserInfo_ / _OpenID Connect_ —
     they show up as _See your personal info, including your primary email address and profile
     picture_). **These are NOT added automatically** — the Data Access list starts empty, so add all
     three yourself. `userinfo.email` is what puts your Google address on the session row; without it
     sign-in fails.
   - **UPDATE** → **SAVE AND CONTINUE**. Everything else stays unchecked: Kikitai never sends,
     deletes, labels or modifies mail.
7. **Audience → Test users** → **ADD USERS**:
   - Type the Gmail address(es) allowed to use the app (at minimum your own) → **ADD** →
     **SAVE AND CONTINUE**.
   - While the app is in **Testing**, only test users can grant consent; everyone else gets
     _Access blocked: app has not been verified_.

## 4. Create the OAuth client ID

1. <https://console.cloud.google.com/apis/credentials> (**APIs & Services → Credentials**).
2. **CREATE CREDENTIALS → OAuth client ID**.
3. **Application type**: **Web application**.
4. **Name**: anything, e.g. `kikitai-web`.
5. **Authorized JavaScript origins** — leave empty (Kikitai is a server-side flow; Better Auth
   exchanges the code on the server).
6. **Authorized redirect URIs** → **ADD URI**, exactly one:

   ```text
   {ORIGIN}/api/auth/callback/google
   ```

   - Local dev: `http://localhost:5173/api/auth/callback/google`
     (match the port you actually run — see `ORIGIN` in `.env`).
   - Production: `https://mail.example.com/api/auth/callback/google`

   Rules Google enforces here (a violation yields `redirect_uri_mismatch`): must be `https://` except
   on `localhost`, no raw IP addresses, no query string or `#fragment`, path included, port included
   if it isn't 443/80.

7. **CREATE** → a dialog shows **Your Client ID** and **Client Secret**. Copy both immediately —
   the secret is shown **only once** (you can regenerate it later, which invalidates the old one).
   **DOWNLOAD JSON** keeps a backup.

## 5. Put the values in `.env`

```env
# must equal the origin you registered as the redirect URI, minus /api/auth/callback/google
ORIGIN="http://localhost:5173"

GOOGLE_CLIENT_ID="1234567890-abcdef.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-…"
```

Restart the dev server after editing `.env` (env vars are read at boot). The **Sign in with Google**
button only appears once both values are set — Better Auth hides it and logs
`Social provider google is missing clientId or clientSecret` otherwise.

## 6. Verify

1. `bun run dev` → open the app → **Sign in with Google**.
2. Google shows the consent popup listing **Kikitai** and _See your email messages and settings_ —
   that wording is the `gmail.readonly` scope. Approve it (consent is what mints the refresh token).
3. On the Inbox page press **Connect Gmail** if it prompts for it. Mail should load; tokens are
   encrypted at rest with `AUTH_TOKEN_SECRET`.

---

## Troubleshooting

| Symptom                                                              | Cause / fix                                                                                                                                                                            |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redirect_uri_mismatch`                                              | Redirect URI in the console ≠ `{ORIGIN}/api/auth/callback/google` byte-for-byte (scheme, port, trailing path). Edit it under **Credentials → your client → Authorized redirect URIs**. |
| _Access blocked: app has not been verified_ / _app blocked_          | You're not listed as a **test user** (step 3.7), or the app was **published** — switch it back to **Testing** in **Audience**.                                                         |
| `access_denied` / `gmail_not_allowed`                                | Gmail API not enabled (step 2), or `gmail.readonly` missing from **Data Access** (step 3.6).                                                                                           |
| Google button missing from the login page                            | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` empty or the server wasn't restarted.                                                                                                      |
| `Social provider google is missing clientId or clientSecret` in logs | Same as above.                                                                                                                                                                         |
| Signed in, but **Connect Gmail** 401s                                | Refresh token revoked or expired — sign out, sign in again (consent is forced with `prompt: 'consent'`).                                                                               |

## Sign-in is Google-only (on purpose)

Kikitai has **no email/password login**: `emailAndPassword.enabled = false` in
`src/lib/server/auth.ts` and `src/routes/login/+page.svelte` shows only the Google button. Two
reasons:

- Google is already the identity check — a session and the Gmail connection come from the same
  account, so a second credential path is just extra attack surface.
- On a deployment reachable from the internet, an open sign-up form lets strangers create accounts
  and burn your AI key / database / bandwidth.

What actually keeps others out, in order:

1. **Testing** publishing status + **test users** on the consent screen — Google refuses consent for
   anyone you didn't list (`Access blocked: app has not been verified`), so no stranger can obtain a
   session at all.
2. Google-only sign-in — there is no password to guess or leak.
3. Per-user data: mail tokens are stored per user id, so even a stray account would only ever see
   Gmail it connected itself.

Keep the consent screen in **Testing** (step 3.3) unless you deliberately publish it.

## Testing-mode limits (intentional)

- The consent screen stays in **Testing**: the app is unverified, only listed test users can grant
  access, and Google **expires the refresh token after 7 days** — re-auth once a week, or (for a
  long-lived personal instance) click **PUBLISH APP** yourself and accept the "unverified app"
  warning on the consent screen.
- Going public (anyone but you) requires Google's **sensitive-scope verification** for
  `gmail.readonly` plus a **CASA security assessment**. Out of scope for self-hosting — see
  [`plan/kikitai/research.md`](../plan/kikitai/research.md).

## References

- Configure the OAuth consent screen — <https://developers.google.com/workspace/guides/configure-oauth-consent>
- OAuth 2.0 for web server apps — <https://developers.google.com/identity/protocols/oauth2/web-server>
- Manage OAuth clients (redirect URI rules) — <https://support.google.com/cloud/answer/6158849>
- Gmail API scopes — <https://developers.google.com/gmail/api/auth/scopes>
- Sensitive-scope verification — <https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification>
