import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'child_process'

const APP_MAJOR = 1
const APP_MINOR = 0
const APP_PATCH = 33  // Incrementare manualmente ad ogni release pubblicata
const APP_RELEASE_NOTES = 'Responsive desktop layout: sidebar nav, compact cards, transaction filter chips'

function getCommitMsg() {
  try {
    return execSync('git log -1 --pretty=%s').toString().trim()
  } catch {
    return ''
  }
}

const commitMsg = getCommitMsg()
const appVersion = `${APP_MAJOR}.${APP_MINOR}.${APP_PATCH}`
const versionPayload = JSON.stringify({ version: appVersion, commitMsg, releaseNotes: APP_RELEASE_NOTES })

function versionMetadataPlugin(): Plugin {
  return {
    name: 'trackr-version-metadata',
    configureServer(server: any) {
      server.middlewares.use('/version.json', (_req: any, res: any) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(versionPayload)
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: versionPayload,
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __LAST_COMMIT_MSG__: JSON.stringify(commitMsg),
    __RELEASE_NOTES__: JSON.stringify(APP_RELEASE_NOTES),
  },
  plugins: [
    react(),
    versionMetadataPlugin(),
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
        navigateFallback: '/index.html',
      },
      devOptions: {
        enabled: true,
        suppressWarnings: true,
      }
    })
  ],
  server: {
    host: '0.0.0.0',
    port: 5174,
  }
})
