(function () {
  'use strict';

  // ============================================================================
  // 核心演算法（逐字保留常數與位元運算，並加入 eggSlotHash 號位抽籤）
  // ============================================================================
  const SHINY_RATE = 1 / 512;
  const SHINY_PARENT_RATE = 1 / 16;
  const SHINY_PARENT_RATE_OLD = 0.1;
  const SHINY_BERRY_MULT = 2;
  const DITTO_ID = 132;
  const NO_EGG_IDS = [137, 442, 479, 47901, 47902, 47903, 47904, 47905, 556];

  function eggHash(str) {
    var S = 1779033703 ^ ((24348 << 16) | 41597);
    var C = 3144134277 ^ ((15337 << 16) | 49222);
    for (var i = 0; i < str.length; i++) {
      var t = str.charCodeAt(i);
      S = Math.imul(S ^ t, 2654435761);
      C = Math.imul(C ^ t, 1597334677);
    }
    S = Math.imul(S ^ (S >>> 16), 2246822507) ^ Math.imul(C ^ (C >>> 13), 3266489909);
    C = Math.imul(C ^ (C >>> 16), 2246822507) ^ Math.imul(S ^ (S >>> 13), 3266489909);
    return (4294967296 * (2097151 & C) + (S >>> 0)) / 9007199254740992;
  }

  function trainerSeed(save) {
    var t = (save && save.trainer) || null;
    if (!t) return ':';
    return (t.since == null ? '' : t.since) + ':' + (t.id == null ? '' : t.id);
  }

  function eggKHash(k, save) {
    return eggHash(trainerSeed(save) + '|egg|' + k + '|0');
  }

  function eggSlotHash(k, save) {
    return eggHash(trainerSeed(save) + '|egg|' + k + '|1');
  }

  function shinyThreshold(egg) {
    var o = 0;
    if (egg && egg.sp) o = (+egg.sp === 2) ? SHINY_PARENT_RATE : SHINY_PARENT_RATE_OLD;
    var th = o ? Math.max(o, SHINY_RATE) : SHINY_RATE;
    if (egg && egg.bx) th *= SHINY_BERRY_MULT;
    return th;
  }

  function eggIsShiny(egg, save) {
    if (!egg || typeof egg !== 'object') return false;
    if (Object.prototype.hasOwnProperty.call(egg, 'shiny')) return !!egg.shiny;
    var roll;
    if (typeof egg.k === 'number' && Number.isInteger(egg.k)) {
      roll = eggKHash(egg.k, save);
    } else {
      var key = String(egg.uid != null ? egg.uid : (egg.laidAt != null ? egg.laidAt : ''));
      if (!key) return false;
      roll = eggHash(key);
    }
    return roll < shinyThreshold(egg);
  }

  // ============================================================================
  // 常數與 Popup 狀態
  // ============================================================================
  const STORAGE_KEY = 'pkc_egg_predictor_ui_v1';
  const SUPPORTED_ORIGINS = [
    'https://pokecatch-online.app'
  ];

  const PREDICT_LIMIT = 999;
  const LIST_PAGE_SIZE = 200;

  const TIERS = [
    {
      id: 'base',
      cardTitle: '普通親代 (1/512)',
      tagName: '普通親代',
      sp: 0,
      bx: 0,
      th: shinyThreshold({ sp: 0, bx: 0 }),
      badgeClass: 'tier-base'
    },
    {
      id: 'berry',
      cardTitle: '吃果普通親代 (1/256)',
      tagName: '吃果普通親代',
      sp: 0,
      bx: 1,
      th: shinyThreshold({ sp: 0, bx: 1 }),
      badgeClass: 'tier-berry'
    },
    {
      id: 'parent',
      cardTitle: '閃光親代 (1/16)',
      tagName: '閃光親代',
      sp: 2,
      bx: 0,
      th: shinyThreshold({ sp: 2, bx: 0 }),
      badgeClass: 'tier-parent'
    },
    {
      id: 'parentBerry',
      cardTitle: '吃果閃光親代 (1/8)',
      tagName: '吃果閃光親代',
      sp: 2,
      bx: 1,
      th: shinyThreshold({ sp: 2, bx: 1 }),
      badgeClass: 'tier-pb'
    }
  ];

  const uiState = {
    activeTab: 'predict', // 'predict' | 'eggs'
    filterTier: 'all', // 'all' | 'base' | 'berry' | 'parent' | 'parentBerry'
    hideNormalAfter4: false,
    visibleCount: LIST_PAGE_SIZE,
    showDebug: false
  };

  let currentView = 'loading'; // 'loading' | 'unsupported' | 'error' | 'ready'
  let currentErrorText = '';
  let currentState = null;

  const appRoot = document.getElementById('app');

  // ============================================================================
  // 本地繁體中文圖鑑查詢（零 DOM 讀取）
  // ============================================================================
  function dexName(id) {
    if (id == null) return '神秘蛋';
    var numId = +id;
    var table = (typeof globalThis !== 'undefined' && globalThis.PC_NAMES) || (typeof window !== 'undefined' && window.PC_NAMES) || null;
    if (table && Number.isFinite(numId) && table[numId]) {
      return table[numId];
    }
    return '#' + id;
  }

  // ============================================================================
  // 容錯 JSON 解析（相容雙重 JSON 字串與 { data / save / state } 外層包裹）
  // ============================================================================
  function parseSaveRaw(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    var cur = raw;
    for (var i = 0; i < 4; i++) {
      if (typeof cur === 'string') {
        try {
          cur = JSON.parse(cur);
        } catch (e) {
          return null;
        }
      } else {
        break;
      }
    }
    if (!cur || typeof cur !== 'object') return null;

    for (var depth = 0; depth < 3; depth++) {
      if (cur && typeof cur === 'object' && !cur.trainer && !cur.pension) {
        var inner = null;
        if (Object.prototype.hasOwnProperty.call(cur, 'data') && cur.data != null) {
          inner = cur.data;
        } else if (Object.prototype.hasOwnProperty.call(cur, 'save') && cur.save != null) {
          inner = cur.save;
        } else if (Object.prototype.hasOwnProperty.call(cur, 'state') && cur.state != null) {
          inner = cur.state;
        }
        if (inner != null) {
          if (typeof inner === 'string') {
            try {
              inner = JSON.parse(inner);
            } catch (e) {
              break;
            }
          }
          if (inner && typeof inner === 'object') {
            cur = inner;
            continue;
          }
        }
      }
      break;
    }
    return cur && typeof cur === 'object' ? cur : null;
  }

  // ============================================================================
  // 在遊戲分頁中執行的極簡單行唯讀函式（完全零 DOM 查詢、零寫入）
  // ============================================================================
  function capturePageSnapshot() {
    try {
      return window.localStorage.getItem('gachamon-save-v1');
    } catch (e) {
      return null;
    }
  }

  // ============================================================================
  // 存檔結構解析（極簡 parentPool + 持有蛋 + 孵化倒計時）
  // ============================================================================
  function parseParentPool(pension) {
    var rawMons = (pension && Array.isArray(pension.mons)) ? pension.mons : [];
    var pool = [];
    for (var i = 0; i < rawMons.length; i++) {
      var entry = rawMons[i];
      if (!entry || typeof entry !== 'object') continue;
      var m = (entry.mon && typeof entry.mon === 'object') ? entry.mon : entry;
      if (!m || typeof m !== 'object') continue;

      var id =
        m.id != null ? +m.id :
        m.speciesId != null ? +m.speciesId :
        m.pokemonId != null ? +m.pokemonId :
        m.dexId != null ? +m.dexId : null;
      if (!Number.isFinite(id)) continue;
      if (id === DITTO_ID) continue;
      if (m.noEgg || NO_EGG_IDS.indexOf(id) !== -1) continue;

      pool.push({
        id: id,
        shiny: !!(m.shiny || m.isShiny),
        slotNum: pool.length + 1,
        name: dexName(id)
      });
    }
    return pool;
  }

  function evaluateEgg(egg, idx, save) {
    var isShiny = eggIsShiny(egg, save);
    var th = shinyThreshold(egg);
    var roll = null;
    var method = 'unknown';

    if (egg && typeof egg === 'object') {
      if (Object.prototype.hasOwnProperty.call(egg, 'shiny')) {
        method = 'legacy(shiny)';
      } else if (typeof egg.k === 'number' && Number.isInteger(egg.k)) {
        roll = eggKHash(egg.k, save);
        method = 'k=' + egg.k;
      } else {
        var key = String(egg.uid != null ? egg.uid : (egg.laidAt != null ? egg.laidAt : ''));
        if (key) {
          roll = eggHash(key);
          method = egg.uid != null ? 'uid' : 'laidAt';
        }
      }
    }

    var speciesId =
      egg && (egg.id != null && typeof egg.id === 'number' ? egg.id :
      egg.speciesId != null ? egg.speciesId :
      egg.pokemonId != null ? egg.pokemonId :
      egg.dexId != null ? egg.dexId :
      egg.species != null ? egg.species : null);

    var hatchAt = egg && typeof egg.hatchAt === 'number' && Number.isFinite(egg.hatchAt)
      ? egg.hatchAt
      : null;

    return {
      index: idx,
      egg: egg,
      k: egg && typeof egg.k === 'number' && Number.isInteger(egg.k) ? egg.k : null,
      uid: egg && egg.uid != null ? String(egg.uid) : null,
      laidAt: egg && egg.laidAt != null ? egg.laidAt : null,
      hatchAt: hatchAt,
      speciesId: speciesId,
      displayName: speciesId != null ? dexName(speciesId) : '神秘蛋',
      sp: egg && egg.sp ? +egg.sp : 0,
      bx: !!(egg && egg.bx),
      roll: roll,
      th: th,
      method: method,
      isShiny: isShiny
    };
  }

  function formatHatchCountdown(hatchAt) {
    if (hatchAt == null || !Number.isFinite(hatchAt)) {
      return { text: '—', ready: false };
    }
    var remainMs = Math.max(0, hatchAt - Date.now());
    if (remainMs <= 0) {
      return { text: '可孵化', ready: true };
    }
    var totalMin = Math.ceil(remainMs / 60000);
    if (totalMin < 60) {
      return { text: totalMin + 'min', ready: false };
    }
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    if (m === 0) {
      return { text: h + 'h', ready: false };
    }
    return { text: h + 'h ' + m + 'min', ready: false };
  }

  function extractGameState(save) {
    var seed = trainerSeed(save);
    var pension = (save && save.pension && typeof save.pension === 'object') ? save.pension : null;

    var parentPool = parseParentPool(pension);

    var rawEggs = [];
    var eggsPath = 'save.pension.eggs';
    if (pension && Array.isArray(pension.eggs)) {
      rawEggs = pension.eggs;
    } else if (Array.isArray(save.eggs)) {
      rawEggs = save.eggs;
      eggsPath = 'save.eggs';
    }

    var evaluatedEggs = [];
    var shinyEggs = [];
    for (var i = 0; i < rawEggs.length; i++) {
      var ev = evaluateEgg(rawEggs[i], i, save);
      evaluatedEggs.push(ev);
      if (ev.isShiny) shinyEggs.push(ev);
    }

    var laid = 0;
    var kSource = '';
    if (pension && typeof pension.laid === 'number' && Number.isInteger(pension.laid) && pension.laid >= 0) {
      laid = pension.laid;
      kSource = 'save.pension.laid = ' + laid;
    } else {
      var hatched = (save && save.stats && typeof save.stats.hatched === 'number') ? save.stats.hatched : 0;
      var eggsLen = (pension && Array.isArray(pension.eggs)) ? pension.eggs.length : rawEggs.length;
      laid = hatched + eggsLen;
      kSource = '(stats.hatched=' + hatched + ') + (pension.eggs.length=' + eggsLen + ') = ' + laid;
    }

    var berryActive = !!(pension && pension.bx);

    var pensionDebugSummary = null;
    if (pension) {
      pensionDebugSummary = {
        keys: Object.keys(pension),
        laid: pension.laid,
        bx: pension.bx,
        eggsCount: Array.isArray(pension.eggs) ? pension.eggs.length : 0,
        parentPool: parentPool
      };
    }

    return {
      save: save,
      seed: seed,
      laid: laid,
      kSource: kSource,
      berryActive: berryActive,
      eggsPath: eggsPath,
      eggs: evaluatedEggs,
      shinyEggs: shinyEggs,
      parentPool: parentPool,
      pensionDebugSummary: pensionDebugSummary,
      topKeys: Object.keys(save)
    };
  }

  // ============================================================================
  // 生蛋序列預測引擎（固定掃描 999 顆 + 雜湊號位抽籤 egg|k|1）
  // ============================================================================
  function classifyMinTier(roll) {
    if (roll < TIERS[0].th) return TIERS[0];
    if (roll < TIERS[1].th) return TIERS[1];
    if (roll < TIERS[2].th) return TIERS[2];
    if (roll < TIERS[3].th) return TIERS[3];
    return null;
  }

  function resolveParentForK(k, save, parentPool) {
    if (!parentPool || parentPool.length === 0) return null;
    var roll = eggSlotHash(k, save);
    var idx = Math.min(parentPool.length - 1, Math.floor(roll * parentPool.length));
    return parentPool[idx];
  }

  function predictSequence(state, filterTier, hideNormalAfter4) {
    var save = state.save;
    var laid = state.laid;
    var parentPool = state.parentPool || [];
    var maxTh = TIERS[3].th;

    var nearest = {
      base: null,
      berry: null,
      parent: null,
      parentBerry: null
    };

    var rows = [];

    for (var step = 0; step < PREDICT_LIMIT; step++) {
      var k = laid + step;
      var roll = eggKHash(k, save);
      var minTier = roll < maxTh ? classifyMinTier(roll) : null;
      var slotParent = resolveParentForK(k, save, parentPool);
      var slotNum = slotParent ? slotParent.slotNum : null;
      var slotName = slotParent ? slotParent.name : null;

      if (minTier) {
        var hitObj = {
          k: k,
          step: step,
          roll: roll,
          minTier: minTier,
          slotNum: slotNum,
          slotName: slotName
        };

        if (minTier.id === 'base' && !nearest.base) {
          nearest.base = hitObj;
        } else if (minTier.id === 'berry' && !nearest.berry) {
          nearest.berry = hitObj;
        } else if (minTier.id === 'parent' && !nearest.parent) {
          nearest.parent = hitObj;
        } else if (minTier.id === 'parentBerry' && !nearest.parentBerry) {
          nearest.parentBerry = hitObj;
        }
      }

      if (filterTier === 'all' || (minTier && minTier.id === filterTier)) {
        if (!(hideNormalAfter4 && step >= 4 && !minTier)) {
          rows.push({
            k: k,
            step: step,
            roll: roll,
            minTier: minTier,
            slotNum: slotNum,
            slotName: slotName
          });
        }
      }
    }

    var visibleLimit = Math.min(rows.length, uiState.visibleCount);

    return {
      laid: laid,
      nearest: nearest,
      totalRows: rows.length,
      rows: rows.slice(0, visibleLimit),
      hasMore: visibleLimit < rows.length
    };
  }

  // ============================================================================
  // chrome.storage.local 偏好存取
  // ============================================================================
  function loadUiPrefs(cb) {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([STORAGE_KEY], function (res) {
          var saved = res && res[STORAGE_KEY];
          if (saved && typeof saved === 'object') {
            if (saved.activeTab === 'predict' || saved.activeTab === 'eggs') uiState.activeTab = saved.activeTab;
            if (typeof saved.filterTier === 'string') uiState.filterTier = saved.filterTier;
            if (typeof saved.hideNormalAfter4 === 'boolean') uiState.hideNormalAfter4 = saved.hideNormalAfter4;
          }
          cb();
        });
        return;
      }
    } catch (e) {
      // ignore
    }
    cb();
  }

  function saveUiPrefs() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        var payload = {};
        payload[STORAGE_KEY] = {
          activeTab: uiState.activeTab,
          filterTier: uiState.filterTier,
          hideNormalAfter4: uiState.hideNormalAfter4
        };
        chrome.storage.local.set(payload);
      }
    } catch (e) {
      // ignore
    }
  }

  // ============================================================================
  // 按需單次讀取目前分頁 localStorage
  // ============================================================================
  function isSupportedGameUrl(url) {
    if (typeof url !== 'string') return false;
    for (var i = 0; i < SUPPORTED_ORIGINS.length; i++) {
      if (url.indexOf(SUPPORTED_ORIGINS[i]) === 0) return true;
    }
    return false;
  }

  function fetchSnapshotFromActiveTab() {
    currentView = 'loading';
    currentErrorText = '';
    renderUI();

    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.scripting) {
      currentView = 'error';
      currentErrorText = '無法存取擴充功能分頁 API。';
      renderUI();
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (chrome.runtime && chrome.runtime.lastError) {
        currentView = 'error';
        currentErrorText = chrome.runtime.lastError.message || '無法讀取目前分頁資訊。';
        renderUI();
        return;
      }

      var activeTab = tabs && tabs[0];
      if (!activeTab || !activeTab.id || !isSupportedGameUrl(activeTab.url)) {
        currentView = 'unsupported';
        currentState = null;
        renderUI();
        return;
      }

      chrome.scripting.executeScript(
        {
          target: { tabId: activeTab.id },
          func: capturePageSnapshot
        },
        function (results) {
          if (chrome.runtime && chrome.runtime.lastError) {
            currentView = 'error';
            currentErrorText = chrome.runtime.lastError.message || '無法讀取遊戲分頁存檔。';
            renderUI();
            return;
          }

          var rawSave = results && results[0] ? results[0].result : null;
          var save = parseSaveRaw(rawSave);
          currentState = save ? extractGameState(save) : null;
          currentView = 'ready';
          renderUI();
        }
      );
    });
  }

  // ============================================================================
  // Popup 介面渲染
  // ============================================================================
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatCardMainDist(hit) {
    if (!hit) return '> ' + PREDICT_LIMIT + ' 顆';
    if (hit.step === 0) return '下一顆是！';
    return '再過 ' + hit.step + ' 顆';
  }

  function renderUI() {
    if (!appRoot) return;

    // 記錄重繪前捲動位置
    var prevBody = document.getElementById('pkc-panel-body');
    var prevPredList = document.getElementById('pkc-pred-list');
    var prevEggList = document.getElementById('pkc-egg-list');
    var savedBodyScroll = prevBody ? prevBody.scrollTop : 0;
    var savedPredScroll = prevPredList ? prevPredList.scrollTop : 0;
    var savedEggScroll = prevEggList ? prevEggList.scrollTop : 0;

    var state = currentState;
    var hasShinyHeld = !!(state && state.shinyEggs.length > 0);
    var pred = state ? predictSequence(state, uiState.filterTier, uiState.hideNormalAfter4) : null;

    var html = '<div class="panel' + (hasShinyHeld ? ' has-shiny' : '') + '">';
    html +=
      '<div class="header">' +
      '<div class="title"><span>🥚</span><span>PokéCatch 色違預測</span></div>' +
      '<div class="header-actions">' +
      '<button type="button" class="icon-btn" id="pkc-refresh" title="重新讀取目前遊戲分頁存檔">刷新</button>' +
      '</div>' +
      '</div>';

    html += '<div class="body" id="pkc-panel-body">';

    if (currentView === 'loading') {
      html += '<div class="empty">正在讀取遊戲存檔…</div>';
    } else if (currentView === 'unsupported') {
      html +=
        '<div class="notice-box">' +
        '<div class="notice-title">請切換至 PokéCatch 遊戲分頁後再點擊擴充功能</div>' +
        '<div class="notice-desc">本工具平時不會常駐注入任何網頁，僅於你在支援的遊戲分頁點擊圖示時，單次唯讀本地存檔。</div>' +
        '<div class="notice-urls">' +
        'https://pokecatch-online.app/' +
        '</div>' +
        '</div>';
    } else if (currentView === 'error') {
      html +=
        '<div class="notice-box">' +
        '<div class="notice-title">讀取失敗</div>' +
        '<div class="notice-desc">' + escapeHtml(currentErrorText) + '</div>' +
        '</div>';
    } else if (!state) {
      html +=
        '<div class="empty">目前分頁尚無 <code>gachamon-save-v1</code> 存檔資料<br>請進入遊戲建立或載入存檔後再點右上角「刷新」</div>';
    } else {
      // 1. 頂部狀態列（目前孵蛋數 k={laid} 與 靛莓果：已吃 / 未吃）
      html +=
        '<div class="status-bar">' +
        '<div class="status-k">目前孵蛋數 <strong>k=' + state.laid + '</strong></div>' +
        '<div class="status-bx' + (state.berryActive ? ' eaten' : '') + '">' +
        '靛莓果：' + (state.berryActive ? '已吃' : '未吃') +
        '</div>' +
        '</div>';

      // 分頁切換
      html +=
        '<div class="tabs">' +
        '<button type="button" class="tab-btn' + (uiState.activeTab === 'predict' ? ' active' : '') + '" data-tab="predict">序列預測</button>' +
        '<button type="button" class="tab-btn' + (uiState.activeTab === 'eggs' ? ' active' : '') + '" data-tab="eggs">' +
        '持有蛋 (' + state.eggs.length + (hasShinyHeld ? ' / ✨' + state.shinyEggs.length : '') + ')' +
        '</button>' +
        '</div>';

      if (uiState.activeTab === 'predict') {
        // 2. 四張摘要卡（共用 999 顆掃描結果）
        html += '<div class="radar-grid">';
        for (var t = 0; t < TIERS.length; t++) {
          var tier = TIERS[t];
          var hit = pred.nearest[tier.id];
          var isSel = uiState.filterTier === tier.id;
          var isHot = !!(hit && hit.step === 0);
          var subText = hit
            ? 'k=' + hit.k + (hit.slotNum != null ? ' · ' + hit.slotNum + '號位' + (hit.slotName ? ' ' + hit.slotName : '') : '')
            : PREDICT_LIMIT + ' 顆內無命中';

          html +=
            '<button type="button" class="radar-card' +
            (isSel ? ' selected' : '') +
            (isHot ? ' imminent' : '') +
            '" data-tier="' + tier.id + '">' +
            '<div class="radar-title">' + escapeHtml(tier.cardTitle) + '</div>' +
            '<div class="radar-dist' + (isHot ? ' hot' : '') + '">' + escapeHtml(formatCardMainDist(hit)) + '</div>' +
            '<div class="radar-sub">' + escapeHtml(subText) + '</div>' +
            '</button>';
        }
        html += '</div>';

        // 3. 工具列：左側「生蛋預測（999顆內）」+ 右側「隱藏第4顆以後的普通蛋」開關
        html +=
          '<div class="toolbar">' +
          '<div class="toolbar-left">' +
          '<span class="section-title">生蛋預測（' + PREDICT_LIMIT + '顆內）</span>' +
          (uiState.filterTier !== 'all'
            ? '<button type="button" class="clear-filter-btn" id="pkc-clear-filter">全部</button>'
            : '') +
          '</div>' +
          '<label class="mini-switch" title="保留第 1～4 顆普通蛋與所有閃光蛋">' +
          '<input type="checkbox" id="pkc-hide-normal"' + (uiState.hideNormalAfter4 ? ' checked' : '') + '>' +
          '<span class="mini-switch-track"><span class="mini-switch-thumb"></span></span>' +
          '<span class="mini-switch-text">隱藏第4顆以後的普通蛋</span>' +
          '</label>' +
          '</div>';

        // 4. 生蛋預測列表（999 顆內，分批 200 筆）
        html += '<div class="pred-list" id="pkc-pred-list">';
        if (pred.rows.length === 0) {
          html += '<div class="empty">目前 ' + PREDICT_LIMIT + ' 顆範圍內無符合條件的結果</div>';
        } else {
          for (var h = 0; h < pred.rows.length; h++) {
            var row = pred.rows[h];
            var isShinyRow = !!row.minTier;
            var isImmediate = row.step === 0;

            if (isShinyRow) {
              var shinyRight = isImmediate
                ? '下一顆是 · k=' + row.k
                : '再過 ' + row.step + ' 顆 · k=' + row.k;
              var shinySlotLabel = row.slotNum != null
                ? '[' + row.slotNum + '號位' + (row.slotName ? '·' + row.slotName : '') + ']'
                : '';

              html +=
                '<div class="pred-row shiny-row">' +
                '<div class="pred-left">' +
                '<span class="pred-nth">第 ' + (row.step + 1) + ' 顆</span>' +
                '<span class="tag ' + row.minTier.badgeClass + '">' + escapeHtml(row.minTier.tagName) + '</span>' +
                (shinySlotLabel ? '<span class="slot-badge">' + escapeHtml(shinySlotLabel) + '</span>' : '') +
                '</div>' +
                '<div class="pred-right highlight">' + escapeHtml(shinyRight) + '</div>' +
                '</div>';
            } else {
              var normalRight = isImmediate
                ? '下一顆 · k=' + row.k
                : '再過 ' + row.step + ' 顆 · k=' + row.k;
              var normalSlotLabel = row.slotName
                ? row.slotName + (row.slotNum != null ? ' [' + row.slotNum + '號位]' : '')
                : (row.slotNum != null ? '[' + row.slotNum + '號位]' : '');

              html +=
                '<div class="pred-row">' +
                '<div class="pred-left">' +
                '<span class="pred-nth">第 ' + (row.step + 1) + ' 顆</span>' +
                (normalSlotLabel ? '<span class="normal-parent-text">' + escapeHtml(normalSlotLabel) + '</span>' : '') +
                '</div>' +
                '<div class="pred-right">' + escapeHtml(normalRight) + '</div>' +
                '</div>';
            }
          }

          if (pred.hasMore) {
            var nextBatch = Math.min(LIST_PAGE_SIZE, pred.totalRows - pred.rows.length);
            html +=
              '<button type="button" class="load-more-btn" id="pkc-load-more">' +
              '顯示更多（+' + nextBatch + ' 筆 · 目前 ' + pred.rows.length + '/' + pred.totalRows + '）' +
              '</button>';
          }
        }
        html += '</div>';
      } else {
        // 持有蛋頁籤：清單卡片（左側編號/繁中名稱/k與親代來源 + 右側精確到分鐘孵化倒計時）
        html += '<div class="egg-list" id="pkc-egg-list">';
        if (state.eggs.length === 0) {
          html += '<div class="empty">目前沒有持有任何蛋</div>';
        } else {
          var parentPool = state.parentPool || [];
          for (var eIdx = 0; eIdx < state.eggs.length; eIdx++) {
            var eg = state.eggs[eIdx];
            var kText = eg.k != null ? 'k=' + eg.k : eg.method;
            var parentCond =
              eg.sp === 2
                ? (eg.bx ? '吃果閃光親代' : '閃光親代')
                : eg.sp
                  ? (eg.bx ? '吃果舊版閃光親代' : '舊版閃光親代')
                  : (eg.bx ? '吃果普通親代' : '普通親代');
            var slotParent = eg.k != null ? resolveParentForK(eg.k, state.save, parentPool) : null;
            var sourceParts = [kText];
            if (slotParent) {
              sourceParts.push(slotParent.slotNum + '號位 ' + slotParent.name);
            }
            sourceParts.push(parentCond);

            var cd = formatHatchCountdown(eg.hatchAt);

            html +=
              '<div class="egg-card' + (eg.isShiny ? ' shiny' : '') + '">' +
              '<div class="egg-left">' +
              '<div class="egg-title-row">' +
              '<span class="egg-num">#' + (eg.index + 1) + '</span>' +
              '<span class="egg-name">' + escapeHtml(eg.displayName) + '</span>' +
              (eg.isShiny ? '<span class="egg-shiny-badge">✨ 閃光</span>' : '') +
              '</div>' +
              '<div class="egg-meta">' + escapeHtml(sourceParts.join(' · ')) + '</div>' +
              '</div>' +
              '<div class="egg-countdown' + (cd.ready ? ' ready' : '') + '">' +
              escapeHtml(cd.text) +
              '</div>' +
              '</div>';
          }
        }
        html += '</div>';
      }

      if (uiState.showDebug) {
        html +=
          '<div class="debug-box">' +
          '<strong>Seed (trainerSeed):</strong> ' + escapeHtml(state.seed) + '<br>' +
          '<strong>k 來源:</strong> ' + escapeHtml(state.kSource) + '<br>' +
          '<strong>Object.keys(save):</strong> ' + escapeHtml(state.topKeys.join(', ')) + '<br>' +
          '<strong>save.pension 摘要:</strong><br>' +
          escapeHtml(JSON.stringify(state.pensionDebugSummary, null, 2)) +
          '</div>';
      }
    }

    html += '</div>'; // .body
    html +=
      '<div class="footer">' +
      '<span>' + (state ? 'Seed: ' + escapeHtml(state.seed) : '純 Popup 零 DOM 查詢 · 零網路請求') + '</span>' +
      (state
        ? '<button type="button" class="link-btn" id="pkc-toggle-debug">' + (uiState.showDebug ? '收起除錯資訊' : '除錯資訊') + '</button>'
        : '') +
      '</div>';
    html += '</div>'; // .panel

    appRoot.innerHTML = html;

    // 還原捲動位置
    var newBody = document.getElementById('pkc-panel-body');
    if (newBody && savedBodyScroll > 0) newBody.scrollTop = savedBodyScroll;
    var newPredList = document.getElementById('pkc-pred-list');
    if (newPredList && savedPredScroll > 0) newPredList.scrollTop = savedPredScroll;
    var newEggList = document.getElementById('pkc-egg-list');
    if (newEggList && savedEggScroll > 0) newEggList.scrollTop = savedEggScroll;

    // 綁定互動事件
    var refreshBtn = document.getElementById('pkc-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        fetchSnapshotFromActiveTab();
      });
    }

    var debugBtn = document.getElementById('pkc-toggle-debug');
    if (debugBtn) {
      debugBtn.addEventListener('click', function () {
        uiState.showDebug = !uiState.showDebug;
        renderUI();
      });
    }

    var tabBtns = appRoot.querySelectorAll('.tab-btn');
    for (var tb = 0; tb < tabBtns.length; tb++) {
      tabBtns[tb].addEventListener('click', function () {
        uiState.activeTab = this.getAttribute('data-tab');
        saveUiPrefs();
        renderUI();
      });
    }

    var radarCards = appRoot.querySelectorAll('.radar-card');
    for (var rc = 0; rc < radarCards.length; rc++) {
      radarCards[rc].addEventListener('click', function () {
        var tid = this.getAttribute('data-tier');
        uiState.filterTier = uiState.filterTier === tid ? 'all' : tid;
        uiState.visibleCount = LIST_PAGE_SIZE;
        saveUiPrefs();
        renderUI();
      });
    }

    var clearFilterBtn = document.getElementById('pkc-clear-filter');
    if (clearFilterBtn) {
      clearFilterBtn.addEventListener('click', function () {
        uiState.filterTier = 'all';
        uiState.visibleCount = LIST_PAGE_SIZE;
        saveUiPrefs();
        renderUI();
      });
    }

    var hideNormalCheckbox = document.getElementById('pkc-hide-normal');
    if (hideNormalCheckbox) {
      hideNormalCheckbox.addEventListener('change', function () {
        uiState.hideNormalAfter4 = !!this.checked;
        uiState.visibleCount = LIST_PAGE_SIZE;
        saveUiPrefs();
        renderUI();
      });
    }

    var loadMoreBtn = document.getElementById('pkc-load-more');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        uiState.visibleCount = Math.min(PREDICT_LIMIT, uiState.visibleCount + LIST_PAGE_SIZE);
        renderUI();
      });
    }
  }

  // 啟動入口：載入偏好後單次唯讀目前分頁 localStorage
  loadUiPrefs(function () {
    fetchSnapshotFromActiveTab();
  });
})();
