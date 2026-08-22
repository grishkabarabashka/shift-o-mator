# shift-o-mator

Shift planning and visualization for a global application support team.

Replaces manual planning in a shared Excel file: stores role time in the system,
checks coverage continuously, tracks comp days and workload fairness.

## Documentation

[Docs/](Docs/README.md) — sections and accepted decisions.

## Status

MVP, no backend. Data is in-memory fixtures persisted to IndexedDB.

The design was revised against the specification of an earlier corporate
implementation (`SHIFT-O-MATOR-desc-anonymized.md`). The running code predates that
revision: it implements a manual planning grid, a coverage strip and an issues panel
against a model that has since been corrected. See
[the roadmap](Docs/13-roadmap.md) for what survives the rework and what changes.

## Running it

```
npm install
npm run dev
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | typecheck and production build |
| `npm run preview` | preview the build |
| `npm test` | Vitest in watch mode |
| `npm run test:run` | Vitest, single run |
| `npm run typecheck` | `tsc --noEmit` |
