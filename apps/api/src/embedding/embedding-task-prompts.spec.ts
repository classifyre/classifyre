import {
  EmbeddingProviderService,
  withTaskPrompt,
} from './embedding-provider.service';
import { QueryEmbeddingService } from './query-embedding.service';

/**
 * Models trained with task prompts embed what is stored and what is asked
 * differently: EmbeddingGemma wants "title: none | text: " in front of a
 * document and "task: search result | query: " in front of a question, E5
 * wants "passage: " and "query: ". A library applies them by name; a bare
 * `/v1/embeddings` endpoint embeds whatever string arrives. Classifyre talks to
 * the endpoint, so it has to put the prompt there itself — and on the right
 * side, since a corpus stored as documents and searched as documents ranks
 * short look-alike strings over the passage that answers.
 */
describe('embedding task prompts', () => {
  const gemma = {
    documentPrefix: 'title: none | text: ',
    queryPrefix: 'task: search result | query: ',
  };

  it('puts the document prompt in front of what is stored', () => {
    expect(withTaskPrompt(['a ceiling report'], gemma, 'document')).toEqual([
      'title: none | text: a ceiling report',
    ]);
  });

  it('puts the query prompt in front of what is asked', () => {
    expect(withTaskPrompt(['water in the ceiling'], gemma, 'query')).toEqual([
      'task: search result | query: water in the ceiling',
    ]);
  });

  it('sends the text as it is to a model that has no prompts', () => {
    const texts = ['a ceiling report'];
    expect(withTaskPrompt(texts, {}, 'document')).toBe(texts);
    expect(withTaskPrompt(texts, {}, 'query')).toBe(texts);
    // One side only is a real configuration (a query instruction, no document
    // prompt), and the missing side must not borrow the other's.
    expect(withTaskPrompt(texts, { queryPrefix: 'query: ' }, 'document')).toBe(
      texts,
    );
  });

  function remote(cfg: Record<string, unknown>) {
    const service = Object.create(
      EmbeddingProviderService.prototype,
    ) as EmbeddingProviderService;
    const sent: string[][] = [];
    Object.assign(service, {
      config: {},
      settings: undefined,
      embedRemote: (texts: string[]) => {
        sent.push(texts);
        return Promise.resolve(texts.map(() => [1, 0]));
      },
    });
    const resolved = {
      provider: 'openai-compatible',
      model: 'embeddinggemma-2',
      dimensions: 2,
      normalize: true,
      ...cfg,
    } as never;
    return { service, sent, resolved };
  }

  it('embeds stored text as a document unless told it is a question', async () => {
    const { service, sent, resolved } = remote(gemma);

    await service.embedMany(['the delivery note'], resolved);
    await service.embedMany(['who signed for it'], resolved, 'query');

    expect(sent).toEqual([
      ['title: none | text: the delivery note'],
      ['task: search result | query: who signed for it'],
    ]);
  });

  it('asks every search through the query side', async () => {
    const embedMany = jest.fn().mockResolvedValue([[0.6, 0.8]]);
    const cfg = { enabled: true, ...gemma };
    const service = new QueryEmbeddingService(
      { embedMany } as never,
      undefined,
      { resolve: () => Promise.resolve(cfg) } as never,
    );

    await service.embed('water in the ceiling');

    expect(embedMany).toHaveBeenCalledWith(
      ['water in the ceiling'],
      cfg,
      'query',
    );
  });
});
