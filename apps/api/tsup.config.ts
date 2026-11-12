import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/worker.ts', 'src/db/migrate.ts', 'src/scripts/download-model.ts'],
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // The shared contract package is TypeScript source, so bundle it in;
  // real npm dependencies stay external and are installed in the image.
  noExternal: ['@docchat/shared'],
});
