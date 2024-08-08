#!/bin/bash

if ! pgrep -x "dockerd" > /dev/null; then
    echo "Docker daemon is not running. Starting Docker..."
    nohup sudo dockerd </dev/null &>/dev/null &
else
    echo "Docker daemon is already running."
fi
