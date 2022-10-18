import { console, ord, readonlyArray, readonlyRecord, string, task as T } from 'fp-ts';
import { flow, pipe } from 'fp-ts/function';
import * as _fs from 'fs/promises';
import path from 'path';
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

const sortedRecord = flow(
  readonlyRecord.toEntries,
  readonlyArray.sort(ord.tuple(string.Ord, ord.trivial)),
  readonlyRecord.fromEntries
);

const fixPackageJson = flow(
  JSON.parse,
  (p) => ({
    ...p,
    ...(typeof p.dependencies === 'object' ? { dependencies: sortedRecord(p.dependencies) } : {}),
    ...{
      devDependencies: sortedRecord({
        ...p.devDependencies,
        ...{
          '@swc/cli': '^0.1.57',
          '@swc/core': '^1.3.8',
          eslint: '^8.25.0',
          husky: '^8.0.1',
          'nazna-tsconfig': '^1.0.0',
          pnpm: '^7.13.4',
          typescript: '^4.8.4',
          vitest: '^0.24.1',
        },
      }),
      scripts: {
        ...p.scripts,
        'build:es6': 'swc src --out-dir dist/es6 --source-maps',
        'build:cjs': 'swc src --out-dir dist/cjs --source-maps --config module.type=commonjs',
        'build:types':
          'tsc src/**.ts --outDir dist/types' +
          ' --skipLibCheck --declaration --declarationMap --emitDeclarationOnly --esModuleInterop',
        build: 'pnpm build:types && pnpm build:es6 && pnpm build:cjs && nazna build cli',
        fix: 'eslint --max-warnings=0 --ext .ts . --fix',
        lint: 'eslint --max-warnings=0 --ext .ts .',
        test: 'vitest',
        postinstall: 'nazna fix && husky install',
      },
      version: '0.0.0-semantic-release',
      license: 'MIT',
      types: './dist/types/index.d.ts',
      main: './dist/cjs/index.js',
      module: './dist/es6/index.js',
      exports: {
        require: './dist/cjs/index.js',
        import: './dist/es6/index.js',
      },
      files: ['dist'],
      bin: './dist/cli.js',
    },
  }),
  (obj) => JSON.stringify(obj, undefined, 2)
);

type FS = {
  readonly writeFile: (file: string, data: string) => T.Task<void>;
  readonly readFile: (file: string) => T.Task<string>;
  readonly copyFile: (src: string, dest: string) => T.Task<void>;
};

const fs: FS = {
  writeFile: (file, data) => () => _fs.writeFile(file, data, { encoding: 'utf8' }),
  readFile: (file) => () => _fs.readFile(file, 'utf8'),
  copyFile: (src, dest) => () => _fs.copyFile(src, dest),
};

const rootDir = path.join(__dirname, '..', '..');

const fix = pipe(
  T.Do,
  T.chain(() => fs.writeFile('.releaserc.json', releaseRcFile)),
  T.chainFirst(() =>
    pipe(
      fs.readFile('package.json'),
      T.map(fixPackageJson),
      T.chain((content) => fs.writeFile('package.json', content))
    )
  ),
  T.chainFirst(() =>
    fs.copyFile(path.join(rootDir, 'tsconfig.json'), path.join(process.cwd(), 'tsconfig.json'))
  ),
  T.chainFirst(() =>
    fs.copyFile(path.join(rootDir, '.eslintrc.json'), path.join(process.cwd(), '.eslintrc.json'))
  ),
  T.chainFirst(() =>
    fs.copyFile(path.join(rootDir, '.releaserc.json'), path.join(process.cwd(), '.releaserc.json'))
  )
);

export const cli: T.Task<unknown> = pipe(process.argv, readonlyArray.dropLeft(2), (argv) =>
  match(argv)
    .with(['build', 'cli'], () => fs.writeFile('dist/nazna', cliFile))
    .with(['fix'], () => fix)
    .otherwise((command) => pipe(`command not found: ${command}`, console.log, T.fromIO))
);
