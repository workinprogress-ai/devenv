module.exports = {
  branches: [
    'master',
    { name: 'release/*', prerelease: 'rel' },
    { name: 'beta/*',    prerelease: 'beta' }
  ],
  plugins: [
    [
      '@semantic-release/commit-analyzer', {
      preset: 'angular',
      releaseRules: [
        { breaking: true, release: 'major' },   // <— this line guarantees it
        { type: 'major',  release: 'major' },
        { type: 'minor',  release: 'minor' },
        { type: 'patch',  release: 'patch' },
        { type: 'docs', scope: 'README', release: 'patch' },
        { type: 'refactor',              release: 'patch' },
        { type: 'style',                 release: 'patch' },
        { type: 'breaking',              release: 'major' }
      ],
      parserOpts: {
        // This makes `refactor!: ...` (or `feat(core)!: ...`) count as breaking
        breakingHeaderPattern: /^(\w*)(?:\((.*)\))?!: (.*)$/,
        // And this still recognizes footer-based breaking notes
        noteKeywords: ['BREAKING CHANGE', 'BREAKING CHANGES', 'BREAKING']
      }
    }],
    [
      '@semantic-release/exec',
      {
          publishCmd:
              "./.azuredevops/prepare-release-version.sh '${nextRelease.version}'",
      }
    ]
    // You can add release-notes, github, etc. as needed
    // ['@semantic-release/release-notes-generator'],
    // ['@semantic-release/git'],
    // ['@semantic-release/github']
  ]
}
