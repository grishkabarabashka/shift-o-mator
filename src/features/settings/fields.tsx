/** Small inline-editable field primitives shared by every Settings tab. */
import type { ChangeEvent } from 'react';

export function TextField({
  value,
  onChange,
  ariaLabel,
  placeholder,
  mono,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly ariaLabel: string;
  readonly placeholder?: string;
  readonly mono?: boolean;
}) {
  return (
    <input
      type="text"
      className={`field w-full py-0.5 ${mono ? 'font-mono text-[12px]' : ''}`}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
    />
  );
}

export function NumberField({
  value,
  onChange,
  ariaLabel,
  min,
}: {
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly ariaLabel: string;
  readonly min?: number;
}) {
  return (
    <input
      type="number"
      className="field w-16 py-0.5 font-mono text-[12px]"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      aria-label={ariaLabel}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))}
    />
  );
}

export function TimeField({
  value,
  onChange,
  ariaLabel,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly ariaLabel: string;
}) {
  return (
    <input
      type="time"
      className="field w-[100px] py-0.5 font-mono text-[12px]"
      value={value}
      aria-label={ariaLabel}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
    />
  );
}

export function CheckboxField({
  checked,
  onChange,
  ariaLabel,
}: {
  readonly checked: boolean;
  readonly onChange: (value: boolean) => void;
  readonly ariaLabel: string;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      aria-label={ariaLabel}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
    />
  );
}

export function NativeSelectField({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string) => void;
  readonly ariaLabel: string;
}) {
  return (
    <select className="field py-0.5 text-[12px]" value={value} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function FieldErrorList({ errors }: { readonly errors: readonly string[] | undefined }) {
  if (!errors || errors.length === 0) return null;
  return (
    <ul className="mt-0.5 text-[10.5px] text-warn">
      {errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  );
}
