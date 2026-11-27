import { isSqlGatewayTlsEnabled } from './tls-config';

describe('isSqlGatewayTlsEnabled', () => {
  it('defaults to enabled when unset or blank', () => {
    expect(isSqlGatewayTlsEnabled({})).toBe(true);
    expect(isSqlGatewayTlsEnabled({ SQL_GATEWAY_TLS_ENABLED: '' })).toBe(true);
    expect(isSqlGatewayTlsEnabled({ SQL_GATEWAY_TLS_ENABLED: '   ' })).toBe(
      true,
    );
  });

  it('returns true for truthy values', () => {
    for (const value of ['true', 'TRUE', '1', 'yes', 'on']) {
      expect(isSqlGatewayTlsEnabled({ SQL_GATEWAY_TLS_ENABLED: value })).toBe(
        true,
      );
    }
  });

  it('returns false when explicitly disabled', () => {
    for (const value of ['false', 'FALSE', '0', 'no', 'off', ' false ']) {
      expect(isSqlGatewayTlsEnabled({ SQL_GATEWAY_TLS_ENABLED: value })).toBe(
        false,
      );
    }
  });
});
