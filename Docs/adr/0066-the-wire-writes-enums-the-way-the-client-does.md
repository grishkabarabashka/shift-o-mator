# ADR-0066. The wire writes enums the way the client already does

**Status:** accepted.

## Context

Two conventions met at the HTTP boundary and neither would move.

The backend serialized every enum with `JsonStringEnumConverter(JsonNamingPolicy.CamelCase)`
— one line in `Program.cs`, and idiomatic for ASP.NET Core. The client's domain
(`apps/web/src/domain/types.ts`) had written enums in `UPPER_SNAKE` since the prototype:
`'PENDING_APPROVAL'`, `'COVERAGE_GAP'`, `'SHIFT_POOL'`.

Reconciling them was the job of `apps/web/src/api/mapping.ts`. It carried a
`camelToUpperSnake`/`upperSnakeToCamel` pair and about forty-five calls to them, spread
through roughly thirty hand-written `xxxFromWire`/`xxxToWire` functions. Around those
calls, each function re-listed every field of its entity — so a mapper existed largely in
order to convert two or three strings on the way past.

The cost was not the line count. It was that a spelling could disagree, silently:

- A field forgotten in a mapper is `undefined` at runtime, not an error at build time.
- The conversion was applied by hand, per field, so a new field needed a third edit
  (C# entity, wire interface, mapper) and a missed one was invisible until the screen
  rendered a blank.
- The convention leaked past `mapping.ts` anyway. `admin.ts` says outright that its
  request bodies are "hand-built using the same wire conventions `mapping.ts` already
  established", and `myCalendar.ts`, `requests.ts` and the MSW test doubles each carried
  their own copy of the rule — including a `camelOf` in `mockSelfService.ts` and manual
  `.toLowerCase()` calls on `portion`.
- The same reconciliation had already been done twice more by hand for values that were
  not enums on one side: `SetupPreset` was `'Bare' | 'Demo'` in the client's domain and
  converted to `'bare' | 'demo'` at the call site, and `DayConfigKey` happened to match
  only because both sides used a single lowercase word.

## Decision

**Enums are `UPPER_SNAKE` on the wire.** `UpperSnakeCaseNamingPolicy` (in
`ShiftOMator.Application`) is registered in `Program.cs` and in `DraftJson.Options`.
Property names are untouched and stay camelCase.

**The two conventions meet on the server side, because that is the side where it is a
setting.** Enum wire format is one serializer registration; the client's side of it was
about two hundred string comparisons through the UI. This is not a claim that
`UPPER_SNAKE` is a better JSON convention than camelCase — only that one of the two was
a line of configuration and the other was code.

**`AppRole` is the single exemption**, and keeps `Planner`. Two reasons, and the first
alone is enough: the client already writes roles in exactly that shape, so `mapping.ts`
never converted them — renaming would *create* the mismatch this ADR exists to remove.
The second is that these strings are an external vocabulary: Entra app roles are declared
with these names and `RoleClaimsTransformation` parses `roles` claims against them.

The exemption is registered as `JsonStringEnumConverter<AppRole>` **before** the general
converter. Converters are matched in order and the first match wins, and a converter in
`options.Converters` outranks a `[JsonConverter]` attribute on the enum type — so the
attribute alone is silently ignored. The attribute is on `AppRole` as documentation; the
registration order is what does the work.

**`DayConfigKey` follows the rule** rather than keeping its accidental agreement, so
there is one convention with one exemption rather than one convention with two.

## Consequences

`mapping.ts` keeps exactly two conversions, and both are structural rather than
orthographic: `Weekday` is numeric on the client (Luxon) and named on the wire
(`IsoWeekday`), and `TimeOfDay` is `HH:mm` against C#'s `HH:mm:ss`. `Assignment` still
reshapes, because the wire flattens `content` into `shiftId`.

**This did not make `mapping.ts` small, and the earlier estimate that it would was
wrong.** The file is still about a thousand lines, because what fills it is not enum
conversion: it is 122 lines of plain field passthrough and 40 spreads that turn a wire
`null` into an absent property (`exactOptionalPropertyTypes`). Those are a separate
problem with a separate fix — a generic mapper, which risks spreading unknown wire fields
into domain objects — and this ADR does not attempt it. What this removes is a *class of
bug*, not a quantity of code.

**Enum values written under the old convention no longer read back.** `DraftJson` is used
for `DraftChange.BeforeJson`/`AfterJson` and history `SnapshotJson` columns as well as for
client payloads, and the convention has to be one thing. This is the same class of break
as regenerating `InitialCreate`, and acceptable for the same reason: no production data.

## Alternatives

**Move the client to camelCase instead.** Rejected on cost, not principle: ~200
comparison sites in the UI against ~20 lines of C#. `tsc --strict` would have caught every
one, so it was safe — just several hours of churn in exchange for the identical end state.

**Emit response schemas and generate the client's types.** The honest long-term answer,
and out of reach today: the minimal APIs return anonymous objects without `.Produces<T>()`,
so the OpenAPI document carries no response shapes at all. That is also why the generated
`schema.d.ts` was deleted rather than fixed — a generator over a document with no response
schemas produces nothing worth importing. If we want types from the server, `.Produces<T>()`
comes first.
