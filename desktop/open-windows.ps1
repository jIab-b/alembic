param([Parameter(Mandatory=$true)][string]$LaunchConfig)
$ErrorActionPreference = 'Stop'
$settings = Get-Content -LiteralPath $LaunchConfig -Raw | ConvertFrom-Json
$destination = Join-Path $env:LOCALAPPDATA 'Alembic\app'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
if (-not (Test-Path (Join-Path $destination 'alembic.exe'))) {
    $name = "electron-v$($settings.version)-win32-x64.zip"
    $zip = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'electron\Cache') -Filter $name -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
    if (-not $zip) {
        $zip = Join-Path $env:TEMP $name
        Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/electron/electron/releases/download/v$($settings.version)/$name" -OutFile $zip
    }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant() -ne $settings.checksum) { throw 'Electron runtime checksum mismatch' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $destination)
    Rename-Item -LiteralPath (Join-Path $destination 'electron.exe') -NewName 'alembic.exe'
}
$app = Join-Path $destination 'resources\app'
New-Item -ItemType Directory -Path $app -Force | Out-Null
foreach ($name in @('main.cjs','connection.cjs','preload.cjs','package.json')) { Copy-Item -LiteralPath (Join-Path $settings.package $name) -Destination (Join-Path $app $name) -Force }
$layout = if ($settings.minimal) { '--minimal' } else { '--full' }
$env:ALEMBIC_LAUNCH_URL = $settings.url
$env:ALEMBIC_BACKEND = if ($settings.backend) { $settings.backend } else { 'linux' }
$env:ALEMBIC_SESSION = if ($settings.session -match '^[a-zA-Z0-9_-]+$') { $settings.session } else { [guid]::NewGuid().ToString('N') }
$env:ALEMBIC_STOP_FILE = if ($settings.stopFile) { $settings.stopFile } else { '' }
$arguments = $layout
if ($settings.debugPort) { $arguments += ' --alembic-debug-port ' + [int]$settings.debugPort }
$process = Start-Process -FilePath (Join-Path $destination 'alembic.exe') -ArgumentList $arguments -PassThru -RedirectStandardError (Join-Path $env:TEMP 'alembic-native-stderr.log') -RedirectStandardOutput (Join-Path $env:TEMP 'alembic-native-stdout.log')
Write-Output ("Windows Alembic PID " + $process.Id)
