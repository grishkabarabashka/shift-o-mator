namespace ShiftOMator.Domain;

/// <summary>Half-open [Start, End) absolute-time window.</summary>
public record UtcInterval(DateTimeOffset Start, DateTimeOffset End);
