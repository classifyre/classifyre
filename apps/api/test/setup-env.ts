import { config } from 'dotenv';
import { resolve } from 'path';

// Load base .env, then allow .env.test to override (e.g. TEST_API_URL)
config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../.env.test'), override: true });
