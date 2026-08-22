/**
 * NOTE: thin wrapper over Radix — the single point of replacement when
 * migrating to the corporate component library (ADR-0013).
 *
 * Radix handles behavior, accessibility, and focus management; the visuals
 * are entirely our own, driven by variables in styles.css.
 */

import * as RadixSelect from '@radix-ui/react-select';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RadixTooltip.Provider delayDuration={300}>{children}</RadixTooltip.Provider>;
}

export function Tooltip({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content className="tooltip" sideOffset={4}>
          {label}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export function Select({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <RadixSelect.Root value={value} onValueChange={onChange}>
      <RadixSelect.Trigger className="select" aria-label={ariaLabel}>
        <RadixSelect.Value />
        <RadixSelect.Icon>▾</RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className="select__content" position="popper" sideOffset={4}>
          <RadixSelect.Viewport>
            {options.map((option) => (
              <RadixSelect.Item key={option.value} value={option.value} className="select__item">
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
