using ShiftOMator.Domain;

namespace ShiftOMator.Api.Contracts.Admin;

public record ShiftRequirementRequest(
    string ShiftId, int Min, int? Max, bool IsDefault,
    TimeOnly? TimingOverrideStart, TimeOnly? TimingOverrideEnd, bool? TimingOverrideCrossesMidnight);

/// <summary>Structural fields are create-only (ADR-0021) — see
/// <c>DayConfigurationsAdminEndpoints</c>'s doc comment for why there is no PUT.</summary>
public record DayConfigurationNewVersionRequest(
    string UnitId, DayConfigKey Key, List<IsoWeekday> Weekdays, DateOnly? Date,
    string? Label, DateOnly EffectiveFrom, List<ShiftRequirementRequest> ShiftRequirements);

public record DayConfigurationLabelRequest(string? Label);
