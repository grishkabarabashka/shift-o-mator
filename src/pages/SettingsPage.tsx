/**
 * Settings — конфигурация, на которой стоит всё остальное.
 *
 * Пока только чтение. Записи здесь нет намеренно: конфигурация
 * эффективно-датирована (ADR-0021), и правка минимума «задним числом» обязана
 * создавать новую версию, а не менять существующую, — иначе прошлый март
 * начнёт задним числом падать. Редактор без версий сделал бы данные хуже, чем
 * их отсутствие, поэтому он ждёт отдельного этапа.
 *
 * Ценность экрана уже сейчас в том, что он объясняет, **откуда берутся правила**:
 * почему в пятницу другие роли, почему у Pune свой праздник и почему `Crew`
 * рисуется в 10:00, а записан на 09:00.
 */

import { useState } from 'react';
import { useSchedule } from '../store/useSchedule.ts';

const TABS = ['Regions', 'Roles', 'Day configurations', 'Shifts', 'Holidays'] as const;
type Tab = (typeof TABS)[number];

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('Regions');
  const reference = useSchedule((s) => s.reference);
  if (!reference) return null;

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-4 p-4">
      <header className="flex items-center gap-3">
        <h1 className="text-[22px] font-semibold tracking-tight">Settings</h1>
        <span className="pill">Read-only</span>
        <span className="text-[11.5px] text-faint">
          Editing needs effective-dated versioning — see ADR&#8209;0021
        </span>
      </header>

      <div className="segmented self-start">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            className="segmented__item"
            data-active={tab === item}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <section className="card overflow-auto">
        {tab === 'Regions' ? (
          <table className="rows">
            <thead>
              <tr>
                <th>Region</th>
                <th>Primary zone</th>
                <th>Locations</th>
                <th>Comp-off window</th>
              </tr>
            </thead>
            <tbody>
              {reference.regions.map((region) => (
                <tr key={region.id}>
                  <td className="font-medium">{region.name}</td>
                  <td className="font-mono text-[12px]">{region.primaryTimeZone}</td>
                  <td className="text-muted">
                    {region.locationIds
                      .map((id) => reference.locations.find((l) => l.id === id)?.name ?? id)
                      .join(', ')}
                  </td>
                  <td className="font-mono text-[12px]">
                    −{region.compOffPolicy.windowBeforeDays} / +
                    {region.compOffPolicy.windowAfterDays} days
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {tab === 'Roles' ? (
          <table className="rows">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Region</th>
                <th>Window</th>
                <th>Zone</th>
                <th>Counts as coverage</th>
                <th>Hotkey</th>
              </tr>
            </thead>
            <tbody>
              {reference.roles.map((role) => (
                <tr key={role.id}>
                  <td>
                    <span className="chip !w-auto px-2 py-0.5" style={{ background: role.color }}>
                      {role.code}
                    </span>
                  </td>
                  <td className="font-medium">{role.label}</td>
                  <td className="text-muted">{role.regionId}</td>
                  <td className="font-mono text-[12px]">
                    {role.start}–{role.end}
                    {role.crossesMidnight ? ' +1' : ''}
                  </td>
                  <td className="font-mono text-[11.5px] text-muted">{role.timeZone}</td>
                  <td>{role.countsAsCoverage ? 'Yes' : <span className="text-faint">No</span>}</td>
                  <td>{role.hotkey ? <kbd className="kbd">{role.hotkey}</kbd> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {tab === 'Day configurations' ? (
          <table className="rows">
            <thead>
              <tr>
                <th>Region</th>
                <th>Applies to</th>
                <th>Effective from</th>
                <th>Roles and minimums</th>
              </tr>
            </thead>
            <tbody>
              {reference.dayConfigurations.map((config) => (
                <tr key={`${config.regionId}-${config.key}-${config.effectiveFrom ?? ''}`}>
                  <td className="text-muted">{config.regionId}</td>
                  <td className="font-medium">{describeKey(config)}</td>
                  <td className="font-mono text-[11.5px] text-muted">
                    {config.effectiveFrom ?? '—'}
                  </td>
                  <td>
                    <span className="flex flex-wrap gap-1">
                      {config.roleRequirements.map((requirement) => {
                        const role = reference.roles.find((r) => r.id === requirement.roleId);
                        return (
                          <span
                            key={requirement.roleId}
                            className="pill"
                            title={`${role?.label ?? requirement.roleId}: min ${requirement.min}${
                              requirement.max !== undefined ? `, max ${requirement.max}` : ''
                            }`}
                          >
                            <span
                              aria-hidden
                              className="h-2 w-2 rounded-full"
                              style={{ background: role?.color ?? 'var(--accent)' }}
                            />
                            {role?.code ?? requirement.roleId}
                            <span className="text-faint">{requirement.min}</span>
                          </span>
                        );
                      })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {tab === 'Shifts' ? (
          <table className="rows">
            <thead>
              <tr>
                <th>Shift</th>
                <th>Region</th>
                <th>Window</th>
                <th>Zone</th>
              </tr>
            </thead>
            <tbody>
              {reference.shifts.map((shift) => (
                <tr key={shift.id}>
                  <td className="font-medium">{shift.name}</td>
                  <td className="text-muted">{shift.regionId}</td>
                  <td className="font-mono text-[12px]">
                    {shift.start}–{shift.end}
                    {shift.crossesMidnight ? ' +1' : ''}
                  </td>
                  <td className="font-mono text-[11.5px] text-muted">{shift.timeZone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {tab === 'Holidays' ? (
          <table className="rows">
            <thead>
              <tr>
                <th>Date</th>
                <th>Name</th>
                <th>Locations</th>
              </tr>
            </thead>
            <tbody>
              {[...reference.holidays]
                .sort((a, b) => a.date.localeCompare(b.date))
                .map((holiday) => (
                  <tr key={`${holiday.date}-${holiday.name}`}>
                    <td className="font-mono text-[12px]">{holiday.date}</td>
                    <td className="font-medium">{holiday.name}</td>
                    <td className="text-muted">
                      {holiday.locationIds
                        .map((id) => reference.locations.find((l) => l.id === id)?.name ?? id)
                        .join(', ')}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </div>
  );
}

function describeKey(config: { key: string; weekday?: number; date?: string }): string {
  if (config.date) return `Event on ${config.date}`;
  switch (config.key) {
    case 'weekend':
      return 'Weekend';
    case 'holiday':
      return 'Holiday';
    case 'weekday':
      return 'Weekdays';
    default:
      return config.key;
  }
}
