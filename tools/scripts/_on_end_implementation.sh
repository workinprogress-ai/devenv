#!/bin/bash
exec bash "$(dirname "$0")/_on_event_dispatch.sh" "_on_end_implementation" "$@"
