# Creates "Research Index (dev).lnk" in the survey folder (and optionally on the Desktop).
# It runs the development copy straight from portal\ with Electron.
#   -Desktop          also put the shortcut on the Desktop
#   -DataDir <folder> keep the app's data in that folder (e.g. "D:\Research Index Data")
param([switch]$Desktop, [string]$DataDir)

$portal = Split-Path -Parent $PSScriptRoot
$docs = Split-Path -Parent $portal
$electron = Join-Path $portal 'node_modules\electron\dist\electron.exe'
$icon = Join-Path $portal 'app\icon.ico'
if (-not (Test-Path $electron)) { Write-Error "Electron is not installed yet. Run setup.bat first."; exit 1 }

$targets = @((Join-Path $docs 'Research Index (dev).lnk'))
if ($Desktop) { $targets += (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Research Index (dev).lnk') }

$arguments = '"' + $portal + '"'
if ($DataDir) { $arguments += ' "--data-dir=' + $DataDir + '"' }

$shell = New-Object -ComObject WScript.Shell
foreach ($path in $targets) {
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath = $electron
  $lnk.Arguments = $arguments
  $lnk.WorkingDirectory = $portal
  $lnk.IconLocation = "$icon,0"
  $lnk.Description = 'Research Index - development copy'
  $lnk.Save()
  Write-Host "Shortcut created: $path"
}
