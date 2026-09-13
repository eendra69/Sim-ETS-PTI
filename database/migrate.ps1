$ErrorActionPreference = 'Stop'

$migrationFiles = Get-ChildItem -LiteralPath "$PSScriptRoot/migrations" -Filter '*.sql' | Sort-Object Name
foreach ($migrationFile in $migrationFiles) {
  Write-Host "Applying $($migrationFile.Name)"
  Get-Content -LiteralPath $migrationFile.FullName -Raw |
    docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
  if ($LASTEXITCODE -ne 0) {
    throw "Migration failed: $($migrationFile.Name)"
  }
}
