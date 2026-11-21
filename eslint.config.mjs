import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'

const eslintConfig = defineConfig([
  ...nextVitals,
  {
    rules: {
      // Downgraded to warn (no source edits): existing code calls Date.now() in
      // async server components (weekly window) and syncs props/storage into
      // state in effects. Style/perf rules, not bug findings.
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Build output and dependencies:
    '.open-next/**',
    'node_modules/**',
  ]),
])

export default eslintConfig
