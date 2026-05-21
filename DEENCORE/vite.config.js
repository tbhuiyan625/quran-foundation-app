import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // BASE_PATH override: GitHub Pages needs '/<repo-name>/', Vercel/Render serve from '/'.
  // Set VITE_BASE_PATH=/quran-foundation-app/ only when targeting GitHub Pages.
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [
    react({
      // Faster refresh on changes
      fastRefresh: true,
      // Optimize babel compilation
      babel: {
        parserOpts: {
          sourceType: 'module',
          allowImportExportEverywhere: true,
          allowMultipleDefaultExports: true,
        },
      },
    }),
  ],
  
  // Performance optimizations
  build: {
    // Code splitting for better caching
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom'],
        },
      },
    },
    // Smaller chunks for faster load
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false,
      },
    },
    // Optimize for speed
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    assetsInlineLimit: 4096,
  },
  
  server: {
    host: true,
    port: 5173,
    // Optimize HMR for faster refresh
    hmr: {
      protocol: 'ws',
      timeout: 60000,
    },
    // Middleware warmup
    warmupEntry: ['src/main.jsx'],
  },
  
  // CSS optimization
  css: {
    postcss: null,
  },
  
  // Optimize dependencies
  optimizeDeps: {
    include: ['react', 'react-dom'],
    exclude: [],
  },
});
