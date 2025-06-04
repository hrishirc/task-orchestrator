import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  outDir: 'build',
  target: 'es2020',
  platform: 'node',
  noExternal: ['@modelcontextprotocol/sdk'],
});
