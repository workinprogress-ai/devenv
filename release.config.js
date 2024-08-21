module.exports = {
  branches: [
    'master',
    {
      "name": "release/*",
      "prerelease": "beta"
    }
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
          { "type": "breaking", "release": "major" }
        ],
        "parserOpts": {
          //"noteKeywords": ["BREAKING CHANGE", "BREAKING CHANGES"],
          "breakingHeaderPattern": /^(\w*)(?:\((.*)\))?!: (.*)$/
          //"headerPattern": "^(?:Merged PR \\d+:\\s)?(\\w*)(?:\\(([\\w\\$\\.\\-\\* ]*)\\))?:(.*)(?:\\r?\\n|$)"
        }
      }
    ]
  ]
}
