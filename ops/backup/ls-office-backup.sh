#!/bin/bash
# Daily backup: PostgreSQL dump, media, Web Dev repositories. Keeps 14 days. Installed as /usr/local/sbin/ls-office-backup.
set -euo pipefail
DEST=/var/backups/ls-office
STAMP=$(date +%Y%m%d-%H%M)
KEEP_DAYS=${KEEP_DAYS:-14}
install -d -m 0750 "$DEST/daily"
runuser -u postgres -- pg_dump -Fc ls_office > "$DEST/daily/ls_office-$STAMP.dump.tmp"
mv "$DEST/daily/ls_office-$STAMP.dump.tmp" "$DEST/daily/ls_office-$STAMP.dump"
# Verify the dump is readable before trusting it.
pg_restore -l "$DEST/daily/ls_office-$STAMP.dump" > /dev/null
if [ -d /var/lib/ls-office/media ]; then
  rsync -a --delete /var/lib/ls-office/media/ "$DEST/media/"
fi
if [ -d /var/lib/ls-office-dev/projects ]; then
  tar --exclude=node_modules --exclude=dist -czf "$DEST/daily/devprojects-$STAMP.tar.gz" -C /var/lib/ls-office-dev projects
fi
find "$DEST/daily" -type f -mtime +"$KEEP_DAYS" -delete
chmod 600 "$DEST"/daily/*
echo "ls-office backup ok: $STAMP"
