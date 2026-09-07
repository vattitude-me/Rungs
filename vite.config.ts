import { defineConfig, loadEnv, type Plugin } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

/** Bakes the Firebase config into the push service worker.
 *
 * `public/firebase-messaging-sw.js` is copied verbatim by Vite and so gets no
 * env substitution of its own, but Firebase Messaging insists on a worker at
 * that exact path. This fills in the placeholder as the file is written, and
 * leaves an empty object when the build has no Firebase config - the worker
 * then initialises to nothing and is simply never registered, matching how
 * `cloudConfigured` gates the rest of the app. */
function pushWorkerConfig(env: Record<string, string>): Plugin {
  const config = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
  const json = JSON.stringify(config.apiKey ? config : {});

  return {
    name: 'rungs-push-worker-config',
    async writeBundle(options) {
      const target = join(options.dir ?? 'dist', 'firebase-messaging-sw.js');
      try {
        const source = await readFile(target, 'utf8');
        await writeFile(target, source.replace('self.__FIREBASE_CONFIG__', json));
      } catch {
        // No worker in this build; nothing to patch.
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    tailwindcss(),
    pushWorkerConfig(loadEnv(mode, process.cwd(), 'VITE_')),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Rungs',
        short_name: 'Rungs',
        description: 'A hundred a day, one rung at a time. Push-ups, pull-ups, squats.',
        theme_color: '#161826',
        background_color: '#161826',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // The Firebase SDK is ~530 KB and only the cloud-backup screen needs
        // it. Precaching it would make every install pay that cost up front,
        // including the many users who never sign in, so it's fetched on
        // demand and cached at runtime the first time it's actually opened.
        globIgnores: ['**/firebase-*.js'],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/firebase-.*\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'firebase-sdk',
              expiration: { maxEntries: 4 },
            },
          },
        ],
      },
    }),
  ],
}));
