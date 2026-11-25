import { SqlGatewayMetrics } from './sql-gateway-metrics';

describe('SqlGatewayMetrics', () => {
  it('tracks gauges, counters, and create duration histogram and renders Prometheus text', () => {
    const m = new SqlGatewayMetrics();
    m.setCatalogDbs(3);
    m.setSessionsActive(12);
    m.observeCatalogDbCreate(0.04);
    m.observeCatalogDbCreate(0.3);
    m.recordCatalogDbDrop(2);
    m.recordSidecarRestart();

    const snap = m.snapshot();
    expect(snap).toMatchObject({
      catalogDbs: 3,
      catalogDbCreateCount: 2,
      catalogDbDropsTotal: 2,
      sidecarRestartsTotal: 1,
      sessionsActive: 12,
    });
    expect(snap.catalogDbCreateSumSeconds).toBeCloseTo(0.34, 6);

    const text = m.prometheus();
    expect(text).toContain('classifyre_sql_gateway_catalog_dbs 3');
    expect(text).toContain('classifyre_sql_gateway_sessions_active 12');
    expect(text).toContain('classifyre_sql_gateway_catalog_db_drops_total 2');
    expect(text).toContain('classifyre_sql_gateway_sidecar_restarts_total 1');
    expect(text).toContain(
      'classifyre_sql_gateway_catalog_db_create_seconds_bucket{le="0.05"} 1',
    );
    expect(text).toContain(
      'classifyre_sql_gateway_catalog_db_create_seconds_bucket{le="0.5"} 2',
    );
    expect(text).toContain(
      'classifyre_sql_gateway_catalog_db_create_seconds_count 2',
    );
  });
});
