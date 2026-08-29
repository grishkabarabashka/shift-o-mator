using ShiftOMator.Domain;

namespace ShiftOMator.Api.Contracts.Admin;

public record AbsenceCapacityRuleRequest(
    string UnitId, AbsenceCapacityScopeKind ScopeKind, string? ScopeShiftId,
    AbsenceDurationBucket DurationBucket, int LongThresholdWorkdays, int MaxConcurrent,
    List<string> CountsEventTypeIds, bool CountsCompDays);
