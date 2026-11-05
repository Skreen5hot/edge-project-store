@echo off
rem Double-click to run the M2 validation assistant. It opens the pages in Chrome or Edge and guides you.
cd /d "%~dp0.."
title EPS M2 validation
node validation\m2-validate.mjs %*
echo.
pause
