/**
 * Api.js — Web アプリ（画面）と、画面から呼ばれるサーバー関数
 * すべての api* 関数の先頭で assertAllowed_() により利用者を確認する（多重防御）。
 */

function doGet() {
  assertAllowed_();
  if (cfg_().ROLE === 'collector') {
    return HtmlService.createHtmlOutput('この環境は取込専用（collector）です。メインのアカウントの画面を使ってください。');
  }
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('TaskHub')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT); // 他サイトへの埋め込み（クリックジャッキング）を禁止
}

function assertAllowed_() {
  var c = cfg_();
  // 環境によりログイン中アカウントが取得できない場合の逃げ道（デプロイの「自分のみ」が前提）
  if (props_().getProperty('SKIP_USER_CHECK') === 'true') return;
  var active = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  var allowed = String(c.ALLOWED_EMAILS || c.ME).toLowerCase().split(/[,\s]+/).filter(String);
  if (!active || allowed.indexOf(active) < 0) throw new Error('アクセス権がありません');
}

function apiBootstrap() {
  assertAllowed_();
  var c = cfg_();
  var stat = null;
  try { stat = JSON.parse(props_().getProperty('LAST_GMAIL_STAT') || 'null'); } catch (e) { stat = null; }
  return {
    tasks: listTasks_(),
    today: ymdToStr_(todayYmd_()),
    me: c.ME,
    plus: plusAddress_(c.ME, 'task'),
    aiMode: aiEnabled_(c) ? 'gemini' : 'rules',
    lastIngest: stat,
    errors: recentErrors_(24).slice(-5),
    version: TH_VERSION
  };
}

/** クイック追加: 「見積作成 @金曜 !高 #案件A」形式の1行 */
function apiQuickAdd(line) {
  assertAllowed_();
  var text = String(line || '').trim();
  if (!text) throw new Error('入力が空です');
  var parsed = parseBulletTasks_('- ' + text.replace(/^\s*[-・]\s*/, ''), todayYmd_())[0];
  if (!parsed) throw new Error('解析できませんでした');
  var v = validateTaskInput_(parsed);
  v.status = '未着手';
  v.source = '手入力';
  return appendTasks_([v])[0];
}

function apiCreate(input) {
  assertAllowed_();
  var v = validateTaskInput_(input || {});
  v.status = v.status || '未着手';
  v.source = v.source || '手入力';
  return appendTasks_([v])[0];
}

function apiCreateMany(list, status) {
  assertAllowed_();
  if (Object.prototype.toString.call(list) !== '[object Array]') throw new Error('不正な入力です');
  if (list.length > 50) throw new Error('一度に登録できるのは50件までです');
  var st = status === '未整理' ? '未整理' : '未着手';
  var recs = list.map(function (x) {
    var v = validateTaskInput_(x);
    v.status = st;
    v.source = v.source || 'その他';
    return v;
  });
  return appendTasks_(recs);
}

function apiUpdate(id, patch) {
  assertAllowed_();
  var v = validateTaskInput_(patch || {}, true);
  // 出典リンク・出典キーは画面から変更させない
  delete v.sourceUrl;
  return updateTask_(String(id), v);
}

/** 貼り付けテキスト → 候補（保存はしない。画面で確認後 apiCreateMany） */
function apiParseText(text, source) {
  assertAllowed_();
  var s = String(text || '');
  if (!s.trim()) throw new Error('テキストが空です');
  if (s.length > 30000) throw new Error('長すぎます（3万字まで）。分けて貼り付けてください');
  var src = TH_SOURCE.indexOf(source) >= 0 ? source : 'その他';
  var today = todayYmd_();
  var list = parseBulletTasks_(s, today);
  var method = 'rules';
  if (!list.length) {
    var ai = geminiExtract_(src === 'メモ' ? 'メモ' : 'AIとの会話・文章', s);
    if (ai && ai.length) { list = ai; method = 'gemini'; }
  }
  if (!list.length) {
    // 箇条書きでも AI でも取れない場合は1件の候補にする
    var first = firstLine_(s);
    list = [{ title: clip_(first, 200), detail: clip_(s, 3000), due: parseDue_(s, today), priority: detectPriority_(s), tags: '', requester: '' }];
  }
  return { method: method, tasks: list.slice(0, 50).map(function (t) { t.source = src; return t; }) };
}

function apiIngestNow() {
  assertAllowed_();
  return runIngestOnce_();
}
