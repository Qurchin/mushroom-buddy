# 🍄 Claude Buddy — 香菇田小寵物

住在 Claude Code 狀態列的小寵物：

- 幫你寫的 prompt 打分數（1–5 分），表情會跟著變
- 狀態列下方有一塊香菇田，context 用越多，香菇長越多
- 可以戳它、摸它、餵它吃台灣小吃、收成香菇換帽子

```
(｡•̀ᴗ-)✧ 珍奶 Lv3 · 平均3.8分 · 🧺12  「有檔名有預期，讚啦」
🍄🍄🍄🍄🌱 48k/200k
```

每個人的寵物都不一樣：物種、名字和稀有度，會依你的帳號和電腦名稱決定。

## 需要

- [Claude Code](https://claude.com/claude-code)
- Node.js 16 以上（在終端機打 `node --version` 確認）

## 安裝

```
git clone https://github.com/Qurchin/mushroom-buddy.git
cd mushroom-buddy
node install.js
```

沒有裝 git 的話，可以在這個頁面點綠色的 **Code** → **Download ZIP**，解壓縮後在資料夾裡執行 `node install.js`。

**更新**：在資料夾裡跑 `git pull`，再跑一次 `node install.js`。你的寵物資料會保留。

裝好之後開一個新的 Claude Code，就會在輸入框下方看到你的寵物。

安裝程式會做這些事：
- 把程式複製到 `~/.claude/buddy/app/`
- 在 `~/.claude/settings.json` 加上狀態列和一個 hook

你原本的設定會先自動備份，再合併新的設定進去。如果你本來有自訂的狀態列，會被換成寵物的，舊的那份留在備份檔裡。

## 怎麼玩

在輸入框**只打**下面這些字然後送出，就會跟寵物互動。這些字不會送給 Claude，也不花 token：

| 輸入 | 效果 |
|---|---|
| `戳` | 連續戳會越來越生氣 |
| `摸摸` | 冒愛心、消氣 |
| `餵` | 隨機餵一道台灣小吃，畫面會出現 ASCII 圖（30 分鐘最多 4 份） |
| `拔香菇` | 收成香菇放進背包。收成 10、30、60、100 朵時會解鎖帽子 |
| 寵物的名字 | 顯示角色卡 |

### Prompt 評分

- **預設用 Haiku 評分**，會吐槽，每個 prompt 約花 750 個 Haiku token，算在你的帳號額度裡
- **想改用免費的規則評分**：
  ```
  node ~/.claude/buddy/app/buddy.js mode rules
  ```
  換回 Haiku 就把 `rules` 改成 `haiku`

### Emoji 跑版

把 `~/.claude/settings.json` 裡 statusLine 的 command 開頭改成 `BUDDY_ASCII=1 node ...`，香菇就會換成 `♣`。

## 移除

```
node install.js --uninstall           # 移除，但保留寵物資料
node install.js --uninstall --purge   # 連寵物資料一起刪掉
```
