# ADR-0060. The model is a deployment, not a vendor

**Status:** accepted. Narrows [ADR-0048](0048-ai-explains-the-plan-never-decides-it.md):
the digest-first boundary and the "AI never writes" rule are untouched — only which model
answers, and how it is reached, change here.

## Context

ADR-0048 put every AI surface behind `IChatClient` from `Microsoft.Extensions.AI`
specifically so that the choice of model would cost "a package reference and a config
value instead of a rewrite". That abstraction was never exercised: the one implemented
branch was Anthropic's own SDK, reached over the public internet with a key from
`ANTHROPIC_API_KEY`.

Three things made that the wrong default for this deployment:

- **The model has to be one the organization is allowed to call.** Support-team schedules
  and people's names go into a prompt. That answer is going to be an Azure AI Foundry
  deployment inside the tenant, not a public endpoint.
- **The key was the deployment's only secret.** SQL already authenticates as the pod
  (`Authentication=Active Directory Default`), so one API key was the entire reason the
  Key Vault CSI driver, a `SecretProviderClass`, a synced `Secret` and a volume mount
  existed.
- **A per-provider environment variable is a second configuration mechanism.**
  `ANTHROPIC_API_KEY` was read directly from the environment, bypassing the `Ai:` section
  that configured everything else about the same feature.

## Decision

**Which model answers is `Ai:Provider` plus an endpoint, and the credential is the pod
itself wherever Azure allows it.**

**1. Two providers, plus `none`.**

| `Ai:Provider` | Reaches | Credential |
|---|---|---|
| `azure-openai` | Azure AI Foundry / Azure OpenAI. `Ai:Endpoint` is the resource URL, `Ai:Model` the **deployment** name | `Ai:ApiKey` if set, otherwise `DefaultAzureCredential` |
| `openai` | OpenAI, or anything speaking its protocol — a corporate gateway, LiteLLM, Ollama, Anthropic's own compatibility endpoint. `Ai:Endpoint` optional | `Ai:ApiKey` |
| `none` | nothing; the feature is off | — |

A provider gets a *name* only when it needs different construction. Gemini, Ollama and
Foundry Local are all `openai` with a base URL, and naming them would buy a default at the
cost of a branch that pretends to be a decision.

The `anthropic` branch and the `Anthropic` package are **deleted**. Anthropic models
remain reachable two ways — as a Foundry deployment, or through the `openai` branch
pointed at their OpenAI-compatible endpoint — neither of which needs code.

**2. Azure OpenAI, not Azure AI Inference.** Foundry exposes a second, unified inference
endpoint (`Azure.AI.Inference`) that serves Llama, Mistral, DeepSeek and Cohere alongside
OpenAI models. It was not taken: an OpenAI-model deployment covers a one-shot
summarization completely, and adding it would mean two Azure client libraries, two auth
paths and two branches to keep honest for a capability nobody has asked for. It is one
more `case` the day someone does.

**3. There is no provider-specific key variable.** `Ai__ApiKey` is an ordinary
environment variable that binds to `AiOptions.ApiKey` like any other setting, so a secret
still never has to sit in a settings file — with one mechanism instead of two.

**4. Nothing requires a key, and the two providers detect misconfiguration differently.**
For `azure-openai` no key is the *normal* case (managed identity), so absence of a key
cannot signal misconfiguration; a blank `Ai:Endpoint` or `Ai:Model` throws at startup
instead. For `openai` a key **or** an endpoint counts as configured. An endpoint alone is
not a half-finished setup: a model runtime on localhost — Foundry Local, Ollama —
authenticates nobody, and requiring a key it will ignore would make the honest
configuration the broken one. Only when neither is present does the provider return the
disabled `ChatModel`, which is the developer machine nobody has switched AI on for.

**5. Unconfigured stays a supported state, and outranks being loud.** Helm's prod values
ship `aiProvider: none` with the Azure fields blank and commented, rather than
`azure-openai` with a blank endpoint. The startup throw is right for a *wrong* config and
wrong for an *absent* one: AI is optional by ADR-0048, and an optional feature must not
crash-loop the API that carries it.

**6. The sandbox runs production's shape, and local is free to differ.** Both deployed
environments use `azure-openai`, so the sandbox exercises the credential chain and not
only the deployment — an auth path that is first tried in production is a path nobody has
tested. A free key-based provider was considered for the sandbox and rejected once the
cost was worked out: this workload is one short summarization over a digest, on the order
of a dollar a month, so "free" was buying nothing and paying for it with a second
credential model, a Key Vault and a divergence from production.

Local development is deliberately *not* held to that. It defaults to `none` — AI is
optional and most work never touches an insight surface — and `deploy/README.md` section
2b documents two ways to switch it on: Foundry Local (on-device, free, keyless) or a small
cloud deployment. The choice is a developer's, because the trade-off is theirs: Foundry
Local costs nothing and leaks nothing, the cloud one matches what is deployed.

## Consequences

- **No deployed environment has a secret left.** `azureKeyVault.enabled` is `false` in all
  three values files, and the CSI mount, the `SecretProviderClass` and the synced `Secret`
  disappear with it. The templates are kept and still work — a SQL password, or a model
  reached by key, switches them back on. What remains is a chart that provisions a vault
  for a reason rather than by habit.
- **One new Azure grant:** `Cognitive Services OpenAI User` on the Foundry resource, for
  the same user-assigned identity that already holds the SQL database user. One identity,
  two grants.
- `DefaultAzureCredential` resolves locally through `az login` and in the cluster through
  workload identity — the same property that lets a single SQL connection string work in
  both places, so there is nothing environment-specific to keep in step.
- The dev default becomes `none`, which behaves precisely as the old default did with no
  `ANTHROPIC_API_KEY`: 503 `AI_NOT_CONFIGURED`, panel hidden. It names no provider on
  purpose — the previous default named one and held no key for it, which reads as a
  half-configured system rather than a deliberate off.

## Alternatives

- **Keep the `anthropic` branch alongside the new ones.** Rejected: it is a third code
  path kept alive for a capability the `openai` branch already provides through Anthropic's
  own compatibility endpoint, and its presence invites the key-based configuration this ADR
  exists to remove.
- **A `gemini` provider name.** Briefly implemented, then removed with the decision that
  put both deployed environments on `azure-openai`. It presets a base URL and nothing else,
  so with no environment using it, it was a branch describing a choice nobody had made.
  Gemini remains one `Ai:Endpoint` away.
- **`AddChatClient` with DI-registered middleware** (`UseLogging`, `UseDistributedCache`)
  instead of a hand-rolled `ChatModel` singleton. Rejected for now only because
  `ChatModel.Configured` — the null-client-is-fine state the 503 depends on — has no clean
  expression in a DI registration that must produce an `IChatClient` or fail.
