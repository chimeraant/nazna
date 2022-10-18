import { console, readonlyArray, task as T } from 'fp-ts';
import { flow, pipe } from 'fp-ts/function';
import * as _fs from 'fs/promises';
import { match } from 'ts-pattern';

const cliFile = `#!/usr/bin/env node
require("./cjs/index").cli();
`;

const releaseRcFile = pipe(
  {
    branches: ['main'],
    plugins: [
      '@semantic-release/commit-analyzer',
      '@semantic-release/release-notes-generator',
      '@semantic-release/npm',
      '@semantic-release/github',
    ],
  },
  (obj) => JSON.stringify(obj, undefined, 2)
);

const fixPackageJson = flow(
  JSON.parse,
  (p) => ({
    ...p,
    ...{
      devDependencies: {
        ...p.devDependencies,
        ...{
          '@swc/cli': '^0.1.57',
          '@swc/core': '^1.3.8',
          eslint: '^8.25.0',
          'eslint-config-chimeraant': '^1.2.4',
          husky: '^8.0.1',
          'nazna-tsconfig': '^1.0.0',
          pnpm: '^7.13.4',
          prettier: '^2.7.1',
          typescript: '^4.8.4',
          'typescript-language-server': '^2.0.1',
          vitest: '^0.24.1',
        },
      },
      scripts: {
        ...p.scripts,
        'build:es6': 'swc src --out-dir dist/es6 --source-maps',
        'build:cjs': 'swc src --out-dir dist/cjs --source-maps --config module.type=commonjs',
        'build:types':
          'tsc src/**.ts --outDir dist/types' +
          ' --skipLibCheck --declaration --declarationMap --emitDeclarationOnly',
        build: 'pnpm build:types && pnpm build:es6 && pnpm build:cjs && nazna build cli',
        fix: 'eslint --max-warnings=0 --ext .ts . --fix',
        lint: 'eslint --max-warnings=0 --ext .ts .',
        test: 'vitest',
      },
      version: '0.0.0-semantic-release',
      license: 'MIT',
      types: './dist/types/index.d.ts',
      main: './dist/cjs/index.js',
      module: './dist/es6/index.mjs',
      exports: {
        require: './dist/cjs/index.js',
        import: './dist/es6/index.mjs',
      },
      files: ['dist'],
      bin: './dist/cli.js',
      eslintConfig: {
        extends: 'chimeraant',
      },
    },
  }),
  (obj) => JSON.stringify(obj, undefined, 2)
);

type FS = {
  readonly writeFile: (file: string, data: string) => T.Task<void>;
  readonly readFile: (file: string) => T.Task<string>;
};

const fs: FS = {
  writeFile: (file, data) => () => _fs.writeFile(file, data, { encoding: 'utf8' }),
  readFile: (file) => () => _fs.readFile(file, 'utf8'),
};

const fix = pipe(
  T.Do,
  T.chain(() => fs.writeFile('.releaserc.json', releaseRcFile)),
  T.chainFirst(() =>
    pipe(
      fs.readFile('package.json'),
      T.map(fixPackageJson),
      T.chain((content) => fs.writeFile('package.json', content))
    )
  )
);

export const cli: T.Task<unknown> = pipe(process.argv, readonlyArray.dropLeft(2), (argv) =>
  match(argv)
    .with(['build', 'cli'], () => fs.writeFile('dist/nazna', cliFile))
    .with(['fix'], () => fix)
    .otherwise((command) => pipe(`command not found: ${command}`, console.log, T.fromIO))
);
