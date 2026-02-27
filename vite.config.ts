import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function resolveBasePath() {
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1]

  if (!process.env.GITHUB_ACTIONS || !repo || repo.endsWith('.github.io')) {
    return '/'
  }

  return `/${repo}/`
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: resolveBasePath(),
})
