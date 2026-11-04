param(
  [string]$InstallRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$Pythonw = (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python311\pythonw.exe')
)
$ErrorActionPreference = 'Stop'
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$shell = New-Object -ComObject WScript.Shell
$work = Join-Path $InstallRoot 'desktop'
$bootstrap = Join-Path $work 'bootstrap.py'
$icon = (Join-Path $env:LOCALAPPDATA 'Alembic\app\alembic.exe') + ',0'
if (-not (Test-Path -LiteralPath $Pythonw) -or -not (Test-Path -LiteralPath $bootstrap)) { throw 'Python or Alembic bootstrap is missing' }
foreach ($backend in @('windows','linux')) {
  $link = Join-Path $desktop "al_$backend.lnk"
  $arguments = '"' + $bootstrap + '" --backend ' + $backend
  if (Test-Path -LiteralPath $link) {
    $existing = $shell.CreateShortcut($link)
    if ($existing.TargetPath -ieq $Pythonw -and $existing.Arguments -eq $arguments -and $existing.WorkingDirectory -ieq $work -and $existing.IconLocation -ieq $icon) {
      Write-Output "$link (unchanged)"
      continue
    }
    $backups = Join-Path $env:USERPROFILE '.alembic\shortcut-backups'
    New-Item -ItemType Directory -Path $backups -Force | Out-Null
    Copy-Item -LiteralPath $link -Destination (Join-Path $backups ("al_$backend-" + (Get-Date -Format 'yyyyMMdd-HHmmss-fffffff') + '.lnk'))
  }
  $shortcut = $shell.CreateShortcut($link)
  $shortcut.TargetPath = $Pythonw
  $shortcut.Arguments = $arguments
  $shortcut.WorkingDirectory = $work
  $shortcut.IconLocation = $icon
  $shortcut.Description = 'Alembic ' + $backend + ' backend'
  $shortcut.Save()
  Write-Output $link
}
