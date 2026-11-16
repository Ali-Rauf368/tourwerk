import { execSync } from 'node:child_process';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://tourwerk@127.0.0.1:5442/tourwerk_test';

export default function globalSetup() {
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: TEST_DB }, stdio: 'pipe' });
}
