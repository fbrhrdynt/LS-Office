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
assert.ok(VIDEO_WORKFLOW.find(step => step.key === 'render_video'));
assert.ok(VIDEO_WORKFLOW.find(step => step.key === 'qa_video'));
assert.ok(!VIDEO_WORKFLOW.some(step => step.employeeId === 'nadia' && /render|video production/i.test(step.title)));
console.log('Role-based video workflow tests passed');
