namespace ShiftOMator.Application.Drafts;

/// <summary>
/// A clean, typed rejection for a draft mutation that can never be valid, regardless of
/// timing — a role outside the person's region, a cell already occupied within the same
/// draft, a malformed op/payload combination. Distinct from a publish-time
/// <see cref="DraftService.ConflictDetail"/>, which is about the plan having moved since
/// the draft was opened, not about the change being wrong on its face.
/// </summary>
public class DraftDomainException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
