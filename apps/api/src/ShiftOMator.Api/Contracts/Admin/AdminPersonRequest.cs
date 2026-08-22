using ShiftOMator.Domain;

namespace ShiftOMator.Api.Contracts.Admin;

/// <summary>Identity/roster fields only — distinct from
/// <c>ShiftOMator.Api.Contracts.People.UpdatePersonRequest</c>, which owns
/// eligibility/preferences/target shares. Named Admin- to keep the two apart even
/// though they live in different namespaces (they answer to two different callers,
/// and a shared name would blur that at a glance).</summary>
public record AdminPersonRequest(
    string DisplayName, string Initials, string? EmployeeId, string UnitId,
    string LocationId, OrgCategory OrgCategory, bool IsActive, bool IsIncluded);
