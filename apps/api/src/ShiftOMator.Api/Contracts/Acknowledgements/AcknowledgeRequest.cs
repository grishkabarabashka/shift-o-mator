namespace ShiftOMator.Api.Contracts.Acknowledgements;

public record AcknowledgeRequest(string IssueKey, string Comment, string ByPersonId);
