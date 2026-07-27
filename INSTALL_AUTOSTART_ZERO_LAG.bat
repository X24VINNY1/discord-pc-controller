@echo off
title Discord PC Controller - Permanent Autostart
color 0A
echo ========================================================
echo   DISCORD PC CONTROLLER - PERMANENT AUTOSTART INSTALLER
echo ========================================================
echo.
echo Installing permanent silent autostart to Windows Registry and Startup...
echo.

set SCRIPT_DIR=%~dp0
set SHORTCUT_PATH=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\DiscordPCAgent.lnk
set TARGET_VBS=%SCRIPT_DIR%silent_agent.vbs

rem 1. Register in Windows Startup Folder
powershell -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%TARGET_VBS%\"'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.WindowStyle = 7; $s.Save()"

rem 2. Register in Windows Registry HKCU Run Key (Double Redundancy)
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "DiscordPCAgent" /t REG_SZ /d "wscript.exe \"%TARGET_VBS%\"" /f >nul 2>&1

echo [SUCCESS] Permanent Autostart Installed!
echo.
echo Details:
echo - Registered in Startup Folder + Windows Registry (Always Runs on Boot).
echo - Runs completely silent in background (0 lag, 0 console windows).
echo - Auto-reconnects infinitely if Wi-Fi or server drops.
echo.
echo Launching silent agent for this session...
wscript.exe "%TARGET_VBS%"
echo.
echo Done! You can close this window.
pause
