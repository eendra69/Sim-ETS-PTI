param(
  [Parameter(Mandatory = $true)][string]$BackupFile,
  [string]$Container = 'sim-ets-postgres',
  [string]$Database = 'sim_ets',
  [string]$User = 'sim_ets',
  [switch]$ConfirmRestore
)

$ErrorActionPreference = 'Stop'
if (-not $ConfirmRestore) {
  throw 'Restore replaces objects in the target database. Re-run with -ConfirmRestore.'
}
if ($Database -notmatch '^sim_ets(?:_[a-z0-9_]+)?$') {
  throw "Refusing unexpected database target '$Database'; use sim_ets or an explicitly named sim_ets_* environment."
}
$resolvedBackup = if ([System.IO.Path]::IsPathRooted($BackupFile)) {
  [System.IO.Path]::GetFullPath($BackupFile)
} else {
  [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $BackupFile))
}
if (-not [System.IO.File]::Exists($resolvedBackup)) { throw "Backup not found: $resolvedBackup" }

$containerFile = "/tmp/sim-ets-restore-$([guid]::NewGuid().ToString('N')).dump"
docker cp $resolvedBackup "${Container}:$containerFile"
if ($LASTEXITCODE -ne 0) { throw 'docker cp failed' }
docker exec $Container pg_restore --username=$User --dbname=$Database --clean --if-exists --no-owner $containerFile
$restoreExit = $LASTEXITCODE
docker exec $Container rm $containerFile
if ($restoreExit -ne 0) { throw 'pg_restore failed' }

Write-Output "Restore completed to database '$Database' in container '$Container'."
