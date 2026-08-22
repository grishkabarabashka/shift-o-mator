using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// Draft → publish → conflict → audit, against the real LocalDB database (Phase 3 plan).
/// The demo seed's own assignments live in August 2026 (see FixtureSeeder remarks), and
/// the database itself is not reset between test runs — so every test draws a fresh
/// random date from a wide future window instead of a fixed one, to stay clear of both
/// the seed and any assignment a previous run of this same suite left behind.
/// </summary>
[Collection("Api")]
public class DraftsEndpointsTests(ApiTestFactory factory)
{
    private const string PersonId = "p-thomas-foley";
    private const string ShiftId = "AMER:Crew";
    private const string UnitId = "unit-amer";

    private static DateOnly NextDate() => new DateOnly(2028, 1, 1).AddDays(Random.Shared.Next(0, 3650));

    private static JsonElement AssignmentPayload(string id, string personId, DateOnly date, string shiftId) =>
        JsonSerializer.SerializeToElement(new
        {
            id,
            personId,
            date = date.ToString("yyyy-MM-dd"),
            unitId = UnitId,
            contentKind = "shift",
            shiftId,
            isWeekend = false,
            source = "manual",
            version = 0,
            createdBy = PersonId,
            createdAt = "2026-01-01T00:00:00Z",
        });

    private async Task<string> OpenDraftAsync(HttpClient client, DateOnly from, DateOnly to)
    {
        var response = await client.PostAsJsonAsync("/api/drafts", new { editorPersonId = PersonId, unitId = UnitId, rangeFrom = from, rangeTo = to });
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("id").GetString()!;
    }

    [Fact]
    public async Task Publish_applies_the_assignment_and_writes_history()
    {
        var client = factory.CreateClient();
        var date = NextDate();
        var assignmentId = $"as-test-{Guid.NewGuid():n}";

        var draftId = await OpenDraftAsync(client, date, date);

        var appendResponse = await client.PostAsJsonAsync($"/api/drafts/{draftId}/changes", new
        {
            targetType = "assignment",
            op = "create",
            entityId = assignmentId,
            after = AssignmentPayload(assignmentId, PersonId, date, ShiftId),
        });
        Assert.Equal(HttpStatusCode.Created, appendResponse.StatusCode);

        var publishResponse = await client.PostAsync($"/api/drafts/{draftId}/publish", null);
        Assert.Equal(HttpStatusCode.OK, publishResponse.StatusCode);

        var publishBody = await publishResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(publishBody.GetProperty("remainingGaps").GetInt32() >= 0);
        var history = publishBody.GetProperty("history").EnumerateArray().ToList();
        Assert.Single(history);
        Assert.Equal("created", history[0].GetProperty("action").GetString());

        var scheduleResponse = await client.GetFromJsonAsync<JsonElement>(
            $"/api/schedule?unitId={UnitId}&from={date:yyyy-MM-dd}&to={date:yyyy-MM-dd}");
        var assignments = scheduleResponse.GetProperty("plan").GetProperty("assignments").EnumerateArray().ToList();
        Assert.Contains(assignments, a => a.GetProperty("id").GetString() == assignmentId);

        // History.At is when the change was *published*, not the date it schedules — a
        // far-future assignment created today shows up under today's date, not its own.
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var historyResponse = await client.GetFromJsonAsync<JsonElement>(
            $"/api/history?from={today.AddDays(-1):yyyy-MM-dd}&to={today.AddDays(1):yyyy-MM-dd}");
        Assert.Contains(historyResponse.EnumerateArray(), h => h.GetProperty("assignmentId").GetString() == assignmentId);
    }

    [Fact]
    public async Task Second_draft_publishing_the_same_cell_gets_409_with_typed_conflicts()
    {
        var client = factory.CreateClient();
        var date = NextDate();
        var idA = $"as-test-{Guid.NewGuid():n}";
        var idB = $"as-test-{Guid.NewGuid():n}";

        var draftA = await OpenDraftAsync(client, date, date);
        var draftB = await OpenDraftAsync(client, date, date);

        (await client.PostAsJsonAsync($"/api/drafts/{draftA}/changes", new
        {
            targetType = "assignment", op = "create", entityId = idA, after = AssignmentPayload(idA, PersonId, date, ShiftId),
        })).EnsureSuccessStatusCode();

        (await client.PostAsJsonAsync($"/api/drafts/{draftB}/changes", new
        {
            targetType = "assignment", op = "create", entityId = idB, after = AssignmentPayload(idB, PersonId, date, ShiftId),
        })).EnsureSuccessStatusCode();

        var publishA = await client.PostAsync($"/api/drafts/{draftA}/publish", null);
        Assert.Equal(HttpStatusCode.OK, publishA.StatusCode);

        var publishB = await client.PostAsync($"/api/drafts/{draftB}/publish", null);
        Assert.Equal(HttpStatusCode.Conflict, publishB.StatusCode);

        var conflictBody = await publishB.Content.ReadFromJsonAsync<JsonElement>();
        var conflicts = conflictBody.GetProperty("conflicts").EnumerateArray().ToList();
        Assert.Single(conflicts);
        Assert.Equal(idB, conflicts[0].GetProperty("entityId").GetString());

        // A failed publish never clears the draft (ADR-0015) — it must still be open,
        // with its change intact, for compare/refresh/reapply.
        var changesResponse = await client.GetFromJsonAsync<JsonElement>($"/api/drafts/{draftB}/changes");
        Assert.Single(changesResponse.EnumerateArray());
    }

    [Fact]
    public async Task Appending_a_shift_from_another_unit_is_rejected_with_a_typed_error()
    {
        var client = factory.CreateClient();
        var date = NextDate();
        var assignmentId = $"as-test-{Guid.NewGuid():n}";
        var draftId = await OpenDraftAsync(client, date, date);

        var response = await client.PostAsJsonAsync($"/api/drafts/{draftId}/changes", new
        {
            targetType = "assignment",
            op = "create",
            entityId = assignmentId,
            after = AssignmentPayload(assignmentId, PersonId, date, "EMEA:Shift-Lead"),
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("SHIFT_OUTSIDE_UNIT", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Discard_leaves_the_plan_untouched()
    {
        var client = factory.CreateClient();
        var date = NextDate();
        var assignmentId = $"as-test-{Guid.NewGuid():n}";
        var draftId = await OpenDraftAsync(client, date, date);

        (await client.PostAsJsonAsync($"/api/drafts/{draftId}/changes", new
        {
            targetType = "assignment", op = "create", entityId = assignmentId, after = AssignmentPayload(assignmentId, PersonId, date, ShiftId),
        })).EnsureSuccessStatusCode();

        var discardResponse = await client.PostAsync($"/api/drafts/{draftId}/discard", null);
        Assert.Equal(HttpStatusCode.OK, discardResponse.StatusCode);

        var scheduleResponse = await client.GetFromJsonAsync<JsonElement>(
            $"/api/schedule?unitId={UnitId}&from={date:yyyy-MM-dd}&to={date:yyyy-MM-dd}");
        var assignments = scheduleResponse.GetProperty("plan").GetProperty("assignments").EnumerateArray().ToList();
        Assert.DoesNotContain(assignments, a => a.GetProperty("id").GetString() == assignmentId);
    }

    [Fact]
    public async Task Schedule_overlays_an_open_draft_without_publishing_it()
    {
        var client = factory.CreateClient();
        var date = NextDate();
        var assignmentId = $"as-test-{Guid.NewGuid():n}";
        var draftId = await OpenDraftAsync(client, date, date);

        (await client.PostAsJsonAsync($"/api/drafts/{draftId}/changes", new
        {
            targetType = "assignment", op = "create", entityId = assignmentId, after = AssignmentPayload(assignmentId, PersonId, date, ShiftId),
        })).EnsureSuccessStatusCode();

        var overlaid = await client.GetFromJsonAsync<JsonElement>(
            $"/api/schedule?unitId={UnitId}&from={date:yyyy-MM-dd}&to={date:yyyy-MM-dd}&draftId={draftId}");
        var overlaidAssignments = overlaid.GetProperty("plan").GetProperty("assignments").EnumerateArray().ToList();
        Assert.Contains(overlaidAssignments, a => a.GetProperty("id").GetString() == assignmentId);

        var withoutDraft = await client.GetFromJsonAsync<JsonElement>(
            $"/api/schedule?unitId={UnitId}&from={date:yyyy-MM-dd}&to={date:yyyy-MM-dd}");
        var plainAssignments = withoutDraft.GetProperty("plan").GetProperty("assignments").EnumerateArray().ToList();
        Assert.DoesNotContain(plainAssignments, a => a.GetProperty("id").GetString() == assignmentId);
    }
}
