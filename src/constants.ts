import { multiline } from './utils';

export const cliFile = multiline(`
#!/usr/bin/env node
require("./cjs/index").cli(process.argv)();
`);

export const releasercJson = multiline(`
{
  "branches": [
    "main"
  ],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/npm",
    "@semantic-release/github"
  ]
}
`);

export const envrc = multiline(`
if ! has nix_direnv_version || ! nix_direnv_version 2.1.1; then
  source_url "https://raw.githubusercontent.com/nix-community/nix-direnv/2.1.1/direnvrc" "sha256-b6qJ4r34rbE23yWjMqbmu3ia2z4b2wIlZUksBke/ol0="
fi
use flake
layout node
git config --local include.path ../.nazna/.gitconfig
`);

export const eslintrcJson = multiline(`
{
  "plugins": [
    "@typescript-eslint",
    "functional",
    "fp-ts",
    "only-warn",
    "simple-import-sort",
    "unused-imports"
  ],
  "ignorePatterns": [
    "**/*.js",
    "dist/",
    "node_modules"
  ],
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "project": [
      "**/tsconfig.**"
    ]
  },
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/strict",
    "plugin:functional/all",
    "plugin:fp-ts/all",
    "plugin:prettier/recommended",
    "prettier"
  ],
  "rules": {
    "@typescript-eslint/consistent-type-definitions": [
      "error",
      "type"
    ],
    "@typescript-eslint/no-shadow": "error",
    "@typescript-eslint/unbound-method": "off",
    "functional/functional-parameters": "off",
    "functional/no-mixed-type": "off",
    "fp-ts/no-module-imports": [
      "error",
      {
        "allowTypes": true
      }
    ],
    "prettier/prettier": [
      "error",
      {
        "singleQuote": true,
        "printWidth": 100
      }
    ],
    "simple-import-sort/exports": "error",
    "simple-import-sort/imports": "error",
    "curly": [
      "error",
      "all"
    ],
    "eqeqeq": "error",
    "max-len": [
      "error",
      {
        "code": 100,
        "ignoreUrls": true
      }
    ],
    "no-else-return": "error",
    "no-undef-init": "error",
    "no-unsafe-optional-chaining": "error",
    "no-use-before-define": [
      "error",
      {
        "functions": false
      }
    ],
    "no-useless-rename": "error",
    "no-useless-return": "error",
    "object-shorthand": "error",
    "prefer-arrow-callback": "error",
    "prefer-destructuring": "error",
    "prefer-template": "error",
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "unused-imports/no-unused-imports-ts": "error",
    "unused-imports/no-unused-vars": [
      "error",
      {
        "vars": "all",
        "varsIgnorePattern": "^_",
        "args": "after-used",
        "argsIgnorePattern": "^_"
      }
    ]
  },
  "overrides": [
    {
      "files": [
        "test/**.test.ts",
        "src/test/**.ts"
      ],
      "rules": {
        "functional/no-return-void": "off",
        "functional/no-expression-statement": "off"
      }
    }
  ]
}
`);

export const npmrc = multiline(`
auto-install-peers=true
`);

export const tsconfiDistJson = multiline(`
{
  "extends": "./tsconfig",
  "include": [
    "src"
  ]
}
`);

export const tsconfigJson = multiline(`
{
  "compilerOptions": {
    "alwaysStrict": true,
    "declaration": true,
    "declarationMap": true,
    "esModuleInterop": true,
    "emitDeclarationOnly": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "lib": [
      "ESNext"
    ],
    "module": "commonjs",
    "noFallthroughCasesInSwitch": true,
    "noImplicitAny": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noImplicitThis": true,
    "noPropertyAccessFromIndexSignature": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "outDir": "dist/types",
    "skipLibCheck": true,
    "sourceMap": true,
    "strict": true,
    "strictBindCallApply": true,
    "strictFunctionTypes": true,
    "strictNullChecks": true,
    "strictPropertyInitialization": true,
    "target": "ESNext",
    "useUnknownInCatchVariables": true
  },
  "include": [
    "src",
    "test",
    "vitest.config.ts"
  ]
}
`);

const prePush = multiline(`
#!/usr/bin/env sh

pnpm pre-push
`);

const gitConfig = multiline(`
[core]
	hooksPath = .nazna/gitHooks
`);

export const nazna = {
  gitConfig,
  gitHooks: {
    prePush,
  },
};
