const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('巡邏隊兩種時間在窄螢幕可換行，不以 nowrap 擠出狀態框', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
  const rule = css.match(/\.wupd\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(rule, /white-space:\s*normal/);
  assert.match(rule, /max-width:\s*100%/);
});

test('手機來源卡不再把入庫與檢查時間隱藏', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
  const rule = css.match(/\.wtools\s+\.wsrc\s+\.note\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(rule, /display:\s*block/);
});
