-- Legacy ERP database (MySQL 8). Tourwerk writes delivered orders here for invoicing.
CREATE TABLE IF NOT EXISTS deliveries (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_number  VARCHAR(32)  NOT NULL,
  external_ref  VARCHAR(64)  NULL,
  customer      VARCHAR(160) NOT NULL,
  postcode      CHAR(5)      NOT NULL,
  status        ENUM('DELIVERED', 'FAILED') NOT NULL,
  fail_reason   VARCHAR(64)  NULL,
  delivered_at  DATETIME     NOT NULL,
  weight_kg     DECIMAL(8, 2) NOT NULL,
  parcels       SMALLINT UNSIGNED NOT NULL,
  vehicle_plate VARCHAR(16)  NOT NULL,
  exported_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_order_number (order_number),
  KEY ix_delivered_at (delivered_at),
  KEY ix_postcode_status (postcode, status)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- Invoicing view used by the finance team: one row per customer and day.
CREATE OR REPLACE VIEW daily_billing AS
SELECT DATE(delivered_at) AS day, customer,
       SUM(status = 'DELIVERED') AS delivered, SUM(status = 'FAILED') AS failed,
       SUM(CASE WHEN status = 'DELIVERED' THEN parcels ELSE 0 END) AS billable_parcels
FROM deliveries
GROUP BY DATE(delivered_at), customer;
