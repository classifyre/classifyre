/**
 * How many sockets may be signing in, in all and per client (review of
 * 60a16b9b, c5; re-review 2026-11-22). Before sign-in a socket costs memory
 * and gives nothing back, so there are at most `total` of them. Per client:
 * at most `perClient`, counted by the address the client really has — the
 * one a PROXY header names behind a load balancer, which is only known once
 * the header is read (counting the proxy would put every client behind it
 * into one set of slots). A sign-in waiting its turn (`SignInLockout`)
 * gives its share of `total` back meanwhile: waits are bounded by the
 * lockout, per key and in all, not by this count.
 */
export const MAX_SIGNING_IN = 64;
export const MAX_SIGNING_IN_PER_CLIENT = 16;

export interface SignInTicket {
  /** Count the socket for its client; false when that client has its share. */
  identify(client: string): boolean;
  /** While waiting for the lockout, the socket is not counted in all. */
  waiting(on: boolean): void;
  /** Signed in, refused or gone: idempotent. */
  leave(): void;
}

export class SignInSlots {
  private signingIn = 0;
  private readonly byClient = new Map<string, number>();

  constructor(
    private readonly total = MAX_SIGNING_IN,
    private readonly perClient = MAX_SIGNING_IN_PER_CLIENT,
  ) {}

  /** A socket accepted: its ticket, or null when every slot is taken. */
  enter(): SignInTicket | null {
    if (this.signingIn >= this.total) return null;
    this.signingIn += 1;
    let counted = true;
    let away = false;
    let client: string | null = null;
    return {
      identify: (address: string): boolean => {
        if (client !== null) return true;
        const held = this.byClient.get(address) ?? 0;
        if (held >= this.perClient) return false;
        this.byClient.set(address, held + 1);
        client = address;
        return true;
      },
      waiting: (on: boolean): void => {
        if (!counted || on === away) return;
        away = on;
        this.signingIn += on ? -1 : 1;
      },
      leave: (): void => {
        if (!counted) return;
        counted = false;
        if (!away) this.signingIn -= 1;
        if (client !== null) {
          const left = (this.byClient.get(client) ?? 1) - 1;
          if (left > 0) this.byClient.set(client, left);
          else this.byClient.delete(client);
        }
      },
    };
  }

  /** Sockets counted now (for tests and metrics). */
  get active(): number {
    return this.signingIn;
  }
}
