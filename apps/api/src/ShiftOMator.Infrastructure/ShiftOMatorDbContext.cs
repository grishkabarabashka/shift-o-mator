using Microsoft.EntityFrameworkCore;
using ShiftOMator.Domain;

namespace ShiftOMator.Infrastructure;

public class ShiftOMatorDbContext(DbContextOptions<ShiftOMatorDbContext> options) : DbContext(options)
{
    public DbSet<Location> Locations => Set<Location>();
    public DbSet<Holiday> Holidays => Set<Holiday>();
    public DbSet<PlanningUnit> PlanningUnits => Set<PlanningUnit>();
    public DbSet<Shift> Shifts => Set<Shift>();
    public DbSet<DayConfiguration> DayConfigurations => Set<DayConfiguration>();
    public DbSet<ShiftRequirement> ShiftRequirements => Set<ShiftRequirement>();
    public DbSet<AbsenceCapacityRule> AbsenceCapacityRules => Set<AbsenceCapacityRule>();
    public DbSet<Person> People => Set<Person>();
    public DbSet<ShiftEligibility> ShiftEligibilities => Set<ShiftEligibility>();
    public DbSet<Assignment> Assignments => Set<Assignment>();
    public DbSet<Absence> Absences => Set<Absence>();
    public DbSet<CompDayEntry> CompDayEntries => Set<CompDayEntry>();
    public DbSet<Acknowledgement> Acknowledgements => Set<Acknowledgement>();
    public DbSet<PresenceRecord> Presence => Set<PresenceRecord>();
    public DbSet<EventType> EventTypes => Set<EventType>();
    public DbSet<PresenceType> PresenceTypes => Set<PresenceType>();
    public DbSet<RequestType> RequestTypes => Set<RequestType>();
    public DbSet<RoleAssignment> RoleAssignments => Set<RoleAssignment>();
    public DbSet<Request> Requests => Set<Request>();
    public DbSet<ApprovalDecision> ApprovalDecisions => Set<ApprovalDecision>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<NotificationDelivery> NotificationDeliveries => Set<NotificationDelivery>();
    public DbSet<NotificationRule> NotificationRules => Set<NotificationRule>();
    public DbSet<ChangeHistoryEntry> ChangeHistory => Set<ChangeHistoryEntry>();
    public DbSet<DraftSession> DraftSessions => Set<DraftSession>();
    public DbSet<DraftChange> DraftChanges => Set<DraftChange>();
    public DbSet<SystemSetup> SystemSetups => Set<SystemSetup>();
    public DbSet<AllowedCalendarHost> AllowedCalendarHosts => Set<AllowedCalendarHost>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Location>(e =>
        {
            e.HasKey(x => x.Id);
            ConfigureList(e.Property(x => x.WeekendDays));
        });

        modelBuilder.Entity<Holiday>(e =>
        {
            e.HasKey(x => x.Id);
            ConfigureList(e.Property(x => x.LocationIds));
        });

        modelBuilder.Entity<PlanningUnit>(e =>
        {
            e.HasKey(x => x.Id);
            ConfigureList(e.Property(x => x.LocationIds));
            e.OwnsOne(x => x.CompOffPolicy, p => ConfigureList(p.Property(x => x.ExcludedWeekdays)));

            // PlanningUnit is now the single rule axis (Region deleted) — it owns
            // shifts, day configurations and absence-capacity rules directly, and is
            // many-to-many with Location (Pune hosts AMER, EMEA and APAC people at once).
            e.HasMany(x => x.Locations).WithMany();
            e.HasMany(x => x.Shifts).WithOne().HasForeignKey(x => x.UnitId);
            e.HasMany(x => x.DayConfigurations).WithOne().HasForeignKey(x => x.UnitId);
            e.HasMany(x => x.AbsenceCapacityRules).WithOne().HasForeignKey(x => x.UnitId);
        });

        modelBuilder.Entity<Shift>(e => e.HasKey(x => x.Id));

        modelBuilder.Entity<DayConfiguration>(e =>
        {
            e.HasKey(x => x.Id);
            ConfigureList(e.Property(x => x.Weekdays));
            e.HasMany(x => x.ShiftRequirements).WithOne().HasForeignKey(x => x.DayConfigurationId);
        });

        modelBuilder.Entity<ShiftRequirement>(e => e.HasKey(x => x.Id));

        modelBuilder.Entity<AbsenceCapacityRule>(e =>
        {
            e.HasKey(x => x.Id);
            ConfigureList(e.Property(x => x.CountsEventTypeIds));
        });

        modelBuilder.Entity<Person>(e =>
        {
            e.HasKey(x => x.Id);
            // Filtered unique index, not a required column: EmployeeId is the external
            // key an HR import will eventually match people by (AbsenceImportDialog's
            // matchPeople already tries it first, client-side, on the honor system) —
            // but it's optional today, and SQL Server's default unique index treats
            // every NULL as distinct from every other NULL only when filtered like this.
            e.HasIndex(x => x.EmployeeId).IsUnique().HasFilter("[EmployeeId] IS NOT NULL");
            // Same shape, different key: Email is what an Entra ID sign-in is matched by
            // (ADR-0058). SQL Server's default collation is case-insensitive, so this
            // index also enforces that two people cannot differ only by casing — which is
            // exactly the guarantee the lookup in ActorResolver needs.
            e.HasIndex(x => x.Email).IsUnique().HasFilter("[Email] IS NOT NULL");
            ConfigureList(e.Property(x => x.AvailableWeekdays));
            e.OwnsOne(x => x.Constraints);
            e.OwnsOne(x => x.Preferences, p =>
            {
                ConfigureList(p.Property(x => x.AvoidsWeekdays));
                ConfigureList(p.Property(x => x.PreferredPartnerIds));
                ConfigureList(p.Property(x => x.BlackoutDates));
            });
            e.HasMany(x => x.Eligibility).WithOne().HasForeignKey(x => x.PersonId);
        });

        modelBuilder.Entity<ShiftEligibility>(e => e.HasKey(x => x.Id));

        modelBuilder.Entity<Assignment>(e =>
        {
            e.HasKey(x => x.Id);
            e.OwnsOne(x => x.TimeOverride);
            // NOTE: exactly one assignment per (person, date) — the same invariant as on
            // the client, except here it's not a convention but a constraint.
            e.HasIndex(x => new { x.PersonId, x.Date }).IsUnique();
            // Every request path is "the plan between two dates" (ADR-0042); without
            // this the scoped load is a clustered scan and the range filter buys nothing.
            e.HasIndex(x => x.Date);
            e.HasIndex(x => new { x.UnitId, x.Date });
        });

        modelBuilder.Entity<Absence>(e =>
        {
            e.HasKey(x => x.Id);
            // Overlap query in ScheduleDatasetLoader, and "my leave" on the People panel.
            e.HasIndex(x => new { x.PersonId, x.From });
            e.HasIndex(x => x.To);
        });

        modelBuilder.Entity<CompDayEntry>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.PersonId, x.EarnedForDate });
            e.HasIndex(x => x.Status);
        });

        modelBuilder.Entity<PresenceRecord>(e =>
        {
            e.HasKey(x => x.Id);
            // Same overlap query shape as Absence: "whose presence covers this window".
            e.HasIndex(x => new { x.PersonId, x.From });
            e.HasIndex(x => x.To);
            // An external sync matches on this; null is unconstrained, same pattern as
            // Person.EmployeeId.
            e.HasIndex(x => x.ExternalId).IsUnique().HasFilter("[ExternalId] IS NOT NULL");
        });

        modelBuilder.Entity<EventType>(e => e.HasKey(x => x.Id));

        modelBuilder.Entity<PresenceType>(e => e.HasKey(x => x.Id));

        modelBuilder.Entity<RequestType>(e => e.HasKey(x => x.Id));

        modelBuilder.Entity<RoleAssignment>(e =>
        {
            e.HasKey(x => x.Id);
            // Read on every authenticated request by RoleClaimsTransformation.
            e.HasIndex(x => x.PersonId);
            // One grant per (person, unit, role): granting the same thing twice is not a
            // stronger grant, and two rows would only ever disagree about who granted it.
            e.HasIndex(x => new { x.PersonId, x.UnitId, x.Role }).IsUnique();
            e.HasIndex(x => new { x.Role, x.UnitId });
        });

        modelBuilder.Entity<Request>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasMany(x => x.Decisions).WithOne().HasForeignKey(x => x.RequestId);
            // "My requests" and "what is waiting on me" are the two queries this table
            // exists to answer; both are indexed rather than scanned.
            e.HasIndex(x => new { x.SubjectPersonId, x.State });
            e.HasIndex(x => new { x.State, x.UnitId });
            e.HasIndex(x => x.From);
        });

        modelBuilder.Entity<ApprovalDecision>(e => e.HasKey(x => x.Id));

        modelBuilder.Entity<Notification>(e =>
        {
            e.HasKey(x => x.Id);
            // Deleting a notification takes its deliveries with it. Nothing deletes one
            // today; the cascade is here so that a retention pass, if it ever arrives,
            // cannot leave deliveries pointing at nothing.
            e.HasMany(x => x.Deliveries).WithOne()
                .HasForeignKey(x => x.NotificationId).OnDelete(DeleteBehavior.Cascade);
            // The bell polls "unread for me" on every render of the shell.
            e.HasIndex(x => new { x.RecipientPersonId, x.ReadAt });
            e.HasIndex(x => x.CreatedAt);
        });

        modelBuilder.Entity<NotificationDelivery>(e =>
        {
            e.HasKey(x => x.Id);
            // What the dispatcher will ask for on every tick (step 3 of ADR-0064), and
            // what the admin log filters by today.
            e.HasIndex(x => new { x.Status, x.CreatedAt });
            e.HasIndex(x => x.NotificationId);
        });

        modelBuilder.Entity<NotificationRule>(e =>
        {
            e.HasKey(x => x.Id);
            // The pair is the real key; the id exists so the seeder and the admin
            // endpoints can address a row the way they address every other row.
            e.HasIndex(x => new { x.Kind, x.Channel }).IsUnique();
        });

        modelBuilder.Entity<Acknowledgement>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.IssueKey).IsUnique();
        });

        modelBuilder.Entity<ChangeHistoryEntry>(e =>
        {
            e.HasKey(x => x.Id);
            // GET /api/history is a range query over an append-only table that only ever
            // grows; it was previously an unindexed scan (ADR-0041).
            e.HasIndex(x => x.At);
            e.HasIndex(x => new { x.PersonId, x.At });
            // The cell timeline: everything about one person over one date span.
            e.HasIndex(x => new { x.PersonId, x.AffectedFrom, x.AffectedTo });
            e.HasIndex(x => new { x.EntityType, x.EntityId });
        });

        modelBuilder.Entity<DraftSession>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasMany(x => x.Changes).WithOne().HasForeignKey(x => x.DraftSessionId);
        });

        modelBuilder.Entity<DraftChange>(e => e.HasKey(x => x.Id));

        // Fixed PK, not a natural key — there is exactly one row, ever (ADR-0059). The
        // fixed key is what makes a concurrent second `POST /api/setup` fail on a
        // duplicate rather than write a second row nobody asked for. `ValueGeneratedNever`
        // because EF's default for an `int` PK is an identity column, which refuses the
        // explicit `Id = 1` this entity always writes.
        modelBuilder.Entity<SystemSetup>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
        });

        modelBuilder.Entity<AllowedCalendarHost>(e =>
        {
            e.HasKey(x => x.Host);
            e.Property(x => x.Host).ValueGeneratedNever();
        });
    }

    private static void ConfigureList<T>(Microsoft.EntityFrameworkCore.Metadata.Builders.PropertyBuilder<List<T>> builder)
    {
        builder.HasConversion(JsonListConverter.For<T>(), JsonListConverter.ComparerFor<T>());
    }
}
