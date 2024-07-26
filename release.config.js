module.exports = {
  branches: [
    'master',
    "release/*"
  ],
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        "preset": "angular",
        "releaseRules": [
          { "type": "docs", "scope": "README", "release": "patch" },
          { "type": "refactor", "release": "patch" },
          { "type": "style", "release": "patch" },
          { "type": "fix", "release": "patch" },
          { "type": "patch", "release": "patch" },
          { "type": "minor", "release": "minor" },
          { "type": "major", "release": "major" },
          { "type": "breaking", "release": "major" },
        ],
        "parserOpts": {
          "noteKeywords": ["BREAKING CHANGE", "BREAKING CHANGES"]
          //"headerPattern": "^(?:Merged PR \\d+:\\s)?(\\w*)(?:\\(([\\w\\$\\.\\-\\* ]*)\\))?:(.*)(?:\\r?\\n|$)"
        }
      }
    ],
    [
      '@semantic-release/exec',
      {
        //publishCmd: "./.github/prepare-release-version.sh '${ nextRelease.version }'",
        publishCmd: "echo  'Executed publishCmd'"
      }
    ]
  ]
}
