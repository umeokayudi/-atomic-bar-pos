# End-to-end test plan

This is the plan. It is not a record of a passed live run.

Do not mark a step passed from a unit test or from a local fixture. `scripts/fixtures/legacy_schema.sql` is not production.

## Not run this pass

Live Auth credentials for a disposable project were not available. Production was not used. Headless Chrome beyond the signed-out login screen hung because another Chrome process is already running. No sale, payment, clock punch, or invite was clicked.

Signed-out check that did happen: preview at 390px on `#/pos` showed the login form.

## Employee shift

1. Manager invites an email. No password is typed by the manager.
2. Employee sets a password from the Auth email.
3. Employee signs in and lands on the time clock or POS according to role.
4. Refresh keeps the session. Logout clears it. Sign-in works again.
5. Wrong password stays on the login screen.
6. Suspended and inactive accounts cannot enter. Reactivate allows entry again.
7. The employee sees only their bar.

## Sale

1. Open POS for that bar.
2. Open a table or a quick sale.
3. Add two products and raise a quantity.
4. Confirm the quote, including service, tax, and surcharge only when those settings are on.
5. Pay once. A second click with the same idempotency key must not create a second `pos_vendas` row.
6. The ticket total equals the payment.
7. A stock movement exists for the bar, product, quantity, type, time, user, and ticket reference.
8. Cash or card movement matches the tender. Card fee is recorded once.
9. Dashboard, the daily report, and night close show the same sales total for that book. Do not add `vendas` and `pos_vendas`.
10. Close the night only after counted cash is entered. The difference is counted minus expected. Expected cash in `summarizeNight` is the night's cash tender, not opening float plus cash sales.

## Floor

Open a free table, add items, take payment, close, and see the table free with no open ticket left behind.

## Procurement

Place a bar order and walk it through planning, purchasing, shipment, and receipt on the existing procurement RPCs. A supplier session must not receive margin, freight, or another supplier's tasks.

## Clock and payroll

Clock in and out on `time_clock`. A break button is not part of the current punch model. Payroll should use those punches and must not invent a transport line.

## Multi-bar

Bar A cannot read or write Bar B through the UI, an RPC, or a direct request. Prove it with RLS, not only with a hidden menu.
