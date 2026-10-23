@echo off
cd /d "%~dp0"
echo Open http://localhost:5173 in Chrome or Edge.
echo Keep this window open. Press Ctrl+C to stop.
node server.cjs
pause
