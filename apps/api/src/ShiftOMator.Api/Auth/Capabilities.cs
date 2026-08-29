using System.Security.Claims;
using ShiftOMator.Domain;

namespace ShiftOMator.Api.Auth;

/// <summary>
/// The one place that answers "may this caller do X, here" (ADR-0051).
///
/// WHY this replaces the old <c>role &gt;= minimum</c> comparison: that made every higher
/// role a superset of every lower one, so an Admin could assign shifts for no better
/// reason than <c>Admin &gt; Planner</c> in an enum. Administering configuration and
/// planning a rota are different jobs, held by different people, and the ordinal quietly
/// merged them. Roles are now a **set**, and holding two means holding both — nothing is
/// implied by ordering.
///
/// Grants are scoped to a planning unit, or global (<see cref="RoleAssignment.UnitId"/>
/// null). A global grant satisfies every unit-scoped check **for that role only**: it
/// widens scope, never privilege.
/// </summary>
public static class Capabilities
{
    /// <summary>One claim per grant. Value is <c>role|unitId</c>, unit empty for global.</summary>
    public const string RoleClaim = "sfm:role";

    public static Claim ClaimFor(AppRole role, string? unitId) =>
        new(RoleClaim, $"{role}|{unitId ?? string.Empty}");

    /// <summary>Holds this role in this unit, or globally. A null unit asks only about a
    /// global grant — used for configuration that belongs to no unit.</summary>
    public static bool Has(this ClaimsPrincipal user, AppRole role, string? unitId)
    {
        foreach (var claim in user.FindAll(RoleClaim))
        {
            var separator = claim.Value.IndexOf('|');
            if (separator < 0) continue;
            if (!Enum.TryParse<AppRole>(claim.Value[..separator], ignoreCase: true, out var granted)) continue;
            if (granted != role) continue;

            var scope = claim.Value[(separator + 1)..];
            if (scope.Length == 0) return true;          // global grant
            if (unitId is not null && scope == unitId) return true;
        }

        return false;
    }

    /// <summary>Holds this role in at least one unit. What an endpoint-level policy can
    /// check before the unit in question is known; the handler still has to ask
    /// <see cref="Has"/> once it is.</summary>
    public static bool HasAnywhere(this ClaimsPrincipal user, AppRole role) =>
        user.FindAll(RoleClaim).Any(claim =>
            claim.Value.IndexOf('|') is var separator && separator >= 0
            && Enum.TryParse<AppRole>(claim.Value[..separator], ignoreCase: true, out var granted)
            && granted == role);

    /// <summary>Every unit this role is held in. Empty list with
    /// <paramref name="global"/> true means "all of them".</summary>
    public static (bool Global, IReadOnlyList<string> UnitIds) Scope(this ClaimsPrincipal user, AppRole role)
    {
        var units = new List<string>();
        var global = false;

        foreach (var claim in user.FindAll(RoleClaim))
        {
            var separator = claim.Value.IndexOf('|');
            if (separator < 0) continue;
            if (!Enum.TryParse<AppRole>(claim.Value[..separator], ignoreCase: true, out var granted)) continue;
            if (granted != role) continue;

            var scope = claim.Value[(separator + 1)..];
            if (scope.Length == 0) global = true;
            else units.Add(scope);
        }

        return (global, units);
    }

    // ---- The questions the endpoints actually ask -------------------------------------

    /// <summary>Assign shifts, markers and comp days, and publish, in this unit.</summary>
    public static bool CanPlan(this ClaimsPrincipal user, string unitId) =>
        user.Has(AppRole.Planner, unitId);

    /// <summary>Decide requests raised by people in this unit.</summary>
    public static bool CanApprove(this ClaimsPrincipal user, string unitId) =>
        user.Has(AppRole.Approver, unitId);

    /// <summary>Edit this unit's configuration — its shifts, day configurations, coverage
    /// rules and role grants.</summary>
    public static bool CanAdminister(this ClaimsPrincipal user, string unitId) =>
        user.Has(AppRole.Admin, unitId);

    /// <summary>Edit configuration that belongs to no unit: locations, holidays, the
    /// planning units themselves, event and request types. Global grant only — a unit
    /// admin has no business renaming a location every other unit shares.</summary>
    public static bool CanAdministerGlobally(this ClaimsPrincipal user) =>
        user.Has(AppRole.Admin, null);

    /// <summary>
    /// Write a record that belongs to a person: their presence, their absences.
    ///
    /// Yours always. Somebody else's only as a planner of their unit — and note that this
    /// answers *who may write the row*, not *whether the row needs approving first*. That
    /// second question belongs to the thing being written, not to the person writing it
    /// (ADR-0051): a planner recording leave for somebody else still raises a request.
    /// </summary>
    public static bool CanWriteRecordOf(
        this ClaimsPrincipal user, string actorPersonId, string subjectPersonId, string subjectUnitId) =>
        actorPersonId == subjectPersonId || user.CanPlan(subjectUnitId);
}
