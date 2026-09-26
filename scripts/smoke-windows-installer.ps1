param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath
)

$ErrorActionPreference = 'Stop'
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$workDir = Join-Path $tempRoot ("codexmate-installer-smoke-" + [guid]::NewGuid().ToString('N'))
$installDir = Join-Path $workDir 'install'
$marker = Join-Path $workDir '.codexmate-installer-smoke-owned'

New-Item -ItemType Directory -Path $installDir -Force | Out-Null
Set-Content -LiteralPath $marker -Value 'temporary package smoke directory'

try {
  $install = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installDir") -Wait -PassThru
  if ($install.ExitCode -ne 0) { throw "NSIS install failed with exit code $($install.ExitCode)" }

  $app = Join-Path $installDir 'CodexMate.exe'
  if (-not (Test-Path -LiteralPath $app -PathType Leaf)) { throw 'Installed CodexMate.exe is missing' }

  $smokeHome = Join-Path $workDir 'user-data'
  $smokeCodexHome = Join-Path $workDir 'codex-home'
  New-Item -ItemType Directory -Path $smokeHome, $smokeCodexHome -Force | Out-Null
  $previousCodexMateHome = $env:CODEXMATE_HOME
  $previousCodexHome = $env:CODEX_HOME
  try {
    $env:CODEXMATE_HOME = $smokeHome
    $env:CODEX_HOME = $smokeCodexHome
    & node (Join-Path $PSScriptRoot 'smoke-desktop.mjs') $app
    if ($LASTEXITCODE -ne 0) { throw "Installed desktop smoke failed with exit code $LASTEXITCODE" }
  }
  finally {
    $env:CODEXMATE_HOME = $previousCodexMateHome
    $env:CODEX_HOME = $previousCodexHome
  }

  $installPrefix = [IO.Path]::GetFullPath($installDir).TrimEnd('\') + [IO.Path]::DirectorySeparatorChar
  $runningPackageProcesses = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and [IO.Path]::GetFullPath($_.Path).StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase)
  }
  $runningPackageProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  $remainingPackageProcesses = Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and [IO.Path]::GetFullPath($_.Path).StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase)
  }
  if ($remainingPackageProcesses) { throw 'Task-owned packaged app processes remained after desktop smoke' }

  Write-Output 'Windows installer install, packaged Codex runtime, and desktop launch passed.'
}
finally {
  if (Test-Path -LiteralPath $marker -PathType Leaf) {
    $resolvedWorkDir = [IO.Path]::GetFullPath($workDir)
    $tempPrefix = $tempRoot + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedWorkDir.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Refusing to remove a smoke directory outside the system temporary directory'
    }
    $installPrefix = [IO.Path]::GetFullPath($installDir).TrimEnd('\') + [IO.Path]::DirectorySeparatorChar
    $ownedProcesses = Get-Process -ErrorAction SilentlyContinue | Where-Object {
      $_.Path -and [IO.Path]::GetFullPath($_.Path).StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase)
    }
    $ownedProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    $remainingProcesses = Get-Process -ErrorAction SilentlyContinue | Where-Object {
      $_.Path -and [IO.Path]::GetFullPath($_.Path).StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase)
    }
    if ($remainingProcesses) { throw 'A task-owned packaged app process remained; the marked temporary directory was preserved' }
    Remove-Item -LiteralPath $resolvedWorkDir -Recurse -Force
  }
}
