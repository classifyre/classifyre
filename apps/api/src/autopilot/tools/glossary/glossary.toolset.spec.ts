import { GlossaryToolset } from './glossary.toolset';
import type { GlossaryService } from '../../../glossary/glossary.service';
import type { Tool, ToolContext } from '../tool.types';

describe('GlossaryToolset', () => {
  const glossary = {
    lookup: jest.fn(),
    upsert: jest.fn(),
  };
  const tools = new GlossaryToolset(
    glossary as unknown as GlossaryService,
  ).list();
  const byName = (name: string) =>
    tools.find((tool) => tool.name === name) as Tool;

  beforeEach(() => jest.clearAllMocks());

  it('links a focused case to an agent glossary proposal', async () => {
    glossary.upsert.mockResolvedValue({ id: 'term-1' });
    const context = {
      ctx: {
        run: { id: 'run-1', agentKind: 'CASE', caseId: 'case-1' },
      },
    } as unknown as ToolContext;

    await byName('glossary.propose').handler(
      { term: 'Project Aurora', aliases: ['Aurora'] },
      context,
    );

    expect(glossary.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        term: 'Project Aurora',
        aliases: ['Aurora'],
        refType: 'case',
        refId: 'case-1',
        origin: 'AGENT',
        author: 'CASE',
      }),
    );
  });

  it('preserves an explicit inquiry reference outside a focused case', async () => {
    const context = {
      ctx: { run: { id: 'run-1', agentKind: 'INQUIRY' } },
    } as unknown as ToolContext;

    await byName('glossary.propose').handler(
      {
        term: 'Special Access Program',
        refType: 'inquiry',
        refId: 'inquiry-1',
      },
      context,
    );

    expect(glossary.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        refType: 'inquiry',
        refId: 'inquiry-1',
      }),
    );
  });

  it('rejects incomplete reference provenance', async () => {
    const context = {
      ctx: { run: { id: 'run-1', agentKind: 'CASE' } },
    } as unknown as ToolContext;

    await expect(
      byName('glossary.propose').handler(
        { term: 'Project Aurora', refType: 'case' },
        context,
      ),
    ).rejects.toThrow(/refType and refId/);
    expect(glossary.upsert).not.toHaveBeenCalled();
  });
});
