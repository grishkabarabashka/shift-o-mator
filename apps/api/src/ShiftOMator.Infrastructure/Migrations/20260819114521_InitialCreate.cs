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
                    PersonId = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Type = table.Column<int>(type: "int", nullable: false),
                    From = table.Column<DateOnly>(type: "date", nullable: false),
                    To = table.Column<DateOnly>(type: "date", nullable: false),
                    Source = table.Column<int>(type: "int", nullable: false),
                    ImportBatchId = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    LastSeenInImportAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    SyncedToHrAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Note = table.Column<string>(type: "nvarchar(max)", nullable: true)
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
                name: "AssignmentHistory",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    AssignmentId = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Action = table.Column<int>(type: "int", nullable: false),
                    SnapshotJson = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ActorId = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    At = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AssignmentHistory", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Assignments",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    PersonId = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    UnitId = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    ContentKind = table.Column<int>(type: "int", nullable: false),
                    ShiftId = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    TimeOverride_Start = table.Column<TimeOnly>(type: "time", nullable: true),
                    TimeOverride_End = table.Column<TimeOnly>(type: "time", nullable: true),
                    TimeOverride_CrossesMidnight = table.Column<bool>(type: "bit", nullable: true),
                    Marker = table.Column<int>(type: "int", nullable: true),
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
                name: "CompDayEntries",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    PersonId = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    EarnedForAssignmentId = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    EarnedForDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Trigger = table.Column<int>(type: "int", nullable: false),
                    ProposedDate = table.Column<DateOnly>(type: "date", nullable: true),
                    ActualDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Status = table.Column<int>(type: "int", nullable: false),
                    SyncedToHrAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
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
                name: "People",
                columns: table => new
                {
                    Id = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    DisplayName = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Initials = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    EmployeeId = table.Column<string>(type: "nvarchar(max)", nullable: true),
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
                    CalendarToken = table.Column<string>(type: "nvarchar(max)", nullable: false)
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
                    CountsTypes = table.Column<string>(type: "nvarchar(max)", nullable: false),
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
                name: "IX_Acknowledgements_IssueKey",
                table: "Acknowledgements",
                column: "IssueKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Assignments_PersonId_Date",
                table: "Assignments",
                columns: new[] { "PersonId", "Date" },
                unique: true);

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
                name: "AssignmentHistory");

            migrationBuilder.DropTable(
                name: "Assignments");

            migrationBuilder.DropTable(
                name: "CompDayEntries");

            migrationBuilder.DropTable(
                name: "DraftChanges");

            migrationBuilder.DropTable(
                name: "Holidays");

            migrationBuilder.DropTable(
                name: "LocationPlanningUnit");

            migrationBuilder.DropTable(
                name: "ShiftEligibilities");

            migrationBuilder.DropTable(
                name: "ShiftRequirements");

            migrationBuilder.DropTable(
                name: "Shifts");

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
