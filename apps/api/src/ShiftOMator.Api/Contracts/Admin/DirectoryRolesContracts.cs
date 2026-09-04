namespace ShiftOMator.Api.Contracts.Admin;

/// <summary>
/// Whether Entra ID app roles are honoured alongside the grants stored in the database
/// (ADR-0062, ADR-0063). A row rather than configuration, so it is editable here and takes
/// effect on the next request.
/// </summary>
public record DirectoryRolesRequest(bool Enabled);

public record DirectoryRolesResponse(bool Enabled);
