# Ustaad Network: moderation, grievance and incident runbook

Spec 23 § 13 (moderation and legal duties), § 14a (SR-18, SR-38, SR-39, SR-45), security review
`docs/research/ustaad-security-review.md` (L1–L18). Built in task F2/F3 (2026-11-26). **Research, not legal advice:
every clock and template here is to be confirmed by counsel (Q-UC1–7).** The clocks are admin settings
(`ustaad.mod.clock_*`), so counsel's answer is a settings change, not a code change.

Owners: **GO** = Grievance Officer, **CM** = community manager (`community_manager`, city scoped), **DPO** = data
protection contact, **Eng** = engineer on call.

## 1. Grievance desk and contacts

| Role                | Who                                                                              | Contact                                                  |
| ------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Grievance Officer   | **To be announced** (Q-U4). Meanwhile: Shourya Integrated Services staff on call | Support 7978776551; `grievance@` mailbox once set (Q15b) |
| Community managers  | Staff with `community_manager` for their city (Admin → Staff)                    | Admin → Ustaad → Reports (console G2; API ready)         |
| Takedown authority  | Holders of `ustaad:takedown` (community manager, super admin)                    | —                                                        |
| CERT-In             | incident@cert-in.org.in (report within 6 h)                                      | Form at cert-in.org.in                                   |
| Cyber crime (POCSO) | cybercrime.gov.in "Report child pornography", helpline 1930                      | Local police / SJPU Raipur                               |
| Grievance Appellate | gac.gov.in (named in every rejection message)                                    | —                                                        |

The published contact (Terms, Privacy, Community Rules, the footer) reads "Grievance Officer: to be announced" until
Q-U4 is answered; update `apps/web/src/lib/site.ts` (company facts) and the policies in Admin → Content when it is.

## 2. 24×7 rota

- One CM per enabled city on call at all times, plus one super admin as escalation; the rota lives in the ops
  calendar (not in the repo). A city cannot be switched on in `ustaad_reach_cities` without a named CM on the rota.
- The queue (`GET /v1/admin/ustaad/moderation/reports`) is sorted child safety first, then by due time. The worker
  job `ustaad_report_clock` (every minute) sends `staff.ustaad_report_overdue` to every `ustaad:moderate` holder of the
  city at 50 % and again at 100 % of a report's clock.
- Handover: open the queue, read every report past 50 %, write a one-line note in the handover channel (codes only).

## 3. Clocks (settings, counsel to confirm)

| Clock          | Setting                           | Default | Used for                                                                                      |
| -------------- | --------------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `intimate_2h`  | `ustaad.mod.clock_intimate_h`     | 2 h     | Nudity, sexual content, impersonation, morphed images (`ncii_impersonation`), classifier hits |
| `legal_3h`     | `ustaad.mod.clock_legal_h`        | 3 h     | Court orders, authorised government intimations (Rule 3(1)(d))                                |
| `removal_36h`  | `ustaad.mod.clock_removal_h`      | 36 h    | Rule 3(1)(b) removal grievances                                                               |
| `standard_24h` | `ustaad.mod.clock_standard_h`     | 24 h    | Ordinary member reports (our target)                                                          |
| `grievance_7d` | `ustaad.mod.clock_grievance_days` | 7 days  | Other grievances (acknowledge within 24 h)                                                    |

## 4. Takedown fast path (one call, within 60 s)

1. Check the order: issuing authority (court, or a Joint Secretary-level officer / DIG-level police officer per the
   Oct 2025 amendment), the exact item (link or code), the legal basis. Anything unclear → ask the GO; the clock runs.
2. Admin → Ustaad → Takedown (G2) or `POST /v1/admin/ustaad/moderation/takedowns` with `targetType`, `targetId`,
   `basis` (`court_order | gov_intimation | ncii_complaint | grievance_removal`) and `reference` (order number).
3. The call opens a report on the right clock, removes the item, archives it (legal orders get `legal_hold =
legal_order`), refuses new signed URLs at once and moves every object of its media out of the live bucket (URLs
   already issued stop working), and writes `audit_log` (`ustaad.takedown`, reference) and `ustaad_events`.
4. Reply to the authority with the report code and the time (`seconds` in the response); keep the order PDF in the
   legal folder (not in the app).
5. **Not covered yet:** feed, profile, search, tag pages and share teasers do not exist (workstream D); when D ships,
   AT-TAKEDOWN-1 must be extended to them (status `removed` already hides the item in every query that filters on
   `visible`).
6. A legal removal can be reversed only by someone with `ustaad:takedown`, and never while its archive row is on
   legal hold (`USTAAD_LEGAL_HOLD`).

## 5. Agency requests (Rule 3(1)(j), 72 h)

1. Log the request (agency, officer, legal provision, scope) in the legal folder; acknowledge.
2. GO and counsel approve in writing. Disclose only what is asked: member id, handle, join date, content and the
   moderation history. Phone numbers come only from the GO with counsel's approval (no staff screen shows them).
3. Put the content on hold: `setUstaadArchiveHold` through an engineer (`legal_hold = 'agency_<ref>'`), so the 180-day
   purge skips it.
4. Reply within 72 h; record the disclosure in `audit_log` (engineer, `action = 'ustaad.agency_disclosure'`).

## 6. Child safety and POCSO (s.19, s.20, POCSO Rules 2020 Rule 11)

Automatic: a CSAM hash match (classifier adapter, Q-U6; none yet) refuses the upload, seals the file in the evidence
bucket (`legal_hold = 'pocso'`, never purged by normal jobs), freezes the account (`restricted`, `restricted_mode =
review`, no end date) and opens a 2 h `auto_safety` report; every `ustaad:takedown` holder gets the notice. Until a
classifier and hash list exist, new accounts' media posts are pre-moderated (`mod.premod_first_posts` 3,
`mod.premod_account_days` 30).

Manual (a report "Someone under 18", or a CM finds sexual material involving a child):

1. **Do not view, download, copy, forward or screenshot the material** (moderator protection; previews are blurred).
2. Remove the item with reason `minor` / takedown basis `ncii_complaint` so it is archived; ask an engineer to set
   `legal_hold = 'pocso'` on the archive row and media.
3. The GO reports to cybercrime.gov.in (Report child pornography) and to the local police / SJPU **forthwith**, with
   the platform details, the item's code, the uploader's member id and the time; never attach the material to e-mail.
4. Hand over the material and source details only to the police on request, through the engineer, from the evidence
   bucket (two people present, written in `audit_log`).
5. Keep the account frozen until the police or counsel say otherwise. Record every step in the legal folder.

## 7. Security incident: CERT-In 6 h and DPDP 72 h

| When           | Who           | Step                                                                                                  |
| -------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| 0 h (detected) | Eng           | Contain (rotate keys, block the path), keep logs, open an incident note (time in UTC and IST)         |
| ≤ 1 h          | Eng → DPO, GO | Classify: is it a reportable cyber incident (CERT-In list)? does it touch personal data?              |
| ≤ 6 h          | DPO           | Report to CERT-In (incident@cert-in.org.in, their form): what, when, systems, actions taken           |
| without delay  | DPO           | Inform the Data Protection Board (DPDP Rules 2025, Rule 7) and each affected person (templates below) |
| ≤ 72 h         | DPO           | Detailed report to the Board: facts, cause, risk, mitigation, notice to people                        |
| after          | Eng           | Post-mortem in `docs/research/`; tests for the root cause                                             |

**Template for affected people (English):**

> MechDost: on {date} we found {what happened, in one line}. It may have exposed your {data, e.g. name and handle in
> the mechanics network}. We have {what we did}. You can {what they can do, e.g. change your password}. Questions:
> {grievance contact}. Shourya Integrated Services Pvt Ltd.

**Template (हिंदी):**

> MechDost: {तारीख} को हमें पता चला कि {क्या हुआ, एक पंक्ति में}। इससे आपकी {जानकारी, जैसे मैकेनिक नेटवर्क में नाम और
> हैंडल} प्रभावित हो सकती है। हमने {क्या किया}। आप {क्या कर सकते हैं, जैसे पासवर्ड बदलें}। सवाल हों तो: {शिकायत
> संपर्क}। शौर्य इंटीग्रेटेड सर्विसेज़ प्रा. लि.

Both go through the outbox (e-mail and in-app) with only these fields; never the leaked data itself.

## 8. ICT logs: 180 days, India, NTP (CERT-In; log retention config note)

- API, auth, moderation and media-access logs: the Docker containers on the AWS Mumbai server write JSON lines; set
  the Docker daemon `log-opts` (`max-size`, `max-file`) so at least 180 days fit, **or** ship them to an India-region
  store (CloudWatch Logs `ap-south-1`, retention 180 days). **Not configured yet** (Q-UF1): today Docker keeps the
  default unbounded `json-file` logs, which survive only until a container is recreated.
- `audit_log`, `ustaad_events` and moderation actions are in Postgres (Supabase Mumbai) and append-only; they are the
  durable record and are never purged by these jobs.
- Clocks: the server must sync to NTP (`timedatectl` shows `System clock synchronized: yes`; Amazon Time Sync).
- Sentry and PostHog are EU-hosted error/product tools and are not the ICT log of record (processor register).

## 9. Removed-content archive (180 days)

`ustaad_removed_archive` keeps text, media ids and the author id for `mod.retention_days` (180); the worker job
`ustaad_removed_archive_purge` (hourly check) deletes rows past `retain_until` without a legal hold and marks their
media for the media purge. Media referenced by any held archive row are never marked. On account deletion (DPDP
erasure) the author's personal fields go; the archive keeps only what the legal duty needs.

## 10. Community Rules reminder

`ustaad_rules_reminder` sends `ustaad.rules_reminder` to every member once per `mod.rules_reminder_days` (90) period
(IT Rules, every 3 months per research; counsel to confirm). The notice version is the period number, so reruns send
nothing twice; each run writes one `audit_log` row (`ustaad.rules_reminder`).

## 11. Tabletop drill checklist (before launch, then twice a year)

- [ ] Takedown: a test court order on a staging post; measure order-received → `seconds`; check the media URL is dead.
- [ ] NCII complaint at 02:00: the on-call CM gets the notice, the item is hidden from a qualified reporter's complaint.
- [ ] POCSO: walk steps 1–5 with a benign fixture on the test hash list; nobody opens the file.
- [ ] Appeal: decided by a second staff member; a legal removal cannot be reversed without `ustaad:takedown`.
- [ ] Incident: run § 7 against a simulated leaked key; CERT-In draft ready within 6 h, Board draft within 72 h,
      en + hi notices rendered.
- [ ] Agency request: § 5 with a mock notice; content put on hold; reply drafted within 72 h.
- [ ] Logs: pull 180-day-old API logs for one request id (fails until Q-UF1 is done).
- [ ] Record findings and fixes in `docs/progress.md`.

## 12. SSMI counter

Significant social media intermediary duties start at 50 lakh registered users. The admin overview shows the Ustaad
member count with an alert at 40 lakh (spec 23 § 13; the overview tile is G2's).

## Community console (G2)

- Admin → Ustaad Network → Community: Queue (by clock), Holds (release or remove), Appeals, Verify, Members,
  Takedowns and legal holds, Reserved names, My actions. A city-A community manager sees city A only.
- Files of a reported item stay hidden until you choose a reason and ask; each view is recorded
  (`audit_log ustaad.media_view`). Evidence-vault files are not viewable in the console (two-person ops step, § 6).
- A long or permanent ban, and lifting one, needs a second staff member: the item shows "Waiting for approval" until
  someone who took no part approves it. A child-safety freeze is never lifted from Members (Grievance Officer, § 6).
- Restricting or banning from Members opens a staff report (source `staff`) so the decision is on record like any
  other.
