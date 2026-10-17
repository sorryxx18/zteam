(function (root) {
 'use strict';
 function ringContains(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
   const [x, y] = ring[i], [xx, yy] = ring[j];
   if (Math.abs((lng-x)*(yy-y)-(lat-y)*(xx-x)) < 1e-10 && lng >= Math.min(x,xx) && lng <= Math.max(x,xx) && lat >= Math.min(y,yy) && lat <= Math.max(y,yy)) return true;
   if ((y > lat) !== (yy > lat) && lng < (xx-x)*(lat-y)/(yy-y)+x) inside = !inside;
  }
  return inside;
 }
 function insideArea(lat, lng, geometry) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !geometry) return false;
  if (geometry.type === 'Feature') return insideArea(lat,lng,geometry.geometry);
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.some(rings => rings.length && ringContains(lat,lng,rings[0]) && !rings.slice(1).some(r => ringContains(lat,lng,r)));
 }
 function nearby(cams, lat, lng, limit = 4) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const rad = Math.PI/180;
  return cams.filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lng)).map(c => {
   const h = Math.sin((c.lat-lat)*rad/2)**2 + Math.cos(lat*rad)*Math.cos(c.lat*rad)*Math.sin((c.lng-lng)*rad/2)**2;
   return {...c,m:Math.round(6371000*2*Math.asin(Math.sqrt(Math.min(1,h))))};
  }).sort((a,b) => a.m-b.m).slice(0,Math.max(0,limit));
 }
 function assignedDevices(station) {
  const raw = station?.vehicles;
  const values = Array.isArray(raw) ? raw.filter(v => typeof v === 'string').flatMap(v => v.split(/[、,，;；\s\n]+/)) : typeof raw === 'string' ? raw.split(/[、,，;；\s\n]+/) : [];
  return [...new Set(values.map(v => v.trim()).filter(Boolean))];
 }
 const api = {insideArea,nearby,assignedDevices};
 if (typeof module === 'object' && module.exports) module.exports = api;
 else root.DutyV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
