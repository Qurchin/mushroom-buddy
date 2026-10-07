#!/usr/bin/env node
// Claude Buddy (DIY) — Haiku / 規則版 prompt 評分 + token 香菇狀態列
//
//   node buddy.js rate     UserPromptSubmit hook：評分 prompt、更新心情與數值
//   node buddy.js status   statusLine：顯示 buddy 表情 + 一排香菇
//   node buddy.js card     印出角色卡
//   node buddy.js mode [haiku|rules]  切換評分模式（預設 haiku）
//   node buddy.js judge <job>         （內部用）背景呼叫 Haiku 評分
//   node buddy.js reset    重置狀態（物種不變，由帳號決定）
//
// 環境變數：BUDDY_ASCII=1 改用純 ASCII 香菇（emoji 跑版時用）

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const STATE_DIR = path.join(os.homedir(), '.claude', 'buddy');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const ASCII = process.env.BUDDY_ASCII === '1';

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m',
};

// ---------- 角色生成（依帳號固定） ----------

const SPECIES = ['鴨鴨', '鵝', '貓咪', '兔兔', '貓頭鷹', '企鵝', '烏龜', '蝸牛', '小龍',
  '章魚', '六角恐龍', '幽靈', '機器人', '史萊姆', '仙人掌', '香菇', '胖胖', '水豚'];
const NAMES = ['小咪', '阿菇', '噗噗', '麻糬', '布丁', '豆花', '湯圓', '芋圓', '小籠包', '珍奶',
  '饅頭', '鳳梨酥', '雞蛋糕', '地瓜球', '蔥抓餅', '肉圓'];
const RARITIES = [
  { name: 'Common', p: 60, color: C.gray, floor: 5 },
  { name: 'Uncommon', p: 25, color: C.green, floor: 15 },
  { name: 'Rare', p: 10, color: C.cyan, floor: 25 },
  { name: 'Epic', p: 4, color: C.magenta, floor: 35 },
  { name: 'Legendary', p: 1, color: C.yellow, floor: 50 },
];
const HATS = ['', '👑', '🎩', '🧢', '😇', '🧙'];

function seedBytes() {
  const id = `${os.userInfo().username}@${os.hostname()}`;
  return crypto.createHash('sha256').update(id).digest();
}

function makeIdentity() {
  const b = seedBytes();
  const roll = b[2] % 100;
  let acc = 0;
  let rarity = RARITIES[0];
  for (const r of RARITIES) { acc += r.p; if (roll < acc) { rarity = r; break; } }
  const stat = (i) => rarity.floor + (b[10 + i] % (101 - rarity.floor)) * 0.3 | 0;
  return {
    species: SPECIES[b[0] % SPECIES.length],
    name: NAMES[b[1] % NAMES.length],
    rarity: rarity.name,
    shiny: b[3] % 100 === 0,
    hat: rarity.name === 'Common' ? '' : HATS[b[4] % HATS.length],
    stats: { DEBUGGING: stat(0), PATIENCE: stat(1), CHAOS: stat(2), WISDOM: stat(3), SNARK: stat(4) },
  };
}

// ---------- 狀態存取 ----------

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { ...makeIdentity(), xp: 0, prompts: 0, scoreSum: 0, last: null };
  }
}

function saveState(s) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

// ---------- 規則評分 ----------

const FACES = {
  5: ['(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧', '(★ω★)', '٩(◕‿◕)۶'],
  4: ['(｡•̀ᴗ-)✧', '(・∀・)b', '(＾▽＾)'],
  3: ['(・_・)', '(・ω・)', '( ˘ω˘ )'],
  2: ['(；´Д`)', '(¬_¬)', '(・_・;)'],
  1: ['(╯°□°)╯︵ ┻━┻', '(ノಠ益ಠ)ノ', '(ಥ﹏ಥ)'],
  chat: ['(｡･ω･｡)ﾉ', '(・ω<)', '(^_^)/'],
  idle: ['(・ω・)', '( ˘ω˘ )', '(・ᴗ・)'],
  sleep: ['( ˘ω˘ )zzZ'],
  panic: ['(°ロ°)!!', '(⊙_⊙;)'],
};

const COMMENTS = {
  5: ['完美的需求描述！', '這 prompt 可以裱框了', '清楚又具體，讚啦'],
  4: ['不錯喔，很好懂', '有重點，Claude 會很開心', '寫得挺好的～'],
  3: ['還行，可以再具體一點', '嗯…普普通通', '加個檔名或預期結果會更好'],
  2: ['你是要我通靈嗎…', '資訊有點少耶', '要修哪裡？什麼壞了？'],
  1: ['……？？？', '這樣誰看得懂啦', '至少說一下發生什麼事吧'],
  chat: ['收到～', '好喔！', '嗯嗯 (點頭)'],
};

const pick = (arr, n) => arr[n % arr.length];

function scorePrompt(text) {
  const t = text.trim();
  const len = [...t].length;
  const reasons = [];

  // 短的確認句（「好啊」「ok 繼續」）是對話，不評分
  if (len <= 15 && /^(好|ok|okay|yes|yep|對|可以|繼續|謝|感謝|thx|thanks|沒問題|go|嗯|是的|收到)/i.test(t)) {
    return { score: null, kind: 'chat', reasons: ['對話回應'] };
  }

  let s = 3;

  if (len < 8) { s -= 1.5; reasons.push('太短'); }
  else if (len < 20) { s -= 0.5; reasons.push('偏短'); }
  else if (len > 60) { s += 0.5; reasons.push('有描述'); }
  if (len > 200) s += 0.5;

  let specific = 0;
  if (/[\w-]+\.(js|ts|tsx|jsx|py|go|rs|java|cs|cpp|c|h|rb|php|json|ya?ml|md|html|css|sql|sh|ps1)\b/i.test(t)) specific++;
  if (/(^|\s)(\.{0,2}[\/\\][\w.\-\/\\]+|[A-Za-z]:\\)/.test(t)) specific++;
  if (/`[^`]+`|```/.test(t)) specific++;
  if (/(第\s*\d+\s*行|line\s*\d+|:\d+\b)/i.test(t)) specific++;
  if (/(error|exception|traceback|錯誤訊息|報錯|stack|undefined|null|failed|status\s*\d{3})/i.test(t)) specific++;
  if (specific) { s += Math.min(specific, 2); reasons.push('具體(檔案/錯誤/程式碼)'); }

  if (/(應該|希望|預期|期望|想要|目標|結果要|輸出|expected|should|so that|goal)/i.test(t)) { s += 0.5; reasons.push('有說預期結果'); }
  if (/(因為|但是|不要|只要|限制|不能|必須|條件|because|without|don't|must|only)/i.test(t)) { s += 0.5; reasons.push('有給限制/脈絡'); }

  const vague = /^(幫我)?(修|修好|弄|弄一下|處理|看一下|改一下|fix|fix it|help)[\s!！。.?？]*$/i.test(t)
    || (/(快點|趕快|壞了|不行|爛|改好|修好|修一下|asap)/i.test(t) && len < 25);
  if (vague) { s -= 1.5; reasons.push('太模糊'); }
  if (/[!！?？]{3,}/.test(t)) { s -= 0.5; reasons.push('情緒有點激動'); }

  if (/(請|拜託|謝謝|麻煩|please|thanks|thank you)/i.test(t)) { s += 0.25; reasons.push('有禮貌'); }

  const score = Math.max(1, Math.min(5, Math.round(s)));
  return { score, kind: 'rated', reasons, specific, vague };
}

// ---------- 香菇田（每個 session 各一塊） ----------

const FIELD_FILE = path.join(STATE_DIR, 'field.json');
const SLOTS = 20;

function loadField() {
  try { return JSON.parse(fs.readFileSync(FIELD_FILE, 'utf8')); } catch { return {}; }
}

function saveField(f) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = FIELD_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(f));
  fs.renameSync(tmp, FIELD_FILE);
}

// ---------- 互動：整句完全符合才攔截，不送給 Claude、不花 token ----------

const HAT_UNLOCKS = [[10, '🌸'], [30, '🎀'], [60, '🎩'], [100, '👑']];

const POKE = [
  [2, ['(・ω・)?', '嗯？叫我嗎'], ['(・ω・)?', '幹嘛～']],
  [4, ['(・`ω´・)', '不要一直戳啦'], ['(¬_¬)', '…你很閒喔']],
  [7, ['(｀へ´)', '我要生氣囉！'], ['(＃`Д´)', '再戳就咬你']],
  [Infinity, ['(╬ Ò﹏Ó)', '……（裝死）'], ['(ノಠ益ಠ)ノ', '戳屁戳！去寫 code！']],
];

function interact(prompt, input, st) {
  const t = prompt.trim().replace(/[!！~～。.]+$/, '').toLowerCase();
  const is = (...words) => words.includes(t);
  const name = st.name.toLowerCase();
  const now = Date.now();
  const bump = (k, d) => { st.stats[k] = Math.max(0, Math.min(100, st.stats[k] + d)); };
  const say = (face, comment, extra = []) => {
    st.last = { id: `i-${now}`, at: now, face, comment, kind: 'interact' };
    saveState(st);
    return [`${face} ${st.name}：${comment}`, ...extra].join('\n');
  };

  if (is('戳', '戳戳', 'poke', `戳${name}`)) {
    const p = st.poke && now - st.poke.at < 60e3 ? st.poke.count + 1 : 1;
    st.poke = { count: p, at: now };
    const asleep = st.last && now - st.last.at > 15 * 60e3;
    if (asleep) return say('(｡-ω-)zzz', '…嗯？我剛剛在睡覺耶');
    const [face, line] = POKE.find(([max]) => p <= max).slice(1)[p % 2];
    if (p === 10) bump('CHAOS', 1);
    return say(face, `${line}${p >= 3 ? `（被戳 ${p} 次）` : ''}`);
  }

  if (is('摸摸', '摸', 'pet', `摸摸${name}`, `摸${name}`)) {
    st.poke = null; // 摸一摸就消氣了
    if (!st.petAt || now - st.petAt > 10 * 60e3) bump('PATIENCE', 1);
    st.petAt = now;
    return say('(´,,•ω•,,)♡', pick(['好舒服～', '再摸一下嘛', '呼嚕呼嚕…'], now), [
      '      ♡   ♡',
      '    ♡  ♡    ♡',
      '   (´,,•ω•,,)♡',
    ]);
  }

  if (is('餵', '餵食', 'feed', `餵${name}`)) {
    st.fed = (st.fed || []).filter((x) => now - x < 30 * 60e3);
    if (st.fed.length >= 4) return say('(´～`)', '吃不下了…讓我消化一下');
    const foods = require('./foods');
    const food = foods[(now + st.fed.length) % foods.length];
    st.fed.push(now);
    st.xp += 2;
    return say('(っ˘ڡ˘ς)', `${food.emoji} ${food.name}！${food.line}`, ['', ...food.art, '', `  （XP +2，${st.name}吃了 ${st.fed.length}/4 份）`]);
  }

  if (is('拔香菇', '採香菇', '收成', 'harvest')) {
    const field = loadField();
    const f = field[input.session_id];
    if (!f) return say('(・_・?)', '田還沒長出來耶，等狀態列出現再來');
    const per = f.size / SLOTS;
    const n = Math.floor((f.used - f.base) / per);
    if (n <= 0) return say('(・ω・)', '還沒長好啦，再等等～');
    f.base += n * per; // 保留還沒長完的那一格
    saveField(field);
    st.basket = (st.basket || 0) + n;
    st.xp += n;
    const extra = [`  🧺 收成 ${n} 朵香菇！背包共 ${st.basket} 朵（XP +${n}）`];
    for (const [need, hat] of HAT_UNLOCKS) {
      if (st.basket >= need && st.basket - n < need) { st.hat = hat; extra.push(`  ✨ 解鎖新帽子 ${hat}！`); }
    }
    if (f.used / f.size > 0.8) extra.push('  ⚠ 不過真正的 context 還是快滿了，記得 /compact');
    return say('٩(◕‿◕)۶', pick(['大豐收！', '嘿咻嘿咻～', '今晚吃香菇大餐'], now), extra);
  }

  if (is(name, '角色卡', 'card')) {
    saveState(st);
    return cardText(st, false);
  }

  return null;
}

// ---------- 子命令 ----------

// 把評分結果寫進狀態：表情、評語、XP、數值成長
// r = { score: 1-5 | null(對話), comment?, reasons, specific?, vague?, by: 'haiku'|'rules' }
function applyResult(st, r, id) {
  const n = st.prompts;
  let face, comment;
  if (!r.score) {
    face = pick(FACES.chat, n);
    comment = r.comment || pick(COMMENTS.chat, n);
    st.xp += 1;
  } else {
    face = pick(FACES[r.score], n);
    comment = r.comment || pick(COMMENTS[r.score], n);
    st.xp += r.score;
    st.scoreSum += r.score;
    st.rated = (st.rated || 0) + 1;
    const bump = (k, d) => { st.stats[k] = Math.max(0, Math.min(100, st.stats[k] + d)); };
    if (r.score >= 4) bump('WISDOM', 1);
    if (r.score <= 2) bump('CHAOS', 1);
    if (r.vague || r.score === 1) bump('SNARK', 1);
    if (r.specific) bump('DEBUGGING', 1);
    if (n % 5 === 0) bump('PATIENCE', 1);
  }
  // 連續送出多個 prompt 時，只讓最新那個的結果顯示在狀態列
  if (!st.last || st.last.id === id) {
    st.last = { id, at: Date.now(), score: r.score, face, comment, reasons: r.reasons, by: r.by };
  }
  return { face, comment };
}

function cmdRate() {
  if (process.env.BUDDY_INNER) return; // Haiku 評分用的 claude -p 自己不評
  let input = {};
  try { input = JSON.parse(readStdin() || '{}'); } catch {}
  const prompt = String(input.prompt ?? '');
  if (!prompt.trim() || /^[\/!#]/.test(prompt.trim())) return; // 指令、bash、memory 不評

  const st = loadState();
  const reaction = interact(prompt, input, st);
  if (reaction) {
    // block：prompt 不會送給 Claude，reason 只顯示給使用者
    process.stdout.write(JSON.stringify({ decision: 'block', reason: reaction, suppressOutput: true }));
    return;
  }

  st.prompts += 1;
  const id = `${Date.now()}-${st.prompts}`;
  const rules = { ...scorePrompt(prompt), by: 'rules' };

  // 規則版，或明顯只是對話回應 → 直接評，不必花 Haiku
  if (st.mode === 'rules' || rules.kind === 'chat') {
    const { face, comment } = applyResult(st, rules, id);
    saveState(st);
    const scoreTxt = rules.score ? `${rules.score}分 ` : '';
    // systemMessage 只顯示給使用者，不會進到 Claude 的 context
    process.stdout.write(JSON.stringify({ systemMessage: `${face} ${st.name}：${scoreTxt}${comment}`, suppressOutput: true }));
    return;
  }

  // Haiku 版：先標成「閱讀中」，丟給背景程序評分，不拖慢送出
  st.last = { id, at: Date.now(), pending: true, face: '(・ω・)?', comment: '讓我看看…' };
  saveState(st);
  const job = path.join(STATE_DIR, `job-${id}.json`);
  fs.writeFileSync(job, JSON.stringify({ id, prompt, rules }));
  const { spawn } = require('child_process');
  spawn(process.execPath, [__filename, 'judge', job], {
    detached: true, stdio: 'ignore', windowsHide: true,
  }).unref();
}

const JUDGE_SYSTEM = `你是一隻住在終端機裡、毒舌但可愛的寵物，負責替使用者「寫給 AI 程式助理的 prompt」打分數。
評分標準：具體性（檔名、路徑、錯誤訊息、程式碼）、有沒有說預期結果、有沒有給限制或脈絡、是否清楚好懂。
5=完美 4=不錯 3=普通 2=資訊不足 1=完全看不懂要幹嘛。
如果只是對話回應（例如「好啊」「繼續」「謝謝」），score 給 0。
只輸出一行 JSON，不要其他文字：{"score":整數,"comment":"短評"}
comment 規則：繁體中文、最多 16 個字、一句話、可以吐槽但要可愛，不要加「寵物說」之類的前綴。`;

function askHaiku(prompt) {
  const { spawnSync } = require('child_process');
  const args = ['-p', '--model', 'haiku', '--tools', '', '--setting-sources', '', '--strict-mcp-config',
    '--no-session-persistence', '--output-format', 'json',
    '--settings', '{"alwaysThinkingEnabled":false}', '--system-prompt', JUDGE_SYSTEM];
  const res = spawnSync('claude', args, {
    input: `要評分的 prompt：\n<<<\n${prompt.slice(0, 4000)}\n>>>`,
    encoding: 'utf8', timeout: 30000, windowsHide: true, cwd: os.tmpdir(),
    env: { ...process.env, BUDDY_INNER: '1' },
  });
  if (res.error || res.status !== 0) {
    throw new Error(res.error?.message || `exit ${res.status}: ${(res.stderr || res.stdout || '').slice(0, 300)}`);
  }
  const text = JSON.parse(res.stdout).result || '';
  const m = text.match(/\{[\s\S]*\}/);
  const out = JSON.parse(m ? m[0] : text);
  const score = Math.round(Number(out.score));
  if (!(score >= 0 && score <= 5)) throw new Error(`bad score: ${text}`);
  const chars = [...String(out.comment || '').trim()];
  const comment = chars.length > 20 ? chars.slice(0, 19).join('') + '…' : chars.join('');
  return { score: score || null, comment, reasons: ['Haiku 評分'], by: 'haiku' };
}

function cmdJudge(job) {
  const { id, prompt, rules } = JSON.parse(fs.readFileSync(job, 'utf8'));
  let r;
  try {
    r = { ...askHaiku(prompt), specific: rules.specific, vague: rules.vague };
  } catch (e) {
    r = { ...rules, reasons: [...(rules.reasons || []), 'Haiku 失敗，改用規則'] };
    try { fs.appendFileSync(path.join(STATE_DIR, 'error.log'), `${new Date().toISOString()} ${e.message}\n`); } catch {}
  }
  const st = loadState(); // 重新讀，避免覆蓋這段時間的其他更新
  applyResult(st, r, id);
  saveState(st);
  try { fs.unlinkSync(job); } catch {}
}

function cmdMode(m) {
  const st = loadState();
  if (m === 'rules' || m === 'haiku') { st.mode = m; saveState(st); }
  console.log(`評分模式：${st.mode === 'rules' ? '規則' : 'Haiku'}`);
}

function level(xp) { return Math.floor(Math.sqrt(xp / 10)) + 1; }

function contextTokens(input) {
  const cw = input.context_window || {};
  const size = cw.context_window_size || 200000;
  const cu = cw.current_usage;
  if (cu) {
    return { used: (cu.input_tokens || 0) + (cu.cache_creation_input_tokens || 0) + (cu.cache_read_input_tokens || 0), size };
  }
  if (typeof cw.used_percentage === 'number') return { used: Math.round(size * cw.used_percentage / 100), size };
  // 備案：從 transcript 讀最後一則 assistant 的 usage
  try {
    const lines = fs.readFileSync(input.transcript_path, 'utf8').trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const u = JSON.parse(lines[i])?.message?.usage;
      if (u && !JSON.parse(lines[i]).isSidechain) {
        return { used: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), size };
      }
    }
  } catch {}
  return { used: 0, size };
}

// base = 上次收成時的用量；田裡只長 base 之後新增的部分
function mushrooms(used, size, base = 0) {
  const per = size / SLOTS;
  const grown = Math.max(0, used - base);
  const full = Math.min(SLOTS, Math.floor(grown / per));
  const frac = (grown % per) / per;
  const M = ASCII ? '♣' : '🍄';
  const stages = ASCII ? ['.', ',', 'i'] : ['.', ',', '🌱'];
  let row = M.repeat(full);
  if (full < SLOTS && grown > 0) row += stages[Math.min(2, Math.floor(frac * 3))];
  const pct = used / size;
  const color = pct > 0.8 ? C.red : pct > 0.6 ? C.yellow : C.green;
  const k = (x) => x >= 1000 ? `${Math.round(x / 1000)}k` : String(x);
  return { text: `${color}${row || '.'}${C.reset} ${C.dim}${k(used)}/${k(size)}${C.reset}`, pct };
}

function cmdStatus() {
  let input = {};
  try { input = JSON.parse(readStdin() || '{}'); } catch {}
  const st = loadState();
  const { used, size } = contextTokens(input);

  // 記下這個 session 的用量，讓「拔香菇」知道田裡有幾朵
  let base = 0;
  if (input.session_id) {
    const field = loadField();
    const f = field[input.session_id] || { base: 0 };
    if (used < f.base) f.base = 0; // /compact 或 /clear 之後重新開墾
    base = f.base;
    if (f.used !== used || f.size !== size) {
      Object.assign(f, { used, size, at: Date.now() });
      field[input.session_id] = f;
      for (const [k, v] of Object.entries(field)) if (Date.now() - v.at > 3 * 86400e3) delete field[k];
      saveField(field);
    }
  }
  const m = mushrooms(used, size, base);

  const idleMs = st.last ? Date.now() - st.last.at : Infinity;
  let face, comment = '';
  if (m.pct > 0.8) { face = pick(FACES.panic, st.prompts); comment = '香菇快長滿了！該 /compact 了'; }
  else if (idleMs > 15 * 60e3) { face = FACES.sleep[0]; comment = ''; }
  else if (st.last?.pending && idleMs > 60e3) { face = '(・_・?)'; comment = '剛剛走神了…'; }
  else if (st.last && idleMs < 3 * 60e3) { face = st.last.face; comment = st.last.comment; }
  else { face = pick(FACES.idle, Math.floor(Date.now() / 60e3)); }

  const r = RARITIES.find((x) => x.name === st.rarity) || RARITIES[0];
  const avg = st.rated ? (st.scoreSum / st.rated).toFixed(1) : '-';
  const tag = `${st.shiny ? '✨' : ''}${st.hat}${r.color}${st.name}${C.reset}`;
  const basket = st.basket ? ` · 🧺${st.basket}` : '';
  const line1 = `${C.bold}${face}${C.reset} ${tag} ${C.dim}Lv${level(st.xp)} · 平均${avg}分${basket}${C.reset}${comment ? `  ${C.cyan}「${comment}」${C.reset}` : ''}`;
  process.stdout.write(`${line1}\n${m.text}\n`);
}

function cardText(st, color) {
  const r = RARITIES.find((x) => x.name === st.rarity) || RARITIES[0];
  const bar = (v) => '█'.repeat(Math.round(v / 10)) + '░'.repeat(10 - Math.round(v / 10));
  const avg = st.rated ? (st.scoreSum / st.rated).toFixed(2) : '-';
  const out = [
    `╭──────────────────────────────╮`,
    `  ${st.shiny ? '✨ ' : ''}${st.hat}${C.bold}${st.name}${C.reset}  (${st.species})`,
    `  ${r.color}★ ${st.rarity}${C.reset}   Lv${level(st.xp)}  XP ${st.xp}`,
    `  prompts ${st.prompts}   平均分數 ${avg}   評分：${st.mode === 'rules' ? '規則' : 'Haiku'}`,
    `  🧺 香菇背包 ${st.basket || 0} 朵`,
    ``,
    ...Object.entries(st.stats).map(([k, v]) => `  ${k.padEnd(10)} ${bar(v)} ${v}`),
    `╰──────────────────────────────╯`,
    `  互動：戳 / 摸摸 / 餵 / 拔香菇 / ${st.name}`,
  ];
  const text = out.join('\n');
  return color ? text : text.replace(/\x1b\[\d+m/g, '');
}

function cmdCard() {
  // `! node buddy.js card` 的輸出不是 TTY，不吃 ANSI 色碼
  console.log(cardText(loadState(), process.stdout.isTTY && !process.env.NO_COLOR));
}

function cmdReset() {
  try { fs.unlinkSync(STATE_FILE); } catch {}
  saveState(loadState());
  console.log('buddy 已重置');
}

module.exports = { scorePrompt, askHaiku };

if (require.main === module) {
  const cmd = process.argv[2];
  try {
    ({ rate: cmdRate, status: cmdStatus, card: cmdCard, reset: cmdReset, judge: cmdJudge, mode: cmdMode }[cmd] || cmdCard)(process.argv[3]);
  } catch (e) {
    // hook / 狀態列出錯時不要打擾使用者
    if (cmd === 'status') process.stdout.write('(・_・?) buddy 出錯了\n');
    else if (cmd !== 'rate' && cmd !== 'judge') console.error(e);
  }
}
