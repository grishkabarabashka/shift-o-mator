using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using ShiftOMator.Domain;

namespace ShiftOMator.Api.Auth;

/// <summary>
/// Role-hierarchy requirement (Viewer &lt; Planner &lt; Admin): satisfied by the
/// caller's role or anything above it, so a single policy per tier — not one policy per
/// enum value — covers "this endpoint needs Planner or better".
/// </summary>
public class MinimumRoleRequirement(AppRole minimumRole) : IAuthorizationRequirement
{
    public AppRole MinimumRole { get; } = minimumRole;
}

public class MinimumRoleAuthorizationHandler : AuthorizationHandler<MinimumRoleRequirement>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context, MinimumRoleRequirement requirement)
    {
        var roleClaim = context.User.FindFirst(ClaimTypes.Role)?.Value;
        if (roleClaim is not null
            && Enum.TryParse<AppRole>(roleClaim, ignoreCase: true, out var role)
            && role >= requirement.MinimumRole)
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}

/// <summary>Policy names used by <c>RequireAuthorization(...)</c> across the endpoint
/// surface — a stable vocabulary so Phase 6's <c>/api/admin/*</c> endpoints just
/// reference <see cref="AdminOnly"/> rather than defining new policies.</summary>
public static class AuthPolicies
{
    public const string ViewerOrAbove = "ViewerOrAbove";
    public const string PlannerOrAbove = "PlannerOrAbove";
    public const string AdminOnly = "AdminOnly";
}
