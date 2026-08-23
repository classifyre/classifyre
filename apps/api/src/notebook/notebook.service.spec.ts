import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AssetType } from '@prisma/client';
import { NotebookService, REQUIRED_FUNCTIONS } from './notebook.service';

const CELLS = [
  {
    id: 'imports',
    type: 'code' as const,
    source: 'from classifyre import Asset, ctx\n',
  },
  {
    id: 'extract',
    type: 'code' as const,
    source: 'def extract():\n    yield Asset(id="1")\n',
  },
];

function buildService(config: Record<string, unknown>) {
  const source = {
    id: 'src-1',
    type: AssetType.CUSTOM,
    config,
    runnerStatus: null,
  };
  const prisma = {
    source: {
      findUnique: jest.fn().mockResolvedValue(source),
      update: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ ...source, ...data }),
        ),
    },
    notebookExecution: { findMany: jest.fn(), findUnique: jest.fn() },
  };
  const crypto = {
    // Stand in for AES-GCM: the shape under test is which values get handed to
    // encryption, not the cipher itself.
    encryptMaskedConfig: jest.fn((value: Record<string, unknown>) => ({
      ...value,
      __encrypted: true,
    })),
  };
  return {
    service: new NotebookService(prisma as never, crypto as never),
    prisma,
    crypto,
  };
}

function configWith(overrides: Record<string, any> = {}) {
  return {
    type: 'CUSTOM',
    required: { notebook: { revision: 3, cells: CELLS } },
    masked: { secrets: { api_token: 'enc::v1::abc' } },
    optional: { variables: { api_base: 'https://api.example.com' } },
    ...overrides,
  };
}

describe('NotebookService', () => {
  describe('get', () => {
    it('returns cells, variables and secret names', async () => {
      const { service } = buildService(configWith());
      const notebook = await service.get('src-1');
      expect(notebook.revision).toBe(3);
      expect(notebook.cells).toHaveLength(2);
      expect(notebook.variables).toEqual({
        api_base: 'https://api.example.com',
      });
      expect(notebook.secretKeys).toEqual(['api_token']);
    });

    it('never returns secret values', async () => {
      // The editor is a browser session. Handing it every credential so it can
      // send them back unchanged would be a worse trade than a partial update.
      const { service } = buildService(configWith());
      const notebook = await service.get('src-1');
      expect(JSON.stringify(notebook)).not.toContain('enc::v1::abc');
    });

    it('rejects a source that is not CUSTOM', async () => {
      const { service, prisma } = buildService(configWith());
      prisma.source.findUnique.mockResolvedValue({
        id: 'src-1',
        type: AssetType.WORDPRESS,
        config: {},
      });
      await expect(service.get('src-1')).rejects.toThrow(BadRequestException);
    });

    it('404s for an unknown source', async () => {
      const { service, prisma } = buildService(configWith());
      prisma.source.findUnique.mockResolvedValue(null);
      await expect(service.get('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('bumps the revision and stores the cells', async () => {
      const { service, prisma } = buildService(configWith());
      const result = await service.update('src-1', {
        baseRevision: 3,
        cells: CELLS,
      });
      expect(result.revision).toBe(4);
      const written = prisma.source.update.mock.calls[0][0].data.config;
      expect(written.required.notebook.revision).toBe(4);
      expect(written.required.notebook.cells).toEqual(CELLS);
    });

    it('rejects a save built on a stale revision', async () => {
      // Two tabs open on the same notebook: the second save must not silently
      // erase the first.
      const { service, prisma } = buildService(configWith());
      await expect(
        service.update('src-1', { baseRevision: 2, cells: CELLS }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.source.update).not.toHaveBeenCalled();
    });

    it('reports both revisions so the editor can explain the conflict', async () => {
      const { service } = buildService(configWith());
      await expect(
        service.update('src-1', { baseRevision: 1, cells: CELLS }),
      ).rejects.toMatchObject({
        response: { currentRevision: 3, yourRevision: 1 },
      });
    });

    it('encrypts the config on the way in', async () => {
      const { service, crypto } = buildService(configWith());
      await service.update('src-1', { baseRevision: 3, cells: CELLS });
      expect(crypto.encryptMaskedConfig).toHaveBeenCalled();
    });

    it('leaves untouched secrets in place', async () => {
      // A partial update is the only shape that works when the editor never
      // received the existing values.
      const { service, prisma } = buildService(configWith());
      await service.update('src-1', {
        baseRevision: 3,
        cells: CELLS,
        secrets: { other: 'new-value' },
      });
      const written = prisma.source.update.mock.calls[0][0].data.config;
      expect(written.masked.secrets).toEqual({
        api_token: 'enc::v1::abc',
        other: 'new-value',
      });
    });

    it('deletes a secret set to null', async () => {
      const { service, prisma } = buildService(configWith());
      await service.update('src-1', {
        baseRevision: 3,
        cells: CELLS,
        secrets: { api_token: null },
      });
      const written = prisma.source.update.mock.calls[0][0].data.config;
      expect(written.masked.secrets).toEqual({});
    });

    it.each([
      ['api-token', 'a hyphen is not valid in a Python identifier'],
      ['2fa', 'a leading digit is not valid'],
      ['', 'an empty key is unusable'],
    ])('rejects the variable key %p (%s)', async (key) => {
      const { service } = buildService(configWith());
      await expect(
        service.update('src-1', {
          baseRevision: 3,
          cells: CELLS,
          variables: { [key]: 'v' },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts an underscored key', async () => {
      const { service } = buildService(configWith());
      await expect(
        service.update('src-1', {
          baseRevision: 3,
          cells: CELLS,
          variables: { api_base_url: 'https://x' },
        }),
      ).resolves.toEqual({ revision: 4 });
    });

    it('rejects duplicate cell ids', async () => {
      const { service } = buildService(configWith());
      await expect(
        service.update('src-1', {
          baseRevision: 3,
          cells: [CELLS[0], { ...CELLS[1], id: 'imports' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an empty notebook', async () => {
      const { service } = buildService(configWith());
      await expect(
        service.update('src-1', { baseRevision: 3, cells: [] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a notebook that does not yet satisfy the contract', async () => {
      // Autosave must land while someone is midway through writing extract().
      // The contract is enforced before an execution or a scan, not on save.
      const { service } = buildService(configWith());
      await expect(
        service.update('src-1', {
          baseRevision: 3,
          cells: [{ id: 'wip', type: 'code', source: 'def extra' }],
        }),
      ).resolves.toEqual({ revision: 4 });
    });
  });

  describe('exportPython', () => {
    it('emits a runnable module using the # %% convention', async () => {
      const { service } = buildService(
        configWith({
          required: {
            notebook: {
              revision: 1,
              cells: [
                { id: 'doc', type: 'markdown', source: 'Title\n\nBody' },
                { id: 'code', type: 'code', source: 'x = 1\n' },
              ],
            },
          },
        }),
      );
      const source = await service.exportPython('src-1');
      expect(source).toContain('# %% [markdown] id=doc');
      expect(source).toContain('# Title');
      expect(source).toContain('# %% id=code');
      expect(source).toContain('x = 1');
      // Markdown must be commented out, or the artifact is not valid Python.
      expect(source).not.toMatch(/^Title$/m);
    });
  });

  describe('scaffold', () => {
    it('serves starter cells that define the required functions', () => {
      const { service } = buildService(configWith());
      const { cells } = service.scaffold();
      const code = cells.map((cell) => cell.source).join('\n');
      expect(code).toContain('def test_connection(');
      expect(code).toContain('def extract(');
    });
  });

  describe('templates', () => {
    it('serves every worked example, each with cells', () => {
      const { service } = buildService(configWith());
      const templates = service.templates();

      expect(templates.length).toBeGreaterThan(1);
      for (const template of templates) {
        expect(template.name).toBeTruthy();
        expect(template.description).toBeTruthy();
        expect(template.cells.length).toBeGreaterThan(0);
      }
    });

    it('every template satisfies the contract it teaches', () => {
      // A template that does not define the required functions would hand an
      // author a notebook that cannot run -- exactly the state the scaffold
      // exists to avoid.
      const { service } = buildService(configWith());
      for (const template of service.templates()) {
        const code = template.cells.map((cell) => cell.source).join('\n');
        for (const name of REQUIRED_FUNCTIONS) {
          expect(code).toContain(`def ${name}(`);
        }
      }
    });

    it('marks only the folder-reading template as desktop-only', () => {
      // The flag is what lets the editor hide a template that cannot work
      // behind a browser tab talking to a cluster: it configures an absolute
      // path on local disk, which the API refuses to store there anyway.
      const { service } = buildService(configWith());
      const desktopOnly = service
        .templates()
        .filter((template) => template.desktopOnly)
        .map((template) => template.name);

      expect(desktopOnly).toEqual(['Read a folder on this machine (desktop)']);
    });

    it('includes the file, upload, folder and link examples', () => {
      const { service } = buildService(configWith());
      const names = service.templates().map((template) => template.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'Starter notebook',
          'Parse files of any format',
          'Read files uploaded to this source',
          'Read a folder on this machine (desktop)',
          'Linked assets',
        ]),
      );
    });
  });
});
