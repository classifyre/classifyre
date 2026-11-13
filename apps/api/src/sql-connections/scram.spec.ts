import { ScramExchange, scramClient, scramVerifier } from './scram';

describe('SCRAM-SHA-256', () => {
  it('signs in with the password the verifier was made from', () => {
    const verifier = scramVerifier('correct horse battery staple');
    const client = scramClient('ana_powerbi', 'correct horse battery staple');
    const server = new ScramExchange(verifier);
    const serverFirst = server.start(client.first);
    const final = client.final(serverFirst);
    expect(server.finish(final.message)).toBe(`v=${final.serverSignature}`);
  });

  it('refuses a wrong password', () => {
    const server = new ScramExchange(scramVerifier('right'));
    const client = scramClient('ana', 'wrong');
    const serverFirst = server.start(client.first);
    expect(() => server.finish(client.final(serverFirst).message)).toThrow(
      'Wrong password.',
    );
  });

  it('refuses a replayed nonce and channel binding it never offered', () => {
    const server = new ScramExchange(scramVerifier('pw'));
    expect(() => server.start('p=tls-server-end-point,,n=ana,r=abc')).toThrow();
    const client = scramClient('ana', 'pw');
    server.start(client.first);
    const other = new ScramExchange(scramVerifier('pw'));
    const otherFirst = other.start(client.first);
    expect(() => server.finish(client.final(otherFirst).message)).toThrow();
  });

  it('matches the RFC 7677 test vector', () => {
    // RFC 7677 §3: user "user", password "pencil".
    const verifier = scramVerifier(
      'pencil',
      4096,
      Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64'),
    );
    const server = new ScramExchange(verifier);
    // Fix the server nonce by starting and replacing it as the RFC does.
    const first = server.start('n,,n=user,r=rOprNGfwEbeRWgbNEkqO');
    expect(first).toMatch(
      /^r=rOprNGfwEbeRWgbNEkqO.+,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096$/,
    );
    (server as unknown as { nonce: string }).nonce =
      'rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';
    (server as unknown as { serverFirst: string }).serverFirst =
      'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096';
    expect(
      server.finish(
        'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=',
      ),
    ).toBe('v=6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
  });
});
