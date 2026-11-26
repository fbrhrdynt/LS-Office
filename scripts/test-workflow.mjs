import assert from 'node:assert/strict';
import { VIDEO_WORKFLOW } from '../server/workflows.mjs';

const expected = [
  ['research', 'nadia'],
  ['script', 'felix'],
  ['storyboard', 'ethan'],
  ['audio_direction', 'maya'],
  ['render_video', null],
  ['qa_video', 'daren'],
  ['distribution', 'olivier']
];

assert.deepEqual(VIDEO_WORKFLOW.map(({ key, employeeId }) => [key, employeeId]), expected);
assert.equal(new Set(VIDEO_WORKFLOW.map(step => step.key)).size, VIDEO_WORKFLOW.length);
assert.equal(VIDEO_WORKFLOW[0].requiresApproval, true, 'Nadia research must wait for Director approval');
assert.equal(VIDEO_WORKFLOW.at(-1).requiresApproval, true, 'Olivier distribution package must wait for final Director approval');
assert.equal(VIDEO_WORKFLOW.slice(1, -1).some(step => step.requiresApproval), false, 'Only the first and final handoffs require approval');
assert.ok(VIDEO_WORKFLOW.find(step => step.key === 'render_video'));
assert.ok(VIDEO_WORKFLOW.find(step => step.key === 'qa_video'));
assert.ok(!VIDEO_WORKFLOW.some(step => step.employeeId === 'nadia' && /render|video production/i.test(step.title)));
console.log('Role-based video workflow tests passed');
