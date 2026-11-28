# Sessions: stale "Signed in as", sign out of all devices, device list — research (2026-11-28)

Founder, 22:32–22:45 IST (remote): the admin page said "Signed in as QA Admin" but every panel said "Sign in again to
continue". Asked for "sign out of all devices" and "a device list aswell maybe", then "first research about all
that". Nothing is built yet; this note is the research and the options.

## 1. What happened (root cause, verified)

- The site keeps two records of a sign-in: its own saved session (`demo/session` → `useSession`, what the header
  and "Signed in as" read) and the Firebase session in the browser (what every API call needs for its token).
- Earlier the same day the lead changed the passwords of test accounts 02, 04, 05, 06, 07 and 09 for live checks.
  A Firebase password change moves `tokensValidAfterTime`, which ends every other session of that account
  (`apps/api/src/auth/email-actions.ts:20`).
- The browser's Firebase session for 9000000005 ended; the site's own session did not. `currentIdToken()` returned
  null, so `admin-api.ts:46` answered `AUTH_REQUIRED` without calling the server (the API log has no admin requests
  from that browser at 17:00–17:03 UTC). "Try again" repeats the same dead call.
- Nothing listens for "Firebase says signed out" to clear the site's own session (`watchUid` is used only by the
  live listener). **Bug:** any real user whose session ends elsewhere (password change on another phone, staff role
  removed, account disabled) sees the same broken page.

## 2. What exists today

| Piece                        | State                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign out (this device)       | `signOutEverywhere()` in `apps/web/src/lib/auth/sign-out.ts` — despite the name, this device only.                                                                                     |
| End all sessions (server)    | `PasswordAuthority.revokeSessions(uid)` → Firebase `revokeRefreshTokens`; used only when a staff role is removed.                                                                      |
| Revocation enforced          | Yes: `middleware/auth.ts` checks revocation whenever a session is loaded into the 60 s cache, so a revoke takes effect on every route within about a minute.                           |
| Change password              | Account → Profile → Security (decision, `docs/decisions.md:1648`); Firebase ends the other sessions.                                                                                   |
| "Sign out everywhere" button | Explicitly not done (`docs/decisions.md:1649`).                                                                                                                                        |
| Device list                  | None. No table records sign-ins per device.                                                                                                                                            |
| Sign-in paths                | Sign-up: phone code (Firebase phone auth). Every later sign-in: phone/email + password through `POST /v1/auth/password`, which mints a **custom token**; staff add a phone code first. |

## 3. Research

**Firebase.** Revocation is per user, never per device: `revokeRefreshTokens` signs the person out everywhere,
and the docs suggest it for a lost or stolen phone. An ID token already issued stays valid up to an hour unless
the server checks revocation (`verifyIdToken(token, true)`), which MechDost already does on session load. Firebase
has no session list and no per-session logout; a community proposal lists both as gaps. Custom-token claims do
carry into every refreshed ID token, so a session id can be put there.
Sources: [Manage user sessions](https://firebase.google.com/docs/auth/admin/manage-sessions),
[Manage session cookies](https://firebase.google.com/docs/auth/admin/manage-cookies),
[community proposal](https://gist.github.com/12fahed/42e802890b5b887b93c66d94ceadeb2d).

**Security guidance.** OWASP: session meaning lives on the server, ids from a CSPRNG of at least 128 bits, and a
user-facing session list is compatible with current guidance (older advice to block parallel sessions is gone).
Sources: [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html),
[ASVS v4.0.3 V3](https://github.com/OWASP/ASVS/blob/v4.0.3/4.0/en/0x12-V3-Session-management.md),
[MDN session management](https://developer.mozilla.org/en-US/docs/Web/Security/Authentication/Session_management).

**How others show it.** Netflix "Manage access and devices": recent devices, sign out one, "Sign out of all
devices" at the bottom. Roblox "Where you're logged in": device, approximate region, last active, "log out of all
other sessions". Atlassian: recent devices with per-device "Log out" and "Log out of all devices" (keeps the
current one). Claude and Taskade: the current device is marked "Current"/"This device" and has no revoke button.
Common pattern: per-device action + bulk "sign out of all other devices" + "This device" label + last active.
Sources: [Netflix](https://help.netflix.com/en/node/129831), [Roblox](https://en.help.roblox.com/hc/ar/articles/14482664311060-Session-Management),
[Atlassian](https://confluence.atlassian.com/display/Cloud/Recently+used+devices),
[Taskade](https://www.taskade.com/learn/account/sessions.md), [Claude](https://support.claude.com/en/articles/13124001),
[SaaSFrame pattern](https://www.saasframe.io/patterns/session-management).

## 4. Options

**A. Fix the stale session (bug, no choice needed).** Listen to Firebase in real mode: when it reports no user
while the site session says signed in, clear the site session and show the normal sign-in card ("You were signed
out on this device. Sign in again."). Also: an API 401 `ID_TOKEN_REVOKED` does the same instead of "Try again".

**B. "Sign out of all devices" (small).** `POST /v1/me/sessions/revoke-all` (signed in, rate limited, audit row
`auth.sessions_revoked`, analytics event) → `revokeRefreshTokens(uid)` + drop the cached session; then this device
signs out too (Firebase cannot keep one device). Button in Account → Profile → Security with a confirm step. Other
devices are out within about a minute (the 60 s session cache), and their pages show the card from A.

**C. Device list (bigger: new table + auth change).**

- `user_sessions` table: id (random, 128 bit), user, created, last active (updated at most hourly), device label
  from the browser ("Chrome on Android"), coarse city or nothing, revoked at. No IP address stored (DPDP: data
  minimisation; a hashed IP gives nothing the user can read).
- `POST /v1/auth/password` creates the row and puts `sid` in the custom token claims; the auth middleware refuses
  a token whose `sid` is revoked (checked with the session load, same 60 s cache).
- Account → Profile → Security: "Where you're signed in": this device marked, last active, "Sign out" per device,
  "Sign out of all other devices".
- Limits: the sign-up phone-code session has no `sid` (shown as "Earlier sign-in", ended only by "all devices");
  per-device sign-out takes up to a minute to reach the other device.
- Cost: migration + RLS, auth middleware change (every request path), API, UI, en + hi, events, tests incl.
  role-leak and revoke-race. About a day with review.

**Recommendation.** A and B now (A is a bug, B is small and uses what exists). C after the founder confirms scope:
it touches the auth middleware on every request, so it gets its own design and review.

## 5. Questions for the founder (also in docs/questions-for-user.md, Q-SES-1..3)

1. Build A + B now, C next? (default: yes)
2. "Sign out of all devices" includes this device (Netflix) or keeps it (Atlassian, needs C)? (default: includes it
   until C exists, then "all other devices")
3. Device list shows an approximate city? (default: no city, device and last active only — less personal data)
