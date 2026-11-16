# Data model and query notes

## Where data lives

| Store | What | Why |
|---|---|---|
| **PostgreSQL** (Prisma) | users, depot, vehicles, orders, tours, stops, audit log | relational, transactional: planning commits must be all-or-nothing |
| **MongoDB** (Mongoose, time-series collection) | GPS fixes (one every few seconds per van) | high write volume, append-only, 90-day TTL, bucketed by vehicle |
| **MySQL** (mysql2) | `erp.deliveries`: the legacy ERP's invoicing table | Tourwerk *exports* to it, idempotently (`ON DUPLICATE KEY UPDATE`) |

## Concurrency

* **Committing a plan** claims its orders with one conditional update:
  `UPDATE "Order" SET status='PLANNED' WHERE id IN (…) AND status='NEW'`. If the row count
  is lower than the number of orders, another dispatcher got there first. The whole
  transaction rolls back and the API answers 409. The test
  `concurrent commits of the same plan: exactly one wins` fires three commits at once.
* **Stop events** are monotonic (PENDING → ARRIVED → DELIVERED | FAILED). Repeating a final
  event is a no-op, so a driver app retrying over a bad mobile connection is safe.
* **Order numbers** come from a PostgreSQL sequence (`order_number_seq`), not `MAX()+1`.
* **Integration imports** are idempotent through the unique `externalRef`. A unique-violation
  race between two NiFi deliveries resolves to "duplicate", not to an error.

## Indexes and plans

The indexes in `schema.prisma` and the second migration:

```sql
CREATE INDEX "Order_deliveryDay_status_idx" ON "Order" ("deliveryDay", status);
CREATE INDEX "Order_status_exportedAt_idx"  ON "Order" (status, "exportedAt");      -- ERP export backlog
CREATE INDEX "Tour_day_status_idx"          ON "Tour"  (day, status);
CREATE UNIQUE INDEX "Tour_vehicleId_day_key" ON "Tour" ("vehicleId", day);          -- one tour per van and day
-- partial index: only unplanned orders, which is what the dispatcher queries all day
CREATE INDEX "Order_open_by_day_idx" ON "Order" ("deliveryDay") WHERE status = 'NEW';
```

The dispatcher's main query (unplanned orders of a day) uses the partial index
(seeded demo database, PostgreSQL 16):

```
EXPLAIN ANALYZE SELECT * FROM "Order" WHERE "deliveryDay" = '2026-11-16' AND status = 'NEW' ORDER BY number;

 Sort  (actual rows=64 loops=1)
   Sort Key: number
   ->  Index Scan using "Order_open_by_day_idx" on "Order"  (actual rows=64 loops=1)
         Index Cond: ("deliveryDay" = '2026-11-16'::date)
 Execution Time: 0.378 ms
```

The partial index stays small however much history accumulates, because delivered orders
leave it.

The 14-day KPI trend aggregates in SQL (`COUNT(*) FILTER (…)`, `generate_series` for days
without deliveries) instead of loading rows into Node. On the ~700-row demo data set the
planner correctly prefers a sequential scan; with a realistic history (hundreds of
thousands of orders) the `("deliveryDay", status)` index takes over. The `LEFT JOIN "Stop"`
is cheap because `Stop.orderId` is unique.

## On-time measurement

A stop stores `completedMin`, the service-clock minute of delivery. On-time means
`completedMin <= order.windowEnd`. Keeping the clock as minutes after midnight in
the depot's timezone (Europe/Berlin) avoids timezone arithmetic in every KPI query. It also
lets the accelerated simulator report realistic times.
