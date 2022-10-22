import { summonFor } from '@morphic-ts/batteries/lib/summoner-ESBST';
import type {} from '@morphic-ts/model-algebras/lib/types';
import type { AType } from '@morphic-ts/summoners';

const { summon } = summonFor({});

export const ReleaseYamlFile = summon((F) => F.strMap(F.unknown()));

export const A = summon((F) => F.optional(F.strMap(F.string())));

export const PackageJson = summon((F) =>
  F.interface(
    {
      dependencies: F.optional(F.strMap(F.string())),
      devDependencies: F.strMap(F.string()),
      scripts: F.optional(F.strMap(F.string())),
      nazna: F.optional(
        F.interface(
          {
            flake: F.optional(F.nonEmptyArray(F.string())),
          },
          'naznaConfig'
        )
      ),
    },
    'package.json'
  )
);

export type PackageJson = AType<typeof PackageJson>;
