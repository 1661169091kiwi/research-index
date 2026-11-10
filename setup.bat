@echo off
rem Developer setup (or repair): installs dependencies and creates the "Research Index (dev)" shortcut.
rem Pass -DataDir "D:\Research Index Data" to keep the app's data in that folder, -Desktop for a Desktop shortcut.
rem To build the installer instead: npm run installer
title Research Index setup
cd /d "%~dp0"
set "electron_config_cache=%~dp0.cache\electron"
set "ELECTRON_CACHE=%~dp0.cache\electron"

echo Installing Research Index...
call npm install --no-fund --no-audit
if errorlevel 1 goto fail

if not exist "node_modules\electron\dist\electron.exe" (
  echo Downloading the Electron runtime...
  node node_modules\electron\install.js
  if errorlevel 1 goto fail
)

if not exist "app\icon.ico" node scripts\make-icon.mjs
node build.mjs
if errorlevel 1 goto fail

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\make-shortcut.ps1" %*
if errorlevel 1 goto fail

echo.
echo Done. Open "Research Index (dev)" in the survey folder.
pause
exit /b 0

:fail
echo.
echo Setup did not finish. See the message above.
pause
exit /b 1
