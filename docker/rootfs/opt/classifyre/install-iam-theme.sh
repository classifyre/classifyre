#!/usr/bin/env bash
# Lays out the identity server's theme (helm/classifyre/files/iam/theme) the
# way the Helm chart mounts it, at image build time:
#   <type>/…          as is, for login, admin and account
#   shared/…          into every type's resources/
# and asks for its stylesheets, images and fonts with the theme's hash
# (`login.css?v=<hash>`), because Keycloak serves theme files for 30 days
# under a path that changes only with its own version. Mirrors
# helm/classifyre/templates/iam-theme-configmap.yaml.
#
#   install-iam-theme.sh <source theme dir> <target theme dir>
set -euo pipefail

src=$1
dst=$2

hash=$(cd "$src" && find . -type f | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -c1-10)

rm -rf "$dst"
for type in login admin account; do
  mkdir -p "$dst/$type/resources"
  cp -R "$src/$type/." "$dst/$type/"
  cp -R "$src/shared/." "$dst/$type/resources/"
done

find "$dst" -type f \( -name '*.css' -o -name 'theme.properties' \) -print0 \
  | xargs -0 sed -i -E "s/\.(css|svg|png|woff2|ico)([\"')]|[ \t]|$)/.\1?v=${hash}\2/g"

echo "theme installed in $dst (version $hash)"
