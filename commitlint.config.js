export default {
  extends: ['@commitlint/config-conventional'],
  ignores: [(message) => /^(fixup!|squash!) /.test(message)],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        // keep the conventional types
        'build',
        'chore',
        'ci',
        'docs',
        'feat',
        'fix',
        'perf',
        'refactor',
        'revert',
        'style',
        'test',

        // add our explicit bump types
        'major',
        'minor',
        'patch'
      ]
    ]
  }
};
