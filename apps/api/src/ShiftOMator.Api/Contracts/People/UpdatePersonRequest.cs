using ShiftOMator.Domain;

namespace ShiftOMator.Api.Contracts.People;

public record ShiftEligibilityRequest(string ShiftId, double TargetShare, int? MinPerWeek, int? MaxPerWeek);

public record PersonPreferencesRequest(
    List<IsoWeekday>? AvoidsWeekdays, List<string>? PreferredPartnerIds, List<DateOnly>? BlackoutDates, string? Note);

/// <summary>
/// The three numbers <c>Validator</c> raises rest, consecutive-day and weekend-load issues
/// against. They were stored per person, read on every validate, and writable by nothing
/// but the fixture — so a warning could name a limit nobody in the product could change.
/// Optional: a caller that omits it leaves the person's limits as they are.
/// </summary>
public record PersonConstraintsRequest(int MinRestHours, int MaxConsecutiveDays, int? MaxWeekendsPerQuarter);

/// <summary>Person-profile editing (`repository.ts`'s `savePerson`): target shares,
/// available weekdays, preferences. Not the admin CRUD surface (Phase 6,
/// <c>/api/admin/people</c>) — this is the one mutable slice the People page edits.</summary>
public record UpdatePersonRequest(
    List<ShiftEligibilityRequest> Eligibility,
    List<IsoWeekday> AvailableWeekdays,
    string? DefaultShiftId,
    bool WeekendEligible,
    PersonPreferencesRequest? Preferences,
    PersonConstraintsRequest? Constraints = null);
