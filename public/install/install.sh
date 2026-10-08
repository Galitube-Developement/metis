#!/usr/bin/env bash
# Metis AI installer bootstrap: downloads a real file, preserving interactive stdin.
# /bin/bash -c "$(curl -fsSL https://github.com/f1shyondrugs/metis-ai/releases/latest/download/metis-install.sh)" -- --docker
set -euo pipefail

metis_resolve_release_base() {
  local requested="$1" json
  if [[ "$requested" == latest ]]; then
    json="$(curl -fsSL -H 'Accept: application/vnd.github+json' https://api.github.com/repos/f1shyondrugs/metis-ai/releases/latest)" ||
      { printf 'Error: could not resolve the latest stable release.\n' >&2; return 1; }
    requested="$(printf '%s' "$json" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\(v[0-9][0-9A-Za-z.-]*\)".*/\1/p' | head -n 1)"
  fi
  [[ "$requested" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] ||
    { printf 'Error: version must be latest or an available v-prefixed SemVer tag.\n' >&2; return 1; }
  printf '%s' "$requested"
}

metis_download_and_exec() {
  local rel="$1" asset="$2" tmp sums expected actual url
  shift 2
  tmp="$(mktemp "${TMPDIR:-/tmp}/metis-ai-install.XXXXXX")"
  url="$base/$rel"
  [[ -z "$release_assets" ]] || url="$release_assets/$asset"
  if ! curl -fsSL "$url" -o "$tmp"; then
    rm -f "$tmp"; printf 'Error: failed to download %s\n' "$url" >&2; return 1
  fi
  if [[ -n "$release_assets" ]]; then
    sums="$(curl -fsSL "$release_assets/SHA256SUMS")" || { rm -f "$tmp"; printf 'Error: missing release checksums.\n' >&2; return 1; }
    expected="$(printf '%s\n' "$sums" | awk -v name="$asset" '$2 == name { print $1 }')"
    [[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || { rm -f "$tmp"; printf 'Error: missing or ambiguous asset checksum.\n' >&2; return 1; }
    if command -v sha256sum >/dev/null 2>&1; then actual="$(sha256sum "$tmp")";
    elif command -v shasum >/dev/null 2>&1; then actual="$(shasum -a 256 "$tmp")";
    else rm -f "$tmp"; printf 'Error: sha256sum or shasum is required.\n' >&2; return 1; fi
    [[ "${actual%% *}" == "$expected" ]] || { rm -f "$tmp"; printf 'Error: SHA256 verification failed.\n' >&2; return 1; }
  fi
  grep -q 'Metis AI' "$tmp" || { rm -f "$tmp"; printf 'Error: downloaded installer looks invalid.\n' >&2; return 1; }
  export METIS_AI_INSTALL_BASE="$base"
  # The platform may exec its uninstaller; remove the downloaded bootstrap after that exits.
  local result=0
  /bin/bash "$tmp" "$@" || result=$?
  rm -f "$tmp"
  return "$result"
}

metis_install() {
  local base="${METIS_AI_INSTALL_BASE:-}" release_assets="" requested=latest commit="" version_set=0 arg script asset
  local -a forward_args=()
  command -v curl >/dev/null 2>&1 || { printf 'Error: curl is required.\n' >&2; return 1; }
  # Do not reinterpret uninstaller flags as installation options.
  if [[ "${1:-}" == "uninstall" ]]; then
    if [[ -z "$base" ]]; then
      requested="$(metis_resolve_release_base latest)" || return 1
      base="https://raw.githubusercontent.com/f1shyondrugs/metis-ai/$requested"
    fi
    forward_args=("$@")
    case "$(uname -s)" in
      Darwin) metis_download_and_exec install/macos.sh metis-macos.sh "${forward_args[@]}" ;;
      Linux) metis_download_and_exec install/linux.sh metis-linux.sh "${forward_args[@]}" ;;
      *) printf 'Error: unsupported OS.\n' >&2; return 1 ;;
    esac
    return
  fi
  while (( $# )); do
    arg="$1"; shift
    case "$arg" in
      --version) (( $# )) || { printf 'Error: --version requires a value.\n' >&2; return 1; }; requested="$1"; version_set=1; shift ;;
      --commit) (( $# )) || { printf 'Error: --commit requires a value.\n' >&2; return 1; }; commit="$1"; shift ;;
      *) forward_args+=("$arg") ;;
    esac
  done
  [[ -z "$commit" || "$version_set" == 0 ]] || { printf 'Error: use --commit or --version, not both.\n' >&2; return 1; }
  if [[ -n "$commit" ]]; then
    [[ "$commit" =~ ^[0-9a-fA-F]{7,40}$ ]] || { printf 'Error: commit must be a git SHA.\n' >&2; return 1; }
    [[ -n "$base" ]] || base="https://raw.githubusercontent.com/f1shyondrugs/metis-ai/$commit"
    forward_args+=(--commit "$commit")
  elif [[ -n "$base" ]]; then
    # Explicit transport override for private mirrors/tests; the platform resolves latest.
    forward_args+=(--version "$requested")
  else
    requested="$(metis_resolve_release_base "$requested")" || return 1
    base="https://raw.githubusercontent.com/f1shyondrugs/metis-ai/$requested"
    release_assets="https://github.com/f1shyondrugs/metis-ai/releases/download/$requested"
    forward_args+=(--version "$requested")
  fi
  base="${base%/}"
  case "$(uname -s)" in
    Darwin) script=install/macos.sh; asset=metis-macos.sh ;;
    Linux) script=install/linux.sh; asset=metis-linux.sh ;;
    *) printf 'Error: unsupported OS.\n' >&2; return 1 ;;
  esac
  metis_download_and_exec "$script" "$asset" "${forward_args[@]}"
}
metis_install "$@"
