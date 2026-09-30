param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
try {
    if (Get-Process -Name 'Adobe Premiere Pro' -ErrorAction SilentlyContinue) {
        throw 'Close Adobe Premiere Pro before installing or uninstalling.'
    }
    $extensionId = 'local.karaoke.graphic23'
    $extensionsRoot = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
    $destination = Join-Path $extensionsRoot $extensionId
    $stateRoot = Join-Path $env:LOCALAPPDATA 'KaraokeGraphic23'
    $stateFile = Join-Path $stateRoot 'installer-state.json'
    $registryPath = 'HKCU:\Software\Adobe\CSXS.11'
    if ($Uninstall) {
        if (Test-Path -LiteralPath $destination) {
            $manifestPath = Join-Path $destination 'CSXS\manifest.xml'
            if (!(Test-Path -LiteralPath $manifestPath)) {throw 'Manifest missing. Remove the extension folder manually.'}
            [xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw
            if ($manifest.ExtensionManifest.ExtensionBundleId -ne $extensionId) {throw 'Folder belongs to another extension. No files removed.'}
            Remove-Item -LiteralPath $destination -Recurse -Force
        }
        if (Test-Path -LiteralPath $stateFile) {
            $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
            $current = Get-ItemProperty -LiteralPath $registryPath -Name PlayerDebugMode -ErrorAction SilentlyContinue
            if ($current -and [string]$current.PlayerDebugMode -eq '1') {
                if ($state.hadValue) {
                    New-ItemProperty -LiteralPath $registryPath -Name PlayerDebugMode -Value $state.value -PropertyType $state.kind -Force | Out-Null
                } else {Remove-ItemProperty -LiteralPath $registryPath -Name PlayerDebugMode -ErrorAction SilentlyContinue}
            }
            Remove-Item -LiteralPath $stateFile -Force
        }
        Write-Host 'Uninstalled Karaoke Overlay. Existing backup folders are preserved.' -ForegroundColor Green
        exit 0
    }
    $source = Join-Path $PSScriptRoot 'extension'
    if (!(Test-Path -LiteralPath (Join-Path $source 'CSXS\manifest.xml'))) {throw 'Extract the complete ZIP first. Extension files are missing.'}
    New-Item -ItemType Directory -Path $extensionsRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
    if (!(Test-Path -LiteralPath $stateFile)) {
        $previous = Get-ItemProperty -LiteralPath $registryPath -Name PlayerDebugMode -ErrorAction SilentlyContinue
        $had = $null -ne $previous
        $kind = if ($had) {(Get-Item -LiteralPath $registryPath).GetValueKind('PlayerDebugMode').ToString()} else {'String'}
        @{hadValue=$had;value=$(if($had){$previous.PlayerDebugMode}else{$null});kind=$kind} | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
    }
    if (Test-Path -LiteralPath $destination) {
        $backup = Join-Path $stateRoot ('backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
        Move-Item -LiteralPath $destination -Destination $backup
        Write-Host "Previous extension backed up: $backup"
    }
    Copy-Item -LiteralPath $source -Destination $destination -Recurse
    New-Item -Path $registryPath -Force | Out-Null
    New-ItemProperty -LiteralPath $registryPath -Name PlayerDebugMode -Value '1' -PropertyType String -Force | Out-Null
    Write-Host 'Installed successfully for the current Windows user. No administrator rights required.' -ForegroundColor Green
    Write-Host 'Enabled unsigned CEP panels through HKCU Software\Adobe\CSXS.11 PlayerDebugMode=1.'
    Write-Host 'Open Premiere 23 > Window > Extensions > Karaoke Overlay.'
} catch {
    Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
