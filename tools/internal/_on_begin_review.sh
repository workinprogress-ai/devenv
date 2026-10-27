#!/bin/bash
exec node "$(dirname "$0")/_on_event_dispatch.ts" "_on_begin_review" "$@"
