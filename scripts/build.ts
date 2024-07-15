import esbuild from 'esbuild'

const opts = {
  banner: {
    js: [
      '/*!',
      '  Copyright 2023 Mia srl',
      '',
      '  Licensed under the Apache License, Version 2.0 (the "License");',
      '  you may not use this file except in compliance with the License.',
      '  You may obtain a copy of the License at',
      '',
      '      http://www.apache.org/licenses/LICENSE-2.0',
      '',
      '  Unless required by applicable law or agreed to in writing, software',
      '  distributed under the License is distributed on an "AS IS" BASIS,',
      '  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.',
      '  See the License for the specific language governing permissions and',
      '  limitations under the License.',
      '*/',
    ].join('\n'),
  },
  entryPoints: ['src/index.ts'],
  bundle: true,
  external: ['crypto'],
}

Promise.all([
  esbuild.build({
    ...opts,
    format: 'cjs',
    outExtension: { '.js': '.cjs' },
    outdir: 'dist/cjs',
  })
    .then(() => `✅ cjs compiled`),
  esbuild.build({
    ...opts,
    format: 'esm',
    outdir: 'dist/es',
  })
    .then(() => `✅ esm compiled`),
])
  .then((logs) => logs.forEach((log) => console.info(log)))
  .catch(console.error)
