// 犀牛資料合流與趨勢。純函式同時由 Node 測試和網頁使用。
(function (root) {
  const words = ['消防', '消防員', '消防局', '火警', '火災', '冒煙', '救護車', '救護', '救助', '地震', '淹水', '樹倒', '停電', '爆炸', '人潮', '排隊'];
  function key(i) {
    try {
      const u = new URL(i.u);
      if (i.s === 'threads' && /(^|\.)threads\.(com|net)$/.test(u.hostname)) {
        const code = u.pathname.match(/\/post\/([A-Za-z0-9_-]+)/)?.[1];
        if (code) return 'threads:' + code;
      }
      for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/.test(k)) u.searchParams.delete(k);
      return i.s + ':' + u.href;
    } catch { return null; }
  }
  function merge(base, extra) {
    const out = [], index = new Map();
    for (const raw of [...base, ...extra]) {
      const i = { ...raw }, k = key(i);
      if (k && index.has(k)) {
        const old = index.get(k);
        if ((i.x || '').length > (old.x || '').length) old.x = i.x;
        if (i.h && !old.h) old.h = i.h;
        if (i.tag && !old.tag) old.tag = i.tag;
        old._lab = old._lab || !!i._lab;
        if (i.classification) old.classification = i.classification;
      } else { out.push(i); if (k) index.set(k, i); }
    }
    return out.sort((a, b) => b.t - a.t);
  }
  function series(items, days, src, loc, now = Date.now()) {
    const from = now - Number(days) * 86400000, step = 3600000, first = Math.floor(from / step) * step;
    const length = Math.floor((now - first) / step) + 1;
    const binsByWord = Object.fromEntries(words.map(w => [w, Array.from({ length }, (_, n) => ({ at: first + n * step, count: 0 }))]));
    const totals = Object.fromEntries(words.map(w => [w, 0])); let posts = 0;
    for (const i of items) {
      if (i.t < from || i.t > now || (src && i.s !== src) || (loc && !i._loc)) continue;
      posts++;
      const hay = ((i.x || '') + ' ' + (i.h || '') + ' ' + (i.tag || '')).toLowerCase(), n = Math.floor((i.t - first) / step);
      for (const w of words) if (hay.includes(w.toLowerCase())) { binsByWord[w][n].count++; totals[w]++; }
    }
    return { counts: words.map(w => [w, totals[w]]).sort((a,b) => b[1]-a[1]), binsByWord, from, to: now, posts };
  }
  function trend(items, days, src, loc, word, now = Date.now()) {
    const all = series(items, days, src, loc, now), bins = all.binsByWord[word] || [];
    return { ...all, bins, total: bins.reduce((s,b) => s+b.count,0) };
  }
  root.WatchIntegration = { merge, trend, series, words, key };
  if (typeof module !== 'undefined') module.exports = root.WatchIntegration;
})(globalThis);
