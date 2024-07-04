#!/bin/bash

repo=$1
compare_ref=${1:-"master"}

if [ -z "$repo" ]; then
  # Find the Git repository root
  git_repo_root=$(git rev-parse --show-toplevel 2>/dev/null)
  
  if [ -z "$git_repo_root" ]; then
    echo "Not in a Git repository."
    exit 1;
  else
    echo "Git repository root: $git_repo_root"
    repo=$git_repo_root
  fi
fi

test_scripts=$(find . -type f -name "run-tests-local.sh" 2>/dev/null)

echo
echo "-----------------------------------------------"
echo "Changes detected in the following sub-projects"
echo "-----------------------------------------------"
for test_script in $test_scripts; do
  base_folder=$(echo $test_script | awk -F "/" '{print $2}')
  cd $base_folder
  changed=$(git diff --quiet HEAD $compare_ref -- . || echo 1)
  if [ "$changed" == "1" ]; then
    echo $base_folder
  fi
  cd $toolbox_root
done

cd - &>/dev/null
