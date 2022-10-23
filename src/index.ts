import { spawn as sp } from 'child-process-promise';
import {
  console,
  either as E,
  option as O,
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
import { PackageJson, ReleaseYamlFile } from './type';
import { multiline } from './utils';
import * as validation from './validation';

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
    name: 'Nazna fix',
    run: 'pnpm nazna fix',
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

const getRepoUrll = TE.tryCatch(() => simpleGit().listRemote(['--get-url', 'origin']), identity);

const jsonPrettyStringify = (obj: unknown) =>
  E.tryCatch(() => JSON.stringify(obj, undefined, 2), identity);

const fixPackageJson = (packageJson: PackageJson) =>
  pipe(
    getRepoUrll,
    TE.map(
      flow(string.split('\n'), readonlyNonEmptyArray.head, (firstRepoUrl) =>
        pipe({
          ...packageJson,
          ...(packageJson.dependencies
            ? { dependencies: sortedRecord(packageJson.dependencies) }
            : {}),
          ...{
            devDependencies: sortedRecord({
              ...packageJson.devDependencies,
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
              test: 'vitest',
              ...packageJson.scripts,
              'build:es6': 'swc src --out-dir dist/es6 --source-maps',
              'build:cjs': 'swc src --out-dir dist/cjs --source-maps --config module.type=commonjs',
              'build:types': 'tsc --project tsconfig.dist.json',
              build: 'pnpm build:types && pnpm build:es6 && pnpm build:cjs && nazna build cli',
              fix: 'eslint --max-warnings=0 --ext .ts . --fix',
              lint: 'eslint --max-warnings=0 --ext .ts .',
              'pre-push:dirty': 'CI=true pnpm install && pnpm build && pnpm lint && pnpm test',
              'pre-push': 'pnpm pre-push:dirty && pnpm publish --dry-run',
            }),
            repository: firstRepoUrl,
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
      )
    ),
    TE.chainEitherK(jsonPrettyStringify),
    validation.liftTE
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

const flakeNixTemplate = (packages: string) =>
  multiline(`
{
  outputs = { self, nixpkgs }: with nixpkgs.legacyPackages.x86_64-linux; {
    devShell.x86_64-linux = mkShell {
      buildInputs = [
        nodejs-16_x
        nodePackages.pnpm${packages}
      ];
    };
  };
}
`);

const flakeNix = (packageJson: PackageJson) =>
  pipe(
    O.fromNullable(packageJson.nazna?.flake),
    O.map(
      flow(
        readonlyArray.map(std.string.prepend('\n        ')),
        std.readonlyArray.join(''),
        flakeNixTemplate
      )
    ),
    O.getOrElse(() => '')
  );

const getDirPath = readonlyArray.dropRight(1);

const safeWriteFile = (filePath: readonly string[], content: string) =>
  pipe(
    pipe(filePath, getDirPath, fs.mkDir),
    TE.chain(() => fs.writeFile(filePath, content)),
    validation.liftTE
  );

const writeAndChmodFile = (path: readonly string[], content: string) =>
  pipe(
    safeWriteFile(path, content),
    TE.chain(() => fs.chmod(path, 0o755)),
    validation.liftTE
  );

const fixAndWrite = (
  path: readonly string[],
  fixer: (input: string) => TE.TaskEither<readonly unknown[], string>,
  content: string
) =>
  pipe(
    fixer(content),
    TE.chain((fixerResult) => safeWriteFile(path, fixerResult))
  );

const fixFile = (
  path: readonly string[],
  fixer: (input: string) => TE.TaskEither<readonly unknown[], string>,
  emptyContent: string
) =>
  pipe(
    fs.readFile(path),
    T.chain((fileReadResult) =>
      pipe(
        fileReadResult,
        E.foldW(
          (err) =>
            err.code === 'ENOENT'
              ? fixAndWrite(path, fixer, emptyContent)
              : validation.liftTE(TE.left(err)),
          (fileContent) => fixAndWrite(path, fixer, fileContent)
        )
      )
    )
  );

const spawn = (command: string, args: readonly string[]) =>
  pipe(
    TE.tryCatch(() => sp(command, args), identity),
    TE.map(({ code, stderr, stdout }) => ({ code, stdout, stderr })),
    validation.liftTE
  );

const fix = validation.apply(
  safeWriteFile(['.releaserc.json'], constants.releasercJson),
  safeWriteFile(['.eslintrc.json'], constants.eslintrcJson),
  safeWriteFile(['.npmrc'], constants.npmrc),
  safeWriteFile(['tsconfig.json'], constants.tsconfigJson),
  safeWriteFile(['tsconfig.dist.json'], constants.tsconfiDistJson),
  safeWriteFile(['.nazna', '.gitconfig'], constants.nazna.gitConfig),
  writeAndChmodFile(['.nazna', 'gitHooks', 'pre-push'], constants.nazna.gitHooks.prePush),
  fixFile(['.github', 'workflows', 'release.yaml'], fixReleaseYamlFile, 'name: Release'),
  fixFile(['.gitignore'], fixGitignore, ''),
  safeWriteFile(['.envrc'], constants.envrc),
  pipe(
    fs.readFile(['package.json']),
    validation.liftTE,
    TE.map((text) => JSON.parse(text)),
    TE.chainEitherKW((k) => PackageJson.type.decode(k)),
    TE.chain((packageJson) =>
      validation.apply(
        pipe(
          fixPackageJson(packageJson),
          TE.chain((content) => safeWriteFile(['package.json'], content))
        ),
        safeWriteFile(['flake.nix'], flakeNix(packageJson))
      )
    )
  )
);

const init = pipe(
  spawn('pnpm', ['add', '-D', 'nazna']),
  TE.chain(() => fix),
  TE.chain(() => spawn('pnpm', ['install']))
);

const argvToTask = (argv: readonly string[]): TE.TaskEither<unknown, unknown> =>
  match(argv)
    .with(['init'], (_) => init)
    .with(['build', 'cli'], (_) => writeAndChmodFile(['dist', 'cli.js'], constants.cliFile))
    .with(['fix'], (_) => fix)
    .otherwise((command) => TE.left(`command not found: ${command}`));

type Process = typeof process;

export const cli = ({
  process,
}: {
  readonly process: Pick<Process, 'argv' | 'exit'>;
}): T.Task<void> =>
  pipe(
    process.argv,
    readonlyArray.dropLeft(2),
    argvToTask,
    T.chain((result) => pipe(TE.fromEither(jsonPrettyStringify(result)), TE.chainIOK(console.log))),
    T.chainIOK(
      E.fold(
        () => () => process.exit(1),
        () => () => process.exit(0)
      )
    )
  );
