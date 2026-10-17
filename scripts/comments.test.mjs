import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
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

test('a thread keeps the element its pin was placed on', async () => {
 const { call } = setup();
 const anchor = {
  selector: 'body > main > button:nth-of-type(2)', label: 'button “Add prompts”', text: 'Add prompts',
  x: 100.04, y: 40, width: 96, height: 32, extra: 'dropped'
 };
 const created = await call('/comments/threads', {
  as: 'ada', method: 'POST', body: { frame: 'overview', x: 120, y: 48, anchor, body: 'Rename this' }
 });
 assert.equal(created.status, 201);
 assert.deepEqual(created.body.thread.anchor, {
  selector: anchor.selector, label: anchor.label, text: anchor.text, x: 100, y: 40, width: 96, height: 32
 });
 const open = await call('/comments/threads', {
  as: 'ada', method: 'POST', body: { frame: 'overview', x: 10, y: 10, body: 'Anywhere' }
 });
 assert.equal(open.body.thread.anchor, null);
 const invalid = await call('/comments/threads', {
  as: 'ada', method: 'POST', body: { frame: 'overview', x: 10, y: 10, anchor: { label: 'button' }, body: 'Bad' }
 });
 assert.equal(invalid.status, 400);
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function upload(server, as, bytes, type = 'image/png', query = '?width=40&height=30') {
 const url = new URL(`/comments/images${query}`, origin);
 const request = new Request(url, {
  method: 'POST', headers: { 'x-test-user': as, origin, 'content-type': type }, body: bytes
 });
 const response = await server.handle({ request, url });
 return { status: response.status, body: await response.json() };
}

async function image(server, as, id) {
 const url = new URL(`/comments/images/${id}`, origin);
 const response = await server.handle({ request: new Request(url, { headers: as ? { 'x-test-user': as } : {} }), url });
 return { status: response.status, headers: response.headers, bytes: response.ok ? new Uint8Array(await response.arrayBuffer()) : null };
}

test('images upload first, then belong to the comment they are sent with', async () => {
 const { server, call } = setup();
 const uploaded = await upload(server, 'ada', PNG);
 assert.equal(uploaded.status, 201);
 assert.deepEqual(uploaded.body.image, { id: 1, width: 40, height: 30 });
 // Until it is sent, only its uploader can see it.
 assert.equal((await image(server, 'ben', 1)).status, 404);
 assert.equal((await image(server, 'ada', 1)).status, 200);

 const created = await call('/comments/threads', {
  as: 'ada', method: 'POST', body: { frame: 'overview', x: 1, y: 1, images: [1] }
 });
 assert.equal(created.status, 201);
 assert.equal(created.body.thread.comments[0].body, '');
 assert.deepEqual(created.body.thread.comments[0].images, [{ id: 1, width: 40, height: 30 }]);

 const read = await image(server, 'ben', 1);
 assert.equal(read.status, 200);
 assert.deepEqual(read.bytes, PNG);
 assert.equal(read.headers.get('content-type'), 'image/png');
 assert.equal(read.headers.get('x-content-type-options'), 'nosniff');
 assert.equal((await image(server, undefined, 1)).status, 401);

 // Someone else's upload, or one already sent, cannot be attached again.
 const stolen = await call('/comments/threads/1/comments', { as: 'ben', method: 'POST', body: { images: [1] } });
 assert.equal(stolen.status, 400);
});

test('editing a comment can drop its images, and deleting it deletes them', async () => {
 const { server, call } = setup();
 await upload(server, 'ada', PNG);
 await upload(server, 'ada', PNG);
 await call('/comments/threads', { as: 'ada', method: 'POST', body: { frame: 'overview', x: 1, y: 1, body: 'Two', images: [1, 2] } });
 const edited = await call('/comments/comments/1', { as: 'ada', method: 'PATCH', body: { body: 'One', images: [2] } });
 assert.deepEqual(edited.body.thread.comments[0].images.map((i) => i.id), [2]);
 assert.equal((await image(server, 'ada', 1)).status, 404);
 const emptied = await call('/comments/comments/1', { as: 'ada', method: 'PATCH', body: { body: '', images: [] } });
 assert.equal(emptied.status, 400);
 await call('/comments/comments/1', { as: 'ada', method: 'DELETE' });
 assert.equal((await image(server, 'ada', 2)).status, 404);
});

test('only real PNG, JPEG, GIF and WebP images are accepted', async () => {
 const { server } = setup();
 const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
 assert.equal((await upload(server, 'ada', svg, 'image/svg+xml')).status, 415);
 assert.equal((await upload(server, 'ada', svg, 'image/png')).status, 415);
 assert.equal((await upload(server, 'ada', PNG, 'image/png', '?width=0&height=30')).status, 400);
 assert.equal((await upload(server, undefined, PNG)).status, 401);
 const big = new Uint8Array(10 * 1024 * 1024 + 1);
 big.set(PNG);
 assert.equal((await upload(server, 'ada', big)).status, 413);
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

test('a server that exits leaves every comment in the database file, not in the WAL', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'paraframe-comments-'));
 try {
  const database = join(dir, 'comments.sqlite');
  const module = new URL('../dist/internal/server-comments.js', import.meta.url).href;
  execFileSync(process.execPath, ['--input-type=module', '-e', `
   const { existsSync } = await import('node:fs');
   const { ServerComments } = await import(${JSON.stringify(module)});
   const server = new ServerComments({ database: ${JSON.stringify(database)}, path: '/comments', user: () => null });
   server.store.createThread({ sub: 'user-ada', name: 'Ada', picture: '' }, { frame: 'overview', x: 1, y: 1, body: 'Kept', anchor: null, images: [] });
   // While open, the write is in the WAL.
   process.exit(existsSync(${JSON.stringify(`${database}-wal`)}) ? 0 : 2);
  `], { stdio: 'pipe' });
  assert.equal(existsSync(`${database}-wal`), false);
  const reopened = setup({ database, path: '/exited' });
  assert.equal((await reopened.call('/exited', { as: 'ben' })).body.threads[0].comments[0].body, 'Kept');
  reopened.server.close();
 } finally {
  rmSync(dir, { recursive: true, force: true });
 }
});

test('a reload reuses the open database, and a reload naming another one is refused', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'paraframe-reload-'));
 try {
  const first = setup({ database: join(dir, 'comments.sqlite'), path: '/reload' });
  const post = (server) => server.call('/reload/threads', { as: 'ada', method: 'POST', body: { frame: 'overview', x: 1, y: 1, body: 'Kept' } });
  assert.equal((await post(first)).status, 201);
  // Module reloads in development make new instances with the same settings.
  const again = setup({ database: join(dir, 'comments.sqlite'), path: '/reload' });
  assert.equal(again.server.store, first.server.store);
  assert.equal((await again.call('/reload', { as: 'ben' })).body.threads.length, 1);
  // Another database for the same endpoint, e.g. changed environment: refused, not switched.
  const moved = setup({ database: join(dir, 'other.sqlite'), path: '/reload' });
  const refused = await moved.call('/reload', { as: 'ben' });
  assert.equal(refused.status, 503);
  assert.match(refused.body.error, /changed from .*comments\.sqlite to .*other\.sqlite/);
  assert.equal((await post(moved)).status, 503);
  first.server.close();
 } finally {
  rmSync(dir, { recursive: true, force: true });
 }
});

test('a database file deleted or replaced while open is refused, not written to', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'paraframe-gone-'));
 try {
  const database = join(dir, 'comments.sqlite');
  const { server, call } = setup({ database, path: '/gone' });
  const post = () => call('/gone/threads', { as: 'ada', method: 'POST', body: { frame: 'overview', x: 1, y: 1, body: 'Hello' } });
  assert.equal((await post()).status, 201);
  copyFileSync(database, join(dir, 'copy.sqlite'));

  // Replaced, as by a restore over a running server.
  renameSync(join(dir, 'copy.sqlite'), database);
  const replaced = await post();
  assert.equal(replaced.status, 503);
  assert.match(replaced.body.error, /deleted or replaced/);

  // Deleted.
  rmSync(database);
  assert.equal((await post()).status, 503);
  assert.equal((await call('/gone', { as: 'ada' })).status, 503);
  server.close();
 } finally {
  rmSync(dir, { recursive: true, force: true });
 }
});
