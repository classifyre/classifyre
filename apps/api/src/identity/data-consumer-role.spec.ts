import { BUILT_IN_ROLES } from './roles';

/**
 * Found 2026-11-23 (Kestrel & Finch battle test): Data reader opens no
 * workspace, and Viewer — the only role that did — also shows every finding
 * with its matched content (every e-mail, IBAN and key the scans found). An
 * outside party given one shared dataset saw all of them.
 */
describe('Data consumer role', () => {
  const role = BUILT_IN_ROLES.find((r) => r.key === 'data-consumer');

  it('opens the workspace and nothing else', () => {
    expect(role).toBeDefined();
    expect(role?.scope).toBe('workspace');
    expect([...(role?.capabilities ?? [])].sort()).toEqual([
      'notification.view',
      'workspace.view',
    ]);
  });

  it('shows no findings, assets, sources, cases or activity', () => {
    for (const capability of [
      'finding.view',
      'asset.view',
      'source.view',
      'case.view',
      'inquiry.view',
      'activity.view',
      'access.view',
      'data.query',
    ]) {
      expect(role?.capabilities).not.toContain(capability);
    }
  });
});
