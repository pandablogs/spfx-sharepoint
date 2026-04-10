'use strict';

const fs = require('fs');
const path = require('path');

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
  const rootDir = path.resolve(__dirname, '..');
  const sourcePath = path.join(rootDir, 'public', 'form.html');
  const outputPath = path.join(rootDir, 'src', 'extensions', 'customNewItem', 'generatedFormSchema.ts');

  if (!fs.existsSync(sourcePath)) {
    throw new Error('public/form.html not found');
  }

  const html = fs.readFileSync(sourcePath, 'utf8');
  const sourceSchema = extractSourceSchema(html);
  const formTitle = extractFormTitle(html);
  const formCss = extractInlineCss(html);

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
