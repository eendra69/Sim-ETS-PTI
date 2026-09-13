param(
  [string]$Container = 'sim-ets-postgres',
  [string]$Database = 'sim_ets',
  [string]$User = 'sim_ets',
  [string]$OutputDirectory = 'outputs/backups'
)

$ErrorActionPreference = 'Stop'
$resolvedOutput = if ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
  [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
  [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $OutputDirectory))
}
[System.IO.Directory]::CreateDirectory($resolvedOutput) | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$containerFile = "/tmp/sim-ets-$stamp.dump"
$hostFile = Join-Path $resolvedOutput "sim-ets-$stamp.dump"

docker exec $Container pg_dump --username=$User --dbname=$Database --format=custom --file=$containerFile
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
docker cp "${Container}:$containerFile" $hostFile
if ($LASTEXITCODE -ne 0) { throw 'docker cp failed' }
docker exec $Container rm $containerFile
if ($LASTEXITCODE -ne 0) { throw 'temporary backup cleanup failed' }

Write-Output "Backup created: $hostFile"
