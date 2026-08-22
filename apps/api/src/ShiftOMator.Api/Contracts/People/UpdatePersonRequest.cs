using ShiftOMator.Domain;

namespace ShiftOMator.Api.Contracts.People;

public record ShiftEligibilityRequest(string ShiftId, double TargetShare, int? MinPerWeek, int? MaxPerWeek);

public record PersonPreferencesRequest(
    List<IsoWeekday>? AvoidsWeekdays, List<string>? PreferredPartnerIds, List<DateOnly>? BlackoutDates, string? Note);

/// <summary>Person-profile editing (`repository.ts`'s `savePerson`): target shares,
/// available weekdays, preferences. Not the admin CRUD surface (Phase 6,
/// <c>/api/admin/people</c>) — this is the one mutable slice the People page edits.</summary>
public record UpdatePersonRequest(
    List<ShiftEligibilityRequest> Eligibility,
    List<IsoWeekday> AvailableWeekdays,
    string? DefaultShiftId,
    bool WeekendEligible,
    PersonPreferencesRequest? Preferences);
