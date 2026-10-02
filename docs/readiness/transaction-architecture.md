# Transaction architecture

`src/lib/operationalTransactions.js` is the server-side rule set. It does not import a database client. `assertMayWrite` must pass before any later adapter calls a project, and today that function still throws `STAGING_NOT_CONNECTED`.

The database, when staging exists, is the source of prices, stock, and totals. The client may send product ids, quantities, a payment method, and an idempotency key. It may not choose the payable total. A mismatched `clientTotal` is rejected and stock is unchanged.

## Shared rules

- Actor role is checked on the server.
- `actorBarId` must equal `barId` unless the role is `admin`.
- Every command requires `idempotencyKey`. The same key returns the first result and does not post a second sale, punch, or receipt.
- A failed stock check does not deduct a partial line.
- Audit rows record the command type, bar, actor, and result id.
- Money is integer yen. Tax stays included; it is not added on top.

## Operations

| Command | Who | Effect | Idempotency |
| --- | --- | --- | --- |
| `discount` | gerente, admin, cliente | Allows 0, 10, or 20 percent | Same key, same rate |
| `pos-sale` | gerente, admin, cliente, caixa, bar_staff | Prices from the catalog, stock deducted for every line or none, cash refused when the drawer is closed | Same key does not deduct again |
| `cash-payment` | gerente, admin, cliente, caixa | Marks one unpaid sale and adds its server total to the drawer | A second key on a paid sale is `DUPLICATE_PAYMENT` |
| `cash-movement` | cash roles | In or out on an open drawer | Same key posts once |
| `cash-close` | cash roles | Variance is counted minus float, cash in, and cash out | A closed drawer rejects a second close |
| `clock` | funcionario, bar_staff, gerente, admin | Open shift, then out | A second `in` while open is `DUPLICATE_CLOCK` |
| `purchase-request` | gerente, admin | Pending order for one bar | Same key, one order |
| `supplier-status` | fornecedor, admin | pending → confirmed → preparing → in_transit → delivered | Any other jump is `STATUS` |
| `stock-receipt` | supplier or purchase roles | Adds quantities only after `delivered` | A second receipt does not add stock |

Two sales of the last unit use two keys. The first commits. The second returns `STOCK`. On Postgres this is `pos_lock_stock` / `pg_advisory_xact_lock` inside `sql/pos_floor.sql`, which is the existing lock and is not executed here.

## Error codes

`IDEMPOTENCY`, `ISOLATION`, `UNAUTHORIZED`, `UNKNOWN_PRODUCT`, `QUANTITY`, `STOCK`, `TOTAL`, `REGISTER`, `SALE`, `DUPLICATE_PAYMENT`, `AMOUNT`, `DUPLICATE_CLOCK`, `CLOCK`, `ORDER`, `STATUS`, `UNKNOWN`.

`executed` is false on every failure. A replay of a success sets `replayed` and does not post again.

## What is not activated

No route calls `commit` against Supabase. Existing API files keep their current production guards. The in-memory store is for tests and for the later staging adapter.
