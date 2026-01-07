#!/bin/bash

################################################################################
# repo-create-new-service.sh
#
# Create a new microservice from template
#
# Usage:
#   ./repo-create-new-service.sh <microservice-name>
#
# Arguments:
#   microservice-name - Name of the new microservice (lowercase)
#
# Description:
#   Creates a new microservice repository from the service-template,
#   enforcing lowercase naming conventions.
#
# Dependencies:
#   - git
#
################################################################################

repos_dir=$DEVENV_ROOT/repos
template_name="service-template"

# Ensure an argument was passed
if [[ $# -ne 1 ]]; then
    echo "Usage: repo-create-new-service.sh <microservice-name>"
    exit 1
fi

service_name="$1"

# Check 1: Ensure it is all lowercase
if [[ "$service_name" != "${service_name,,}" ]]; then
    echo "ERROR: Invalid name: must be all lowercase."
    exit 1
fi

# Check 2: Ensure it matches kebab-case
if [[ ! "$service_name" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
    echo "ERROR: Invalid name: must use only lowercase letters, digits, and hyphens (e.g., order, external-service-broker)."
    exit 1
fi

# Check 3: Ensure it does not contain the word 'service'
if [[ "$service_name" =~ service ]]; then
    echo "ERROR: Invalid name: must not contain the word 'service'."
    exit 1
fi

# Setting variables for GitHub (using HTTPS with GitHub token)
folder_name="service-$service_name"

# For GitHub, use SSH-first approach via repo-get.sh
# git_url would be set by repo-get.sh based on GH_TOKEN

# Creating repo on GitHub
echo "Creating repo on GitHub"

get_repo="$DEVENV_TOOLS/repo-get.sh"

if [ -d "$folder_name" ]; then
    echo "ERROR: Folder '$folder_name' already exists. Aborting to avoid overwriting."
    exit 1
fi

# NOTE: repo-create.sh needs to be created or this script needs adaptation for GitHub
# Placeholder: assumes GitHub CLI (gh) is available
if [ -n "${GH_ORG:-}" ]; then
    if ! gh repo create "${GH_ORG}/${folder_name}" --private --source=. --remote=origin --push 2>/dev/null; then
        echo "WARNING: Could not auto-create GitHub repository ${GH_ORG}/${folder_name}. You may need to create it manually via GitHub UI."
        echo "Continuing with local setup..."
    fi
else
    if ! gh repo create "$folder_name" --private --source=. --remote=origin --push 2>/dev/null; then
        echo "WARNING: Could not auto-create GitHub repository. You may need to create it manually via GitHub UI."
        echo "Continuing with local setup..."
    fi
fi

echo "Repository creation successful (or skipped)"

# Creating new folder for the service
echo "Creating folder: $repos_dir/$folder_name"
mkdir -p "$repos_dir/$folder_name"
cd "$repos_dir/$folder_name" || exit 1

# Getting the latest service-template version from git
echo "Getting latest template version from git"
$get_repo "$template_name"

# Installing the template on the system
echo "Installing latest template version"
dotnet new install --force "$repos_dir/$template_name" # --force flag is used to overwrite any existing template with the same name

# Scaffold the new microservice
echo "Generating new microservice from template..."
dotnet new microservice -n "$service_name" -o $repos_dir/$folder_name
echo "Microservice '$service_name' created successfully in folder '$repos_dir/$folder_name'."

# Cleaning up unnecessary files
echo "Cleaning up unnecessary files"
rm -f "$repos_dir/$folder_name/$template_name.csproj" # removing the template project file
rm -rf "$repos_dir/$folder_name/.git" # removing the .git folder to delete references to the template project
rm -rf "$repos_dir/$folder_name/.pnpm-lock.yaml" # removing pnpm lock file to avoid ENOTFOUND errors when initializing repo
rm -rf "$repos_dir/$folder_name/node_modules" #  removing node_modules folder to avoid ENOTFOUND errors when initializing repo
cd "$repos_dir/$folder_name" || exit 1 # changing to the new microservice directory

echo "Performing final setup for the new microservice"
git init # initializing repository
git remote add origin "git@github.com:${GH_ORG}/${folder_name}.git" # setting the remote URL for the new microservice repository (SSH)

# initializing repository on the remote
echo "Performing initial commit for initializing master branch and avoiding direct pushes to it"
touch .gitkeep
git add .gitkeep
git commit -m "Initial commit"
git push -u origin master

# Granting permissions to scripts and folders
echo "Granting permissions to scripts and folders"
init_folder=".repo"
husky_folder=".husky"
build_folder=".build"
test_script="test/run-tests-local.sh"
chmod -R 755 $init_folder $husky_folder $build_folder  # running recursive chmod to ensure all scripts in the specified folders are executable
chmod 755 $test_script 2>/dev/null || true

echo "Installing pnpm"
npm install -g pnpm@latest-10 # installing the latest version of pnpm

echo "Running init.sh script"

init="$init_folder/init.sh"
$init

echo "Done!"
