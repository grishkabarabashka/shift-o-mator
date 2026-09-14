using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using ShiftOMator.Domain;

namespace ShiftOMator.Api.Auth;

/// <summary>
/// Stamps <see cref="ChangeHistoryEntry.ImpersonatedById"/> on every audit row written
/// while an impersonation lens is open (ADR-0069).
///
/// WHY an interceptor and not a parameter: there are about thirty places that write an
/// audit row — every <c>ChangeAudit</c> call site plus <c>DraftService.Publish</c> — and a
/// parameter on each is thirty chances to forget one. A forgotten one is not a cosmetic
/// gap: the audit trail *is* the access control (ADR-0032), so a row that silently omits
/// who was really at the keyboard is the single hole the whole design is built to avoid.
/// One place that cannot be bypassed is worth the indirection.
///
/// It lives in <c>Api</c>, not <c>Infrastructure</c>, because it reads the request's
/// principal — and it reaches the <c>DbContext</c> through the options configured in
/// <c>Program.cs</c>, which is in <c>Api</c> too, so no layering rule bends to allow it.
///
/// Rows that already name an impersonator are left alone. Nothing does that today; the
/// check costs nothing and means a future caller that knows better wins.
/// </summary>
public sealed class ImpersonationAuditInterceptor(IHttpContextAccessor http) : SaveChangesInterceptor
{
    public override InterceptionResult<int> SavingChanges(
        DbContextEventData eventData, InterceptionResult<int> result)
    {
        Stamp(eventData);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result, CancellationToken ct = default)
    {
        Stamp(eventData);
        return base.SavingChangesAsync(eventData, result, ct);
    }

    private void Stamp(DbContextEventData eventData)
    {
        var impersonator = http.HttpContext?.User.ImpersonatorOrNull();
        if (impersonator is null || eventData.Context is null) return;

        foreach (var entry in eventData.Context.ChangeTracker.Entries<ChangeHistoryEntry>())
        {
            if (entry.State == EntityState.Added && entry.Entity.ImpersonatedById is null)
                entry.Entity.ImpersonatedById = impersonator;
        }
    }
}
