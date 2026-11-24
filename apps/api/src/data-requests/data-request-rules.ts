import { CaseStatus, DataRequestState } from '@prisma/client';

export type DataRequestRole = 'requester' | 'team' | 'manager';

export type DataRequestAction =
  | 'submit'
  | 'withdraw'
  | 'claim'
  | 'reroute'
  | 'deliver'
  | 'deliver_self_serve'
  | 'request_changes'
  | 'decline';

/**
 * Derive `Case.status` from `DataRequest.state` so existing case lists,
 * filters, and counts keep working without special cases.
 */
export function caseStatusFor(state: DataRequestState): CaseStatus {
  switch (state) {
    case DataRequestState.DRAFT:
    case DataRequestState.SUBMITTED:
      return CaseStatus.OPEN;
    case DataRequestState.IN_PROGRESS:
    case DataRequestState.CHANGES_REQUESTED:
      return CaseStatus.IN_PROGRESS;
    case DataRequestState.DELIVERED:
    case DataRequestState.DECLINED:
    case DataRequestState.WITHDRAWN:
      return CaseStatus.CLOSED;
  }
}

export const OPEN_DATA_REQUEST_STATES: ReadonlySet<DataRequestState> = new Set([
  DataRequestState.DRAFT,
  DataRequestState.SUBMITTED,
  DataRequestState.IN_PROGRESS,
  DataRequestState.CHANGES_REQUESTED,
]);

export function isOpenRequestState(state: DataRequestState): boolean {
  return OPEN_DATA_REQUEST_STATES.has(state);
}

interface TransitionRule {
  from: readonly DataRequestState[];
  to: DataRequestState | 'KEEP';
  roles: readonly DataRequestRole[];
}

const TRANSITIONS: Record<DataRequestAction, TransitionRule> = {
  submit: {
    from: [DataRequestState.DRAFT],
    to: DataRequestState.SUBMITTED,
    roles: ['requester'],
  },
  withdraw: {
    from: [
      DataRequestState.DRAFT,
      DataRequestState.SUBMITTED,
      DataRequestState.IN_PROGRESS,
      DataRequestState.CHANGES_REQUESTED,
    ],
    to: DataRequestState.WITHDRAWN,
    roles: ['requester'],
  },
  claim: {
    from: [
      DataRequestState.SUBMITTED,
      DataRequestState.IN_PROGRESS,
      DataRequestState.CHANGES_REQUESTED,
    ],
    to: DataRequestState.IN_PROGRESS,
    roles: ['team', 'manager'],
  },
  reroute: {
    from: [
      DataRequestState.SUBMITTED,
      DataRequestState.IN_PROGRESS,
      DataRequestState.CHANGES_REQUESTED,
    ],
    to: 'KEEP',
    roles: ['team', 'manager'],
  },
  deliver: {
    from: [
      DataRequestState.SUBMITTED,
      DataRequestState.IN_PROGRESS,
      DataRequestState.CHANGES_REQUESTED,
    ],
    to: DataRequestState.DELIVERED,
    roles: ['team', 'manager'],
  },
  deliver_self_serve: {
    from: [
      DataRequestState.DRAFT,
      DataRequestState.SUBMITTED,
      DataRequestState.IN_PROGRESS,
      DataRequestState.CHANGES_REQUESTED,
    ],
    to: DataRequestState.DELIVERED,
    roles: ['requester'],
  },
  request_changes: {
    from: [DataRequestState.DELIVERED],
    to: DataRequestState.CHANGES_REQUESTED,
    roles: ['requester'],
  },
  decline: {
    from: [
      DataRequestState.SUBMITTED,
      DataRequestState.IN_PROGRESS,
      DataRequestState.CHANGES_REQUESTED,
    ],
    to: DataRequestState.DECLINED,
    roles: ['team', 'manager'],
  },
};

export interface TransitionResult {
  allowed: boolean;
  nextState?: DataRequestState;
  reason?: string;
}

/**
 * Pure state-transition check for a single role.
 */
export function transition(
  state: DataRequestState,
  action: DataRequestAction,
  role: DataRequestRole,
): TransitionResult {
  const rule = TRANSITIONS[action];
  if (!rule.roles.includes(role)) {
    return {
      allowed: false,
      reason: `Role "${role}" cannot perform "${action}".`,
    };
  }
  if (!rule.from.includes(state)) {
    return {
      allowed: false,
      reason: `Cannot perform "${action}" while the request is ${state}.`,
    };
  }
  return {
    allowed: true,
    nextState: rule.to === 'KEEP' ? state : rule.to,
  };
}

/**
 * Evaluate a transition across all roles a caller holds on the request.
 */
export function transitionForRoles(
  state: DataRequestState,
  action: DataRequestAction,
  roles: readonly DataRequestRole[],
): TransitionResult {
  const rule = TRANSITIONS[action];
  const hasRole = roles.some((role) => rule.roles.includes(role));
  if (!hasRole) {
    return {
      allowed: false,
      reason: `You do not have permission to perform "${action}" on this data request.`,
    };
  }
  if (!rule.from.includes(state)) {
    return {
      allowed: false,
      reason: `Cannot perform "${action}" while the request is ${state}.`,
    };
  }
  return {
    allowed: true,
    nextState: rule.to === 'KEEP' ? state : rule.to,
  };
}

/**
 * Requester may edit spec while DRAFT, SUBMITTED, or CHANGES_REQUESTED.
 * Team/manager may edit spec in any open state (drafts are invisible to non-requesters).
 */
export function canEditSpec(
  state: DataRequestState,
  roles: readonly DataRequestRole[],
): boolean {
  if (
    roles.includes('requester') &&
    (state === DataRequestState.DRAFT ||
      state === DataRequestState.SUBMITTED ||
      state === DataRequestState.CHANGES_REQUESTED)
  ) {
    return true;
  }
  if (
    (roles.includes('team') || roles.includes('manager')) &&
    isOpenRequestState(state)
  ) {
    return true;
  }
  return false;
}

/**
 * Team/manager may hand-edit or regenerate SQL in any open state.
 */
export function canEditSql(
  state: DataRequestState,
  roles: readonly DataRequestRole[],
): boolean {
  return (
    (roles.includes('team') || roles.includes('manager')) &&
    isOpenRequestState(state)
  );
}

/** Actions currently allowed for the given state and caller roles. */
export function allowedActionsFor(
  state: DataRequestState,
  roles: readonly DataRequestRole[],
): DataRequestAction[] {
  const actions: DataRequestAction[] = [];
  for (const action of Object.keys(TRANSITIONS) as DataRequestAction[]) {
    if (transitionForRoles(state, action, roles).allowed) {
      actions.push(action);
    }
  }
  return actions;
}
