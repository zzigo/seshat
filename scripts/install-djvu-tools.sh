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
if LD_LIBRARY_PATH="$library${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" ldd "$root/usr/bin/ddjvu" | grep -q 'not found'; then
  printf 'DjVuLibre has unresolved shared libraries.\n' >&2
  exit 1
fi
printf 'DjVuLibre installed in %s\n' "$root"
