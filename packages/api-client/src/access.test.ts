import { describe, expect, it } from 'vitest';

import { ADMIN_ROLE, hasRealmRole } from './access';

function token(payload: unknown): string {
  return `header.${btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.signature`;
}

describe('role hints for navigation', () => {
  it('recognises only the exact realm role', () => {
    expect(hasRealmRole(token({ realm_access: { roles: [ADMIN_ROLE] } }), ADMIN_ROLE)).toBe(true);
    expect(hasRealmRole(token({ realm_access: { roles: ['user', 'admin'] } }), ADMIN_ROLE)).toBe(false);
    expect(hasRealmRole(token({ resource_access: { app: { roles: [ADMIN_ROLE] } } }), ADMIN_ROLE)).toBe(
      false,
    );
  });

  it('fails closed for missing, malformed and unexpected claims', () => {
    for (const value of [
      null,
      undefined,
      '',
      'bad',
      'a.!.b',
      token(null),
      token({ realm_access: null }),
      token({ realm_access: { roles: ADMIN_ROLE } }),
      token({ realm_access: { roles: [null, 1, {}] } }),
    ]) {
      expect(hasRealmRole(value, ADMIN_ROLE)).toBe(false);
    }
  });
});
