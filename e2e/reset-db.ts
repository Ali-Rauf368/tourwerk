import { execSync } from 'node:child_process';
import path from 'node:path';
import { Client } from 'pg';
const E2E_DB = process.env.DATABASE_URL ?? 'postgresql://tourwerk@127.0.0.1:5442/tourwerk_e2e';

/** Recreate the e2e database so every run starts from the same seed (runs before the API starts). */
async function main() {
  const url = new URL(E2E_DB);
  const name = url.pathname.slice(1);
  url.pathname = '/postgres';
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  execSync('npx prisma migrate deploy', { cwd: path.resolve(__dirname, '../apps/api'), env: { ...process.env, DATABASE_URL: E2E_DB }, stdio: 'pipe' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
