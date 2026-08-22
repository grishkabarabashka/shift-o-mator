using Microsoft.EntityFrameworkCore;
using ShiftOMator.Domain;

namespace ShiftOMator.Infrastructure;

public class ScheduleDbContext(DbContextOptions<ScheduleDbContext> options) : DbContext(options)
{
    public DbSet<Location> Locations => Set<Location>();
    public DbSet<Holiday> Holidays => Set<Holiday>();
    public DbSet<Region> Regions => Set<Region>();
    public DbSet<PlanningUnit> PlanningUnits => Set<PlanningUnit>();
    public DbSet<ShiftDefinition> Shifts => Set<ShiftDefinition>();
    public DbSet<ShiftRole> Roles => Set<ShiftRole>();
    public DbSet<DayConfiguration> DayConfigurations => Set<DayConfiguration>();
    public DbSet<RoleRequirement> RoleRequirements => Set<RoleRequirement>();
    public DbSet<AbsenceCapacityRule> AbsenceCapacityRules => Set<AbsenceCapacityRule>();
    public DbSet<Person> People => Set<Person>();
    public DbSet<RoleEligibility> RoleEligibilities => Set<RoleEligibility>();
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

        modelBuilder.Entity<Region>(e =>
        {
            e.HasKey(x => x.Id);
            ConfigureList(e.Property(x => x.LocationIds));
            e.OwnsOne(x => x.CompOffPolicy, p => ConfigureList(p.Property(x => x.ExcludedWeekdays)));

            e.HasMany(x => x.Locations).WithMany();
            e.HasMany(x => x.Roles).WithOne().HasForeignKey(x => x.RegionId);
            e.HasMany(x => x.Shifts).WithOne().HasForeignKey(x => x.RegionId);
            e.HasMany(x => x.DayConfigurations).WithOne().HasForeignKey(x => x.RegionId);
            e.HasMany(x => x.AbsenceCapacityRules).WithOne().HasForeignKey(x => x.RegionId);
        });

        modelBuilder.Entity<PlanningUnit>(e => e.HasKey(x => x.Id));

        modelBuilder.Entity<ShiftDefinition>(e => e.HasKey(x => x.Id));

        modelBuilder.Entity<ShiftRole>(e => e.HasKey(x => x.Id));

        modelBuilder.Entity<DayConfiguration>(e =>
        {
            e.HasKey(x => x.Id);
            ConfigureList(e.Property(x => x.Weekdays));
            e.HasMany(x => x.RoleRequirements).WithOne().HasForeignKey(x => x.DayConfigurationId);
        });

        modelBuilder.Entity<RoleRequirement>(e => e.HasKey(x => x.Id));

        modelBuilder.Entity<AbsenceCapacityRule>(e =>
        {
            e.HasKey(x => x.Id);
            ConfigureList(e.Property(x => x.CountsTypes));
        });

        modelBuilder.Entity<Person>(e =>
        {
            e.HasKey(x => x.Id);
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

        modelBuilder.Entity<RoleEligibility>(e => e.HasKey(x => x.Id));

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
