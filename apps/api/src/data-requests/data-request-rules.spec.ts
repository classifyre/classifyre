import { CaseStatus, DataRequestState } from '@prisma/client';
import {
  allowedActionsFor,
  canEditSpec,
  canEditSql,
  caseStatusFor,
  isOpenRequestState,
  transition,
  transitionForRoles,
  type DataRequestAction,
  type DataRequestRole,
} from './data-request-rules';

const ALL_STATES = Object.values(DataRequestState);
const ALL_ROLES: DataRequestRole[] = ['requester', 'team', 'manager'];

describe('data-request-rules', () => {
  describe('caseStatusFor', () => {
    it.each<[DataRequestState, CaseStatus]>([
      [DataRequestState.DRAFT, CaseStatus.OPEN],
      [DataRequestState.SUBMITTED, CaseStatus.OPEN],
      [DataRequestState.IN_PROGRESS, CaseStatus.IN_PROGRESS],
      [DataRequestState.CHANGES_REQUESTED, CaseStatus.IN_PROGRESS],
      [DataRequestState.DELIVERED, CaseStatus.CLOSED],
      [DataRequestState.DECLINED, CaseStatus.CLOSED],
      [DataRequestState.WITHDRAWN, CaseStatus.CLOSED],
    ])('maps %s to CaseStatus.%s', (state, expected) => {
      expect(caseStatusFor(state)).toBe(expected);
    });

    it('marks open vs closed request states consistently', () => {
      expect(isOpenRequestState(DataRequestState.DRAFT)).toBe(true);
      expect(isOpenRequestState(DataRequestState.SUBMITTED)).toBe(true);
      expect(isOpenRequestState(DataRequestState.IN_PROGRESS)).toBe(true);
      expect(isOpenRequestState(DataRequestState.CHANGES_REQUESTED)).toBe(true);
      expect(isOpenRequestState(DataRequestState.DELIVERED)).toBe(false);
      expect(isOpenRequestState(DataRequestState.DECLINED)).toBe(false);
      expect(isOpenRequestState(DataRequestState.WITHDRAWN)).toBe(false);
    });
  });

  describe('transition', () => {
    it('allows requester transitions in the right states', () => {
      expect(
        transition(DataRequestState.DRAFT, 'submit', 'requester'),
      ).toEqual({ allowed: true, nextState: DataRequestState.SUBMITTED });
      expect(
        transition(DataRequestState.SUBMITTED, 'submit', 'requester').allowed,
      ).toBe(false);

      for (const open of [
        DataRequestState.DRAFT,
        DataRequestState.SUBMITTED,
        DataRequestState.IN_PROGRESS,
        DataRequestState.CHANGES_REQUESTED,
      ]) {
        expect(transition(open, 'withdraw', 'requester')).toEqual({
          allowed: true,
          nextState: DataRequestState.WITHDRAWN,
        });
        expect(transition(open, 'deliver_self_serve', 'requester')).toEqual({
          allowed: true,
          nextState: DataRequestState.DELIVERED,
        });
      }

      expect(
        transition(DataRequestState.DELIVERED, 'request_changes', 'requester'),
      ).toEqual({
        allowed: true,
        nextState: DataRequestState.CHANGES_REQUESTED,
      });
      expect(
        transition(DataRequestState.IN_PROGRESS, 'request_changes', 'requester')
          .allowed,
      ).toBe(false);
    });

    it('forbids requester from team/manager actions', () => {
      const teamOnly: DataRequestAction[] = [
        'claim',
        'reroute',
        'deliver',
        'decline',
      ];
      for (const action of teamOnly) {
        for (const state of ALL_STATES) {
          const res = transition(state, action, 'requester');
          expect(res.allowed).toBe(false);
          expect(res.reason).toContain('requester');
        }
      }
    });

    it('allows team and manager transitions on active submitted requests and keeps state on reroute', () => {
      const activeStates = [
        DataRequestState.SUBMITTED,
        DataRequestState.IN_PROGRESS,
        DataRequestState.CHANGES_REQUESTED,
      ];
      for (const role of ['team', 'manager'] as const) {
        for (const state of activeStates) {
          expect(transition(state, 'claim', role)).toEqual({
            allowed: true,
            nextState: DataRequestState.IN_PROGRESS,
          });
          expect(transition(state, 'reroute', role)).toEqual({
            allowed: true,
            nextState: state,
          });
          expect(transition(state, 'deliver', role)).toEqual({
            allowed: true,
            nextState: DataRequestState.DELIVERED,
          });
          expect(transition(state, 'decline', role)).toEqual({
            allowed: true,
            nextState: DataRequestState.DECLINED,
          });
        }
        // Cannot claim/deliver/decline/reroute a DRAFT or terminal state
        for (const blocked of [
          DataRequestState.DRAFT,
          DataRequestState.DELIVERED,
          DataRequestState.DECLINED,
          DataRequestState.WITHDRAWN,
        ]) {
          expect(transition(blocked, 'claim', role).allowed).toBe(false);
          expect(transition(blocked, 'reroute', role).allowed).toBe(false);
          expect(transition(blocked, 'deliver', role).allowed).toBe(false);
          expect(transition(blocked, 'decline', role).allowed).toBe(false);
        }
        // Cannot submit/withdraw/request_changes/deliver_self_serve
        expect(
          transition(DataRequestState.DRAFT, 'submit', role).allowed,
        ).toBe(false);
        expect(
          transition(DataRequestState.SUBMITTED, 'withdraw', role).allowed,
        ).toBe(false);
        expect(
          transition(DataRequestState.DELIVERED, 'request_changes', role)
            .allowed,
        ).toBe(false);
      }
    });

    it('allows no transitions out of DECLINED or WITHDRAWN for any role', () => {
      const allActions: DataRequestAction[] = [
        'submit',
        'withdraw',
        'claim',
        'reroute',
        'deliver',
        'deliver_self_serve',
        'request_changes',
        'decline',
      ];
      for (const terminal of [
        DataRequestState.DECLINED,
        DataRequestState.WITHDRAWN,
      ]) {
        for (const role of ALL_ROLES) {
          for (const action of allActions) {
            expect(transition(terminal, action, role).allowed).toBe(false);
          }
        }
      }
    });
  });

  describe('transitionForRoles', () => {
    it('permits an action if any held role satisfies the rule', () => {
      expect(
        transitionForRoles(DataRequestState.SUBMITTED, 'claim', [
          'requester',
          'team',
        ]),
      ).toEqual({ allowed: true, nextState: DataRequestState.IN_PROGRESS });
      expect(
        transitionForRoles(DataRequestState.DRAFT, 'submit', [
          'requester',
          'manager',
        ]),
      ).toEqual({ allowed: true, nextState: DataRequestState.SUBMITTED });
    });

    it('denies when roles list is empty or lacks permission', () => {
      const noRoles = transitionForRoles(
        DataRequestState.DRAFT,
        'submit',
        [],
      );
      expect(noRoles.allowed).toBe(false);
      expect(noRoles.reason).toContain('permission');

      const wrongState = transitionForRoles(
        DataRequestState.DELIVERED,
        'claim',
        ['team'],
      );
      expect(wrongState.allowed).toBe(false);
      expect(wrongState.reason).toContain('DELIVERED');
    });
  });

  describe('canEditSpec & canEditSql', () => {
    it('lets requester edit spec only in DRAFT, SUBMITTED, and CHANGES_REQUESTED', () => {
      expect(canEditSpec(DataRequestState.DRAFT, ['requester'])).toBe(true);
      expect(canEditSpec(DataRequestState.SUBMITTED, ['requester'])).toBe(true);
      expect(canEditSpec(DataRequestState.IN_PROGRESS, ['requester'])).toBe(
        false,
      );
      expect(
        canEditSpec(DataRequestState.CHANGES_REQUESTED, ['requester']),
      ).toBe(true);
      expect(canEditSpec(DataRequestState.DELIVERED, ['requester'])).toBe(
        false,
      );
      expect(canEditSpec(DataRequestState.DECLINED, ['requester'])).toBe(false);
      expect(canEditSpec(DataRequestState.WITHDRAWN, ['requester'])).toBe(
        false,
      );
    });

    it('lets team and manager edit spec in any open state and never in closed states', () => {
      for (const role of ['team', 'manager'] as const) {
        expect(canEditSpec(DataRequestState.DRAFT, [role])).toBe(true);
        expect(canEditSpec(DataRequestState.SUBMITTED, [role])).toBe(true);
        expect(canEditSpec(DataRequestState.IN_PROGRESS, [role])).toBe(true);
        expect(canEditSpec(DataRequestState.CHANGES_REQUESTED, [role])).toBe(
          true,
        );
        expect(canEditSpec(DataRequestState.DELIVERED, [role])).toBe(false);
        expect(canEditSpec(DataRequestState.DECLINED, [role])).toBe(false);
        expect(canEditSpec(DataRequestState.WITHDRAWN, [role])).toBe(false);
      }
      expect(canEditSpec(DataRequestState.DRAFT, [])).toBe(false);
    });

    it('lets only team and manager edit SQL, and only in open states', () => {
      for (const state of ALL_STATES) {
        expect(canEditSql(state, ['requester'])).toBe(false);
        expect(canEditSql(state, [])).toBe(false);
      }
      for (const role of ['team', 'manager'] as const) {
        expect(canEditSql(DataRequestState.DRAFT, [role])).toBe(true);
        expect(canEditSql(DataRequestState.SUBMITTED, [role])).toBe(true);
        expect(canEditSql(DataRequestState.IN_PROGRESS, [role])).toBe(true);
        expect(canEditSql(DataRequestState.CHANGES_REQUESTED, [role])).toBe(
          true,
        );
        expect(canEditSql(DataRequestState.DELIVERED, [role])).toBe(false);
        expect(canEditSql(DataRequestState.DECLINED, [role])).toBe(false);
        expect(canEditSql(DataRequestState.WITHDRAWN, [role])).toBe(false);
      }
    });
  });

  describe('allowedActionsFor', () => {
    it('returns the exact allowed actions for each role and state', () => {
      expect(allowedActionsFor(DataRequestState.DRAFT, ['requester'])).toEqual([
        'submit',
        'withdraw',
        'deliver_self_serve',
      ]);
      expect(allowedActionsFor(DataRequestState.DRAFT, ['team'])).toEqual([]);
      expect(
        allowedActionsFor(DataRequestState.SUBMITTED, ['requester']),
      ).toEqual(['withdraw', 'deliver_self_serve']);
      expect(allowedActionsFor(DataRequestState.SUBMITTED, ['team'])).toEqual([
        'claim',
        'reroute',
        'deliver',
        'decline',
      ]);
      expect(
        allowedActionsFor(DataRequestState.IN_PROGRESS, ['manager']),
      ).toEqual(['claim', 'reroute', 'deliver', 'decline']);
      expect(
        allowedActionsFor(DataRequestState.DELIVERED, ['requester']),
      ).toEqual(['request_changes']);
      expect(allowedActionsFor(DataRequestState.DELIVERED, ['team'])).toEqual(
        [],
      );
      expect(
        allowedActionsFor(DataRequestState.CHANGES_REQUESTED, [
          'requester',
          'team',
        ]),
      ).toEqual([
        'withdraw',
        'claim',
        'reroute',
        'deliver',
        'deliver_self_serve',
        'decline',
      ]);
      expect(
        allowedActionsFor(DataRequestState.DECLINED, [
          'requester',
          'team',
          'manager',
        ]),
      ).toEqual([]);
      expect(
        allowedActionsFor(DataRequestState.WITHDRAWN, [
          'requester',
          'team',
          'manager',
        ]),
      ).toEqual([]);
    });
  });
});
