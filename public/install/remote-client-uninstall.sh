#!/usr/bin/env bash
set -Eeuo pipefail
install_dir="${1:-${METIS_REMOTE_CLIENT_DIR:-$HOME/.metis-ai/remote-client}}"
[[ "$install_dir" == /* && "$install_dir" != / && "$install_dir" != "$HOME" && -f "$install_dir/run-client.sh" && -L "$install_dir/current" ]] || { printf 'Not a managed remote-client install: %s\n' "$install_dir" >&2; exit 2; }
suffix="$(printf '%s' "$install_dir" | cksum | awk '{print $1}')"
service_name="metis-ai-remote-client-$suffix"
if [[ "$(uname -s)" == Darwin ]]; then
  plist="$HOME/Library/LaunchAgents/com.metis-ai.remote-client-$suffix.plist"
  launchctl bootout "gui/$(id -u)" "$plist" >/dev/null 2>&1 || true
  rm -f "$plist"
elif command -v systemctl >/dev/null; then
  systemctl --user disable --now "$service_name.service" >/dev/null 2>&1 || true
  rm -f "$HOME/.config/systemd/user/$service_name.service"
  systemctl --user daemon-reload >/dev/null 2>&1 || true
fi
if [[ -f "$install_dir/client.pid" ]]; then
  pid="$(cat "$install_dir/client.pid")"
  if [[ "$pid" =~ ^[0-9]+$ ]] && [[ "$(ps -p "$pid" -o args=)" == *"$install_dir/releases/"* ]]; then kill "$pid" 2>/dev/null || true; fi
fi
rm -rf -- "$install_dir"
printf 'Remote client removed: %s\n' "$install_dir"
