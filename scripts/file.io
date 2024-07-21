#!/bin/sh

URL="https://file.io"
DEFAULT_EXPIRE="7d" # Default to 14 days

if [ $# -eq 0 ]; then
    echo "Usage: file.io FILE [EXPIRE]"
    echo " Example: file.io path/to/my/file 1w"
    echo " This example upload your file for 1 download and expires until 7 days if not downloaded."
    echo "\nSee documentation at https://www.file.io/#one"
    exit 1
fi

FILE=$1
EXPIRE=${2:-$DEFAULT_EXPIRE}

if [ ! -f "$FILE" ]; then
    echo "File ${FILE} not found"
    exit 1
fi

RESPONSE=$(curl -# -F "file=@${FILE}" "${URL}/?expires=${EXPIRE}")

RETURN=$(echo "${RESPONSE}" | grep -Po '(?<=success).[^",}]*' | cut -d':' -f2 | tr -d '[[:space:]]')

if [ "true" != "$RETURN" ]; then
    echo "An error occured!\n${RESPONSE}"
    exit 1
fi

KEY=$(echo "${RESPONSE}" | grep -Po '(?<=key)[":\s]+.*?"' | cut -d':' -f2 | tr -d '[[:space:]]' | tr -d '"')
EXPIRY=$(echo "${RESPONSE}" | grep -Po '(?<=expiry)[":\s]+.*?"' | cut -d':' -f2 | tr -d '[[:space:]]' | tr -d '"')

#echo "Upload done!\nYou can share the download link (expires in ${EXPIRY}): ${URL}/${KEY}"

echo "${URL}/${KEY}" | xclip -sel clip # to clipboard
echo "${URL}/${KEY}"  # to terminal
