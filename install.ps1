# Potok Video — instalacja pomocnika na Windows (Brave + Chrome)
$ErrorActionPreference = 'Stop'
$ExtId    = 'mblaggcfnacfohhkkkgonhilbmfolbba'
$HostName = 'com.potok.video'
$Dir      = $PSScriptRoot
$App      = Join-Path $env:LOCALAPPDATA 'PotokVideo'
$DocsDir  = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Potok Video'
$ExtDest  = Join-Path $DocsDir 'wtyczka'

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User') + ';' +
                (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links')
}
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Find-Python {
    $c = Get-Command python -All -ErrorAction SilentlyContinue |
         Where-Object { $_.Source -notlike '*WindowsApps*' } | Select-Object -First 1
    if ($c) { return $c.Source }
    if (Has 'py') {
        try { $p = & py -3 -c "import sys; print(sys.executable)" 2>$null; if ($p -and (Test-Path $p)) { return $p.Trim() } } catch {}
    }
    return $null
}

Write-Host ''
Write-Host '== Potok Video: instalacja ==' -ForegroundColor Green
Write-Host ''

if (-not (Has 'winget')) {
    Write-Host '[X] Brak programu winget. Zainstaluj "Instalator aplikacji" (App Installer) ze Sklepu Microsoft i uruchom ponownie.' -ForegroundColor Red
    exit 1
}

# 1. Narzędzia: yt-dlp (pobieranie), ffmpeg (łączenie obrazu i dźwięku), deno (wymagany przez yt-dlp do YouTube)
Refresh-Path
$tools = @(
    @{ id = 'yt-dlp.yt-dlp'; cmd = 'yt-dlp' },
    @{ id = 'Gyan.FFmpeg';   cmd = 'ffmpeg' },
    @{ id = 'DenoLand.Deno'; cmd = 'deno' }
)
foreach ($t in $tools) {
    if (Has $t.cmd) { Write-Host "[OK] $($t.cmd)" }
    else {
        Write-Host "--> instaluję $($t.cmd)..."
        winget install --id $t.id -e --silent --accept-source-agreements --accept-package-agreements | Out-Host
        Refresh-Path
    }
}

# 2. Python
$py = Find-Python
if (-not $py) {
    Write-Host '--> instaluję Pythona...'
    winget install --id Python.Python.3.12 -e --silent --scope user --accept-source-agreements --accept-package-agreements | Out-Host
    Refresh-Path
    $py = Find-Python
    if (-not $py) {
        $guess = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
        if (Test-Path $guess) { $py = $guess }
    }
}
if (-not $py) { Write-Host '[X] Nie udało się znaleźć Pythona. Uruchom instalator jeszcze raz.' -ForegroundColor Red; exit 1 }
Write-Host "[OK] Python ($py)"

# 3. Pomocnik
New-Item -ItemType Directory -Force -Path (Join-Path $App 'logs') | Out-Null
Copy-Item (Join-Path $Dir 'host\potok_host.py') (Join-Path $App 'potok_host.py') -Force
$bat = "@echo off`r`nchcp 65001 >nul`r`n`"$py`" -u `"%~dp0potok_host.py`" %*`r`n"
[IO.File]::WriteAllText((Join-Path $App 'potok_host.bat'), $bat, (New-Object Text.UTF8Encoding $false))

$manifestPath = Join-Path $App "$HostName.json"
$manifest = [ordered]@{
    name            = $HostName
    description     = 'Potok Video helper'
    path            = (Join-Path $App 'potok_host.bat')
    type            = 'stdio'
    allowed_origins = @("chrome-extension://$ExtId/")
} | ConvertTo-Json
[IO.File]::WriteAllText($manifestPath, $manifest, (New-Object Text.UTF8Encoding $false))

# 4. Rejestracja w Brave i Chrome
foreach ($k in @('HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts',
                 'HKCU:\Software\Google\Chrome\NativeMessagingHosts')) {
    $key = Join-Path $k $HostName
    New-Item -Path $key -Force | Out-Null
    Set-Item -Path $key -Value $manifestPath
}
Write-Host '[OK] zarejestrowano w Brave i Chrome'

# 5. Wtyczka — kopia w stałym miejscu
if (Test-Path $ExtDest) { Remove-Item $ExtDest -Recurse -Force }
New-Item -ItemType Directory -Force -Path $DocsDir | Out-Null
Copy-Item (Join-Path $Dir 'extension') $ExtDest -Recurse
Write-Host '[OK] wtyczka skopiowana do: Dokumenty\Potok Video\wtyczka'

Write-Host ''
Write-Host 'Pomocnik zainstalowany.' -ForegroundColor Green
Write-Host ''
Write-Host 'Ostatni krok - wgraj wtyczkę do przeglądarki:'
Write-Host '  1. Otwórz adres:  brave://extensions  (w Chrome: chrome://extensions)'
Write-Host '  2. Włącz "Tryb dewelopera" (prawy górny róg)'
Write-Host '  3. Kliknij "Załaduj rozpakowane" i wskaż folder "wtyczka" z okna, które się otworzy'
Write-Host '  4. Przypnij ikonkę (puzzel -> pinezka) i zamknij przeglądarkę całkowicie, potem otwórz ponownie'
Write-Host ''
Start-Process explorer.exe $DocsDir
