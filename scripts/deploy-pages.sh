#!/bin/sh
# Publishes the offline/installable build to GitHub Pages (branch gh-pages).
# Usage: npm run deploy
set -e
cd "$(dirname "$0")/.."
ROOT=$(pwd)
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
cd "$ROOT"
rm -rf "$TMP"

# Old address (/formation-studio/, before the repo was renamed), served by the user site kiy0ni.github.io:
# the same build, so an app installed from there (iPhone home screen, Safari Dock keep their data apart)
# still opens and can move its projects. Browser tabs are sent on to /lineup/ by the app itself.
SITE=$(mktemp -d)
git clone -q --depth 1 https://github.com/kiy0ni/kiy0ni.github.io.git "$SITE"
rm -rf "$SITE/formation-studio"
cp -R "$ROOT/dist/." "$SITE/formation-studio/"
cd "$SITE"
git add -A
git diff --cached --quiet || git commit -q -m "Ancienne adresse : copie du $(date '+%Y-%m-%d %H:%M')"
git push -q
cd "$ROOT"
rm -rf "$SITE"

echo "Publié → https://kiy0ni.github.io/lineup/ (en ligne d'ici 1 à 2 minutes)"
