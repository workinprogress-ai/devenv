#!/bin/bash

URL="https://0x0.st"
DEFAULT_EXPIRE="7d" # Default to 14 days

if [ $# -eq 0 ]; then
    echo "Usage: 0x0.st FILE"
    exit 1
fi

FILE=$1

if [ ! -f "$FILE" ]; then
    echo "File ${FILE} not found"
    exit 1
fi

RESPONSE=$(curl -# -F "file=@${FILE}" -Fsecret= "${URL}")

echo "$RESPONSE" | xclip -sel clip # to clipboard
echo "$RESPONSE"  # to terminal
