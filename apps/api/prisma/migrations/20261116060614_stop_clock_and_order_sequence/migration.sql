-- AlterTable
ALTER TABLE "Stop" ADD COLUMN     "completedMin" INTEGER;

-- Gap-tolerant, concurrency-safe order numbers (TW-2026-00042).
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1000;

-- Partial index for the dispatcher's main query: unplanned orders of a day.
CREATE INDEX IF NOT EXISTS "Order_open_by_day_idx" ON "Order" ("deliveryDay") WHERE status = 'NEW';
