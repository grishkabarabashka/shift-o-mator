namespace ShiftOMator.Api.Tests;

/// <summary>
/// One shared factory across every test class in this assembly. Each `IClassFixture`
/// would otherwise spin up its own `WebApplicationFactory`, and two of them racing
/// `Database.MigrateAsync()` + `FixtureSeeder.SeedAsync()` against the same LocalDB
/// database at once is exactly the duplicate-key error this fixed.
/// </summary>
[CollectionDefinition("Api")]
public class ApiCollection : ICollectionFixture<ApiTestFactory>;
