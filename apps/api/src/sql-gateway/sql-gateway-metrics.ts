import { Injectable } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';

/**
 * Metrics exported by the SQL gateway and its native Postgres catalog sidecar
 * (docs/prd/SG-sql-gateway-native-catalog.md §4.4):
 * - `classifyre_sql_gateway_catalog_dbs` (gauge)
 * - `classifyre_sql_gateway_catalog_db_create_seconds` (histogram)
 * - `classifyre_sql_gateway_catalog_db_drops_total` (counter)
 * - `classifyre_sql_gateway_sidecar_restarts_total` (counter)
 * - `classifyre_sql_gateway_sessions_active` (gauge)
 */
const CREATE_BUCKETS = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export interface SqlGatewayMetricsSnapshot {
  catalogDbs: number;
  catalogDbCreateCount: number;
  catalogDbCreateSumSeconds: number;
  catalogDbDropsTotal: number;
  sidecarRestartsTotal: number;
  sessionsActive: number;
}

@Injectable()
export class SqlGatewayMetrics {
  private catalogDbs = 0;
  private sessionsActive = 0;
  private catalogDbDropsTotal = 0;
  private sidecarRestartsTotal = 0;
  private createCount = 0;
  private createSum = 0;
  private readonly createBuckets = new Array<number>(
    CREATE_BUCKETS.length,
  ).fill(0);

  private readonly meter = metrics.getMeter('classifyre.sql-gateway');
  private readonly createHistogram = this.meter.createHistogram(
    'classifyre_sql_gateway_catalog_db_create_seconds',
    {
      description:
        'Duration to provision a new catalog database on the sidecar',
      unit: 's',
    },
  );
  private readonly dropsCounter = this.meter.createCounter(
    'classifyre_sql_gateway_catalog_db_drops_total',
    {
      description: 'Catalog databases reaped from the sidecar',
    },
  );
  private readonly restartsCounter = this.meter.createCounter(
    'classifyre_sql_gateway_sidecar_restarts_total',
    {
      description: 'Detected catalog Postgres sidecar disconnects/restarts',
    },
  );

  constructor() {
    const catalogDbsGauge = this.meter.createObservableGauge(
      'classifyre_sql_gateway_catalog_dbs',
      { description: 'Live catalog databases tracked on the sidecar' },
    );
    catalogDbsGauge.addCallback((obs) => obs.observe(this.catalogDbs));

    const sessionsGauge = this.meter.createObservableGauge(
      'classifyre_sql_gateway_sessions_active',
      { description: 'Active SQL gateway client sessions' },
    );
    sessionsGauge.addCallback((obs) => obs.observe(this.sessionsActive));
  }

  setCatalogDbs(count: number): void {
    this.catalogDbs = count;
  }

  setSessionsActive(count: number): void {
    this.sessionsActive = count;
  }

  observeCatalogDbCreate(seconds: number): void {
    this.createCount += 1;
    this.createSum += seconds;
    for (let i = 0; i < CREATE_BUCKETS.length; i += 1) {
      if (seconds <= CREATE_BUCKETS[i]) this.createBuckets[i] += 1;
    }
    this.createHistogram.record(seconds);
  }

  recordCatalogDbDrop(count = 1): void {
    this.catalogDbDropsTotal += count;
    this.dropsCounter.add(count);
  }

  recordSidecarRestart(): void {
    this.sidecarRestartsTotal += 1;
    this.restartsCounter.add(1);
  }

  snapshot(): SqlGatewayMetricsSnapshot {
    return {
      catalogDbs: this.catalogDbs,
      catalogDbCreateCount: this.createCount,
      catalogDbCreateSumSeconds: this.createSum,
      catalogDbDropsTotal: this.catalogDbDropsTotal,
      sidecarRestartsTotal: this.sidecarRestartsTotal,
      sessionsActive: this.sessionsActive,
    };
  }

  prometheus(): string {
    const lines: string[] = [
      '# HELP classifyre_sql_gateway_catalog_dbs Live catalog databases tracked on the sidecar.',
      '# TYPE classifyre_sql_gateway_catalog_dbs gauge',
      `classifyre_sql_gateway_catalog_dbs ${this.catalogDbs}`,
      '# HELP classifyre_sql_gateway_catalog_db_create_seconds Duration to provision a new catalog database on the sidecar.',
      '# TYPE classifyre_sql_gateway_catalog_db_create_seconds histogram',
    ];
    for (let i = 0; i < CREATE_BUCKETS.length; i += 1) {
      lines.push(
        `classifyre_sql_gateway_catalog_db_create_seconds_bucket{le="${CREATE_BUCKETS[i]}"} ${this.createBuckets[i]}`,
      );
    }
    lines.push(
      `classifyre_sql_gateway_catalog_db_create_seconds_bucket{le="+Inf"} ${this.createCount}`,
      `classifyre_sql_gateway_catalog_db_create_seconds_sum ${this.createSum.toFixed(6)}`,
      `classifyre_sql_gateway_catalog_db_create_seconds_count ${this.createCount}`,
      '# HELP classifyre_sql_gateway_catalog_db_drops_total Catalog databases reaped from the sidecar.',
      '# TYPE classifyre_sql_gateway_catalog_db_drops_total counter',
      `classifyre_sql_gateway_catalog_db_drops_total ${this.catalogDbDropsTotal}`,
      '# HELP classifyre_sql_gateway_sidecar_restarts_total Detected catalog Postgres sidecar disconnects/restarts.',
      '# TYPE classifyre_sql_gateway_sidecar_restarts_total counter',
      `classifyre_sql_gateway_sidecar_restarts_total ${this.sidecarRestartsTotal}`,
      '# HELP classifyre_sql_gateway_sessions_active Active SQL gateway client sessions.',
      '# TYPE classifyre_sql_gateway_sessions_active gauge',
      `classifyre_sql_gateway_sessions_active ${this.sessionsActive}`,
    );
    return `${lines.join('\n')}\n`;
  }
}
