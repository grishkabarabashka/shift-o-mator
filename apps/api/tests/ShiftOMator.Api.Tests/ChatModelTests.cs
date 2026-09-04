using Microsoft.Extensions.Configuration;
using ShiftOMator.Api.Insights;

namespace ShiftOMator.Api.Tests;

/// <summary>
/// Resolution of the configured chat model (ADR-0060).
///
/// What these pin down is the deliberate asymmetry between the two providers, which is
/// the part a later edit is most likely to "tidy" into consistency and break: under
/// <c>azure-openai</c> a missing key is the *normal* case (the pod authenticates as
/// itself), so a blank endpoint is what must fail loudly; under <c>openai</c> the key is
/// the whole credential, so its absence means "not configured" and must stay silent.
///
/// No test here reaches a model — <see cref="ChatModel.FromConfiguration"/> only builds
/// clients, it does not call them.
/// </summary>
public class ChatModelTests
{
    private static ChatModel Resolve(params (string Key, string? Value)[] settings) =>
        ChatModel.FromConfiguration(
            new ConfigurationBuilder()
                .AddInMemoryCollection(settings.Select(s => new KeyValuePair<string, string?>(s.Key, s.Value)))
                .Build());

    [Theory]
    [InlineData("none")]
    [InlineData("off")]
    [InlineData("")]
    public void An_explicit_off_switch_disables_the_feature(string provider)
    {
        Assert.False(Resolve(("Ai:Provider", provider)).Configured);
    }

    [Fact]
    public void An_absent_Ai_section_disables_the_feature()
    {
        // The default has to be "off" rather than a provider: an unconfigured deployment
        // must answer 503, not throw at startup for a feature it never asked for.
        Assert.False(Resolve().Configured);
    }

    [Fact]
    public void An_unknown_provider_is_refused_rather_than_swallowed()
    {
        var error = Assert.Throws<InvalidOperationException>(() => Resolve(("Ai:Provider", "bedrock")));
        Assert.Contains("azure-openai, openai, none", error.Message);
    }

    [Fact]
    public void Azure_openai_needs_no_key_and_uses_the_deployment_name_as_the_model_id()
    {
        var model = Resolve(
            ("Ai:Provider", "azure-openai"),
            ("Ai:Endpoint", "https://example.openai.azure.com/"),
            ("Ai:Model", "our-gpt-deployment"));

        Assert.True(model.Configured);
        Assert.Equal("our-gpt-deployment", model.ModelId);
    }

    [Theory]
    [InlineData(null, "a-deployment", "Ai:Endpoint")]
    [InlineData("https://example.openai.azure.com/", null, "Ai:Model")]
    public void Azure_openai_refuses_to_start_without_an_endpoint_or_a_deployment(
        string? endpoint, string? model, string expectedInMessage)
    {
        var error = Assert.Throws<InvalidOperationException>(() => Resolve(
            ("Ai:Provider", "azure-openai"),
            ("Ai:Endpoint", endpoint),
            ("Ai:Model", model)));

        Assert.Contains(expectedInMessage, error.Message);
    }

    [Fact]
    public void Openai_with_neither_a_key_nor_an_endpoint_is_disabled_not_an_error()
    {
        // The developer-machine case: a provider is named but nothing points anywhere, and
        // that has to keep behaving exactly as "off" does.
        Assert.False(Resolve(("Ai:Provider", "openai"), ("Ai:Model", "gpt-4o-mini")).Configured);
    }

    [Fact]
    public void Openai_takes_an_optional_endpoint_so_any_compatible_gateway_is_reachable()
    {
        var model = Resolve(
            ("Ai:Provider", "openai"),
            ("Ai:Model", "some-model"),
            ("Ai:ApiKey", "sk-test"),
            ("Ai:Endpoint", "https://gateway.internal/v1/"));

        Assert.True(model.Configured);
        Assert.Equal("some-model", model.ModelId);
    }

    [Fact]
    public void An_endpoint_alone_is_a_complete_configuration()
    {
        // Foundry Local and Ollama authenticate nobody. Requiring a key they will ignore
        // would make the honest configuration the broken one.
        var model = Resolve(
            ("Ai:Provider", "openai"),
            ("Ai:Model", "phi-4-mini"),
            ("Ai:Endpoint", "http://localhost:5272/v1"));

        Assert.True(model.Configured);
        Assert.Equal("phi-4-mini", model.ModelId);
    }

    [Fact]
    public void The_key_binds_from_the_environment_like_any_other_setting()

    {
        // Ai__ApiKey is the whole mechanism — there is no provider-specific variable to
        // remember, which is the point of dropping ANTHROPIC_API_KEY.
        // AddEnvironmentVariables snapshots the environment at Build(), so the variable
        // has to exist before the builder runs.
        Environment.SetEnvironmentVariable("Ai__ApiKey", "sk-from-env");
        try
        {
            var configuration = new ConfigurationBuilder()
                .AddInMemoryCollection([
                    new KeyValuePair<string, string?>("Ai:Provider", "openai"),
                    new KeyValuePair<string, string?>("Ai:Model", "gpt-4o-mini"),
                ])
                .AddEnvironmentVariables()
                .Build();

            Assert.True(ChatModel.FromConfiguration(configuration).Configured);
        }
        finally
        {
            Environment.SetEnvironmentVariable("Ai__ApiKey", null);
        }
    }
}
