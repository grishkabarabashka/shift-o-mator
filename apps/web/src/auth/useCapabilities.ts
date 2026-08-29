/**
 * What the signed-in person may do, on the row they are looking at.
 *
 * WHY every question takes a unit: roles are granted per planning unit (ADR-0051).
 * "Can I plan" has no answer on its own — planning AMER says nothing about EMEA. The
 * previous version answered globally and compared roles by rank, so an Admin was
 * silently a planner everywhere.
 *
 * WHY it exists at all: before it, nothing gated the UI by role. A Viewer saw the full
 * editing surface — palette, right-click picker, range painting — and the first edit
 * called `POST /api/drafts`, got a 403, and the rejection went nowhere. The user clicked
 * and nothing happened, which is precisely the failure ADR-0023 exists to prevent.
 */

import { useMemo } from 'react';
import { hasRole, hasRoleAnywhere, useAuth } from './AuthProvider.tsx';
import type { PersonId } from '../domain/types.ts';

export interface Capabilities {
  /** Assign shifts, paint ranges, open and publish drafts, in this unit. */
  readonly canPlan: (unitId: string | undefined) => boolean;
  /** Decide requests raised by people in this unit. */
  readonly canApprove: (unitId: string | undefined) => boolean;
  /** Edit this unit's configuration. */
  readonly canAdminister: (unitId: string | undefined) => boolean;
  /** Edit configuration that belongs to no unit: locations, holidays, units themselves. */
  readonly canAdministerGlobally: boolean;

  /**
   * Holds the role somewhere — for deciding whether a toolbar button or a nav link is
   * worth rendering, before any row is in question. Never use it to permit a write:
   * the write knows its unit and must ask about that one.
   */
  readonly plansSomewhere: boolean;
  readonly approvesSomewhere: boolean;
  readonly administersSomewhere: boolean;

  /** Whether this row is the signed-in person's own. */
  readonly isSelf: (personId: PersonId) => boolean;
  readonly personId: PersonId | undefined;
  readonly ready: boolean;
}

export function useCapabilities(): Capabilities {
  const identity = useAuth();

  return useMemo(() => {
    const ready = identity.resolved;
    return {
      canPlan: (unitId) => ready && hasRole(identity, 'Planner', unitId),
      canApprove: (unitId) => ready && hasRole(identity, 'Approver', unitId),
      canAdminister: (unitId) => ready && hasRole(identity, 'Admin', unitId),
      canAdministerGlobally: ready && hasRole(identity, 'Admin', undefined),

      plansSomewhere: ready && hasRoleAnywhere(identity, 'Planner'),
      approvesSomewhere: ready && hasRoleAnywhere(identity, 'Approver'),
      administersSomewhere: ready && hasRoleAnywhere(identity, 'Admin'),

      isSelf: (personId) => ready && personId === identity.personId,
      personId: ready ? identity.personId : undefined,
      ready,
    };
  }, [identity]);
}
