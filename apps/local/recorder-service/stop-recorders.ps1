# Stops any ffmpeg.exe the recorder service left running when it died: a
# recorder still holding its Recording Session's files (so crash recovery can
# repair them), a preview still holding the Cam Link, or one that ignored `q`
# and was killed only on the WSL side. Found by a tag in its command line
# (recording-session.ts recorderTag, capture-args.ts PREVIEW_TAGS). A tag must
# start "cvm-recorder-" or it is ignored, so an ffmpeg.exe started by anything
# else is never touched. Prints how many it stopped.
param([string]$Tags)
$ErrorActionPreference = "Stop"
$wanted = $Tags -split "," | Where-Object { $_ -match '^cvm-recorder-.+' }
$stopped = 0
if ($wanted) {
  Get-CimInstance Win32_Process -Filter "Name = 'ffmpeg.exe'" | ForEach-Object {
    $line = $_.CommandLine
    foreach ($tag in $wanted) {
      if ($line -and $line.Contains($tag)) {
        Stop-Process -Id $_.ProcessId -Force
        $stopped += 1
        break
      }
    }
  }
}
Write-Output $stopped
