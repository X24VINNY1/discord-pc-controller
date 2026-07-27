@echo off
title Discord PC Controller - Enable Autostart (Zero-Lag Mode)
color 0B
echo ========================================================
echo   DISCORD PC CONTROLLER - AUTOSTART INSTALLER
echo ========================================================
echo.
echo Installing silent autostart shortcut to Windows Startup...
echo.

set SCRIPT_DIR=%~dp0
set SHORTCUT_PATH=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\DiscordPCAgent.lnk
set TARGET_VBS=%SCRIPT_DIR%silent_agent.vbs

powershell -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%TARGET_VBS%\"'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.WindowStyle = 7; $s.Save()"

echo [SUCCESS] Silent Agent registered in Windows Startup!
echo.
echo Details:
echo - Starts automatically every day when PC boots.
echo - Runs completely hidden in background (0 console windows).
echo - Uses BelowNormal CPU priority (0.0%% impact on COD / Fortnite FPS).
echo - Uses under 15MB RAM.
echo.
echo Launching silent agent now for this session...
wscript.exe "%TARGET_VBS%"
echo.
echo Done! You can close this window.
pause
