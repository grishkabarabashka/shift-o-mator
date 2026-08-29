using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ShiftOMator.Domain;
using ShiftOMator.Infrastructure;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// At most one live placement request per comp day (ADR-0056).
///
/// Without this, asking for the 12th and then, having changed your mind, the 19th, left
/// both requests Submitted — and deciding the older one later moved the day back to the
/// 12th, silently undoing a decision that had already been made about the 19th.
/// </summary>
[Collection("Api")]
public class CompDaySupersedeTests(ApiTestFactory factory)
{
    private static int _dayOffset;
    private static readonly int Base = Random.Shared.Next(2000, 3000);

    /// <summary>
    /// Both a per-run random base and a per-test stride, same reason as `NextDate()`
    /// elsewhere: the database persists between runs, and every earned date has to be one
    /// this suite has not used before, this run or any other.
    ///
    /// Snapped to a Wednesday: the default comp-off policy excludes Mondays and Fridays,
    /// and a stride in whole weeks with a random *day* offset meant the weekday a given
    /// run landed on was luck — one run in three or so failed on `EXCLUDED_WEEKDAY` for a
    /// reason that had nothing to do with what the test was checking.
    /// </summary>
    private static DateOnly NextEarnedDate()
    {
        var date = DateOnly.FromDateTime(DateTime.UtcNow)
            .AddDays((Base + Interlocked.Increment(ref _dayOffset)) * 7);
        var toWednesday = ((int)DayOfWeek.Wednesday - (int)date.DayOfWeek + 7) % 7;
        return date.AddDays(toWednesday);
    }

    private static async Task<string> MyPersonIdAsync(HttpClient client)
    {
        var me = await client.GetFromJsonAsync<JsonElement>("/api/auth/me");
        return me.GetProperty("personId").GetString()!;
    }

    /// <summary>Writes a comp day directly: there is no admin endpoint for one, because
    /// the accrual only ever comes from a published weekend shift. Straight EF against the
    /// same database the app runs against — the same reasoning <see cref="ApiTestFactory"/>
    /// itself gives for using a real LocalDB rather than an in-memory provider.</summary>
    private async Task<string> SeedCompDayAsync(string personId, DateOnly earnedFor)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ScheduleDbContext>();
        var id = $"cd-test-{Guid.NewGuid():n}";
        db.CompDayEntries.Add(new CompDayEntry
        {
            Id = id,
            PersonId = personId,
            EarnedForAssignmentId = $"as-test-{Guid.NewGuid():n}",
            EarnedForDate = earnedFor,
            Trigger = CompDayTrigger.Saturday,
            ProposedDate = earnedFor.AddDays(4),
            Status = CompDayStatus.Proposed,
            Version = 1,
        });
        await db.SaveChangesAsync();
        return id;
    }

    private async Task<CompDayEntry> CompDayAsync(string id)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ScheduleDbContext>();
        return await db.CompDayEntries.AsNoTracking().SingleAsync(c => c.Id == id);
    }

    private async Task<string> RequestStateAsync(string id)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ScheduleDbContext>();
        var request = await db.Requests.AsNoTracking().SingleAsync(r => r.Id == id);
        return request.State.ToString();
    }

    private async Task CleanupAsync(string compDayId, params string[] requestIds)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ScheduleDbContext>();
        db.ApprovalDecisions.RemoveRange(
            await db.ApprovalDecisions.Where(d => requestIds.Contains(d.RequestId)).ToListAsync());
        db.Requests.RemoveRange(await db.Requests.Where(r => requestIds.Contains(r.Id)).ToListAsync());
        var entry = await db.CompDayEntries.FindAsync([compDayId]);
        if (entry is not null) db.CompDayEntries.Remove(entry);
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Asking_for_a_second_day_cancels_the_request_for_the_first()
    {
        var client = factory.CreateClient();
        var me = await MyPersonIdAsync(client);
        var earned = NextEarnedDate();
        var compDayId = await SeedCompDayAsync(me, earned);
        string? firstId = null;
        string? secondId = null;

        try
        {
            // Both Wednesdays, both inside the ±14-day window: the first request, and one
            // for a different day one week later.
            var first = await client.PostAsJsonAsync("/api/requests", new
            {
                typeId = "rt-comp-day",
                compDayId,
                from = earned.ToString("yyyy-MM-dd"),
                to = earned.ToString("yyyy-MM-dd"),
            });
            if (!first.IsSuccessStatusCode) throw new Exception(await first.Content.ReadAsStringAsync());
            firstId = (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;

            var second = await client.PostAsJsonAsync("/api/requests", new
            {
                typeId = "rt-comp-day",
                compDayId,
                from = earned.AddDays(7).ToString("yyyy-MM-dd"),
                to = earned.AddDays(7).ToString("yyyy-MM-dd"),
            });
            if (!second.IsSuccessStatusCode) throw new Exception(await second.Content.ReadAsStringAsync());
            secondId = (await second.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;

            Assert.Equal("Cancelled", await RequestStateAsync(firstId));
            Assert.Equal("Submitted", await RequestStateAsync(secondId));
        }
        finally
        {
            var ids = new[] { firstId, secondId }.Where(id => id is not null).Select(id => id!).ToArray();
            await CleanupAsync(compDayId, ids);
        }
    }

    [Fact]
    public async Task Deciding_a_superseded_request_is_refused()
    {
        // Cancelled is a decided state as far as `Decide` is concerned — this is the same
        // path a stale browser tab or a race between two approvers would hit, and it
        // should read as "already settled", not silently move the day.
        var client = factory.CreateClient();
        var me = await MyPersonIdAsync(client);
        var earned = NextEarnedDate();
        var compDayId = await SeedCompDayAsync(me, earned);
        string? firstId = null;
        string? secondId = null;

        try
        {
            var first = await client.PostAsJsonAsync("/api/requests", new
            {
                typeId = "rt-comp-day",
                compDayId,
                from = earned.ToString("yyyy-MM-dd"),
                to = earned.ToString("yyyy-MM-dd"),
            });
            if (!first.IsSuccessStatusCode) throw new Exception(await first.Content.ReadAsStringAsync());
            firstId = (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;

            var second = await client.PostAsJsonAsync("/api/requests", new
            {
                typeId = "rt-comp-day",
                compDayId,
                from = earned.AddDays(7).ToString("yyyy-MM-dd"),
                to = earned.AddDays(7).ToString("yyyy-MM-dd"),
            });
            if (!second.IsSuccessStatusCode) throw new Exception(await second.Content.ReadAsStringAsync());
            secondId = (await second.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString()!;

            var decide = await client.PostAsJsonAsync($"/api/requests/{firstId}/decide", new { decision = "approve" });
            Assert.Equal(System.Net.HttpStatusCode.BadRequest, decide.StatusCode);
            var body = await decide.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal("REQUEST_NOT_PENDING", body.GetProperty("code").GetString());

            // And deciding the survivor places the day where it actually asked to go.
            var decideSecond = await client.PostAsJsonAsync($"/api/requests/{secondId}/decide", new { decision = "approve" });
            decideSecond.EnsureSuccessStatusCode();

            var entry = await CompDayAsync(compDayId);
            Assert.Equal(CompDayStatus.Scheduled, entry.Status);
            Assert.Equal(earned.AddDays(7), entry.ActualDate);
        }
        finally
        {
            var ids = new[] { firstId, secondId }.Where(id => id is not null).Select(id => id!).ToArray();
            await CleanupAsync(compDayId, ids);
        }
    }
}
