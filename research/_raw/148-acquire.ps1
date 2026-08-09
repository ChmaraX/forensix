<#
Issue #148 - acquisition of the cold Source into an immutable evidence set.

Copies the conservative Windows DPAPI acquisition set named in
research/144-offline-oscrypt-key-recovery.md (INFERRED set, deliberately over-broad),
hashes every file, and writes a SHA-256 Manifest + Evidence Set Digest.

Read-only with respect to the Source: robocopy in backup mode, no writes back.
#>
param(
  [Parameter(Mandatory = $true)][string]$Snapshot,   # e.g. s1-cold
  [Parameter(Mandatory = $true)][string]$OutRoot,
  [string]$User = 'suspect'
)
$ErrorActionPreference = 'Continue'
function Log($m) { Write-Host "[acquire:$Snapshot] $m" }

$dst = Join-Path $OutRoot $Snapshot
New-Item -ItemType Directory -Force -Path $dst | Out-Null
$profileDir = "C:\Users\$User"

function Copy-Tree($src, $rel) {
  $target = Join-Path $dst $rel
  if (-not (Test-Path $src)) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    "ABSENT: $src" | Set-Content ($target + '.ABSENT.txt')
    Log "ABSENT $src"
    return
  }
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  robocopy $src $target /E /B /COPY:DAT /R:1 /W:1 /XJ /NFL /NDL /NP /NJH /NJS | Out-Null
  Log "copied $src -> $rel"
}

# Chrome evidence: whole User Data Dir (Local State is a sibling of the profile dirs).
Copy-Tree "$profileDir\udd" 'chrome/udd'

# User DPAPI material (masterkeys, CREDHIST, SYNCHIST) - hidden/system, hence /B.
Copy-Tree "$profileDir\AppData\Roaming\Microsoft\Protect" 'dpapi/user-roaming-protect'
Copy-Tree "$profileDir\AppData\Local\Microsoft\Protect" 'dpapi/user-local-protect'
Copy-Tree "$profileDir\AppData\Roaming\Microsoft\Credentials" 'dpapi/user-credentials'

# Machine DPAPI material, incl. the local backup masterkeys for standalone machines.
Copy-Tree 'C:\Windows\System32\Microsoft\Protect' 'dpapi/system-protect'

# Registry hives (LSA secrets live in SECURITY, bootkey in SYSTEM, local accounts in SAM).
New-Item -ItemType Directory -Force -Path "$dst\registry" | Out-Null
foreach ($hive in 'SYSTEM', 'SECURITY', 'SAM', 'SOFTWARE') {
  reg save "HKLM\$hive" "$dst\registry\$hive" /y | Out-Null
  Log "reg save $hive -> $(Test-Path "$dst\registry\$hive")"
}

# Account / machine context.
New-Item -ItemType Directory -Force -Path "$dst\context" | Out-Null
Get-LocalUser | Select-Object Name, SID, Enabled, PasswordLastSet, LastLogon |
  ConvertTo-Json -Depth 4 | Set-Content "$dst\context\local_users.json"
Get-CimInstance Win32_ComputerSystem | Select-Object Name, Domain, PartOfDomain, Workgroup |
  ConvertTo-Json | Set-Content "$dst\context\computer_system.json"
Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber, OSArchitecture |
  ConvertTo-Json | Set-Content "$dst\context\os.json"
if (Test-Path C:\lab\logs) { Copy-Item C:\lab\logs\* "$dst\context\" -Force -ErrorAction SilentlyContinue }
if (Test-Path C:\lab\source_out) {
  New-Item -ItemType Directory -Force -Path "$dst\context\source_out" | Out-Null
  Copy-Item C:\lab\source_out\* "$dst\context\source_out\" -Force -Recurse -ErrorAction SilentlyContinue
}

# ---- Manifest: SHA-256 per file, then a derived Evidence Set Digest ---------
$manifest = Join-Path $OutRoot "MANIFEST-$Snapshot.sha256"
Push-Location $dst
$lines = Get-ChildItem -Recurse -File -Force | ForEach-Object {
  $rel = $_.FullName.Substring((Get-Location).Path.Length + 1) -replace '\\', '/'
  "$((Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower())  $rel"
} | Sort-Object
Pop-Location
$lines | Set-Content $manifest -Encoding ASCII
$digest = (Get-FileHash $manifest -Algorithm SHA256).Hash.ToLower()
"$digest" | Set-Content (Join-Path $OutRoot "EVIDENCE_SET_DIGEST-$Snapshot.txt")
Log "files=$($lines.Count) evidence_set_digest=$digest"
