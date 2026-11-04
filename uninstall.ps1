# Usuwa pomocnika Potok Video (nie rusza pobranych plików ani yt-dlp/ffmpeg)
$App = Join-Path $env:LOCALAPPDATA 'PotokVideo'
Remove-Item $App -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Potok Video\wtyczka') -Recurse -Force -ErrorAction SilentlyContinue
foreach ($k in @('HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.potok.video',
                 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.potok.video')) {
    Remove-Item $k -Force -ErrorAction SilentlyContinue
}
Write-Host 'Pomocnik usunięty. Wtyczkę usuń w brave://extensions.'
