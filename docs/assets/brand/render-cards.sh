#!/bin/sh
# Renders the link-preview cards from paraframe-banner.html, cropped and with
# the windows moved up so the comment pin stays in view:
#   static/og.png                      1200 × 630, the showcase's og:image
#   docs/assets/paraframe-social.png   1280 × 640, GitHub's social preview
# Needs Chromium (CHROMIUM=/path/to/chromium to override). Run from anywhere.
set -eu
brand=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$brand/../../.." && pwd)
chromium=${CHROMIUM:-chromium}

render() {
	out=$1 width=$2 height=$3
	# The banner is 1280 CSS px wide; the device scale factor sizes the PNG.
	scale=$(awk "BEGIN { print $width / 1280 }")
	css_height=$(awk "BEGIN { printf \"%d\", $height * 1280 / $width + 0.5 }")
	tmp=$(mktemp -d)
	{
		echo "<base href=\"file://$brand/\">"
		cat "$brand/paraframe-banner.html"
		echo "<style>#banner { height: ${css_height}px } .intro { padding-top: 22px } h1 { margin-top: 12px }"
		echo ".backdrop { top: 136px !important } .canvas { top: 154px !important }"
		echo ".player { top: $((204 - (672 - css_height)))px !important }</style>"
	} >"$tmp/card.html"
	"$chromium" --headless=new --use-gl=swiftshader --disable-features=Vulkan --hide-scrollbars \
		--force-device-scale-factor="$scale" --window-size="1280,$css_height" \
		--virtual-time-budget=3000 --screenshot="$out" "file://$tmp/card.html" 2>/dev/null
	rm -r "$tmp"
}

render "$root/static/og.png" 1200 630
render "$root/docs/assets/paraframe-social.png" 1280 640
