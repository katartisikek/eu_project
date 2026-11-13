#!/usr/bin/env bash
# ==============================================================================
# Automated Daily Backup Script for TIHC Platform
# Backs up SQLite database and uploads directory
# ==============================================================================
set -e

BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/tihc_dissemination_backup_${TIMESTAMP}.tar.gz"

mkdir -p "$BACKUP_DIR"

echo "Creating compressed backup: $BACKUP_FILE ..."
tar -czf "$BACKUP_FILE" data/ uploads/

echo "Backup complete! File size: $(du -sh "$BACKUP_FILE" | cut -f1)"

# Keep only the last 30 daily backups
find "$BACKUP_DIR" -type f -name "tihc_dissemination_backup_*.tar.gz" -mtime +30 -exec rm {} \;
echo "Pruned backups older than 30 days."

