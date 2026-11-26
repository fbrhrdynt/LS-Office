#!/bin/bash
# Deploy LS Office on the VPS. Run as the deploy user (ubuntu) from anywhere:  bash scripts/deploy.sh <git-ref>
# Steps: backup -> checkout ref -> install -> build (web + Remotion) -> install units -> restart -> health check.
# Rollback: bash scripts/deploy.sh <previous-ref>  (database migrations are additive; restore a dump only if needed).
set -euo pipefail
APP=/opt/ls-office
REF=${1:?usage: deploy.sh <git-ref>}
SERVICES="ls-office-api ls-office-worker ls-office-render ls-office-publisher ls-office-telegram"
cd "$APP"

echo "==> backup"
sudo /usr/local/sbin/ls-office-backup

echo "==> checkout $REF"
git fetch --all --quiet || true
if ! git diff --quiet || ! git diff --cached --quiet; then git stash push -m "pre-deploy-$(date +%Y%m%d-%H%M%S)"; fi
git checkout --quiet --detach "$REF"
echo "    now at $(git log --oneline -1)"

echo "==> install & build"
npm ci --no-audit --no-fund
npm run build
npm run build:remotion
npx remotion browser ensure > /dev/null

echo "==> permissions (code read-only for the Web Dev agent, nginx reads the web build)"
sudo setfacl -R -m u:ls-office-dev:rX -m d:u:ls-office-dev:rX "$APP"
sudo setfacl -R -m u:nginx:rX -m d:u:nginx:rX "$APP/dist"

echo "==> systemd units"
for unit in ops/systemd/*.service; do sudo install -m 0644 "$unit" /etc/systemd/system/; done
sudo install -m 0755 ops/backup/ls-office-backup.sh /usr/local/sbin/ls-office-backup
sudo install -m 0644 ops/backup/ls-office-backup.service ops/backup/ls-office-backup.timer /etc/systemd/system/
sudo install -m 0644 ops/nginx/ls-office-api.conf /etc/nginx/snippets/ls-office-api.conf
sudo install -m 0644 ops/nginx/ls-office-ratelimit.conf /etc/nginx/conf.d/ls-office-ratelimit.conf
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable --now ls-office-backup.timer > /dev/null

echo "==> restart"
sudo systemctl enable $SERVICES > /dev/null 2>&1
sudo systemctl restart $SERVICES
if systemctl list-unit-files ls-office-devagent.service > /dev/null 2>&1 && sudo test -s /etc/ls-office/devagent.env; then sudo systemctl restart ls-office-devagent; fi
sudo systemctl reload nginx

echo "==> health"
for i in $(seq 1 20); do curl -fsS http://127.0.0.1:3215/api/health > /dev/null && break; sleep 1; done
curl -fsS http://127.0.0.1:3215/api/health; echo
systemctl is-active $SERVICES
