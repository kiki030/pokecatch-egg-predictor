(function () {
  'use strict';

  // ============================================================================
  // 核心演算法（逐字保留常數與位元運算，嚴禁更動）
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
  const ID_NAME_STORAGE_KEY = 'pkc_id_to_name_v1';
  const SUPPORTED_ORIGINS = [
    'https://pokecatch-online.app'
  ];

  const LIST_TOTAL_EGGS = 1000;
  const LIST_PAGE_SIZE = 200;
  const CARD_SEARCH_MAX = 8000;

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
    visibleCount: LIST_PAGE_SIZE,
    showDebug: false
  };

  // 以 uid 為 key 的本次 Popup 記憶體快取：{ name, lv, expWidth, expLabel }
  const domPensionCache = new Map();

  // 以 mon.id 為 key 的純本地寶可夢名稱快取（同步暫存於 chrome.storage.local）
  const idToName = Object.create(null);
  idToName[DITTO_ID] = '百變怪';
  let idToNameDirty = false;

  let currentView = 'loading'; // 'loading' | 'unsupported' | 'error' | 'ready'
  let currentErrorText = '';
  let currentState = null;

  const appRoot = document.getElementById('app');

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
  // 名稱清理與本地 idToName 快取
  // ============================================================================
  function cleanMonName(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw
      .replace(/(?:Lv|Niv|Level)\.?\s*\d+/gi, ' ')
      .replace(/\d+(?:\.\d+)?\s*%/g, ' ')
      .replace(/#\s*\d+/g, ' ')
      .replace(/[✦★☆✨🍬🥚×x+]/g, ' ')
      .replace(/\b\d+\b/g, ' ')
      .replace(/^(?:\s*(?:領回|取回|收回|取出|移除|孵化|Récupérer|Retirer|Retrieve|Remove|Hatch)\s*)+/i, '')
      .replace(/(?:\s*(?:領回|取回|收回|取出|移除|孵化|Récupérer|Retirer|Retrieve|Remove|Hatch)\s*)+$/i, '')
      .replace(/^(?:領回|取回|Récupérer)\s*/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isValidLearnedName(name) {
    if (!name || typeof name !== 'string') return false;
    var s = name.trim();
    if (!s || s.length > 16) return false;
    if (s.indexOf('?') !== -1 || s.indexOf('？') !== -1) return false;
    if (/^(?:未知|神秘蛋|蛋|egg|pokemon|mon|null|undefined)$/i.test(s)) return false;
    return true;
  }

  function recordIdName(id, rawName) {
    var numId = +id;
    if (!Number.isFinite(numId) || numId <= 0) return;
    var cleaned = cleanMonName(rawName);
    if (!isValidLearnedName(cleaned)) return;
    if (idToName[numId] !== cleaned) {
      idToName[numId] = cleaned;
      idToNameDirty = true;
    }
  }

  function flushIdToNameStorage() {
    if (!idToNameDirty) return;
    idToNameDirty = false;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        var payload = {};
        payload[ID_NAME_STORAGE_KEY] = idToName;
        chrome.storage.local.set(payload);
      }
    } catch (e) {
      // ignore
    }
  }

  // ============================================================================
  // 在遊戲分頁中執行的單次極簡純唯讀快照函式（零 DOM 修改、零寫入、零圖片、無全域變數）
  // ============================================================================
  function capturePageSnapshot() {
    var rawSave = null;
    try {
      rawSave = window.localStorage.getItem('gachamon-save-v1');
    } catch (e) {
      rawSave = null;
    }

    var domMons = [];
    try {
      var monNodes = document.querySelectorAll('#pen-res .pen-res[data-uid], .pen-res[data-uid]');
      for (var i = 0; i < monNodes.length; i++) {
        var el = monNodes[i];
        var uid = el.getAttribute('data-uid');
        if (!uid) continue;

        var expWidth = '';
        var expLabel = '';
        var gaugeI = el.querySelector('.pen-gauge i, [class*="gauge"] i');
        if (gaugeI) {
          var w = (gaugeI.style && gaugeI.style.width) ? gaugeI.style.width.trim() : '';
          if (!w) {
            var styleAttr = gaugeI.getAttribute('style') || '';
            var wMatch = styleAttr.match(/width\s*:\s*([\d.]+%)/i);
            if (wMatch) w = wMatch[1];
          }
          if (w) {
            var numPct = parseFloat(w);
            if (Number.isFinite(numPct)) {
              var clamped = Math.max(0, Math.min(100, numPct));
              expWidth = clamped + '%';
              expLabel = Math.round(clamped) + '%';
            }
          }
        }

        var fullText = el.textContent || '';
        var lv = null;
        var lvMatch = fullText.match(/(?:Lv|Niv|Level)\.?\s*(\d+)/i);
        if (lvMatch) {
          var parsedLv = parseInt(lvMatch[1], 10);
          if (Number.isFinite(parsedLv) && parsedLv > 0) lv = parsedLv;
        }

        var rawName = el.getAttribute('data-name') || el.getAttribute('title') || '';
        if (!rawName) {
          var nameEl = el.querySelector('.name, .mon-name, .pen-name, .p-name, b, strong');
          if (nameEl && nameEl.textContent) rawName = nameEl.textContent;
        }
        if (!rawName) rawName = fullText;

        domMons.push({
          uid: String(uid),
          name: rawName,
          lv: lv,
          expWidth: expWidth,
          expLabel: expLabel
        });
      }
    } catch (e) {
      // ignore
    }

    var domEggNames = [];
    try {
      var eggNodes = document.querySelectorAll('#pen-eggs .egg-mon[title], .egg-mon[title]');
      for (var j = 0; j < eggNodes.length; j++) {
        var emEl = eggNodes[j];
        var title = (emEl.getAttribute('title') || '').trim();
        if (!title || title.indexOf('?') !== -1 || title.indexOf('？') !== -1) continue;
        var holder = emEl.closest ? emEl.closest('[data-uid], [data-egg-uid]') : null;
        var eUid =
          emEl.getAttribute('data-uid') ||
          (holder && (holder.getAttribute('data-uid') || holder.getAttribute('data-egg-uid'))) ||
          null;
        domEggNames.push({
          index: j,
          uid: eUid ? String(eUid) : null,
          title: title
        });
      }
    } catch (e) {
      // ignore
    }

    return {
      rawSave: rawSave,
      domMons: domMons,
      domEggNames: domEggNames
    };
  }

  function applyDomSnapshotToCaches(snapshot, pension) {
    if (!snapshot) return;

    var uidToId = Object.create(null);
    var rawMons = (pension && Array.isArray(pension.mons)) ? pension.mons : [];
    for (var mIdx = 0; mIdx < rawMons.length; mIdx++) {
      var entry = rawMons[mIdx];
      var m = (entry && entry.mon && typeof entry.mon === 'object') ? entry.mon : entry;
      if (m && m.uid != null && m.id != null) {
        uidToId[String(m.uid)] = +m.id;
      }
    }
    var rawEggs = (pension && Array.isArray(pension.eggs)) ? pension.eggs : [];
    for (var eIdx = 0; eIdx < rawEggs.length; eIdx++) {
      var eg = rawEggs[eIdx];
      if (eg && eg.uid != null && eg.id != null) {
        uidToId[String(eg.uid)] = +eg.id;
      }
    }

    var domMons = Array.isArray(snapshot.domMons) ? snapshot.domMons : [];
    for (var i = 0; i < domMons.length; i++) {
      var dm = domMons[i];
      if (!dm || !dm.uid) continue;
      var uidKey = String(dm.uid);
      var prev = domPensionCache.get(uidKey) || {
        name: '',
        lv: null,
        expWidth: '',
        expLabel: ''
      };

      if (dm.expWidth) {
        prev.expWidth = dm.expWidth;
        prev.expLabel = dm.expLabel || '';
      }
      if (dm.lv != null) {
        prev.lv = dm.lv;
      }
      var cleaned = cleanMonName(dm.name || '');
      if (isValidLearnedName(cleaned)) {
        prev.name = cleaned;
        if (uidToId[uidKey]) {
          recordIdName(uidToId[uidKey], cleaned);
        }
      }
      domPensionCache.set(uidKey, prev);
    }

    var domEggNames = Array.isArray(snapshot.domEggNames) ? snapshot.domEggNames : [];
    for (var j = 0; j < domEggNames.length; j++) {
      var de = domEggNames[j];
      if (!de || !de.title) continue;
      var learnedEggName = cleanMonName(de.title);
      if (!isValidLearnedName(learnedEggName)) continue;

      var matchedEggId = null;
      if (de.uid && uidToId[String(de.uid)]) {
        matchedEggId = uidToId[String(de.uid)];
      } else if (typeof de.index === 'number' && de.index < rawEggs.length && rawEggs[de.index] && rawEggs[de.index].id != null) {
        matchedEggId = +rawEggs[de.index].id;
      }
      if (matchedEggId) {
        recordIdName(matchedEggId, learnedEggName);
      }
    }

    flushIdToNameStorage();
  }

  // ============================================================================
  // 存檔結構解析（save.pension.laid / eggs / mons / bx）
  // ============================================================================
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

    var rawName =
      egg && (egg.name || egg.speciesName || egg.zhName || egg.label || null);
    if (speciesId != null && rawName) {
      recordIdName(speciesId, String(rawName));
    }

    var uid = egg && egg.uid != null ? String(egg.uid) : null;
    var cachedUid = uid ? domPensionCache.get(uid) : null;
    var resolvedName =
      (speciesId != null && idToName[speciesId]) ||
      (cachedUid && cachedUid.name) ||
      (rawName ? cleanMonName(String(rawName)) : '') ||
      '神秘蛋';

    return {
      index: idx,
      egg: egg,
      k: egg && typeof egg.k === 'number' && Number.isInteger(egg.k) ? egg.k : null,
      uid: uid,
      laidAt: egg && egg.laidAt != null ? egg.laidAt : null,
      hatchAt: egg && egg.hatchAt != null ? egg.hatchAt : null,
      speciesId: speciesId,
      displayName: resolvedName,
      sp: egg && egg.sp ? +egg.sp : 0,
      bx: !!(egg && egg.bx),
      roll: roll,
      th: th,
      method: method,
      isShiny: isShiny
    };
  }

  function parsePensionMons(pension) {
    var rawMons = (pension && Array.isArray(pension.mons)) ? pension.mons : [];
    var dittos = [];
    var parentPool = [];
    var blockedMons = [];
    var allParsed = [];
    var warnings = [];
    var firstMonKeys = [];
    var firstEntryKeys = [];

    for (var i = 0; i < rawMons.length; i++) {
      var entry = rawMons[i];
      if (!entry || typeof entry !== 'object') continue;
      var m = (entry.mon && typeof entry.mon === 'object') ? entry.mon : entry;
      if (!m || typeof m !== 'object') continue;

      if (firstMonKeys.length === 0) {
        firstEntryKeys = Object.keys(entry);
        firstMonKeys = Object.keys(m);
      }

      var id =
        m.id != null ? +m.id :
        m.speciesId != null ? +m.speciesId :
        m.pokemonId != null ? +m.pokemonId :
        m.dexId != null ? +m.dexId : null;
      if (!Number.isFinite(id)) continue;

      var uid = m.uid != null ? String(m.uid) : null;
      var cached = uid ? domPensionCache.get(uid) : null;
      var shiny = !!(m.shiny || m.isShiny);

      var rawLv =
        m.lv != null ? +m.lv :
        m.level != null ? +m.level :
        m.lvl != null ? +m.lvl :
        entry.lv != null ? +entry.lv :
        entry.level != null ? +entry.level : null;
      var lv = (rawLv != null && Number.isFinite(rawLv) && rawLv > 0)
        ? rawLv
        : (cached && cached.lv != null ? cached.lv : null);

      var expWidth = (cached && cached.expWidth) ? cached.expWidth : '';
      var expLabel = (cached && cached.expLabel) ? cached.expLabel : '';

      var noEgg = !!(m.noEgg || NO_EGG_IDS.indexOf(id) !== -1);
      var rawDomName = (cached && cached.name) || m.name || m.nickname || idToName[id] || '';
      var domName = cleanMonName(String(rawDomName));
      if (isValidLearnedName(domName)) {
        recordIdName(id, domName);
      } else if (idToName[id]) {
        domName = idToName[id];
      }

      var candy = entry.candy != null ? entry.candy : null;

      var info = {
        id: id,
        uid: uid,
        shiny: shiny,
        lv: lv,
        expWidth: expWidth,
        expLabel: expLabel,
        noEgg: noEgg,
        domName: domName || null,
        candy: candy,
        isDitto: id === DITTO_ID,
        slotNum: null
      };

      allParsed.push(info);

      if (id === DITTO_ID) {
        dittos.push(info);
      } else if (noEgg) {
        blockedMons.push(info);
        warnings.push((domName || '寶可夢') + ' 為不可生蛋品種');
      } else {
        info.slotNum = parentPool.length + 1;
        parentPool.push(info);
      }
    }

    flushIdToNameStorage();

    if (dittos.length >= 2 && parentPool.length === 0) {
      warnings.push('僅放置百變怪無法生蛋');
    }

    var shinyParentCount = 0;
    for (var p = 0; p < parentPool.length; p++) {
      if (parentPool[p].shiny) shinyParentCount++;
    }
    var hasShinyDitto = false;
    for (var d = 0; d < dittos.length; d++) {
      if (dittos[d].shiny) hasShinyDitto = true;
    }

    var summaryParts = [];
    if (dittos.length > 0) {
      summaryParts.push(
        '百變怪' +
        (dittos.length > 1 ? '×' + dittos.length : '') +
        (hasShinyDitto ? '(✦閃光)' : '')
      );
    }
    if (parentPool.length > 0) {
      summaryParts.push(
        parentPool.length + '隻親代' +
        (shinyParentCount > 0 ? '（含' + shinyParentCount + '隻閃光）' : '（無閃光）')
      );
    }
    if (summaryParts.length === 0 && blockedMons.length > 0) {
      summaryParts.push('不可生蛋×' + blockedMons.length);
    }
    var summaryText = summaryParts.length > 0 ? summaryParts.join(' + ') : '目前未放置親代';

    return {
      allMons: allParsed,
      dittos: dittos,
      parentPool: parentPool,
      blockedMons: blockedMons,
      shinyParentCount: shinyParentCount,
      hasShinyDitto: hasShinyDitto,
      summaryText: summaryText,
      warnings: warnings,
      firstEntryKeys: firstEntryKeys,
      firstMonKeys: firstMonKeys
    };
  }

  function extractGameState(save, snapshot) {
    var seed = trainerSeed(save);
    var pension = (save && save.pension && typeof save.pension === 'object') ? save.pension : null;

    applyDomSnapshotToCaches(snapshot, pension);
    var pensionInfo = parsePensionMons(pension);

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
        monsCount: Array.isArray(pension.mons) ? pension.mons.length : 0,
        firstEntryKeys: pensionInfo.firstEntryKeys,
        firstMonKeys: pensionInfo.firstMonKeys,
        mons: pensionInfo.allMons.map(function (m) {
          return {
            slot: m.isDitto ? '百變怪' : (m.slotNum ? m.slotNum + '號位' : '不可生蛋'),
            id: m.id,
            uid: m.uid,
            shiny: m.shiny,
            lv: m.lv,
            exp: m.expLabel || undefined,
            noEgg: m.noEgg,
            name: m.domName || undefined
          };
        })
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
      pensionInfo: pensionInfo,
      pensionDebugSummary: pensionDebugSummary,
      topKeys: Object.keys(save)
    };
  }

  // ============================================================================
  // 生蛋序列預測引擎（完整保留）
  // ============================================================================
  function classifyMinTier(roll) {
    if (roll < TIERS[0].th) return TIERS[0];
    if (roll < TIERS[1].th) return TIERS[1];
    if (roll < TIERS[2].th) return TIERS[2];
    if (roll < TIERS[3].th) return TIERS[3];
    return null;
  }

  function resolveParentForK(k, parentPool) {
    if (!parentPool || parentPool.length === 0) return null;
    var idx = ((k % parentPool.length) + parentPool.length) % parentPool.length;
    return parentPool[idx];
  }

  function predictSequence(state, filterTier) {
    var save = state.save;
    var laid = state.laid;
    var parentPool = state.pensionInfo ? state.pensionInfo.parentPool : [];
    var maxTh = TIERS[3].th;

    var nearest = {
      base: null,
      berry: null,
      parent: null,
      parentBerry: null
    };

    var rows = [];
    var earliestShiny = null;

    for (var step = 0; step < CARD_SEARCH_MAX; step++) {
      var k = laid + step;
      var roll = eggKHash(k, save);
      var minTier = roll < maxTh ? classifyMinTier(roll) : null;
      var slotParent = resolveParentForK(k, parentPool);
      var slotNum = slotParent ? slotParent.slotNum : null;
      var slotName = slotParent ? (slotParent.domName || null) : null;

      if (minTier) {
        var hitObj = {
          k: k,
          step: step,
          roll: roll,
          minTier: minTier,
          slotNum: slotNum,
          slotName: slotName
        };

        if (!earliestShiny) earliestShiny = hitObj;
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

      if (step < LIST_TOTAL_EGGS) {
        if (filterTier === 'all' || (minTier && minTier.id === filterTier)) {
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

      if (
        step + 1 >= LIST_TOTAL_EGGS &&
        nearest.base &&
        nearest.berry &&
        nearest.parent &&
        nearest.parentBerry
      ) {
        break;
      }
    }

    var visibleLimit = Math.min(rows.length, uiState.visibleCount);

    return {
      laid: laid,
      nearest: nearest,
      earliestShiny: earliestShiny,
      totalRows: rows.length,
      rows: rows.slice(0, visibleLimit),
      hasMore: visibleLimit < rows.length
    };
  }

  // ============================================================================
  // chrome.storage.local 偏好與本地 idToName 快取存取
  // ============================================================================
  function loadUiPrefs(cb) {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([STORAGE_KEY, ID_NAME_STORAGE_KEY], function (res) {
          var saved = res && res[STORAGE_KEY];
          if (saved && typeof saved === 'object') {
            if (saved.activeTab === 'predict' || saved.activeTab === 'eggs') uiState.activeTab = saved.activeTab;
            if (typeof saved.filterTier === 'string') uiState.filterTier = saved.filterTier;
          }
          var savedNames = res && res[ID_NAME_STORAGE_KEY];
          if (savedNames && typeof savedNames === 'object') {
            var keys = Object.keys(savedNames);
            for (var i = 0; i < keys.length; i++) {
              var k = keys[i];
              if (isValidLearnedName(savedNames[k])) {
                idToName[k] = savedNames[k];
              }
            }
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
          filterTier: uiState.filterTier
        };
        chrome.storage.local.set(payload);
      }
    } catch (e) {
      // ignore
    }
  }

  // ============================================================================
  // 按需單次讀取目前分頁快照
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

          var snapshot = results && results[0] && results[0].result ? results[0].result : null;
          if (!snapshot) {
            currentView = 'error';
            currentErrorText = '未取得遊戲分頁快照資料，請稍後再點「刷新」。';
            renderUI();
            return;
          }

          var save = parseSaveRaw(snapshot.rawSave);
          currentState = save ? extractGameState(save, snapshot) : null;
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
    if (!hit) return '> ' + CARD_SEARCH_MAX + ' 顆';
    if (hit.step === 0) return '下一顆是！';
    return '再過 ' + hit.step + ' 顆';
  }

  function renderMonRow(slotLabel, mon) {
    var nameHtml = '';
    if (mon.domName && (!mon.isDitto || mon.domName !== '百變怪')) {
      nameHtml = '<span class="mon-name">' + escapeHtml(mon.domName) + '</span>';
    }

    var midHtml = '';
    if (mon.lv != null || mon.expWidth) {
      midHtml =
        '<div class="mon-mid">' +
        '<div class="mon-lv-row">' +
        '<span class="mon-lv">' + (mon.lv != null ? 'Lv.' + mon.lv : '') + '</span>' +
        (mon.expLabel ? '<span class="mon-exp-pct">' + escapeHtml(mon.expLabel) + '</span>' : '') +
        '</div>' +
        (mon.expWidth
          ? '<div class="mon-gauge"><i class="mon-gauge-fill" style="width:' + escapeHtml(mon.expWidth) + ';"></i></div>'
          : '') +
        '</div>';
    }

    return (
      '<div class="mon-row' + (mon.shiny ? ' shiny' : '') + '">' +
      '<div class="mon-left">' +
      '<span class="mon-slot">' + escapeHtml(slotLabel) + '</span>' +
      nameHtml +
      (mon.shiny ? '<span class="shiny-mark">✦閃光</span>' : '') +
      '</div>' +
      midHtml +
      '</div>'
    );
  }

  function renderPensionSection(pensionInfo) {
    if (!pensionInfo) return '';
    var html = '<div class="pension-box">';
    html += '<div class="pension-summary">培育屋：' + escapeHtml(pensionInfo.summaryText) + '</div>';

    if (pensionInfo.allMons.length > 0) {
      html += '<div class="pension-list">';
      for (var d = 0; d < pensionInfo.dittos.length; d++) {
        html += renderMonRow('百變怪', pensionInfo.dittos[d]);
      }
      for (var p = 0; p < pensionInfo.parentPool.length; p++) {
        var pm = pensionInfo.parentPool[p];
        html += renderMonRow(pm.slotNum + '號位', pm);
      }
      for (var b = 0; b < pensionInfo.blockedMons.length; b++) {
        html += renderMonRow('不可生蛋', pensionInfo.blockedMons[b]);
      }
      html += '</div>';
    }

    for (var w = 0; w < pensionInfo.warnings.length; w++) {
      html += '<div class="pension-warn">⚠️ ' + escapeHtml(pensionInfo.warnings[w]) + '</div>';
    }
    html += '</div>';
    return html;
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
    var pred = state ? predictSequence(state, uiState.filterTier) : null;

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
      // 1. 頂部狀態列
      html +=
        '<div class="status-bar">' +
        '<div class="status-k">目前孵蛋數 <strong>k=' + state.laid + '</strong></div>' +
        '<div class="status-bx' + (state.berryActive ? ' eaten' : '') + '">' +
        '靛莓果：' + (state.berryActive ? '已吃' : '未吃') +
        '</div>' +
        '</div>';

      // 2. 培育屋親代顯示
      html += renderPensionSection(state.pensionInfo);

      // 分頁切換
      html +=
        '<div class="tabs">' +
        '<button type="button" class="tab-btn' + (uiState.activeTab === 'predict' ? ' active' : '') + '" data-tab="predict">序列預測</button>' +
        '<button type="button" class="tab-btn' + (uiState.activeTab === 'eggs' ? ' active' : '') + '" data-tab="eggs">' +
        '持有蛋 (' + state.eggs.length + (hasShinyHeld ? ' / ✨' + state.shinyEggs.length : '') + ')' +
        '</button>' +
        '</div>';

      if (uiState.activeTab === 'predict') {
        // 3. 四張摘要卡
        html += '<div class="radar-grid">';
        for (var t = 0; t < TIERS.length; t++) {
          var tier = TIERS[t];
          var hit = pred.nearest[tier.id];
          var isSel = uiState.filterTier === tier.id;
          var isHot = !!(hit && hit.step === 0);
          var subText = hit
            ? 'k=' + hit.k + (hit.slotNum != null ? ' · ' + hit.slotNum + '號位' : '')
            : '範圍內無命中';

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

        // 區塊標題
        html +=
          '<div class="toolbar">' +
          '<div class="section-title">生蛋預測（' + LIST_TOTAL_EGGS + '顆內）</div>' +
          (uiState.filterTier !== 'all'
            ? '<button type="button" class="clear-filter-btn" id="pkc-clear-filter">顯示全部蛋序</button>'
            : '') +
          '</div>';

        // 4. 生蛋預測列表（1000 顆內，分批 200 筆）
        html += '<div class="pred-list" id="pkc-pred-list">';
        if (pred.rows.length === 0) {
          html += '<div class="empty">目前 ' + LIST_TOTAL_EGGS + ' 顆範圍內無符合條件的結果</div>';
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
        // 持有蛋頁籤：清單卡片（閃光蛋加金框與 ✨ 閃光 標籤）
        html += '<div class="egg-list" id="pkc-egg-list">';
        if (state.eggs.length === 0) {
          html += '<div class="empty">目前沒有持有任何蛋</div>';
        } else {
          var parentPool = state.pensionInfo ? state.pensionInfo.parentPool : [];
          for (var eIdx = 0; eIdx < state.eggs.length; eIdx++) {
            var eg = state.eggs[eIdx];
            var kText = eg.k != null ? 'k=' + eg.k : eg.method;
            var parentCond =
              eg.sp === 2
                ? (eg.bx ? '吃果閃光親代' : '閃光親代')
                : eg.sp
                  ? (eg.bx ? '吃果舊版閃光親代' : '舊版閃光親代')
                  : (eg.bx ? '吃果普通親代' : '普通親代');
            var slotParent = eg.k != null ? resolveParentForK(eg.k, parentPool) : null;
            var sourceParts = [kText];
            if (slotParent) {
              sourceParts.push(
                slotParent.slotNum + '號位' + (slotParent.domName ? ' ' + slotParent.domName : '')
              );
            }
            sourceParts.push(parentCond);

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
              '</div>';
          }
        }
        html += '</div>';
      }

      if (uiState.showDebug) {
        var firstMonKeysText =
          state.pensionInfo && state.pensionInfo.firstMonKeys && state.pensionInfo.firstMonKeys.length > 0
            ? state.pensionInfo.firstMonKeys.join(', ')
            : '（無親代資料）';
        var firstEntryKeysText =
          state.pensionInfo && state.pensionInfo.firstEntryKeys && state.pensionInfo.firstEntryKeys.length > 0
            ? state.pensionInfo.firstEntryKeys.join(', ')
            : '（無親代資料）';
        html +=
          '<div class="debug-box">' +
          '<strong>Seed (trainerSeed):</strong> ' + escapeHtml(state.seed) + '<br>' +
          '<strong>k 來源:</strong> ' + escapeHtml(state.kSource) + '<br>' +
          '<strong>Object.keys(save):</strong> ' + escapeHtml(state.topKeys.join(', ')) + '<br>' +
          '<strong>Object.keys(pension.mons[0]):</strong> ' + escapeHtml(firstEntryKeysText) + '<br>' +
          '<strong>Object.keys(mon):</strong> ' + escapeHtml(firstMonKeysText) + '<br>' +
          '<strong>save.pension 摘要:</strong><br>' +
          escapeHtml(JSON.stringify(state.pensionDebugSummary, null, 2)) +
          '</div>';
      }
    }

    html += '</div>'; // .body
    html +=
      '<div class="footer">' +
      '<span>' + (state ? 'Seed: ' + escapeHtml(state.seed) : '純 Popup 按需唯讀 · 零網路請求') + '</span>' +
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

    var loadMoreBtn = document.getElementById('pkc-load-more');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        uiState.visibleCount = Math.min(LIST_TOTAL_EGGS, uiState.visibleCount + LIST_PAGE_SIZE);
        renderUI();
      });
    }
  }

  // 啟動入口：先載入本地快取，再單次唯讀目前分頁快照
  loadUiPrefs(function () {
    fetchSnapshotFromActiveTab();
  });
})();
