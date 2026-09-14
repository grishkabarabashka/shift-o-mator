using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;

namespace ShiftOMator.Infrastructure;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, string connectionString)
    {
        // WHY the interceptors are wired explicitly rather than left to EF's discovery:
        // EF resolves `IEnumerable<IInterceptor>` from the application container, so an
        // interceptor registered under a *derived* interface — `ISaveChangesInterceptor`,
        // which is the obvious one to reach for — is never found and never runs. Nothing
        // fails; the rows it was meant to stamp are simply written without the stamp.
        // Asking for both here means the registration cannot be subtly wrong (ADR-0069).
        services.AddDbContext<ShiftOMatorDbContext>((provider, options) =>
        {
            options.UseSqlServer(connectionString);
            options.AddInterceptors(provider.GetServices<IInterceptor>());
            options.AddInterceptors(provider.GetServices<ISaveChangesInterceptor>());
        });

        return services;
    }
}
