@echo off
setlocal
title Uninstall Karaoke Graphic 23
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Uninstall
if errorlevel 1 echo Uninstall failed. Read the message above.
pause
