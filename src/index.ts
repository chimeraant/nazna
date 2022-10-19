import { apply, console, ord, readonlyArray, readonlyRecord, string, task as T } from 'fp-ts';
import { flow, pipe } from 'fp-ts/function';
import * as _fs from 'fs/promises';
import * as yaml from 'js-yaml';
import { match } from 'ts-pattern';

import * as constants from './constants';

const cliFile = `#!/usr/bin/env node
require("./cjs/index").cli();
`;

const requiredSteps = [
  {
    name: 'Checkout',
    uses: 'actions/checkout@v3',
  },
  {
    name: 'Setup pnpm',
    uses: 'pnpm/action-setup@v2.2.3',
    with: {
      version: 7,
    },
  },
  {
    name: 'Setup Node.js',
    uses: 'actions/setup-node@v3',
    with: {
      'node-version': 16,
      cache: 'pnpm',
    },
  },
  {
    name: 'Install dependencies',
    run: 'pnpm install',
  },
  {
    name: 'Lint',
    run: 'pnpm lint',
  },
  {
    name: 'Build es6',
    run: 'pnpm build:es6',
  },
  {
    name: 'Build cjs',
    run: 'pnpm build:cjs',
  },
  {
    name: 'Build types',
    run: 'pnpm build:types',
  },
  {
    name: 'Build cli',
    run: 'pnpm nazna build cli',
  },
  {
    name: 'Release',
    env: {
      GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
      NPM_TOKEN: '${{ secrets.NPM_TOKEN }}',
    },
    run: 'npx semantic-release',
  },
];

export const releaseYamlFile = yaml.dump(
  {
    name: 'Release',
    on: {
      push: {
        branches: 'main',
      },
      pull_request: {
        branches: 'main',
      },
    },
    jobs: {
      release: {
        name: 'Release',
        'runs-on': 'ubuntu-latest',
        steps: requiredSteps,
      },
    },
  },
  { noCompatMode: true }
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
          pnpm: '^7.13.4',
          typescript: '^4.8.4',
          vitest: '^0.24.1',
        },
      }),
      scripts: sortedRecord({
        ...(p.scripts ?? {}),
        'build:es6': 'swc src --out-dir dist/es6 --source-maps',
        'build:cjs': 'swc src --out-dir dist/cjs --source-maps --config module.type=commonjs',
        'build:types':
          'tsc src/**.ts --outDir dist/types' +
          ' --skipLibCheck --declaration --declarationMap --emitDeclarationOnly --esModuleInterop',
        build: 'pnpm build:types && pnpm build:es6 && pnpm build:cjs && nazna build cli',
        fix: 'eslint --max-warnings=0 --ext .ts . --fix',
        lint: 'eslint --max-warnings=0 --ext .ts .',
        test: 'vitest',
        postinstall: 'nazna fix',
        'pre-push': 'CI=true pnpm install && pnpm build && pnpm lint && pnpm publish --dry-run',
      }),
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
  readonly mkDir: (path: string) => T.Task<string | undefined>;
  readonly cpDir: (src: string, dest: string) => T.Task<void>;
  readonly exists: (path: string) => T.Task<boolean>;
};

const fs: FS = {
  writeFile: (file, data) => () => _fs.writeFile(file, data, { encoding: 'utf8' }),
  readFile: (file) => () => _fs.readFile(file, 'utf8'),
  mkDir: (dirPath) => () => _fs.mkdir(dirPath, { recursive: true }),
  cpDir: (src, dest) => () => _fs.cp(src, dest, { recursive: true }),
  exists: (filePath) => () =>
    _fs
      .access(filePath)
      .then(() => true)
      .catch(() => false),
};

// const naznaDir = '.nazna';

// const doNothing: T.Task<unknown> = T.of(undefined);

// const workflowsPath = '.github/workflows';

// const releaseYamlPath = `${workflowsPath}/release.yaml`;

const fixFile = (path: string, fixer: (inp: string) => string) =>
  pipe(
    fs.readFile(path),
    T.map(fixer),
    T.chain((content) => fs.writeFile(path, content))
  );

const par = apply.sequenceS(T.ApplyPar)({
  'write .releaserc.json': fs.writeFile('.releaserc.json', constants.releasercJson),
  'write .envrc': fs.writeFile('.envrc', constants.releasercJson),
  'write .eslintrc.json': fs.writeFile('.eslintrc.json', constants.eslintrcJson),
  'write .npmrc': fs.writeFile('.npmrc', constants.npmrc),
  'write tsconfig.json': fs.writeFile('tsconfig.json', constants.tsconfigJson),
  'write .nazna/.gitconfig': fs.writeFile('.nazna/.gitconfig', constants.nazna.gitConfig),
  'write .nazna/gitHooks/pre-push': fs.writeFile(
    '.nazna/gitHooks/pre-push',
    constants.nazna.gitHooks.prePush
  ),
  'fix .package.json': fixFile('package.json', fixPackageJson),
});

// const fix = pipe(
//   T.Do,
//   T.chainFirst(() =>
//     fs.cpDir(
//       path.join(rootDir, '.nazna', 'gitHooks'),
//       path.join(process.cwd(), '.nazna', 'gitHooks')
//     )
//   ),
//   T.chainFirst(() =>
//     pipe(
//       fs.mkDir(workflowsPath),
//       T.chain(() => fs.exists(releaseYamlPath)),
//       T.chain((exists) => (exists ? doNothing : fs.writeFile(releaseYamlPath, releaseYamlFile)))
//     )
//   )
// );

export const cli: T.Task<unknown> = pipe(process.argv, readonlyArray.dropLeft(2), (argv) =>
  match(argv)
    .with(['build', 'cli'], () => fs.writeFile('dist/nazna', cliFile))
    .with(['fix'], () => par)
    .otherwise((command) => pipe(`command not found: ${command}`, console.log, T.fromIO))
);
