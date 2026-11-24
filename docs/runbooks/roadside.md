# Turning roadside help on for a city (spec 22, 2026-11-24)

Roadside is **off** in every city until you do the steps below, in this order.

1. **Migration first.** Apply `0082_roadside_assistance` (`pnpm db:migrate`; on the server, deploy runbook § migrations) before the new API and web images start. The migration only adds tables and columns, so the old images keep working until the deploy.
2. **Settings.** Admin → Roadside → Settings, pick the city (a staff member needs `roadside:settings`: super admin). Switch it on, then set:
   - the **vehicle types offered** and the **advance** of each (launch: 2W and 4W at ₹500 each; 3W is added here later, no code change);
   - the **PIN codes** covered (each must be an active PIN of the city, Admin → PIN codes);
   - the **hours** (open all day, or a window in IST);
   - the **accept timer** (default 150 seconds), the problem types offered, and the **support phone** shown to customers outside the area or hours;
   - the routing mode stays `manual` (the other modes are stored for later).
3. **Workshops opt in.** Each workshop owner opens the workshop portal → Roadside and switches roadside on (radius, vehicle types, problems, towing). Until at least one workshop has opted in, "Needs dispatch" shows no suggestions and requests can only be cancelled (the advance is refunded after approval).
4. **Refund approvers.** Roadside refunds wait in Admin → Refunds like every refund (finance approves). Make sure someone watches the queue.
5. **WhatsApp (optional).** Submit the five roadside templates (runbook `whatsapp-templates.md` § Roadside templates) and switch the events on after Meta approves. Email and the bell work without it.
6. **Check.** Make a test request with a real test login on the test Razorpay keys: pay the advance, send the offer, accept as the workshop, enter the arrival code, bill, pay the balance. Watch Admin → Audit and the outbox.

Turning it off again: Admin → Roadside → Settings → off. Requests already open continue to their end.
