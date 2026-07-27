@echo off
title Discord PC Controller - Remove Autostart
color 0C
echo Removing Discord PC Controller from Windows Startup...
set SHORTCUT_PATH=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\DiscordPCAgent.lnk

if exist "%SHORTCUT_PATH%" (
    del "%SHORTCUT_PATH%"
    echo [SUCCESS] Removed from Startup.
) else (
    echo [INFO] Autostart shortcut was not found.
)

taskkill /f /im node.exe 2>nul
echo Done!
pause
