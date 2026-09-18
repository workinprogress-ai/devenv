#!/bin/bash
set -euo pipefail
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
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

