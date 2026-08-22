using Microsoft.EntityFrameworkCore;
using ShiftOMator.Domain;

namespace ShiftOMator.Infrastructure;

public class ScheduleDbContext(DbContextOptions<ScheduleDbContext> options) : DbContext(options)
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
    public DbSet<AssignmentHistoryEntry> AssignmentHistory => Set<AssignmentHistoryEntry>();
    public DbSet<DraftSession> DraftSessions => Set<DraftSession>();
    public DbSet<DraftChange> DraftChanges => Set<DraftChange>();

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
            ConfigureList(e.Property(x => x.CountsTypes));
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
            // Ровно одно назначение на (person, date) — тот же инвариант, что и на
            // клиенте, только здесь он не соглашение, а constraint.
            e.HasIndex(x => new { x.PersonId, x.Date }).IsUnique();
        });

        modelBuilder.Entity<Absence>(e => e.HasKey(x => x.Id));

        modelBuilder.Entity<CompDayEntry>(e => e.HasKey(x => x.Id));

        modelBuilder.Entity<Acknowledgement>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.IssueKey).IsUnique();
        });

        modelBuilder.Entity<AssignmentHistoryEntry>(e => e.HasKey(x => x.Id));

        modelBuilder.Entity<DraftSession>(e =>
        {
            e.HasKey(x => x.Id);
            e.HasMany(x => x.Changes).WithOne().HasForeignKey(x => x.DraftSessionId);
        });

        modelBuilder.Entity<DraftChange>(e => e.HasKey(x => x.Id));
    }

    private static void ConfigureList<T>(Microsoft.EntityFrameworkCore.Metadata.Builders.PropertyBuilder<List<T>> builder)
    {
        builder.HasConversion(JsonListConverter.For<T>(), JsonListConverter.ComparerFor<T>());
    }
}
