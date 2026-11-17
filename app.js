/* Christmas Day 2026 planner — plain JavaScript, no dependencies.
 * All untrusted or user-supplied text is rendered with textContent (never innerHTML).
 */
(function () {
  'use strict';

  var DATA_URL = 'data/venues.json';
  var STORAGE_KEY = 'xmas2026-planner.v1';
  var EXPORT_FORMAT = 'xmas2026-shortlist';
  var MAX_COMPARE = 4;
  var MAX_NOTE_LENGTH = 5000;
  var MAX_IMPORT_BYTES = 1024 * 1024;

  var ENUMS = {
    category: ['pub', 'hotel-restaurant', 'restaurant'],
    area: ['windsor-eton', 'maidenhead-bray-taplow', 'paddington'],
    christmas: ['confirmed', 'unconfirmed'],
    availability: ['verified', 'booking-route-open', 'sold-out', 'unknown'],
    nonresident: ['welcome', 'restricted', 'unknown'],
    service: ['included', 'extra', 'unknown']
  };
  var AREA_ORDER = { 'windsor-eton': 0, 'maidenhead-bray-taplow': 1, 'paddington': 2 };
  var LABELS = {
    category: { 'pub': 'Pub', 'hotel-restaurant': 'Hotel restaurant', 'restaurant': 'Restaurant' },
    area: { 'windsor-eton': 'Windsor & Eton', 'maidenhead-bray-taplow': 'Maidenhead, Bray & Taplow', 'paddington': 'Paddington (London)' },
    nonresident: { 'welcome': 'Non-residents welcome', 'restricted': 'Restricted for non-residents', 'unknown': 'Non-resident access unknown' },
    service: { 'included': 'Included', 'extra': 'Added to bill', 'unknown': 'Unknown' }
  };

  var gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
  function money(n) { return gbp.format(n); }
  function fmtDate(iso) {
    if (!iso) return null;
    var d = new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso);
    if (isNaN(d)) return null;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
  }
  function fmtDateTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return null;
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London', timeZoneName: 'short' });
  }

  /* ---------- DOM helper (safe) ---------- */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'href') { var safe = safeUrl(v); if (safe) el.setAttribute('href', safe); }
        else el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, child) {
    if (arguments.length > 2) { for (var j = 1; j < arguments.length; j++) append(el, arguments[j]); return; }
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(el, c); }); return; }
    el.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function $(id) { return document.getElementById(id); }

  function safeUrl(u) {
    if (typeof u !== 'string' || !u) return null;
    if (/^(tel|mailto):/i.test(u)) return u;
    try {
      var url = new URL(u, document.baseURI);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
    } catch (e) { /* invalid */ }
    return null;
  }
  function extLink(url, label, cls) {
    var safe = safeUrl(url);
    if (!safe) return null;
    return h('a', { href: safe, class: cls || 'btn btn-secondary btn-small', target: '_blank', rel: 'noopener noreferrer' }, label,
      h('span', { class: 'visually-hidden', text: ' (opens in new tab)' }));
  }
  function unknownText(text) { return h('span', { class: 'unknown', text: text || 'Unknown' }); }

  /* ---------- Storage (gracefully degrades) ---------- */
  var storageOK = true;
  var memoryStore = null;
  function storageAvailable() {
    try {
      var k = '__xmas_test__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  }
  function defaultState() { return { favorites: [], notes: {}, compare: [], party: { adults: null, children: null } }; }
  function loadState() {
    storageOK = storageAvailable();
    if (!storageOK) { memoryStore = memoryStore || defaultState(); return memoryStore; }
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      var parsed = JSON.parse(raw);
      return sanitizeState(parsed).state;
    } catch (e) { return defaultState(); }
  }
  function saveState() {
    if (!storageOK) { memoryStore = state; return; }
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { storageOK = false; showStorageWarning(); }
  }
  function showStorageWarning() {
    var el = $('storage-warning');
    el.textContent = 'Browser storage is unavailable (for example in private browsing or with storage blocked). Favourites, notes and comparisons will work for this visit only and will be lost when you close the page. Use Export to keep a copy.';
    el.hidden = false;
  }
  function isPosInt(n, max) { return typeof n === 'number' && isFinite(n) && n >= 0 && n <= max && Math.floor(n) === n; }
  function sanitizeState(obj) {
    var s = defaultState();
    var warnings = [];
    if (!obj || typeof obj !== 'object') return { state: s, warnings: ['No data found.'] };
    if (Array.isArray(obj.favorites)) {
      obj.favorites.forEach(function (id) { if (typeof id === 'string' && /^[a-z0-9-]{1,80}$/.test(id) && s.favorites.indexOf(id) < 0) s.favorites.push(id); });
    }
    if (obj.notes && typeof obj.notes === 'object' && !Array.isArray(obj.notes)) {
      Object.keys(obj.notes).forEach(function (id) {
        var v = obj.notes[id];
        if (/^[a-z0-9-]{1,80}$/.test(id) && typeof v === 'string') {
          if (v.length > MAX_NOTE_LENGTH) warnings.push('A note was longer than ' + MAX_NOTE_LENGTH + ' characters and was shortened.');
          if (v.trim()) s.notes[id] = v.slice(0, MAX_NOTE_LENGTH);
        }
      });
    }
    if (Array.isArray(obj.compare)) {
      obj.compare.forEach(function (id) { if (typeof id === 'string' && /^[a-z0-9-]{1,80}$/.test(id) && s.compare.indexOf(id) < 0 && s.compare.length < MAX_COMPARE) s.compare.push(id); });
    }
    if (obj.party && typeof obj.party === 'object') {
      if (isPosInt(obj.party.adults, 50)) s.party.adults = obj.party.adults;
      if (isPosInt(obj.party.children, 50)) s.party.children = obj.party.children;
    }
    return { state: s, warnings: warnings };
  }

  /* ---------- Data validation ---------- */
  function validateVenue(v) {
    var errs = [];
    if (!v || typeof v !== 'object') return ['not an object'];
    if (typeof v.id !== 'string' || !/^[a-z0-9-]+$/.test(v.id)) errs.push('id');
    if (typeof v.name !== 'string' || !v.name) errs.push('name');
    if (ENUMS.category.indexOf(v.category) < 0) errs.push('category');
    if (ENUMS.area.indexOf(v.area) < 0) errs.push('area');
    if (!v.christmasDay || ENUMS.christmas.indexOf(v.christmasDay.status) < 0) errs.push('christmasDay.status');
    if (!v.availability || ENUMS.availability.indexOf(v.availability.status) < 0) errs.push('availability.status');
    if (v.availability && v.availability.status === 'verified' && (!v.availability.partySize || !v.availability.sitting || !v.availability.checkedAt)) errs.push('verified availability needs partySize, sitting and checkedAt');
    if (!v.nonresident || ENUMS.nonresident.indexOf(v.nonresident.status) < 0) errs.push('nonresident.status');
    if (!v.pricing || !v.pricing.serviceCharge || ENUMS.service.indexOf(v.pricing.serviceCharge.status) < 0) errs.push('pricing.serviceCharge.status');
    if (v.pricing && v.pricing.adult !== null && !(typeof v.pricing.adult === 'number' && v.pricing.adult > 0)) errs.push('pricing.adult must be a positive number or null');
    if (v.pricing && v.pricing.child !== null && !(typeof v.pricing.child === 'number' && v.pricing.child >= 0)) errs.push('pricing.child must be a number or null');
    if (!v.meals || typeof v.meals !== 'object') errs.push('meals');
    if (!Array.isArray(v.sources)) errs.push('sources');
    return errs;
  }

  /* ---------- App state ---------- */
  var data = null;
  var venues = [];
  var byId = {};
  var state = defaultState();

  function fetchData() {
    // Cache-busting query + no-store so a refresh always gets the latest published file.
    return fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  function init() {
    state = loadState();
    if (!storageOK) showStorageWarning();
    $('refresh-btn').addEventListener('click', refreshData);
    fetchData()
      .then(function (json) { onData(json); })
      .catch(function (err) { showLoadError(err); });
  }

  /* Re-download data/venues.json and re-run every summary, filter and calculation.
   * Keeps filters, favourites, notes, comparison picks and party size.
   * It does NOT re-research the web: it reloads whatever data file is currently published. */
  var refreshing = false;
  function refreshData() {
    if (refreshing) return;
    refreshing = true;
    var btn = $('refresh-btn'), status = $('refresh-status');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    status.textContent = 'Reloading venue data…';
    var before = data ? JSON.stringify(data) : null;
    var oldResearchedAt = data && data.meta ? data.meta.researchedAt : null;
    fetchData()
      .then(function (json) {
        if (!json || !Array.isArray(json.venues)) throw new Error('data/venues.json has no "venues" list');
        var changed = before !== JSON.stringify(json);
        onData(json);
        var now = fmtDateTime(new Date().toISOString());
        var msg;
        if (!changed) msg = 'Refreshed ' + now + '. No changes: the published data is the same as before.';
        else {
          msg = 'Refreshed ' + now + '. Updated data loaded: ' + venues.length + ' venues.';
          if (json.meta && json.meta.researchedAt && json.meta.researchedAt !== oldResearchedAt) msg += ' New research snapshot: ' + (fmtDateTime(json.meta.researchedAt) || json.meta.researchedAt) + '.';
          else msg += ' The research snapshot date did not change, so check each venue\'s "last checked" date.';
        }
        status.textContent = msg;
      })
      .catch(function (err) {
        status.textContent = 'Refresh failed (' + (err && err.message ? err.message : 'unknown error') + '). The data already on screen has been kept.';
      })
      .then(function () {
        refreshing = false;
        btn.disabled = false; btn.removeAttribute('aria-busy');
      });
  }

  function showLoadError(err) {
    $('load-state').hidden = true;
    var el = $('load-error');
    clear(el);
    append(el, [
      h('strong', { text: 'The venue data could not be loaded. ' }),
      'Details: ' + (err && err.message ? err.message : 'unknown error') + '. ',
      location.protocol === 'file:'
        ? 'You opened this page directly from your computer (file://), and most browsers block it from loading data/venues.json. Run a simple local web server instead — see README.md, "Preview locally".'
        : 'Check that data/venues.json exists next to index.html and is valid JSON, then reload the page.'
    ]);
    el.hidden = false;
  }

  var bound = false;
  function onData(json) {
    if (!json || !Array.isArray(json.venues)) { showLoadError(new Error('data/venues.json has no "venues" list')); return; }
    data = json;
    venues = []; byId = {};
    var skipped = [];
    var seen = {};
    json.venues.forEach(function (v) {
      var errs = validateVenue(v);
      if (!errs.length && seen[v.id]) errs.push('duplicate id');
      if (errs.length) { skipped.push((v && v.name ? v.name : '(unnamed)') + ': ' + errs.join(', ')); return; }
      seen[v.id] = true;
      venues.push(v); byId[v.id] = v;
    });
    var oldWarn = $('data-warning');
    if (oldWarn) oldWarn.remove();
    if (skipped.length) {
      var w = h('div', { id: 'data-warning', class: 'notice notice-error', role: 'alert' },
        h('strong', { text: skipped.length + ' venue record(s) in data/venues.json were skipped because they are incomplete: ' }),
        h('ul', null, skipped.map(function (s) { return h('li', { text: s }); })));
      $('main').insertBefore(w, $('app'));
    }
    // drop compare ids not in data
    state.compare = state.compare.filter(function (id) { return byId[id]; });
    $('load-state').hidden = true;
    $('load-error').hidden = true;
    $('app').hidden = false;
    $('refresh-btn').hidden = false;
    if (!bound) {
      bound = true;
      bindFilters();
      bindParty();
      bindEnquiry();
      bindShortlist();
      window.addEventListener('beforeprint', function () { document.querySelectorAll('details').forEach(function (d) { d.dataset.wasOpen = d.open ? '1' : ''; d.open = true; }); });
      window.addEventListener('afterprint', function () {
        document.querySelectorAll('details').forEach(function (d) { d.open = d.dataset.wasOpen === '1'; });
        document.body.classList.remove('printing-shortlist');
      });
    }
    populateEnquiryVenues();
    renderMeta();
    renderStats();
    renderPicks();
    renderResults();
    renderCompare();
    renderBudget();
    renderTravel();
    renderEnquiry();
    renderShortlist();
  }

  function renderMeta() {
    var m = data.meta || {};
    var el = $('research-meta');
    clear(el);
    var when = m.researchedAt ? fmtDateTime(m.researchedAt) : null;
    append(el, ['Research snapshot taken ', when ? h('time', { datetime: m.researchedAt, text: when }) : unknownText('(date unknown)'),
      '. Each venue shows its own "last checked" date. All prices in pounds sterling (£).']);
  }

  /* ---------- Overview ---------- */
  function isConfirmed(v) { return v.christmasDay.status === 'confirmed'; }
  function renderStats() {
    var confirmed = venues.filter(isConfirmed);
    var leads = venues.filter(function (v) { return !isConfirmed(v); });
    var evening = confirmed.filter(function (v) { return v.meals.dinner === true; });
    var availVerified = venues.filter(function (v) { return v.availability.status === 'verified'; });
    var el = $('stats');
    clear(el);
    [[confirmed.length, 'Venues with Christmas Day 2026 dining confirmed'],
     [leads.length, 'Leads worth contacting (2026 not confirmed)'],
     [evening.length, 'Confirmed venues with verified evening service'],
     [availVerified.length, 'Venues with table availability verified']].forEach(function (s) {
      append(el, h('div', { class: 'stat' }, h('div', { class: 'stat-value', text: String(s[0]) }), h('div', { class: 'stat-label', text: s[1] })));
    });
  }

  function renderPicks() {
    var picks = venues.filter(function (v) { return v.recommendation && v.recommendation.pick && isConfirmed(v); })
      .sort(function (a, b) { return (b.recommendation.score || 0) - (a.recommendation.score || 0); }).slice(0, 3);
    var ol = $('picks');
    clear(ol);
    if (!picks.length) { append(ol, h('li', { class: 'unknown', text: 'No editorial picks in the current data.' })); return; }
    picks.forEach(function (v) {
      append(ol, h('li', null,
        h('a', { href: '#card-' + v.id, class: 'pick-name', text: v.name }),
        h('span', { class: 'muted small', text: ' — ' + LABELS.area[v.area] + (v.pricing.adult !== null ? ', ' + money(v.pricing.adult) + ' per adult' : ', price unknown') }),
        h('div', { class: 'small', text: v.recommendation.rationale })));
    });
  }

  /* ---------- Filters ---------- */
  var F = {};
  function bindFilters() {
    ['f-q', 'f-area', 'f-type', 'f-verify', 'f-avail', 'f-nonres', 'f-meal-lunch', 'f-meal-dinner', 'f-meal-unknown', 'f-maxprice', 'f-unknownprice', 'f-sort', 'f-fav']
      .forEach(function (id) { F[id] = $(id); F[id].addEventListener('input', renderResults); F[id].addEventListener('change', renderResults); });
    $('f-clear').addEventListener('click', function () {
      F['f-q'].value = ''; F['f-area'].value = ''; F['f-type'].value = ''; F['f-verify'].value = '';
      F['f-avail'].value = ''; F['f-nonres'].value = ''; F['f-maxprice'].value = ''; F['f-sort'].value = 'fit';
      F['f-meal-lunch'].checked = true; F['f-meal-dinner'].checked = true; F['f-meal-unknown'].checked = true;
      F['f-unknownprice'].checked = true; F['f-fav'].checked = false;
      renderResults();
      F['f-q'].focus();
    });
    $('filters').addEventListener('submit', function (e) { e.preventDefault(); });
  }

  function searchText(v) {
    return [v.name, v.locality, v.address, v.summary && v.summary.menu, v.summary && v.summary.atmosphere, LABELS.area[v.area]]
      .filter(Boolean).join(' ').toLowerCase();
  }

  function filterVenues() {
    var q = F['f-q'].value.trim().toLowerCase();
    var terms = q ? q.split(/\s+/) : [];
    var area = F['f-area'].value, type = F['f-type'].value, ver = F['f-verify'].value, av = F['f-avail'].value, nr = F['f-nonres'].value;
    var mL = F['f-meal-lunch'].checked, mD = F['f-meal-dinner'].checked, mU = F['f-meal-unknown'].checked;
    var maxRaw = F['f-maxprice'].value.trim();
    var max = maxRaw === '' ? null : Number(maxRaw);
    if (max !== null && (!isFinite(max) || max < 0)) max = null;
    var inclUnknown = F['f-unknownprice'].checked;
    var favOnly = F['f-fav'].checked;

    return venues.filter(function (v) {
      if (terms.length) { var t = searchText(v); for (var i = 0; i < terms.length; i++) if (t.indexOf(terms[i]) < 0) return false; }
      if (area && v.area !== area) return false;
      if (type && v.category !== type) return false;
      if (ver && v.christmasDay.status !== ver) return false;
      if (av && v.availability.status !== av) return false;
      if (nr && v.nonresident.status !== nr) return false;
      var hasL = v.meals.lunch === true, hasD = v.meals.dinner === true;
      var mealOK = (mL && hasL) || (mD && hasD) || (mU && !hasL && !hasD);
      if (!mealOK) return false;
      var price = v.pricing.adult;
      if (price === null || price === undefined) { if (!inclUnknown) return false; }
      else if (max !== null && price > max) return false;
      if (favOnly && state.favorites.indexOf(v.id) < 0) return false;
      return true;
    });
  }

  function sortVenues(list) {
    var mode = F['f-sort'].value;
    var byName = function (a, b) { return a.name.localeCompare(b.name, 'en-GB'); };
    var cmp;
    if (mode === 'price') cmp = function (a, b) {
      var pa = a.pricing.adult, pb = b.pricing.adult;
      var ua = pa === null || pa === undefined, ub = pb === null || pb === undefined;
      if (ua && ub) return byName(a, b);
      if (ua) return 1; if (ub) return -1;   // unknown prices always last, never £0
      return pa - pb || byName(a, b);
    };
    else if (mode === 'area') cmp = function (a, b) { return AREA_ORDER[a.area] - AREA_ORDER[b.area] || byName(a, b); };
    else if (mode === 'name') cmp = byName;
    else cmp = function (a, b) { return ((b.recommendation && b.recommendation.score) || 0) - ((a.recommendation && a.recommendation.score) || 0) || byName(a, b); };
    return list.slice().sort(cmp);
  }

  function renderResults() {
    var list = sortVenues(filterVenues());
    var conf = list.filter(isConfirmed), leads = list.filter(function (v) { return !isConfirmed(v); });
    var cc = $('cards-confirmed'), cu = $('cards-unconfirmed');
    clear(cc); clear(cu);
    conf.forEach(function (v) { append(cc, renderCard(v)); });
    leads.forEach(function (v) { append(cu, renderCard(v)); });
    $('confirmed-count').textContent = '(' + conf.length + ')';
    $('unconfirmed-count').textContent = '(' + leads.length + ')';
    cc.parentNode.hidden = conf.length === 0;
    cu.parentNode.hidden = leads.length === 0;
    $('no-results').hidden = list.length !== 0;
    $('result-count').textContent = 'Showing ' + list.length + ' of ' + venues.length + ' venues (' + conf.length + ' confirmed, ' + leads.length + ' leads)';
  }

  /* ---------- Cards ---------- */
  function christmasBadge(v) {
    return isConfirmed(v)
      ? h('span', { class: 'badge badge-confirmed' }, h('span', { 'aria-hidden': 'true', text: '✓' }), 'Christmas Day 2026 confirmed')
      : h('span', { class: 'badge badge-unconfirmed' }, h('span', { 'aria-hidden': 'true', text: '?' }), 'Worth contacting — 2026 not confirmed');
  }
  function availabilityBadge(v) {
    var a = v.availability;
    if (a.status === 'verified') {
      return h('span', { class: 'badge badge-avail-verified' }, h('span', { 'aria-hidden': 'true', text: '●' }),
        'Availability verified: party of ' + a.partySize + ', ' + a.sitting + ' (checked ' + (fmtDateTime(a.checkedAt) || a.checkedAt) + ')');
    }
    if (a.status === 'booking-route-open') return h('span', { class: 'badge badge-avail-open' }, h('span', { 'aria-hidden': 'true', text: '→' }), 'Booking route open — tables not checked');
    if (a.status === 'sold-out') return h('span', { class: 'badge badge-avail-soldout' }, h('span', { 'aria-hidden': 'true', text: '✕' }), 'Sold out');
    return h('span', { class: 'badge badge-avail-unknown' }, h('span', { 'aria-hidden': 'true', text: '…' }), 'Availability unknown');
  }

  function mealText(v) {
    var m = v.meals, parts = [];
    if (m.lunch === true) parts.push('Lunch/afternoon: yes'); else if (m.lunch === false) parts.push('No lunch');
    if (m.dinner === true) parts.push('Evening: yes'); else if (m.dinner === false) parts.push('No evening service');
    var s = parts.length ? parts.join(' · ') : null;
    var sit = (m.sittings && m.sittings.length) ? 'Times: ' + m.sittings.join(', ') : 'Times not published';
    return h('span', null, s ? s + '. ' : unknownText('Meal times unknown. '), sit + (m.note ? ' — ' + m.note : ''));
  }

  function priceNode(v) {
    var p = v.pricing;
    var nodes = [];
    nodes.push(p.adult !== null ? h('strong', { text: money(p.adult) + ' per adult' }) : unknownText('Adult price unknown'));
    if (p.adultNote) nodes.push(h('span', { class: 'small', text: ' (' + p.adultNote + ')' }));
    nodes.push(h('br'));
    if (p.child !== null) nodes.push(money(p.child) + ' per child' + (p.childAgeBand ? ' (' + p.childAgeBand + ')' : ' (age band not published)'));
    else nodes.push(unknownText('Child price unknown' + (p.childAgeBand ? ' (' + p.childAgeBand + ')' : '')));
    if (p.otherPrices && p.otherPrices.length) {
      p.otherPrices.forEach(function (o) { nodes.push(h('br'), h('span', { class: 'small', text: o.label + ': ' + (typeof o.amount === 'number' ? money(o.amount) : 'unknown') })); });
    }
    return h('span', null, nodes);
  }
  function serviceText(v) {
    var s = v.pricing.serviceCharge;
    var label = LABELS.service[s.status] + (s.rate ? ' (' + s.rate + '%)' : '');
    return s.status === 'unknown' ? unknownText(label + (s.note ? ' — ' + s.note : '')) : h('span', null, label + (s.note ? ' — ' + s.note : ''));
  }

  function factRow(label, valueNode) { return [h('dt', { text: label }), h('dd', null, valueNode)]; }
  function maybe(text, fallback) { return text ? h('span', { text: text }) : unknownText(fallback || 'Not published'); }

  function renderCard(v) {
    var fav = state.favorites.indexOf(v.id) >= 0;
    var inCompare = state.compare.indexOf(v.id) >= 0;
    var compareFull = state.compare.length >= MAX_COMPARE && !inCompare;
    var L = v.links || {};
    var c = v.contact || {};

    var favBtn = h('button', { type: 'button', class: 'fav-btn', 'aria-pressed': fav ? 'true' : 'false', 'aria-label': (fav ? 'Remove ' : 'Add ') + v.name + (fav ? ' from' : ' to') + ' favourites',
      onclick: function () { toggleFavorite(v.id); } }, h('span', { 'aria-hidden': 'true', text: fav ? '★' : '☆' }), fav ? ' Saved' : ' Save');

    var compareId = 'cmp-' + v.id;
    var compareBox = h('label', { class: 'check', for: compareId },
      h('input', { type: 'checkbox', id: compareId, checked: inCompare, disabled: compareFull, 'aria-describedby': compareFull ? 'cmp-full-' + v.id : null,
        onchange: function (e) { toggleCompare(v.id, e.target.checked); } }),
      'Compare');
    var compareNote = compareFull ? h('span', { id: 'cmp-full-' + v.id, class: 'small muted', text: 'Compare is full (4). Remove one first.' }) : null;

    var actions = h('div', { class: 'actions' },
      extLink(L.christmas, 'Christmas info'),
      L.menu && L.menu !== L.christmas ? extLink(L.menu, 'Menu') : null,
      extLink(L.booking, 'Booking page'),
      extLink(L.directions, 'Directions'),
      c.phone ? h('a', { class: 'btn btn-secondary btn-small', href: 'tel:' + c.phone.replace(/[^0-9+]/g, ''), text: 'Call ' + c.phone }) : null,
      c.email ? h('a', { class: 'btn btn-secondary btn-small', href: 'mailto:' + c.email, text: 'Email' }) : null,
      !L.website && !L.christmas ? null : (L.website && L.website !== L.christmas ? extLink(L.website, 'Website') : null));

    var t = v.terms || {};
    var termsBody = h('div', { class: 'details-body' },
      h('dl', { class: 'facts' },
        factRow('Includes', v.pricing.includes && v.pricing.includes.length ? h('ul', null, v.pricing.includes.map(function (i) { return h('li', { text: i }); })) : unknownText('Not published')),
        factRow('Supplements', maybe(v.pricing.supplements, 'None published')),
        factRow('Deposit', maybe(t.deposit)),
        factRow('Payment deadline', maybe(t.paymentDeadline)),
        factRow('Pre-order', maybe(t.preorder)),
        factRow('Cancellation', maybe(t.cancellation)),
        factRow('Drinks', h('span', { text: 'Not assumed to be included unless listed above.' }))));

    var dietBody = h('div', { class: 'details-body' },
      h('dl', { class: 'facts' },
        factRow('Dietary', maybe(v.dietary, 'No verified information')),
        factRow('Accessibility', maybe(v.accessibility, 'No verified information'))));

    var srcBody = h('div', { class: 'details-body' },
      h('ul', { class: 'source-list' }, (v.sources || []).map(function (s) {
        return h('li', null,
          safeUrl(s.url) ? h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.title || s.url }) : h('span', { text: s.title || '(invalid link)' }),
          s.supports && s.supports.length ? h('div', { class: 'small', text: 'Supports: ' + s.supports.join('; ') }) : h('div', { class: 'small unknown', text: 'Lead only — supports no confirmed facts' }),
          s.checked ? h('div', { class: 'small muted', text: 'Checked ' + fmtDate(s.checked) }) : null);
      })),
      h('p', { class: 'small' }, h('strong', { text: 'Evidence: ' }), v.christmasDay.evidence || ''),
      v.availability.note ? h('p', { class: 'small' }, h('strong', { text: 'Availability note: ' }), v.availability.note) : null,
      v.caveats && v.caveats.length ? h('div', { class: 'small' }, h('strong', { text: 'Caveats:' }), h('ul', null, v.caveats.map(function (x) { return h('li', { text: x }); }))) : null);

    var noteId = 'note-' + v.id;
    var noteArea = h('textarea', { id: noteId, class: 'notes-area', maxlength: String(MAX_NOTE_LENGTH), placeholder: 'Private note, saved only in this browser' });
    noteArea.value = state.notes[v.id] || '';
    var noteStatus = h('span', { class: 'small muted', role: 'status', 'aria-live': 'polite' });
    var noteTimer = null;
    noteArea.addEventListener('input', function () {
      clearTimeout(noteTimer);
      noteTimer = setTimeout(function () { setNote(v.id, noteArea.value); noteStatus.textContent = storageOK ? 'Saved in this browser.' : 'Saved for this visit only (storage unavailable).'; }, 400);
    });
    var notesDetails = h('details', null, h('summary', { text: 'My notes' + (state.notes[v.id] ? ' (1)' : '') }),
      h('div', { class: 'details-body' }, h('label', { for: noteId, class: 'visually-hidden', text: 'Personal note for ' + v.name }), noteArea, noteStatus));

    var card = h('article', { class: 'card' + (isConfirmed(v) ? '' : ' is-lead'), id: 'card-' + v.id, 'aria-labelledby': 'title-' + v.id },
      h('div', { class: 'card-head' },
        h('div', null,
          h('h4', { id: 'title-' + v.id, text: v.name }),
          h('p', { class: 'sub', text: LABELS.category[v.category] + ' · ' + LABELS.area[v.area] + (v.locality ? ' · ' + v.locality : '') })),
        favBtn),
      h('div', { class: 'badges' }, christmasBadge(v), availabilityBadge(v)),
      h('dl', { class: 'facts' },
        factRow('Address', maybe(v.address, 'Address not captured')),
        factRow('Meals', mealText(v)),
        factRow('Price', priceNode(v)),
        factRow('Service charge', serviceText(v)),
        factRow('Non-residents', h('span', null, v.nonresident.status === 'unknown' ? unknownText(LABELS.nonresident.unknown) : LABELS.nonresident[v.nonresident.status], v.nonresident.note ? h('span', { class: 'small', text: ' — ' + v.nonresident.note }) : null)),
        factRow('Last checked', h('time', { datetime: v.lastChecked, text: fmtDate(v.lastChecked) || 'Unknown' }))),
      v.summary ? h('p', { class: 'small' }, h('strong', { text: 'Menu: ' }), v.summary.menu || '', h('br'), h('strong', { text: 'Atmosphere: ' }), v.summary.atmosphere || '') : null,
      v.recommendation && v.recommendation.rationale ? h('p', { class: 'small muted' }, h('em', { text: 'Our take (editorial): ' }), v.recommendation.rationale) : null,
      actions,
      h('details', null, h('summary', { text: 'Price, deposit & terms' }), termsBody),
      h('details', null, h('summary', { text: 'Dietary & accessibility' }), dietBody),
      h('details', null, h('summary', { text: 'Sources & caveats' }), srcBody),
      notesDetails,
      h('div', { class: 'card-tools' }, compareBox, compareNote));
    return card;
  }

  /* ---------- Favourites / notes / compare ---------- */
  function rerenderKeepingFocus(focusSelector) {
    renderResults(); renderCompare(); renderBudget(); renderShortlist(); renderEnquiry(true);
    if (focusSelector) { var el = document.querySelector(focusSelector); if (el) el.focus(); }
  }
  function toggleFavorite(id) {
    var i = state.favorites.indexOf(id);
    if (i >= 0) state.favorites.splice(i, 1); else state.favorites.push(id);
    saveState();
    rerenderKeepingFocus('#card-' + cssEscape(id) + ' .fav-btn');
  }
  function setNote(id, text) {
    var t = String(text).slice(0, MAX_NOTE_LENGTH);
    if (t.trim()) state.notes[id] = t; else delete state.notes[id];
    saveState();
    renderShortlist();
  }
  function toggleCompare(id, on) {
    var i = state.compare.indexOf(id);
    if (on && i < 0) {
      if (state.compare.length >= MAX_COMPARE) { renderResults(); return; }
      state.compare.push(id);
    } else if (!on && i >= 0) state.compare.splice(i, 1);
    saveState();
    rerenderKeepingFocus('#cmp-' + cssEscape(id));
  }
  function cssEscape(s) { return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }

  /* ---------- Compare ---------- */
  function compareRows() {
    return [
      ['Area', function (v) { return LABELS.area[v.area] + (v.locality ? ' — ' + v.locality : ''); }],
      ['Type', function (v) { return LABELS.category[v.category]; }],
      ['Christmas Day status', function (v) { return christmasBadge(v); }],
      ['Availability', function (v) { return availabilityBadge(v); }],
      ['Adult price', function (v) { return v.pricing.adult !== null ? money(v.pricing.adult) : unknownText(); }],
      ['Child price', function (v) { return v.pricing.child !== null ? money(v.pricing.child) + (v.pricing.childAgeBand ? ' (' + v.pricing.childAgeBand + ')' : '') : unknownText(); }],
      ['Service charge', serviceText],
      ['Meal times', mealText],
      ['Non-residents', function (v) { return (LABELS.nonresident[v.nonresident.status]) + (v.nonresident.note ? ' — ' + v.nonresident.note : ''); }],
      ['Includes', function (v) { return v.pricing.includes && v.pricing.includes.length ? v.pricing.includes.join('; ') : unknownText('Not published'); }],
      ['Deposit', function (v) { return maybe(v.terms.deposit); }],
      ['Payment deadline', function (v) { return maybe(v.terms.paymentDeadline); }],
      ['Pre-order', function (v) { return maybe(v.terms.preorder); }],
      ['Cancellation', function (v) { return maybe(v.terms.cancellation); }],
      ['Evidence', function (v) { return v.christmasDay.evidence || unknownText(); }],
      ['Last checked', function (v) { return fmtDate(v.lastChecked) || unknownText(); }]
    ];
  }
  function renderCompare() {
    var host = $('compare-view');
    clear(host);
    var list = state.compare.map(function (id) { return byId[id]; }).filter(Boolean);
    $('compare-count').textContent = '(' + list.length + ' of ' + MAX_COMPARE + ')';
    if (!list.length) { append(host, h('p', { class: 'empty', text: 'Nothing selected yet. Tick "Compare" on up to four venue cards.' })); return; }
    var rows = compareRows();
    function removeBtn(v) {
      return h('button', { type: 'button', class: 'btn btn-secondary btn-small', 'aria-label': 'Remove ' + v.name + ' from comparison',
        onclick: function () { toggleCompare(v.id, false); var first = document.querySelector('#compare-view button'); if (first) first.focus(); else $('compare-h').focus(); } }, 'Remove');
    }
    // Desktop table
    var table = h('table', { class: 'compare-table' },
      h('caption', { class: 'visually-hidden', text: 'Side-by-side comparison of selected venues' }),
      h('thead', null, h('tr', null, h('td', null), list.map(function (v) { return h('th', { scope: 'col' }, h('div', { text: v.name }), removeBtn(v)); }))),
      h('tbody', null, rows.map(function (r) { return h('tr', null, h('th', { scope: 'row', text: r[0] }), list.map(function (v) { return h('td', null, r[1](v)); })); })));
    append(host, h('div', { class: 'compare-table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Comparison table (scrolls sideways)' }, table));
    // Mobile stacked cards
    append(host, h('div', { class: 'compare-cards' }, list.map(function (v) {
      return h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h4', { text: v.name }), removeBtn(v)),
        h('dl', { class: 'facts' }, rows.map(function (r) { return factRow(r[0], r[1](v)); })));
    })));
    $('compare-h').setAttribute('tabindex', '-1');
  }

  /* ---------- Party / budget ---------- */
  function bindParty() {
    var a = $('p-adults'), c = $('p-children');
    if (state.party.adults !== null) a.value = state.party.adults;
    if (state.party.children !== null) c.value = state.party.children;
    function onChange() {
      var err = [];
      var av = a.value.trim() === '' ? null : Number(a.value);
      var cv = c.value.trim() === '' ? null : Number(c.value);
      if (av !== null && !isPosInt(av, 50)) { err.push('Adults must be a whole number from 0 to 50.'); av = null; }
      if (cv !== null && !isPosInt(cv, 50)) { err.push('Children must be a whole number from 0 to 50.'); cv = null; }
      var pe = $('party-error');
      pe.textContent = err.join(' '); pe.hidden = !err.length;
      state.party.adults = av; state.party.children = cv;
      saveState();
      renderBudget(); renderEnquiry(true);
    }
    a.addEventListener('input', onChange); c.addEventListener('input', onChange);
    $('p-scope').addEventListener('change', renderBudget);
  }

  function renderBudget() {
    var host = $('budget-view');
    clear(host);
    var adults = state.party.adults, children = state.party.children || 0;
    if (adults === null && !children) { append(host, h('p', { class: 'muted small', text: 'Enter at least the number of adults to see estimates.' })); return; }
    var scope = $('p-scope').value;
    var list = venues.filter(isConfirmed);
    if (scope === 'favorites') list = list.filter(function (v) { return state.favorites.indexOf(v.id) >= 0; });
    list = list.slice().sort(function (a, b) {
      var pa = a.pricing.adult, pb = b.pricing.adult;
      if (pa === null && pb === null) return a.name.localeCompare(b.name);
      if (pa === null) return 1; if (pb === null) return -1; return pa - pb;
    });
    if (!list.length) { append(host, h('p', { class: 'empty', text: scope === 'favorites' ? 'No confirmed venues in your favourites yet.' : 'No confirmed venues.' })); return; }
    var wrap = h('div', { class: 'budget-list' });
    list.forEach(function (v) { append(wrap, budgetItem(v, adults || 0, children)); });
    append(host, h('p', { class: 'small', text: 'Party: ' + (adults || 0) + ' adult(s), ' + children + ' child(ren). Estimates use published per-person food prices only. Drinks are excluded unless the venue lists them as included.' }), wrap);
  }

  function budgetItem(v, adults, children) {
    var p = v.pricing;
    var lines = [], excluded = [];
    var figure;
    var adultKnown = p.adult !== null;
    var childKnown = p.child !== null;
    if (!adultKnown && adults > 0) {
      figure = unknownText('No estimate — adult price not published');
    } else {
      var adultSub = adultKnown ? adults * p.adult : 0;
      if (adults > 0) lines.push(adults + ' × ' + money(p.adult) + ' adult = ' + money(adultSub));
      var complete = true;
      var childSub = 0;
      if (children > 0) {
        if (childKnown) { childSub = children * p.child; lines.push(children + ' × ' + money(p.child) + ' child' + (p.childAgeBand ? ' (' + p.childAgeBand + ')' : ' (age band not published)') + ' = ' + money(childSub)); }
        else { complete = false; excluded.push('Child price not published — children are not included in this figure.'); }
      }
      var label = complete && children > 0 ? 'Known meal subtotal (adults + children)' : (children > 0 ? 'Known adult subtotal only' : 'Known adult subtotal');
      var sub = adultSub + childSub;
      figure = h('span', null, h('span', { class: 'budget-figure', text: money(sub) }), ' — ' + label);
      var sc = p.serviceCharge;
      if (sc.status === 'extra' && typeof sc.rate === 'number') {
        lines.push('Plus ' + sc.rate + '% service charge if applied: about ' + money(Math.round(sub * sc.rate) / 100) + ' on this subtotal (' + (sc.note || 'added to the bill') + ')');
      } else if (sc.status === 'unknown') {
        excluded.push('Service charge unknown — not included.');
      }
    }
    if (p.otherPrices && p.otherPrices.length) p.otherPrices.forEach(function (o) { excluded.push('Not included: ' + o.label + (typeof o.amount === 'number' ? ' (' + money(o.amount) + ')' : '')); });
    if (p.supplements) excluded.push('Supplements: ' + p.supplements);
    excluded.push('Drinks not included unless listed: ' + (p.includes && p.includes.length ? p.includes.join('; ') : 'inclusions not published') + '.');
    if (v.terms && v.terms.deposit) lines.push('Deposit: ' + v.terms.deposit);
    return h('div', { class: 'budget-item' },
      h('h4', null, h('a', { href: '#card-' + v.id, text: v.name })),
      h('div', null, figure),
      h('ul', null, lines.map(function (l) { return h('li', { text: l }); }), excluded.map(function (l) { return h('li', { text: l }); })),
      h('p', { class: 'small muted', text: 'Estimate excludes unconfirmed charges. Reconfirm the total with the venue.' }));
  }

  /* ---------- Travel ---------- */
  function renderTravel() {
    var host = $('travel-view');
    clear(host);
    var t = data.travel;
    if (!t || !Array.isArray(t.items)) { append(host, h('p', { class: 'unknown', text: 'No travel research in the data file.' })); return; }
    var statusLabel = { 'published-2026': 'Published 2026 arrangement (official source)', 'awaiting-confirmation': 'Awaiting official 2026 confirmation', 'venue-statement': 'Venue statement (not an official transport source)' };
    t.items.forEach(function (it) {
      append(host, h('div', { class: 'travel-item ' + (statusLabel[it.status] ? it.status : '') },
        h('h3', { text: it.title }),
        h('p', null, h('span', { class: 'tag', text: statusLabel[it.status] || 'Status unknown' })),
        h('p', { text: it.detail }),
        it.source ? h('p', { class: 'small' }, 'Source: ', safeUrl(it.source.url) ? h('a', { href: it.source.url, target: '_blank', rel: 'noopener noreferrer', text: it.source.title || it.source.url }) : (it.source.title || ''), it.source.checked ? ' — checked ' + fmtDate(it.source.checked) : '') : null));
    });
    if (Array.isArray(t.implications) && t.implications.length) {
      append(host, h('h3', { text: 'What this means if we are in Windsor without a car' }), h('ul', null, t.implications.map(function (x) { return h('li', { text: x }); })));
    }
    append(host, h('p', { class: 'small muted', text: 'Each venue card has a Directions link (opens Google Maps in a new tab). Directions apps show ordinary timetables and traffic — they are not verified for Christmas Day.' }));
  }

  /* ---------- Enquiry ---------- */
  function populateEnquiryVenues() {
    var sel = $('e-venue');
    var keep = sel.value;
    clear(sel);
    append(sel, h('option', { value: '', text: '— General (no venue selected) —' }));
    var grpC = h('optgroup', { label: 'Confirmed for 2026' }), grpU = h('optgroup', { label: 'Worth contacting' });
    venues.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (v) {
      append(isConfirmed(v) ? grpC : grpU, h('option', { value: v.id, text: v.name }));
    });
    append(sel, grpC, grpU);
    sel.value = keep && byId[keep] ? keep : '';
  }
  function bindEnquiry() {
    var sel = $('e-venue');
    sel.addEventListener('change', function () { renderEnquiry(); });
    $('e-party').addEventListener('input', function () { renderEnquiry(); });
    $('e-copy').addEventListener('click', copyEnquiry);
  }
  function partyPhrase() {
    var typed = $('e-party').value.trim();
    if (typed) return typed;
    var a = state.party.adults, c = state.party.children;
    if (a === null && !c) return '[party details]';
    var parts = [];
    if (a !== null) parts.push(a + (a === 1 ? ' adult' : ' adults'));
    if (c) parts.push(c + (c === 1 ? ' child' : ' children') + ' (ages: [please add])');
    return parts.join(' and ');
  }
  function renderEnquiry() {
    var id = $('e-venue').value;
    var v = id ? byId[id] : null;
    var greeting = v ? 'Dear ' + v.name + ' team,' : 'Hello,';
    var body = "We're relocating to the UK on December 22 and expect to be staying in Windsor. " +
      'Do you have availability for nonresident guests for Christmas Day lunch or dinner on December 25, 2026, for ' + partyPhrase() + '? ' +
      'Please could you confirm sitting times, the menu, total cost including service charge, deposit/payment requirements, cancellation terms and any preorder deadline?';
    $('e-text').value = greeting + '\n\n' + body + '\n\nThank you very much,\n[Your name]';
    var ci = $('e-contact');
    clear(ci);
    if (v) {
      var c = v.contact || {};
      append(ci, h('p', null, h('strong', { text: 'Published contact routes: ' }),
        c.email ? h('a', { href: 'mailto:' + c.email, text: c.email }) : null, c.email && c.phone ? ' · ' : '',
        c.phone ? h('a', { href: 'tel:' + c.phone.replace(/[^0-9+]/g, ''), text: c.phone }) : null,
        !c.email && !c.phone ? unknownText('No phone or email captured — use the venue\'s website or booking page.') : null,
        (v.links && (v.links.booking || v.links.christmas)) ? [' · ', extLink(v.links.booking || v.links.christmas, 'Booking/enquiry page', '')] : null));
    }
  }
  function copyEnquiry() {
    var text = $('e-text').value;
    var status = $('e-status');
    function fallback() {
      var ta = $('e-text');
      ta.removeAttribute('readonly'); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.setAttribute('readonly', '');
      status.textContent = ok ? 'Copied. Nothing has been sent.' : 'Copy failed — select the text above and copy it manually.';
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { status.textContent = 'Copied to clipboard. Nothing has been sent.'; }, fallback);
    } else fallback();
  }

  /* ---------- Shortlist, export/import, print ---------- */
  function bindShortlist() {
    $('s-export').addEventListener('click', exportShortlist);
    $('s-import').addEventListener('change', importShortlist);
    $('s-print').addEventListener('click', printShortlist);
  }
  function shortlistIds() {
    var ids = state.favorites.slice();
    Object.keys(state.notes).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    return ids;
  }
  function renderShortlist() {
    var host = $('shortlist-view');
    clear(host);
    var ids = shortlistIds();
    if (!ids.length) { append(host, h('p', { class: 'muted small', text: 'No favourites or notes yet. Use "Save" on a venue card, or add a note under "My notes".' })); return; }
    append(host, h('ul', { class: 'shortlist-list' }, ids.map(function (id) {
      var v = byId[id];
      return h('li', null,
        v ? h('a', { href: '#card-' + id, text: v.name }) : h('span', { text: id + ' (no longer in the venue data)' }),
        state.favorites.indexOf(id) >= 0 ? h('span', { class: 'small', text: ' ★ favourite' }) : null,
        v ? h('span', { class: 'small muted', text: ' · ' + LABELS.area[v.area] + ' · ' + (v.pricing.adult !== null ? money(v.pricing.adult) + ' per adult' : 'price unknown') }) : null,
        state.notes[id] ? h('div', { class: 'note-preview', text: state.notes[id] }) : null);
    })));
  }
  function exportShortlist() {
    var payload = {
      format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(),
      favorites: state.favorites.slice(), notes: Object.assign({}, state.notes), compare: state.compare.slice(),
      party: { adults: state.party.adults, children: state.party.children }
    };
    try {
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = h('a', { href: url, download: 'christmas-2026-shortlist.json' });
      // object URLs are blob: — set directly (safeUrl only allows http/https/tel/mailto)
      a.setAttribute('href', url);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      $('s-status').textContent = 'Exported ' + state.favorites.length + ' favourite(s) and ' + Object.keys(state.notes).length + ' note(s) to christmas-2026-shortlist.json.';
    } catch (e) {
      $('s-status').textContent = 'Export failed: ' + e.message;
    }
  }
  function importShortlist(e) {
    var file = e.target.files && e.target.files[0];
    var status = $('s-status');
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) { status.textContent = 'Import failed: the file is larger than 1 MB, so it is probably not a shortlist export.'; return; }
    var reader = new FileReader();
    reader.onerror = function () { status.textContent = 'Import failed: the file could not be read.'; };
    reader.onload = function () {
      var result = parseImport(String(reader.result));
      if (result.error) { status.textContent = 'Import failed: ' + result.error; return; }
      state = result.state;
      saveState();
      $('p-adults').value = state.party.adults !== null ? state.party.adults : '';
      $('p-children').value = state.party.children !== null ? state.party.children : '';
      rerenderKeepingFocus();
      var msg = 'Imported ' + state.favorites.length + ' favourite(s) and ' + Object.keys(state.notes).length + ' note(s). This replaced the shortlist previously stored in this browser.';
      if (result.warnings.length) msg += ' Warnings: ' + result.warnings.join(' ');
      status.textContent = msg;
    };
    reader.readAsText(file);
  }
  function parseImport(text) {
    var obj;
    try { obj = JSON.parse(text); } catch (e) { return { error: 'the file is not valid JSON.' }; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { error: 'expected a JSON object exported from this page.' };
    if (obj.format !== EXPORT_FORMAT) return { error: 'this does not look like a shortlist exported from this page (missing "format": "' + EXPORT_FORMAT + '").' };
    if (obj.version !== 1) return { error: 'unsupported export version "' + String(obj.version) + '".' };
    if (obj.favorites !== undefined && !Array.isArray(obj.favorites)) return { error: '"favorites" must be a list.' };
    if (obj.notes !== undefined && (typeof obj.notes !== 'object' || obj.notes === null || Array.isArray(obj.notes))) return { error: '"notes" must be an object of venue id → text.' };
    var s = sanitizeState(obj);
    var unknown = s.state.favorites.concat(Object.keys(s.state.notes)).filter(function (id, i, arr) { return !byId[id] && arr.indexOf(id) === i; });
    if (unknown.length) s.warnings.push(unknown.length + ' item(s) refer to venues not in the current data (kept, shown as "no longer in the venue data").');
    var droppedFav = (obj.favorites || []).length - s.state.favorites.length;
    if (droppedFav > 0) s.warnings.push(droppedFav + ' invalid or duplicate favourite id(s) were ignored.');
    s.state.compare = s.state.compare.filter(function (id) { return byId[id]; });
    return { state: s.state, warnings: s.warnings };
  }
  function printShortlist() {
    var host = $('print-shortlist');
    clear(host);
    var ids = shortlistIds();
    append(host, h('h1', { text: 'Christmas Day 2026 — our shortlist' }),
      h('p', { text: 'Printed ' + fmtDateTime(new Date().toISOString()) + '. Research snapshot: ' + (fmtDateTime(data.meta.researchedAt) || 'unknown') + '. Prices and availability may change — reconfirm with each venue.' }));
    if (!ids.length) append(host, h('p', { text: 'No favourites or notes saved in this browser.' }));
    ids.forEach(function (id) {
      var v = byId[id];
      if (!v) { append(host, h('div', { class: 'p-venue' }, h('h2', { text: id + ' (not in current data)' }), state.notes[id] ? h('div', { class: 'note-preview', text: 'My note: ' + state.notes[id] }) : null)); return; }
      var p = v.pricing, L = v.links || {}, c = v.contact || {};
      append(host, h('div', { class: 'p-venue' },
        h('h2', { text: v.name }),
        h('p', { text: (isConfirmed(v) ? 'Christmas Day 2026 CONFIRMED' : 'NOT CONFIRMED for 2026 — worth contacting') + ' · ' + ({ 'verified': 'Availability verified', 'booking-route-open': 'Booking route open, tables not checked', 'sold-out': 'Sold out', 'unknown': 'Availability unknown' })[v.availability.status] }),
        h('p', { text: LABELS.category[v.category] + ' · ' + LABELS.area[v.area] + ' · ' + (v.address || 'address not captured') }),
        h('p', { text: 'Adult: ' + (p.adult !== null ? money(p.adult) : 'unknown') + ' · Child: ' + (p.child !== null ? money(p.child) + (p.childAgeBand ? ' (' + p.childAgeBand + ')' : '') : 'unknown') + ' · Service: ' + LABELS.service[p.serviceCharge.status] + (p.serviceCharge.rate ? ' ' + p.serviceCharge.rate + '%' : '') }),
        h('p', { text: 'Times: ' + (v.meals.sittings && v.meals.sittings.length ? v.meals.sittings.join(', ') : 'not published') + (v.meals.note ? ' — ' + v.meals.note : '') }),
        v.terms.deposit || v.terms.paymentDeadline ? h('p', { text: 'Terms: ' + [v.terms.deposit, v.terms.paymentDeadline, v.terms.preorder, v.terms.cancellation].filter(Boolean).join(' | ') }) : null,
        c.phone || c.email ? h('p', { text: 'Contact: ' + [c.phone, c.email].filter(Boolean).join(' · ') }) : null,
        L.christmas ? h('p', { class: 'p-url', text: 'Christmas page: ' + L.christmas }) : null,
        L.booking ? h('p', { class: 'p-url', text: 'Booking: ' + L.booking }) : null,
        h('div', { class: 'p-url' }, h('strong', { text: 'Sources:' }), h('ul', null, (v.sources || []).map(function (s) { return h('li', { text: (s.title || '') + ' — ' + s.url + (s.checked ? ' (checked ' + s.checked + ')' : '') }); }))),
        state.notes[id] ? h('div', { class: 'note-preview', text: 'My note: ' + state.notes[id] }) : null));
    });
    document.body.classList.add('printing-shortlist');
    window.print();
    // Safari may not fire afterprint reliably
    setTimeout(function () { document.body.classList.remove('printing-shortlist'); }, 1000);
  }

  // Expose pure helpers for automated tests (no side effects).
  window.__xmasPlanner = { parseImport: function (t) { return parseImport(t); }, sanitizeState: sanitizeState, validateVenue: validateVenue };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
