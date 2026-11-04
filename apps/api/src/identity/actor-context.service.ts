import { Injectable } from '@nestjs/common';
import { ClsService, ClsServiceManager } from 'nestjs-cls';
import { CLS_NAMESPACE_ID } from '../namespace/namespace.constants';
import { ANONYMOUS_ACTOR, type Actor } from './actor';

export const CLS_ACTOR = 'classifyre:actor';

/**
 * The actor of the current request or job (docs/prd/S1 R1). HTTP requests get
 * theirs from {@link AccessGuard}, the MCP handler from its token, background
 * work from {@link ActorContextService.runAs}.
 */
@Injectable()
export class ActorContextService {
  constructor(private readonly cls: ClsService) {}

  current(): Actor {
    if (!this.cls.isActive()) return ANONYMOUS_ACTOR;
    return this.cls.get<Actor | undefined>(CLS_ACTOR) ?? ANONYMOUS_ACTOR;
  }

  set(actor: Actor): void {
    if (this.cls.isActive()) this.cls.set(CLS_ACTOR, actor);
  }

  /** The workspace of the current request; undefined on registry routes. */
  workspaceId(): string | undefined {
    if (!this.cls.isActive()) return undefined;
    return this.cls.get<string | undefined>(CLS_NAMESPACE_ID);
  }

  /** Run `fn` as `actor`, inheriting the rest of the current CLS context. */
  runAs<T>(actor: Actor, fn: () => Promise<T>): Promise<T> {
    return this.cls.run({ ifNested: 'inherit' }, () => {
      this.cls.set(CLS_ACTOR, actor);
      return fn();
    });
  }
}

/**
 * The current actor, for code that has no injected
 * {@link ActorContextService} (MCP tool callbacks).
 */
export function currentActor(): Actor {
  const cls = ClsServiceManager.getClsService();
  if (!cls.isActive()) return ANONYMOUS_ACTOR;
  return cls.get<Actor | undefined>(CLS_ACTOR) ?? ANONYMOUS_ACTOR;
}

export function currentActorRef(): string | undefined {
  return currentActor().ref;
}
