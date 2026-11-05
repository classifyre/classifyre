import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { IdentityService, Principal } from './identity.service';
import { IDENTITY } from './identity.tokens';
import type { MembershipService, OrgGroup } from './membership.service';
import { TenancyService } from './tenancy.service';

/** Ids the identity server hands out; anything else never reaches a URL. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADMINS = 'admins';

export interface PersonView {
  id: string;
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  enabled: boolean;
  fromDirectory: boolean;
  /** Classifyre made this account, so it may set its password and delete it. */
  createdHere: boolean;
  /** Groups the person is directly in. */
  groupIds: string[];
  isYou: boolean;
}

/**
 * The tenant's people and groups, managed from Classifyre
 * (docs/prd/IAM-access-management.md, step 8c). The identity server's admin
 * rights this needs are realm-wide, so this is where the tenant boundary is
 * kept: every group and person a request names is checked against the
 * caller's own organization before anything is sent, and the organization
 * always comes from the signed-in principal.
 */
@Injectable()
export class PeopleService {
  constructor(
    @Inject(IDENTITY) private readonly identity: IdentityService | null,
    private readonly tenancy: TenancyService,
  ) {}

  // ---- reads ---------------------------------------------------------------

  async people(principal: Principal): Promise<PersonView[]> {
    const directory = this.directory();
    const [members, groups, created] = await Promise.all([
      directory.members(principal.orgId),
      directory.groups(principal.orgId, { fresh: true }),
      this.tenancy.createdPeople(principal.tenant.id),
    ]);
    const groupsOf = new Map<string, string[]>();
    await Promise.all(
      groups.map(async (group) => {
        for (const id of await directory.groupMemberIds(
          principal.orgId,
          group.id,
        )) {
          groupsOf.set(id, [...(groupsOf.get(id) ?? []), group.id]);
        }
      }),
    );
    return members
      .map((member) => ({
        ...member,
        createdHere: created.has(member.id),
        groupIds: groupsOf.get(member.id) ?? [],
        isYou: member.id === principal.sub,
      }))
      .sort((a, b) =>
        (a.email ?? a.username).localeCompare(b.email ?? b.username),
      );
  }

  // ---- people --------------------------------------------------------------

  /**
   * Adds a person by email: a new account with a temporary password, or an
   * existing account that is in no tenant. An account in another tenant is
   * refused exactly like an address that cannot be used, so this never tells
   * one tenant about another's people, and never puts someone in two tenants.
   */
  async addPerson(
    principal: Principal,
    input: { email?: unknown; firstName?: unknown; lastName?: unknown },
  ): Promise<{ person: PersonView; temporaryPassword: string | null }> {
    const directory = this.writable();
    const email = text(input.email, 'email', 254).toLowerCase();
    if (!EMAIL.test(email)) {
      throw new BadRequestException('Enter a valid email address.');
    }
    const firstName = text(input.firstName, 'first name', 100);
    const lastName = text(input.lastName, 'last name', 100);
    const org = principal.orgId;

    const existing = (
      (await directory.read<{ id: string; email?: string }[]>(
        `/users?email=${encodeURIComponent(email)}&exact=true&max=2`,
      )) ?? []
    ).filter((user) => user.email?.toLowerCase() === email);

    let id: string;
    let temporaryPassword: string | null = null;
    if (existing.length === 1) {
      id = existing[0].id;
      const orgs = await this.organizationsOf(id);
      if (orgs.includes(org)) {
        throw new ConflictException('This person is already in the tenant.');
      }
      if (orgs.length > 0) throw unavailable();
      this.expect(
        await directory.send('POST', `/organizations/${org}/members`, id),
        'add the person to the tenant',
        [201, 204],
      );
    } else if (existing.length > 1) {
      throw unavailable();
    } else {
      const created = await directory.send('POST', '/users', {
        username: email,
        email,
        firstName,
        lastName,
        enabled: true,
        emailVerified: false,
        requiredActions: ['UPDATE_PASSWORD'],
      });
      if (created.status === 409) throw unavailable();
      this.expect(created, 'create the account', [201]);
      id = idFromLocation(created);
      try {
        temporaryPassword = newTemporaryPassword();
        await this.setTemporaryPassword(id, temporaryPassword);
        this.expect(
          await directory.send('POST', `/organizations/${org}/members`, id),
          'add the person to the tenant',
          [201, 204],
        );
      } catch (error) {
        // Never leave an account behind that belongs to no tenant.
        await directory.send('DELETE', `/users/${id}`).catch(() => undefined);
        throw error;
      }
      await this.tenancy.rememberCreatedPerson(
        id,
        principal.tenant.id,
        principal.actor.ref,
      );
    }

    directory.forget(org, [id]);
    await this.event(principal, 'person.added', {
      userId: id,
      email,
      created: temporaryPassword !== null,
    });
    const person = (await this.people(principal)).find((p) => p.id === id);
    if (!person)
      throw new BadGatewayException(
        'The person was added but cannot be read back.',
      );
    return { person, temporaryPassword };
  }

  /**
   * Removes a person from the tenant, its groups and their personal grants.
   * Their account is deleted only if Classifyre made it for this tenant and
   * it is in no other tenant now.
   */
  async removePerson(
    principal: Principal,
    userId: string,
  ): Promise<{ accountDeleted: boolean }> {
    const directory = this.writable();
    const org = principal.orgId;
    await this.requireMember(principal, userId);
    if (userId === principal.sub) {
      throw new ForbiddenException(
        'You cannot remove yourself from the tenant.',
      );
    }
    const groups = await directory.groups(org, { fresh: true });
    const admins = adminsGroup(groups);
    if (admins) await this.keepAnAdmin(principal, admins, userId);

    for (const group of groups) {
      const members = await directory.groupMemberIds(org, group.id);
      if (members.includes(userId)) {
        this.expect(
          await directory.send(
            'DELETE',
            `/organizations/${org}/groups/${group.id}/members/${userId}`,
          ),
          'remove the person from a group',
          [204, 404],
        );
      }
    }
    this.expect(
      await directory.send('DELETE', `/organizations/${org}/members/${userId}`),
      'remove the person from the tenant',
      [204, 404],
    );
    const grants = await this.tenancy.deletePersonGrants(
      principal.tenant.id,
      userId,
    );

    let accountDeleted = false;
    if (await this.tenancy.createdHere(userId, principal.tenant.id)) {
      await this.tenancy.forgetCreatedPerson(userId, principal.tenant.id);
      if ((await this.organizationsOf(userId)).length === 0) {
        this.expect(
          await directory.send('DELETE', `/users/${userId}`),
          'delete the account',
          [204, 404],
        );
        accountDeleted = true;
      }
    }
    directory.forget(org, [userId]);
    await this.event(principal, 'person.removed', {
      userId,
      accountDeleted,
      grantsRemoved: grants,
    });
    return { accountDeleted };
  }

  /** A new temporary password, for accounts Classifyre made for this tenant. */
  async resetPassword(
    principal: Principal,
    userId: string,
  ): Promise<{ temporaryPassword: string }> {
    this.writable();
    await this.requireMember(principal, userId);
    if (userId === principal.sub) {
      throw new ForbiddenException(
        'Change your own password in your account settings.',
      );
    }
    if (!(await this.tenancy.createdHere(userId, principal.tenant.id))) {
      throw new ForbiddenException(
        'This account was not created in Classifyre; its password is managed where it comes from.',
      );
    }
    const temporaryPassword = newTemporaryPassword();
    await this.setTemporaryPassword(userId, temporaryPassword);
    await this.event(principal, 'person.password_reset', { userId });
    return { temporaryPassword };
  }

  // ---- groups --------------------------------------------------------------

  async createGroup(
    principal: Principal,
    input: { name?: unknown; parentId?: unknown },
  ): Promise<OrgGroup> {
    const directory = this.writable();
    const org = principal.orgId;
    const name = groupName(input.name);
    const parentId =
      typeof input.parentId === 'string' && input.parentId !== ''
        ? input.parentId
        : null;
    if (parentId) await this.requireGroup(principal, parentId);
    const response = await directory.send(
      'POST',
      parentId
        ? `/organizations/${org}/groups/${parentId}/children`
        : `/organizations/${org}/groups`,
      { name },
    );
    if (response.status === 409) {
      throw new ConflictException(
        'A group with that name already exists there.',
      );
    }
    this.expect(response, 'create the group', [201]);
    directory.forget(org);
    const group = (await directory.groups(org, { fresh: true })).find(
      (candidate) => candidate.name === name && candidate.parentId === parentId,
    );
    if (!group)
      throw new BadGatewayException(
        'The group was created but cannot be read back.',
      );
    await this.event(principal, 'group.created', {
      groupId: group.id,
      path: group.path,
    });
    return group;
  }

  async renameGroup(
    principal: Principal,
    groupId: string,
    input: { name?: unknown },
  ): Promise<OrgGroup> {
    const directory = this.writable();
    const org = principal.orgId;
    const group = await this.requireGroup(principal, groupId);
    if (isAdmins(group)) {
      throw new ForbiddenException(
        'The admins group keeps its name: it is how every tenant finds its first admins.',
      );
    }
    const name = groupName(input.name);
    const response = await directory.send(
      'PUT',
      `/organizations/${org}/groups/${groupId}`,
      { name },
    );
    if (response.status === 409) {
      throw new ConflictException(
        'A group with that name already exists there.',
      );
    }
    this.expect(response, 'rename the group', [204]);
    directory.forget(org);
    const renamed = (await directory.groups(org, { fresh: true })).find(
      (candidate) => candidate.id === groupId,
    );
    await this.event(principal, 'group.renamed', {
      groupId,
      from: group.path,
      to: renamed?.path ?? name,
    });
    return renamed ?? { ...group, name };
  }

  /**
   * Deletes a group and every group below it, with the grants given to them
   * or on their workspaces. A group that owns workspaces is kept: its
   * workspaces would belong to nobody.
   */
  async deleteGroup(principal: Principal, groupId: string): Promise<void> {
    const directory = this.writable();
    const org = principal.orgId;
    const groups = await directory.groups(org, { fresh: true });
    const group = groups.find((candidate) => candidate.id === groupId);
    if (!group || !ID.test(groupId)) throw groupNotFound();
    if (isAdmins(group)) {
      throw new ForbiddenException('The admins group cannot be deleted.');
    }
    const subtree = descendants(groups, groupId);
    const owned = [
      ...(await this.tenancy.workspacesOf(principal.tenant.id)).values(),
    ].filter((ws) => ws.ownerGroupId && subtree.includes(ws.ownerGroupId));
    if (owned.length > 0) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'GROUP_OWNS_WORKSPACES',
        message: `This group (or one below it) owns ${owned.length} workspace(s). Delete them first or give them to another group.`,
      });
    }
    this.expect(
      await directory.send('DELETE', `/organizations/${org}/groups/${groupId}`),
      'delete the group',
      [204, 404],
    );
    const grants = await this.tenancy.deleteGroupGrants(
      principal.tenant.id,
      subtree,
    );
    directory.forget(org);
    await this.event(principal, 'group.deleted', {
      groupId,
      path: group.path,
      groupsDeleted: subtree.length,
      grantsRemoved: grants,
    });
  }

  async addToGroup(
    principal: Principal,
    groupId: string,
    userId: string,
  ): Promise<void> {
    const directory = this.writable();
    const group = await this.requireGroup(principal, groupId);
    await this.requireMember(principal, userId);
    this.expect(
      await directory.send(
        'PUT',
        `/organizations/${principal.orgId}/groups/${groupId}/members/${userId}`,
        {},
      ),
      'add the person to the group',
      [204],
    );
    directory.forget(principal.orgId, [userId]);
    await this.event(principal, 'group.member_added', {
      groupId,
      path: group.path,
      userId,
    });
  }

  async removeFromGroup(
    principal: Principal,
    groupId: string,
    userId: string,
  ): Promise<void> {
    const directory = this.writable();
    const group = await this.requireGroup(principal, groupId);
    await this.requireMember(principal, userId);
    if (isAdmins(group)) await this.keepAnAdmin(principal, group, userId);
    this.expect(
      await directory.send(
        'DELETE',
        `/organizations/${principal.orgId}/groups/${groupId}/members/${userId}`,
      ),
      'remove the person from the group',
      [204, 404],
    );
    directory.forget(principal.orgId, [userId]);
    await this.event(principal, 'group.member_removed', {
      groupId,
      path: group.path,
      userId,
    });
  }

  // ---- checks --------------------------------------------------------------

  private directory(): MembershipService {
    if (!this.identity) {
      throw new ConflictException(
        'Sign-in is off: there are no tenants, people or groups to manage.',
      );
    }
    return this.identity.membership;
  }

  /** Writes need the chart's people management on (and its rights). */
  private writable(): MembershipService {
    const directory = this.directory();
    if (!this.identity!.config.peopleManagement) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'PEOPLE_MANAGED_ELSEWHERE',
        message:
          'People and groups are managed in your company directory or the identity server on this installation.',
      });
    }
    return directory;
  }

  /** The group, if it is one of the caller's organization; 404 otherwise. */
  private async requireGroup(
    principal: Principal,
    groupId: string,
  ): Promise<OrgGroup> {
    if (!ID.test(groupId)) throw groupNotFound();
    const group = (
      await this.directory().groups(principal.orgId, { fresh: true })
    ).find((candidate) => candidate.id === groupId);
    if (!group) throw groupNotFound();
    return group;
  }

  /** The person must be in the caller's organization; 404 otherwise. */
  private async requireMember(
    principal: Principal,
    userId: string,
  ): Promise<void> {
    if (
      !ID.test(userId) ||
      !(await this.organizationsOf(userId)).includes(principal.orgId)
    ) {
      throw new NotFoundException('No such person in this tenant.');
    }
  }

  /** The organizations an account is in, read fresh. */
  private async organizationsOf(userId: string): Promise<string[]> {
    const orgs =
      (await this.directory().read<{ id: string }[]>(
        `/organizations/members/${userId}/organizations`,
      )) ?? [];
    return orgs.map((org) => org.id);
  }

  /** Nobody removes themselves from admins, and admins never ends up empty. */
  private async keepAnAdmin(
    principal: Principal,
    admins: OrgGroup,
    userId: string,
  ): Promise<void> {
    const members = await this.directory().groupMemberIds(
      principal.orgId,
      admins.id,
    );
    if (!members.includes(userId)) return;
    if (userId === principal.sub) {
      throw new ForbiddenException(
        'You cannot remove yourself from admins. Another tenant admin can.',
      );
    }
    if (members.length <= 1) {
      throw new ForbiddenException('The tenant needs at least one admin.');
    }
  }

  private async setTemporaryPassword(id: string, value: string): Promise<void> {
    this.expect(
      await this.directory().send('PUT', `/users/${id}/reset-password`, {
        type: 'password',
        value,
        temporary: true,
      }),
      'set the temporary password',
      [204],
    );
  }

  private expect(response: Response, what: string, ok: number[]): void {
    if (ok.includes(response.status)) return;
    if (response.status === 403) {
      throw new BadGatewayException(
        `Classifyre may not ${what} in the identity server: its service account lacks the rights (iam.peopleManagement).`,
      );
    }
    throw new BadGatewayException(
      `The identity server could not ${what} (${response.status}).`,
    );
  }

  private event(
    principal: Principal,
    action: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    return this.tenancy.recordTenantEvent(
      principal.tenant.id,
      principal.actor.ref,
      action,
      detail,
    );
  }
}

function unavailable(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code: 'PERSON_UNAVAILABLE',
    message:
      'This address cannot be added here. If the person should be in this tenant, ask an operator.',
  });
}

function groupNotFound(): NotFoundException {
  return new NotFoundException('No such group in this tenant.');
}

function text(value: unknown, label: string, max: number): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) throw new BadRequestException(`Enter a ${label}.`);
  if (trimmed.length > max) {
    throw new BadRequestException(`The ${label} is too long.`);
  }
  return trimmed;
}

function groupName(value: unknown): string {
  const name = text(value, 'group name', 60);
  if (name.includes('/')) {
    throw new BadRequestException('A group name cannot contain "/".');
  }
  return name;
}

function adminsGroup(groups: OrgGroup[]): OrgGroup | undefined {
  return groups.find(isAdmins);
}

function isAdmins(group: OrgGroup): boolean {
  return group.parentId === null && group.name === ADMINS;
}

/** The group and every group below it. */
export function descendants(groups: OrgGroup[], rootId: string): string[] {
  const out = [rootId];
  for (let i = 0; i < out.length; i += 1) {
    for (const group of groups) {
      if (group.parentId === out[i] && !out.includes(group.id)) {
        out.push(group.id);
      }
    }
  }
  return out;
}

function idFromLocation(response: Response): string {
  const id = response.headers.get('location')?.split('/').pop() ?? '';
  if (!ID.test(id)) {
    throw new BadGatewayException(
      'The identity server did not say which account it created.',
    );
  }
  return id;
}

/** 20 random URL-safe characters; changed by the person at first sign-in. */
function newTemporaryPassword(): string {
  return randomBytes(15).toString('base64url');
}
