import { ClsServiceManager } from 'nestjs-cls';
import { CLS_PERSON, type ClsPerson } from '../identity/iam-access-policy';
import type { GovernancePerson } from './governance-rules';

/** The signed-in person of the current request, for code without an injected ClsService. */
export function clsPerson(): GovernancePerson | null {
  const cls = ClsServiceManager.getClsService();
  if (!cls.isActive()) return null;
  const person = cls.get<ClsPerson | undefined>(CLS_PERSON);
  return person
    ? { actorRef: person.actorRef, groupIds: person.groupIds }
    : null;
}
