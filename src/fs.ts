import { summonFor } from '@morphic-ts/batteries/lib/summoner-BASTJ';
import { either as E, taskEither as TE } from 'fp-ts';
import { flow, identity } from 'fp-ts/function';
import { Mode } from 'fs';
import * as _fs from 'fs/promises';
import * as pathModule from 'path';

const { summon } = summonFor({});

export const ReadFileError = summon((F) =>
  F.interface(
    {
      code: F.stringLiteral('ENOENT'),
    },
    'ENOENT'
  )
);

type ReadFileErr =
  | {
      readonly code: 'unknown';
      readonly value: unknown;
    }
  | {
      readonly code: 'ENOENT';
    };

export const fs = {
  writeFile: (path: readonly string[]) => (data: string) =>
    TE.tryCatch(
      () => _fs.writeFile(pathModule.join(...path), data, { encoding: 'utf8' }),
      identity
    ),
  readFile: (path: readonly string[]): TE.TaskEither<ReadFileErr, string> =>
    TE.tryCatch(
      () => _fs.readFile(pathModule.join(...path), 'utf8'),
      flow(
        ReadFileError.type.decode,
        E.foldW(
          (value) => ({ code: 'unknown', value }),
          ({ code }) => ({ code })
        )
      )
    ),
  mkDir: (path: readonly string[]) =>
    TE.tryCatch(() => _fs.mkdir(pathModule.join(...path), { recursive: true }), identity),
  chmod: (path: readonly string[], mode: Mode) =>
    TE.tryCatch(() => _fs.chmod(pathModule.join(...path), mode), identity),
};
