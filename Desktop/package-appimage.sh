#!/usr/bin/env bash
#
# Packages the LazyChat desktop app as an AppImage.
#
# The image carries three payloads: the Qt shell (LazyChatDesktop), a Node
# runtime and the Next.js app in standalone form. Only the Next.js payload
# changes between builds, so the shell is taken from the current image and the
# app payload is replaced with a fresh build.
#
# Usage: Desktop/package-appimage.sh [--skip-build]
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP="$ROOT/Desktop"
APPIMAGE="$DESKTOP/LazyChatDesktop.AppImage"
APPIMAGETOOL="${APPIMAGETOOL:-$HOME/.cache/camview/appimagetool-x86_64.AppImage}"
STAGE="$DESKTOP/.pkg"

say() { printf '\033[1;33m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[[ -x "$APPIMAGETOOL" ]] || die "appimagetool not found at $APPIMAGETOOL (override with APPIMAGETOOL=)"
[[ -f "$APPIMAGE" ]] || die "no image to repack at $APPIMAGE"

if [[ "${1:-}" != "--skip-build" ]]; then
  say "Building the Next.js app"
  # A stale build cache can serve a previous version of a stylesheet, so the
  # packaging build always starts from a clean cache.
  rm -rf "$ROOT/.next-local/cache"
  (cd "$ROOT" && npm run build)
fi

say "Staging the Next.js runtime"
chmod -R u+w "$DESKTOP/nextjs" 2>/dev/null || true
# A running app holds files in the staged runtime; stop it first.
rm -rf "$DESKTOP/nextjs" || die "cannot replace $DESKTOP/nextjs — is the app still running?"
mkdir -p "$DESKTOP/nextjs"
cp -a "$ROOT/.next-local/standalone/." "$DESKTOP/nextjs/"
cp -a "$ROOT/.next-local/." "$DESKTOP/nextjs/.next-local/"
# The build cache is a build artifact, never read at runtime. Shipping it adds
# hundreds of megabytes to the image for nothing.
rm -rf "$DESKTOP/nextjs/.next-local/cache"
# The standalone output leaves two things out: public/ holds the static assets
# (logos, the Prefab renderer) and liblzf is needed by the bundled
# redis-server that backs the Company Brain.
cp -a "$ROOT/public" "$DESKTOP/nextjs/public"
cp -a "$ROOT/lib/liblzf.so.1" "$DESKTOP/nextjs/lib/"
# The agent sandbox is a separate Node service and runner; its dependencies
# live under sandbox/container/node_modules so they do not have to be traced
# into the Next.js standalone bundle.
if [[ ! -d "$ROOT/sandbox/container/node_modules" ]]; then
  say "Installing sandbox runner dependencies"
  (cd "$ROOT/sandbox/container" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --omit=dev --ignore-scripts --no-audit --no-fund)
fi
rm -rf "$DESKTOP/nextjs/sandbox"
cp -a "$ROOT/sandbox" "$DESKTOP/nextjs/sandbox"

# The desktop app is a local app: bind the loopback interface only. Next's
# generated standalone server defaults to 0.0.0.0, which puts the memory and
# brain MCP endpoints on every network interface.
sed -i -E "s/const hostname = process\.env\.HOSTNAME \|\| ['\"]0\.0\.0\.0['\"]/const hostname = process.env.OMNIA_HOST || '127.0.0.1'/" \
  "$DESKTOP/nextjs/server.js"
grep -q "OMNIA_HOST" "$DESKTOP/nextjs/server.js" || die "could not pin the server to 127.0.0.1"

# The harness runtime is gone: nothing in the image may carry it.
if [[ -e "$DESKTOP/nextjs/harness" ]]; then die "the image must not ship a harness checkout"; fi

say "Extracting the current image for its Qt payload"
rm -rf "$STAGE"
mkdir -p "$STAGE"
(cd "$STAGE" && "$APPIMAGE" --appimage-extract >/dev/null)
BASE="$STAGE/squashfs-root"
[[ -d "$BASE/usr/bin" ]] || die "unexpected image layout: no usr/bin in the extracted payload"

say "Replacing the app payload"
rm -rf "$BASE/usr/share/lazychat"
cp -a "$DESKTOP/nextjs" "$BASE/usr/share/lazychat"

if [[ -f "$DESKTOP/build/LazyChatDesktop" ]]; then
  say "Updating Qt shell binary (LazyChatDesktop)"
  cp -f "$DESKTOP/build/LazyChatDesktop" "$BASE/usr/bin/LazyChatDesktop"
  chmod +x "$BASE/usr/bin/LazyChatDesktop"
fi

say "Repacking"
ARCH=x86_64 "$APPIMAGETOOL" --no-appstream "$BASE" "$DESKTOP/LazyChatDesktop.new.AppImage"

say "Installing"
mv -f "$DESKTOP/LazyChatDesktop.new.AppImage" "$APPIMAGE"
chmod +x "$APPIMAGE"
rm -rf "$STAGE"
say "Done: $APPIMAGE"
