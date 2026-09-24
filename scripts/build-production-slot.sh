     1	#!/usr/bin/env bash
     2	set -euo pipefail
     3	
     4	SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
     5	PROJECT_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
     6	cd "${AI_CHAT_ROOT:-$PROJECT_ROOT}"
     7	
     8	BUILD_DIR="${1:-${NEXT_DIST_DIR:-.next-a}}"
     9	case "$BUILD_DIR" in
    10	  .next-a|.next-b) ;;
    11	  *) echo "Refusing unsupported production build directory: $BUILD_DIR" >&2; exit 2 ;;
    12	esac
    13	
    14	PNPM_BIN="${PNPM_BIN:-pnpm}"
    15	command -v "$PNPM_BIN" >/dev/null 2>&1 || {
    16	  echo "pnpm is not available (checked $PNPM_BIN and PATH)" >&2
    17	  exit 127
    18	}
    19	
    20	# Next adds custom distDir type paths to tsconfig.json during builds. Keep those
    21	# generated paths out of the source tree so the inactive slot can never make a
    22	# later typecheck fail with stale generated route types.
    23	tsconfig_backup="$(mktemp)"
    24	cp tsconfig.json "$tsconfig_backup"
    25	restore_tsconfig() {
    26	  cp "$tsconfig_backup" tsconfig.json
    27	  rm -f "$tsconfig_backup"
    28	}
    29	trap restore_tsconfig EXIT INT TERM
    30	
    31	# Keep webpack/SWC cache between inactive-slot rebuilds. Deleting the whole
    32	# slot forced every deploy to recompile and reminify the entire 10k-line UI.
    33	rollback_dir="${BUILD_DIR}.rollback"
    34	rm -rf -- "$rollback_dir"
    35	if [[ -d "$BUILD_DIR" ]]; then
    36	  mv -- "$BUILD_DIR" "$rollback_dir"
    37	fi
    38	mkdir -p "$BUILD_DIR"
    39	if [[ -d "$rollback_dir/cache" ]]; then
    40	  mv -- "$rollback_dir/cache" "$BUILD_DIR/cache"
    41	fi
    42	restore_build_slot() {
    43	  if [[ ! -s "$BUILD_DIR/BUILD_ID" && -d "$rollback_dir" ]]; then
    44	    rm -rf -- "$BUILD_DIR"
    45	    mv -- "$rollback_dir" "$BUILD_DIR"
    46	  fi
    47	  rm -rf -- "$rollback_dir"
    48	}
    49	trap 'restore_build_slot; restore_tsconfig' EXIT INT TERM
    50	export NEXT_DIST_DIR="$BUILD_DIR"
    51	export NODE_ENV=production
    52	export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
    53	# Normal optimized production build. Tailwind source detection is explicitly
    54	# bounded in app/globals.css, which avoids scanning runtime/workspace trees.
    55	"$PNPM_BIN" build
    56	
    57	[[ -s "$BUILD_DIR/BUILD_ID" ]] || {
    58	  echo "Build completed without $BUILD_DIR/BUILD_ID" >&2
    59	  exit 1
    60	}
    61	
    62	rm -rf -- "$rollback_dir"
    63	restore_tsconfig
    64	trap - EXIT INT TERM
