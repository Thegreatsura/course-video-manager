# Raises a running ffmpeg.exe to High priority (#2214): the camera capture
# (the Cam Link and the mic) and a take's camera writer. At Normal, other
# work on the PC (an agent's ffmpeg.exe, Whisper loading on the GPU, frame
# decodes) starved them mid-take: the capture's buffer dropped frames and the
# writer's CFR filter filled the stall with repeats (212 frames, a 9 s
# freeze). The screen recorder gets High from timer-resolution.ps1.
#
# The target is the ffmpeg.exe whose command line contains -Tag and -Match.
# It is looked up for up to 10 s, since ffmpeg.exe was only just spawned.
param([string]$Tag, [string]$Match, [string]$Priority = "High")
$ErrorActionPreference = "Stop"
$deadline = (Get-Date).AddSeconds(10)
do {
  $p = @(Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe'" |
    Where-Object { $_.CommandLine -like "*$Tag*" -and $_.CommandLine -like "*$Match*" })
  if ($p.Count) { break }
  Start-Sleep -Milliseconds 100
} while ((Get-Date) -lt $deadline)
if ($p.Count -ne 1) { throw "expected one ffmpeg.exe matching $Tag / $Match, found $($p.Count)" }
(Get-Process -Id $p[0].ProcessId).PriorityClass = $Priority
"ffmpeg.exe $($p[0].ProcessId), priority $Priority"
