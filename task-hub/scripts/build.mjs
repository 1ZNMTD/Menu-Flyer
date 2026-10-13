// src/ の .js を1つの Code.gs にまとめ、dist/ に出力する（手作業でのコピー＆貼り付けを2ファイルで済ませるため）
// 使い方: node scripts/build.mjs        … dist/ を生成
//         node scripts/build.mjs --check … dist/ が最新か確認（CI 用）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
const ORDER = ['Config.js', 'Util.js', 'Extract.js', 'Store.js', 'Gemini.js', 'Gmail.js', 'Api.js', 'Jobs.js', 'Setup.js'];

const jsFiles = fs.readdirSync(src).filter((f) => f.endsWith('.js'));
const missing = jsFiles.filter((f) => !ORDER.includes(f));
if (missing.length) throw new Error('ORDER に未登録のファイル: ' + missing.join(', '));

const header = "/**\n * TaskHub — 自動生成ファイル。編集は src/ で行い npm run build で再生成する\n */\n";
const out = {
  'Code.gs': header + ORDER.map((f) => `\n// ===== ${f} =====\n` + fs.readFileSync(path.join(src, f), 'utf8')).join(''),
  'Index.html': fs.readFileSync(path.join(src, 'Index.html'), 'utf8'),
  'appsscript.json': fs.readFileSync(path.join(src, 'appsscript.json'), 'utf8'),
};

if (process.argv.includes('--check')) {
  const stale = Object.entries(out).filter(([f, c]) => !fs.existsSync(path.join(dist, f)) || fs.readFileSync(path.join(dist, f), 'utf8') !== c);
  if (stale.length) {
    console.error('dist/ が古いです。`npm run build` を実行してコミットしてください: ' + stale.map(([f]) => f).join(', '));
    process.exit(1);
  }
  console.log('dist/ は最新です');
} else {
  fs.mkdirSync(dist, { recursive: true });
  for (const [f, c] of Object.entries(out)) fs.writeFileSync(path.join(dist, f), c);
  console.log('dist/ を生成しました: ' + Object.keys(out).join(', '));
}
