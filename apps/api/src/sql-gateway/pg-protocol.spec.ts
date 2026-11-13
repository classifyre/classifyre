import {
  MessageReader,
  ProtocolError,
  dataRow,
  errorResponse,
  frontend,
  parseBind,
  parseDescribe,
  parseExecute,
  parseParse,
  parseQuery,
  parseRowDescription,
  parseSaslInitial,
  parseStartupParameters,
  readErrorFields,
  rowDescription,
  splitMessages,
  MessageWriter,
} from './pg-protocol';

describe('pg-protocol', () => {
  it('frames messages across chunk boundaries', () => {
    const bytes = Buffer.concat([frontend.query('SELECT 1'), frontend.sync()]);
    const reader = new MessageReader();
    const first = reader.push(bytes.subarray(0, 7));
    expect(first).toEqual([]);
    const rest = reader.push(bytes.subarray(7));
    expect(rest.map((m) => m.type)).toEqual(['Q', 'S']);
    expect(parseQuery(rest[0].body)).toBe('SELECT 1');
  });

  it('refuses impossible lengths', () => {
    const reader = new MessageReader(100);
    const bad = Buffer.from([0x51, 0, 0, 1, 0]);
    expect(() => reader.push(bad)).toThrow(ProtocolError);
  });

  it('reads what it writes: parse, bind, describe, execute', () => {
    const parse = splitMessages(frontend.parse('s1', 'SELECT $1', [23]))[0];
    expect(parseParse(parse.body)).toEqual({
      name: 's1',
      sql: 'SELECT $1',
      paramTypes: [23],
    });
    const bind = splitMessages(
      frontend.bind('p1', 's1', [Buffer.from('5'), null], [0], [1]),
    )[0];
    expect(parseBind(bind.body)).toEqual({
      portal: 'p1',
      statement: 's1',
      paramFormats: [0],
      params: [Buffer.from('5'), null],
      resultFormats: [1],
    });
    const describe = splitMessages(frontend.describe('P', 'p1'))[0];
    expect(parseDescribe(describe.body)).toEqual({ kind: 'P', name: 'p1' });
    const execute = splitMessages(frontend.execute('p1', 200))[0];
    expect(parseExecute(execute.body)).toEqual({ portal: 'p1', maxRows: 200 });
  });

  it('round-trips row descriptions, rows and errors', () => {
    const fields = [
      {
        name: 'id',
        tableOid: 0,
        column: 0,
        typeOid: 20,
        typeSize: 8,
        typeModifier: -1,
        format: 1,
      },
    ];
    const t = splitMessages(rowDescription(fields))[0];
    expect(parseRowDescription(t.body)).toEqual(fields);
    const d = splitMessages(dataRow([Buffer.from('x'), null]))[0];
    expect(d.type).toBe('D');
    expect(d.body.readInt16BE(0)).toBe(2);
    const e = splitMessages(errorResponse({ code: '42501', message: 'no' }))[0];
    expect(readErrorFields(e.body)).toMatchObject({
      C: '42501',
      M: 'no',
      S: 'ERROR',
    });
  });

  it('reads startup parameters and SASL responses', () => {
    const startup = new MessageWriter()
      .cstring('user')
      .cstring('ana')
      .cstring('database')
      .cstring('lab')
      .byte('\0')
      .build();
    expect(parseStartupParameters(startup.subarray(4))).toEqual({
      user: 'ana',
      database: 'lab',
    });
    const sasl = new MessageWriter()
      .cstring('SCRAM-SHA-256')
      .int32(9)
      .bytes(Buffer.from('n,,n=,r=x'))
      .build('p');
    expect(parseSaslInitial(splitMessages(sasl)[0].body)).toEqual({
      mechanism: 'SCRAM-SHA-256',
      data: 'n,,n=,r=x',
    });
  });
});
