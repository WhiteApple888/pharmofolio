import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const framework = source.slice(source.indexOf('const framework ='), source.indexOf('const gradeProfiles ='));
const escaping = source.slice(source.indexOf('function escapeHtml('), source.indexOf('function toast('));
const grouping = source.slice(source.indexOf('function sourceLabel('), source.indexOf('function renderFindings('));

test('assessment items group in framework order without dropping unknown or repeated standards', () => {
  const context = {};
  vm.runInNewContext(`${framework}\n${escaping}\n${grouping}\nthis.html = renderAssessmentDomains([{id:'4.1', label:'Management A'}, {id:'2.1', label:'Communication'}, {id:'4.1', label:'Management B'}, {id:'8.1', label:'<Other>'}], item => item.id, item => '<article>' + escapeHtml(item.label) + '</article>'); this.label = sourceLabel('reportee_submitted');`, context);
  assert.equal((context.html.match(/class="assessment-domain"/g) || []).length, 7);
  assert.match(context.html, /Building Working Relationships[\s\S]*Communication[\s\S]*Management[\s\S]*Management A[\s\S]*Management B/);
  assert.match(context.html, /Other items[\s\S]*&lt;Other&gt;/);
  assert.match(context.html, /No items in this domain/);
  assert.equal(context.label, 'Reviewed by Reportee');
});
