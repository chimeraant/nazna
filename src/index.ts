import {
  apply,
  console,
  either as E,
  json,
  ord,
  readonlyArray,
  readonlyRecord,
  string,
  task as T,
  taskEither as TE,
} from 'fp-ts';
import { flow, pipe } from 'fp-ts/function';
import * as yaml from 'js-yaml';
import * as pathModule from 'path';
import { match } from 'ts-pattern';

import * as constants from './constants';
import { fs } from './fs';

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

import { summonFor } from '@morphic-ts/batteries/lib/summoner-BASTJ';

const { summon } = summonFor({});

export const ReleaseYamlFile = summon((F) => F.strMap(F.unknown()));

const fixReleaseYamlRun = (rawObj: Record<string, unknown>) =>
  pipe(
    {
      ...rawObj,
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
    (content) => yaml.dump(content, { noCompatMode: true })
  );

const fixReleaseYamlFile = flow(yaml.load, ReleaseYamlFile.type.decode, E.map(fixReleaseYamlRun));

const sortedRecord = flow(
  readonlyRecord.toEntries,
  readonlyArray.sort(ord.tuple(string.Ord, ord.trivial)),
  readonlyRecord.fromEntries
);

const fixDependencies = (oldDependencies: unknown) =>
  typeof oldDependencies === 'object' ? { dependencies: sortedRecord(oldDependencies) } : {};

const objectOrElseEmpyObject = (obj: unknown) => (typeof obj === 'object' ? obj : {});

const fixPackageJsonRun = (p: Record<string, unknown>) =>
  pipe(
    {
      ...p,
      ...fixDependencies(p['dependencies']),
      ...{
        devDependencies: sortedRecord({
          ...objectOrElseEmpyObject(p['devDependencies']),
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
          ...objectOrElseEmpyObject(p['scripts']),
          'build:es6': 'swc src --out-dir dist/es6 --source-maps',
          'build:cjs': 'swc src --out-dir dist/cjs --source-maps --config module.type=commonjs',
          'build:types':
            'tsc src/**.ts --outDir dist/types --skipLibCheck --declaration' +
            ' --declarationMap --emitDeclarationOnly --esModuleInterop',
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
    },
    (obj) => JSON.stringify(obj, undefined, 2)
  );

const fixPackageJson = flow(
  json.parse,
  E.chainW(ReleaseYamlFile.type.decode),
  E.map(fixPackageJsonRun)
);

type NamedTask<E, R> = readonly [string, TE.TaskEither<E, R>];

type WriteJob = {
  readonly job: 'write';
  readonly path: readonly string[];
  readonly content: string;
};

type FixJob = {
  readonly job: 'fix';
  readonly path: readonly string[];
  readonly defaultContent: string;
  readonly fixer: (input: string) => E.Either<unknown, string>;
};

type ErrorJob = {
  readonly job: 'error';
  readonly value: string;
};

type Job = WriteJob | FixJob | ErrorJob;

const writeTask = ({ path, content }: WriteJob) =>
  pipe(
    fs.mkDir(readonlyArray.dropRight(1)(path)),
    TE.chain((_) => fs.writeFile(path)(content))
  );

const fixTask = ({ path, fixer, defaultContent }: FixJob) =>
  pipe(
    fs.readFile(path),
    TE.foldW(
      (err) =>
        err.code === 'ENOENT'
          ? writeTask({ job: 'write', path, content: defaultContent })
          : pipe(err, JSON.stringify, TE.left),
      flow(fixer, T.of, TE.chain(fs.writeFile(path)))
    )
  );

const jobToStringTaskEither = (job: Job) =>
  match(job)
    .with({ job: 'write' }, writeTask)
    .with({ job: 'fix' }, fixTask)
    .with({ job: 'error' }, ({ value }) => TE.left(value))
    .exhaustive();

const jobToName = (job: Job): string =>
  match(job)
    .with({ job: 'write' }, ({ path }) => `write ${pathModule.join(...path)}`)
    .with({ job: 'fix' }, ({ path }) => `fix ${pathModule.join(...path)}`)
    .with({ job: 'error' }, (_) => `error`)
    .exhaustive();

const jobToNamedTask = (job: Job): NamedTask<unknown, unknown> => [
  jobToName(job),
  jobToStringTaskEither(job),
];

const argvToJobs = (argv: readonly string[]): readonly Job[] =>
  match(argv)
    .with(['build', 'cli'], (_): readonly Job[] => [
      { job: 'write', path: ['dist', 'nazna'], content: constants.cliFile },
    ])
    .with(['fix'], (_): readonly Job[] => [
      { job: 'write', path: ['.releaserc.json'], content: constants.releasercJson },
      { job: 'write', path: ['.envrc'], content: constants.envrc },
      { job: 'write', path: ['.eslintrc.json'], content: constants.eslintrcJson },
      { job: 'write', path: ['.npmrc'], content: constants.npmrc },
      { job: 'write', path: ['tsconfig.json'], content: constants.tsconfigJson },
      { job: 'write', path: ['.nazna', '.gitconfig'], content: constants.nazna.gitConfig },
      {
        job: 'write',
        path: ['.nazna', 'gitHooks', 'pre-push'],
        content: constants.nazna.gitHooks.prePush,
      },
      {
        job: 'fix',
        path: ['package.json'],
        fixer: fixPackageJson,
        defaultContent: fixPackageJsonRun({}),
      },
      {
        job: 'fix',
        path: ['.github', 'workflows', 'release.yaml'],
        fixer: fixReleaseYamlFile,
        defaultContent: fixReleaseYamlRun({}),
      },
    ])
    .otherwise((command): readonly Job[] => [
      { job: 'error', value: `command not found: ${command}` },
    ]);

const strictTaskLog = (str: string): T.Task<void> => pipe(str, console.log, T.fromIO);

type Process = typeof process;

export const cli = ({
  process,
}: {
  readonly process: { readonly argv: Process['argv'] };
}): T.Task<void> =>
  pipe(
    process.argv,
    readonlyArray.dropLeft(2),
    argvToJobs,
    readonlyArray.map(jobToNamedTask),
    readonlyRecord.fromEntries,
    apply.sequenceS(T.ApplyPar),
    T.map((result) => JSON.stringify(result, undefined, 2)),
    T.chain(strictTaskLog)
  );
