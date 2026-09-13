# Build context must be the repository root (needs apps/api/src/*).
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY apps/api/src/ShiftOMator.Domain/*.csproj ShiftOMator.Domain/
COPY apps/api/src/ShiftOMator.Application/*.csproj ShiftOMator.Application/
COPY apps/api/src/ShiftOMator.Infrastructure/*.csproj ShiftOMator.Infrastructure/
COPY apps/api/src/ShiftOMator.Api/*.csproj ShiftOMator.Api/
RUN dotnet restore ShiftOMator.Api/ShiftOMator.Api.csproj

COPY apps/api/src/ ./
RUN dotnet publish ShiftOMator.Api/ShiftOMator.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

COPY --from=build /app ./
# `app` is the runtime image's own user, uid **1654** (`APP_UID`), not a uid this file
# picks: creating one at 1000 fails here, because the group name is already taken. The Helm
# chart has to pin the same number (`api.runAsUser`) — pinned at 1000 the process cannot
# read its own $HOME (`/home/app`, mode 0750, owned by 1654) and ASP.NET Core silently
# stops persisting DataProtection keys.
RUN chown -R app:app /app
USER app

ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_RUNNING_IN_CONTAINER=true
EXPOSE 8080

# No Docker-level HEALTHCHECK: the aspnet runtime image has no curl/wget, and the
# k8s livenessProbe/readinessProbe (Helm templates) hit /health/live and /health/ready
# over HTTP directly, which is the check that actually matters on AKS.
ENTRYPOINT ["dotnet", "ShiftOMator.Api.dll"]
