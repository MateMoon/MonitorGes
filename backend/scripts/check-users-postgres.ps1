param([string]$PostgresBin = 'C:\Program Files\PostgreSQL\18\bin')
$ErrorActionPreference = 'Stop'
$testClusterPath = Join-Path ([System.IO.Path]::GetTempPath()) ('ges-users-isolated-' + [guid]::NewGuid().ToString('N'))
$testPort = Get-Random -Minimum 55000 -Maximum 59999
$pgCtl = Join-Path $PostgresBin 'pg_ctl.exe'
$psql = Join-Path $PostgresBin 'psql.exe'
$started = $false
$previousUrl = $env:DATABASE_URL
$previousAutomation = $env:AUTO_EMAIL_ENABLED
$previousEncoding = $env:PGCLIENTENCODING
$previousTimeout = $env:PGCONNECT_TIMEOUT
try {
  $env:AUTO_EMAIL_ENABLED = 'false'
  $env:PGCLIENTENCODING = 'UTF8'
  $env:PGCONNECT_TIMEOUT = '5'
  & (Join-Path $PostgresBin 'initdb.exe') -D $testClusterPath -U ges_test -A trust --no-locale -E UTF8 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar la instancia temporal.' }
  node (Join-Path $PSScriptRoot 'postgres-test-control.cjs') $pgCtl -D $testClusterPath -l (Join-Path $testClusterPath 'postgres.log') -o "-h 127.0.0.1 -p $testPort -c cluster_name=ges_users_isolated" -w -t 15 start
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar la instancia temporal.' }
  $started = $true
  & (Join-Path $PostgresBin 'createdb.exe') -h 127.0.0.1 -p $testPort -U ges_test ges_users_isolated
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear la base aislada.' }
  $migrationRoot = Join-Path $PSScriptRoot '..\prisma\migrations'
  foreach ($migration in (Get-ChildItem -LiteralPath $migrationRoot -Directory | Where-Object Name -lt '20261104120000_user_guarantee_type_assignments' | Sort-Object Name)) {
    & $psql -X -h 127.0.0.1 -p $testPort -U ges_test -d ges_users_isolated -v ON_ERROR_STOP=1 -f (Join-Path $migration.FullName 'migration.sql') | Out-Null
    if ($LASTEXITCODE -ne 0) { throw ('Falló una migración anterior en la base aislada: ' + $migration.Name) }
  }
  $env:GES_USERS_TEST_DATABASE_URL = "postgresql://ges_test@127.0.0.1:$testPort/ges_users_isolated?schema=public"
  $env:GES_TEST_PSQL = $psql
  $env:DATABASE_URL = $env:GES_USERS_TEST_DATABASE_URL
  node (Join-Path $PSScriptRoot '..\dist\scripts\check-users-postgres.js')
  if ($LASTEXITCODE -ne 0) { throw 'Falló la integración de usuarios en PostgreSQL aislado.' }
} finally {
  if ($started) {
    node (Join-Path $PSScriptRoot 'postgres-test-control.cjs') $pgCtl -D $testClusterPath -m fast -w -t 15 stop
    if ($LASTEXITCODE -ne 0) { Write-Warning ('Revisar detención del clúster temporal: ' + $testClusterPath) }
  }
  $env:DATABASE_URL = $previousUrl
  $env:AUTO_EMAIL_ENABLED = $previousAutomation
  $env:PGCLIENTENCODING = $previousEncoding
  $env:PGCONNECT_TIMEOUT = $previousTimeout
  Remove-Item Env:GES_USERS_TEST_DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:GES_TEST_PSQL -ErrorAction SilentlyContinue
  # Conserva los archivos temporales para diagnóstico; no elimina directorios.
}
