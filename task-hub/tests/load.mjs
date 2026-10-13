// GAS 用ソース（グローバル関数群）を Node の vm に読み込むヘルパー
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export function loadGas(files = ['Util.js', 'Extract.js'], extra = {}) {
  const ctx = vm.createContext({ console, ...extra });
  for (const f of files) {
    const code = fs.readFileSync(path.join(here, '..', 'src', f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  }
  return ctx;
}
