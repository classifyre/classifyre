import { Injectable, Logger } from '@nestjs/common';
import type { IamConfig } from './iam-config';

export interface Organization {
  id: string;
  alias: string;
  name: string;
}

export interface OrgGroup {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
}

export interface Membership {
  enabled: boolean;
  displayName: string | null;
  email: string | null;
  organizations: Organization[];
}

const TTL_MS = 60_000;
/** How long a failed refresh may fall back to the last answer. */
const STALE_GRACE_MS = 15 * 60_000;
const MAX_ENTRIES = 5_000;
/** A hanging identity server must fail fast, so the stale answer can serve. */
const LOOKUP_TIMEOUT_MS = 3_000;

interface Cached<T> {
  value: T;
  expiresAt: number;
}

/**
 * Who belongs where, read from the identity server with the API's own
 * service account (realm-management `view-users` + `view-organizations`, so
 * it can read and never change). Tokens carry identity and tenant only; the
 * groups come from here, cached for a minute, so a person moved between
 * groups gets their new access within a minute and group renames never
 * matter (grants hold group ids).
 */
@Injectable()
export class MembershipService {
  private readonly logger = new Logger(MembershipService.name);
  private serviceToken: Cached<string> | null = null;
  private readonly users = new Map<string, Cached<Membership>>();
  private readonly memberGroups = new Map<string, Cached<string[]>>();
  private readonly orgGroups = new Map<string, Cached<Map<string, OrgGroup>>>();

  constructor(
    private readonly config: IamConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** The person's account and organizations. Disabled or deleted: `enabled: false`. */
  async membership(sub: string): Promise<Membership> {
    return this.cached(this.users, sub, async () => {
      const user = await this.get<{
        enabled?: boolean;
        firstName?: string;
        lastName?: string;
        username?: string;
        email?: string;
      } | null>(`/users/${encodeURIComponent(sub)}`, true);
      if (!user) {
        return {
          enabled: false,
          displayName: null,
          email: null,
          organizations: [],
        };
      }
      const organizations =
        (await this.get<Organization[]>(
          `/organizations/members/${encodeURIComponent(sub)}/organizations`,
        )) ?? [];
      const fullName = [user.firstName, user.lastName]
        .filter(Boolean)
        .join(' ');
      return {
        enabled: user.enabled !== false,
        displayName: fullName || user.username || null,
        email: user.email ?? null,
        organizations: organizations.map(({ id, alias, name }) => ({
          id,
          alias,
          name,
        })),
      };
    });
  }

  /** Group ids the person is in within one organization, with every ancestor. */
  async groupIds(sub: string, orgId: string): Promise<Set<string>> {
    const direct = await this.cached(
      this.memberGroups,
      `${orgId}|${sub}`,
      async () => {
        const groups =
          (await this.get<OrgGroup[]>(
            `/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(sub)}/groups`,
          )) ?? [];
        return groups.map((group) => group.id);
      },
    );
    const tree = await this.groupTree(orgId);
    const all = new Set<string>();
    for (const id of direct) {
      for (const ancestor of this.lineage(tree, id)) all.add(ancestor);
    }
    return all;
  }

  /** The group and every group above it, nearest first. */
  async ancestry(orgId: string, groupId: string): Promise<string[]> {
    return this.lineage(await this.groupTree(orgId), groupId);
  }

  async groups(orgId: string): Promise<OrgGroup[]> {
    return [...(await this.groupTree(orgId)).values()];
  }

  /**
   * The organization with this alias. The server's `search` matches names and
   * domains, not aliases, so this pages through every organization.
   */
  async organizationByAlias(alias: string): Promise<Organization | null> {
    const page = 500;
    for (let first = 0; ; first += page) {
      const found =
        (await this.get<Organization[]>(
          `/organizations?briefRepresentation=true&first=${first}&max=${page}`,
        )) ?? [];
      const match = found.find((org) => org.alias === alias);
      if (match) return { id: match.id, alias: match.alias, name: match.name };
      if (found.length < page) return null;
    }
  }

  private lineage(tree: Map<string, OrgGroup>, id: string): string[] {
    const chain: string[] = [];
    let current = tree.get(id);
    if (!current) return [id];
    while (current && !chain.includes(current.id)) {
      chain.push(current.id);
      current = current.parentId ? tree.get(current.parentId) : undefined;
    }
    return chain;
  }

  /** Every group of an organization, flattened, by id. */
  private groupTree(orgId: string): Promise<Map<string, OrgGroup>> {
    return this.cached(this.orgGroups, orgId, async () => {
      const tree = new Map<string, OrgGroup>();
      const visit = async (parentId: string | null, path: string) => {
        const children =
          (await this.get<
            { id: string; name: string; path: string; subGroupCount?: number }[]
          >(
            parentId
              ? `${path}/${encodeURIComponent(parentId)}/children?max=1000`
              : `${path}?max=1000`,
          )) ?? [];
        for (const child of children) {
          tree.set(child.id, {
            id: child.id,
            name: child.name,
            path: child.path,
            parentId,
          });
          await visit(child.id, path);
        }
      };
      await visit(null, `/organizations/${encodeURIComponent(orgId)}/groups`);
      return tree;
    });
  }

  /**
   * One lookup per key at a time, shared by every request that needs it. When
   * a refresh fails (the identity server restarting, a minor upgrade), the
   * last answer is served for up to {@link STALE_GRACE_MS} so signed-in people
   * keep working; past that the request fails rather than trust stale access.
   */
  private cached<T>(
    map: Map<string, Cached<T>>,
    key: string,
    load: () => Promise<T>,
  ): Promise<T> {
    const hit = map.get(key);
    if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.value);

    const flightKey = `${this.mapId(map)}|${key}`;
    const running = this.inflight.get(flightKey) as Promise<T> | undefined;
    if (running) return running;

    const flight = load()
      .then((value) => {
        map.set(key, { value, expiresAt: Date.now() + TTL_MS });
        if (map.size > MAX_ENTRIES) this.evictExpired(map);
        return value;
      })
      .catch((error: unknown) => {
        if (hit && Date.now() - hit.expiresAt < STALE_GRACE_MS) {
          this.logger.warn(
            `Identity server lookup failed; serving the last known answer: ${String(error)}`,
          );
          return hit.value;
        }
        throw error;
      })
      .finally(() => this.inflight.delete(flightKey));
    this.inflight.set(flightKey, flight);
    return flight;
  }

  private readonly inflight = new Map<string, Promise<unknown>>();
  private mapId(map: object): string {
    return map === this.users
      ? 'users'
      : map === this.memberGroups
        ? 'groups'
        : 'tree';
  }

  /** Drops entries past their grace period, so the caches cannot grow without bound. */
  private evictExpired<T>(map: Map<string, Cached<T>>): void {
    const cutoff = Date.now() - STALE_GRACE_MS;
    for (const [key, entry] of map) {
      if (entry.expiresAt < cutoff) map.delete(key);
    }
  }

  private async get<T>(path: string, allowMissing = false): Promise<T | null> {
    const response = await this.fetchImpl(`${this.config.adminUrl}${path}`, {
      headers: { Authorization: `Bearer ${await this.token()}` },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) {
      throw new Error(
        `Identity server lookup ${path} failed (${response.status})`,
      );
    }
    return (await response.json()) as T;
  }

  private async token(): Promise<string> {
    if (this.serviceToken && this.serviceToken.expiresAt > Date.now()) {
      return this.serviceToken.value;
    }
    const response = await this.fetchImpl(
      `${this.config.internalRealmUrl}/protocol/openid-connect/token`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.config.apiClientId,
          client_secret: this.config.apiClientSecret,
        }),
      },
    );
    if (!response.ok) {
      this.logger.error(`Service account sign-in failed (${response.status})`);
      throw new Error('The API cannot sign in to the identity server');
    }
    const body = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.serviceToken = {
      value: body.access_token,
      // Renew 30 s early so a lookup never goes out with a token about to lapse.
      expiresAt: Date.now() + Math.max(body.expires_in - 30, 10) * 1000,
    };
    return body.access_token;
  }
}
