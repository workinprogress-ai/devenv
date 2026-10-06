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
    // Release notes feed the GitHub release body.
    '@semantic-release/release-notes-generator',
    // Creates the GitHub release. semantic-release itself pushes the version tag
    // (it needs full history/tags and contents: write — see publish-release.yml).
    // No @semantic-release/git: it would push a version-bump commit to a protected
    // master (rebase-only ruleset), which the ruleset rejects.
    '@semantic-release/github'
  ]
}
