#!/bin/sh
# Publishes the offline/installable build to GitHub Pages (branch gh-pages).
# Usage: npm run deploy
set -e
cd "$(dirname "$0")/.."
REMOTE=$(git remote get-url origin)

VITE_COLLAB=off npx tsc --noEmit
VITE_COLLAB=off npx vite build

TMP=$(mktemp -d)
cp -R dist/. "$TMP/"
touch "$TMP/.nojekyll"
cd "$TMP"
git init -q -b gh-pages
git add -A
git commit -q -m "Déploiement $(date '+%Y-%m-%d %H:%M')"
git push -f -q "$REMOTE" gh-pages
rm -rf "$TMP"

echo "Publié → https://kiy0ni.github.io/lineup/ (en ligne d'ici 1 à 2 minutes)"
