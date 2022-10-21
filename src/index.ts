import { summonFor } from '@morphic-ts/batteries/lib/summoner-ESBST';
import { spawn as sp } from 'child-process-promise';
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
import { flow, identity, pipe } from 'fp-ts/function';
import * as std from 'fp-ts-std';
import * as yaml from 'js-yaml';
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

const getRepoUrl = TE.tryCatch(() => simpleGit().listRemote(['--get-url', 'origin']), identity);

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
      pipe({
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
      })
    ),
    TE.chainEitherK((obj) => E.tryCatch(() => JSON.stringify(obj, undefined, 2), identity))
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
  (content) => `${content}\n`,
  TE.right
);

const shellNixPrePackage = `with (import <nixpkgs> { });
mkShell {
  buildInputs = [
    `;

const shellNixPostPackage = `
  ];
}
`;

const fixShellNix = flow(
  string.replace(shellNixPrePackage, ''),
  string.replace(shellNixPostPackage, ''),
  string.split('\n'),
  readonlyArray.map(string.trim),
  readonlyArray.union(string.Eq)(['nodePackages.pnpm', 'nodejs-16_x']),
  std.readonlyArray.join('\n    '),
  (packages) => shellNixPrePackage + packages + shellNixPostPackage,
  TE.right
);

const getDirPath = readonlyArray.dropRight(1);

const safeWriteFile = (filePath: readonly string[], content: string) =>
  pipe(
    TE.Do,
    TE.bind(`mkDir`, () => pipe(filePath, getDirPath, fs.mkDir)),
    TE.bind(`writeFile`, () => fs.writeFile(filePath, content))
  );

const writeAndChmodFile = (path: readonly string[], content: string) =>
  pipe(
    TE.Do,
    TE.bind(`safeWriteFile`, () => safeWriteFile(path, content)),
    TE.bind(`chmod`, () => fs.chmod(path, 0o755))
  );

const fixAndWrite = (
  path: readonly string[],
  fixer: (input: string) => TE.TaskEither<unknown, string>,
  content: string
) =>
  pipe(
    TE.Do,
    TE.bind('fixerResult', () => fixer(content)),
    TE.bind(`safeWriteFile`, ({ fixerResult }) => safeWriteFile(path, fixerResult))
  );

const fixFile = (
  path: readonly string[],
  fixer: (input: string) => TE.TaskEither<unknown, string>,
  emptyContent: string
) =>
  pipe(
    T.Do,
    T.bind('fileReadResult', () => fs.readFile(path)),
    T.bind('nextTE', ({ fileReadResult }) =>
      pipe(
        fileReadResult,
        E.foldW(
          (err) =>
            match(err)
              .with({ code: 'ENOENT' }, () => fixAndWrite(path, fixer, emptyContent))
              .otherwise(TE.left),
          (fileContent) => fixAndWrite(path, fixer, fileContent)
        )
      )
    ),
    T.map(apply.sequenceS(E.Apply))
  );

const spawn = (command: string, args: readonly string[]) =>
  pipe(
    TE.tryCatch(() => sp(command, args), identity),
    TE.map(({ code, stderr, stdout }) => ({ code, stdout, stderr }))
  );

const SParTE = apply.sequenceS(TE.ApplyPar);

const fix = SParTE({
  'fix .releaserc.json': safeWriteFile(['.releaserc.json'], constants.releasercJson),
  'fix .eslintrc.json': safeWriteFile(['.eslintrc.json'], constants.eslintrcJson),
  'fix .npmrc': safeWriteFile(['.npmrc'], constants.npmrc),
  'fix tsconfig.json': safeWriteFile(['tsconfig.json'], constants.tsconfigJson),
  'fix tsconfig.dist.json': safeWriteFile(['tsconfig.dist.json'], constants.tsconfiDistJson),
  'fix .nazna/.gitconfig': safeWriteFile(['.nazna', '.gitconfig'], constants.nazna.gitConfig),
  'fix .nazna/gitHooks/pre-push': writeAndChmodFile(
    ['.nazna', 'gitHooks', 'pre-push'],
    constants.nazna.gitHooks.prePush
  ),
  'fix package.json': fixFile(['package.json'], fixPackageJson, '{}'),
  'fix .github/workflows/release.yaml': fixFile(
    ['.github', 'workflows', 'release.yaml'],
    fixReleaseYamlFile,
    'name: Release'
  ),
  'fix .gitignore': fixFile(['.gitignore'], fixGitignore, ''),
  'fix .envrc': safeWriteFile(['.envrc'], constants.envrc),
  'fix shell.nix': fixFile(['shell.nix'], fixShellNix, ''),
});

const argvToTask = (argv: readonly string[]): TE.TaskEither<unknown, unknown> =>
  match(argv)
    .with(['init'], (_) =>
      pipe(
        TE.Do,
        TE.bind(`pnpm add nazna`, () => spawn('pnpm', ['add', 'nazna'])),
        TE.bind(`fix`, () => fix),
        TE.bind(`pnpm install`, () => spawn('pnpm', ['install']))
      )
    )
    .with(['build', 'cli'], (_) => writeAndChmodFile(['dist', 'cli.js'], constants.cliFile))
    .with(['fix'], (_) => fix)
    .otherwise((command) => TE.left(`command not found: ${command}`));

type Process = typeof process;

export const cli = ({
  process,
}: {
  readonly process: { readonly argv: Process['argv'] };
}): T.Task<void> =>
  pipe(
    process.argv,
    readonlyArray.dropLeft(2),
    argvToTask,
    TE.foldW(
      flow(console.error, T.fromIO),
      flow((content) => JSON.stringify(content, undefined, 2), console.log, T.fromIO)
    )
  );
