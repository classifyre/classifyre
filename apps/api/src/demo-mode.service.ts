import { Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

const TRUTHY_VALUES = new Set(['1', 'true', 'yes']);

/** Header an operator presents to write to a demo instance. Unlike the
 * internal key, the web proxy forwards it, so it works through the public URL. */
export const DEMO_MODE_BYPASS_HEADER = 'x-bypass-demo';

@Injectable()
export class DemoModeService {
  private readonly enabled: boolean;
  private readonly bypassKey: string;

  constructor() {
    const raw = (process.env.DEMO_MODE ?? '').toLowerCase().trim();
    this.enabled = TRUTHY_VALUES.has(raw);
    this.bypassKey = (process.env.DEMO_MODE_BYPASS_KEY ?? '').trim();
  }

  get isDemoMode(): boolean {
    return this.enabled;
  }

  /** True when the request carries `DEMO_MODE_BYPASS_KEY`. Always false when
   * no key is configured, so an unset variable never opens the instance. */
  isBypassRequest(headers: Record<string, unknown> | undefined): boolean {
    if (!this.bypassKey || !headers) {
      return false;
    }

    const raw = headers[DEMO_MODE_BYPASS_HEADER];
    const presented = Array.isArray(raw) ? raw[0] : raw;
    if (typeof presented !== 'string' || presented.length === 0) {
      return false;
    }

    const a = Buffer.from(presented);
    const b = Buffer.from(this.bypassKey);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
