import { config } from 'dotenv';
import { resolve } from 'path';

console.log(
  '[setup-env] DATABASE_URL before load:',
  process.env.DATABASE_URL,
);
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
console.log(
  '[setup-env] DATABASE_URL after restore:',
  process.env.DATABASE_URL?.substring(0, 120),
);

// Trap further DATABASE_URL changes for debugging
const _origVal = process.env.DATABASE_URL;
let _curVal = _origVal;
Object.defineProperty(process.env, 'DATABASE_URL', {
  get() {
    console.log(
      '[setup-env] DATABASE_URL getter called, val:',
      _curVal?.substring(0, 80),
    );
    return _curVal;
  },
  set(v: string) {
    if (v !== _curVal) {
      console.log(
        '[setup-env] DATABASE_URL CHANGED from',
        _curVal?.substring(0, 80),
        'to',
        v?.substring(0, 80),
      );
      console.trace('[setup-env] DATABASE_URL change stack');
    }
    _curVal = v;
  },
  configurable: true,
  enumerable: true,
});
