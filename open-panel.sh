#!/usr/bin/env bash
# Open the existing Omarchy panel without leaving the generic app-launch OSD.
set -euo pipefail

omarchy-shell shell summon radres.call-me >/dev/null

# Omarchy's application launcher shows launch feedback when an entry does not
# create a new toplevel. This entry intentionally summons an existing panel,
# so close that feedback after its short delay.
(
  sleep 2.15
  omarchy-shell osd close >/dev/null 2>&1 || true
) >/dev/null 2>&1 &
