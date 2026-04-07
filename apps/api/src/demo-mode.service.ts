import { Injectable } from '@nestjs/common';

const TRUTHY_VALUES = new Set(['1', 'true', 'yes']);

@Injectable()
export class DemoModeService {
  private readonly enabled: boolean;

  constructor() {
    const raw = (process.env.DEMO_MODE ?? '').toLowerCase().trim();
    this.enabled = TRUTHY_VALUES.has(raw);
  }

  get isDemoMode(): boolean {
    return this.enabled;
  }
}
