import mongoose, { Schema, type Connection, type Model } from 'mongoose';
import { thin, type Fix, type TelemetryStore } from './store';

const fixSchema = new Schema<Fix>(
  {
    ts: { type: Date, required: true },
    vehicleId: { type: String, required: true },
    tourId: { type: String, required: true },
    lat: Number,
    lng: Number,
    speedKmh: Number,
    heading: Number,
  },
  {
    versionKey: false,
    // Time-series collection: MongoDB buckets fixes per vehicle; old data expires after 90 days.
    timeseries: { timeField: 'ts', metaField: 'vehicleId', granularity: 'seconds' },
    expireAfterSeconds: 90 * 24 * 3600,
    autoIndex: true,
  },
);
fixSchema.index({ tourId: 1, ts: 1 });

export class MongoTelemetryStore implements TelemetryStore {
  readonly kind = 'mongodb' as const;

  private constructor(
    private readonly conn: Connection,
    private readonly fixes: Model<Fix>,
  ) {}

  static async connect(url: string) {
    const conn = await mongoose.createConnection(url, { serverSelectionTimeoutMS: 5000 }).asPromise();
    const fixes = conn.model<Fix>('Fix', fixSchema, 'fixes');
    await fixes.createCollection().catch(() => undefined); // already exists
    await fixes.syncIndexes();
    return new MongoTelemetryStore(conn, fixes);
  }

  async insert(fix: Fix) {
    await this.fixes.create(fix);
  }

  async trail(tourId: string, max = 500) {
    const docs = await this.fixes.find({ tourId }, { _id: 0 }).sort({ ts: 1 }).lean<Fix[]>();
    return thin(docs, max);
  }

  async latest(since: Date) {
    return this.fixes.aggregate<Fix>([
      { $match: { ts: { $gte: since } } },
      { $sort: { ts: -1 } },
      { $group: { _id: '$vehicleId', doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
      { $project: { _id: 0 } },
    ]);
  }

  async ping() {
    try {
      await this.conn.db?.admin().ping();
      return true;
    } catch {
      return false;
    }
  }

  async close() {
    await this.conn.close();
  }
}
