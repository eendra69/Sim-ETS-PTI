$ErrorActionPreference = 'Stop'

"CREATE TABLE IF NOT EXISTS schema_migrations (migration_name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());" |
  docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
if ($LASTEXITCODE -ne 0) {
  throw 'Could not initialize migration tracking'
}

$migrationFiles = Get-ChildItem -LiteralPath "$PSScriptRoot/migrations" -Filter '*.sql' | Sort-Object Name
foreach ($migrationFile in $migrationFiles) {
  $migrationName = $migrationFile.Name.Replace("'", "''")
  $isApplied = "SELECT 1 FROM schema_migrations WHERE migration_name = '$migrationName';" |
    docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -At -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
  if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect migration state: $($migrationFile.Name)"
  }
  if ((@($isApplied) -join '').Trim() -eq '1') {
    Write-Host "Already applied $($migrationFile.Name)"
    continue
  }

  Write-Host "Applying $($migrationFile.Name)"
  $migrationSql = Get-Content -LiteralPath $migrationFile.FullName -Raw
  "BEGIN;`n$migrationSql`nINSERT INTO schema_migrations (migration_name) VALUES ('$migrationName');`nCOMMIT;" |
    docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
  if ($LASTEXITCODE -ne 0) {
    throw "Migration failed: $($migrationFile.Name)"
  }
}
