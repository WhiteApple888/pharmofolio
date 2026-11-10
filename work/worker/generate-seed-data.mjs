import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, pbkdf2Sync } from 'node:crypto';

// Cloudflare Workers supports PBKDF2 iteration counts up to 100,000.
const PASSWORD_PBKDF2_ITERATIONS = 100000;

const root = fileURLToPath(new URL('..', import.meta.url));
const csv = await readFile(new URL('../pharmacist_profile.csv', import.meta.url), 'utf8');

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(field); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some(value => value.length)) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift().map(value => value.replace(/^\uFEFF/, '').trim());
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

const yes = value => ['yes', 'true', '1'].includes(String(value || '').trim().toLowerCase());
const rows = parseCsv(csv);
const people = new Map(rows.map((row, index) => [row['Pharmacist Name'].trim().toLowerCase(), index + 1]));
const managedNames = new Set(rows.map(row => row.RO.trim().toLowerCase()).filter(name => name && !['none', 'n/a', 'na', '-'].includes(name)));
const profiles = rows.map((row, index) => {
  const name = row['Pharmacist Name'].trim();
  const reportingOfficer = row.RO.trim();
  const rawYears = String(row['Years in Job Grade'] || row['Years in current job grade'] || '').trim();
  const divisionView = yes(row.division_view);
  const teamView = managedNames.has(name.toLowerCase()) || yes(row.team_view);
  const username = [...name.toLowerCase()].filter(character => /[a-z0-9]/.test(character)).join('');
  const passwordSalt = createHash('sha256').update(`pharmpath-demo:${username}`).digest().subarray(0, 16);
  const passwordHash = pbkdf2Sync(`PharmPath-${name.replace(/\b\w/g, character => character.toUpperCase())}!`, passwordSalt, PASSWORD_PBKDF2_ITERATIONS, 32, 'sha256');
  return {
    personId: index + 1,
    sourceRow: index + 2,
    name,
    username,
    grade: row['Pharmacist Job Grade'].trim(),
    track: row['Career Track'].trim(),
    section: row.Section.trim(),
    reportingOfficer: reportingOfficer && !['none', 'n/a', 'na', '-'].includes(reportingOfficer.toLowerCase()) ? reportingOfficer : null,
    supervisorPersonId: people.get(reportingOfficer.toLowerCase()) || null,
    yearsInJobGrade: rawYears && Number.isFinite(Number(rawYears)) ? Number(rawYears) : null,
    teamView,
    divisionView,
    role: divisionView ? 'division_lead' : teamView ? 'team_lead' : 'pharmacist',
    passwordSalt: passwordSalt.toString('base64'),
    passwordHash: passwordHash.toString('base64'),
  };
});

const output = `// Generated from pharmacist_profile.csv by worker/generate-seed-data.mjs.\nexport const SEED_PROFILES = ${JSON.stringify(profiles, null, 2)};\n`;
await writeFile(resolve(root, 'worker', 'seed-data.js'), output, 'utf8');
