#!/usr/bin/env bash
# Builds a zip for hosting the Heat Map Add-In inside the MyGeotab database
# (System Settings -> Add-Ins -> + Add-In -> Files). MyGeotab stores the uploaded
# files in a single flat namespace, so every asset is flattened and every
# reference in the HTML is rewritten to a bare file name.
set -euo pipefail

addin_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dist="$addin_dir/dist"
version="$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$dist/config.json" | head -1)"
out_dir="${1:-$addin_dir/build}"
stage="$out_dir/heatmap-mygeotab-hosted"
zip_path="$out_dir/heatmap-addin-$version-mygeotab-hosted.zip"

rm -rf "$stage" "$zip_path"
mkdir -p "$stage"
cp "$dist"/scripts/*.js "$dist"/styles/*.css "$dist"/images/* "$dist/heatmap31.html" "$stage/"
sed -i -e 's#styles/##g' -e 's#scripts/##g' -e 's#images/##g' "$stage/heatmap31.html"

python3 - "$dist/config.json" "$stage/config.json" <<'PY'
import json, sys

src, dst = sys.argv[1], sys.argv[2]
with open(src) as handle:
    config = json.load(handle)
for item in config['items']:
    item['url'] = 'heatmap31.html'
    item['icon'] = 'icon.svg'
with open(dst, 'w') as handle:
    json.dump(config, handle, indent=2)
    handle.write('\n')
PY

(cd "$stage" && zip -qr "$zip_path" .)
echo "$zip_path"
