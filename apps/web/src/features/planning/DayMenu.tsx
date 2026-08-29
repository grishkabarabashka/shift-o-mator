/**
 * Right-click on a date header.
 *
 * WHY a menu for a single item: the header used to open the day's history straight from
 * the right-click, which is the one place in the grid where right-click did not produce a
 * menu. Two gestures that look the same have to behave the same, and the header will grow
 * more day-wide actions than this one.
 */

import { FloatingMenu } from './FloatingMenu.tsx';
import type { IsoDate } from '../../domain/types.ts';

export interface DayMenuTarget {
  readonly date: IsoDate;
  readonly x: number;
  readonly y: number;
}

export function DayMenu({
  target,
  onClose,
  onShowHistory,
}: {
  readonly target: DayMenuTarget;
  readonly onClose: () => void;
  readonly onShowHistory: () => void;
}) {
  return (
    <FloatingMenu
      x={target.x}
      y={target.y}
      anchorKey={target.date}
      label="Day"
      width={228}
      onClose={onClose}
    >
      <div className="menu-label flex items-baseline justify-between gap-2 normal-case">
        <span className="text-[12px] font-semibold tracking-normal text-ink">{target.date}</span>
      </div>
      <button
        type="button"
        className="menu-item"
        role="menuitem"
        onClick={() => {
          onShowHistory();
          onClose();
        }}
      >
        History for this day
        <span className="ml-auto text-[10px] text-faint">everyone</span>
      </button>
    </FloatingMenu>
  );
}
