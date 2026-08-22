using Anthropic;
using Microsoft.Extensions.AI;

namespace ShiftOMator.Api.Insights;

/// <summary>
/// Configuration of the language model the insight endpoints use.
///
/// Bound from the <c>Ai</c> section; the key may also come from the provider's usual
/// environment variable, so a deployment never has to put a secret in a settings file:
/// <code>
/// "Ai": { "Provider": "anthropic", "Model": "claude-opus-5" }
/// </code>
/// </summary>
public sealed class AiOptions
{
    public const string SectionName = "Ai";

    /// <summary>`anthropic`, or `none` to switch the feature off outright.</summary>
    public string Provider { get; set; } = "anthropic";

    public string? Model { get; set; }

    /// <summary>Prefer the environment variable; this exists for user-secrets.</summary>
    public string? ApiKey { get; set; }
}

/// <summary>
/// The configured chat model, resolved once at startup, behind
/// <see cref="IChatClient"/> — the .NET-wide abstraction (Microsoft.Extensions.AI)
/// rather than a provider SDK.
///
/// The point is that which model answers is a deployment decision, not a code one. This
/// team does not yet know what it will be allowed to call in production; going through
/// `IChatClient` means that answer costs a package reference and a config value instead
/// of a rewrite of everything that phrases text. What we give up is provider-specific
/// knobs (Anthropic's adaptive thinking and effort levels have no portable equivalent) —
/// worth it here, where the request is one short summarization and the defaults are fine.
///
/// <see cref="Client"/> is null when nothing is configured, and that is a supported
/// state, not a failure: the endpoint answers 503 with a typed code and the panel stays
/// hidden. Planning never depends on a model being reachable.
/// </summary>
public sealed class ChatModel
{
    private ChatModel(IChatClient? client, string? modelId)
    {
        Client = client;
        ModelId = modelId;
    }

    public IChatClient? Client { get; }
    public string? ModelId { get; }
    public bool Configured => Client is not null;

    public static ChatModel FromConfiguration(IConfiguration configuration)
    {
        var options = configuration.GetSection(AiOptions.SectionName).Get<AiOptions>() ?? new AiOptions();

        switch (options.Provider?.ToLowerInvariant())
        {
            case "none" or "off" or "":
                return new ChatModel(null, null);

            case "anthropic" or null:
            {
                var apiKey = Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY") ?? options.ApiKey;
                if (string.IsNullOrWhiteSpace(apiKey)) return new ChatModel(null, null);

                var modelId = string.IsNullOrWhiteSpace(options.Model) ? "claude-opus-5" : options.Model;
                AnthropicClient client = new() { ApiKey = apiKey };
                return new ChatModel(client.AsIChatClient(modelId), modelId);
            }

            default:
                // NOTE: a different provider is just a reference to its package plus a
                // branch here — everything further up the stack works against IChatClient
                // and stays unchanged. Silently falling back to "disabled" isn't
                // acceptable: a config was requested, so a typo in it must surface, not
                // be swallowed.
                throw new InvalidOperationException(
                    $"Unknown Ai:Provider '{options.Provider}'. Supported: anthropic, none.");
        }
    }
}
