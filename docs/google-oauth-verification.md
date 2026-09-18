# Google OAuth verification — xwall.co.za

Signing in with Google requests `youtube.readonly`, a **sensitive** scope, so
Google shows "Google hasn't verified this app" until the app passes OAuth
verification. Registering the OAuth client is not the same as verifying it.

Console: Google Cloud Console → **Google Auth Platform** (project: xwall).

## Status

**Submitted for verification on 18 September 2026.** Under review by Google.
While it is under review, do not change scopes, branding or publishing status —
Google warns that changes restart or delay the review. Reply to Google's
emails in the same thread; the Verification Center shows the current state.

## Checklist

- [x] **Domain ownership** — TXT record `google-site-verification=…` on
      `xwall.co.za` (DNS at hostdns / clusterdns). Keep it permanently: Google
      re-checks it.
- [x] **Search Console** — domain property `xwall.co.za` shows *Verified*.
- [x] **Branding** — <https://console.cloud.google.com/auth/branding>
  - App name: `xwall`
  - User support email and developer contact email set (the privacy policy
    and terms point users to the support email, so it must be monitored)
  - Home page: `https://xwall.co.za`
  - Privacy policy: `https://xwall.co.za/privacy-policy`
  - Terms of service: `https://xwall.co.za/terms-of-service`
  - Authorized domain: `xwall.co.za`
  - No logo for now (adding one triggers an extra review)
- [x] **Audience** — <https://console.cloud.google.com/auth/audience> →
      **Publish app** → status *In production*. While in *Testing*, Google
      expires refresh tokens after 7 days, which signs users out weekly.
- [x] **Data Access** — <https://console.cloud.google.com/auth/scopes>
  - `…/auth/userinfo.email`, `…/auth/userinfo.profile`,
    `…/auth/youtube.readonly` — nothing else
  - Justification: paste the text below
- [x] **Demo video** — unlisted YouTube video, link added to the submission
- [x] **Submit** — <https://console.cloud.google.com/auth/verification> →
      *Prepare for verification* → Submit

## Scope justification (current — paste as a whole)

> xwall is an ambient wallpaper and music web app. The youtube.readonly scope
> is used only to: (1) list the signed-in user's own YouTube playlists so they
> can choose one to play in the embedded YouTube player; (2) show their channel
> name when they have no playlists; (3) search public YouTube playlists and
> find long ambient videos when the user requests it. The app never writes to or
> modifies the user's account. Access tokens are held server-side only; a
> refresh token is stored encrypted (AES-256-GCM) in the server-side session
> solely to keep the user signed in, and is deleted on sign-out or after 90 days
> of inactivity. No data is sold, shared or used for advertising. No narrower
> scope exists: youtube.readonly is the lowest YouTube scope that allows
> listing a user's own playlists.

If the submission is already under review, the form is locked: reply to
Google's verification email with this text and say it replaces the original.

## Demo video (1–2 minutes, English)

1. Open `https://xwall.co.za` and click the YouTube sign-in button.
2. On Google's consent screen, show the **address bar** (reviewers look for the
   `client_id` in the URL) and the permissions listed.
3. After sign-in, show your playlists loading, pick one, press play.
4. Type a playlist search, press Enter, show the results.

## Facts reviewers may ask about

| Question | Answer | Where in code |
| --- | --- | --- |
| Where are tokens stored? | Server-side session (PostgreSQL), never sent to the browser | `config/passport.js`, `server.js` |
| Refresh tokens? | Stored AES-256-GCM encrypted, used only to renew the access token | `lib/tokens.js` |
| Session lifetime | 90 days rolling; deleted on sign-out | `server.js` (`SESSION_MAX_AGE_MS`) |
| Analytics retention | Deleted after 12 months, automatically | `db/analytics.js` (`pruneExpired`) |
| Writes to YouTube? | Never — read-only calls only | `routes/api.js` |
| Revoking access | Google security settings; sign-out deletes the session | privacy policy |

## Keep in sync

The justification, the privacy policy and the code must say the same thing —
reviewers compare them. If token handling, scopes, session lifetime or data
retention change in code, update `public/privacy-policy.html` and this file in
the same commit.
