#!/usr/bin/env bash
set -euo pipefail

# This is a static app with no install or build step. Run the fast module tests
# so task merges still fail clearly if media helpers stop parsing or regress.
node --test tests/*.test.mjs