import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const framework = source.slice(source.indexOf('const framework ='), source.indexOf('const gradeProfiles ='));
const escaping = source.slice(source.indexOf('function escapeHtml('), source.indexOf('function confirmAction('));
const charts = source.slice(source.indexOf('function confidenceScore('), source.indexOf('function confidenceOptions('));

test('overview shows only present levels and counts missing evidence in the denominator', () => {
  const elements = { '#domain-chart': { classList: { toggle() {} }, innerHTML: '' } };
  const context = { $: selector => elements[selector] };
  vm.runInNewContext(`${framework}\n${escaping}\nlet selectedDomain = 'overview';\n${charts}\nrenderDomainChart([{standardId:'6.1', confidenceScore:.5}, {standardId:'6.2', confidenceScore:.75}, {standardId:'6.2', confidenceScore:1}]);`, context);
  const html = elements['#domain-chart'].innerHTML;
  const domain6 = html.slice(html.lastIndexOf('<button'));
  assert.match(domain6, /Intermediate<\/span><b>20%/);
  assert.match(domain6, /Expert<\/span><b>20%/);
  assert.doesNotMatch(domain6, /Foundation<\/span>|Advanced<\/span>/);
  assert.match(html, /No rated evidence yet/);
  assert.equal((html.match(/class="distribution-card"/g) || []).length, 6);
});

test('each domain opens its bar chart and offers a return to the overview', () => {
  const chart = { classList: { toggle() {} }, innerHTML: '' };
  const context = { $: () => chart };
  vm.runInNewContext(`${framework}\n${escaping}\nfunction ratingLabel(score) { return ['No Evidence', 'Foundation', 'Intermediate', 'Advanced', 'Expert'][Math.round(score * 4)]; }\nlet selectedDomain = 'overview';\n${charts}\nthis.select = id => { selectedDomain = id; renderDomainChart([]); };`, context);
  for (let id = 1; id <= 6; id++) {
    context.select(String(id));
    assert.match(chart.innerHTML, /data-domain-back/);
    assert.match(chart.innerHTML, new RegExp(`${id} · `));
    assert.match(chart.innerHTML, /class="bar-chart"/);
  }
  context.select('overview');
  assert.equal((chart.innerHTML.match(/data-domain="[1-6]"/g) || []).length, 6);
});
