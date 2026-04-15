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
    if (a === '--meta') {
      out.meta = argv[i + 1];
      i++;
      continue;
    }
  }
  return out;
}

function extractSourceSchema(html) {
  const schemaMatch = html.match(/const\s+sourceSchema\s*=\s*(\{[\s\S]*?\});/);
  if (!schemaMatch || !schemaMatch[1]) {
    throw new Error('Could not find sourceSchema in public/form.html');
  }
  return JSON.parse(schemaMatch[1]);
}

function extractFormTitle(html) {
  const titleMatch = html.match(/<h1[^>]*class=["']form-title["'][^>]*>([\s\S]*?)<\/h1>/i);
  if (!titleMatch || !titleMatch[1]) {
    return 'test-spgx';
  }
  return titleMatch[1].replace(/<[^>]+>/g, '').trim();
}

function extractInlineCss(html) {
  const cssParts = [];
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let match;
  while ((match = styleRegex.exec(html)) !== null) {
    if (match[1]) {
      cssParts.push(match[1].trim());
    }
  }
  return cssParts.join('\n\n');
}

function safeReadJson(filePath) {
  if (!filePath) return undefined;
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return undefined;
  }
}

function collectInputFields(components, output) {
  if (!Array.isArray(components)) {
    return;
  }

  for (const component of components) {
    if (!component || typeof component !== 'object') {
      continue;
    }

    const key = String(component.key || '').trim();
    const type = String(component.type || '').trim();
    const label = String(component.label || key || '').trim();

    const customClass = String(component.customClass || '').trim();
    const isInputField = Boolean(component.input) && key && type && type !== 'button';
    if (isInputField) {
      output.push({ key, label, type, customClass });
    }

    if (Array.isArray(component.components)) {
      collectInputFields(component.components, output);
    }

    if (Array.isArray(component.columns)) {
      for (const column of component.columns) {
        collectInputFields(column?.components, output);
      }
    }

    if (Array.isArray(component.rows)) {
      for (const row of component.rows) {
        if (!Array.isArray(row)) {
          continue;
        }
        for (const cell of row) {
          collectInputFields(cell?.components, output);
        }
      }
    }

    if (Array.isArray(component.tabs)) {
      for (const tab of component.tabs) {
        collectInputFields(tab?.components, output);
      }
    }
  }
}

function main() {
  const args = parseArgs(process.argv);
  const rootDir = path.resolve(__dirname, '..');
  const outputPath = path.join(rootDir, 'src', 'extensions', 'customNewItem', 'generatedFormSchema.ts');

  const metaPath = args.meta ? path.resolve(process.cwd(), args.meta) : path.join(rootDir, 'public', 'form-meta.json');
  const meta = safeReadJson(metaPath) || {};

  const inputPath = args.input
    ? path.resolve(process.cwd(), args.input)
    : path.join(rootDir, 'public', 'formio.json');

  let sourceSchema;
  let formTitle = typeof meta.formTitle === 'string' ? meta.formTitle : undefined;
  let formCss = typeof meta.formCss === 'string' ? meta.formCss : undefined;

  if (fs.existsSync(inputPath) && inputPath.toLowerCase().endsWith('.json')) {
    sourceSchema = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    if (!formTitle && sourceSchema && typeof sourceSchema.title === 'string') {
      formTitle = sourceSchema.title;
    }
  } else {
    const sourcePath = path.join(rootDir, 'public', 'form.html');
    if (!fs.existsSync(sourcePath)) {
      throw new Error('No JSON input and public/form.html not found');
    }
    const html = fs.readFileSync(sourcePath, 'utf8');
    sourceSchema = extractSourceSchema(html);
    if (!formTitle) formTitle = extractFormTitle(html);
    if (!formCss) formCss = extractInlineCss(html);
  }

  if (!formTitle) formTitle = 'External Form';
  if (!formCss) formCss = '';

  const fields = [];
  collectInputFields(sourceSchema.components || [], fields);

  const uniqueByKey = new Map();
  for (const field of fields) {
    if (!uniqueByKey.has(field.key)) {
      uniqueByKey.set(field.key, field);
    }
  }
  const uniqueFields = Array.from(uniqueByKey.values());

  const output =
`export interface IGeneratedFormField {
  key: string;
  label: string;
  type: string;
  customClass?: string;
}

export const GENERATED_FORM_TITLE: string = ${JSON.stringify(formTitle)};
export const GENERATED_FORM_CSS: string = ${JSON.stringify(formCss)};

export const GENERATED_FORM_FIELDS: IGeneratedFormField[] = ${JSON.stringify(uniqueFields, null, 2)};
`;

  fs.writeFileSync(outputPath, output, 'utf8');
  console.log(`Generated form schema: ${path.relative(rootDir, outputPath)}`);
}

main();
