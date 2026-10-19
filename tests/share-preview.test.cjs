const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const pages = [
  ['index.html', 'main', null],
  ['activity/index.html', 'activity', '../#activity'],
  ['watch/index.html', 'watch', '../#watch'],
  ['dome/index.html', 'dome', '../#dome'],
  ['drill/index.html', 'drill', '../#drill'],
  ['warroom/index.html', 'warroom', '../?preview=1#command'],
];
const warroomTitle = '二大戰情室（測試中）';
const warroomDescription = '臺北市政府消防局第二救災救護大隊｜跨年等大型活動的即時指揮面板：119 案件、天氣、路口影像、輿情。';

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map(m => [m[1].toLowerCase(), m[3]]));
}
function metadata(html, key) {
  const matches = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map(m => attributes(m[0]))
    .filter(a => (a.property || a.name || '').toLowerCase() === key);
  assert.equal(matches.length, 1, `exactly one ${key}`);
  return matches[0].content;
}

test('index.html: every first-party JS/CSS reference uses version 20261019m', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const references = [...html.matchAll(/<(?:script|link)\b[^>]*>/gi)]
    .map(m => attributes(m[0]))
    .map(a => a.src || a.href || '')
    .filter(url => !/^(?:[a-z]+:)?\/\//i.test(url) && /\.(?:js|css)(?:[?#]|$)/i.test(url));
  assert.equal(references.length, 14, 'preserve all existing first-party assets');
  for (const url of references) {
    assert.equal(new URL(url, 'https://event.2nd-team.com/').search, '?v=20261019m', url);
  }
});

for (const [file, image, target] of pages) {
  test(`${file}: static share metadata without a fixed page URL`, () => {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(html, /<html\s+lang="zh-Hant"/);
    for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
      const a = attributes(match[0]);
      assert.ok(!['og:url', 'twitter:url'].includes((a.property || a.name || '').toLowerCase()), 'no fixed page URL metadata');
    }
    for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
      assert.ok(!(attributes(match[0]).rel || '').toLowerCase().split(/\s+/).includes('canonical'), 'no canonical');
    }
    const title = html.match(/<title>(.*?)<\/title>/s)?.[1];
    const description = metadata(html, 'description');
    assert.ok(title && description);
    assert.equal(metadata(html, 'og:type'), 'website');
    assert.equal(metadata(html, 'og:site_name'), 'Z-TEAM 防火任務板');
    const ogTitle = metadata(html, 'og:title');
    assert.equal(metadata(html, 'og:description'), description);
    const imageUrl = `https://sorryxx18.github.io/zteam/img/og/${image}.jpg`;
    assert.equal(metadata(html, 'og:image'), imageUrl);
    assert.equal(metadata(html, 'og:image:width'), '1200');
    assert.equal(metadata(html, 'og:image:height'), '630');
    assert.equal(metadata(html, 'twitter:card'), 'summary_large_image');
    assert.equal(metadata(html, 'twitter:title'), ogTitle);
    assert.equal(metadata(html, 'twitter:description'), description);
    assert.equal(metadata(html, 'twitter:image'), imageUrl);
    if (image === 'warroom') {
      assert.equal(title, warroomTitle);
      assert.equal(ogTitle, warroomTitle);
      assert.equal(description, warroomDescription);
    }
  });
  if (target) {
    test(`${file}: refresh, script and fallback keep the approved relative redirect`, () => {
      const html = fs.readFileSync(path.join(root, file), 'utf8');
      const refresh = [...html.matchAll(/<meta\b[^>]*>/gi)].map(m => attributes(m[0])).filter(a => (a['http-equiv'] || '').toLowerCase() === 'refresh');
      assert.deepEqual(refresh.map(a => a.content), [`0; url=${target}`]);
      const destinations = [];
      const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
      assert.equal(scripts.length, 1);
      vm.runInNewContext(scripts[0][1], { location: { replace: url => destinations.push(url) } });
      assert.deepEqual(destinations, [target]);
      assert.ok([...html.matchAll(/<a\b[^>]*>/gi)].some(m => attributes(m[0]).href === target));
      for (const base of ['https://event.2nd-team.com/', 'https://sorryxx18.github.io/zteam/']) {
        assert.equal(new URL(target, new URL(`${image}/`, base)).href, `${base}${target.slice(3)}`);
      }
    });
  }
}
