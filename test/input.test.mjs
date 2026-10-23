// node test/input.test.mjs
import assert from 'node:assert/strict';
import { nextLever } from '../src/input.js';

// lever: a drifting or centred stick keeps the last throttle
assert.equal(nextLever(0.8, 0.5, false, false), 0.8);
// lever: a stick off the dead zone takes the new value
assert.equal(nextLever(0.8, 0.3, true, false), 0.3);
// spring: always follows the stick, centred means idle
assert.equal(nextLever(0.8, 0, false, true), 0);

console.log('all input checks passed');
