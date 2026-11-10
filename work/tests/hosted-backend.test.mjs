import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { handleHostedRequest } from '../worker/hosted-backend.js';

class MockStatement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new MockStatement(this.database, this.sql, values); }
  first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  run() { return this.database.prepare(this.sql).run(...this.values); }
}

class MockD1 {
  constructor(database) { this.database = database; }
  prepare(sql) { return new MockStatement(this.database, sql); }
  async batch(statements) {
    this.database.exec('BEGIN');
    try {
      const results = statements.map(statement => statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (problem) {
      this.database.exec('ROLLBACK');
      throw problem;
    }
  }
}

async function environment() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const name of ['0000_blue_jean_grey.sql', '0001_stiff_klaw.sql', '0002_development_plan_responses.sql']) {
    const migration = await readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8');
    for (const statement of migration.split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean)) sqlite.exec(statement);
  }
  const objects = new Map();
  return { DB: new MockD1(sqlite), FILES: { put: async (key, value) => objects.set(key, value), get: async key => objects.has(key) ? { body: objects.get(key) } : null, delete: async key => objects.delete(key) } };
}

const dependencies = {
  mapEvidence: async () => ({ model: 'test', result: { activities: [], mappings: [], gaps: [], coaching: [] } }),
  embeddedAsset: () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
};

async function call(env, path, options = {}) {
  const request = new Request(`https://example.test${path}`, options);
  return handleHostedRequest(request, env, new URL(request.url), dependencies);
}

async function login(env, username) {
  const response = await call(env, '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: `PharmPath-${username[0].toUpperCase()}${username.slice(1)}!` }) });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';', 1)[0];
}

test('Sites-native authentication seeds Sarah from CSV and scopes team access', async () => {
  const env = await environment();
  const cookie = await login(env, 'sarah');
  const headers = { cookie };
  const me = await (await call(env, '/api/auth/me', { headers })).json();
  assert.equal(me.user.name, 'Sarah');
  assert.deepEqual(me.user.capabilities, { team_dashboard: true, reportee_assessment: true, division_dashboard: false });
  const team = await (await call(env, '/api/team-dashboard', { headers })).json();
  assert.deepEqual(team.profiles.map(row => row.name), ['Alex', 'Ben', 'Jane']);
  assert.equal((await call(env, '/api/division-dashboard', { headers })).status, 403);
  assert.equal((await call(env, '/api/reportee-assessments/user-benedict', { headers })).status, 403);
});

test('division_view sees the complete division while team data remains direct-only', async () => {
  const env = await environment();
  const cookie = await login(env, 'tommy');
  const headers = { cookie };
  const division = await (await call(env, '/api/division-dashboard', { headers })).json();
  assert.equal(division.profiles.length, 11);
  assert.ok(division.profiles.some(row => row.name === 'Sarah'));
  const team = await (await call(env, '/api/team-dashboard', { headers })).json();
  assert.deepEqual(team.profiles.map(row => row.name), ['Alice', 'Betty', 'Jack', 'Jamie', 'Sarah']);
  const health = await (await call(env, '/health')).json();
  assert.equal(health.backend, 'sites-d1');
});

test('evidence deletion is restricted to the uploading reportee and removes the stored object', async () => {
  const env = await environment();
  const alexCookie = await login(env, 'alex');
  const writeHeaders = { cookie: alexCookie, 'x-requested-with': 'PharmPath', 'content-type': 'application/json' };
  const created = await call(env, '/api/uploads', { method: 'POST', headers: writeHeaders, body: JSON.stringify({ context: 'evidence', name: 'reflection.txt', dataUrl: 'data:text/plain;base64,aGVsbG8=' }) });
  assert.equal(created.status, 200);
  const item = (await created.json()).item;
  assert.equal(item.can_delete, true);

  const sarahCookie = await login(env, 'sarah');
  const forbidden = await call(env, `/api/evidence/${item.id}`, { method: 'DELETE', headers: { cookie: sarahCookie, 'x-requested-with': 'PharmPath' } });
  assert.equal(forbidden.status, 404);

  const deleted = await call(env, `/api/evidence/${item.id}`, { method: 'DELETE', headers: { cookie: alexCookie, 'x-requested-with': 'PharmPath' } });
  assert.equal(deleted.status, 200);
  const remaining = await (await call(env, '/api/uploads?context=evidence', { headers: { cookie: alexCookie } })).json();
  assert.deepEqual(remaining.items, []);
});

test('reportee evidence metadata is visible to direct ROs and division viewers only', async () => {
  const env = await environment();
  const alexCookie = await login(env, 'alex');
  const writeHeaders = { cookie: alexCookie, 'x-requested-with': 'PharmPath', 'content-type': 'application/json' };
  const uploaded = await call(env, '/api/uploads', { method: 'POST', headers: writeHeaders, body: JSON.stringify({ context: 'evidence', name: 'reflection.txt', dataUrl: 'data:text/plain;base64,aGVsbG8=' }) });
  const item = (await uploaded.json()).item;

  const sarahCookie = await login(env, 'sarah');
  const direct = await call(env, '/api/reportees/user-alex/evidence', { headers: { cookie: sarahCookie } });
  assert.equal(direct.status, 200);
  const directPayload = await direct.json();
  assert.equal(directPayload.items.length, 1);
  assert.equal('can_delete' in directPayload.items[0], false);
  const directDownload = await call(env, `/api/reportees/user-alex/evidence/${item.id}/download`, { headers: { cookie: sarahCookie } });
  assert.equal(directDownload.status, 200);
  assert.equal(new TextDecoder().decode(await directDownload.arrayBuffer()), 'hello');

  const tommyCookie = await login(env, 'tommy');
  assert.equal((await call(env, '/api/reportees/user-alex/evidence', { headers: { cookie: tommyCookie } })).status, 200);
  assert.equal((await call(env, `/api/reportees/user-alex/evidence/${item.id}/download`, { headers: { cookie: tommyCookie } })).status, 200);
  assert.equal((await call(env, '/api/reportees/user-alex/evidence', { headers: { cookie: alexCookie } })).status, 403);
  assert.equal((await call(env, `/api/reportees/user-alex/evidence/${item.id}/download`, { headers: { cookie: alexCookie } })).status, 403);
});

test('division_view can open every Individual record but cannot edit a non-direct reportee', async () => {
  const env = await environment();
  const cookie = await login(env, 'tommy');
  const headers = { cookie };
  const reportees = await (await call(env, '/api/reportees', { headers })).json();
  assert.equal(reportees.reportees.length, 11);
  const assessment = await call(env, '/api/reportee-assessments/user-benedict', { headers });
  assert.equal(assessment.status, 200);
  const record = await (await call(env, '/api/reportees/user-benedict/coaching-development', { headers })).json();
  assert.equal(record.can_edit, false);
});

test('only a direct reporting officer can save a development-plan response and the reportee can read it', async () => {
  const env = await environment();
  const sarahCookie = await login(env, 'sarah');
  const sarahHeaders = { cookie: sarahCookie, 'x-requested-with': 'PharmPath', 'content-type': 'application/json' };
  const saved = await call(env, '/api/reportees/user-alex/development-plan-response', { method: 'PUT', headers: sarahHeaders, body: JSON.stringify({ action_items: [{ action_item: 'Lead the workshop', target_date: '15 Oct 2026', support_needed: 'Mentoring' }], discussion_notes: 'Discussed scope and support.' }) });
  assert.equal(saved.status, 200);
  const alexCookie = await login(env, 'alex');
  const own = await (await call(env, '/api/development-plan-response', { headers: { cookie: alexCookie } })).json();
  assert.equal(own.response.action_items[0].action_item, 'Lead the workshop');
  assert.equal(own.response.discussion_notes, 'Discussed scope and support.');
  const forbidden = await call(env, '/api/reportees/user-alex/development-plan-response', { method: 'PUT', headers: { cookie: alexCookie, 'x-requested-with': 'PharmPath', 'content-type': 'application/json' }, body: JSON.stringify({ action_items: [], discussion_notes: 'Attempted edit' }) });
  assert.equal(forbidden.status, 403);
});

test('the RO coaching-development record is direct-report-only and includes the submitted response', async () => {
  const env = await environment();
  const sarahCookie = await login(env, 'sarah');
  const headers = { cookie: sarahCookie, 'x-requested-with': 'PharmPath', 'content-type': 'application/json' };
  await call(env, '/api/reportees/user-alex/development-plan-response', { method: 'PUT', headers, body: JSON.stringify({ action_items: [{ action_item: 'Complete a peer review', target_date: 'Oct 2026', support_needed: 'Protected time' }], discussion_notes: 'Agreed at monthly check-in.' }) });
  const record = await (await call(env, '/api/reportees/user-alex/coaching-development', { headers: { cookie: sarahCookie } })).json();
  assert.equal(record.response.discussion_notes, 'Agreed at monthly check-in.');
  assert.equal(record.response.action_items[0].action_item, 'Complete a peer review');
  const alexCookie = await login(env, 'alex');
  assert.equal((await call(env, '/api/reportees/user-alex/coaching-development', { headers: { cookie: alexCookie } })).status, 403);
});

test('chat sends the current selected gaps as context without adding them to saved messages', async () => {
  const env = await environment();
  env.OPENAI_API_KEY = 'test';
  const cookie = await login(env, 'alex');
  const headers = { cookie, 'x-requested-with': 'PharmPath', 'content-type': 'application/json' };
  const conversation = (await (await call(env, '/api/coaching/conversations', { method: 'POST', headers, body: '{}' })).json()).conversation;
  const originalFetch = globalThis.fetch;
  const prompts = [];
  globalThis.fetch = async (_url, options) => {
    prompts.push(JSON.parse(options.body).input);
    return Response.json({ output: [{ content: [{ type: 'output_text', text: 'What would you like to try?' }] }] });
  };
  try {
    const send = (content, selected_gaps) => call(env, `/api/coaching/conversations/${conversation.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content, selected_gaps }) });
    assert.equal((await send('Help me plan', ['Improve leadership'])).status, 200);
    assert.match(prompts[0], /Selected focus areas: \["Improve leadership"\]/);
    assert.equal((await send('What next?', [])).status, 200);
    assert.match(prompts[1], /Selected focus areas: \[\]/);
    const allGaps = Array.from({ length: 40 }, (_, index) => `Gap ${index + 1}`);
    assert.equal((await send('Consider all gaps', allGaps)).status, 200);
    assert.match(prompts[2], /Gap 40/);
    const summary = await (await call(env, `/api/coaching/conversations/${conversation.id}/summary`, { method: 'POST', headers, body: JSON.stringify({ selected_gaps: allGaps }) })).json();
    assert.deepEqual(summary.summary.metadata.selected_gaps, allGaps);
    const saved = await (await call(env, `/api/coaching/conversations/${conversation.id}`, { headers })).json();
    assert.deepEqual(saved.messages.filter(message => message.role === 'user').map(message => message.content).sort(), ['Consider all gaps', 'Help me plan', 'What next?']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reset removes only the signed-in user’s generated workspace data and retains evidence', async () => {
  const env = await environment();
  const alex = await login(env, 'alex');
  const ben = await login(env, 'ben');
  const headers = cookie => ({ cookie, 'x-requested-with': 'PharmPath', 'content-type': 'application/json' });
  for (const cookie of [alex, ben]) {
    await call(env, '/api/map', { method: 'POST', headers: headers(cookie), body: '{}' });
    await call(env, '/api/coaching/conversations', { method: 'POST', headers: headers(cookie), body: '{}' });
    await call(env, '/api/saved-content', { method: 'POST', headers: headers(cookie), body: JSON.stringify({ context: 'development_plan', body: 'plan' }) });
  }
  await call(env, '/api/uploads', { method: 'POST', headers: headers(alex), body: JSON.stringify({ context: 'evidence', name: 'reflection.txt', dataUrl: 'data:text/plain;base64,aGVsbG8=' }) });
  assert.equal((await call(env, '/api/workspace/reset', { method: 'POST', headers: headers(alex) })).status, 200);
  assert.equal((await (await call(env, '/api/assessment', { headers: { cookie: alex } })).json()).assessment, null);
  assert.deepEqual((await (await call(env, '/api/coaching/conversations', { headers: { cookie: alex } })).json()).conversations, []);
  assert.deepEqual((await (await call(env, '/api/saved-content?context=development_plan', { headers: { cookie: alex } })).json()).items, []);
  assert.equal((await (await call(env, '/api/uploads?context=evidence', { headers: { cookie: alex } })).json()).items.length, 1);
  assert.ok((await (await call(env, '/api/assessment', { headers: { cookie: ben } })).json()).assessment);
  assert.equal((await (await call(env, '/api/coaching/conversations', { headers: { cookie: ben } })).json()).conversations.length, 1);
});

test('legacy confidence is not treated as a competency rating', async () => {
  const env = await environment();
  const cookie = await login(env, 'alex');
  const db = env.DB.database;
  const result = { mappings: [{ standard_id: '3.3', confidence: 'high', rationale: 'Strong evidence' }, { standard_id: '2.1', confidence_score: .7, rationale: 'Evidence' }] };
  db.prepare('INSERT INTO assessment_records (id,user_id,workflow_id,ai_result_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('a','user-alex','w',JSON.stringify(result),'draft',1,1);
  for (const [index, mapping] of result.mappings.entries()) db.prepare('INSERT INTO assessment_items (id,assessment_id,item_key,standard_id) VALUES (?,?,?,?)').run(`i${index}`,'a',`${mapping.standard_id}:${index}`,mapping.standard_id);
  const payload = await (await call(env, '/api/assessment', { headers: { cookie } })).json();
  assert.deepEqual(payload.assessment.items.map(item => item.ai.confidence_score), [0,0]);
});

test('conversation and saved summary deletion is owner-scoped and independent', async () => {
  const env = await environment();
  const alex = await login(env, 'alex');
  const ben = await login(env, 'ben');
  const headers = cookie => ({ cookie, 'x-requested-with': 'PharmPath', 'content-type': 'application/json' });
  const conversation = (await (await call(env, '/api/coaching/conversations', { method: 'POST', headers: headers(alex), body: '{}' })).json()).conversation;
  const db = env.DB.database;
  db.prepare('INSERT INTO coaching_messages (id,conversation_id,author_role,message_type,content,generated,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)').run('msg',conversation.id,'user','chat','hello',0,'{}',1);
  db.prepare('INSERT INTO saved_content (id,user_id,context,content_type,title,body,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)').run('summary','user-alex','coaching','coaching_summary','Summary','{}','{}',1);
  assert.equal((await call(env, `/api/coaching/conversations/${conversation.id}`, { method: 'DELETE', headers: headers(ben) })).status, 404);
  assert.equal((await call(env, '/api/coaching/summaries/summary', { method: 'DELETE', headers: headers(ben) })).status, 404);
  assert.equal((await call(env, `/api/coaching/conversations/${conversation.id}`, { method: 'DELETE', headers: headers(alex) })).status, 200);
  assert.equal(db.prepare('SELECT count(*) AS n FROM coaching_messages WHERE conversation_id=?').get(conversation.id).n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM saved_content WHERE id=?').get('summary').n, 1);
  assert.equal((await call(env, '/api/coaching/summaries/summary', { method: 'DELETE', headers: headers(alex) })).status, 200);
  assert.equal((await call(env, '/api/coaching/summaries/summary', { method: 'DELETE', headers: headers(alex) })).status, 404);
});

test('officer review submission is independent and reversing it preserves the reportee submission', async () => {
  const env = await environment();
  const alex = await login(env, 'alex');
  const sarah = await login(env, 'sarah');
  const tommy = await login(env, 'tommy');
  const headers = cookie => ({ cookie, 'x-requested-with': 'PharmPath', 'content-type': 'application/json' });
  const post = (cookie, path) => call(env, path, { method: 'POST', headers: headers(cookie), body: '{}' });
  const put = (cookie, path, data) => call(env, path, { method: 'PUT', headers: headers(cookie), body: JSON.stringify(data) });
  const now = Math.floor(Date.now() / 1000);
  const result = JSON.stringify({ mappings: [{ standard_id: '4.1', standard_name: 'Management', activity_title: 'Review', rationale: 'Evidence', confidence_score: 1 }] });
  env.DB.prepare('INSERT INTO assessment_records (id,user_id,workflow_id,ai_result_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind('assess-test','user-alex','workflow-test',result,'draft',now,now).run();
  env.DB.prepare('INSERT INTO assessment_items (id,assessment_id,item_key,standard_id) VALUES (?,?,?,?)').bind('item-test','assess-test','4.1:0','4.1').run();
  const ownPath = '/api/assessment/items/item-test';
  const roPath = '/api/reportee-assessments/user-alex/items/item-test';
  assert.equal((await put(alex, ownPath, { rating_score: 1, justification: 'Initial' })).status, 200);
  assert.equal((await post(alex, '/api/assessment/submit')).status, 200);
  assert.equal((await put(alex, ownPath, { rating_score: .5, justification: 'Changed' })).status, 403);
  assert.equal((await put(sarah, roPath, { rating_score: .75, justification: 'Review' })).status, 200);
  let owner = (await (await call(env, '/api/assessment', { headers: { cookie: alex } })).json()).assessment;
  assert.equal(owner.items[0].reporting_officer.confidence_score, null);
  assert.equal(owner.items[0].effective.source, 'reportee_submitted');
  assert.equal((await post(sarah, '/api/reportee-assessments/user-alex/submit-review')).status, 200);
  owner = (await (await call(env, '/api/assessment', { headers: { cookie: alex } })).json()).assessment;
  assert.equal(owner.items[0].effective.source, 'reporting_officer_final');
  assert.equal((await put(sarah, roPath, { rating_score: .5, justification: 'Blocked' })).status, 409);
  assert.equal((await post(tommy, '/api/reportee-assessments/user-alex/reverse-submission')).status, 403);
  assert.equal((await post(sarah, '/api/reportee-assessments/user-alex/reverse-submission')).status, 200);
  owner = (await (await call(env, '/api/assessment', { headers: { cookie: alex } })).json()).assessment;
  assert.equal(owner.status, 'submitted');
  assert.equal(owner.items[0].reporting_officer.confidence_score, null);
  const officer = (await (await call(env, '/api/reportee-assessments/user-alex', { headers: { cookie: sarah } })).json()).assessment;
  assert.equal(officer.officer_status, 'draft');
  assert.equal(officer.items[0].reporting_officer.justification, 'Review');
  assert.equal((await put(sarah, roPath, { rating_score: .5, justification: 'Revised review' })).status, 200);
  assert.equal((await post(sarah, '/api/reportee-assessments/user-alex/submit-review')).status, 200);
  assert.equal((await post(alex, '/api/assessment/reverse-submission')).status, 200);
  const changed = await (await put(alex, ownPath, { rating_score: .5, justification: 'Changed' })).json();
  assert.equal(changed.assessment.items[0].reporting_officer.confidence_score, null);
  assert.equal((await post(alex, '/api/assessment/submit')).status, 200);
  const resubmitted = (await (await call(env, '/api/reportee-assessments/user-alex', { headers: { cookie: sarah } })).json()).assessment;
  assert.equal(resubmitted.officer_status, 'draft');
  assert.equal(resubmitted.items[0].reporting_officer.confidence_score, null);
  assert.equal((await post(alex, '/api/assessment/reverse-submission')).status, 200);
  assert.equal((await post(alex, '/api/assessment/reverse-submission')).status, 409);
});

test('previously published officer reviews remain visible and can be reversed safely', async () => {
  const env = await environment();
  const alex = await login(env, 'alex');
  const sarah = await login(env, 'sarah');
  const result = JSON.stringify({ mappings: [{ standard_id: '4.1', standard_name: 'Management', activity_title: 'Review', rationale: 'Evidence', confidence_score: 1 }] });
  env.DB.prepare('INSERT INTO assessment_records (id,user_id,workflow_id,ai_result_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind('legacy','user-alex','legacy-workflow',result,'submitted',1,1).run();
  env.DB.prepare('INSERT INTO assessment_items (id,assessment_id,item_key,standard_id,owner_confidence_score,owner_justification,officer_confidence_score,officer_justification,officer_saved_at) VALUES (?,?,?,?,?,?,?,?,?)').bind('legacy-item','legacy','4.1:0','4.1',1,'Owner',.75,'Published review',1).run();
  const read = async () => (await (await call(env, '/api/assessment', { headers: { cookie: alex } })).json()).assessment;
  assert.equal((await read()).items[0].reporting_officer.justification, 'Published review');
  assert.equal((await call(env, '/api/reportee-assessments/user-alex/reverse-submission', { method: 'POST', headers: { cookie: sarah, 'x-requested-with': 'PharmPath' } })).status, 200);
  const reversed = await read();
  assert.equal(reversed.status, 'submitted');
  assert.equal(reversed.items[0].reporting_officer.justification, null);
});

test('saved plan snapshot deletion is owner-scoped and does not remove other content', async () => {
  const env = await environment();
  const alex = await login(env, 'alex');
  const ben = await login(env, 'ben');
  const headers = cookie => ({ cookie, 'x-requested-with': 'PharmPath', 'content-type': 'application/json' });
  const create = async (cookie, context) => (await (await call(env, '/api/saved-content', { method: 'POST', headers: headers(cookie), body: JSON.stringify({ context, body: 'saved' }) })).json()).item;
  const plan = await create(alex, 'development_plan');
  const otherPlan = await create(ben, 'development_plan');
  const assessment = await create(alex, 'assessment');
  const db = env.DB.database;
  db.prepare('INSERT INTO saved_content (id,user_id,context,content_type,title,body,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)').run('summary-to-keep','user-alex','coaching','coaching_summary','Summary','{}','{}',1);
  assert.equal((await call(env, `/api/development-plan-snapshots/${plan.id}`, { method: 'DELETE', headers: headers(ben) })).status, 404);
  assert.equal((await call(env, `/api/development-plan-snapshots/${assessment.id}`, { method: 'DELETE', headers: headers(alex) })).status, 404);
  assert.equal((await call(env, `/api/development-plan-snapshots/${plan.id}`, { method: 'DELETE', headers: headers(alex) })).status, 200);
  assert.equal((await call(env, `/api/development-plan-snapshots/${plan.id}`, { method: 'DELETE', headers: headers(alex) })).status, 404);
  for (const id of [otherPlan.id, assessment.id, 'summary-to-keep']) assert.ok(db.prepare('SELECT id FROM saved_content WHERE id=?').get(id));
});

test('conversation and coaching summary names can be changed independently by their owner', async () => {
  const env = await environment();
  const alex = await login(env, 'alex');
  const ben = await login(env, 'ben');
  const headers = cookie => ({ cookie, 'x-requested-with': 'PharmPath', 'content-type': 'application/json' });
  const conversation = (await (await call(env, '/api/coaching/conversations', { method: 'POST', headers: headers(alex), body: JSON.stringify({ title: 'Original conversation' }) })).json()).conversation;
  const db = env.DB.database;
  db.prepare('INSERT INTO saved_content (id,user_id,context,content_type,title,body,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)').run('rename-summary','user-alex','coaching','coaching_summary','Original summary','{"summary":"Notes"}','{}',1);
  const patch = (cookie, path, title) => call(env, path, { method: 'PATCH', headers: headers(cookie), body: JSON.stringify({ title }) });
  const conversationPath = `/api/coaching/conversations/${conversation.id}`;
  const summaryPath = '/api/coaching/summaries/rename-summary';
  assert.equal((await patch(ben, conversationPath, 'No access')).status, 404);
  assert.equal((await patch(ben, summaryPath, 'No access')).status, 404);
  assert.equal((await patch(alex, conversationPath, '  ')).status, 422);
  assert.equal((await patch(alex, summaryPath, 'x'.repeat(201))).status, 422);
  assert.equal((await (await patch(alex, conversationPath, '  My conversation  ')).json()).conversation.title, 'My conversation');
  assert.equal((await (await patch(alex, summaryPath, 'My separate summary')).json()).item.title, 'My separate summary');
  assert.equal((await (await call(env, conversationPath, { headers: { cookie: alex } })).json()).conversation.title, 'My conversation');
  const summaries = (await (await call(env, '/api/saved-content?context=coaching', { headers: { cookie: alex } })).json()).items;
  assert.equal(summaries.find(item => item.id === 'rename-summary').title, 'My separate summary');
  assert.equal(summaries.find(item => item.id === 'rename-summary').body, '{"summary":"Notes"}');
});
