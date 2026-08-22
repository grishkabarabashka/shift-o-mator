using System.Net;

namespace ShiftOMator.Api.Tests;

[Collection("Api")]
public class HealthEndpointsTests(ApiTestFactory factory)
{
    [Fact]
    public async Task Live_returns_200()
    {
        var client = factory.CreateClient();
        var response = await client.GetAsync("/health/live");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Ready_returns_200_once_the_database_is_reachable()
    {
        var client = factory.CreateClient();
        var response = await client.GetAsync("/health/ready");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
