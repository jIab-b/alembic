#!/bin/bash
# ./launch.sh                 embed Alembic's own frontend on the mock
# ./launch.sh PATH-OR-URL     open a project folder, or embed an index.html folder, file or dev server
# ./launch.sh --no-open ...   print the URL without opening a browser
# Startup and exit both stop everything this checkout's backend started.
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)

ours() {
    for dir in /proc/[0-9]*; do
        tr '\0' '\n' 2>/dev/null < "$dir/cmdline" |
            grep -qxF -e "$root/backend/server.py" -e "$root/backend/sessions.py" && echo "${dir#/proc/}"
    done
}
cleanup() {
    trap - EXIT
    local pids
    pids=$(ours)
    if [ -n "$pids" ]; then
        kill $pids 2>/dev/null
        for _ in 1 2 3 4 5 6 7 8 9 10; do
            pids=$(ours)
            [ -z "$pids" ] && break
            sleep 0.2
        done
        [ -n "$pids" ] && kill -9 $pids 2>/dev/null
    fi
    rm -f "${AL_HOME:-$HOME/.alembic}"/relay/*/server.json
    rm -rf "$root"/.tmp/embed/mock-*
}

open=--open
if [ "${1:-}" = --no-open ]; then open=; shift; fi
cleanup
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

if [ $# -eq 0 ]; then
    "$root/backend/al" embed "$root/frontend" --mock $open || exit
else
    "$root/backend/al" embed "$1" $open || exit
fi
"$root/backend/al" url
echo 'Running. Ctrl-C stops everything.'
while [ -n "$(ours)" ]; do
    sleep 1 &
    wait $!
done
echo 'The backend stopped.'
