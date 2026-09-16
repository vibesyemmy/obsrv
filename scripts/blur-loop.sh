#!/bin/bash
# THROWAWAY — the CI arm of bug-controls-blur-timeout, on verify/blur-focus.
# Never merged.
#
# Loops the chain arm (:53 :71 :85 in one worker, file order) and counts how
# often `locator.blur` times out. Run twice by ci.yml: once as the harness runs
# today, once with OBSRV_TEST_TAKES_THE_DESK=1, which restores the pre-#105
# focus behaviour (show() rather than showInactive(), and the overlay's
# webContents.focus() runs again).
#
# THE GATE, and the reason this script is longer than the loop it contains: a
# line-number selector that matched nothing would run ZERO tests and report
# success, and "0 failures in N runs" from an instrument that ran nothing is
# indistinguishable from a clean result. So every iteration must report
# `Running 3 tests`, and the script fails loudly if one does not.
set -uo pipefail

N=${1:-75}
LABEL=${2:-unlabelled}

blur=0
other=0
ran=0
bad_gate=0

for i in $(seq 1 "$N"); do
  out=$(npx playwright test \
    tests/e2e/controls.spec.ts:53 \
    tests/e2e/controls.spec.ts:71 \
    tests/e2e/controls.spec.ts:85 \
    --retries=0 --reporter=line 2>&1)

  if echo "$out" | grep -q "Running 3 tests"; then
    ran=$((ran+1))
  else
    bad_gate=$((bad_gate+1))
    echo "::error::[$LABEL $i] GATE FAILED — the run did not report 'Running 3 tests'; this iteration proves nothing"
    echo "$out" | head -20
    continue
  fi

  if echo "$out" | grep -q "failed"; then
    if echo "$out" | grep -q "locator.blur"; then
      blur=$((blur+1))
      echo "::warning::[$LABEL $i] *** locator.blur TIMEOUT — the sighting we are hunting ***"
      echo "$out" | grep -A 12 "locator.blur" | head -24
    else
      other=$((other+1))
      echo "[$LABEL $i] other failure: $(echo "$out" | grep -m1 -oE 'controls\.spec\.ts:[0-9]+:[0-9]+')"
    fi
  fi
done

echo "=== $LABEL: $N requested, $ran actually ran 3 tests, $bad_gate gate failures — blur=$blur other=$other ==="
[ "$bad_gate" -eq 0 ] || { echo "::error::$LABEL: $bad_gate iterations ran nothing; the result for this arm is void"; exit 1; }
exit 0
