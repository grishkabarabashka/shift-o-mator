using System.ClientModel;
using Azure.AI.OpenAI;
using Azure.Identity;
using Microsoft.Extensions.AI;
using OpenAI;

namespace ShiftOMator.Api.Insights;

/// <summary>
/// Configuration of the language model the insight endpoints use.
///
/// Bound from the <c>Ai</c> section. A secret never has to sit in a settings file:
/// <c>Ai__ApiKey</c> is an ordinary environment variable and binds to
/// <see cref="ApiKey"/> like everything else, which is why there is no provider-specific
/// key variable to remember.
/// <code>
/// "Ai": { "Provider": "azure-openai", "Endpoint": "https://foo.openai.azure.com/", "Model": "gpt-4o-mini" }
/// "Ai": { "Provider": "openai", "Endpoint": "http://localhost:5272/v1", "Model": "phi-4-mini" }
/// </code>
/// </summary>
public sealed class AiOptions
{
    public const string SectionName = "Ai";

    /// <summary>`azure-openai`, `openai`, or `none` to switch the feature off outright.</summary>
    public string Provider { get; set; } = "none";

    /// <summary>For `azure-openai` this is the *deployment* name, not the model family.</summary>
    public string? Model { get; set; }

    /// <summary>
    /// `azure-openai`: the resource URL, required. `openai`: an optional base URL, which
    /// is what makes any OpenAI-compatible gateway — a hosted one, or a runtime on this
    /// very machine — reachable without another branch.
    /// </summary>
    public string? Endpoint { get; set; }

    public string? ApiKey { get; set; }
}

/// <summary>
/// The configured chat model, resolved once at startup, behind
/// <see cref="IChatClient"/> — the .NET-wide abstraction (Microsoft.Extensions.AI)
/// rather than a provider SDK.
///
/// The point is that which model answers is a deployment decision, not a code one. Going
/// through `IChatClient` means that answer costs a package reference and a config value
/// instead of a rewrite of everything that phrases text. What we give up is
/// provider-specific knobs — worth it here, where the request is one short summarization
/// and the defaults are fine.
///
/// <see cref="Client"/> is null when nothing is configured, and that is a supported
/// state, not a failure: the endpoint answers 503 with a typed code and the panel stays
/// hidden. Planning never depends on a model being reachable.
/// </summary>
public sealed class ChatModel
{
    /// <summary>
    /// Stand-in credential for an endpoint that authenticates nobody — a model runtime on
    /// localhost (Foundry Local, Ollama). The OpenAI client requires *a* credential, so
    /// something has to be handed to it; the value is never sent anywhere that reads it.
    /// </summary>
    private const string NoCredentialPlaceholder = "no-credential-required";

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
            case "none" or "off" or "" or null:
                return new ChatModel(null, null);

            // Azure AI Foundry / Azure OpenAI. Note the asymmetry with the branch below:
            // a missing key here is *normal* — the pod authenticates as itself with the
            // workload identity SQL already uses, so there is no secret to hold. That
            // leaves the endpoint as the thing whose absence means "misconfigured", and it
            // throws rather than quietly disabling the feature.
            case "azure-openai" or "azureopenai" or "azure":
            {
                if (string.IsNullOrWhiteSpace(options.Endpoint))
                    throw new InvalidOperationException(
                        "Ai:Provider is 'azure-openai' but Ai:Endpoint is empty. Set it to the resource URL, e.g. https://<resource>.openai.azure.com/.");

                if (string.IsNullOrWhiteSpace(options.Model))
                    throw new InvalidOperationException(
                        "Ai:Provider is 'azure-openai' but Ai:Model is empty. Set it to the deployment name.");

                var endpoint = new Uri(options.Endpoint);
                AzureOpenAIClient azure = string.IsNullOrWhiteSpace(options.ApiKey)
                    ? new(endpoint, new DefaultAzureCredential())
                    : new(endpoint, new ApiKeyCredential(options.ApiKey));

                return new ChatModel(azure.GetChatClient(options.Model).AsIChatClient(), options.Model);
            }

            // OpenAI itself, or anything speaking its protocol — a corporate gateway,
            // Gemini, LiteLLM, or a runtime on this machine such as Foundry Local or
            // Ollama. One branch covers them all because the only thing that varies is the
            // base URL.
            //
            // "Configured" here means a key *or* an endpoint. Neither is a supported
            // not-configured state — that is the developer machine nobody has set AI up on,
            // and it answers 503 rather than throwing. But an endpoint alone is a complete
            // configuration: a model server on localhost authenticates nobody, and demanding
            // a key it will ignore would make the honest configuration the broken one.
            case "openai" or "openai-compatible":
            {
                var hasKey = !string.IsNullOrWhiteSpace(options.ApiKey);
                var hasEndpoint = !string.IsNullOrWhiteSpace(options.Endpoint);
                if (!hasKey && !hasEndpoint) return new ChatModel(null, null);

                if (string.IsNullOrWhiteSpace(options.Model))
                    throw new InvalidOperationException("Ai:Provider is 'openai' but Ai:Model is empty.");

                OpenAIClientOptions clientOptions = new();
                if (hasEndpoint) clientOptions.Endpoint = new Uri(options.Endpoint!);

                OpenAIClient client = new(
                    new ApiKeyCredential(hasKey ? options.ApiKey! : NoCredentialPlaceholder),
                    clientOptions);
                return new ChatModel(client.GetChatClient(options.Model).AsIChatClient(), options.Model);
            }

            default:
                // NOTE: a different provider is just a reference to its package plus a
                // branch here — everything further up the stack works against IChatClient
                // and stays unchanged. Silently falling back to "disabled" isn't
                // acceptable: a config was requested, so a typo in it must surface, not
                // be swallowed.
                throw new InvalidOperationException(
                    $"Unknown Ai:Provider '{options.Provider}'. Supported: azure-openai, openai, none.");
        }
    }
}
