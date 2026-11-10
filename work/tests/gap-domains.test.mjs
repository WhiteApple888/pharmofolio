import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const framework = source.slice(source.indexOf('const framework ='), source.indexOf('const gradeProfiles ='));
const escaping = source.slice(source.indexOf('function escapeHtml('), source.indexOf('function toast('));
const rendering = source.slice(source.indexOf('function renderPlan()'), source.indexOf('function renderReadOnlyDevelopmentResponse('));

function render(result, open = []) {
  const elements = new Map();
  const gapList = { innerHTML: '', querySelectorAll: () => open.map(id => ({ dataset: { gapDomain: id } })) };
  elements.set('#gap-list', gapList);
  const context = {
    activeResult: () => result,
    mapResult: () => [],
    emptyState: title => `EMPTY: ${title}`,
    $: selector => {
      if (!elements.has(selector)) elements.set(selector, { innerHTML: '', textContent: '' });
      return elements.get(selector);
    },
  };
  vm.runInNewContext(`${framework}\n${escaping}\n${rendering}\nrenderPlan();`, context);
  return { html: gapList.innerHTML, count: elements.get('#gap-tab-count').textContent };
}

test('groups gaps by all six framework domains, retaining open sections and unrecognised gaps', () => {
  const gap = (standard_id, description) => ({ standard_id, gap: description, priority: 'high', evidence_needed: 'Example evidence' });
  const { html, count } = render({ gaps: [gap('2.1', 'Communication'), gap('1.4', 'Autonomy'), gap('8.1', '<unknown>')], activities: [] }, ['1', '2']);
  assert.equal(count, 3);
  assert.equal((html.match(/class="gap-domain"/g) || []).length, 7);
  assert.match(html, /data-gap-domain="1" open/);
  assert.match(html, /data-gap-domain="2" open/);
  assert.match(html, /data-gap-domain="1"[\s\S]*?1\.4[\s\S]*?data-gap-domain="2"[\s\S]*?2\.1/);
  assert.match(html, /data-gap-domain="other"[\s\S]*?&lt;unknown&gt;/);
  assert.match(html, /No gaps identified in this domain/);
  assert.match(html, /data-coach-gap="Communication"/);
});

test('keeps the initial no-analysis prompt', () => {
  assert.match(render(null).html, /No competency gaps yet/);
});
