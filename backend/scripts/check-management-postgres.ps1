param([string]$PostgresBin = 'C:\Program Files\PostgreSQL\18\bin')
$ErrorActionPreference = 'Stop'
$clusterPath = Join-Path ([System.IO.Path]::GetTempPath()) ('ges-management-isolated-' + [guid]::NewGuid().ToString('N'))
$auditPort = Get-Random -Minimum 55000 -Maximum 59999
$pgCtl = Join-Path $PostgresBin 'pg_ctl.exe'
$psql = Join-Path $PostgresBin 'psql.exe'
$started = $false
$previousUrl = $env:DATABASE_URL
$previousAutomation = $env:AUTO_EMAIL_ENABLED
try {
  $env:AUTO_EMAIL_ENABLED = 'false'
  $env:PGCLIENTENCODING = 'UTF8'
  $env:PGCONNECT_TIMEOUT = '5'
  & (Join-Path $PostgresBin 'initdb.exe') -D $clusterPath -U ges_test -A trust --no-locale -E UTF8 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar la instancia temporal.' }
  # NUL evita que el servidor de fondo herede la tubería de PowerShell y bloquee su finalización.
  node (Join-Path $PSScriptRoot 'postgres-test-control.cjs') $pgCtl -D $clusterPath -l (Join-Path $clusterPath 'postgres.log') -o "-h 127.0.0.1 -p $auditPort -c cluster_name=ges_management_isolated" -w -t 15 start
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar la instancia temporal.' }
  $started = $true
  & (Join-Path $PostgresBin 'createdb.exe') -h 127.0.0.1 -p $auditPort -U ges_test ges_management_isolated
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear la base aislada.' }
  $migrationRoot = Join-Path $PSScriptRoot '..\prisma\migrations'
  foreach ($migration in (Get-ChildItem -LiteralPath $migrationRoot -Directory | Where-Object Name -lt '20261103120000_guarantee_management_timeline' | Sort-Object Name)) {
    & $psql -X -h 127.0.0.1 -p $auditPort -U ges_test -d ges_management_isolated -v ON_ERROR_STOP=1 -f (Join-Path $migration.FullName 'migration.sql') | Out-Null
    if ($LASTEXITCODE -ne 0) { throw ('Falló una migración anterior en la base aislada: ' + $migration.Name) }
  }
  $env:GES_MANAGEMENT_TEST_DATABASE_URL = "postgresql://ges_test@127.0.0.1:$auditPort/ges_management_isolated?schema=public"
  $env:GES_TEST_PSQL = $psql
  $env:DATABASE_URL = $env:GES_MANAGEMENT_TEST_DATABASE_URL
  & (Join-Path $PSScriptRoot '..\node_modules\.bin\tsx.cmd') (Join-Path $PSScriptRoot 'check-management-postgres.ts')
  if ($LASTEXITCODE -ne 0) { throw 'Falló la verificación de integración en PostgreSQL aislado.' }
} finally {
  if ($started) {
    node (Join-Path $PSScriptRoot 'postgres-test-control.cjs') $pgCtl -D $clusterPath -m fast -w -t 15 stop
    if ($LASTEXITCODE -ne 0) { Write-Warning ('Revisar detención del clúster temporal: ' + $clusterPath) }
  }
  $env:DATABASE_URL = $previousUrl
  $env:AUTO_EMAIL_ENABLED = $previousAutomation
  Remove-Item Env:GES_MANAGEMENT_TEST_DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:GES_TEST_PSQL -ErrorAction SilentlyContinue
  # Conserva archivos temporales de diagnóstico; no elimina directorios ni toca clústeres existentes.
}
