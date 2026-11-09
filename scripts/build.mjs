import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const filesInOrder = [
  'src/domain/dateUtils.mjs',
  'src/domain/types.mjs',
  'src/domain/recurrence.mjs',
  'src/domain/ledger.mjs',
  'src/domain/budgets.mjs',
  'src/domain/obligations.mjs',
  'src/domain/totals.mjs',
  'src/domain/projection.mjs',
  'src/domain/audit.mjs',
  'src/storage/sharding.mjs',
  'src/storage/migration.mjs',
  'src/storage/backup.mjs',
  'src/ui/charts.mjs',
  'src/ui/app.mjs'
];

function transformModule(code) {
  return code
    // Remove import statements
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?/gm, '')
    // Convert 'export function' to 'function'
    .replace(/^export\s+function\s+/gm, 'function ')
    // Convert 'export const' to 'const'
    .replace(/^export\s+const\s+/gm, 'const ')
    // Convert 'export let' to 'let'
    .replace(/^export\s+let\s+/gm, 'let ')
    // Convert 'export default' to ''
    .replace(/^export\s+default\s+/gm, '');
}

function build() {
  console.log('Building Budget Tracker v2 single-file HTML artifact...');

  const cssPath = path.join(rootDir, 'src/ui/styles.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  let combinedJs = '(() => {\n';
  for (const relPath of filesInOrder) {
    const fullPath = path.join(rootDir, relPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    combinedJs += `\n// --- ${relPath} ---\n`;
    combinedJs += transformModule(content);
  }

  combinedJs += `
  // --- Bootloader ---
  function boot() {
    const el = document.getElementById('app');
    if (el) initApp(el);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
`;

  if (combinedJs.toLowerCase().includes('</script>')) {
    throw new Error('Fatal build error: </script> tag detected inside JavaScript modules!');
  }

  try {
    new vm.Script(combinedJs);
    console.log('[VALIDATION] Bundled JavaScript syntax is 100% valid.');
  } catch (err) {
    console.error('[FATAL BUILD ERROR] Syntax error in combined JavaScript:', err);
    throw err;
  }

  const manifestJson = {
    name: 'Budget Tracker v2',
    short_name: 'Budget',
    description: 'AMOLED Black Blocky Personal Finance & Budget Tracker',
    start_url: './index.html',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    orientation: 'any',
    icons: [
      {
        src: 'icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any maskable'
      }
    ]
  };

  const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#000000"/>
  <rect x="32" y="32" width="448" height="448" fill="#11111b" stroke="#a6e3a1" stroke-width="24"/>
  <text x="256" y="320" font-family="monospace" font-size="280" font-weight="900" fill="#a6e3a1" text-anchor="middle">₹</text>
</svg>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#000000">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Budget">
<meta name="application-name" content="Budget Tracker">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/svg+xml" href="icon.svg">
<title>Budget Tracker v2</title>
<style>
${css}
</style>
</head>
<body>
<main id="app"></main>
<script>
${combinedJs}
</script>
</body>
</html>`;

  const distDir = path.join(rootDir, 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const outDist = path.join(distDir, 'index.html');
  const outRoot = path.join(rootDir, 'Budget Tracker v2.html');
  const outManifest = path.join(distDir, 'manifest.webmanifest');
  const outIcon = path.join(distDir, 'icon.svg');

  fs.writeFileSync(outDist, html, 'utf8');
  fs.writeFileSync(outRoot, html, 'utf8');
  fs.writeFileSync(outManifest, JSON.stringify(manifestJson, null, 2), 'utf8');
  fs.writeFileSync(outIcon, iconSvg, 'utf8');

  console.log(`[SUCCESS] Bundle generated:`);
  console.log(`  - ${outDist} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
  console.log(`  - ${outRoot} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
  console.log(`  - ${outManifest}`);
  console.log(`  - ${outIcon}`);
}

build();
