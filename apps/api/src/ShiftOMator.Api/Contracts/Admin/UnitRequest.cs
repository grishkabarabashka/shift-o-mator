using ShiftOMator.Domain;

namespace ShiftOMator.Api.Contracts.Admin;

public record CompOffPolicyRequest(
    int WindowBeforeDays, int WindowAfterDays, List<IsoWeekday> ExcludedWeekdays,
    int AgingThresholdDays, bool RequiresApprovalWhenNoSlot);

public record UnitRequest(
    string Name, UnitKind Kind, GroupBy GroupBy, string PrimaryLocationId,
    List<string> LocationIds, CompOffPolicyRequest CompOffPolicy);
