namespace ShiftOMator.Api.Contracts.Acknowledgements;

/// <summary>The acknowledging person is the authenticated caller, not a payload field
/// (ADR-0039) — "who decided to accept this warning" is the entire value of the record.</summary>
public record AcknowledgeRequest(string IssueKey, string Comment);
