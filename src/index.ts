import {
  apply,
  console,
  either as E,
  ord,
  readonlyArray,
  readonlyRecord,
  string,
  task as T,
  taskEither as TE,
} from 'fp-ts';
import { flow, pipe } from 'fp-ts/function';
import * as _fs from 'fs/promises';
import * as yaml from 'js-yaml';
import * as pathModule from 'path';
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

type StringTaskEither = TE.TaskEither<string, string>;

const toStringTaskEither =
  (t: T.Task<unknown>): StringTaskEither =>
  () =>
    t().then(flow(String, E.right)).catch(flow(String, E.left));

type FS = {
  readonly writeFile: (path: readonly string[]) => (data: string) => StringTaskEither;
  readonly readFile: (path: readonly string[]) => StringTaskEither;
  readonly mkDir: (path: readonly string[]) => StringTaskEither;
};

const fs: FS = {
  writeFile: (path) => (data) =>
    toStringTaskEither(() => _fs.writeFile(pathModule.join(...path), data, { encoding: 'utf8' })),
  readFile: (path) => toStringTaskEither(() => _fs.readFile(pathModule.join(...path), 'utf8')),
  mkDir: (path) =>
    toStringTaskEither(() => _fs.mkdir(pathModule.join(...path), { recursive: true })),
};

type NamedTask = readonly [string, StringTaskEither];

type WriteJob = {
  readonly job: 'write';
  readonly path: readonly string[];
  readonly content: string;
};

type FixJob = {
  readonly job: 'fix';
  readonly path: readonly string[];
  readonly fixer: (input: string) => string;
};

const writeTask = ({ path, content }: WriteJob): StringTaskEither =>
  pipe(
    fs.mkDir(readonlyArray.dropRight(1)(path)),
    TE.chain(() => fs.writeFile(path)(content))
  );

const fixTask = ({ path, fixer }: FixJob): StringTaskEither =>
  pipe(path, fs.readFile, TE.map(fixer), TE.chain(fs.writeFile(path)));

type ErrorJob = {
  readonly job: 'error';
  readonly value: string;
};

type Job = WriteJob | FixJob | ErrorJob;

const jobToStringTaskEither = (job: Job): StringTaskEither =>
  match(job)
    .with({ job: 'write' }, writeTask)
    .with({ job: 'fix' }, fixTask)
    .with({ job: 'error' }, ({ value }) => TE.left(value))
    .exhaustive();

const jobToName = (job: Job): string =>
  match(job)
    .with({ job: 'write' }, ({ path }) => `write ${path}`)
    .with({ job: 'fix' }, ({ path }) => `fix ${path}`)
    .with({ job: 'error' }, () => `error`)
    .exhaustive();

const jobToNamedTask = (job: Job): NamedTask => [jobToName(job), jobToStringTaskEither(job)];

const argvToJobs = (argv: readonly string[]): readonly Job[] =>
  match(argv)
    .with(['build', 'cli'], (): readonly Job[] => [
      { job: 'write', path: ['dist', 'nazna'], content: cliFile },
    ])
    .with(['fix'], (): readonly Job[] => [
      { job: 'write', path: ['.releaserc.json'], content: constants.releasercJson },
      { job: 'write', path: ['.envrc'], content: constants.releasercJson },
      { job: 'write', path: ['.eslintrc.json'], content: constants.eslintrcJson },
      { job: 'write', path: ['.npmrc'], content: constants.npmrc },
      { job: 'write', path: ['tsconfig.json'], content: constants.tsconfigJson },
      { job: 'write', path: ['.nazna', '.gitconfig'], content: constants.nazna.gitConfig },
      {
        job: 'write',
        path: ['.nazna', 'gitHooks', 'pre-push'],
        content: constants.nazna.gitHooks.prePush,
      },
      { job: 'fix', path: ['package.json'], fixer: fixPackageJson },
      { job: 'fix', path: ['.github', 'workflows', 'release.yaml'], fixer: fixPackageJson },
    ])
    .otherwise((command): readonly Job[] => [
      { job: 'error', value: `command not found: ${command}` },
    ]);

const strictTaskLog = (str: string): T.Task<void> => pipe(str, console.log, T.fromIO);

const showStringTaskEitherRecord = pipe(
  E.getShow(string.Show, string.Show),
  readonlyRecord.getShow(string.Ord),
  (Show) => Show.show
);

export const cli = (argv: readonly string[]): T.Task<void> =>
  pipe(
    argv,
    readonlyArray.dropLeft(2),
    argvToJobs,
    readonlyArray.map(jobToNamedTask),
    readonlyRecord.fromEntries,
    apply.sequenceS(T.ApplyPar),
    T.map(showStringTaskEitherRecord),
    T.chain(strictTaskLog)
  );
