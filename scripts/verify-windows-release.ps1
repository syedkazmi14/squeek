param(
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [Parameter(Mandatory = $true)][string]$AppDirectory,
  [string]$OutputPath = 'artifacts/qa/windows-release-environment.json'
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Windows verification requires Windows.' }
# Read-only environment/signature evidence. This never installs, changes policy, or launches an app.
$taskIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$taskPrincipal = [Security.Principal.WindowsPrincipal]::new($taskIdentity)
$taskElevated = $taskPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$taskAdminMember = @($taskIdentity.Groups | ForEach-Object { $_.Value }) -contains 'S-1-5-32-544'
$taskPaths = @(
  @{ Role = 'installer'; Path = $InstallerPath },
  @{ Role = 'app'; Path = (Join-Path $AppDirectory 'Squeek.exe') },
  @{ Role = 'observer'; Path = (Join-Path $AppDirectory 'resources/observer/Squeek.Observer.exe') }
)
$taskSignatures = foreach ($taskEntry in $taskPaths) {
  if (-not (Test-Path -LiteralPath $taskEntry.Path -PathType Leaf)) { throw 'Required release artifact is missing.' }
  $taskSignature = Get-AuthenticodeSignature -LiteralPath $taskEntry.Path
  @{
    role = $taskEntry.Role
    sha256 = (Get-FileHash -LiteralPath $taskEntry.Path -Algorithm SHA256).Hash
    signatureStatus = $taskSignature.Status.ToString()
    signerThumbprint = if ($taskSignature.SignerCertificate) { $taskSignature.SignerCertificate.Thumbprint } else { $null }
  }
}
$taskEvidence = @{
  generatedAtUtc = [DateTime]::UtcNow.ToString('o')
  windowsVersion = [Environment]::OSVersion.Version.ToString()
  elevated = $taskElevated
  administratorGroupMember = $taskAdminMember
  standardUser = (-not $taskElevated -and -not $taskAdminMember)
  signatures = @($taskSignatures)
  installation = 'not_tested_by_this_script'
  policyApproval = 'not_established_by_signature'
}
$taskOutput = [IO.Path]::GetFullPath($OutputPath)
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($taskOutput)) | Out-Null
$taskEvidence | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $taskOutput -Encoding utf8
Write-Output 'Recorded environment and signatures only. Complete the disposable standard-user checklist separately.'
