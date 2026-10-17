/* 平面與3D共用：只處理顯示，不修改回報資料。 */
(function (root) {
  function distance(a, b) {
    const rad = Math.PI / 180;
    const h = Math.sin((b[0] - a[0]) * rad / 2) ** 2 +
      Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin((b[1] - a[1]) * rad / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
  }
  function trackSegments(track) {
    const points = [...track].filter((p) => Array.isArray(p) && p.length >= 3 &&
      p.slice(0, 3).every(Number.isFinite) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180)
      .sort((a, b) => a[2] - b[2]);
    const segments = [];
    let segment = [], time;
    for (const p of points) {
      if (p[2] === time) continue;
      if (!segment.length || p[2] - time > 300000) {
        segment = [];
        segments.push(segment);
      }
      time = p[2];
      if (!segment.length || distance(segment[segment.length - 1], p) >= 25) segment.push(p);
    }
    return segments;
  }
  function number(value) {
    if (value == null || String(value).trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  function positionStatus(last, now = Date.now()) {
    const age = now - last.t;
    const state = age < 60000 ? 'ok' : age < 300000 ? 'warn' : 'old';
    const acc = number(last.acc), speed = number(last.speed);
    const poor = acc !== null && acc > 50;
    const quality = acc === null ? '精確度未知' :
      `${poor ? '定位不準（' : ''}精確度 ${acc} 公尺${poor ? '）' : ''}`;
    return { state, poor, quality, speedKmh: acc !== null && !poor && state !== 'old' && speed !== null ? Math.round(speed * 3.6) : null };
  }
  function createFeed(url, onChange) {
    let controller, request = 0;
    const feed = {
      data: null, minutes: null, lastSuccess: null, failed: false, pending: false,
      message(now = Date.now()) {
        const saved = this.lastSuccess === null ? '尚無可顯示資料' :
          `上次成功 ${new Date(this.lastSuccess).toLocaleTimeString('zh-TW', { hour12: false, timeZone: 'Asia/Taipei' })}（近 ${this.minutes} 分鐘）`;
        if (this.failed) return `讀取失敗；${this.data ? '保留' : ''}${saved}，15 秒後重試`;
        if (this.pending) return `讀取中…${this.data ? '保留' + saved : ''}`;
        return this.lastSuccess === null ? '尚未讀取資料' :
          `${now - this.lastSuccess > 45000 ? '更新延遲；' : '資料更新；'}${saved}`;
      },
      async load(minutes) {
        const id = ++request;
        if (controller) controller.abort();
        controller = new AbortController();
        const current = controller;
        const timeout = setTimeout(() => current.abort(), 12000);
        this.pending = true;
        onChange();
        try {
          const r = await fetch(url, { method: 'POST', body: JSON.stringify({ action: 'fleet_data', minutes }), signal: current.signal });
          if (!r.ok) throw new Error('HTTP error');
          const data = await r.json();
          if (!data.ok || !Array.isArray(data.cars)) throw new Error('Invalid fleet data');
          if (id !== request) return;
          this.data = data;
          this.minutes = minutes;
          this.lastSuccess = Date.now();
          this.failed = false;
        } catch (e) {
          if (id === request) this.failed = true;
        } finally {
          clearTimeout(timeout);
          if (id === request) { this.pending = false; onChange(); }
        }
      }
    };
    return feed;
  }
  const api = { trackSegments, positionStatus, createFeed };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Fleet = api;
})(globalThis);
