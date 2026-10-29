@echo off
rem Launch Crop Cloud on Windows in its own app window (Chrome or Edge, no tabs or address bar).
rem Pass "framecrop" or "photocrop" to open that app directly, e.g.  start.bat framecrop
setlocal
set "DIR=%~dp0"
set "PAGE=index.html"
if /i "%~1"=="framecrop" set "PAGE=apps/framecrop/index.html"
if /i "%~1"=="photocrop" set "PAGE=apps/photocrop/index.html"
set "URL=file:///%DIR:\=/%%PAGE%"
set "PROFILE=%LOCALAPPDATA%\CropCloud"

for %%B in (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
) do (
  if exist %%B (
    start "" %%B --app="%URL%" --user-data-dir="%PROFILE%" --window-size=1600,920 --no-first-run --no-default-browser-check
    goto :eof
  )
)

echo Chrome or Edge not found. Opening in your default browser instead.
start "" "%URL%"
