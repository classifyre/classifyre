import { audienceOf } from './governance-notifier';

describe('governance notifications (GOV G-5)', () => {
  it('sends to people by name and to groups by id, not to the actor', () => {
    expect(
      audienceOf(
        ['user:ann', 'group:finance', 'user:bob', 'user:ann', 'mcp:t1'],
        'user:bob',
      ),
    ).toEqual({ personRefs: ['user:ann'], groupIds: ['finance'] });
  });

  it('is empty when the only one named is the actor', () => {
    expect(audienceOf(['user:ann'], 'user:ann')).toEqual({
      personRefs: [],
      groupIds: [],
    });
  });
});
