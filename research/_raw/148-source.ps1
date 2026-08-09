<#
Issue #148 - Windows Source construction (constructed ground truth).

Creates a disposable local user with a KNOWN password, runs a real Chrome AS THAT USER
so that OSCrypt generates a real per-user DPAPI-wrapped 32-byte key, writes known-plaintext
cookies, and shuts Chrome down cleanly.

Nothing here decrypts anything. Nothing here calls CryptUnprotectData.
#>
param(
  [Parameter(Mandatory = $true)][string]$Arm,          # cft | branded-abe-off
  [Parameter(Mandatory = $true)][string]$ChromeExe,
  [Parameter(Mandatory = $true)][string]$NodeExe,
  [Parameter(Mandatory = $true)][string]$Workspace,    # repo checkout (holds node_modules + driver)
  [string]$User = 'suspect',
  [string]$Password = 'F0rensiX-Src!2026#A'
)

$ErrorActionPreference = 'Stop'
function Log($m) { Write-Host "[source] $m" }

New-Item -ItemType Directory -Force -Path C:\lab, C:\lab\logs | Out-Null

# ---------------------------------------------------------------- 1. the user
if (Get-LocalUser -Name $User -ErrorAction SilentlyContinue) { Remove-LocalUser -Name $User }
$sec = ConvertTo-SecureString $Password -AsPlainText -Force
New-LocalUser -Name $User -Password $sec -PasswordNeverExpires -AccountNeverExpires | Out-Null
Add-LocalGroupMember -Group 'Users' -Member $User
$sid = (Get-LocalUser -Name $User).SID.Value
Log "user=$User sid=$sid"

# "Log on as a batch job" so Task Scheduler can start a real logon session for the user.
$cfg = 'C:\lab\secpol.inf'; $db = 'C:\lab\secpol.sdb'
secedit /export /cfg $cfg /areas USER_RIGHTS | Out-Null
$content = Get-Content $cfg
$line = $content | Where-Object { $_ -match '^SeBatchLogonRight' }
if ($line) {
  $new = "$line,*$sid"
  $content = $content -replace [regex]::Escape($line), $new
} else {
  $content = $content -replace '\[Privilege Rights\]', "[Privilege Rights]`r`nSeBatchLogonRight = *$sid"
}
$content | Set-Content $cfg -Encoding Unicode
secedit /configure /db $db /cfg $cfg /areas USER_RIGHTS | Out-Null

# ---------------------------------------------------- 2. arm-specific browser
if ($Arm -eq 'branded-abe-off') {
  # Legacy, non-App-Bound configuration of a BRANDED install, via documented enterprise policy.
  New-Item -Path 'HKLM:\SOFTWARE\Policies\Google\Chrome' -Force | Out-Null
  New-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Google\Chrome' `
    -Name 'ApplicationBoundEncryptionEnabled' -Value 0 -PropertyType DWord -Force | Out-Null
  Log 'policy ApplicationBoundEncryptionEnabled=0 set'
}
Log "chrome=$ChromeExe"

# --------------------------------------------------- 3. run the driver as user
# Everything the suspect needs must be readable by the suspect.
icacls $Workspace /grant "${User}:(OI)(CI)RX" /T /Q | Out-Null
$chromeDir = Split-Path -Parent $ChromeExe
icacls $chromeDir /grant "${User}:(OI)(CI)RX" /T /Q | Out-Null
icacls C:\lab /grant "${User}:(OI)(CI)F" /Q | Out-Null

$udd = "C:\Users\$User\udd"
$srcOut = 'C:\lab\source_out'
$cmd = @"
@echo off
set HOME=C:\Users\$User
"$NodeExe" "$Workspace\research\_raw\148-driver.js" "$ChromeExe" "$udd" "$srcOut" > C:\lab\logs\driver.out 2> C:\lab\logs\driver.err
echo %ERRORLEVEL% > C:\lab\logs\driver.rc
"@
Set-Content -Path C:\lab\run-driver.cmd -Value $cmd -Encoding ASCII

function Invoke-AsUser($taskName, $command) {
  schtasks /create /tn $taskName /tr $command /sc once /st 23:59 /ru $User /rp $Password /rl LIMITED /f | Out-Null
  schtasks /run /tn $taskName | Out-Null
  for ($i = 0; $i -lt 180; $i++) {
    Start-Sleep -Seconds 2
    $q = schtasks /query /tn $taskName /fo LIST /v
    if (($q | Where-Object { $_ -match 'Status:' }) -notmatch 'Running') { break }
  }
  $rcline = (schtasks /query /tn $taskName /fo LIST /v | Where-Object { $_ -match 'Last Result' })
  Log "$taskName -> $rcline"
  schtasks /delete /tn $taskName /f | Out-Null
}

Invoke-AsUser 'fx148_driver' 'C:\lab\run-driver.cmd'

foreach ($f in 'driver.out', 'driver.err', 'driver.rc') {
  if (Test-Path "C:\lab\logs\$f") { Log "--- $f"; Get-Content "C:\lab\logs\$f" | Select-Object -First 40 | Write-Host }
}
if (-not (Test-Path "$srcOut\driver_done.txt")) { throw 'driver did not complete' }

# The suspect's own SID as the suspect's own logon sees it (account/domain context record).
Set-Content C:\lab\run-whoami.cmd "whoami /user /groups > C:\lab\logs\whoami.txt 2>&1" -Encoding ASCII
Invoke-AsUser 'fx148_whoami' 'C:\lab\run-whoami.cmd'

# --------------------------------------------------------- 4. cold the Source
Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
if (Get-Process chrome -ErrorAction SilentlyContinue) { throw 'chrome still running' }
'SOURCE COLD' | Set-Content C:\lab\logs\source_state.txt

@{
  arm = $Arm; user = $User; sid = $sid; password = $Password
  chrome_exe = $ChromeExe; udd = $udd
  machine = $env:COMPUTERNAME
  os = (Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber)
  account_type = 'local'; domain_joined = (Get-CimInstance Win32_ComputerSystem).PartOfDomain
} | ConvertTo-Json -Depth 5 | Set-Content C:\lab\logs\source_context.json

Log 'source built'
