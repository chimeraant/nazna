with (import <nixpkgs> { });
mkShell {
  buildInputs = [
    nodejs-16_x
    nodePackages.pnpm
    nodePackages.eslint_d
  ];
}
