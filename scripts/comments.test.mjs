import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
// The handler imports sibling modules by their .js names, so test the packaged build.
import { ServerComments } from '../dist/internal/server-comments.js';

const origin = 'https://viewer.example';
const people = {
 ada: { sub: 'user-ada', name: 'Ada Example', picture: 'https://images.example/ada.png' },
 ben: { sub: 'user-ben', name: 'Ben Example', picture: 'http://insecure.example/ben.png' }
};
const servers = [];
after(() => { for (const server of servers) server.close(); });

function setup(config = {}) {
 const server = new ServerComments({
  database: ':memory:', path: '/comments',
  user: (event) => people[event.request.headers.get('x-test-user')] ?? null, ...config
 });
 servers.push(server);
 const call = async (path, { as, method = 'GET', body, headers = {} } = {}) => {
  const url = new URL(path, origin);
  const request = new Request(url, {
   method,
   headers: {
    ...(as ? { 'x-test-user': as } : {}),
    ...(method === 'GET' ? {} : { origin }),
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...headers
   },
   body: body === undefined ? undefined : JSON.stringify(body)
  });
  const response = await server.handle({ request, url });
  return response && { status: response.status, body: await response.json(), headers: response.headers };
 };
 const start = (as = 'ada', body = 'Tighten this heading') =>
  call('/comments/threads', { as, method: 'POST', body: { frame: 'overview', x: 120.04, y: 48, body } });
 return { server, call, start };
}

test('ignores requests outside its path', async () => {
 const { call } = setup();
 assert.equal(await call('/frame/overview'), undefined);
 assert.equal(await call('/commentsx'), undefined);
});

test('a thread starts with its first comment and is read by its author', async () => {
 const { call, start } = setup();
 const { status, body } = await start();
 assert.equal(status, 201);
 assert.equal(body.thread.id, 1);
 assert.deepEqual([body.thread.frame, body.thread.x, body.thread.y], ['overview', 120, 48]);
 assert.equal(body.thread.comments[0].body, 'Tighten this heading');
 assert.deepEqual(body.thread.comments[0].author, people.ada);
 assert.equal(body.thread.unread, false);

 const list = await call('/comments', { as: 'ben' });
 assert.equal(list.body.threads.length, 1);
 assert.equal(list.body.threads[0].unread, true);
 assert.deepEqual(list.body.viewer, { sub: 'user-ben', name: 'Ben Example' }); // non-HTTPS pictures are dropped
});

test('signed-out viewers see nothing and cannot write unless reading is public', async () => {
 const { call, start } = setup();
 await start();
 assert.deepEqual((await call('/comments')).body, { viewer: null, threads: [] });
 assert.equal((await call('/comments/events')).status, 401);
 assert.equal((await call('/comments/threads', { method: 'POST', body: { frame: 'a', x: 1, y: 1, body: 'x' } })).status, 401);

 const open = setup({ public: true });
 await open.start();
 const list = await open.call('/comments');
 assert.equal(list.body.threads.length, 1);
 assert.equal(list.body.threads[0].unread, false);
});

test('writes require a same-origin JSON request', async () => {
 const { call } = setup();
 const body = { frame: 'overview', x: 1, y: 1, body: 'Hello' };
 assert.equal((await call('/comments/threads', { as: 'ada', method: 'POST', body, headers: { origin: 'https://evil.example' } })).status, 403);
 assert.equal((await call('/comments/threads', { as: 'ada', method: 'POST', body, headers: { 'content-type': 'text/plain' } })).status, 415);
});

test('rejects invalid frames, positions and bodies', async () => {
 const { call } = setup();
 const post = (body) => call('/comments/threads', { as: 'ada', method: 'POST', body });
 assert.equal((await post({ frame: '../etc', x: 1, y: 1, body: 'x' })).status, 400);
 assert.equal((await post({ frame: 'overview', x: -1, y: 1, body: 'x' })).status, 400);
 assert.equal((await post({ frame: 'overview', x: 1, y: Infinity, body: 'x' })).status, 400);
 assert.equal((await post({ frame: 'overview', x: 1, y: 1, body: '   ' })).status, 400);
 assert.equal((await post({ frame: 'overview', x: 1, y: 1, body: 'x'.repeat(5001) })).status, 413);
});

test('replies mark the thread unread for others and reopen a resolved thread', async () => {
 const { call, start } = setup();
 await start();
 assert.equal((await call('/comments/threads/1', { as: 'ben', method: 'PATCH', body: { resolved: true } })).body.thread.resolvedBy.name, 'Ben Example');
 const reply = await call('/comments/threads/1/comments', { as: 'ben', method: 'POST', body: { body: 'Done\r\nsee v2' } });
 assert.equal(reply.status, 201);
 assert.equal(reply.body.thread.resolvedAt, null);
 assert.equal(reply.body.thread.comments[1].body, 'Done\nsee v2');

 assert.equal((await call('/comments', { as: 'ada' })).body.threads[0].unread, true);
 await call('/comments/threads/1/read', { as: 'ada', method: 'POST', body: { read: true } });
 assert.equal((await call('/comments', { as: 'ada' })).body.threads[0].unread, false);
 await call('/comments/threads/1/read', { as: 'ada', method: 'POST', body: { read: false } });
 assert.equal((await call('/comments', { as: 'ada' })).body.threads[0].unread, true);
});

test('only authors edit or delete their comments; deleting the first comment deletes the thread', async () => {
 const { call, start } = setup();
 await start();
 await call('/comments/threads/1/comments', { as: 'ben', method: 'POST', body: { body: 'Agreed' } });
 assert.equal((await call('/comments/comments/1', { as: 'ben', method: 'PATCH', body: { body: 'Hijack' } })).status, 403);
 assert.equal((await call('/comments/threads/1', { as: 'ben', method: 'DELETE' })).status, 403);

 const edited = await call('/comments/comments/1', { as: 'ada', method: 'PATCH', body: { body: 'Tighten the heading' } });
 assert.equal(edited.body.thread.comments[0].body, 'Tighten the heading');
 assert.ok(edited.body.thread.comments[0].editedAt);

 const reply = await call('/comments/comments/2', { as: 'ben', method: 'DELETE' });
 assert.equal(reply.body.thread.comments.length, 1);
 assert.deepEqual((await call('/comments/comments/1', { as: 'ada', method: 'DELETE' })).body, { deleted: 1 });
 assert.equal((await call('/comments', { as: 'ada' })).body.threads.length, 0);
 assert.equal((await call('/comments/threads/1/comments', { as: 'ben', method: 'POST', body: { body: 'Late' } })).status, 404);
});

test('thread numbers are never reused', async () => {
 const { call, start } = setup();
 await start();
 await start();
 await call('/comments/threads/2', { as: 'ada', method: 'DELETE' });
 assert.equal((await start()).body.thread.id, 3);
});

test('the event stream announces every write', async () => {
 const { server, start } = setup();
 const controller = new AbortController();
 const url = new URL('/comments/events', origin);
 const response = await server.handle({ request: new Request(url, { headers: { 'x-test-user': 'ben' }, signal: controller.signal }), url });
 assert.equal(response.headers.get('content-type'), 'text/event-stream');
 const reader = response.body.getReader();
 const decoder = new TextDecoder();
 assert.match(decoder.decode((await reader.read()).value), /^retry:/);
 await start();
 assert.match(decoder.decode((await reader.read()).value), /^event: change/);
 controller.abort();
 assert.equal((await reader.read()).done, true);
});

test('threads persist in the SQLite file across restarts', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'paraframe-comments-'));
 try {
  const database = join(dir, 'nested', 'comments.sqlite');
  const first = setup({ database });
  await first.start();
  first.server.close();
  const second = setup({ database });
  const list = await second.call('/comments', { as: 'ben' });
  assert.equal(list.body.threads[0].comments[0].body, 'Tighten this heading');
  second.server.close();
 } finally {
  rmSync(dir, { recursive: true, force: true });
 }
});
