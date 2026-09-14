$ErrorActionPreference = 'Stop'

$seedFiles = @(
  (Join-Path $PSScriptRoot 'seeds/003_synthetic_compliance_2024_2026.sql'),
  (Join-Path $PSScriptRoot 'seeds/004_vintage_installation_2024_2027.sql')
)

foreach ($seedFile in $seedFiles) {
  if (-not (Test-Path -LiteralPath $seedFile)) {
    throw "Synthetic seed was not found: $seedFile"
  }

  Get-Content -LiteralPath $seedFile -Raw |
    docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
  if ($LASTEXITCODE -ne 0) {
    throw "Synthetic seed failed: $seedFile"
  }
}
