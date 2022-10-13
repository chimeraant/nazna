import path from 'path';
import { defineConfig, UserConfigExport } from 'vitest/config';

export const config: UserConfigExport = {
  build: {
    minify: false,
    lib: {
      entry: path.resolve(__dirname, 'src/bin.ts'),
      name: 'nazna',
      fileName: 'bin',
      formats: ['umd'],
    },
  },
};

export default defineConfig(config);
