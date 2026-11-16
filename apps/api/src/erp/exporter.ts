import mysql, { type Pool, type ResultSetHeader } from 'mysql2/promise';

/** A delivered (or finally failed) order as the legacy ERP expects it. */
export interface DeliveryRecord {
  orderNumber: string;
  externalRef: string | null;
  customer: string;
  postcode: string;
  status: 'DELIVERED' | 'FAILED';
  failReason: string | null;
  deliveredAt: Date;
  weightKg: number;
  parcels: number;
  vehiclePlate: string;
}

/** Port for the ERP export; MySQL in production, an in-memory outbox otherwise. */
export interface ErpExporter {
  readonly kind: 'mysql' | 'memory';
  /** Upserts by order number, so re-exporting is safe. Returns rows written. */
  export(records: DeliveryRecord[]): Promise<number>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export class MemoryErpExporter implements ErpExporter {
  readonly kind = 'memory' as const;
  readonly rows = new Map<string, DeliveryRecord>();

  async export(records: DeliveryRecord[]) {
    for (const r of records) this.rows.set(r.orderNumber, r);
    return records.length;
  }

  async ping() {
    return true;
  }

  async close() {}
}

/** Writes into erp.deliveries (schema: integration/mysql/01-schema.sql). */
export class MysqlErpExporter implements ErpExporter {
  readonly kind = 'mysql' as const;
  private constructor(private readonly pool: Pool) {}

  static create(url: string) {
    return new MysqlErpExporter(mysql.createPool({ uri: url, connectionLimit: 4, timezone: 'Z' }));
  }

  async export(records: DeliveryRecord[]) {
    if (!records.length) return 0;
    const rows = records.map((r) => [
      r.orderNumber, r.externalRef, r.customer, r.postcode, r.status, r.failReason, r.deliveredAt, r.weightKg, r.parcels, r.vehiclePlate,
    ]);
    const [res] = await this.pool.query<ResultSetHeader>(
      `INSERT INTO deliveries (order_number, external_ref, customer, postcode, status, fail_reason, delivered_at, weight_kg, parcels, vehicle_plate)
       VALUES ?
       ON DUPLICATE KEY UPDATE status = VALUES(status), fail_reason = VALUES(fail_reason), delivered_at = VALUES(delivered_at),
                               vehicle_plate = VALUES(vehicle_plate), exported_at = CURRENT_TIMESTAMP`,
      [rows],
    );
    return res.affectedRows ? records.length : 0;
  }

  async ping() {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close() {
    await this.pool.end();
  }
}
