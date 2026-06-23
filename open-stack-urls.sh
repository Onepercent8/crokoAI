#!/usr/bin/env bash
#
# open-stack-urls.sh — opens every service URL of the stack in the user's browser.
#
# Usage:
#   ./scripts/open-stack-urls.sh          # opens all URLs
#   ./scripts/open-stack-urls.sh --list   # only prints the URLs, opens nothing
#
# Works on WSL2 (opens the Windows browser), native Linux, and macOS.

set -euo pipefail

# --- URLs to open (one per line) -------------------------------------------
URLS=(
  "https://supabase.com/"
  "https://console.upstash.com/auth/sign-in"
  "https://fly.io/"
  "https://code.visualstudio.com/download?_exp_download=fb315fc982"
  "https://vercel.com/"
  "https://github.com/"
  "https://elevenlabs.io/"
  "https://resend.com/"
  "https://platform.claude.com/"
  "https://platform.openai.com/login"
)

# --- Detect how to open a URL on this platform -----------------------------
detect_opener() {
  # WSL (Windows Subsystem for Linux): use the Windows default browser.
  if grep -qiE "(microsoft|wsl)" /proc/version 2>/dev/null; then
    if command -v wslview >/dev/null 2>&1; then
      echo "wslview"; return
    fi
    if command -v powershell.exe >/dev/null 2>&1; then
      echo "powershell"; return
    fi
    if command -v cmd.exe >/dev/null 2>&1; then
      echo "cmd"; return
    fi
  fi

  # macOS
  if command -v open >/dev/null 2>&1; then
    echo "open"; return
  fi

  # Native Linux
  if command -v xdg-open >/dev/null 2>&1; then
    echo "xdg-open"; return
  fi

  echo "none"
}

open_url() {
  local opener="$1" url="$2"
  case "$opener" in
    wslview)    wslview "$url" ;;
    powershell) powershell.exe -NoProfile -Command "Start-Process '$url'" ;;
    cmd)        cmd.exe /c start "" "$url" ;;
    open)       open "$url" ;;
    xdg-open)   xdg-open "$url" >/dev/null 2>&1 ;;
  esac
}

# --- List-only mode --------------------------------------------------------
if [[ "${1:-}" == "--list" ]]; then
  printf '%s\n' "${URLS[@]}"
  exit 0
fi

# --- Open everything -------------------------------------------------------
OPENER="$(detect_opener)"
if [[ "$OPENER" == "none" ]]; then
  echo "Could not find a way to open a browser on this system." >&2
  echo "Open these URLs manually:" >&2
  printf '  %s\n' "${URLS[@]}" >&2
  exit 1
fi

echo "Opening ${#URLS[@]} URLs via '$OPENER'..."
for url in "${URLS[@]}"; do
  echo "  -> $url"
  open_url "$OPENER" "$url"
  sleep 0.4   # small gap so the browser doesn't drop tabs opened too fast
done
echo "Done."
