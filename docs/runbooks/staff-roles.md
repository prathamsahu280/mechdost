# Staff roles: granting, removing and checking (2026-11-15)

Admin → Staff replaces the CLI for daily use. The CLI (`pnpm db:grant-role`) stays for **the first super admin only**,
because nobody can give roles before one exists (`docs/runbooks/firebase.md` step 7).

## Give a role

1. The person signs up on the site first (phone code, email, password) and verifies a phone number.
2. A super admin opens Admin → Staff → **Give a role**: phone number (10 digits or `+91…`), role, city (city roles
   only), reason. Save.
3. The person signs in with password plus a fresh phone code; the Staff screen then shows their last sign-in.
   A role given to someone already signed in applies on their next request on the same server instance, and within a
   minute elsewhere.

Rules the screen explains: only a super admin gives `super_admin` or `finance`; you cannot change your own roles (ask
another super admin); a city role needs a city; the same role twice is refused.

## Remove a role

Admin → Staff → the person → **Remove role** → reason. Their sessions end (they sign in again and lose the role); the
last super admin cannot be removed, so give the role to a second person first. To move someone between cities, remove
the city role and give it again with the new city.

## Find a customer

Admin → Customers → search by 10-digit phone, email, order / request / ticket code, or the start of a name. Contact
details show the last 4 digits; a super admin sees them in full and each full view is recorded in the audit log.

## Check who changed what

Admin → Audit log (super admin and finance): filter by entity, id or code, person, action and dates (Indian time);
open an entry for the reason and before/after. Role changes are `role.granted` / `role.revoked`; unmasked customer
views are `customer.pii_viewed`; staff sign-ins are `auth.staff_signed_in`.

## When something looks wrong

- "No account uses this phone number": the person has not signed up, or typed another number.
- Person cannot finish sign-in ("No verified phone" on their card): they must verify a phone number first.
- A removed person still sees the console: their session cache expires within a minute; if Firebase session revocation
  is not available on the server, they keep a valid sign-in but no staff access.
- Migration `0060_admin_people_indexes` adds search and audit indexes; it must be applied before these screens are used
  at scale (the screens work without it, only slower).
