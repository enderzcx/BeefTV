#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/backend/cmd/desktop"
GO_DIR="${BEEFTV_GO_DIR:-/tmp/beeftv-go.rpIfVN/go}"

if [[ ! -f "$ROOT_DIR/VERSION" ]]; then
  echo "VERSION file is required" >&2
  exit 1
fi

VERSION_VALUE="$(tr -d '[:space:]' < "$ROOT_DIR/VERSION")"
if [[ ! "$VERSION_VALUE" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid VERSION: $VERSION_VALUE" >&2
  exit 1
fi

if ! command -v go >/dev/null 2>&1 && [[ -x "$GO_DIR/bin/go" ]]; then
  export PATH="$GO_DIR/bin:$PATH"
fi

if ! command -v go >/dev/null 2>&1; then
  echo "Go is required (set BEEFTV_GO_DIR when using a bundled toolchain)" >&2
  exit 1
fi

# Desktop releases intentionally include the complete FFmpeg/MediaPipe asset
# set. Keep their release gate separate from the 65 MiB slim-web budget.
export BEEFTV_WEB_BUDGET_MIB="${BEEFTV_WEB_BUDGET_MIB:-110}"

"$ROOT_DIR/scripts/verify-beeftv-local-release.sh"

COMMIT_VALUE="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
BUILD_TIME_VALUE="${CANVAS_BUILD_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
export CANVAS_BUILD_VERSION="$VERSION_VALUE"
export GOTOOLCHAIN="${GOTOOLCHAIN:-local}"

echo "Building BeefTV $VERSION_VALUE ($COMMIT_VALUE)"

(
  cd "$DESKTOP_DIR"
  go run github.com/wailsapp/wails/v2/cmd/wails@v2.16.0 build \
    -clean \
    -trimpath \
    -ldflags "-X infinite-canvas/backend/internal/buildinfo.Version=$VERSION_VALUE -X infinite-canvas/backend/internal/buildinfo.Commit=$COMMIT_VALUE -X infinite-canvas/backend/internal/buildinfo.BuildTime=$BUILD_TIME_VALUE"
)

# Official protocol packages are runtime dependencies. Finder launches use the
# bundle Resources directory and must never depend on the caller's cwd.
APP_BUNDLE="$DESKTOP_DIR/build/bin/BeefTV.app"
PLUGIN_RESOURCE_DIR="$APP_BUNDLE/Contents/Resources/plugin-packages"
mkdir -p "$PLUGIN_RESOURCE_DIR"
cp "$ROOT_DIR/plugin-packages/"*.beeftv-plugin "$PLUGIN_RESOURCE_DIR/"

# Keep the generated macOS bundle metadata aligned with the repository version.
APP_PLIST="$APP_BUNDLE/Contents/Info.plist"
if [[ -f "$APP_PLIST" ]] && command -v plutil >/dev/null 2>&1; then
  MACOS_VERSION="${VERSION_VALUE#v}"
  plutil -replace CFBundleShortVersionString -string "$MACOS_VERSION" "$APP_PLIST"
  plutil -replace CFBundleVersion -string "$MACOS_VERSION" "$APP_PLIST"
  # The plist edit invalidates Wails' ad-hoc signature; sign the final bundle.
  codesign --force --deep --sign - "$APP_BUNDLE"
fi

echo "Release bundle: $APP_BUNDLE"
