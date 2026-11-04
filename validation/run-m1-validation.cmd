@echo off
rem Double-click to run the M1 validation assistant. It asks which PC this is, then guides you.
cd /d "%~dp0.."
title EPS M1 validation
node validation\m1-validate.mjs %*
echo.
pause
