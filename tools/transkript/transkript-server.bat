@echo off
title vale-video Transkript-Server
cd /d "%~dp0"
echo.
echo  vale-video Transkript-Server wird gestartet ...
echo  (Fenster offen lassen, solange du Transkripte machst)
echo.
python transkript_server.py
if errorlevel 1 (
  echo.
  echo  Fehler beim Start. Falls Pakete fehlen:
  echo     pip install yt-dlp faster-whisper
  echo.
  pause
)
