// scripts/post-build.js
// Copies manifest.json, icons, and static files to dist/ (or dist-firefox/)
// Supports BROWSER=firefox env var for Firefox build

import { copyFileSync, mkdirSync, existsSync, writeFileSync, readFileSync, cpSync, rmSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const isFirefox = process.env.BROWSER === 'firefox';
const chromeDist = join(root, 'dist');
const distDir = isFirefox ? join(root, 'dist-firefox') : chromeDist;

// ─── Inline chunk imports (Chrome extension scripts can't use ES modules) ───
function inlineChunks(distPath) {
  const chunksDir = join(distPath, 'chunks');
  if (!existsSync(chunksDir)) return;

  // Read all chunk files
  const chunkContents = {};
  for (const file of readdirSync(chunksDir)) {
    let content = readFileSync(join(chunksDir, file), 'utf-8');
    // Remove export statements
    content = content.replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '');
    chunkContents[file] = content.trim();
  }

  // Inline imports in each JS entry file
  for (const entry of ['background.js', 'content.js', 'popup.js']) {
    const entryPath = join(distPath, entry);
    if (!existsSync(entryPath)) continue;

    let code = readFileSync(entryPath, 'utf-8');
    const inlined = [];

    // Find and remove all import lines, collect chunk filenames
    code = code.replace(/^import\s+.*?['"]\.\/chunks\/(.+?)['"]\s*;?\s*$/gm, (_match, chunkFile) => {
      if (!inlined.includes(chunkFile) && chunkContents[chunkFile]) {
        inlined.push(chunkFile);
      }
      return ''; // Remove the import line
    });

    // Prepend inlined chunk code
    if (inlined.length > 0) {
      const prefix = inlined.map(f => chunkContents[f]).join('\n');
      code = prefix + '\n' + code;
    }

    writeFileSync(entryPath, code);
  }

  // Fix popup.html: remove type="module", crossorigin, and modulepreload links
  const popupPath = join(distPath, 'popup.html');
  if (existsSync(popupPath)) {
    let html = readFileSync(popupPath, 'utf-8');
    html = html.replace(/\s*type="module"/g, '');
    html = html.replace(/\s*crossorigin/g, '');
    html = html.replace(/\s*<link\s+rel="modulepreload"[^>]*>\s*/g, '\n');
    writeFileSync(popupPath, html);
  }

  // Remove chunks directory
  rmSync(chunksDir, { recursive: true, force: true });
  console.log('✅ Inlined chunk imports into entry files');
}

// Read source manifest
const manifest = JSON.parse(readFileSync(join(root, 'public', 'manifest.json'), 'utf-8'));

if (isFirefox) {
  // --- Firefox build: copy Chrome dist then overwrite manifest ---
  if (!existsSync(chromeDist)) {
    console.error('❌ Chrome dist/ must exist before building Firefox.');
    console.error('   Run "npm run build" first (without BROWSER=firefox).');
    process.exit(1);
  }

  if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });
  cpSync(chromeDist, distDir, { recursive: true });

  // Convert to Firefox Manifest V2
  const firefoxManifest = {
    manifest_version: 2,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    permissions: [...manifest.permissions.filter(p => p !== 'commands'), '<all_urls>'],
    commands: manifest.commands,
    background: {
      scripts: ['background.js'],
      persistent: false,
    },
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['content.js'],
        css: manifest.content_scripts?.[0]?.css || [],
      },
    ],
    browser_action: {
      default_popup: 'popup.html',
      default_icon: {
        '16': 'icons/icon16.png',
        '48': 'icons/icon48.png',
        '128': 'icons/icon128.png',
      },
    },
    icons: {
      '16': 'icons/icon16.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png',
    },
    browser_specific_settings: {
      gecko: {
        id: 'screenai@screenai.app',
        strict_min_version: '109.0',
        data_collection_permissions: {
          required: ['none'],
          optional: ['none'],
        },
      },
    },
  };

  writeFileSync(join(distDir, 'manifest.json'), JSON.stringify(firefoxManifest, null, 2));
  inlineChunks(distDir);
  console.log('✅ Firefox extension built to dist-firefox/');
  console.log('📦 Load it in about:debugging → This Firefox → Load Temporary Add-on');
} else {
  // --- Chrome MV3 build ---
  if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

  // Fix paths for built files
  manifest.background.service_worker = 'background.js';
  manifest.content_scripts[0].js = ['content.js'];
  delete manifest.background.type;

  writeFileSync(join(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Copy icons
  const iconsDir = join(distDir, 'icons');
  if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });

  for (const size of [16, 48, 128]) {
    const iconPath = join(root, 'public', 'icons', `icon${size}.png`);
    const destPath = join(iconsDir, `icon${size}.png`);
    if (existsSync(iconPath)) {
      copyFileSync(iconPath, destPath);
    } else {
      console.error(`❌ Missing icon: public/icons/icon${size}.png`);
      console.error('   Generate PNG icons from logo.svg first (see DEPLOY_GUIDE.md section 5.2)');
      process.exit(1);
    }
  }

  inlineChunks(distDir);
  console.log('✅ Chrome extension built to dist/');
  console.log('📦 Load it in chrome://extensions with "Load unpacked" pointing to the dist/ folder');
}
