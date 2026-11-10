import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(root, 'dist');
const server = resolve(dist, 'server');

await mkdir(server, { recursive: true });
await rm(resolve(dist, 'pharmacist_profile.csv'), { force: true });
await import('./generate-seed-data.mjs');
await import('./embed-assets.mjs');

for (const file of ['index.html', 'app.js', 'styles.css']) {
  await cp(resolve(root, file), resolve(dist, file));
}
await cp(resolve(root, 'runtime-config.example.js'), resolve(dist, 'runtime-config.js'));
await cp(resolve(root, 'worker/assets.js'), resolve(server, 'assets.js'));
await cp(resolve(root, 'worker/index.js'), resolve(server, 'index.js'));
await cp(resolve(root, 'worker/openai-client.js'), resolve(server, 'openai-client.js'));
await cp(resolve(root, 'worker/dfp-criteria.js'), resolve(server, 'dfp-criteria.js'));
await cp(resolve(root, 'worker/hosted-backend.js'), resolve(server, 'hosted-backend.js'));
await cp(resolve(root, 'worker/seed-data.js'), resolve(server, 'seed-data.js'));
await cp(resolve(root, '.openai/hosting.json'), resolve(dist, '.openai/hosting.json'));
await cp(resolve(root, 'drizzle'), resolve(dist, '.openai/drizzle'), { recursive: true });
