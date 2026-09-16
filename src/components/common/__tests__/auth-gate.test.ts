/**
 * Where each role lands.
 *
 * `homeRouteForRole` is navigation, not authorisation — every table behind
 * these routes is independently guarded by RLS, and Phase 13 proved that
 * separately. What a wrong answer here costs is not a data leak but a dead end:
 * an operator dropped on the passenger home has no way to reach their console,
 * and a driver sent to `/(operator)/dashboard` is bounced straight back by the
 * gate on that group, which is an infinite redirect rather than a screen.
 *
 * The `default` arm is the one worth pinning. It catches `undefined`, which is
 * the real case — `role` is undefined for the whole window between a session
 * being restored and the profile query resolving. Sending that to the passenger
 * home is the safe answer precisely because it is the least privileged
 * destination: a passenger who is really an admin sees a home screen for a
 * moment, whereas the opposite mistake would flash a console.
 */

import { homeRouteForRole } from '@/components/common/auth-gate';
import { UserRole } from '@/constants/enums';

describe('homeRouteForRole', () => {
  it.each([
    [UserRole.USER, '/(user)/home'],
    [UserRole.OPERATOR, '/(operator)/dashboard'],
    [UserRole.DRIVER, '/(driver)/duty'],
    [UserRole.ASSISTANT, '/(driver)/duty'],
    [UserRole.ADMIN, '/(admin)/overview'],
  ])('sends %s to %s', (role, expected) => {
    expect(homeRouteForRole(role)).toBe(expected);
  });

  it('sends an unknown or not-yet-loaded role to the least privileged home', () => {
    expect(homeRouteForRole(undefined)).toBe('/(user)/home');
    expect(homeRouteForRole('SUPERUSER' as unknown as UserRole)).toBe('/(user)/home');
  });

  it('crew share a console; nobody else does', () => {
    // Drivers and assistants are both crew and both belong in `(driver)`.
    // Everyone else gets somewhere of their own — if two roles ever collide
    // here it means a group was renamed and only one arm was updated.
    const destinations = [
      UserRole.USER,
      UserRole.OPERATOR,
      UserRole.DRIVER,
      UserRole.ASSISTANT,
      UserRole.ADMIN,
    ].map(homeRouteForRole);

    expect(homeRouteForRole(UserRole.DRIVER)).toBe(homeRouteForRole(UserRole.ASSISTANT));
    expect(new Set(destinations).size).toBe(4);
  });

  it('never sends anybody to a route group they cannot be in', () => {
    // The gate on each group allows a fixed set of roles. A home route outside
    // the caller's own group is an immediate redirect back, which loops.
    const groupOf = (href: string) => href.match(/^\/\(([^)]+)\)/)?.[1];

    expect(groupOf(String(homeRouteForRole(UserRole.OPERATOR)))).toBe('operator');
    expect(groupOf(String(homeRouteForRole(UserRole.ADMIN)))).toBe('admin');
    expect(groupOf(String(homeRouteForRole(UserRole.DRIVER)))).toBe('driver');
    expect(groupOf(String(homeRouteForRole(UserRole.ASSISTANT)))).toBe('driver');
    expect(groupOf(String(homeRouteForRole(UserRole.USER)))).toBe('user');
  });
});
