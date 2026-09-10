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
  $initExitCode = $LASTEXITCODE
  Remove-Item $pwfile -Force
  if ($initExitCode -ne 0) {
    throw "Não consegui inicializar o cluster Postgres em '$DataDir' (initdb saiu com código $initExitCode)."
  }
}

function Test-RealConnection {
  # Único jeito confiável de saber se o banco está utilizável: uma conexão
  # de verdade. Porta aceitando TCP (pg_isready) não é suficiente — foi
  # exatamente essa medida que deu falso positivo com o cluster travado.
  param([string]$Database)
  $env:PGPASSWORD = "postgres"
  & $psql -h localhost -p $Port -U postgres -d $Database -t -A -c "SELECT 1;" *> $null
  return ($LASTEXITCODE -eq 0)
}

function Exit-WithDatabaseFailure {
  param([string]$Reason)
  $logPath = Join-Path $DataDir "server.log"
  Write-Host ""
  Write-Host "ERRO: o banco de dados de desenvolvimento não está utilizável."
  Write-Host $Reason
  Write-Host "Confira o arquivo de log em: $logPath"
  exit 1
}

function Start-Cluster {
  Initialize-Cluster

  $serverLog = Join-Path $DataDir "server.log"
  $pgCtlStdOut = Join-Path $env:TEMP "gestao-comercial-devdb-pgctl-stdout.log"
  $pgCtlStdErr = Join-Path $env:TEMP "gestao-comercial-devdb-pgctl-stderr.log"

  # -ArgumentList como array faz o Start-Process citar cada elemento em
  # separado, e o pg_ctl passa a ler "5433" como se fosse o modo de operação
  # do -o (erro "unrecognized operation mode"). Por isso a linha de opções
  # do pg_ctl vai como uma única string, com as aspas internas preservadas.
  $pgCtlArgs = "start -D `"$DataDir`" -l `"$serverLog`" -o `"-p $Port`" -w -t 90"

  # -NoNewWindow + redirecionamento evita que o pg_ctl herde o console do
  # shell não interativo e prenda a sessão: sem isso, o processo pode nunca
  # devolver o controle mesmo depois de já ter terminado.
  $pgCtlProcess = Start-Process -FilePath $pg_ctl -ArgumentList $pgCtlArgs -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $pgCtlStdOut -RedirectStandardError $pgCtlStdErr

  if ($pgCtlProcess.ExitCode -ne 0) {
    # No Windows, o pg_ctl também sai com código diferente de zero quando o
    # cluster já está no ar (ele tenta reabrir o server.log, que fica
    # travado pelo processo em execução). Por isso esse código não decide
    # sucesso ou falha aqui — quem decide é a conexão real, logo abaixo.
    Write-Host "Aviso: pg_ctl não confirmou a inicialização (código $($pgCtlProcess.ExitCode)). Verificando se o banco já está acessível..."
  }

  $env:PGPASSWORD = "postgres"
  $existsOutput = & $psql -h localhost -p $Port -U postgres -d postgres -t -A -c "SELECT 1 FROM pg_database WHERE datname='$DbName';"
  $existsExitCode = $LASTEXITCODE

  if ($existsExitCode -ne 0) {
    Exit-WithDatabaseFailure "Não consegui conectar ao Postgres em localhost:$Port."
  }

  if (-not $existsOutput -or $existsOutput.Trim() -ne "1") {
    & $createdb -h localhost -p $Port -U postgres $DbName
    if ($LASTEXITCODE -ne 0) {
      Exit-WithDatabaseFailure "Não consegui criar o banco '$DbName' (createdb saiu com código $LASTEXITCODE)."
    }
    Write-Host "Database '$DbName' criado."
  }

  if (-not (Test-RealConnection -Database $DbName)) {
    Exit-WithDatabaseFailure "O banco '$DbName' não respondeu a uma consulta de teste."
  }

  Write-Host "Postgres de dev rodando em localhost:$Port (db: $DbName)."
}

function Stop-Cluster {
  if (Test-Path (Join-Path $DataDir "postmaster.pid")) {
    & $pg_ctl -D $DataDir stop -m fast
    if ($LASTEXITCODE -ne 0) {
      throw "Não consegui parar o Postgres (pg_ctl saiu com código $LASTEXITCODE)."
    }
  } else {
    Write-Host "Cluster não está rodando."
  }
}

switch ($Action) {
  "start" { Start-Cluster }
  "stop" { Stop-Cluster }
  "status" {
    if (Test-RealConnection -Database $DbName) {
      Write-Host "Postgres de dev rodando em localhost:$Port (db: $DbName) e respondendo normalmente."
    } else {
      Exit-WithDatabaseFailure "O banco '$DbName' não respondeu a uma consulta de teste em localhost:$Port."
    }
  }
  "reset" {
    Stop-Cluster
    if (Test-Path $DataDir) { Remove-Item -Recurse -Force $DataDir }
    Start-Cluster
  }
}
