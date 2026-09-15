#!/bin/bash
set -euo pipefail
# Self-derive the tools root when DEVENV_TOOLS is not exported (set -u makes a bare deref fatal).
DEVENV_TOOLS="${DEVENV_TOOLS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$DEVENV_TOOLS/lib/error-handling.bash"

################################################################################
# metrics-count-code-lines.sh
#
# Count lines of code across the repository
#
# Usage:
#   ./metrics-count-code-lines.sh
#
# Description:
#   Counts lines of code in various source file types tracked by git,
#   including C#, HTML, JavaScript, TypeScript, JSON, XML, and shell scripts
#
# Dependencies:
#   - git
#   - wc
#
################################################################################

git ls-files */*.cs *.cs */*.html *.html */*.js *.js */*.ts *.ts */*.json *.json */*.xml *.xml */*.csproj *.csproj */*.sln *.sln */*.sh *.sh | xargs wc -l

