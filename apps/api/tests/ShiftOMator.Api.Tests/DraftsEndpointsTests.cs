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

    // -- Sync (the declarative path the client actually uses) ------------------

    private static Task<HttpResponseMessage> SyncAsync(HttpClient client, string draftId, params object[] items) =>
        client.PostAsJsonAsync($"/api/drafts/{draftId}/changes/sync", new { changes = items });

    private static object AssignmentItem(string personId, DateOnly date, object? after) =>
        new { targetType = "assignment", key = $"{personId}|{date:yyyy-MM-dd}", after };

    /// <summary>
    /// Repainting a cell the same draft created: the client sends the cell's new state
    /// twice, and the draft ends up holding one change, not a create plus an update
    /// against a row that does not exist in published data yet.
    /// </summary>
    [Fact]
    public async Task Sync_keeps_one_change_per_cell_when_it_is_repainted()
    {
        var client = factory.CreateClient();
        var date = NextDate();
        var draftId = await OpenDraftAsync(client, date, date);

        var firstId = $"as-local-{Guid.NewGuid():n}";
        var secondId = $"as-local-{Guid.NewGuid():n}";
        (await SyncAsync(client, draftId, AssignmentItem(PersonId, date, AssignmentPayload(firstId, PersonId, date, ShiftId))))
            .EnsureSuccessStatusCode();
        var second = await SyncAsync(client, draftId, AssignmentItem(PersonId, date, AssignmentPayload(secondId, PersonId, date, "AMER:Cover")));
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);

        var changes = await client.GetFromJsonAsync<JsonElement>($"/api/drafts/{draftId}/changes");
        var list = changes.EnumerateArray().ToList();
        Assert.Single(list);
        Assert.Equal("create", list[0].GetProperty("op").GetString());

        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync($"/api/drafts/{draftId}/publish", null)).StatusCode);

        var schedule = await client.GetFromJsonAsync<JsonElement>(
            $"/api/schedule?unitId={UnitId}&from={date:yyyy-MM-dd}&to={date:yyyy-MM-dd}");
        var assignments = schedule.GetProperty("plan").GetProperty("assignments").EnumerateArray()
            .Where(a => a.GetProperty("personId").GetString() == PersonId).ToList();
        Assert.Single(assignments);
        Assert.Equal("AMER:Cover", assignments[0].GetProperty("shiftId").GetString());
    }

    /// <summary>
    /// Clearing a published cell and painting it again inside one draft. The client mints
    /// a fresh local id for the repaint; the server keeps editing the published row.
    /// </summary>
    [Fact]
    public async Task Sync_turns_clear_then_repaint_of_a_published_cell_into_one_update()
    {
        var client = factory.CreateClient();
        var date = NextDate();

        var publishedId = $"as-test-{Guid.NewGuid():n}";
        var firstDraft = await OpenDraftAsync(client, date, date);
        (await SyncAsync(client, firstDraft, AssignmentItem(PersonId, date, AssignmentPayload(publishedId, PersonId, date, ShiftId))))
            .EnsureSuccessStatusCode();
        (await client.PostAsync($"/api/drafts/{firstDraft}/publish", null)).EnsureSuccessStatusCode();

        var secondDraft = await OpenDraftAsync(client, date, date);
        (await SyncAsync(client, secondDraft, AssignmentItem(PersonId, date, null))).EnsureSuccessStatusCode();
        var repaintId = $"as-local-{Guid.NewGuid():n}";
        (await SyncAsync(client, secondDraft, AssignmentItem(PersonId, date, AssignmentPayload(repaintId, PersonId, date, "AMER:Cover"))))
            .EnsureSuccessStatusCode();

        var changes = await client.GetFromJsonAsync<JsonElement>($"/api/drafts/{secondDraft}/changes");
        var list = changes.EnumerateArray().ToList();
        Assert.Single(list);
        Assert.Equal("update", list[0].GetProperty("op").GetString());

        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync($"/api/drafts/{secondDraft}/publish", null)).StatusCode);

        var schedule = await client.GetFromJsonAsync<JsonElement>(
            $"/api/schedule?unitId={UnitId}&from={date:yyyy-MM-dd}&to={date:yyyy-MM-dd}");
        var assignments = schedule.GetProperty("plan").GetProperty("assignments").EnumerateArray()
            .Where(a => a.GetProperty("personId").GetString() == PersonId).ToList();
        Assert.Single(assignments);
        Assert.Equal(publishedId, assignments[0].GetProperty("id").GetString());
        Assert.Equal("AMER:Cover", assignments[0].GetProperty("shiftId").GetString());
    }

    /// <summary>A whole painted range in one request — no partial application on a bad
    /// item, which is what made the old per-change loop lose the tail of a batch.</summary>
    [Fact]
    public async Task Sync_rejects_the_whole_batch_when_one_item_is_invalid()
    {
        var client = factory.CreateClient();
        var date = NextDate();
        var draftId = await OpenDraftAsync(client, date, date);

        var goodId = $"as-local-{Guid.NewGuid():n}";
        var badId = $"as-local-{Guid.NewGuid():n}";
        var response = await SyncAsync(
            client,
            draftId,
            AssignmentItem(PersonId, date, AssignmentPayload(goodId, PersonId, date, ShiftId)),
            // EMEA shift on an AMER person — SHIFT_OUTSIDE_UNIT (ADR-0004).
            AssignmentItem(PersonId, date.AddDays(1), AssignmentPayload(badId, PersonId, date.AddDays(1), "EMEA:BM")));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var changes = await client.GetFromJsonAsync<JsonElement>($"/api/drafts/{draftId}/changes");
        Assert.Empty(changes.EnumerateArray());
    }
}
