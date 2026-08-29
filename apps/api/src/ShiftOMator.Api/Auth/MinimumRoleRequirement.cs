using Microsoft.AspNetCore.Authorization;
using ShiftOMator.Domain;

namespace ShiftOMator.Api.Auth;

/// <summary>
/// "Holds this role in at least one unit."
///
/// WHY it is only "somewhere": an endpoint-level policy runs before the request body is
/// read, so it cannot know which unit is being written to. It is a cheap gate that keeps
/// people with no business here out entirely; the unit-scoped check belongs in the
/// handler, where the unit is known, and is the one that actually decides (ADR-0051).
///
/// This replaces a requirement that compared roles by ordinal, under which Admin
/// satisfied every Planner policy for no reason but enum order.
/// </summary>
public class RoleRequirement(AppRole role) : IAuthorizationRequirement
{
    public AppRole Role { get; } = role;
}

public class RoleAuthorizationHandler : AuthorizationHandler<RoleRequirement>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context, RoleRequirement requirement)
    {
        if (context.User.HasAnywhere(requirement.Role)) context.Succeed(requirement);
        return Task.CompletedTask;
    }
}

/// <summary>Policy names used by <c>RequireAuthorization(...)</c> across the endpoint
/// surface. Each names the role required, not a tier — there are no tiers.</summary>
public static class AuthPolicies
{
    /// <summary>Signed in and mapped to a person. Reading the rota is the product's first
    /// purpose and is not gated further.</summary>
    public const string Authenticated = "Authenticated";

    public const string PlannerSomewhere = "PlannerSomewhere";
    public const string ApproverSomewhere = "ApproverSomewhere";
    public const string AdminSomewhere = "AdminSomewhere";
}
