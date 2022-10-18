import { console, ord, readonlyArray, readonlyRecord, string, task as T } from 'fp-ts';
import { flow, pipe } from 'fp-ts/function';
import * as _fs from 'fs/promises';
import * as yaml from 'js-yaml';
import path from 'path';
import { match } from 'ts-pattern';

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

const releaseYamlFile = yaml.dump(
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
  readonly copyFile: (src: string, dest: string) => T.Task<void>;
  readonly mkDir: (path: string) => T.Task<string | undefined>;
  readonly cpDir: (src: string, dest: string) => T.Task<void>;
  readonly exists: (path: string) => T.Task<boolean>;
};

const fs: FS = {
  writeFile: (file, data) => () => _fs.writeFile(file, data, { encoding: 'utf8' }),
  readFile: (file) => () => _fs.readFile(file, 'utf8'),
  copyFile: (src, dest) => () => _fs.copyFile(src, dest),
  mkDir: (dirPath) => () => _fs.mkdir(dirPath, { recursive: true }),
  cpDir: (src, dest) => () => _fs.cp(src, dest, { recursive: true }),
  exists: (filePath) => () =>
    _fs
      .access(filePath)
      .then(() => true)
      .catch(() => false),
};

const rootDir = path.join(__dirname, '..', '..');

const naznaDir = path.join(process.cwd(), '.nazna');

const copyFile = (src: string, dest: string) =>
  fs.copyFile(path.join(rootDir, src), path.join(process.cwd(), dest));

const copyFileKeepPath = (p: string) => copyFile(p, p);

const doNothing: T.Task<unknown> = T.of(undefined);

const workflowsPath = path.join(process.cwd(), '.github', 'workflows');

const releaseYamlPath = path.join(workflowsPath, 'release.yaml');

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
  T.chainFirst(() => copyFileKeepPath('.envrc')),
  T.chainFirst(() => copyFileKeepPath('.eslintrc.json')),
  T.chainFirst(() => copyFileKeepPath('.npmrc')),
  T.chainFirst(() => copyFileKeepPath('.releaserc.json')),
  T.chainFirst(() => copyFileKeepPath('tsconfig.json')),
  T.chainFirst(() => fs.mkDir(naznaDir)),
  T.chainFirst(() => copyFileKeepPath(path.join('.nazna', '.gitconfig'))),
  T.chainFirst(() =>
    fs.cpDir(
      path.join(rootDir, '.nazna', 'gitHooks'),
      path.join(process.cwd(), '.nazna', 'gitHooks')
    )
  ),
  T.chainFirst(() =>
    pipe(
      fs.mkDir(workflowsPath),
      T.chain(() => fs.exists(releaseYamlPath)),
      T.chain((exists) => (exists ? doNothing : fs.writeFile(releaseYamlPath, releaseYamlFile)))
    )
  )
);

export const cli: T.Task<unknown> = pipe(process.argv, readonlyArray.dropLeft(2), (argv) =>
  match(argv)
    .with(['build', 'cli'], () => fs.writeFile('dist/nazna', cliFile))
    .with(['fix'], () => fix)
    .otherwise((command) => pipe(`command not found: ${command}`, console.log, T.fromIO))
);
