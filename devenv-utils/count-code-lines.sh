#!/bin/bash

git ls-files */*.cs *.cs */*.html *.html */*.js *.js */*.ts *.ts */*.json *.json */*.xml *.xml */*.csproj *.csproj */*.sln *.sln */*.sh *.sh | xargs wc -l

