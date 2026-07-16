import { UnionFind } from './union-find';

describe('UnionFind', () => {
  it('groups transitive relationships into one component', () => {
    const components = new UnionFind(['isolated']);

    components.union('a', 'b');
    components.union('b', 'c');

    expect(components.find('a')).toBe(components.find('c'));
    expect(components.find('isolated')).not.toBe(components.find('a'));
    expect([...components.ids()].sort()).toEqual(['a', 'b', 'c', 'isolated']);
  });
});
