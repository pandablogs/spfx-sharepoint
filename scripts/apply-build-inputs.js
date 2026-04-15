/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input' || a === '-i') {
      out.input = argv[i + 1];
      i++;
      continue;
    }
  }
  return out;
}

function mustGuid(value) {
  const v = String(value || '').trim();
  if (!v) throw new Error('Missing listGuid in build input');
  // Accept with or without braces; normalize to no braces for XML RegistrationId.
  const normalized = v.replace(/^\{/, '').replace(/\}$/, '');
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(normalized)) {
    throw new Error(`Invalid listGuid format: ${v}`);
  }
  return normalized.toLowerCase();
}

function updateElementsXml(elementsXmlPath, listGuid) {
  if (!fs.existsSync(elementsXmlPath)) throw new Error(`Missing file: ${elementsXmlPath}`);
  const xml = fs.readFileSync(elementsXmlPath, 'utf8');

  const props = JSON.stringify({ listGuid });
  const updated = xml
    .replace(/\{LIST_GUID\}/g, listGuid)
    .replace(/RegistrationId="[^"]*"/i, `RegistrationId="${listGuid}"`)
    .replace(/ClientSideComponentProperties="[^"]*"/i, `ClientSideComponentProperties="${props.replace(/"/g, '&quot;')}"`);

  fs.writeFileSync(elementsXmlPath, updated, 'utf8');
}

function writeFormioJson(outPath, formio) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(formio, null, 2)}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv);
  const rootDir = path.resolve(__dirname, '..');

  const inputPath = args.input
    ? path.resolve(process.cwd(), args.input)
    : path.join(rootDir, 'build-input.json');

  if (!fs.existsSync(inputPath)) throw new Error(`Build input not found: ${inputPath}`);
  const buildInput = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

  const listGuid = mustGuid(buildInput.listGuid);
  if (!buildInput.formio || typeof buildInput.formio !== 'object') {
    throw new Error('Missing formio object in build input');
  }

  const elementsXmlPath = path.join(rootDir, 'sharepoint', 'assets', 'elements.xml');
  updateElementsXml(elementsXmlPath, listGuid);

  const formioOutPath = path.join(rootDir, 'public', 'formio.json');
  writeFormioJson(formioOutPath, buildInput.formio);

  // Optional: allow build input to override title/css by writing a tiny sidecar file
  const metaOutPath = path.join(rootDir, 'public', 'form-meta.json');
  fs.writeFileSync(
    metaOutPath,
    `${JSON.stringify({ formTitle: buildInput.formTitle, formCss: buildInput.formCss }, null, 2)}\n`,
    'utf8'
  );

  console.log('Applied build inputs.');
  console.log(`- listGuid: ${listGuid}`);
  console.log(`- updated: ${path.relative(rootDir, elementsXmlPath)}`);
  console.log(`- wrote:   ${path.relative(rootDir, formioOutPath)}`);
}

main();

