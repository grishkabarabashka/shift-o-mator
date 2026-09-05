/**
 * Absence import — paste/upload → map columns → match people → review → one
 * batch in the draft (Docs/11 "Absence import"). The engine in
 * `engine/absenceImport.ts` does all the real work; this file is the wizard
 * shell plus the two small pieces of browser-only persistence the design doc
 * asks for and the pure engine has no business owning:
 *
 *   - a named mapping template, so a changed export format is fixed once in
 *     the UI, not relearned every time;
 *   - remembered person matches, so a recurring export stops asking the same
 *     question about the same name.
 *
 * Both live in `localStorage` — there is no backend yet (ADR-0012 target is
 * the real store; this is the MVP substitute, same as everything else here).
 */

import * as Dialog from '@radix-ui/react-dialog';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  buildImportChanges,
  computeImportImpact,
  diffAbsenceImport,
  guessColumnMapping,
  mapRows,
  matchPeople,
  parseDelimited,
  type AbsenceImportRow,
  type ColumnMapping,
  type ImportField,
  type ParsedAbsenceRow,
  type PersonMatch,
} from '../../engine/absenceImport.ts';
import { useSchedule } from '../../store/useSchedule.ts';
import { useUi } from '../../store/useUi.ts';
import { Select, type SelectOption } from '../../ui/primitives.tsx';
import { useDataset } from '../../store/useDataset.ts';

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
}

type Step = 'input' | 'mapping' | 'review';

const FIELD_OPTIONS: readonly SelectOption[] = [
  { value: 'ignore', label: 'Ignore' },
  { value: 'personId', label: 'Person (Employee ID)' },
  { value: 'personName', label: 'Person (Name)' },
  { value: 'type', label: 'Type' },
  { value: 'from', label: 'From' },
  { value: 'to', label: 'To' },
  { value: 'note', label: 'Note' },
];

// ---------------------------------------------------------------------------
// Browser-local persistence: templates and remembered matches
// ---------------------------------------------------------------------------

interface MappingTemplate {
  readonly name: string;
  readonly mapping: ColumnMapping;
  readonly hasHeader: boolean;
  readonly columnCount: number;
}

const TEMPLATES_KEY = 'shift-o-mator:absence-import-templates';
const REMEMBERED_KEY = 'shift-o-mator:absence-import-remembered';

function loadTemplates(): MappingTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    return raw ? (JSON.parse(raw) as MappingTemplate[]) : [];
  } catch {
    return [];
  }
}

function saveTemplate(template: MappingTemplate): void {
  const templates = loadTemplates().filter((t) => t.name !== template.name);
  templates.push(template);
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
}

function loadRemembered(): Map<string, string> {
  try {
    const raw = localStorage.getItem(REMEMBERED_KEY);
    if (!raw) return new Map();
    return new Map(Object.entries(JSON.parse(raw) as Record<string, string>));
  } catch {
    return new Map();
  }
}

function rememberMatch(rawKey: string, personId: string): void {
  const key = rawKey.trim().toLowerCase();
  if (!key) return;
  const map = loadRemembered();
  map.set(key, personId);
  localStorage.setItem(REMEMBERED_KEY, JSON.stringify(Object.fromEntries(map)));
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export function AbsenceImportDialog({ open, onClose }: Props) {
  const { plan, published, index } = useDataset();
  const commitAbsenceImport = useSchedule((s) => s.commitAbsenceImport);
  const setAnchor = useUi((s) => s.setScheduleAnchor);
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('input');
  const [text, setText] = useState('');
  const [hasHeader, setHasHeader] = useState(true);
  const [table, setTable] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [templateName, setTemplateName] = useState('');

  const [reviewRows, setReviewRows] = useState<ParsedAbsenceRow[]>([]);
  const [matches, setMatches] = useState<PersonMatch[]>([]);
  const [goneToRemove, setGoneToRemove] = useState<ReadonlySet<string>>(new Set());
  const [batchId, setBatchId] = useState('');
  const [applying, setApplying] = useState(false);

  const templates = useMemo(() => (open ? loadTemplates() : []), [open]);

  const reset = () => {
    setStep('input');
    setText('');
    setHasHeader(true);
    setTable([]);
    setMapping({});
    setTemplateName('');
    setReviewRows([]);
    setMatches([]);
    setGoneToRemove(new Set());
    setApplying(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const loadText = (raw: string) => {
    setText(raw);
    const parsed = parseDelimited(raw);
    setTable(parsed);
    const header = parsed[0] ?? [];
    setMapping(guessColumnMapping(header));
  };

  const onFile = async (file: File) => {
    loadText(await file.text());
  };

  const goToMapping = () => setStep('mapping');

  const applyTemplate = (name: string) => {
    const template = templates.find((t) => t.name === name);
    if (!template) return;
    setMapping(template.mapping);
    setHasHeader(template.hasHeader);
  };

  const setField = (columnIndex: number, field: ImportField) => {
    setMapping((prev) => ({ ...prev, [columnIndex]: field }));
  };

  const goToReview = () => {
    if (!index || !plan) return;
    const rows = mapRows(table, mapping, hasHeader);
    const remembered = loadRemembered();
    setReviewRows(rows);
    setMatches(matchPeople(rows, index, remembered));
    setGoneToRemove(new Set());
    setBatchId(`abs-import-${Date.now().toString(36)}`);
    setStep('review');
  };

  const diff = useMemo(() => {
    if (!index || !plan) return undefined;
    return diffAbsenceImport({ rows: reviewRows, matches, existingAbsences: plan.absences, index });
  }, [reviewRows, matches, plan, index]);

  const impact = useMemo(() => {
    if (!diff || !published || !index) return [];
    return computeImportImpact({ rows: diff.rows, publishedAssignments: published.assignments, index });
  }, [diff, published, index]);

  const resolveRow = (row: ParsedAbsenceRow, personId: string) => {
    setMatches((prev) =>
      prev.map((m) => (m.rowIndex === row.rowIndex ? { ...m, personId, suggestions: [] } : m)),
    );
    rememberMatch(row.personIdRaw ?? row.personNameRaw ?? '', personId);
  };

  const toggleGone = (absenceId: string) => {
    setGoneToRemove((prev) => {
      const next = new Set(prev);
      if (next.has(absenceId)) next.delete(absenceId);
      else next.add(absenceId);
      return next;
    });
  };

  const apply = async () => {
    if (!diff) return;
    setApplying(true);
    try {
      const changes = buildImportChanges({
        rows: diff.rows,
        gone: diff.gone,
        goneToRemove,
        batchId,
        now: new Date().toISOString(),
      });
      await commitAbsenceImport(changes);
      close();
    } finally {
      setApplying(false);
    }
  };

  const jumpTo = (date: string) => {
    setAnchor(date);
    close();
    void navigate(`/schedule/day/${date}`);
  };

  const people = index ? [...index.people.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)) : [];
  const peopleOptions: SelectOption[] = [
    { value: '', label: 'Pick a person…' },
    ...people.map((p) => ({ value: p.id, label: p.displayName })),
  ];

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog w-[min(880px,calc(100vw-32px))] max-h-[85vh] overflow-y-auto">
          <Dialog.Title className="dialog__title">Import absences</Dialog.Title>
          <Dialog.Description className="mb-3 text-[13px] text-muted">
            {step === 'input' && 'Paste straight from the leave-system export, or upload a file.'}
            {step === 'mapping' && 'Tell the importer which column is which. Saved as a template.'}
            {step === 'review' &&
              'Nothing is written until you apply — this lands as one batch in the draft.'}
          </Dialog.Description>

          {step === 'input' ? (
            <InputStep
              text={text}
              hasHeader={hasHeader}
              onTextChange={loadText}
              onHasHeaderChange={setHasHeader}
              onFile={(file) => void onFile(file)}
            />
          ) : null}

          {step === 'mapping' ? (
            <MappingStep
              table={table}
              hasHeader={hasHeader}
              mapping={mapping}
              onHasHeaderChange={setHasHeader}
              onFieldChange={setField}
              templates={templates}
              onLoadTemplate={applyTemplate}
              templateName={templateName}
              onTemplateNameChange={setTemplateName}
              onSaveTemplate={() => {
                if (!templateName.trim()) return;
                saveTemplate({
                  name: templateName.trim(),
                  mapping,
                  hasHeader,
                  columnCount: table[0]?.length ?? 0,
                });
              }}
            />
          ) : null}

          {step === 'review' && diff ? (
            <ReviewStep
              diff={diff}
              matches={matches}
              impact={impact}
              goneToRemove={goneToRemove}
              peopleOptions={peopleOptions}
              onResolve={resolveRow}
              onToggleGone={toggleGone}
              onJump={jumpTo}
            />
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn" onClick={close}>
              Cancel
            </button>
            {step === 'mapping' ? (
              <button type="button" className="btn" onClick={() => setStep('input')}>
                Back
              </button>
            ) : null}
            {step === 'review' ? (
              <button type="button" className="btn" onClick={() => setStep('mapping')}>
                Back
              </button>
            ) : null}

            {step === 'input' ? (
              <button
                type="button"
                className="btn btn--primary"
                disabled={table.length === 0}
                onClick={goToMapping}
              >
                Continue
              </button>
            ) : null}
            {step === 'mapping' ? (
              <button type="button" className="btn btn--primary" onClick={goToReview}>
                Continue
              </button>
            ) : null}
            {step === 'review' && diff ? (
              <button
                type="button"
                className="btn btn--primary"
                disabled={applying || (diff.rows.length === 0 && goneToRemove.size === 0)}
                onClick={() => void apply()}
              >
                {applying ? 'Applying…' : `Apply (${diff.rows.length + goneToRemove.size})`}
              </button>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — paste or upload
// ---------------------------------------------------------------------------

function InputStep({
  text,
  hasHeader,
  onTextChange,
  onHasHeaderChange,
  onFile,
}: {
  readonly text: string;
  readonly hasHeader: boolean;
  readonly onTextChange: (text: string) => void;
  readonly onHasHeaderChange: (value: boolean) => void;
  readonly onFile: (file: File) => void;
}) {
  return (
    <div className="space-y-3">
      <textarea
        className="field h-40 w-full py-2 font-mono text-[12px] leading-normal"
        placeholder="Paste rows here (Ctrl+V straight from the open spreadsheet)…"
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
      />
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          <input type="checkbox" checked={hasHeader} onChange={(e) => onHasHeaderChange(e.target.checked)} />
          First row is a header
        </label>
        <label className="btn btn--sm cursor-pointer">
          Upload file…
          <input
            type="file"
            accept=".csv,.tsv,.txt"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFile(file);
              event.target.value = '';
            }}
          />
        </label>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — column mapping
// ---------------------------------------------------------------------------

function MappingStep({
  table,
  hasHeader,
  mapping,
  onHasHeaderChange,
  onFieldChange,
  templates,
  onLoadTemplate,
  templateName,
  onTemplateNameChange,
  onSaveTemplate,
}: {
  readonly table: readonly (readonly string[])[];
  readonly hasHeader: boolean;
  readonly mapping: ColumnMapping;
  readonly onHasHeaderChange: (value: boolean) => void;
  readonly onFieldChange: (columnIndex: number, field: ImportField) => void;
  readonly templates: readonly { readonly name: string }[];
  readonly onLoadTemplate: (name: string) => void;
  readonly templateName: string;
  readonly onTemplateNameChange: (name: string) => void;
  readonly onSaveTemplate: () => void;
}) {
  const header = table[0] ?? [];
  const sample = table[hasHeader ? 1 : 0] ?? [];
  const columnCount = header.length;

  return (
    <div className="space-y-3">
      {templates.length > 0 ? (
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] text-muted">Load template</span>
          <Select
            ariaLabel="Load mapping template"
            value=""
            onChange={onLoadTemplate}
            options={templates.map((t) => ({ value: t.name, label: t.name }))}
          />
        </div>
      ) : null}

      <label className="flex items-center gap-1.5 text-[12px] text-muted">
        <input type="checkbox" checked={hasHeader} onChange={(e) => onHasHeaderChange(e.target.checked)} />
        First row is a header
      </label>

      <div className="max-h-[280px] overflow-auto rounded-lg border border-line">
        <table className="rows">
          <thead>
            <tr>
              {Array.from({ length: columnCount }, (_, i) => (
                <th key={i}>{hasHeader ? header[i] || `Column ${i + 1}` : `Column ${i + 1}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {Array.from({ length: columnCount }, (_, i) => (
                <td key={i}>
                  <Select
                    ariaLabel={`Column ${i + 1} field`}
                    value={mapping[i] ?? 'ignore'}
                    onChange={(value) => onFieldChange(i, value as ImportField)}
                    options={FIELD_OPTIONS}
                  />
                </td>
              ))}
            </tr>
            <tr>
              {Array.from({ length: columnCount }, (_, i) => (
                <td key={i} className="text-faint">
                  {sample[i] || '—'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <input
          className="field flex-1"
          placeholder="Save this mapping as a template…"
          value={templateName}
          onChange={(event) => onTemplateNameChange(event.target.value)}
        />
        <button type="button" className="btn btn--sm" disabled={!templateName.trim()} onClick={onSaveTemplate}>
          Save template
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — review: diff, person matching, impact
// ---------------------------------------------------------------------------

function ReviewStep({
  diff,
  matches,
  impact,
  goneToRemove,
  peopleOptions,
  onResolve,
  onToggleGone,
  onJump,
}: {
  readonly diff: {
    readonly rows: readonly AbsenceImportRow[];
    readonly unresolved: readonly ParsedAbsenceRow[];
    readonly invalid: readonly ParsedAbsenceRow[];
    readonly gone: readonly { readonly absence: { readonly id: string; readonly from: string; readonly to: string; readonly eventTypeId: string }; readonly personName: string }[];
  };
  readonly matches: readonly PersonMatch[];
  readonly impact: readonly { readonly assignment: { readonly id: string; readonly date: string }; readonly personName: string }[];
  readonly goneToRemove: ReadonlySet<string>;
  readonly peopleOptions: readonly SelectOption[];
  readonly onResolve: (row: ParsedAbsenceRow, personId: string) => void;
  readonly onToggleGone: (absenceId: string) => void;
  readonly onJump: (date: string) => void;
}) {
  const added = diff.rows.filter((r) => r.decision === 'add').length;
  const changed = diff.rows.filter((r) => r.decision === 'update').length;
  const unchanged = diff.rows.filter((r) => r.decision === 'unchanged').length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <Stat label="Added" value={added} tone="ok" />
        <Stat label="Changed" value={changed} tone="warn" />
        <Stat label="Gone" value={diff.gone.length} tone="bad" />
        <Stat label="Unchanged" value={unchanged} />
      </div>

      {diff.unresolved.length > 0 ? (
        <div className="rounded-lg border border-warn bg-warn-soft p-2.5">
          <p className="mb-1.5 text-[12px] font-semibold text-warn">
            {diff.unresolved.length} row{diff.unresolved.length === 1 ? '' : 's'} need a person match —
            left unmatched, they will not be imported.
          </p>
          <div className="max-h-[160px] space-y-2 overflow-y-auto">
            {diff.unresolved.map((row) => {
              const match = matches.find((m) => m.rowIndex === row.rowIndex);
              const raw = row.personNameRaw ?? row.personIdRaw ?? '(blank)';
              return (
                <div key={row.rowIndex} className="rounded border border-line bg-surface p-2 text-[12px]">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-medium">"{raw}"</span>
                    <span className="text-faint">
                      {row.from}
                      {row.to && row.to !== row.from ? `–${row.to}` : ''}
                    </span>
                  </div>
                  {match && match.suggestions.length > 0 ? (
                    <div className="mb-1.5 flex flex-wrap gap-1.5">
                      {match.suggestions.map((s) => (
                        <button
                          key={s.personId}
                          type="button"
                          className="btn btn--sm"
                          onClick={() => onResolve(row, s.personId)}
                        >
                          {s.name} ({Math.round(s.score * 100)}%)
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <Select
                    ariaLabel={`Match for row ${row.rowIndex + 1}`}
                    value=""
                    onChange={(value) => value && onResolve(row, value)}
                    options={peopleOptions}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {diff.invalid.length > 0 ? (
        <div className="rounded-lg border border-bad bg-bad-soft p-2.5 text-[12px] text-bad">
          {diff.invalid.length} row{diff.invalid.length === 1 ? '' : 's'} could not be read and will be
          skipped — fix them in the source and re-paste.
          <ul className="mt-1 list-disc pl-4">
            {diff.invalid.slice(0, 5).map((row) => (
              <li key={row.rowIndex}>
                Row {row.rowIndex + 1}: {row.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {diff.gone.length > 0 ? (
        <div className="rounded-lg border border-line">
          <div className="border-b border-line px-3 py-1.5 text-[11.5px] font-semibold text-muted">
            Missing from this export — was leave cancelled, or did the row not make it in? Confirm
            before removing.
          </div>
          <div className="max-h-[160px] overflow-y-auto">
            {diff.gone.map((item) => (
              <label
                key={item.absence.id}
                className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[12px] last:border-0"
              >
                <input
                  type="checkbox"
                  checked={goneToRemove.has(item.absence.id)}
                  onChange={() => onToggleGone(item.absence.id)}
                />
                <span className="font-medium">{item.personName}</span>
                <span className="text-faint">
                  {eventTypeLabel(item.absence.eventTypeId)} · {item.absence.from}
                  {item.absence.to !== item.absence.from ? `–${item.absence.to}` : ''}
                </span>
                <span className="ml-auto text-[11px] text-faint">
                  {goneToRemove.has(item.absence.id) ? 'will be removed' : 'kept'}
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {impact.length > 0 ? (
        <div className="rounded-lg border border-line">
          <div className="border-b border-line px-3 py-1.5 text-[11.5px] font-semibold text-muted">
            {impact.length} published assignment{impact.length === 1 ? '' : 's'} overlap this leave and
            need a replacement
          </div>
          <div className="max-h-[160px] overflow-y-auto">
            {impact.map((item) => (
              <button
                key={item.assignment.id}
                type="button"
                className="flex w-full items-center gap-2 border-b border-line px-3 py-1.5 text-left text-[12px] last:border-0 hover:bg-hover"
                onClick={() => onJump(item.assignment.date)}
              >
                <span>{item.personName}</span>
                <span className="text-faint">{item.assignment.date}</span>
                <span className="ml-auto text-[11px] text-accent">Fix →</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: 'ok' | 'warn' | 'bad';
}) {
  const color =
    tone === 'bad' && value > 0
      ? 'text-bad'
      : tone === 'warn' && value > 0
        ? 'text-warn'
        : tone === 'ok'
          ? 'text-ok'
          : '';
  return (
    <div className="rounded-lg border border-line px-2 py-1.5 text-center">
      <div className={`text-[18px] leading-none font-semibold ${color}`}>{value}</div>
      <div className="mt-0.5 text-[10px] text-faint uppercase">{label}</div>
    </div>
  );
}

/**
 * NOTE: Labels for the seeded event-type ids.
 *
 * The import dialog reads a file, not the reference data, and the diff it shows is about
 * rows that may name a type nobody has configured. Falling back to the raw id keeps an
 * unknown one visible rather than blank (ADR-0049).
 */
function eventTypeLabel(id: string): string {
  return (
    {
      'et-vacation': 'Annual leave',
      'et-sick': 'Sick leave',
      'et-floating-holiday': 'Floating holiday',
      'et-personal-day': 'Personal day',
      'et-unpaid-leave': 'Unpaid leave',
      'et-furlough': 'Furlough',
      'et-other': 'Other absence',
    }[id] ?? id
  );
}
