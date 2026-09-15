#!/bin/bash
set -e

export DISPLAY=:99

XVFB_DISPLAY_NUM=99
XVFB_SOCKET="/tmp/.X11-unix/X${XVFB_DISPLAY_NUM}"
XVFB_LOCK="/tmp/.X${XVFB_DISPLAY_NUM}-lock"

# /tmp lives on a Docker volume, so a stale socket/lock from a previous
# container run can survive a restart and block Xvfb from binding to :99.
# Clear it before starting.
echo "Removing any stale Xvfb socket/lock for display :${XVFB_DISPLAY_NUM}..."
rm -f "$XVFB_SOCKET" "$XVFB_LOCK"

echo "Starting Xvfb on display :${XVFB_DISPLAY_NUM}..."
Xvfb :${XVFB_DISPLAY_NUM} -screen 0 1920x1080x24 -ac &
XVFB_PID=$!

# Poll until Xvfb is actually accepting connections instead of a fixed
# sleep — don't start uvicorn without a working display, since Chrome
# failures then surface only as an opaque TargetClosedError.
echo "Waiting for Xvfb to become ready..."
XVFB_READY=0
for i in $(seq 1 50); do
    if ! kill -0 "$XVFB_PID" 2>/dev/null; then
        echo "ERROR: Xvfb process died while starting up." >&2
        exit 1
    fi
    if [ -e "$XVFB_SOCKET" ]; then
        XVFB_READY=1
        break
    fi
    sleep 0.2
done

if [ "$XVFB_READY" -ne 1 ]; then
    echo "ERROR: Xvfb did not start accepting connections on :${XVFB_DISPLAY_NUM} within 10s." >&2
    exit 1
fi

echo "Xvfb is up on DISPLAY=${DISPLAY} (pid ${XVFB_PID})."

exec uvicorn main:app --host 0.0.0.0 --port 8000
