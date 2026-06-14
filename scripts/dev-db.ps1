<#
.SYNOPSIS
  Cluster Postgres LOCAL e ISOLADO para desenvolvimento, sem Docker.

.DESCRIPTION
  Cria um cluster Postgres próprio do projeto em .devdb (na raiz do repo),
  rodando na porta 5433 — separado de qualquer Postgres principal da máquina.
  Usa os binários de um PostgreSQL já instalado (>= 14). Superusuário postgres/postgres.

  O role de aplicação `app_user` NÃO é criado aqui: ele nasce na migration inicial
  (SQL de RLS). Aqui só provisionamos o cluster + o database vazio.

.PARAMETER Action
  start (padrão) | stop | reset | status

.EXAMPLE
  ./scripts/dev-db.ps1 start
  ./scripts/dev-db.ps1 reset
#>
param(
  [ValidateSet("start", "stop", "reset", "status")]
  [string]$Action = "start"
)

$ErrorActionPreference = "Stop"

$Port = 5433
$DbName = "gestao_comercial"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$DataDir = Join-Path $RepoRoot ".devdb"

function Find-PgBin {
  $cmd = Get-Command pg_ctl -ErrorAction SilentlyContinue
  if ($cmd) { return Split-Path -Parent $cmd.Source }
  foreach ($base in @("C:\Program Files\PostgreSQL", "E:\Program Files\PostgreSQL")) {
    if (Test-Path $base) {
      $v = Get-ChildItem $base -Directory | Sort-Object Name -Descending | Select-Object -First 1
      if ($v -and (Test-Path (Join-Path $v.FullName "bin\pg_ctl.exe"))) {
        return (Join-Path $v.FullName "bin")
      }
    }
  }
  throw "Não encontrei os binários do PostgreSQL. Instale o PostgreSQL ou ajuste o PATH."
}

$Bin = Find-PgBin
$pg_ctl = Join-Path $Bin "pg_ctl.exe"
$initdb = Join-Path $Bin "initdb.exe"
$psql = Join-Path $Bin "psql.exe"
$createdb = Join-Path $Bin "createdb.exe"

function Initialize-Cluster {
  if (Test-Path (Join-Path $DataDir "PG_VERSION")) { return }
  Write-Host "Inicializando cluster em $DataDir ..."
  New-Item -ItemType Directory -Force $DataDir | Out-Null
  $pwfile = Join-Path $env:TEMP "gestao_pg_pw.txt"
  Set-Content -Path $pwfile -Value "postgres" -NoNewline -Encoding ascii
  & $initdb -D $DataDir -U postgres -A scram-sha-256 --pwfile=$pwfile -E UTF8 | Out-Null
  Remove-Item $pwfile -Force
}

function Start-Cluster {
  Initialize-Cluster
  & $pg_ctl -D $DataDir -l (Join-Path $DataDir "server.log") -o "-p $Port" start
  Start-Sleep -Seconds 2
  $env:PGPASSWORD = "postgres"
  $exists = & $psql -h localhost -p $Port -U postgres -d postgres -t -A -c "SELECT 1 FROM pg_database WHERE datname='$DbName';"
  if (-not $exists) {
    & $createdb -h localhost -p $Port -U postgres $DbName
    Write-Host "Database '$DbName' criado."
  }
  Write-Host "Postgres de dev rodando em localhost:$Port (db: $DbName)."
}

function Stop-Cluster {
  if (Test-Path (Join-Path $DataDir "postmaster.pid")) {
    & $pg_ctl -D $DataDir stop -m fast
  } else {
    Write-Host "Cluster não está rodando."
  }
}

switch ($Action) {
  "start" { Start-Cluster }
  "stop" { Stop-Cluster }
  "status" {
    $env:PGPASSWORD = "postgres"
    & (Join-Path $Bin "pg_isready.exe") -h localhost -p $Port
  }
  "reset" {
    Stop-Cluster
    if (Test-Path $DataDir) { Remove-Item -Recurse -Force $DataDir }
    Start-Cluster
  }
}
