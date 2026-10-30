// Resolve the production library entry graph without executing dependency code.
// CLI-only dependencies are intentionally outside this graph.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire, isBuiltin } = require('node:module');

const root = path.resolve(__dirname, '..');
const modules = path.join(root, 'node_modules');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const files = new Set();
const checked = new Set();
const insideModules = file => file.startsWith(modules + path.sep);
function checkedFile(file) {
  if (!insideModules(file) || !insideModules(fs.realpathSync(file))) {
    throw Error('Production dependency escapes node_modules: ' + file);
  }
  let cursor = modules;
  for (const part of path.relative(modules, file).split(path.sep)) {
    cursor = path.join(cursor, part);
    if (fs.lstatSync(cursor).isSymbolicLink()) throw Error('Symlink is not a releasable dependency: ' + cursor);
  }
  if (!fs.statSync(file).isFile()) throw Error('Dependency is not a file: ' + file);
  return file;
}
function includePackageMetadata(file) {
  let directory = path.dirname(file);
  while (insideModules(directory)) {
    if (fs.existsSync(path.join(directory, 'package.json'))) {
      const metadata = checkedFile(path.join(directory, 'package.json'));
      files.add(metadata);
      const definition = JSON.parse(fs.readFileSync(metadata, 'utf8'));
      if (definition.type === 'module') throw Error('ES module dependencies require an explicit static import graph: ' + metadata);
      for (const name of fs.readdirSync(directory)) {
        if (/^(?:licen[sc]e|copying|notice|authors)(?:[._-].*)?$/i.test(name)) {
          const candidate = path.join(directory, name);
          if (fs.statSync(candidate).isFile()) files.add(checkedFile(candidate));
        }
      }
      return;
    }
    directory = path.dirname(directory);
  }
  throw Error('Missing production dependency package.json: ' + file);
}
function visit(file) {
  file = checkedFile(file);
  if (checked.has(file)) return;
  checked.add(file);
  files.add(file);
  includePackageMetadata(file);
  if (path.extname(file) === '.json') return;
  if (!['.js', '.cjs'].includes(path.extname(file))) throw Error('Unsupported executable dependency type: ' + file);
  const source = fs.readFileSync(file, 'utf8');
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(source)) throw Error('Forbidden code evaluation in production dependency: ' + file);
  // Preserve quoted strings while excluding commented-out imports. The final
  // ZIP check still scans original bytes for all prohibited loader forms.
  const executable = source.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (match, quoted) => quoted || ' '.repeat(match.length));
  const resolver = createRequire(file);
  for (const call of executable.matchAll(/\brequire\s*\(/g)) {
    const argument = executable.slice(call.index + call[0].length);
    const literal = /^\s*(['"])([^'"\\\r\n]+)\1\s*\)/.exec(argument);
    if (!literal) throw Error('Dynamic require in production dependency: ' + file);
    if (!isBuiltin(literal[2])) visit(resolver.resolve(literal[2]));
  }
}
const resolver = createRequire(path.join(root, 'package.json'));
for (const name of Object.keys(pkg.dependencies || {}).sort()) {
  if (fs.lstatSync(path.join(modules, name)).isSymbolicLink()) throw Error('Symlink is not a releasable dependency: ' + name);
  visit(resolver.resolve(name));
}
process.stdout.write(JSON.stringify([...files].sort()));
