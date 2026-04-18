#!/bin/bash

sleep 7     # give docker a chance to load

if [ "$1" == '--reload' ]; then
    echo "Stopping Docker daemon..."
    sudo pkill dockerd
fi

if ! pgrep -x "dockerd" > /dev/null; then
    echo "Docker daemon is not running. Starting Docker..."
    nohup sudo dockerd </dev/null &>/dev/null &
else
    echo "Docker daemon is already running."
fi
