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

RUN addgroup --system --gid 1000 app && adduser --system --uid 1000 --ingroup app app
COPY --from=build /app ./
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
