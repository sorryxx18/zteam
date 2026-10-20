const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

// 2026-10-20 使用者選 A：拿掉首頁／近期活動的戰情室大圖卡，只留活動看板裡的「戰情室」分頁
test('warroom image card is gone; the activity tab is the only entry', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.doesNotMatch(html, /warroomEntry/);
  assert.doesNotMatch(app, /warroomEntry/);
  assert.match(app, /\["command", "📡 戰情室（測試中）"\]/);
});
