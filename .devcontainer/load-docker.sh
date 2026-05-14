#!/bin/bash

sleep 7     # give docker a chance to load

if [ "$1" == '--reload' ]; then
    echo "Stopping Docker daemon..."
    sudo pkill dockerd
fi

if ! pgrep -x "containerd" > /dev/null; then
    echo "containerd is not running. Starting containerd..."
    nohup sudo containerd </dev/null &>/dev/null &
    sleep 2     # give containerd time to create its socket
else
    echo "containerd is already running."
fi

if ! pgrep -x "dockerd" > /dev/null; then
    echo "Docker daemon is not running. Starting Docker..."
    nohup sudo dockerd --containerd /run/containerd/containerd.sock </dev/null &>/dev/null &
else
    echo "Docker daemon is already running."
fi
