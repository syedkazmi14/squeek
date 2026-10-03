$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskLocalDotnet = Join-Path $taskRoot '.tools/dotnet/dotnet.exe'
$taskDotnet = if (Test-Path -LiteralPath $taskLocalDotnet) { $taskLocalDotnet } else { 'dotnet' }
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'
& $taskDotnet publish (Join-Path $taskRoot 'apps/windows-observer/Squeek.Observer.csproj') --configuration Release --runtime win-x64 --self-contained true --output (Join-Path $taskRoot 'artifacts/observer')
if ($LASTEXITCODE -ne 0) { throw 'Windows observer build failed.' }
& $taskDotnet build (Join-Path $taskRoot 'tests/Observer.Policy.Tests/Observer.Policy.Tests.csproj') --configuration Release --output (Join-Path $taskRoot 'artifacts/observer-policy-tests')
if ($LASTEXITCODE -ne 0) { throw 'Windows policy test build failed.' }
