import { summonFor } from '@morphic-ts/batteries/lib/summoner-ESBST';
import {
  apply,
  console,
  either as E,
  json,
  ord,
  readonlyArray,
  readonlyNonEmptyArray,
  readonlyRecord,
  string,
  task as T,
  taskEither as TE,
} from 'fp-ts';
import { flow, pipe } from 'fp-ts/function';
import * as std from 'fp-ts-std';
import * as yaml from 'js-yaml';
import * as pathModule from 'path';
import { simpleGit } from 'simple-git';
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
    uses: 'pnpm/action-setup@v2.2.4',
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

const { summon } = summonFor({});

export const ReleaseYamlFile = summon((F) => F.strMap(F.unknown()));

const fixReleaseYamlFile = flow(
  yaml.load,
  ReleaseYamlFile.type.decode,
  E.map((rawObj) =>
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
    )
  ),
  TE.fromEither
);

const sortedRecord = flow(
  readonlyRecord.toEntries,
  readonlyArray.sort(ord.tuple(string.Ord, ord.trivial)),
  readonlyRecord.fromEntries
);

const fixDependencies = (oldDependencies: unknown) =>
  typeof oldDependencies === 'object' ? { dependencies: sortedRecord(oldDependencies ?? {}) } : {};

const objectOrElseEmpyObject = (obj: unknown) => (typeof obj === 'object' ? obj ?? {} : {});

const getRepoUrl = TE.tryCatch(() => simpleGit().listRemote(['--get-url', 'origin']), String);

const fixPackageJson = (content: string) =>
  pipe(
    TE.Do,
    TE.bindW('packageJson', () =>
      pipe(content, json.parse, E.chainW(ReleaseYamlFile.type.decode), TE.fromEither)
    ),
    TE.bindW('repoUrl', () =>
      pipe(getRepoUrl, TE.map(flow(string.split('\n'), readonlyNonEmptyArray.head)))
    ),
    TE.map(({ packageJson, repoUrl }) =>
      pipe(
        {
          ...packageJson,
          ...fixDependencies(packageJson['dependencies']),
          ...{
            devDependencies: sortedRecord({
              ...objectOrElseEmpyObject(packageJson['devDependencies']),
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
              ...objectOrElseEmpyObject(packageJson['scripts']),
              'build:es6': 'swc src --out-dir dist/es6 --source-maps',
              'build:cjs': 'swc src --out-dir dist/cjs --source-maps --config module.type=commonjs',
              'build:types': 'tsc --project tsconfig.dist.json',
              build: 'pnpm build:types && pnpm build:es6 && pnpm build:cjs && nazna build cli',
              fix: 'eslint --max-warnings=0 --ext .ts . --fix',
              lint: 'eslint --max-warnings=0 --ext .ts .',
              test: 'vitest',
              postinstall: 'nazna fix',
              'pre-push:dirty': 'CI=true pnpm install && pnpm build && pnpm lint',
              'pre-push': 'pnpm pre-push:dirty && pnpm publish --dry-run',
            }),
            repository: repoUrl,
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
      )
    )
  );

const fixGitignore = flow(
  string.split('\n'),
  readonlyArray.union(string.Eq)([
    '.direnv',
    '.eslintrc.json',
    '.nazna',
    '.npmrc',
    '.releaserc.json',
    'dist',
    'node_modules',
    'tsconfig.json',
    'tsconfig.dist.json',
  ]),
  std.readonlyArray.join('\n'),
  TE.right
);

type NamedTask<E, R> = readonly [string, TE.TaskEither<E, R>];

type WriteAndChmodJob = {
  readonly job: 'write and chmod';
  readonly path: readonly string[];
  readonly content: string;
};

type WriteJob = {
  readonly job: 'write';
  readonly path: readonly string[];
  readonly content: string;
};

type FixJob = {
  readonly job: 'fix';
  readonly path: readonly string[];
  readonly emptyContent: string;
  readonly fixer: (input: string) => TE.TaskEither<unknown, string>;
};

type ErrorJob = {
  readonly job: 'error';
  readonly value: string;
};

type Job = WriteJob | FixJob | ErrorJob | WriteAndChmodJob;

const writeTask = ({ path, content }: WriteJob) =>
  pipe(
    fs.mkDir(readonlyArray.dropRight(1)(path)),
    TE.chain((_) => fs.writeFile(path)(content))
  );

const writeAndChmodTask = ({ path, content }: WriteAndChmodJob) =>
  pipe(
    writeTask({ job: 'write', path, content }),
    TE.chain((_) => fs.chmod(path, 0o755))
  );

const fixTask = ({ path, fixer, emptyContent }: FixJob) =>
  pipe(
    fs.readFile(path),
    TE.foldW(
      (err) =>
        err.code === 'ENOENT'
          ? pipe(emptyContent, fixer, TE.chain(fs.writeFile(path)))
          : TE.left(err),
      flow(fixer, TE.chain(fs.writeFile(path)))
    )
  );

const jobToStringTaskEither = (job: Job) =>
  match(job)
    .with({ job: 'write' }, writeTask)
    .with({ job: 'write and chmod' }, writeAndChmodTask)
    .with({ job: 'fix' }, fixTask)
    .with({ job: 'error' }, ({ value }) => TE.left(value))
    .exhaustive();

const jobToName = (job: Job): string =>
  match(job)
    .with({ job: 'write' }, ({ path }) => `write ${pathModule.join(...path)}`)
    .with({ job: 'fix' }, ({ path }) => `fix ${pathModule.join(...path)}`)
    .with({ job: 'error' }, (_) => `error`)
    .with({ job: 'write and chmod' }, ({ path }) => `write and chmod ${pathModule.join(...path)}`)
    .exhaustive();

const jobToNamedTask = (job: Job): NamedTask<unknown, unknown> => [
  jobToName(job),
  jobToStringTaskEither(job),
];

const argvToJobs = (argv: readonly string[]): readonly Job[] =>
  match(argv)
    .with(['build', 'cli'], (_): readonly Job[] => [
      { job: 'write and chmod', path: ['dist', 'cli.js'], content: constants.cliFile },
    ])
    .with(['fix'], (_): readonly Job[] => [
      { job: 'write', path: ['.releaserc.json'], content: constants.releasercJson },
      { job: 'write', path: ['.envrc'], content: constants.envrc },
      { job: 'write', path: ['.eslintrc.json'], content: constants.eslintrcJson },
      { job: 'write', path: ['.npmrc'], content: constants.npmrc },
      { job: 'write', path: ['tsconfig.json'], content: constants.tsconfigJson },
      { job: 'write', path: ['tsconfig.dist.json'], content: constants.tsconfiDistJson },
      { job: 'write', path: ['.nazna', '.gitconfig'], content: constants.nazna.gitConfig },
      {
        job: 'write and chmod',
        path: ['.nazna', 'gitHooks', 'pre-push'],
        content: constants.nazna.gitHooks.prePush,
      },
      {
        job: 'fix',
        path: ['package.json'],
        fixer: fixPackageJson,
        emptyContent: '{}',
      },
      {
        job: 'fix',
        path: ['.github', 'workflows', 'release.yaml'],
        fixer: fixReleaseYamlFile,
        emptyContent: '',
      },
      {
        job: 'fix',
        path: ['.gitignore'],
        fixer: fixGitignore,
        emptyContent: '',
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
