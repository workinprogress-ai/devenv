#!/bin/bash

update() {
    local result=""
    sudo apt update &>/dev/null
    result="$(apt list --upgradable 2>/dev/null)"    
    result="$(grep -c "^" <<< $result)"
    result="$(expr $result - 1)"
    echo -n "$result"
}

echo "Checking for updates..."

if [ "$(update)" -gt 0 ]; then 
  echo "Updating container"
  sudo apt upgrade -y
  sudo apt autoremove -y
  echo "------------------------------"
  echo "Container updated"
else
  echo "No update needed"
fi

