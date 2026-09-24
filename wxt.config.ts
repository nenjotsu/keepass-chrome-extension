import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';

/**
 * Vite plugin that neutralizes new Worker() calls from fflate
 * (bundled inside kdbxweb). Chrome MV3 Service Workers cannot
 * create Web Workers. kdbxweb only uses sync gzip functions so
 * the async worker path is never reached at runtime.
 */
function stripFflateWorker(): Plugin {
  return {
    name: 'strip-fflate-worker',
    transform(code, id) {
      if (id.includes('kdbxweb') && code.includes('new Worker(')) {
        return {
          code: code.replace(
            /new Worker\(/g,
            'new (function(){throw new Error("Worker not available")}||Worker)(',
          ),
          map: null,
        };
      }
      return null;
    },
  };
}

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  hooks: {
    'build:manifestGenerated': (_wxt, manifest) => {
      // Keep WXT's content-script bundle in the build output, but require the
      // background to register it dynamically for user-approved origins only.
      delete manifest.content_scripts;
      delete manifest.host_permissions;
    },
  },
  manifest: {
    name: 'KeePass Password Manager',
    description:
      'KeePass-compatible password manager with local encryption and optional privacy-preserving breached-password checks.',
    homepage_url: 'https://github.com/Ilya37/keepass-chrome-extension',
    permissions: ['storage', 'alarms', 'clipboardWrite', 'favicon', 'scripting', 'activeTab', 'tabs'],
    optional_host_permissions: ['*://*/*', 'https://api.pwnedpasswords.com/*'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; style-src 'self' 'unsafe-inline'",
    },
  },
  vite: () => ({
    plugins: [tailwindcss(), stripFflateWorker()],
  }),
});
