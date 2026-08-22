namespace ShiftOMator.Api.Contracts.Shared;

/// <summary>The <c>{ code, id }</c> shape every <c>*_NOT_FOUND</c> 404 returns —
/// <c>Admin.AdminValidation.NotFound</c> and the hand-rolled ones outside Admin/*.</summary>
public record NotFoundResponse(string Code, string Id);
