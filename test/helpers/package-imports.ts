import assert from 'node:assert/strict';
import { createRuntime } from 'humagent';
import { LIMITS } from 'humagent/feedback';

assert.equal(typeof createRuntime, 'function');
assert.equal(LIMITS.drafts, 100);
