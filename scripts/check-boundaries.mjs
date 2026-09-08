import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root = fileURLToPath(new URL('../', import.meta.url));
const areas = ['apps/web', 'server', 'packages/protocol', 'packages/game-core'];
const allowed = {
  'apps/web': ['packages/protocol'],
  server: ['packages/protocol', 'packages/game-core'],
  'packages/protocol': [],
  'packages/game-core': [],
};
const packageNames = new Map();
for (const area of areas)
  packageNames.set(
    JSON.parse(await readFile(resolve(root, area, 'package.json'), 'utf8')).name,
    area,
  );
const errors = [];
function boundary(owner, name, file) {
  let target;
  for (const [pkg, area] of packageNames)
    if (name === pkg || name.startsWith(pkg + '/')) target = area;
  if (name.startsWith('.')) {
    const destination = relative(root, resolve(dirname(file), name))
      .split(sep)
      .join('/');
    target = areas.find((area) => destination.startsWith(area + '/'));
    if (owner === 'packages/game-core' && !destination.startsWith(owner + '/'))
      errors.push(file + ': core import escapes package: ' + name);
  }
  if (target && target !== owner && !allowed[owner].includes(target))
    errors.push(file + ': forbidden dependency ' + name);
  if (owner === 'packages/game-core' && !name.startsWith('.'))
    errors.push(file + ': pure core cannot import external package ' + name);
  if ((owner === 'apps/web' || owner === 'packages/protocol') && name.startsWith('node:'))
    errors.push(file + ': browser boundary imports Node ' + name);
}
async function walk(directory, owner) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, item.name);
    if (item.isDirectory()) {
      if (!['node_modules', 'dist'].includes(item.name)) await walk(file, owner);
    } else if (/\.[cm]?[jt]sx?$/.test(item.name) && !item.name.endsWith('.test.ts')) {
      const source = ts.createSourceFile(
        file,
        await readFile(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      function visit(node) {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        )
          boundary(owner, node.moduleSpecifier.text, file);
        if (
          ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
        ) {
          const argument = node.arguments[0];
          if (argument && ts.isStringLiteral(argument)) boundary(owner, argument.text, file);
          else errors.push(file + ': nonliteral module loading cannot be boundary checked');
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
}
for (const area of areas) {
  const manifest = JSON.parse(await readFile(resolve(root, area, 'package.json'), 'utf8'));
  for (const name of Object.keys(manifest.dependencies ?? {}))
    boundary(area, name, resolve(root, area, 'package.json'));
  await walk(resolve(root, area, 'src'), area);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log('Workspace dependency boundaries passed.');
