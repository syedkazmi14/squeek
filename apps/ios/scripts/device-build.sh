#!/usr/bin/env bash
# Builds and installs Squeek on a connected iPhone with a free Apple account, which can only
# register 10 new App IDs every 7 days. When that limit is hit, the Dynamic Island widget and
# Screen Guard can't get App IDs of their own. This builds a variant that leaves out the widget and
# the Share extension and runs Screen Guard under the Share extension's already-registered App ID.
# The committed project.yml is untouched; the variant file is deleted afterwards.
#
#   scripts/device-build.sh <device-udid>      # list devices with: xcrun devicectl list devices
set -euo pipefail
cd "$(dirname "$0")/.."
udid="${1:?usage: scripts/device-build.sh <device-udid>}"
derived="${DERIVED_DATA:-/tmp/squeek-device-dd}"

python3 - <<'PY'
import re
s = open("project.yml").read()
s = re.sub(r"  SqueekWidgets:\n.*?\n(?=  # Optional Screen Guard|  CallDirectoryExtension:)", "", s, flags=re.S)  # the widget
s = re.sub(r"  ShareExtension:\n.*?\n(?=  SafariExtension:)", "", s, flags=re.S)                                   # Share is dropped
s = s.replace("      - target: SqueekWidgets\n", "").replace("      - target: ShareExtension\n", "")
# Screen Guard takes the Share extension's App ID.
s = s.replace("PRODUCT_BUNDLE_IDENTIFIER: $(SQUEEK_BUNDLE_ID).ScreenGuard", "PRODUCT_BUNDLE_IDENTIFIER: $(SQUEEK_BUNDLE_ID).Share")
s = s.replace("SqueekScreenGuardBundleId: $(SQUEEK_BUNDLE_ID).ScreenGuard", "SqueekScreenGuardBundleId: $(SQUEEK_BUNDLE_ID).Share")
open("project-device.yml", "w").write(s)
PY
trap 'rm -f project-device.yml; xcodegen -q' EXIT
xcodegen -q --spec project-device.yml
xcodebuild -project Squeek.xcodeproj -scheme Squeek -configuration Debug -destination "id=$udid" \
  -derivedDataPath "$derived" -allowProvisioningUpdates build | grep -E "error:|BUILD" || true
xcrun devicectl device install app --device "$udid" "$derived/Build/Products/Debug-iphoneos/Squeek.app"
