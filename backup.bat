@echo off
REM ==============================================================================
REM Automated Backup Script for TIHC Platform (Windows)
REM ==============================================================================
set TIMESTAMP=%date:~-4%%date:~3,2%%date:~0,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set TIMESTAMP=%TIMESTAMP: =0%
set BACKUP_DIR=backups
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

set BACKUP_FILE=%BACKUP_DIR%\tihc_backup_%TIMESTAMP%.zip

echo Creating backup of data and uploads to %BACKUP_FILE% ...
powershell -Command "Compress-Archive -Path data, uploads -DestinationPath '%BACKUP_FILE%'"
echo Backup completed successfully: %BACKUP_FILE%
pause

