# Google OAuth verification — xwall.co.za

Signing in with Google requests `youtube.readonly`, a **sensitive** scope, so
Google shows "Google hasn't verified this app" until the app passes OAuth
verification. Registering the OAuth client is not the same as verifying it.

Console: Google Cloud Console → **Google Auth Platform** (project: xwall).

## Status

**Submitted 18 September 2026. Google replied 20 September 2026 asking for a
better demo video** (the first one did not show every feature using the scope).
Scope configuration was fine; the app now requests the full scope URLs so they
match the console character for character. Re-record using the shot list below,
then reply to Google's email.
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

## Demo video (2–4 minutes, English)

Google rejected the first video because it did not demonstrate "the maximum
extent of the user facing features using the scope". xwall uses
`youtube.readonly` in **four** places — all four must appear.

**Before recording**
- Revoke xwall at <https://myaccount.google.com/permissions> so the full
  consent screen appears, and sign out of xwall.
- Turn on Do Not Disturb; close unrelated tabs; zoom the page (Cmd +) so text
  is readable.

**Shot list**

1. **Consent screen, fully readable.** Click sign in with YouTube. On Google's
   screen: click into the **address bar** and pause so `client_id` is visible;
   if the permissions are collapsed, click **"Show all services"** and expand
   the YouTube entry so all three scopes are readable. Then continue.
2. **Feature 1 — the user's own playlists** (`playlists.list mine=true`).
   Show the playlists appearing under the input box. Optionally open
   youtube.com/feed/playlists in another tab to show they are the same ones.
3. **Feature 2 — playing one.** Pick a playlist, press Enter, press Play, show
   the track name appearing in the transport bar.
4. **Feature 3 — searching public playlists** (`search.list`). Back on the home
   screen, type a search term, press Enter, show the results and pick one.
5. **Feature 4 — ambient background suggestions** (`search.list` +
   `videos.list`). Switch between the wallpaper modes and show the video rail
   filling with 30-minute-plus ambient videos.
6. **State the read-only point** on screen or aloud: xwall only reads; it never
   uploads, deletes, likes, comments, subscribes or edits playlists, and
   `youtube.readonly` is the narrowest YouTube scope that allows listing a
   user's own playlists (`youtube` and `youtube.force-ssl` both grant write
   access).

## Reply to Google

Reply **in the same email thread** with the new unlisted video link and a note
that the scopes now match the console exactly. Draft in `Reply draft` below.

### Reply draft

> Hello,
>
> Thank you for the review. I have recorded a new demonstration video that
> shows the full user-facing functionality of the requested scope:
> <VIDEO LINK>
>
> The video shows, in order: the OAuth consent screen with the client_id
> visible in the address bar and all requested scopes expanded and readable;
> the signed-in user's own YouTube playlists being listed
> (playlists.list, mine=true); playing a selected playlist in the embedded
> YouTube player; searching public YouTube playlists (search.list); and the
> ambient background video suggestions (search.list + videos.list). These are
> every feature in the app that uses youtube.readonly.
>
> The app is read-only: it never uploads, deletes, edits, likes, comments on or
> subscribes to anything in the user's account, so there is no write or delete
> action to demonstrate in the source account. youtube.readonly is the
> narrowest YouTube scope that permits listing a user's own playlists; the
> alternatives (youtube and youtube.force-ssl) additionally grant write access
> that the app does not need.
>
> The scopes requested by the app now match the three configured in the Google
> Cloud Console exactly:
> https://www.googleapis.com/auth/userinfo.profile
> https://www.googleapis.com/auth/userinfo.email
> https://www.googleapis.com/auth/youtube.readonly
>
> The publishing status remains "In Production". Please let me know if anything
> further is needed.
>
> Kind regards,
> <YOUR NAME>

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
