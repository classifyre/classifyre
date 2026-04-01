import { config } from 'dotenv';
import { resolve } from 'path';

const preservedEnv = new Map(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  ),
);

// Load base .env, then allow test-specific files to override repo defaults.
// Restore incoming process env afterwards so CI/job-level variables always win.
config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../.env.test'), override: true });
config({ path: resolve(__dirname, '../.env.test.local'), override: true });

for (const [key, value] of preservedEnv) {
  process.env[key] = value;
}
