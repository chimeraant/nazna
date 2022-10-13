import * as fs from 'fs';
import path from 'path';
import { UserConfigExport } from 'vitest/config';

export const libConfig = (): UserConfigExport => ({
  build: {
    lib: {
      name: JSON.parse(fs.readFileSync('package.json', 'utf8')).name,
      entry: path.resolve(process.cwd(), 'src/index.ts'),
      fileName: 'index',
      formats: ['es', 'cjs', 'umd', 'iife'],
    },
  },
});
