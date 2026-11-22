import { passwordProblem, type PasswordProblem } from '@/demo/passwords';

/**
 * Change password in Account → Profile → Security (spec 01 "Change password"): pure checks and the mapping of
 * Firebase outcomes, unit-tested without the SDK. The new password follows the sign-up rules (`passwordProblem`).
 */
export type ChangeInvalid = PasswordProblem | 'current' | 'same' | 'confirm';

export function validatePasswordChange(
  input: { current: string; next: string; confirm: string },
  context: { phone?: string; email?: string; name?: string },
): ChangeInvalid | null {
  if (input.current === '') return 'current';
  const problem = passwordProblem(input.next, context);
  if (problem) return problem;
  if (input.next === input.current) return 'same';
  if (input.next !== input.confirm) return 'confirm';
  return null;
}

export type ChangeFail = 'wrong_current' | 'weak' | 'rate' | 'recent' | 'network' | 'unavailable';

/** Why re-authenticating or updating the password failed, from the Firebase error code. */
export function changeFailFor(code: string | undefined): ChangeFail {
  switch (code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'wrong_current';
    case 'auth/weak-password':
      return 'weak';
    case 'auth/too-many-requests':
      return 'rate';
    case 'auth/requires-recent-login':
      return 'recent';
    case 'auth/network-request-failed':
      return 'network';
    default:
      return 'unavailable';
  }
}
