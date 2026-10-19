const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

test('homepage warroom entry visibly contains the approved image and preserves both entry domains', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const entry = html.match(/<a\b[^>]*id="warroomEntry"[^>]*>([\s\S]*?)<\/a>/);
  assert.ok(entry, 'homepage needs a real image entry, not only og:image');
  assert.match(entry[1], /<img\b[^>]*src="img\/og\/warroom\.jpg"/);
  assert.match(entry[1], /alt="[^"]+"/);
  assert.match(entry[1], /進入戰情室/);
  const href = entry[0].match(/href="([^"]+)"/)[1];
  for (const base of ['https://event.2nd-team.com/', 'https://sorryxx18.github.io/zteam/']) {
    assert.equal(new URL(href, base).href, base + '?preview=1#command');
  }
});

test('warroom entry appears on overview/activity but not inside command or other working views', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const rule = app.match(/\$\("#warroomEntry"\)\.hidden\s*=\s*[^;]+;/);
  assert.ok(rule, 'entry visibility must follow the existing view');
  for (const [project, tab, visible] of [['casualty','summary',true],['activity','activity',true],['command','command',false],['watch','watch',false],['casualty','stores',false],['biz','biz',false]]) {
    const entry = {};
    vm.runInNewContext(rule[0], { $: () => entry, project, tab });
    assert.equal(!entry.hidden, visible, project + '/' + tab);
  }
});
