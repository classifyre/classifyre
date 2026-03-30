#!/usr/bin/env node

/**
 * Fix exports in generated OpenAPI client
 * This script ensures all generated exports are properly formatted
 */

const fs = require('fs');
const path = require('path');

const GENERATED_DIR = path.join(__dirname, '..', 'src', 'generated');

console.log('Fixing exports in generated OpenAPI client...');

// Ensure the generated directory exists
if (!fs.existsSync(GENERATED_DIR)) {
  console.error('Generated directory does not exist:', GENERATED_DIR);
  process.exit(1);
}

// Read and fix package.json
const packageJsonPath = path.join(GENERATED_DIR, 'package.json');
if (fs.existsSync(packageJsonPath)) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  
  // Ensure module type is set correctly
  packageJson.type = 'module';
  
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
  console.log('Fixed package.json');
}

// Fix models/index.ts - ensure all model files are exported
const modelsDir = path.join(GENERATED_DIR, 'src', 'models');
const modelsIndexPath = path.join(modelsDir, 'index.ts');

if (fs.existsSync(modelsDir) && fs.existsSync(modelsIndexPath)) {
  // Get all model files
  const modelFiles = fs.readdirSync(modelsDir)
    .filter(f => f.endsWith('.ts') && f !== 'index.ts')
    .sort();
  
  // Read current exports
  const currentContent = fs.readFileSync(modelsIndexPath, 'utf-8');
  const currentExports = new Set(
    [...currentContent.matchAll(/export \* from '(.+)'/g)].map(m => m[1])
  );
  
  // Generate new index.ts content
  const header = '/* tslint:disable */\n/* eslint-disable */\n';
  const exports = modelFiles.map(f => {
    const name = f.replace('.ts', '');
    return `export * from './${name}';`;
  });
  
  const newContent = header + exports.join('\n') + '\n';
  fs.writeFileSync(modelsIndexPath, newContent);
  
  const addedCount = modelFiles.length - currentExports.size;
  if (addedCount > 0) {
    console.log(`Fixed models/index.ts - added ${addedCount} missing exports`);
  } else {
    console.log('Fixed models/index.ts - all exports present');
  }

  // Patch known OpenAPI generator gap where 'BIAS' may be omitted
  // from DetectorType enum objects in some model files.
  let biasPatchedFiles = 0;
  for (const modelFile of modelFiles) {
    const fullPath = path.join(modelsDir, modelFile);
    const content = fs.readFileSync(fullPath, 'utf-8');
    if (
      content.includes('DetectorTypeEnum') &&
      content.includes("ContentQuality: 'CONTENT_QUALITY',") &&
      !content.includes("Bias: 'BIAS',")
    ) {
      const patched = content.replace(
        "ContentQuality: 'CONTENT_QUALITY',",
        "ContentQuality: 'CONTENT_QUALITY',\n    Bias: 'BIAS',"
      );
      fs.writeFileSync(fullPath, patched);
      biasPatchedFiles += 1;
    }
  }
  if (biasPatchedFiles > 0) {
    console.log(`Patched BIAS detector enum in ${biasPatchedFiles} model file(s)`);
  }
}

// Fix apis/index.ts - ensure all API files are exported
const apisDir = path.join(GENERATED_DIR, 'src', 'apis');
const apisIndexPath = path.join(apisDir, 'index.ts');

if (fs.existsSync(apisDir) && fs.existsSync(apisIndexPath)) {
  // Get all API files
  const apiFiles = fs.readdirSync(apisDir)
    .filter(f => f.endsWith('.ts') && f !== 'index.ts' && f.endsWith('Api.ts'))
    .sort();
  
  // Generate new index.ts content
  const header = '/* tslint:disable */\n/* eslint-disable */\n';
  const exports = apiFiles.map(f => {
    const name = f.replace('.ts', '');
    return `export { ${name} } from './${name}';`;
  });
  
  const newContent = header + exports.join('\n') + '\n';
  fs.writeFileSync(apisIndexPath, newContent);
  
  console.log('Fixed apis/index.ts');
}

console.log('Exports fixed successfully!');
