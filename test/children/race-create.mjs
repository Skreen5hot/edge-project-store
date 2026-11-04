// Child process for M1-1: waits until `startAt` (ms since the epoch), then tries to create `count` files named
// race-<i>.txt with its own content, and prints which names it won as JSON.
//   node race-create.mjs <folder> <label> <count> <startAt> <mode>

import { nodeBackend } from '../../src/node-backend.mjs';

const [root, label, count, startAt, mode] = process.argv.slice(2);
const backend = nodeBackend(root, { mode });
while (Date.now() < Number(startAt)) { /* spin to line up with the other process */ }
const won = [];
for (let i = 0; i < Number(count); i++) {
  try {
    await backend.create(`race/race-${i}.txt`, new TextEncoder().encode(`${label} ${i}`));
    won.push(i);
  } catch (e) {
    if (e.code !== 'EXISTS') throw e;
  }
}
console.log(JSON.stringify(won));
