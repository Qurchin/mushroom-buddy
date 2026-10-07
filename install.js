#!/usr/bin/env node
// Claude Buddy 安裝 / 解除安裝
//
//   node install.js              安裝（或更新）
//   node install.js --uninstall  移除設定與程式（保留寵物資料）
//   node install.js --uninstall --purge   連寵物資料一起刪

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const APP_DIR = path.join(CLAUDE_DIR, 'buddy', 'app');
const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const FILES = ['buddy.js', 'foods.js'];
const MARK = 'buddy.js'; // 用來辨識哪些設定是 buddy 的
const PREV_STATUSLINE = path.join(CLAUDE_DIR, 'buddy', 'prev-statusline.json');

const args = process.argv.slice(2);
const slash = (p) => p.replace(/\\/g, '/');

function readSettings() {
  if (!fs.existsSync(SETTINGS)) return {};
  try {
    return JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  } catch (e) {
    console.error(`✗ ${SETTINGS} 不是合法的 JSON，為了安全不動它。請先修好再安裝。\n  ${e.message}`);
    process.exit(1);
  }
}

function writeSettings(s) {
  if (fs.existsSync(SETTINGS)) {
    const backup = `${SETTINGS}.buddy-backup-${Date.now()}`;
    fs.copyFileSync(SETTINGS, backup);
    console.log(`  已備份原本的設定 → ${backup}`);
  }
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + '\n');
}

// 移除所有 buddy 的 UserPromptSubmit hook，保留使用者自己的
function stripBuddyHooks(s) {
  const list = s.hooks?.UserPromptSubmit;
  if (!Array.isArray(list)) return;
  s.hooks.UserPromptSubmit = list
    .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !String(h.command || '').includes(MARK)) }))
    .filter((g) => g.hooks.length);
  if (!s.hooks.UserPromptSubmit.length) delete s.hooks.UserPromptSubmit;
  if (!Object.keys(s.hooks).length) delete s.hooks;
}

function install() {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 16) { console.error(`✗ 需要 Node.js 16 以上，目前是 ${process.version}`); process.exit(1); }

  console.log('🍄 安裝 Claude Buddy…');
  fs.mkdirSync(APP_DIR, { recursive: true });
  for (const f of FILES) fs.copyFileSync(path.join(__dirname, f), path.join(APP_DIR, f));
  console.log(`  程式已複製到 ${APP_DIR}`);

  const script = slash(path.join(APP_DIR, 'buddy.js'));
  const s = readSettings();

  if (s.statusLine && !String(s.statusLine.command || '').includes(MARK)) {
    fs.writeFileSync(PREV_STATUSLINE, JSON.stringify(s.statusLine));
    console.log(`  ⚠ 原本的狀態列會先換成寵物，解除安裝時會還原：${s.statusLine.command}`);
  }
  s.statusLine = { type: 'command', command: `node "${script}" status`, refreshInterval: 5 };

  stripBuddyHooks(s); // 重複安裝不會疊兩份
  s.hooks = s.hooks || {};
  s.hooks.UserPromptSubmit = s.hooks.UserPromptSubmit || [];
  s.hooks.UserPromptSubmit.push({ hooks: [{ type: 'command', command: `node "${script}" rate`, timeout: 5 }] });
  writeSettings(s);

  const claude = spawnSync('claude', ['--version'], { encoding: 'utf8', windowsHide: true });
  if (claude.error) {
    console.log('  ⚠ 找不到 claude 指令，Haiku 評分會自動改用規則評分（其他功能正常）');
  }

  console.log('\n✓ 安裝完成！開一個新的 Claude Code 就會在下方看到你的寵物。');
  console.log('  互動：在輸入框打「戳」「摸摸」「餵」「拔香菇」或寵物的名字');
  console.log(`  角色卡：node "${script}" card`);
}

function uninstall() {
  console.log('🍄 移除 Claude Buddy…');
  const s = readSettings();
  if (String(s.statusLine?.command || '').includes(MARK)) {
    delete s.statusLine;
    try {
      s.statusLine = JSON.parse(fs.readFileSync(PREV_STATUSLINE, 'utf8'));
      console.log(`  已還原原本的狀態列：${s.statusLine.command}`);
    } catch {}
  }
  stripBuddyHooks(s);
  writeSettings(s);
  fs.rmSync(APP_DIR, { recursive: true, force: true });
  if (args.includes('--purge')) {
    fs.rmSync(path.join(CLAUDE_DIR, 'buddy'), { recursive: true, force: true });
    console.log('  寵物資料也一併刪除了');
  } else {
    console.log(`  寵物資料保留在 ${path.join(CLAUDE_DIR, 'buddy')}（重新安裝會接續）`);
  }
  console.log('✓ 已移除');
}

args.includes('--uninstall') ? uninstall() : install();
