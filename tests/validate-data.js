// Validates data/venues.json. Run: node tests/validate-data.js
'use strict';
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'data', 'venues.json');
let ok = true;
const fail = (m) => { ok = false; console.error('FAIL:', m); };
let data;
try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error('FAIL: invalid JSON', e.message); process.exit(1); }
const E = {
  category: ['pub', 'hotel-restaurant', 'restaurant'],
  area: ['windsor-eton', 'maidenhead-bray-taplow', 'paddington'],
  christmas: ['confirmed', 'unconfirmed'],
  availability: ['verified', 'booking-route-open', 'sold-out', 'unknown'],
  nonresident: ['welcome', 'restricted', 'unknown'],
  service: ['included', 'extra', 'unknown'],
};
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const ids = new Set();
if (!data.meta || !data.meta.researchedAt || isNaN(Date.parse(data.meta.researchedAt))) fail('meta.researchedAt missing/invalid');
for (const v of data.venues) {
  const n = v.id || '(no id)';
  if (!/^[a-z0-9-]+$/.test(v.id || '')) fail(`${n}: bad id`);
  if (ids.has(v.id)) fail(`${n}: duplicate id`); ids.add(v.id);
  for (const k of ['name', 'category', 'area', 'links', 'contact', 'christmasDay', 'availability', 'meals', 'pricing', 'nonresident', 'terms', 'summary', 'recommendation', 'sources', 'lastChecked'])
    if (!(k in v)) fail(`${n}: missing ${k}`);
  if (!E.category.includes(v.category)) fail(`${n}: category ${v.category}`);
  if (!E.area.includes(v.area)) fail(`${n}: area ${v.area}`);
  if (!E.christmas.includes(v.christmasDay?.status)) fail(`${n}: christmasDay.status`);
  if (!E.availability.includes(v.availability?.status)) fail(`${n}: availability.status`);
  if (v.availability?.status === 'verified' && !(v.availability.partySize && v.availability.sitting && v.availability.checkedAt)) fail(`${n}: verified availability lacks party/sitting/checkedAt`);
  if (v.availability?.status !== 'verified' && (v.availability?.partySize || v.availability?.checkedAt)) fail(`${n}: non-verified availability should not carry party/checkedAt`);
  if (!E.nonresident.includes(v.nonresident?.status)) fail(`${n}: nonresident.status`);
  if (!E.service.includes(v.pricing?.serviceCharge?.status)) fail(`${n}: serviceCharge.status`);
  for (const k of ['adult', 'child']) {
    const p = v.pricing?.[k];
    if (!(p === null || (typeof p === 'number' && p > 0))) fail(`${n}: pricing.${k} must be positive number or null (got ${p})`);
  }
  for (const k of ['lunch', 'dinner']) if (![true, false, null].includes(v.meals?.[k])) fail(`${n}: meals.${k}`);
  if (!isoDate.test(v.lastChecked || '')) fail(`${n}: lastChecked`);
  if (!Array.isArray(v.sources) || !v.sources.length) fail(`${n}: needs at least one source`);
  for (const s of v.sources || []) {
    if (!/^https:\/\//.test(s.url || '')) fail(`${n}: source url not https: ${s.url}`);
    if (!isoDate.test(s.checked || '')) fail(`${n}: source checked date`);
    if (!Array.isArray(s.supports)) fail(`${n}: source.supports must be a list`);
  }
  if (v.christmasDay?.status === 'confirmed' && !(v.sources || []).some(s => s.supports && s.supports.length)) fail(`${n}: confirmed venue needs a source that supports facts`);
  for (const [k, u] of Object.entries(v.links || {})) {
    if (k === 'bookingIsEnquiryForm') { if (typeof u !== 'boolean') fail(`${n}: links.bookingIsEnquiryForm must be true/false`); continue; }
    if (k === 'checkTables') {
      if (u === null) continue;
      if (!u || !/^https:\/\//.test(u.template || '')) fail(`${n}: links.checkTables.template must be https`);
      if (/\{(?!date\}|covers\})[^}]*\}/.test(u.template || '')) fail(`${n}: links.checkTables.template has an unknown {placeholder}`);
      if (!Array.isArray(u.prefills) || typeof u.note !== 'string') fail(`${n}: links.checkTables needs prefills[] and note`);
      continue;
    }
    if (u !== null && !/^https:\/\//.test(u)) fail(`${n}: links.${k} not https or null`);
  }
  const cma = v.pricing?.childMaxAge;
  if (!(cma === null || cma === undefined || (Number.isInteger(cma) && cma >= 0 && cma <= 17))) fail(`${n}: pricing.childMaxAge must be an integer 0-17 or null`);
}
const conf = data.venues.filter(v => v.christmasDay.status === 'confirmed').length;
console.log(`${data.venues.length} venues (${conf} confirmed, ${data.venues.length - conf} leads), ${ids.size} unique ids`);
console.log(ok ? 'PASS: data/venues.json is valid' : 'Data validation FAILED');
process.exit(ok ? 0 : 1);
