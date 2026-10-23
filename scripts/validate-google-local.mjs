import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { startAuthFixture } from '../tests/oauth/auth-fixture.mjs';

// Explicit allowlist: no .env files, .git, previous build or real credentials are read.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), 'roomiehub-oauth-'));
const environment = Object.fromEntries(
  ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot'].flatMap((key) =>
    process.env[key] ? [[key, process.env[key]]] : [],
  ),
);
const sentinel = `test-only-private-${randomUUID()}`;
Object.assign(environment, {
  NEXT_TELEMETRY_DISABLED: '1',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54331',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-public-key-not-a-backend',
  NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3200',
  NEXT_PUBLIC_GOOGLE_AUTH_ENABLED: 'true',
  AUTH_TEST_SENTINEL: sentinel,
});
for (const key of [
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GOOGLE_CLIENT_SECRET',
  'RESEND_API_KEY',
  'VAPID_PRIVATE_KEY',
  'ROOMIEHUB_JOB_SECRET',
])
  environment[key] = sentinel;

let app;
let fixture;
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: directory, env: environment, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} failed (${code})`)),
    );
  });
}
try {
  for (const path of [
    'src',
    'public',
    'supabase',
    'tests',
    'scripts',
    'docs',
    'AGENTS.md',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'next.config.ts',
    'next-env.d.ts',
    'tsconfig.json',
    'eslint.config.mjs',
    'postcss.config.mjs',
    '.prettierrc.json',
    '.prettierignore',
    'playwright.config.ts',
    'playwright.oauth.config.ts',
  ])
    await cp(join(root, path), join(directory, path), { recursive: true });
  // Independent paths keep Turbopack resolution within the isolated project root.
  await cp(join(root, 'node_modules'), join(directory, 'node_modules'), {
    recursive: true,
    verbatimSymlinks: true,
    mode: constants.COPYFILE_FICLONE,
  });
  // pnpm's generated launchers contain absolute NODE_PATH entries. Rebase only
  // the copied launchers so dev cannot load a second Next runtime from the repo.
  for (const entry of await readdir(join(directory, 'node_modules/.bin'), {
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const path = join(directory, 'node_modules/.bin', entry.name);
    const script = await readFile(path, 'utf8');
    if (script.includes(root)) await writeFile(path, script.replaceAll(root, directory));
  }
  console.log('Isolated source copy: no environment files loaded; test credentials only.');
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  await run(pnpm, ['lint']);
  await run(pnpm, ['test']);
  await run(pnpm, ['build']);
  await run(pnpm, ['typecheck']);

  fixture = await startAuthFixture();
  app = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3200'],
    {
      cwd: directory,
      env: environment,
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Isolated app startup timed out')), 15000);
    app.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    app.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Isolated app exited (${code})`));
    });
    app.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      if (chunk.toString().includes('Ready in')) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  await run(pnpm, ['exec', 'playwright', 'test', '--config', 'playwright.oauth.config.ts']);
  app.kill('SIGTERM');
  await new Promise((resolve) => app.once('exit', resolve));
  app = undefined;
  await fixture.close();
  fixture = undefined;
  // Keep Next's dev runtime and production runtime out of the same build tree.
  await rm(join(directory, '.next'), { recursive: true, force: true });
  // Existing public/offline regressions also check the opt-out flag in a separate dev process.
  await run(pnpm, ['test:e2e']);
  console.log('Local OAuth review passed. Real Google consent and Supabase remain unverified.');
} finally {
  if (app && app.exitCode === null) {
    app.kill('SIGTERM');
    await new Promise((resolve) => app.once('exit', resolve));
  }
  await fixture?.close();
  await rm(directory, { recursive: true, force: true });
}
