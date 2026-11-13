@echo off
chcp 65001 >nul
echo ============================================================================
echo TIHC Dissemination Monitoring ^& Reporting Platform
echo Τεχνικές Σχολές Επιμελητηρίου Ηρακλείου (TIHC)
echo ============================================================================
echo.
echo Εκκίνηση διακομιστή στη διεύθυνση: http://localhost:3080
start "" "http://localhost:3080"
node server.js
pause

