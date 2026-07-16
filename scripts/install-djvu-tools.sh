#!/usr/bin/env bash
set -euo pipefail

root="${SESHAT_DJVU_TOOL_ROOT:-$(cd "$(dirname "$0")/.." && pwd)/.tools/djvu}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$root"
cd "$work"
apt-get download djvulibre-bin libdjvulibre21 libdjvulibre-text >/dev/null
for package in ./*.deb; do
  dpkg-deb -x "$package" "$root"
done
library="$root/usr/lib/x86_64-linux-gnu"
LD_LIBRARY_PATH="$library${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" "$root/usr/bin/ddjvu" --help >/dev/null 2>&1
printf 'DjVuLibre installed in %s\n' "$root"
