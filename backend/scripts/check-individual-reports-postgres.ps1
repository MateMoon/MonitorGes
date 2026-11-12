param([string]$PostgresBin = 'C:\Program Files\PostgreSQL\18\bin', [switch]$Scheduled)
$ErrorActionPreference = 'Stop'
$testDatabase = if ($Scheduled) { 'ges_scheduled_reports_isolated' } else { 'ges_individual_reports_isolated' }
$migrationCutoff = if ($Scheduled) { '20261105150000_scheduled_email_executions' } else { '20261105120000_individual_email_reports' }
$compiledScript = if ($Scheduled) { 'check-scheduled-reports-postgres.js' } else { 'check-individual-reports-postgres.js' }
$testClusterPath = Join-Path ([System.IO.Path]::GetTempPath()) ($testDatabase + '-' + [guid]::NewGuid().ToString('N'))
$testPort = Get-Random -Minimum 55000 -Maximum 59999
$pgCtl = Join-Path $PostgresBin 'pg_ctl.exe'
$psql = Join-Path $PostgresBin 'psql.exe'
$started = $false
$previousUrl = $env:DATABASE_URL
$previousAutomation = $env:AUTO_EMAIL_ENABLED
$previousDedup = $env:EMAIL_DEDUP_ENABLED
$previousEncoding = $env:PGCLIENTENCODING
$previousTimeout = $env:PGCONNECT_TIMEOUT
try {
  $env:AUTO_EMAIL_ENABLED = 'false'
  $env:EMAIL_DEDUP_ENABLED = 'true'
  $env:PGCLIENTENCODING = 'UTF8'
  $env:PGCONNECT_TIMEOUT = '5'
  & (Join-Path $PostgresBin 'initdb.exe') -D $testClusterPath -U ges_test -A trust --no-locale -E UTF8 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar la instancia temporal.' }
  node (Join-Path $PSScriptRoot 'postgres-test-control.cjs') $pgCtl -D $testClusterPath -l (Join-Path $testClusterPath 'postgres.log') -o "-h 127.0.0.1 -p $testPort -c cluster_name=$testDatabase" -w -t 15 start
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar la instancia temporal.' }
  $started = $true
  & (Join-Path $PostgresBin 'createdb.exe') -h 127.0.0.1 -p $testPort -U ges_test $testDatabase
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear la base aislada.' }
  $migrationRoot = Join-Path $PSScriptRoot '..\prisma\migrations'
  foreach ($migration in (Get-ChildItem -LiteralPath $migrationRoot -Directory | Where-Object Name -lt $migrationCutoff | Sort-Object Name)) {
    & $psql -X -h 127.0.0.1 -p $testPort -U ges_test -d $testDatabase -v ON_ERROR_STOP=1 -f (Join-Path $migration.FullName 'migration.sql') | Out-Null
    if ($LASTEXITCODE -ne 0) { throw ('Falló una migración anterior en la base aislada: ' + $migration.Name) }
  }
  $env:GES_INDIVIDUAL_REPORT_TEST_DATABASE_URL = "postgresql://ges_test@127.0.0.1:$testPort/${testDatabase}?schema=public"
  $env:GES_SCHEDULED_REPORT_TEST_DATABASE_URL = $env:GES_INDIVIDUAL_REPORT_TEST_DATABASE_URL
  $env:GES_TEST_PSQL = $psql
  $env:DATABASE_URL = $env:GES_INDIVIDUAL_REPORT_TEST_DATABASE_URL
  node (Join-Path $PSScriptRoot ('..\dist\scripts\' + $compiledScript))
  if ($LASTEXITCODE -ne 0) { throw 'Falló la integración de informes individuales en PostgreSQL aislado.' }
} finally {
  if ($started) {
    node (Join-Path $PSScriptRoot 'postgres-test-control.cjs') $pgCtl -D $testClusterPath -m fast -w -t 15 stop
    if ($LASTEXITCODE -ne 0) { Write-Warning ('Revisar detención del clúster temporal: ' + $testClusterPath) }
  }
  $env:DATABASE_URL = $previousUrl
  $env:AUTO_EMAIL_ENABLED = $previousAutomation
  $env:EMAIL_DEDUP_ENABLED = $previousDedup
  $env:PGCLIENTENCODING = $previousEncoding
  $env:PGCONNECT_TIMEOUT = $previousTimeout
  Remove-Item Env:GES_INDIVIDUAL_REPORT_TEST_DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:GES_SCHEDULED_REPORT_TEST_DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:GES_TEST_PSQL -ErrorAction SilentlyContinue
  # Conserva los archivos temporales para diagnóstico; no elimina directorios.
}
