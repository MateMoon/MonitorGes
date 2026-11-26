param([string]$PostgresBin = 'C:\Program Files\PostgreSQL\18\bin', [switch]$Retention, [switch]$Resolution, [switch]$Supervision)
$ErrorActionPreference = 'Stop'
$clusterPath = Join-Path ([System.IO.Path]::GetTempPath()) ('ges-rows-isolated-' + [guid]::NewGuid().ToString('N'))
$testPort = Get-Random -Minimum 55000 -Maximum 59999
$pgCtl = Join-Path $PostgresBin 'pg_ctl.exe'
$psql = Join-Path $PostgresBin 'psql.exe'
$started = $false
$previousUrl = $env:DATABASE_URL
$previousAutomation = $env:AUTO_EMAIL_ENABLED
$previousEncoding = $env:PGCLIENTENCODING
$previousTimeout = $env:PGCONNECT_TIMEOUT
$previousRetention = $env:IMPORT_RETENTION_ENABLED
$previousQuality = $env:DATA_QUALITY_ENABLED
try {
  $env:AUTO_EMAIL_ENABLED = 'false'
  $env:IMPORT_RETENTION_ENABLED = 'false'
  $env:DATA_QUALITY_ENABLED = 'false'
  $env:PGCLIENTENCODING = 'UTF8'
  $env:PGCONNECT_TIMEOUT = '5'
  & (Join-Path $PostgresBin 'initdb.exe') -D $clusterPath -U ges_rows -A trust --no-locale -E UTF8 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar PostgreSQL aislado para filas.' }
  node (Join-Path $PSScriptRoot 'postgres-test-control.cjs') $pgCtl -D $clusterPath -l (Join-Path $clusterPath 'postgres.log') -o "-h 127.0.0.1 -p $testPort -c cluster_name=ges_rows_isolated" -w -t 15 start
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar PostgreSQL aislado para filas.' }
  $started = $true
  & (Join-Path $PostgresBin 'createdb.exe') -h 127.0.0.1 -p $testPort -U ges_rows ges_rows_isolated
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear la base aislada.' }
  $env:GES_ROWS_TEST_DATABASE_URL = "postgresql://ges_rows@127.0.0.1:$testPort/ges_rows_isolated?schema=public"
  $env:DATABASE_URL = $env:GES_ROWS_TEST_DATABASE_URL
  # Deploy the actual previous migration history, then seed synthetic records.
  # The Node check applies the new migration through Prisma on those records.
  $baseline = Join-Path $PSScriptRoot ('../.tmp-rows-baseline-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path (Join-Path $baseline 'migrations') | Out-Null
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../prisma/schema.prisma') -Destination (Join-Path $baseline 'schema.prisma')
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../prisma/migrations/migration_lock.toml') -Destination (Join-Path $baseline 'migrations/migration_lock.toml')
  foreach ($migration in (Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '../prisma/migrations') -Directory | Where-Object Name -lt '20261125120000_import_row_persistence' | Sort-Object Name)) {
    $target = Join-Path $baseline ('migrations/' + $migration.Name)
    New-Item -ItemType Directory -Path $target | Out-Null
    Copy-Item -LiteralPath (Join-Path $migration.FullName 'migration.sql') -Destination (Join-Path $target 'migration.sql')
  }
  & node (Join-Path $PSScriptRoot '../node_modules/prisma/build/index.js') migrate deploy --schema (Join-Path $baseline 'schema.prisma') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Fallo del historial anterior en PostgreSQL aislado.' }
  node (Join-Path $PSScriptRoot '../dist/scripts/check-row-persistence-postgres.js')
  if ($LASTEXITCODE -ne 0) { throw 'Fallo de persistencia de filas en PostgreSQL aislado.' }
  if ($Retention -or $Resolution -or $Supervision) {
    node (Join-Path $PSScriptRoot '../dist/scripts/check-import-retention-postgres.js')
    if ($LASTEXITCODE -ne 0) { throw 'Fallo de integración de retención en PostgreSQL aislado.' }
  }
  if ($Resolution -or $Supervision) {
    node (Join-Path $PSScriptRoot '../dist/scripts/check-quality-resolution-postgres.js')
    if ($LASTEXITCODE -ne 0) { throw 'Fallo de resolución operativa en PostgreSQL aislado.' }
  }
  if ($Supervision) {
    node (Join-Path $PSScriptRoot '../dist/scripts/check-supervision-review-postgres.js')
    if ($LASTEXITCODE -ne 0) { throw 'Fallo de cronología de supervisión en PostgreSQL aislado.' }
  }
} finally {
  if ($started) { node (Join-Path $PSScriptRoot 'postgres-test-control.cjs') $pgCtl -D $clusterPath -m fast -w -t 15 stop }
  $env:DATABASE_URL = $previousUrl
  $env:AUTO_EMAIL_ENABLED = $previousAutomation
  $env:PGCLIENTENCODING = $previousEncoding
  $env:PGCONNECT_TIMEOUT = $previousTimeout
  $env:IMPORT_RETENTION_ENABLED = $previousRetention
  $env:DATA_QUALITY_ENABLED = $previousQuality
  Remove-Item Env:GES_ROWS_TEST_DATABASE_URL -ErrorAction SilentlyContinue
  # Retain synthetic diagnostics; never delete or modify an existing cluster.
}
