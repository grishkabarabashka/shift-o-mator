/**
 * Действие над текущим выделением: отметить отсутствие. Один диапазон на
 * каждого выделенного человека (см. selection.ts).
 */

import { useUi } from '../../store/useUi.ts';
import type { PlanningView } from '../planning/usePlanningView.ts';
import { resolveAbsenceTargets } from './selection.ts';

interface Props {
  readonly view: PlanningView;
}

export function SelectionToolbar({ view }: Props) {
  const selection = useUi((s) => s.selection);
  const openAbsenceCreate = useUi((s) => s.openAbsenceCreate);

  const targets = resolveAbsenceTargets(view, selection);
  const first = targets[0];

  return (
    <div className="selection-toolbar">
      <button
        type="button"
        className="btn"
        disabled={targets.length === 0}
        onClick={() => openAbsenceCreate(targets)}
      >
        + Отсутствие{targets.length > 1 ? ` (${targets.length})` : ''}
      </button>
      <span className="selection-toolbar__hint">
        {first
          ? first.from === first.to
            ? first.from
            : `${first.from}–${first.to}`
          : 'Выделите ячейки, чтобы отметить отсутствие или дважды кликните по отметке для правки'}
      </span>
    </div>
  );
}
