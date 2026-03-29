import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'child_process'
import { writeFileSync } from 'fs'
import { resolve } from 'path'

const APP_MAJOR = 1
const APP_MINOR = 0

function getGitInfo() {
  try {
    const commitCount = execSync('git rev-list --count HEAD').toString().trim()
    const commitMsg = execSync('git log -1 --pretty=%s').toString().trim()
    return { commitCount, commitMsg }
  } catch {
    return { commitCount: '0', commitMsg: '' }
  }
}

const { commitCount, commitMsg } = getGitInfo()
const appVersion = `${APP_MAJOR}.${APP_MINOR}.${commitCount}`

writeFileSync(resolve(__dirname, 'public/version.json'), JSON.stringify({ version: appVersion }))

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __LAST_COMMIT_MSG__: JSON.stringify(commitMsg),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Trackr - Gestione Spese',
        short_name: 'Trackr',
        description: 'App per tracciare le spese personali stile Kakebo',
        theme_color: '#0ea5e9',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        scope: './',
        start_url: './',
        id: '/',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: true
      }
    })
  ],
  server: {
    host: '0.0.0.0',
    port: 5174,
  }
})
