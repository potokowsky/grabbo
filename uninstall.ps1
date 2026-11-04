# Usuwa pomocnika Grabbo (nie rusza pobranych plików ani yt-dlp/ffmpeg)
$App = Join-Path $env:LOCALAPPDATA 'Grabbo'
Remove-Item $App -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Grabbo\wtyczka') -Recurse -Force -ErrorAction SilentlyContinue
foreach ($k in @('HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.grabbo.app',
                 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.grabbo.app')) {
    Remove-Item $k -Force -ErrorAction SilentlyContinue
}
Write-Host 'Pomocnik usunięty. Wtyczkę usuń w brave://extensions.'
