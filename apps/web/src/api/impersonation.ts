/**
 * Opening and closing the impersonation lens (ADR-0069).
 *
 * WHY opening it is a POST and not just "start sending the header": the header alone
 * would work — the server checks it on every request — but nothing would be *recorded*.
 * This call is what writes the history row and the subject's notification. Closing needs
 * no call at all: there is nothing to record about somebody stopping.
 */

import { apiPost, setImpersonation } from './client.ts';

export interface ImpersonationSubject {
  readonly personId: string;
  readonly displayName: string;
}

/**
 * Asks the server to open a lens, and only then starts sending the header.
 *
 * The order matters: setting the header first would mean the POST itself arrived under a
 * lens that had not been approved, and a refusal would leave every later request carrying
 * a header the server answers 403 to.
 */
export async function startImpersonation(personId: string): Promise<ImpersonationSubject> {
  const subject = await apiPost<ImpersonationSubject>('/api/auth/impersonate', { personId });
  setImpersonation(personId);
  return subject;
}

export function stopImpersonation(): void {
  setImpersonation(undefined);
}
