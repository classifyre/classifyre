import { keepFileColumns } from './keep-file-columns';

describe('keepFileColumns', () => {
  const columns = [{ name: 'email', type: 'VARCHAR' }];
  const stored = { object_key: 'a/b.csv', size_bytes: 3, columns };

  it('keeps the columns when discovery sends the unchanged file without them', () => {
    expect(
      keepFileColumns({ object_key: 'a/b.csv', size_bytes: 3 }, stored),
    ).toEqual(stored);
  });

  it('takes the columns a scan sends', () => {
    const next = { object_key: 'a/b.csv', columns: [{ name: 'id', type: '' }] };
    expect(keepFileColumns(next, stored)).toBe(next);
  });

  it('adds nothing to another file, a database table, or a first sighting', () => {
    const other = { object_key: 'a/c.csv' };
    expect(keepFileColumns(other, stored)).toBe(other);
    const table = { table_name: 'orders' };
    expect(keepFileColumns(table, { table_name: 'orders', columns })).toBe(
      table,
    );
    expect(keepFileColumns(other, undefined)).toBe(other);
  });
});
