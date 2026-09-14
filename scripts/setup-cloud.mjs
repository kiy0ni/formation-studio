// Creates (or reuses) the free Supabase project behind accounts and sync, then writes src/lib/cloud.config.json.
//   npm run setup:cloud
//   npm run setup:cloud -- reset-password <email> <new password>
// Needs a personal access token in ~/.formation-studio/supabase-token (never committed).
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const secrets = join(homedir(), '.formation-studio');
const tokenFile = join(secrets, 'supabase-token');
const NAME = 'formation-studio';
const SITE = 'https://kiy0ni.github.io/formation-studio/';

if (!existsSync(tokenFile)) {
  console.error('✗ Token absent : créez-le sur https://supabase.com/dashboard/account/tokens puis enregistrez-le dans ~/.formation-studio/supabase-token');
  process.exit(1);
}
const token = readFileSync(tokenFile, 'utf8').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  const res = await fetch(`https://api.supabase.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function findOrCreateProject() {
  const projects = await api('GET', '/v1/projects');
  let project = projects.find((p) => p.name === NAME);
  if (!project) {
    const orgs = await api('GET', '/v1/organizations');
    if (!orgs.length) throw new Error('Aucune organisation Supabase : ouvrez supabase.com une fois pour la créer.');
    const passFile = join(secrets, 'supabase-db-password');
    const db_pass = existsSync(passFile) ? readFileSync(passFile, 'utf8').trim() : randomBytes(24).toString('base64url');
    writeFileSync(passFile, db_pass, { mode: 0o600 });
    console.log(`▶ Création du projet « ${NAME} » (Paris)…`);
    project = await api('POST', '/v1/projects', { name: NAME, organization_slug: orgs[0].slug ?? orgs[0].id, db_pass, region: 'eu-west-3' });
  }
  const ref = project.ref ?? project.id;
  for (let i = 0; ; i++) {
    const p = await api('GET', `/v1/projects/${ref}`);
    if (p.status === 'ACTIVE_HEALTHY') return ref;
    if (p.status === 'INACTIVE') throw new Error('Projet en pause : ouvrez supabase.com → projet formation-studio → « Restore project », puis relancez.');
    if (i % 6 === 0) console.log(`  … ${p.status}`);
    await sleep(5000);
  }
}

async function keys(ref, reveal = false) {
  return api('GET', `/v1/projects/${ref}/api-keys${reveal ? '?reveal=true' : ''}`);
}

async function setup() {
  const ref = await findOrCreateProject();
  console.log(`✓ Projet prêt (${ref})`);

  const sql = readFileSync(join(root, 'supabase/schema.sql'), 'utf8');
  for (let i = 0; ; i++) {
    try {
      await api('POST', `/v1/projects/${ref}/database/query`, { query: sql });
      break;
    } catch (e) {
      if (i >= 10) throw e;
      await sleep(6000);
    }
  }
  console.log('✓ Base de données et règles de sécurité');

  await api('PATCH', `/v1/projects/${ref}/config/auth`, {
    site_url: SITE,
    disable_signup: false,
    mailer_autoconfirm: true,
    password_min_length: 6,
    external_anonymous_users_enabled: false,
  });
  console.log('✓ Connexion e-mail + mot de passe, sans e-mail de confirmation');

  const list = await keys(ref);
  const pub = list.find((k) => k.type === 'publishable' && k.api_key) ?? list.find((k) => k.name === 'anon' && k.api_key);
  if (!pub) throw new Error('Clé publique introuvable');
  const url = `https://${ref}.supabase.co`;
  writeFileSync(join(root, 'src/lib/cloud.config.json'), `${JSON.stringify({ url, key: pub.api_key }, null, 2)}\n`);
  console.log('✓ src/lib/cloud.config.json (clé publique, sans danger)');
  console.log(`\nAnti-pause (serveur toujours allumé, une fois par jour) :\n0 9 * * * curl -fsS -X POST "${url}/rest/v1/rpc/keepalive" -H "apikey: ${pub.api_key}" -H "content-type: application/json" -d "{}" > /dev/null`);
}

async function resetPassword(email, password) {
  if (!email || !password || password.length < 6) throw new Error('Usage : npm run setup:cloud -- reset-password <email> <nouveau mot de passe (6+)>');
  const ref = await findOrCreateProject();
  const list = await keys(ref, true);
  const admin = list.find((k) => k.name === 'service_role') ?? list.find((k) => k.type === 'secret');
  const url = `https://${ref}.supabase.co`;
  const headers = { apikey: admin.api_key, 'content-type': 'application/json' };
  if (admin.name === 'service_role') headers.Authorization = `Bearer ${admin.api_key}`;
  const res = await fetch(`${url}/auth/v1/admin/users?per_page=1000`, { headers });
  const { users } = await res.json();
  const user = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`Aucun compte pour ${email}`);
  const put = await fetch(`${url}/auth/v1/admin/users/${user.id}`, { method: 'PUT', headers, body: JSON.stringify({ password }) });
  if (!put.ok) throw new Error(`Échec : ${put.status}`);
  console.log(`✓ Nouveau mot de passe enregistré pour ${email}`);
}

const [cmd, ...args] = process.argv.slice(2);
(cmd === 'reset-password' ? resetPassword(...args) : setup()).catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
