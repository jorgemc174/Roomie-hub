// Local administrative tool only. Never import into the application.
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

try {
  process.loadEnvFile('.env.local');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    'Falta SUPABASE_SECRET_KEY (o SUPABASE_SERVICE_ROLE_KEY) en .env.local. Nunca uses el prefijo NEXT_PUBLIC_ para esta clave. No se ha creado ninguna cuenta.',
  );
  process.exit(1);
}

const email = process.argv[2] || 'roomiehub-test@example.com';
const password = `Aa1!${randomBytes(18).toString('base64url')}`;
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await db.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { name: 'Roomie de prueba' },
});
if (error) {
  console.error(
    `No se ha podido crear la cuenta (${error.code || error.status || 'error'}). No se modifica ninguna cuenta existente.`,
  );
  process.exit(1);
}

// The normal database trigger creates the profile; do not bypass a broken migration.
const { data: login, error: loginError } = await db.auth.signInWithPassword({ email, password });
const filename = `test-account-${data.user.id}.credentials.txt`;
await writeFile(
  filename,
  `Email: ${email}\nContraseña: ${password}\nURL: ${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/login\n`,
  { flag: 'wx', mode: 0o600 },
);
if (loginError || !login.session) {
  console.error(
    `Cuenta creada, pero no se ha podido verificar el login. Credenciales guardadas en ${filename}.`,
  );
  process.exit(1);
}
const scoped = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  global: { headers: { Authorization: `Bearer ${login.session.access_token}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: profile, error: profileError } = await scoped
  .from('profiles')
  .select('id')
  .eq('id', data.user.id)
  .single();
if (profileError || !profile) {
  console.error(
    `Cuenta creada y login válido, pero falta acceso al perfil. Revisa las migraciones. Credenciales en ${filename}.`,
  );
  process.exit(1);
}
await db.auth.signOut({ scope: 'local' });
console.log(
  `Cuenta real creada; login y perfil verificados. Credenciales guardadas en ${filename}. No se ha enviado correo.`,
);
