#!/bin/bash
# Bootstrap script for devenv
# 
# This is the main entry point for bootstrapping the development environment.
# It sources the bootstrap library and runs the default set of bootstrap tasks.
#
# For custom bootstrap behavior, you can:
# 1. Create a custom-bootstrap.sh file that will be run at the end
# 2. Fork this script and call specific bootstrap functions from bootstrap.bash

# Ensure that the script is not run with CRLF line endings
scriptdir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"; scriptfile="$0"; if [[ "$(file ${scriptdir}/${scriptfile})" =~ "CRLF" && -f "${scriptdir}/${scriptfile}" && "$(head -n 100 ${scriptdir}/${scriptfile} | grep "^scriptdir.\+dg4MbsIfhbv4-Bash-CRLF-selfheal_Written_By_Kenneth_Lutzke-8Nds9NclkU4sgE" > /dev/null 2>&1 ; echo "$?" )" == "0" ]]; then echo "$(cat ${scriptdir}/${scriptfile} | sed 's/\r$//')" > ${scriptdir}/${scriptfile} ; bash ${scriptdir}/${scriptfile} "$@" ; exit ; fi ; echo "" > /dev/null 2>&1

# Source the bootstrap library
# shellcheck source=./bootstrap.bash
source "$(dirname "${BASH_SOURCE[0]}")/bootstrap.bash"

# Defaults for common tool versions (override via env as needed)
PNPM_VERSION=${PNPM_VERSION:-8.7.1}
NODE_VERSION=${NODE_VERSION:-20}

# Run bootstrap tasks (all default tasks or specific tasks passed as arguments)
run_tasks "$@"
