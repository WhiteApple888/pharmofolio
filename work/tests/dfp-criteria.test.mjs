import test from 'node:test';
import assert from 'node:assert/strict';
import { DFP_CRITERIA } from '../worker/dfp-criteria.js';

const get = (id, level) => DFP_CRITERIA.find(item => item.standard_id === id)?.levels.find(item => item.levels.includes(level));

test('all six domains have each level explicitly grouped with its own criteria and evidence', () => {
  assert.equal(DFP_CRITERIA.length, 23);
  assert.equal(new Set(DFP_CRITERIA.map(item => item.standard_id)).size, 23);
  for (const standard of DFP_CRITERIA) {
    assert.match(standard.standard_id, /^[1-6]\./);
    for (const level of ['Foundation','Intermediate','Advanced','Expert']) {
      const groups = standard.levels.filter(item => item.levels.includes(level));
      assert.equal(groups.length, 1, `${standard.standard_id} ${level}`);
      assert.ok(groups[0].performance_criteria.trim());
      assert.ok(groups[0].evidence.trim());
    }
  }
});

test('source-specific boundaries and shared levels remain correctly associated', () => {
  assert.match(get('1.1','Foundation').evidence, /low to medium complexity/);
  assert.match(get('1.1','Intermediate').evidence, /medium to high complexity/);
  assert.doesNotMatch(get('1.1','Intermediate').evidence, /source of expertise/);
  assert.match(get('1.1','Advanced').evidence, /source of expertise/);
  assert.deepEqual(get('4.1','Foundation').levels, ['Foundation','Intermediate']);
  assert.deepEqual(get('4.5','Intermediate').levels, ['Foundation','Intermediate']);
  assert.match(get('5.2','Expert').evidence, /design and manage a course/);
  assert.match(get('6.3','Expert').performance_criteria, /Anchor authorship/);
  assert.equal(get('6.4','Foundation').evidence_examples, '');
});
