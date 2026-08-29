using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShiftOMator.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Absences",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    PersonId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    EventTypeId = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Portion = table.Column<int>(type: "int", nullable: false),
                    From = table.Column<DateOnly>(type: "date", nullable: false),
                    To = table.Column<DateOnly>(type: "date", nullable: false),
                    Source = table.Column<int>(type: "int", nullable: false),
                    ImportBatchId = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    LastSeenInImportAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    SyncedToHrAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Note = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Version = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Absences", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Acknowledgements",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    IssueKey = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    Comment = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    ByPersonId = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Acknowledgements", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Assignments",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    PersonId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    UnitId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    ShiftId = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    TimeOverride_Start = table.Column<TimeOnly>(type: "time", nullable: true),
                    TimeOverride_End = table.Column<TimeOnly>(type: "time", nullable: true),
                    TimeOverride_CrossesMidnight = table.Column<bool>(type: "bit", nullable: true),
                    IsWeekend = table.Column<bool>(type: "bit", nullable: false),
                    Note = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Source = table.Column<int>(type: "int", nullable: false),
                    Version = table.Column<int>(type: "int", nullable: false),
                    CreatedBy = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedBy = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Assignments", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ChangeHistory",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    EntityType = table.Column<int>(type: "int", nullable: false),
                    EntityId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    Action = table.Column<int>(type: "int", nullable: false),
                    SnapshotJson = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    PersonId = table.Column<string>(type: "nvarchar(450)", nullable: true),
                    AffectedFrom = table.Column<DateOnly>(type: "date", nullable: true),
                    AffectedTo = table.Column<DateOnly>(type: "date", nullable: true),
                    Summary = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ActorId = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChangeHistory", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "CompDayEntries",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    PersonId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    EarnedForAssignmentId = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    EarnedForDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Trigger = table.Column<int>(type: "int", nullable: false),
                    ProposedDate = table.Column<DateOnly>(type: "date", nullable: true),
                    ActualDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Status = table.Column<int>(type: "int", nullable: false),
                    SyncedToHrAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Version = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CompDayEntries", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "DraftSessions",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    EditorPersonId = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    UnitId = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    RangeFrom = table.Column<DateOnly>(type: "date", nullable: false),
                    RangeTo = table.Column<DateOnly>(type: "date", nullable: false),
                    Status = table.Column<int>(type: "int", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DraftSessions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "EventTypes",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    Code = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Label = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    ShortLabel = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Color = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Category = table.Column<int>(type: "int", nullable: false),
                    BlocksAssignment = table.Column<bool>(type: "bit", nullable: false),
                    CountsTowardCapacity = table.Column<bool>(type: "bit", nullable: false),
                    RequiresApproval = table.Column<bool>(type: "bit", nullable: false),
                    AllowsHalfDay = table.Column<bool>(type: "bit", nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EventTypes", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Holidays",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    LocationIds = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    IsFullDay = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Holidays", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Locations",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Country = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    TimeZone = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    HolidayCalendarKey = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    WeekendDays = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Locations", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Notifications",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    RecipientPersonId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    Kind = table.Column<int>(type: "int", nullable: false),
                    Title = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Body = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    SubjectType = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    SubjectId = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ReadAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Channel = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    DeliveredAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    DeliveryAttempts = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Notifications", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "People",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    DisplayName = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Initials = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    EmployeeId = table.Column<string>(type: "nvarchar(450)", nullable: true),
                    UnitId = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    LocationId = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    OrgCategory = table.Column<int>(type: "int", nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    IsIncluded = table.Column<bool>(type: "bit", nullable: false),
                    AvailableWeekdays = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    DefaultShiftId = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    WeekendEligible = table.Column<bool>(type: "bit", nullable: false),
                    Constraints_MinRestHours = table.Column<int>(type: "int", nullable: false),
                    Constraints_MaxConsecutiveDays = table.Column<int>(type: "int", nullable: false),
                    Constraints_MaxWeekendsPerQuarter = table.Column<int>(type: "int", nullable: true),
                    Preferences_AvoidsWeekdays = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Preferences_PreferredPartnerIds = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Preferences_BlackoutDates = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Preferences_Note = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CalendarToken = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    DefaultPresenceTypeId = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    DefaultSiteLocationId = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ManagerId = table.Column<string>(type: "nvarchar(max)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_People", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PlanningUnits",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Kind = table.Column<int>(type: "int", nullable: false),
                    GroupBy = table.Column<int>(type: "int", nullable: false),
                    PrimaryLocationId = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    LocationIds = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    CompOffPolicy_WindowBeforeDays = table.Column<int>(type: "int", nullable: false),
                    CompOffPolicy_WindowAfterDays = table.Column<int>(type: "int", nullable: false),
                    CompOffPolicy_ExcludedWeekdays = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    CompOffPolicy_AgingThresholdDays = table.Column<int>(type: "int", nullable: false),
                    CompOffPolicy_RequiresApprovalWhenNoSlot = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PlanningUnits", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Presence",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    PersonId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    TypeId = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    SiteLocationId = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    SiteLabel = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    From = table.Column<DateOnly>(type: "date", nullable: false),
                    To = table.Column<DateOnly>(type: "date", nullable: false),
                    Source = table.Column<int>(type: "int", nullable: false),
                    Portion = table.Column<int>(type: "int", nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ExternalId = table.Column<string>(type: "nvarchar(450)", nullable: true),
                    LastSeenInSyncAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Note = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Version = table.Column<int>(type: "int", nullable: false),
                    CreatedBy = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedBy = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Presence", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PresenceTypes",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    NamesALocation = table.Column<bool>(type: "bit", nullable: false),
                    CountsAs = table.Column<int>(type: "int", nullable: false),
                    Label = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Glyph = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Color = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    RequiresApproval = table.Column<bool>(type: "bit", nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PresenceTypes", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Requests",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    TypeId = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    SubjectPersonId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    UnitId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    From = table.Column<DateOnly>(type: "date", nullable: false),
                    To = table.Column<DateOnly>(type: "date", nullable: false),
                    Portion = table.Column<int>(type: "int", nullable: false),
                    PayloadJson = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Note = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    State = table.Column<int>(type: "int", nullable: false),
                    FailureReason = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    MaterializedEntityId = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CreatedBy = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    DecidedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Version = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Requests", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "RequestTypes",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    Code = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Label = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Category = table.Column<int>(type: "int", nullable: false),
                    Materializer = table.Column<int>(type: "int", nullable: false),
                    EventTypeId = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    PresenceTypeId = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    SortOrder = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RequestTypes", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "RoleAssignments",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    PersonId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    UnitId = table.Column<string>(type: "nvarchar(450)", nullable: true),
                    Role = table.Column<int>(type: "int", nullable: false),
                    GrantedBy = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    GrantedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RoleAssignments", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "DraftChanges",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    DraftSessionId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    Seq = table.Column<int>(type: "int", nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    TargetType = table.Column<int>(type: "int", nullable: false),
                    Op = table.Column<int>(type: "int", nullable: false),
                    BeforeJson = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    AfterJson = table.Column<string>(type: "nvarchar(max)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DraftChanges", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DraftChanges_DraftSessions_DraftSessionId",
                        column: x => x.DraftSessionId,
                        principalTable: "DraftSessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ShiftEligibilities",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PersonId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    ShiftId = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    TargetShare = table.Column<double>(type: "float", nullable: false),
                    MinPerWeek = table.Column<int>(type: "int", nullable: true),
                    MaxPerWeek = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ShiftEligibilities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ShiftEligibilities_People_PersonId",
                        column: x => x.PersonId,
                        principalTable: "People",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "AbsenceCapacityRules",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    UnitId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    ScopeKind = table.Column<int>(type: "int", nullable: false),
                    ScopeShiftId = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    DurationBucket = table.Column<int>(type: "int", nullable: false),
                    LongThresholdWorkdays = table.Column<int>(type: "int", nullable: false),
                    MaxConcurrent = table.Column<int>(type: "int", nullable: false),
                    CountsEventTypeIds = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    CountsCompDays = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AbsenceCapacityRules", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AbsenceCapacityRules_PlanningUnits_UnitId",
                        column: x => x.UnitId,
                        principalTable: "PlanningUnits",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "DayConfigurations",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    UnitId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    Key = table.Column<int>(type: "int", nullable: false),
                    Weekdays = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: true),
                    Label = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    EffectiveFrom = table.Column<DateOnly>(type: "date", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DayConfigurations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DayConfigurations_PlanningUnits_UnitId",
                        column: x => x.UnitId,
                        principalTable: "PlanningUnits",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "LocationPlanningUnit",
                columns: table => new
                {
                    LocationsId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    PlanningUnitId = table.Column<string>(type: "nvarchar(450)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LocationPlanningUnit", x => new { x.LocationsId, x.PlanningUnitId });
                    table.ForeignKey(
                        name: "FK_LocationPlanningUnit_Locations_LocationsId",
                        column: x => x.LocationsId,
                        principalTable: "Locations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_LocationPlanningUnit_PlanningUnits_PlanningUnitId",
                        column: x => x.PlanningUnitId,
                        principalTable: "PlanningUnits",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Shifts",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    UnitId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    Code = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Label = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Description = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Color = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Hotkey = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    TimeZone = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Start = table.Column<TimeOnly>(type: "time", nullable: false),
                    End = table.Column<TimeOnly>(type: "time", nullable: false),
                    CrossesMidnight = table.Column<bool>(type: "bit", nullable: false),
                    BreakMinutes = table.Column<int>(type: "int", nullable: false),
                    CountsAsCoverage = table.Column<bool>(type: "bit", nullable: false),
                    EditableTime = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Shifts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Shifts_PlanningUnits_UnitId",
                        column: x => x.UnitId,
                        principalTable: "PlanningUnits",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ApprovalDecisions",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    RequestId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    Decision = table.Column<int>(type: "int", nullable: false),
                    ByPersonId = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Comment = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ApprovalDecisions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ApprovalDecisions_Requests_RequestId",
                        column: x => x.RequestId,
                        principalTable: "Requests",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ShiftRequirements",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    DayConfigurationId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    ShiftId = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Min = table.Column<int>(type: "int", nullable: false),
                    Max = table.Column<int>(type: "int", nullable: true),
                    IsDefault = table.Column<bool>(type: "bit", nullable: false),
                    TimingOverrideStart = table.Column<TimeOnly>(type: "time", nullable: true),
                    TimingOverrideEnd = table.Column<TimeOnly>(type: "time", nullable: true),
                    TimingOverrideCrossesMidnight = table.Column<bool>(type: "bit", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ShiftRequirements", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ShiftRequirements_DayConfigurations_DayConfigurationId",
                        column: x => x.DayConfigurationId,
                        principalTable: "DayConfigurations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AbsenceCapacityRules_UnitId",
                table: "AbsenceCapacityRules",
                column: "UnitId");

            migrationBuilder.CreateIndex(
                name: "IX_Absences_PersonId_From",
                table: "Absences",
                columns: new[] { "PersonId", "From" });

            migrationBuilder.CreateIndex(
                name: "IX_Absences_To",
                table: "Absences",
                column: "To");

            migrationBuilder.CreateIndex(
                name: "IX_Acknowledgements_IssueKey",
                table: "Acknowledgements",
                column: "IssueKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ApprovalDecisions_RequestId",
                table: "ApprovalDecisions",
                column: "RequestId");

            migrationBuilder.CreateIndex(
                name: "IX_Assignments_Date",
                table: "Assignments",
                column: "Date");

            migrationBuilder.CreateIndex(
                name: "IX_Assignments_PersonId_Date",
                table: "Assignments",
                columns: new[] { "PersonId", "Date" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Assignments_UnitId_Date",
                table: "Assignments",
                columns: new[] { "UnitId", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_ChangeHistory_At",
                table: "ChangeHistory",
                column: "At");

            migrationBuilder.CreateIndex(
                name: "IX_ChangeHistory_EntityType_EntityId",
                table: "ChangeHistory",
                columns: new[] { "EntityType", "EntityId" });

            migrationBuilder.CreateIndex(
                name: "IX_ChangeHistory_PersonId_AffectedFrom_AffectedTo",
                table: "ChangeHistory",
                columns: new[] { "PersonId", "AffectedFrom", "AffectedTo" });

            migrationBuilder.CreateIndex(
                name: "IX_ChangeHistory_PersonId_At",
                table: "ChangeHistory",
                columns: new[] { "PersonId", "At" });

            migrationBuilder.CreateIndex(
                name: "IX_CompDayEntries_PersonId_EarnedForDate",
                table: "CompDayEntries",
                columns: new[] { "PersonId", "EarnedForDate" });

            migrationBuilder.CreateIndex(
                name: "IX_CompDayEntries_Status",
                table: "CompDayEntries",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_DayConfigurations_UnitId",
                table: "DayConfigurations",
                column: "UnitId");

            migrationBuilder.CreateIndex(
                name: "IX_DraftChanges_DraftSessionId",
                table: "DraftChanges",
                column: "DraftSessionId");

            migrationBuilder.CreateIndex(
                name: "IX_LocationPlanningUnit_PlanningUnitId",
                table: "LocationPlanningUnit",
                column: "PlanningUnitId");

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_CreatedAt",
                table: "Notifications",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_RecipientPersonId_ReadAt",
                table: "Notifications",
                columns: new[] { "RecipientPersonId", "ReadAt" });

            migrationBuilder.CreateIndex(
                name: "IX_People_EmployeeId",
                table: "People",
                column: "EmployeeId",
                unique: true,
                filter: "[EmployeeId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Presence_ExternalId",
                table: "Presence",
                column: "ExternalId",
                unique: true,
                filter: "[ExternalId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Presence_PersonId_From",
                table: "Presence",
                columns: new[] { "PersonId", "From" });

            migrationBuilder.CreateIndex(
                name: "IX_Presence_To",
                table: "Presence",
                column: "To");

            migrationBuilder.CreateIndex(
                name: "IX_Requests_From",
                table: "Requests",
                column: "From");

            migrationBuilder.CreateIndex(
                name: "IX_Requests_State_UnitId",
                table: "Requests",
                columns: new[] { "State", "UnitId" });

            migrationBuilder.CreateIndex(
                name: "IX_Requests_SubjectPersonId_State",
                table: "Requests",
                columns: new[] { "SubjectPersonId", "State" });

            migrationBuilder.CreateIndex(
                name: "IX_RoleAssignments_PersonId",
                table: "RoleAssignments",
                column: "PersonId");

            migrationBuilder.CreateIndex(
                name: "IX_RoleAssignments_PersonId_UnitId_Role",
                table: "RoleAssignments",
                columns: new[] { "PersonId", "UnitId", "Role" },
                unique: true,
                filter: "[UnitId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_RoleAssignments_Role_UnitId",
                table: "RoleAssignments",
                columns: new[] { "Role", "UnitId" });

            migrationBuilder.CreateIndex(
                name: "IX_ShiftEligibilities_PersonId",
                table: "ShiftEligibilities",
                column: "PersonId");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftRequirements_DayConfigurationId",
                table: "ShiftRequirements",
                column: "DayConfigurationId");

            migrationBuilder.CreateIndex(
                name: "IX_Shifts_UnitId",
                table: "Shifts",
                column: "UnitId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AbsenceCapacityRules");

            migrationBuilder.DropTable(
                name: "Absences");

            migrationBuilder.DropTable(
                name: "Acknowledgements");

            migrationBuilder.DropTable(
                name: "ApprovalDecisions");

            migrationBuilder.DropTable(
                name: "Assignments");

            migrationBuilder.DropTable(
                name: "ChangeHistory");

            migrationBuilder.DropTable(
                name: "CompDayEntries");

            migrationBuilder.DropTable(
                name: "DraftChanges");

            migrationBuilder.DropTable(
                name: "EventTypes");

            migrationBuilder.DropTable(
                name: "Holidays");

            migrationBuilder.DropTable(
                name: "LocationPlanningUnit");

            migrationBuilder.DropTable(
                name: "Notifications");

            migrationBuilder.DropTable(
                name: "Presence");

            migrationBuilder.DropTable(
                name: "PresenceTypes");

            migrationBuilder.DropTable(
                name: "RequestTypes");

            migrationBuilder.DropTable(
                name: "RoleAssignments");

            migrationBuilder.DropTable(
                name: "ShiftEligibilities");

            migrationBuilder.DropTable(
                name: "ShiftRequirements");

            migrationBuilder.DropTable(
                name: "Shifts");

            migrationBuilder.DropTable(
                name: "Requests");

            migrationBuilder.DropTable(
                name: "DraftSessions");

            migrationBuilder.DropTable(
                name: "Locations");

            migrationBuilder.DropTable(
                name: "People");

            migrationBuilder.DropTable(
                name: "DayConfigurations");

            migrationBuilder.DropTable(
                name: "PlanningUnits");
        }
    }
}
