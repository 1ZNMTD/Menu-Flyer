// Google Apps Script の最小限のモック（統合テスト用）
import { loadGas } from './load.mjs';

const ALL = ['Util.js', 'Extract.js', 'Config.js', 'Store.js', 'Gemini.js', 'Gmail.js', 'Api.js', 'Jobs.js', 'Setup.js'];

function fmt(date, tz, pattern) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  return pattern.replace('yyyy', parts.year).replace('yy', parts.year.slice(2)).replace('MM', parts.month)
    .replace('dd', parts.day).replace('HH', parts.hour).replace('mm', parts.minute).replace('ss', parts.second);
}

class Sheet {
  constructor(name) { this.name = name; this.data = []; this.maxRows = 1000; this.maxCols = 26; }
  getName() { return this.name; }
  getLastRow() { return this.data.length; }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, r.length), 0); }
  getMaxRows() { return Math.max(this.maxRows, this.data.length); }
  getMaxColumns() { return this.maxCols; }
  setFrozenRows() {} setColumnWidth() {}
  cell(r, c) { return (this.data[r - 1] || [])[c - 1] ?? ''; }
  put(r, c, v) {
    while (this.data.length < r) this.data.push([]);
    const row = this.data[r - 1];
    while (row.length < c) row.push('');
    // Sheets は先頭 ' を「文字列として扱う印」として保存しない
    row[c - 1] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v;
  }
  getRange(r, c, nr = 1, nc = 1) {
    const sh = this;
    const range = {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => sh.cell(r + i, c + j))),
      getValue: () => sh.cell(r, c),
      setValues: (vals) => { vals.forEach((row, i) => row.forEach((v, j) => sh.put(r + i, c + j, v))); return range; },
      setValue: (v) => { sh.put(r, c, v); return range; },
      setFontWeight: () => range, setBackground: () => range, setNumberFormat: () => range, setDataValidation: () => range,
    };
    return range;
  }
  appendRow(row) { this.data.push(row.map((v) => (typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v))); }
  deleteRow(r) { this.data.splice(r - 1, 1); }
  deleteRows(r, n) { this.data.splice(r - 1, n); }
}

class Spreadsheet {
  constructor(id) { this.id = id; this.sheets = [new Sheet('シート1')]; }
  getId() { return this.id; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets; }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
}

export function makeGas({ me = 'me@gmail.com', now = new Date('2026-10-13T09:00:00+09:00'), messages = [], fetch = null } = {}) {
  const props = {};
  const books = {};
  const triggers = [];
  const labels = new Set();
  const sent = [];
  const fetched = [];
  let clock = now.getTime();

  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [clock])); }
    static now() { return clock; }
  }

  const env = {
    Date: FakeDate,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        deleteProperty: (k) => { delete props[k]; },
        getProperties: () => ({ ...props }),
        getKeys: () => Object.keys(props),
      }),
    },
    Session: {
      getEffectiveUser: () => ({ getEmail: () => me }),
      getActiveUser: () => ({ getEmail: () => env._activeUser ?? me }),
    },
    Utilities: {
      formatDate: (d, tz, p) => fmt(d, tz, p),
      getUuid: () => Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: {
      create: (name) => { const id = 'ss' + Object.keys(books).length; books[id] = new Spreadsheet(id); return books[id]; },
      openById: (id) => { if (!books[id]) throw new Error('no ss'); return books[id]; },
      newDataValidation: () => { const b = { requireValueInList: () => b, setAllowInvalid: () => b, build: () => ({}) }; return b; },
    },
    GmailApp: {
      search: (q) => {
        env._lastQuery = q;
        const m = /after:(\d+)/.exec(q);
        const after = m ? +m[1] * 1000 : 0;
        const threads = {};
        messages.filter((x) => x.date.getTime() >= after).forEach((x) => {
          (threads[x.thread] ||= []).push(x);
        });
        return Object.values(threads).map((ms) => ({
          getMessages: () => ms.map((x) => ({
            getId: () => x.id, getSubject: () => x.subject, getPlainBody: () => x.body, getFrom: () => x.from,
            getTo: () => x.to || me, getCc: () => '', getBcc: () => '', getDate: () => x.date, isInTrash: () => false,
          })),
          addLabel: () => {},
        }));
      },
      getUserLabelByName: (n) => (labels.has(n) ? { name: n } : null),
      createLabel: (n) => { labels.add(n); return { name: n }; },
    },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
      newTrigger: (fn) => {
        const b = { timeBased: () => b, everyMinutes: () => b, atHour: () => b, everyDays: () => b, inTimezone: () => b, onWeekDay: () => b,
          create: () => { const t = { getHandlerFunction: () => fn }; triggers.push(t); return t; } };
        return b;
      },
      WeekDay: { SUNDAY: 'SUNDAY' },
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/xxx/exec' }),
    },
    MailApp: { sendEmail: (o) => sent.push(o) },
    UrlFetchApp: {
      fetch: (url, opt) => { fetched.push({ url, opt }); if (!fetch) throw new Error('no fetch'); return fetch(url, opt); },
    },
    HtmlService: {},
  };
  const g = loadGas(ALL, env);
  return { g, env, props, books, triggers, labels, sent, fetched, messages, advance: (ms) => { clock += ms; } };
}
