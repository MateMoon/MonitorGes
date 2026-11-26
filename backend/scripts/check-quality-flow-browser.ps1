param([string]$PostgresBin = 'C:\Program Files\PostgreSQL\18\bin')
$ErrorActionPreference = 'Stop'
$taskCluster = Join-Path ([System.IO.Path]::GetTempPath()) ('ges-quality-browser-' + [guid]::NewGuid().ToString('N'))
$taskPort = Get-Random -Minimum 55000 -Maximum 59999
$taskPrevious = @{}
foreach ($taskKey in @('DATABASE_URL','AUTO_EMAIL_ENABLED','EMAIL_DEDUP_ENABLED','DATA_QUALITY_ENABLED','IMPORT_RETENTION_ENABLED','PGCLIENTENCODING','PGCONNECT_TIMEOUT')) { $taskPrevious[$taskKey] = [Environment]::GetEnvironmentVariable($taskKey) }
$taskStarted = $false
try {
  $env:AUTO_EMAIL_ENABLED = 'false'
  $env:EMAIL_DEDUP_ENABLED = 'true'
  $env:DATA_QUALITY_ENABLED = 'true'
  $env:IMPORT_RETENTION_ENABLED = 'true'
  $env:PGCLIENTENCODING = 'UTF8'
  $env:PGCONNECT_TIMEOUT = '5'
  & (Join-Path $PostgresBin 'initdb.exe') -D $taskCluster -U ges_browser -A trust --no-locale -E UTF8 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el cluster aislado del navegador.' }
  node (Join-Path $PSScriptRoot 'postgres-test-control.cjs') (Join-Path $PostgresBin 'pg_ctl.exe') -D $taskCluster -l (Join-Path $taskCluster 'postgres.log') -o "-h 127.0.0.1 -p $taskPort -c cluster_name=ges_quality_browser" -w -t 15 start
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar el cluster aislado del navegador.' }
  $taskStarted = $true
  & (Join-Path $PostgresBin 'createdb.exe') -h 127.0.0.1 -p $taskPort -U ges_browser ges_quality_browser
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear la base aislada del navegador.' }
  $env:GES_BROWSER_TEST_DATABASE_URL = "postgresql://ges_browser@127.0.0.1:$taskPort/ges_quality_browser?schema=public"
  $env:DATABASE_URL = $env:GES_BROWSER_TEST_DATABASE_URL
  node (Join-Path $PSScriptRoot '../node_modules/prisma/build/index.js') migrate deploy --schema (Join-Path $PSScriptRoot '../prisma/schema.prisma') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'No se pudieron aplicar las migraciones en la base aislada.' }
  node (Join-Path $PSScriptRoot 'check-quality-flow-browser.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Falló el recorrido integral del navegador.' }
} finally {
  if ($taskStarted) { node (Join-Path $PSScriptRoot 'postgres-test-control.cjs') (Join-Path $PostgresBin 'pg_ctl.exe') -D $taskCluster -m fast -w -t 15 stop }
  foreach ($taskKey in $taskPrevious.Keys) { [Environment]::SetEnvironmentVariable($taskKey, $taskPrevious[$taskKey]) }
  Remove-Item Env:GES_BROWSER_TEST_DATABASE_URL -ErrorAction SilentlyContinue
}
