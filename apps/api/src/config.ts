import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4600),
  DATABASE_URL: z.string().default('postgresql://tourwerk@127.0.0.1:5442/tourwerk'),
  /** MongoDB for GPS telemetry. Empty = in-memory store (development and tests). */
  MONGO_URL: z.string().optional(),
  /** Legacy ERP (MySQL) that receives delivered orders. Empty = in-memory outbox. */
  MYSQL_URL: z.string().optional(),
  JWT_SECRET: z.string().min(16).optional(),
  /** Shared secret used by Apache NiFi and other integrations (header x-integration-token). */
  INTEGRATION_TOKEN: z.string().min(16).optional(),
  OPTIMIZER_PATH: z.string().optional(),
  TRACKER_PATH: z.string().optional(),
  /** Time budget for the ALNS route search per optimization (0 = construction only). */
  OPTIMIZER_SEARCH_MS: z.coerce.number().int().min(0).max(30000).default(1500),
  /** Simulated seconds per real second when the fleet simulator drives a tour. */
  SIM_SPEEDUP: z.coerce.number().positive().default(90),
  SIM_TICK_MS: z.coerce.number().int().positive().default(700),
  SIM_FAIL_RATE: z.coerce.number().min(0).max(1).default(0.04),
  /** Share of simulated legs that hit congestion, so the ETA engine has delays to catch. */
  SIM_JAM_RATE: z.coerce.number().min(0).max(1).default(0.12),
});

export type Config = z.infer<typeof schema> & {
  JWT_SECRET: string;
  INTEGRATION_TOKEN: string;
  OPTIMIZER_PATH: string;
  TRACKER_PATH: string;
};

const nativeBin = (name: string) => path.resolve(__dirname, '../../../native/build', name);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse(env);
  if (parsed.NODE_ENV === 'production' && (!parsed.JWT_SECRET || !parsed.INTEGRATION_TOKEN)) {
    throw new Error('JWT_SECRET and INTEGRATION_TOKEN must be set in production');
  }
  return {
    ...parsed,
    MONGO_URL: parsed.MONGO_URL || undefined,
    MYSQL_URL: parsed.MYSQL_URL || undefined,
    JWT_SECRET: parsed.JWT_SECRET ?? randomBytes(32).toString('hex'),
    INTEGRATION_TOKEN: parsed.INTEGRATION_TOKEN ?? 'dev-integration-token-change-me',
    OPTIMIZER_PATH: parsed.OPTIMIZER_PATH ?? nativeBin('tw-optimizer'),
    TRACKER_PATH: parsed.TRACKER_PATH ?? nativeBin('tw-tracker'),
  };
}
