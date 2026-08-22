using ShiftOMator.Application.Drafts;
using ShiftOMator.Domain;

namespace ShiftOMator.Api.Contracts.Drafts;

public record PublishDraftResponse(
    int RemainingGaps,
    IReadOnlyList<AssignmentHistoryEntry> History,
    IReadOnlyList<CompDayEntry> GeneratedCompDays);

/// <summary>409 body — the draft is left open (ADR-0015), the caller compares
/// <see cref="Conflicts"/> against its own state and republishes.</summary>
public record PublishConflictResponse(IReadOnlyList<DraftService.ConflictDetail> Conflicts);
