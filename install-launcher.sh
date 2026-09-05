#!/usr/bin/env bash
# Register the installed Omarchy panel in the desktop application launcher.
set -euo pipefail
plugin_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
icon_dir="$data_dir/icons/hicolor/512x512/apps"
app_dir="$data_dir/applications"
mkdir -p "$icon_dir" "$app_dir"
install -m 644 "$plugin_dir/assets/app-icon-transparent.png" "$icon_dir/radres.call-me.png"
chmod 755 "$plugin_dir/open-panel.sh"
# Use an absolute icon path so the launcher can show the transparent handset
# without depending on the icon cache having rescanned the plugin.
icon_path="${icon_dir//\\/\\\\}/radres.call-me.png"
exec_path="${plugin_dir//\\/\\\\}/open-panel.sh"
cat > "$app_dir/radres.call-me.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=/call-me
GenericName=AI phone companion
Comment=Call or text your phone with your AI agent
Exec=$exec_path
Icon=$icon_path
Terminal=false
Categories=Utility;Telephony;
Keywords=callme;call-me;call me;phone;AI;agent;
StartupNotify=false
EOF
chmod 644 "$app_dir/radres.call-me.desktop"
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$app_dir"
fi
printf 'Installed /call-me launcher entry. Search callme with Super+Space.\n'
