'use strict';

const fs = require('fs');
const path = require('path');

function parseEnvFile(envContent) {
  const result = {};
  const lines = envContent.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (key) {
      result[key] = value;
    }
  }

  return result;
}

function main() {
  const rootDir = path.resolve(__dirname, '..');
  const envPath = path.join(rootDir, '.env');
  const serveConfigPath = path.join(rootDir, 'config', 'serve.json');

  if (!fs.existsSync(envPath)) {
    // Enterprise bridge approach doesn't require per-build env injection.
    // If no .env exists, keep serve.json as-is (developer can edit pageUrl directly).
    console.log('No .env found. Leaving config/serve.json unchanged.');
    return;
  }

  const envContent = fs.readFileSync(envPath, 'utf8');
  const env = parseEnvFile(envContent);

  const pageUrl = env.SPFX_PAGE_URL || env.LIST_URL;
  if (!pageUrl) {
    throw new Error('SPFX_PAGE_URL or LIST_URL is required in .env');
  }

  const serveJson = JSON.parse(fs.readFileSync(serveConfigPath, 'utf8'));

  if (!serveJson.serveConfigurations) {
    serveJson.serveConfigurations = {};
  }
  if (!serveJson.serveConfigurations.default) {
    serveJson.serveConfigurations.default = {};
  }

  serveJson.serveConfigurations.default.pageUrl = pageUrl;

  fs.writeFileSync(serveConfigPath, `${JSON.stringify(serveJson, null, 2)}\n`, 'utf8');
  console.log(`Updated serve pageUrl from .env: ${pageUrl}`);
}

main();
