/**
 * Contract tests for the MongoDB and MySQL adapters. They run against real databases
 * when MONGO_URL / MYSQL_URL are set (CI starts both as services) and are skipped
 * otherwise. The same assertions run against the in-memory adapters, so both
 * implementations of each port behave identically.
 */
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MemoryErpExporter, MysqlErpExporter, type DeliveryRecord, type ErpExporter } from '../src/erp/exporter';
import { MongoTelemetryStore } from '../src/telemetry/mongo-store';
import { MemoryTelemetryStore, type TelemetryStore } from '../src/telemetry/store';

const MONGO_URL = process.env.MONGO_URL;
const MYSQL_URL = process.env.MYSQL_URL;

function telemetryContract(name: string, make: () => Promise<TelemetryStore>) {
  describe(`telemetry store: ${name}`, () => {
    let store: TelemetryStore;
    beforeAll(async () => (store = await make()));
    afterAll(() => store.close());

    test('stores a trail in time order and thins long trails', async () => {
      const tourId = randomUUID();
      const t0 = Date.now() - 60_000;
      for (let i = 0; i < 50; i += 1) await store.insert({ vehicleId: 'v-trail', tourId, ts: new Date(t0 + i * 1000), lat: 53.5 + i / 1000, lng: 10, speedKmh: 30, heading: 90 });
      const trail = await store.trail(tourId, 10);
      expect(trail).toHaveLength(10);
      expect(trail[0].lat).toBeCloseTo(53.5);
      expect(trail[9].lat).toBeCloseTo(53.549);
      expect(trail.every((f, i) => i === 0 || f.ts >= trail[i - 1].ts)).toBe(true);
    });

    test('latest returns the newest fix per vehicle', async () => {
      const tourId = randomUUID();
      const now = Date.now();
      await store.insert({ vehicleId: 'v-a', tourId, ts: new Date(now - 2000), lat: 1, lng: 1, speedKmh: 0, heading: 0 });
      await store.insert({ vehicleId: 'v-a', tourId, ts: new Date(now - 1000), lat: 2, lng: 2, speedKmh: 0, heading: 0 });
      const latest = await store.latest(new Date(now - 5000));
      expect(latest.find((f) => f.vehicleId === 'v-a')?.lat).toBe(2);
    });

    test('ping', async () => expect(await store.ping()).toBe(true));
  });
}

const record = (n: string, over: Partial<DeliveryRecord> = {}): DeliveryRecord => ({
  orderNumber: n, externalRef: null, customer: 'Feinkost Albers', postcode: '20259', status: 'DELIVERED', failReason: null,
  deliveredAt: new Date('2026-11-16T10:15:00Z'), weightKg: 12.5, parcels: 2, vehiclePlate: 'HH-TW 101', ...over,
});

function erpContract(name: string, make: () => Promise<ErpExporter>, count: (n: string) => Promise<{ status: string } | null>) {
  describe(`ERP exporter: ${name}`, () => {
    let erp: ErpExporter;
    beforeAll(async () => (erp = await make()));
    afterAll(() => erp.close());

    test('exports and upserts by order number', async () => {
      const n = `TW-T-${Date.now()}`;
      expect(await erp.export([record(n)])).toBe(1);
      await erp.export([record(n, { status: 'FAILED', failReason: 'refused' })]);
      expect((await count(n))?.status).toBe('FAILED');
    });

    test('empty batch is a no-op', async () => expect(await erp.export([])).toBe(0));
  });
}

telemetryContract('memory', async () => new MemoryTelemetryStore());
if (MONGO_URL) telemetryContract('mongodb', () => MongoTelemetryStore.connect(MONGO_URL));
else describe.skip('telemetry store: mongodb (set MONGO_URL)', () => test('skipped', () => undefined));

const memoryErp = new MemoryErpExporter();
erpContract('memory', async () => memoryErp, async (n) => memoryErp.rows.get(n) ?? null);

if (MYSQL_URL) {
  let pool: mysql.Pool;
  erpContract(
    'mysql',
    async () => {
      pool = mysql.createPool({ uri: MYSQL_URL, multipleStatements: true });
      await pool.query(readFileSync(path.resolve(__dirname, '../../../integration/mysql/01-schema.sql'), 'utf8'));
      return MysqlErpExporter.create(MYSQL_URL);
    },
    async (n) => {
      const [rows] = await pool.query<mysql.RowDataPacket[]>('SELECT status FROM deliveries WHERE order_number = ?', [n]);
      return (rows[0] as { status: string }) ?? null;
    },
  );
  afterAll(() => pool?.end());
} else {
  describe.skip('ERP exporter: mysql (set MYSQL_URL)', () => test('skipped', () => undefined));
}
