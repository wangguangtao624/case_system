import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTreeLoader } from '../src/lib/tree-loader';

function setup() {
  const requests: { url: string; signal?: AbortSignal | null; resolve: (response: Response) => void }[] = [];
  const trees: string[][] = [];
  const managers: boolean[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => new Promise(resolve => {
    requests.push({ url: String(input), signal: init?.signal, resolve });
  });
  const loader = createTreeLoader<string>(tree => trees.push(tree), manager => managers.push(manager));
  const reply = (index: number, tree: string[]) => requests[index].resolve(Response.json({ tree, isManager: true }));
  return { loader, requests, trees, managers, reply, restore: () => { globalThis.fetch = originalFetch; } };
}

test('editing refreshes retain the current lifecycle and tester filters', async () => {
  const s = setup();
  try {
    const refreshFromOldEditor = s.loader.load;
    for (const archive of ['active', 'archived', 'draft', 'all']) {
      s.loader.setFilters({ archive, testerId: '7' });
      const request = refreshFromOldEditor();
      const index = s.requests.length - 1;
      const url = new URL(s.requests[index].url, 'http://localhost');
      assert.equal(url.searchParams.get('archive'), archive);
      assert.equal(url.searchParams.get('testerId'), '7');
      s.reply(index, [archive]);
      assert.deepEqual(await request, [archive]);
    }
  } finally { s.restore(); }
});

test('late archived response cannot replace active tree, even if abort is ignored', async () => {
  const s = setup();
  try {
    s.loader.setFilters({ archive: 'archived' });
    const archived = s.loader.load();
    s.loader.setFilters({ archive: 'active' });
    assert.equal(s.requests[0].signal?.aborted, true);
    assert.deepEqual(s.trees.at(-1), []);
    const active = s.loader.load();
    s.reply(1, ['active-project']);
    await active;
    const count = s.trees.length;
    s.reply(0, ['archived-project']);
    assert.equal(await archived, undefined);
    assert.equal(s.trees.length, count);
    assert.deepEqual(s.trees.at(-1), ['active-project']);
    assert.deepEqual(s.managers, [true]);
  } finally { s.restore(); }
});

test('overlapping refreshes and unmounts discard obsolete results', async () => {
  const s = setup();
  try {
    const first = s.loader.load();
    const second = s.loader.load();
    s.reply(1, ['new']);
    await second;
    s.reply(0, ['old']);
    assert.equal(await first, undefined);
    assert.deepEqual(s.trees, [['new']]);
    const pending = s.loader.load();
    s.loader.dispose();
    s.reply(2, ['after-unmount']);
    assert.equal(await pending, undefined);
    assert.deepEqual(s.trees, [['new']]);
  } finally { s.restore(); }
});

test('tester changes invalidate pending results before the next load starts', async () => {
  const s = setup();
  try {
    const previous = s.loader.load();
    s.loader.setFilters({ testerId: '12' });
    s.reply(0, ['wrong-tester']);
    assert.equal(await previous, undefined);
    assert.deepEqual(s.trees, [[]]);
    const current = s.loader.load();
    assert.equal(new URL(s.requests[1].url, 'http://localhost').searchParams.get('archive'), 'active');
    s.reply(1, ['my-tasks']);
    await current;
    assert.deepEqual(s.trees.at(-1), ['my-tasks']);
  } finally { s.restore(); }
});
