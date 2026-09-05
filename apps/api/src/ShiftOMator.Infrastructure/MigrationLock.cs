using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Logging;

namespace ShiftOMator.Infrastructure;

/// <summary>
/// Serialises the startup migrate-and-seed across replicas, using a SQL Server session
/// application lock.
///
/// WHY: migrations and reference seeding run in <c>Program.cs</c> at container start, in
/// every replica. One pod is the development case and hides the problem; the Helm chart
/// defaults to two API replicas, which start at the same moment against the same empty
/// database. Both then run <c>CREATE TABLE</c> for the same tables and one loses — the
/// error is "There is already an object named 'Absences'", the same badly-signposted
/// message <c>EnsureSchemaIsReconcilableAsync</c> exists to explain, arriving for a
/// completely different reason. The seeder is idempotent but not concurrency-safe either:
/// two pods can both find a fixed-id row absent and both insert it.
///
/// WHY an application lock and not a migration Job: a Helm hook Job would need the app to
/// grow a migrate-only mode, a second pod spec, a second identity binding and an ordering
/// contract with the release — machinery to arbitrate a race the database can already
/// arbitrate. The lock is held on one connection, released when it closes, and needs
/// nothing outside the process. Worth revisiting if migrations ever grow slow enough that
/// holding a rollout behind them is the wrong trade.
///
/// The lock is best-effort by design: if it cannot be taken — the database does not exist
/// yet (LocalDB creates it *during* migration), the provider is not SQL Server, or the
/// wait elapses — this logs and lets the caller proceed. Failing startup over a lock would
/// turn a rare race into a certain outage.
/// </summary>
public sealed class MigrationLock : IAsyncDisposable
{
    private const string Resource = "ShiftOMator:Migrate";

    // Long enough to sit through another replica's whole migration on a cold Azure SQL
    // Serverless database (auto-pause resume plus schema creation), short enough that a
    // lock left behind by something else does not hold a rollout open indefinitely.
    private static readonly TimeSpan Wait = TimeSpan.FromMinutes(4);

    private readonly DatabaseFacade? _database;
    private readonly ILogger _logger;

    private MigrationLock(DatabaseFacade? database, ILogger logger)
    {
        _database = database;
        _logger = logger;
    }

    /// <summary>Takes the lock if it can, and returns a handle that releases it on dispose.</summary>
    public static async Task<MigrationLock> AcquireAsync(
        DatabaseFacade database,
        ILogger logger,
        CancellationToken ct = default)
    {
        // Not SQL Server (the in-memory provider some tests use), or no database to lock
        // against yet — LocalDB creates it during the migration itself.
        if (!database.IsSqlServer()) return new MigrationLock(null, logger);
        if (!await database.CanConnectAsync(ct)) return new MigrationLock(null, logger);

        try
        {
            // The lock lives for the life of the *session*, so the connection has to stay
            // open across the migration. OpenConnectionAsync makes EF treat it as
            // externally owned, so MigrateAsync reuses it instead of opening its own.
            await database.OpenConnectionAsync(ct);

            // @LockOwner='Session' rather than 'Transaction': MigrateAsync runs its own
            // transactions, and a transaction-owned lock would be released by the first of
            // them to commit, part-way through.
            //
            // sp_getapplock reports a timeout as a negative return value, not as an error,
            // so the RAISERROR is what turns "did not get the lock" into something the
            // catch below can degrade on.
            await database.ExecuteSqlRawAsync(
                """
                DECLARE @result int;
                EXEC @result = sp_getapplock
                    @Resource = {0}, @LockMode = 'Exclusive',
                    @LockOwner = 'Session', @LockTimeout = {1};
                IF @result < 0 RAISERROR('sp_getapplock returned %d', 16, 1, @result);
                """,
                [Resource, (int)Wait.TotalMilliseconds],
                ct);

            logger.LogInformation("Startup migration lock acquired.");
            return new MigrationLock(database, logger);
        }
        catch (Exception ex)
        {
            logger.LogWarning(
                ex,
                "Could not take the startup migration lock; proceeding without it. "
                + "Concurrent replicas may race on the first migration of an empty database.");
            try { await database.CloseConnectionAsync(); } catch { /* nothing left to do */ }
            return new MigrationLock(null, logger);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_database is null) return;

        try
        {
            await _database.ExecuteSqlRawAsync(
                "EXEC sp_releaseapplock @Resource = {0}, @LockOwner = 'Session';", [Resource]);
        }
        catch (Exception ex)
        {
            // Closing the connection releases a session lock anyway, so this is tidy-up
            // failing, not correctness.
            _logger.LogWarning(ex, "Releasing the startup migration lock failed; closing the connection releases it.");
        }
        finally
        {
            try { await _database.CloseConnectionAsync(); } catch { /* nothing left to do */ }
        }
    }
}
