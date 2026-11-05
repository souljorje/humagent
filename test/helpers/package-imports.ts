import assert from 'node:assert/strict';
import { createRuntime } from 'humagent';
import { PROTOCOL } from 'humagent/protocol';

assert.equal(typeof createRuntime, 'function');
assert.equal(PROTOCOL, 2);
