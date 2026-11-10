import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = JSON.parse(await readFile(resolve(root, 'public-assets.json'), 'utf8'));
const entries = [];
const definitions = [];
const assets = new Map();
for (const { path: pathname, file, hostedFile, contentType, encoding } of files) {
  const filename = hostedFile || file;
  const key = JSON.stringify([filename, contentType, encoding]);
  let name = assets.get(key);
  if (!name) {
    const body = await readFile(resolve(root, filename), encoding === 'base64' ? undefined : 'utf8');
    const value = encoding === 'base64' ? body.toString('base64') : body;
    name = `asset${definitions.length}`;
    definitions.push(`const ${name} = { body: ${JSON.stringify(value)}, contentType: ${JSON.stringify(contentType)}${encoding ? `, encoding: ${JSON.stringify(encoding)}` : ''} };`);
    assets.set(key, name);
  }
  entries.push(`  ${JSON.stringify(pathname)}: ${name}`);
}
await writeFile(resolve(root, 'worker/assets.js'), `${definitions.join('\n')}\n\nexport const STATIC_ASSETS = {\n${entries.join(',\n')}\n};\n`);
