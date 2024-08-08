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
          { "type": "fix!", "release": "major" },
          { "type": "feat!", "release": "major" },
          { "type": "breaking", "release": "major" },
        ],
        "parserOpts": {
          "noteKeywords": ["BREAKING CHANGE", "BREAKING CHANGES", "BREAKING!"]
        }
      }
    ],
    [
      '@semantic-release/exec',
      {
        publishCmd: "echo  'Executed publishCmd'"
      }
    ]
  ]
}
