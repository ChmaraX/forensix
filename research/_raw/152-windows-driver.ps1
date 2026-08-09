# Controlled acquisition driver for issue #152, Windows half.
# Not part of v2. Drives a real, HEADED, branded Chrome session on windows-latest
# against public sites only (no case data). Mirrors the recipe already proven on
# Linux: branded (not Chrome for Testing), headed (no --headless), a profile that
# survives TWO separate launches with graceful shutdown between them, and real
# unsuppressed first-run state on launch 1 (no --no-first-run, no --disable-fre).
#
# Usage: 152-windows-driver.ps1 -ChromePath <path> -UserDataDir <dir> -EvidenceDir <dir>

param(
  [Parameter(Mandatory=$true)][string]$ChromePath,
  [Parameter(Mandatory=$true)][string]$UserDataDir,
  [Parameter(Mandatory=$true)][string]$EvidenceDir
)

$ErrorActionPreference = "Stop"
$Port = 9222

New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null

function Wait-Cdp($port, $timeoutSec = 30) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 3
      if ($r.StatusCode -eq 200) { return $r.Content }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  throw "CDP on port $port did not become ready within $timeoutSec s"
}

function Open-Tab($port, $url) {
  try {
    Invoke-WebRequest -UseBasicParsing -Method Put -Uri "http://127.0.0.1:$port/json/new?$url" -TimeoutSec 10 | Out-Null
  } catch {
    Write-Warning "failed to open tab: $url : $($_.Exception.Message)"
  }
}

function Save-Screenshot($path) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bmp)
  $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bmp.Dispose()
}

function Stop-ChromeGracefully($timeoutSec = 20) {
  # taskkill without /F sends WM_CLOSE to top-level windows first — this is a
  # graceful request, not a hard kill, and lets Chrome flush its cache index.
  & taskkill /IM chrome.exe 2>$null | Out-Null
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    $procs = Get-Process chrome -ErrorAction SilentlyContinue
    if (-not $procs) { return $true }
    Start-Sleep -Milliseconds 500
  }
  Write-Warning "Chrome did not exit gracefully within $timeoutSec s — forcing"
  & taskkill /IM chrome.exe /F 2>$null | Out-Null
  Start-Sleep -Seconds 2
  return $false
}

# ── Launch 1: real, unsuppressed first-run state. No --headless. ──────────────
$launch1Urls = @(
  "https://example.com",
  "https://www.iana.org",
  "https://httpbin.org/html",
  "https://httpbin.org/image/png",
  "https://httpbin.org/image/jpeg",
  "https://httpbin.org/image/webp",
  "https://httpbin.org/json",
  "https://httpbin.org/xml",
  "https://httpbin.org/robots.txt",
  "https://httpbin.org/cookies/set/testcookie/testvalue",
  "https://developer.mozilla.org",
  "https://en.wikipedia.org/wiki/Chromium_(web_browser)",
  "https://en.wikipedia.org/wiki/HTTP_cookie",
  "https://en.wikipedia.org/wiki/Web_cache",
  "https://news.ycombinator.com"
)

Write-Host "=== Launch 1 (real first-run state, headed) ==="
$proc1 = Start-Process -FilePath $ChromePath -PassThru -ArgumentList @(
  "--user-data-dir=$UserDataDir",
  "--remote-debugging-port=$Port",
  "--remote-debugging-address=127.0.0.1",
  "--window-size=1280,1024",
  "about:blank"
)
"launch1_pid=$($proc1.Id)" | Out-File "$EvidenceDir\launch_pids.txt"

Wait-Cdp $Port 45 | Out-File "$EvidenceDir\launch1_cdp_version.json"

foreach ($u in $launch1Urls) {
  Open-Tab $Port $u
  Start-Sleep -Milliseconds 1800
}
Start-Sleep -Seconds 6
Save-Screenshot "$EvidenceDir\screenshot_launch1_headed_running.png"

$closed1 = Stop-ChromeGracefully 20
"launch1_graceful_close=$closed1" | Out-File "$EvidenceDir\launch_pids.txt" -Append
Start-Sleep -Seconds 2

# ── Launch 2: same profile, second launch, more browsing, graceful quit. ──────
$launch2Urls = @(
  "https://www.rfc-editor.org",
  "https://en.wikipedia.org/wiki/Cache_(computing)",
  "https://httpbin.org/uuid"
)

Write-Host "=== Launch 2 (persistent profile, headed) ==="
$proc2 = Start-Process -FilePath $ChromePath -PassThru -ArgumentList @(
  "--user-data-dir=$UserDataDir",
  "--remote-debugging-port=$Port",
  "--remote-debugging-address=127.0.0.1",
  "--window-size=1280,1024",
  "about:blank"
)
"launch2_pid=$($proc2.Id)" | Out-File "$EvidenceDir\launch_pids.txt" -Append

Wait-Cdp $Port 45 | Out-File "$EvidenceDir\launch2_cdp_version.json"

foreach ($u in $launch2Urls) {
  Open-Tab $Port $u
  Start-Sleep -Milliseconds 1800
}
Start-Sleep -Seconds 6
Save-Screenshot "$EvidenceDir\screenshot_launch2_headed_running.png"

$closed2 = Stop-ChromeGracefully 20
"launch2_graceful_close=$closed2" | Out-File "$EvidenceDir\launch_pids.txt" -Append
Start-Sleep -Seconds 2

Write-Host "=== Driver complete ==="
