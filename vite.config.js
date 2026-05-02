import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/logo.jpg'],
      manifest: {
        name: 'Diogène',
        short_name: 'Diogène',
        description: 'Pour les cancres enthousiastes et les pros décontractés',
        theme_color: '#185FA5',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'icons/logo.jpg',
            sizes: '512x512',
            type: 'image/jpeg',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        skipWaiting: true,      // active le nouveau SW sans attendre la fermeture des onglets
        clientsClaim: true,     // le nouveau SW prend le contrôle de tous les clients immédiatement
        globPatterns: ['**/*.{js,css,html,ico,png,jpg,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts-cache' }
          },
          {
            // Salamander Grand Piano (Piano samples — CC-BY)
            urlPattern: /^https:\/\/tonejs\.github\.io\/audio\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'audio-samples-piano',
              expiration: { maxEntries: 60, maxAgeSeconds: 365 * 24 * 60 * 60 }
            }
          },
          {
            // FluidR3_GM choir_aahs (Chœur samples — MIT)
            urlPattern: /^https:\/\/gleitz\.github\.io\/midi-js-soundfonts\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'audio-samples-choir',
              expiration: { maxEntries: 30, maxAgeSeconds: 365 * 24 * 60 * 60 }
            }
          }
        ]
      }
    })
  ],
})
