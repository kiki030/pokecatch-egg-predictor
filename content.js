(function () {
  'use strict';

  if (window.__PKC_EGG_SHINY_PREDICTOR__) return;
  window.__PKC_EGG_SHINY_PREDICTOR__ = true;

  // ============================================================================
  // 核心演算法（逐字保留常數與位元運算）
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
  // 常數與狀態
  // ============================================================================
  const SAVE_KEY = 'gachamon-save-v1';
  const STORAGE_KEY = 'pkc_egg_predictor_ui_v1';
  const ID_NAME_STORAGE_KEY = 'pkc_id_to_name_v1';
  const HOST_ID = 'pkc-egg-predictor-host';
  const GOLD_STYLE_ID = 'pkc-shiny-egg-gold-style';
  const GOLD_CLASS = 'pkc-shiny-egg-gold';
  const GOLD_REL_CLASS = 'pkc-shiny-egg-rel';
  const POLL_INTERVAL_MS = 1200;

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
    collapsed: false,
    activeTab: 'predict', // 'predict' | 'eggs'
    filterTier: 'all', // 'all' | 'base' | 'berry' | 'parent' | 'parentBerry'
    visibleCount: LIST_PAGE_SIZE,
    showDebug: false,
    pos: null // { right, bottom }
  };

  // 以 uid 為 key 的純本地記憶體快取：{ name, lv, expWidth, expLabel, imgSrc, isDomImg }
  const domPensionCache = new Map();

  // 以 mon.id 為 key 的純本地寶可夢名稱快取（同步暫存於 chrome.storage.local）
  const idToName = Object.create(null);
  idToName[DITTO_ID] = '百變怪';
  let idToNameDirty = false;

  let lastRawSave = null;
  let lastRenderSig = null;
  let currentState = null;
  let lastDomMatchInfo = { matched: 0, totalShiny: 0 };
  let shadowRoot = null;
  let hostEl = null;
  let mutationTimer = null;
  let observer = null;
  let pollTimer = null;

  // ============================================================================
  // 唯讀存檔解析（容錯雙重 JSON 與 { data / save / state } 外層包裹）
  // ============================================================================
  function readRawSave() {
    try {
      return window.localStorage.getItem(SAVE_KEY);
    } catch (e) {
      return null;
    }
  }

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
  // 純本地寶可夢名稱快取（idToName）與 DOM 擷取（#pen-res 與 #pen-eggs）
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

  function refreshDomPensionInfo(pension) {
    try {
      // 建立當前存檔 uid -> mon.id 對照表，以便將 DOM 抓到的名稱寫入 idToName[id]
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

      // 1. 掃描培育屋親代 DOM（#pen-res .pen-res[data-uid]）
      var nodes = document.querySelectorAll('#pen-res .pen-res[data-uid], .pen-res[data-uid]');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var uid = el.getAttribute('data-uid');
        if (!uid) continue;
        var uidKey = String(uid);
        var prev = domPensionCache.get(uidKey) || {
          name: '',
          lv: null,
          expWidth: '',
          expLabel: '',
          imgSrc: '',
          isDomImg: false
        };

        var imgEl = el.querySelector('img');
        if (imgEl) {
          var src = imgEl.getAttribute('src') || imgEl.src || '';
          if (src && src.trim()) {
            prev.imgSrc = src.trim();
            prev.isDomImg = true;
          }
        }

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
              prev.expWidth = clamped + '%';
              prev.expLabel = Math.round(clamped) + '%';
            }
          }
        }

        var fullText = el.textContent || '';
        var lvMatch = fullText.match(/(?:Lv|Niv|Level)\.?\s*(\d+)/i);
        if (lvMatch) {
          var parsedLv = parseInt(lvMatch[1], 10);
          if (Number.isFinite(parsedLv) && parsedLv > 0) {
            prev.lv = parsedLv;
          }
        }

        var name = '';
        var dataName = el.getAttribute('data-name') || el.getAttribute('title');
        if (dataName) name = cleanMonName(dataName);
        if (!name && imgEl) {
          var alt = cleanMonName(imgEl.getAttribute('alt') || '');
          if (alt && !/^(mon|pokemon|egg|sprite)$/i.test(alt)) {
            name = alt;
          }
        }
        if (!name) {
          var nameEl = el.querySelector('.name, .mon-name, .pen-name, .p-name, b, strong');
          if (nameEl && nameEl.textContent) {
            name = cleanMonName(nameEl.textContent);
          }
        }
        if (!name && fullText) {
          var cleaned = cleanMonName(fullText);
          if (cleaned && cleaned.length <= 16) {
            name = cleaned;
          }
        }
        if (isValidLearnedName(name)) {
          prev.name = name;
          if (uidToId[uidKey]) {
            recordIdName(uidToId[uidKey], name);
          }
        }

        domPensionCache.set(uidKey, prev);
      }

      // 2. 掃描培育屋蛋卡 DOM（#pen-eggs .egg-mon[title]，排除 ???）
      var eggMonNodes = document.querySelectorAll('#pen-eggs .egg-mon[title], .egg-mon[title]');
      for (var j = 0; j < eggMonNodes.length; j++) {
        var emEl = eggMonNodes[j];
        var rawTitle = emEl.getAttribute('title') || '';
        if (!rawTitle || rawTitle.indexOf('?') !== -1 || rawTitle.indexOf('？') !== -1) continue;
        var learnedEggName = cleanMonName(rawTitle);
        if (!isValidLearnedName(learnedEggName)) continue;

        // 嘗試從自身或父層 data-uid 對照 egg.id，或依序對照 rawEggs[j]
        var holder = emEl.closest ? emEl.closest('[data-uid], [data-egg-uid]') : null;
        var eUid =
          emEl.getAttribute('data-uid') ||
          (holder && (holder.getAttribute('data-uid') || holder.getAttribute('data-egg-uid'))) ||
          null;

        var matchedEggId = null;
        if (eUid && uidToId[String(eUid)]) {
          matchedEggId = uidToId[String(eUid)];
        } else if (j < rawEggs.length && rawEggs[j] && rawEggs[j].id != null) {
          matchedEggId = +rawEggs[j].id;
        }

        if (matchedEggId) {
          recordIdName(matchedEggId, learnedEggName);
        }
      }

      flushIdToNameStorage();
    } catch (e) {
      // ignore DOM read error
    }
  }

  // ============================================================================
  // 存檔結構解析（save.pension.laid / eggs / mons / bx）
  // ============================================================================
  function getFallbackMonImg(id, shiny) {
    return 'assets/pokemon/' + (shiny ? 'shiny/' : '') + id + '.png';
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

    var imgSrc = speciesId != null ? getFallbackMonImg(speciesId, isShiny) : '';

    return {
      index: idx,
      egg: egg,
      k: egg && typeof egg.k === 'number' && Number.isInteger(egg.k) ? egg.k : null,
      uid: uid,
      laidAt: egg && egg.laidAt != null ? egg.laidAt : null,
      hatchAt: egg && egg.hatchAt != null ? egg.hatchAt : null,
      speciesId: speciesId,
      displayName: resolvedName,
      imgSrc: imgSrc,
      sp: egg && egg.sp ? +egg.sp : 0,
      bx: !!(egg && egg.bx),
      roll: roll,
      th: th,
      method: method,
      isShiny: isShiny
    };
  }

  function parsePensionMons(pension) {
    refreshDomPensionInfo(pension);

    var rawMons = (pension && Array.isArray(pension.mons)) ? pension.mons : [];
    var dittos = [];
    var parentPool = []; // 可生蛋非百變怪親代（1號位、2號位、3號位...）
    var blockedMons = []; // noEgg 或 NO_EGG_IDS
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

      var hasDomImg = !!(cached && cached.imgSrc);
      var imgSrc = hasDomImg ? cached.imgSrc : getFallbackMonImg(id, shiny);
      var isStaticFallback = !hasDomImg || imgSrc.indexOf('data:') !== 0;
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
        imgSrc: imgSrc,
        isStaticFallback: isStaticFallback,
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

  function extractGameState(save) {
    var seed = trainerSeed(save);
    var pension = (save && save.pension && typeof save.pension === 'object') ? save.pension : null;

    // 先解析培育屋親代與 DOM 名稱快取，讓持有蛋也能直接命中 idToName
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
  // 資料簽名（只要簽名未變，定時輪詢絕不重繪 DOM，徹底防止滾動條跳回頂部）
  // ============================================================================
  function computeRenderSignature(state) {
    var uiSig = [
      uiState.collapsed ? 1 : 0,
      uiState.activeTab,
      uiState.filterTier,
      uiState.visibleCount,
      uiState.showDebug ? 1 : 0,
      uiState.activeTab === 'eggs' ? lastDomMatchInfo.matched : 0
    ].join(':');

    if (!state) return 'empty|' + uiSig;

    var monsSig = state.pensionInfo.allMons
      .map(function (m) {
        return [
          m.id,
          m.uid || '',
          m.shiny ? 1 : 0,
          m.lv != null ? m.lv : '',
          m.expWidth || '',
          m.noEgg ? 1 : 0,
          m.domName || '',
          m.isStaticFallback ? 'static' : 'dom'
        ].join(':');
      })
      .join(';');

    var eggsSig = state.eggs
      .map(function (e) {
        return [
          e.uid || '',
          e.k != null ? e.k : '',
          e.speciesId != null ? e.speciesId : '',
          e.displayName || '',
          e.sp,
          e.bx ? 1 : 0,
          e.isShiny ? 1 : 0
        ].join(':');
      })
      .join(';');

    return [
      state.seed,
      state.laid,
      state.berryActive ? 1 : 0,
      monsSig,
      eggsSig,
      uiSig
    ].join('|');
  }

  // ============================================================================
  // 生蛋序列預測引擎（上方 4 張摘要卡往後找第一筆色違 + 下方列出 1000 顆全部蛋序）
  // ============================================================================
  function classifyMinTier(roll) {
    if (roll < TIERS[0].th) return TIERS[0]; // 普通親代: roll < 1/512
    if (roll < TIERS[1].th) return TIERS[1]; // 吃果普通親代: 1/512 <= roll < 1/256
    if (roll < TIERS[2].th) return TIERS[2]; // 閃光親代: 1/256 <= roll < 1/16
    if (roll < TIERS[3].th) return TIERS[3]; // 吃果閃光親代: 1/16 <= roll < 1/8
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
    var maxTh = TIERS[3].th; // 1/8 = 0.125

    // 上方 4 張摘要卡：各自往後找對應互斥區間的第一筆色違（最多掃描 8000 顆避免空白）
    var nearest = {
      base: null,        // roll < 1/512
      berry: null,       // 1/512 <= roll < 1/256
      parent: null,      // 1/256 <= roll < 1/16
      parentBerry: null  // 1/16 <= roll < 1/8
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

      // 下方生蛋預測列表：列出 step = 0 .. 999（1000 顆內）的每一顆蛋
      if (step < LIST_TOTAL_EGGS) {
        if (filterTier === 'all' || (minTier && minTier.id === filterTier)) {
          rows.push({
            k: k,
            step: step,
            roll: roll,
            minTier: minTier, // null 代表一般（非色違）蛋
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
  // DOM 色違蛋金框提示（零子節點入侵，相容 React / Vue）
  // ============================================================================
  function ensureGoldStyle() {
    if (document.getElementById(GOLD_STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = GOLD_STYLE_ID;
    style.textContent = [
      '.' + GOLD_REL_CLASS + ' { position: relative !important; }',
      '.' + GOLD_CLASS + ' {',
      '  outline: 2.5px solid #ffd700 !important;',
      '  outline-offset: -1px !important;',
      '  border-color: #ffd700 !important;',
      '  box-shadow: 0 0 0 2px rgba(255, 215, 0, 0.45), 0 0 14px 3px rgba(255, 196, 0, 0.8), inset 0 0 10px rgba(255, 215, 0, 0.25) !important;',
      '  animation: pkc-shiny-gold-pulse 1.8s ease-in-out infinite !important;',
      '}',
      '.' + GOLD_CLASS + '::after {',
      '  content: attr(data-pkc-shiny-label);',
      '  position: absolute !important;',
      '  top: 4px !important;',
      '  right: 4px !important;',
      '  z-index: 20 !important;',
      '  background: linear-gradient(135deg, #fff5a8 0%, #f5b700 55%, #c97a00 100%) !important;',
      '  color: #1f1400 !important;',
      '  font-size: 10px !important;',
      '  font-weight: 800 !important;',
      '  line-height: 1.1 !important;',
      '  padding: 2px 6px !important;',
      '  border-radius: 999px !important;',
      '  border: 1px solid #fff8cc !important;',
      '  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45) !important;',
      '  pointer-events: none !important;',
      '  white-space: nowrap !important;',
      '  letter-spacing: 0.3px !important;',
      '}',
      '@keyframes pkc-shiny-gold-pulse {',
      '  0%, 100% {',
      '    box-shadow: 0 0 0 2px rgba(255, 215, 0, 0.45), 0 0 12px 2px rgba(255, 196, 0, 0.72), inset 0 0 8px rgba(255, 215, 0, 0.2);',
      '  }',
      '  50% {',
      '    box-shadow: 0 0 0 3px rgba(255, 236, 128, 0.9), 0 0 20px 5px rgba(255, 200, 0, 0.96), inset 0 0 14px rgba(255, 228, 92, 0.35);',
      '  }',
      '}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  function isInsideOurHost(el) {
    return !!(hostEl && (el === hostEl || hostEl.contains(el)));
  }

  function isCardSizedVisible(el) {
    if (!el || el.nodeType !== 1 || isInsideOurHost(el)) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width < 28 || rect.height < 28) return false;
    if (rect.width > window.innerWidth * 0.92 || rect.height > window.innerHeight * 0.75) return false;
    return true;
  }

  function findBestCardAncestor(el) {
    var cur = el;
    var best = null;
    for (var depth = 0; depth < 5 && cur && cur !== document.body; depth++) {
      if (isCardSizedVisible(cur)) {
        var rect = cur.getBoundingClientRect();
        if (rect.width >= 48 && rect.height >= 40 && rect.width <= 520 && rect.height <= 360) {
          best = cur;
          var parent = cur.parentElement;
          if (parent && parent.children.length >= 2) {
            var sameTagSiblings = 0;
            for (var s = 0; s < parent.children.length; s++) {
              if (parent.children[s].tagName === cur.tagName) sameTagSiblings++;
            }
            if (sameTagSiblings >= 2) return cur;
          }
        }
      }
      cur = cur.parentElement;
    }
    return best;
  }

  function clearAllGoldHighlights() {
    var marked = document.querySelectorAll('.' + GOLD_CLASS);
    for (var i = 0; i < marked.length; i++) {
      marked[i].classList.remove(GOLD_CLASS);
      marked[i].classList.remove(GOLD_REL_CLASS);
      marked[i].removeAttribute('data-pkc-shiny-label');
    }
  }

  function syncDomHighlights(state) {
    if (!state || !state.shinyEggs || state.shinyEggs.length === 0) {
      clearAllGoldHighlights();
      lastDomMatchInfo = { matched: 0, totalShiny: 0 };
      return lastDomMatchInfo;
    }

    ensureGoldStyle();

    var eggs = state.eggs;
    var shinyEggs = state.shinyEggs;
    var matchedMap = new Map();

    var shinyUidMap = Object.create(null);
    var shinyKMap = Object.create(null);
    for (var i = 0; i < shinyEggs.length; i++) {
      var se = shinyEggs[i];
      if (se.uid) shinyUidMap[se.uid] = se;
      if (se.k != null) shinyKMap[String(se.k)] = se;
    }

    var attrEls = document.querySelectorAll('[data-egg-uid], [data-uid], [data-egg-id], [data-egg-k], [data-k]');
    for (var a = 0; a < attrEls.length; a++) {
      var el = attrEls[a];
      if (!isCardSizedVisible(el)) continue;
      var uidVal = el.getAttribute('data-egg-uid') || el.getAttribute('data-uid') || el.getAttribute('data-egg-id');
      var kVal = el.getAttribute('data-egg-k') || el.getAttribute('data-k');
      var hit = (uidVal && shinyUidMap[uidVal]) || (kVal && shinyKMap[kVal]) || null;
      if (hit) {
        matchedMap.set(el, '✨ 色違蛋' + (hit.k != null ? ' k=' + hit.k : ''));
      }
    }

    if (matchedMap.size < shinyEggs.length && eggs.length > 0) {
      var eggMarkers = [];
      var candidateNodes = document.querySelectorAll(
        '[class*="egg" i], img[src*="egg" i], img[alt*="egg" i], img[alt*="蛋"]'
      );
      for (var c = 0; c < candidateNodes.length; c++) {
        if (!isInsideOurHost(candidateNodes[c])) eggMarkers.push(candidateNodes[c]);
      }

      if (document.body) {
        var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        var node;
        while ((node = walker.nextNode())) {
          if (node.nodeValue && node.nodeValue.indexOf('🥚') !== -1) {
            var parentEl = node.parentElement;
            if (parentEl && !isInsideOurHost(parentEl)) {
              eggMarkers.push(parentEl);
            }
          }
        }
      }

      var parentGroups = new Map();
      for (var m = 0; m < eggMarkers.length; m++) {
        var card = findBestCardAncestor(eggMarkers[m]);
        if (!card || !card.parentElement) continue;
        var p = card.parentElement;
        if (!parentGroups.has(p)) parentGroups.set(p, new Set());
        parentGroups.get(p).add(card);
      }

      parentGroups.forEach(function (cardSet, parentEl) {
        var ordered = [];
        for (var idx = 0; idx < parentEl.children.length; idx++) {
          var ch = parentEl.children[idx];
          if (cardSet.has(ch)) ordered.push(ch);
        }
        if (ordered.length === eggs.length) {
          for (var eIdx = 0; eIdx < eggs.length; eIdx++) {
            if (eggs[eIdx].isShiny) {
              var lbl = '✨ 色違蛋' + (eggs[eIdx].k != null ? ' k=' + eggs[eIdx].k : ' #' + (eIdx + 1));
              matchedMap.set(ordered[eIdx], lbl);
            }
          }
        }
      });

      if (matchedMap.size === 0 && shinyEggs.length === eggs.length) {
        parentGroups.forEach(function (cardSet) {
          if (cardSet.size > 0 && cardSet.size <= eggs.length) {
            cardSet.forEach(function (cardEl) {
              matchedMap.set(cardEl, '✨ 色違蛋');
            });
          }
        });
      }
    }

    var existing = document.querySelectorAll('.' + GOLD_CLASS);
    for (var x = 0; x < existing.length; x++) {
      if (!matchedMap.has(existing[x])) {
        existing[x].classList.remove(GOLD_CLASS);
        existing[x].classList.remove(GOLD_REL_CLASS);
        existing[x].removeAttribute('data-pkc-shiny-label');
      }
    }

    matchedMap.forEach(function (label, targetEl) {
      if (!targetEl.classList.contains(GOLD_CLASS)) {
        if (window.getComputedStyle(targetEl).position === 'static') {
          targetEl.classList.add(GOLD_REL_CLASS);
        }
        targetEl.classList.add(GOLD_CLASS);
      }
      if (targetEl.getAttribute('data-pkc-shiny-label') !== label) {
        targetEl.setAttribute('data-pkc-shiny-label', label);
      }
    });

    lastDomMatchInfo = {
      matched: matchedMap.size,
      totalShiny: shinyEggs.length
    };
    return lastDomMatchInfo;
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
            if (typeof saved.collapsed === 'boolean') uiState.collapsed = saved.collapsed;
            if (saved.activeTab === 'predict' || saved.activeTab === 'eggs') uiState.activeTab = saved.activeTab;
            if (typeof saved.filterTier === 'string') uiState.filterTier = saved.filterTier;
            if (saved.pos && typeof saved.pos.right === 'number' && typeof saved.pos.bottom === 'number') {
              uiState.pos = saved.pos;
            }
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
          collapsed: uiState.collapsed,
          activeTab: uiState.activeTab,
          filterTier: uiState.filterTier,
          pos: uiState.pos
        };
        chrome.storage.local.set(payload);
      }
    } catch (e) {
      // ignore
    }
  }

  // ============================================================================
  // Shadow DOM 浮動介面
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

  function getShadowStyles() {
    return [
      ':host {',
      '  all: initial;',
      '  position: fixed;',
      '  right: 16px;',
      '  bottom: 16px;',
      '  z-index: 2147483640;',
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", "Microsoft JhengHei", sans-serif;',
      '  font-size: 12px;',
      '  color: #eef2f8;',
      '  user-select: none;',
      '}',
      '* { box-sizing: border-box; }',
      '.pill {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '  padding: 8px 12px;',
      '  border-radius: 999px;',
      '  background: rgba(15, 20, 32, 0.94);',
      '  border: 1.5px solid rgba(148, 163, 184, 0.35);',
      '  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);',
      '  cursor: pointer;',
      '  color: #f1f5f9;',
      '  font-weight: 600;',
      '  transition: transform 0.12s ease, border-color 0.15s ease;',
      '}',
      '.pill:hover { transform: translateY(-1px); border-color: #ffd700; }',
      '.pill.has-shiny {',
      '  border-color: #ffd700;',
      '  box-shadow: 0 0 0 2px rgba(255, 215, 0, 0.3), 0 8px 24px rgba(245, 183, 0, 0.35);',
      '}',
      '.pill-badge {',
      '  padding: 2px 7px;',
      '  border-radius: 999px;',
      '  font-size: 11px;',
      '  font-weight: 700;',
      '  background: rgba(255, 255, 255, 0.1);',
      '  font-variant-numeric: tabular-nums;',
      '}',
      '.pill-badge.gold {',
      '  background: linear-gradient(135deg, #fff2a1, #f5b700);',
      '  color: #2b1700;',
      '}',
      '.panel {',
      '  width: 372px;',
      '  max-width: calc(100vw - 24px);',
      '  max-height: calc(100vh - 32px);',
      '  display: flex;',
      '  flex-direction: column;',
      '  background: rgba(13, 18, 30, 0.96);',
      '  backdrop-filter: blur(10px);',
      '  border: 1px solid rgba(148, 163, 184, 0.28);',
      '  border-radius: 14px;',
      '  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.58);',
      '  overflow: hidden;',
      '}',
      '.panel.has-shiny { border-color: rgba(255, 215, 0, 0.75); }',
      '.header {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  padding: 9px 12px;',
      '  background: linear-gradient(180deg, rgba(30, 41, 59, 0.92), rgba(15, 23, 42, 0.92));',
      '  border-bottom: 1px solid rgba(148, 163, 184, 0.18);',
      '  cursor: grab;',
      '}',
      '.header:active { cursor: grabbing; }',
      '.title { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 13px; color: #f8fafc; }',
      '.header-actions { display: flex; align-items: center; gap: 5px; }',
      '.icon-btn {',
      '  border: 1px solid rgba(148, 163, 184, 0.25);',
      '  background: rgba(30, 41, 59, 0.7);',
      '  color: #cbd5e1;',
      '  border-radius: 6px;',
      '  padding: 3px 8px;',
      '  font-size: 11px;',
      '  cursor: pointer;',
      '}',
      '.icon-btn:hover { background: rgba(51, 65, 85, 0.9); color: #fff; border-color: rgba(255, 215, 0, 0.55); }',
      '.body { padding: 10px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }',
      '.status-bar {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 8px;',
      '  padding: 7px 10px;',
      '  border-radius: 9px;',
      '  background: rgba(30, 41, 59, 0.62);',
      '  border: 1px solid rgba(255, 215, 0, 0.24);',
      '  font-variant-numeric: tabular-nums;',
      '}',
      '.status-k { font-size: 12px; font-weight: 700; color: #f1f5f9; }',
      '.status-k strong { color: #ffd700; font-size: 13px; }',
      '.status-bx {',
      '  font-size: 11px;',
      '  font-weight: 700;',
      '  padding: 2px 8px;',
      '  border-radius: 999px;',
      '  border: 1px solid rgba(148, 163, 184, 0.3);',
      '  background: rgba(15, 23, 42, 0.75);',
      '  color: #94a3b8;',
      '}',
      '.status-bx.eaten {',
      '  border-color: #f5b700;',
      '  background: rgba(245, 183, 0, 0.18);',
      '  color: #fde047;',
      '}',
      '.pension-box {',
      '  padding: 8px 10px;',
      '  border-radius: 9px;',
      '  background: rgba(30, 41, 59, 0.48);',
      '  border: 1px solid rgba(148, 163, 184, 0.18);',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 6px;',
      '}',
      '.pension-summary { font-size: 11px; font-weight: 700; color: #e2e8f0; }',
      /* 培育屋固定垂直列排版：三段式佈局 + 最大化 48x48 寶可夢圖片（上移垂直置中） */
      '.pension-list { display: flex; flex-direction: column; gap: 6px; }',
      '.mon-row {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 8px;',
      '  width: 100%;',
      '  min-height: 52px;',
      '  padding: 4px 10px;',
      '  border-radius: 8px;',
      '  background: rgba(15, 23, 42, 0.85);',
      '  border: 1px solid rgba(148, 163, 184, 0.24);',
      '  font-size: 12px;',
      '  color: #e2e8f0;',
      '  font-variant-numeric: tabular-nums;',
      '}',
      '.mon-row.shiny {',
      '  border-color: rgba(255, 215, 0, 0.65);',
      '  background: linear-gradient(90deg, rgba(45, 32, 8, 0.82) 0%, rgba(15, 23, 42, 0.88) 100%);',
      '}',
      '.mon-left {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 6px;',
      '  min-width: 0;',
      '  flex: 1 1 auto;',
      '  overflow: hidden;',
      '}',
      '.mon-slot {',
      '  font-weight: 800;',
      '  color: #f8fafc;',
      '  white-space: nowrap;',
      '  flex-shrink: 0;',
      '}',
      '.mon-row.shiny .mon-slot { color: #ffd700; }',
      '.mon-name {',
      '  font-weight: 700;',
      '  color: #f1f5f9;',
      '  white-space: nowrap;',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '}',
      '.shiny-mark {',
      '  color: #ffd700;',
      '  font-weight: 800;',
      '  font-size: 10.5px;',
      '  white-space: nowrap;',
      '  flex-shrink: 0;',
      '  text-shadow: 0 0 6px rgba(255, 215, 0, 0.55);',
      '}',
      '.mon-mid {',
      '  display: flex;',
      '  flex-direction: column;',
      '  justify-content: center;',
      '  gap: 3px;',
      '  width: 92px;',
      '  min-width: 54px;',
      '  flex: 0 1 92px;',
      '}',
      '.mon-lv-row {',
      '  display: flex;',
      '  align-items: baseline;',
      '  justify-content: space-between;',
      '  gap: 4px;',
      '  font-size: 10.5px;',
      '  line-height: 1.1;',
      '}',
      '.mon-lv { font-weight: 700; color: #cbd5e1; }',
      '.mon-exp-pct { font-size: 9.5px; color: #94a3b8; }',
      '.mon-gauge {',
      '  width: 100%;',
      '  height: 5px;',
      '  border-radius: 999px;',
      '  background: rgba(2, 6, 23, 0.85);',
      '  border: 1px solid rgba(148, 163, 184, 0.22);',
      '  overflow: hidden;',
      '}',
      '.mon-gauge-fill {',
      '  display: block;',
      '  height: 100%;',
      '  border-radius: 999px;',
      '  background: linear-gradient(90deg, #38bdf8 0%, #f5b700 100%);',
      '}',
      '.mon-avatar-box {',
      '  width: 48px;',
      '  height: 48px;',
      '  flex-shrink: 0;',
      '  overflow: hidden;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '}',
      '.mon-avatar {',
      '  width: 100%;',
      '  height: 100%;',
      '  object-fit: contain;',
      '  image-rendering: pixelated;',
      '  transform: translateY(-5px);',
      '  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));',
      '}',
      '.mon-avatar.fallback-scale {',
      '  transform: translateY(-5px) scale(1.65);',
      '  transform-origin: center center;',
      '}',
      '.pension-warn { color: #fca5a5; font-size: 11px; font-weight: 700; }',
      '.tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }',
      '.tab-btn {',
      '  padding: 6px 8px;',
      '  border-radius: 8px;',
      '  border: 1px solid rgba(148, 163, 184, 0.2);',
      '  background: rgba(30, 41, 59, 0.5);',
      '  color: #94a3b8;',
      '  font-weight: 700;',
      '  font-size: 12px;',
      '  cursor: pointer;',
      '}',
      '.tab-btn.active {',
      '  background: rgba(245, 183, 0, 0.18);',
      '  border-color: rgba(255, 215, 0, 0.68);',
      '  color: #fef08a;',
      '}',
      '.radar-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }',
      '.radar-card {',
      '  padding: 8px 9px;',
      '  border-radius: 9px;',
      '  border: 1px solid rgba(148, 163, 184, 0.22);',
      '  background: rgba(30, 41, 59, 0.54);',
      '  cursor: pointer;',
      '  transition: border-color 0.12s ease, background 0.12s ease;',
      '  text-align: left;',
      '}',
      '.radar-card:hover { border-color: rgba(255, 215, 0, 0.55); }',
      '.radar-card.selected { border-color: #ffd700; background: rgba(245, 183, 0, 0.16); }',
      '.radar-card.imminent {',
      '  border-color: #ffd700;',
      '  box-shadow: inset 0 0 12px rgba(255, 215, 0, 0.24), 0 0 8px rgba(255, 215, 0, 0.22);',
      '}',
      '.radar-title { font-size: 11px; color: #cbd5e1; font-weight: 700; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '.radar-dist { font-size: 14px; font-weight: 800; color: #f8fafc; font-variant-numeric: tabular-nums; margin-bottom: 2px; }',
      '.radar-dist.hot { color: #ffd700; text-shadow: 0 0 8px rgba(255, 215, 0, 0.55); }',
      '.radar-sub { font-size: 11px; color: #94a3b8; font-variant-numeric: tabular-nums; }',
      '.toolbar {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 6px;',
      '  padding: 2px 2px 0 2px;',
      '  font-size: 11px;',
      '  color: #94a3b8;',
      '}',
      '.section-title {',
      '  font-size: 12px;',
      '  font-weight: 800;',
      '  color: #f1f5f9;',
      '  font-variant-numeric: tabular-nums;',
      '}',
      '.clear-filter-btn {',
      '  background: none;',
      '  border: none;',
      '  color: #fde047;',
      '  font-size: 10.5px;',
      '  cursor: pointer;',
      '  padding: 0;',
      '  text-decoration: underline;',
      '}',
      '.pred-list {',
      '  max-height: 228px;',
      '  overflow-y: auto;',
      '  border: 1px solid rgba(148, 163, 184, 0.18);',
      '  border-radius: 9px;',
      '  background: rgba(15, 23, 42, 0.72);',
      '  display: flex;',
      '  flex-direction: column;',
      '}',
      '.pred-row {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 8px;',
      '  padding: 6px 9px;',
      '  border-bottom: 1px solid rgba(148, 163, 184, 0.1);',
      '  font-variant-numeric: tabular-nums;',
      '}',
      '.pred-row:last-child { border-bottom: none; }',
      '.pred-row.shiny-row { background: rgba(255, 215, 0, 0.09); }',
      '.pred-left { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }',
      '.pred-nth { font-weight: 700; color: #cbd5e1; font-size: 11px; white-space: nowrap; }',
      '.pred-row.shiny-row .pred-nth { color: #fef08a; }',
      '.normal-parent-text { font-size: 11px; color: #94a3b8; white-space: nowrap; }',
      '.slot-badge {',
      '  font-size: 11px;',
      '  font-weight: 700;',
      '  color: #fde047;',
      '  white-space: nowrap;',
      '}',
      '.pred-right {',
      '  font-size: 11px;',
      '  color: #94a3b8;',
      '  white-space: nowrap;',
      '  text-align: right;',
      '}',
      '.pred-right.highlight {',
      '  color: #ffd700;',
      '  font-weight: 800;',
      '  text-shadow: 0 0 8px rgba(255, 215, 0, 0.45);',
      '}',
      '.load-more-btn {',
      '  width: 100%;',
      '  padding: 8px 10px;',
      '  border: none;',
      '  border-top: 1px solid rgba(148, 163, 184, 0.16);',
      '  background: rgba(30, 41, 59, 0.75);',
      '  color: #fde047;',
      '  font-size: 11.5px;',
      '  font-weight: 700;',
      '  cursor: pointer;',
      '  text-align: center;',
      '  transition: background 0.12s ease;',
      '}',
      '.load-more-btn:hover { background: rgba(51, 65, 85, 0.95); color: #fff; }',
      /* 四種條件標籤：統一閃金色系 */
      '.tag {',
      '  display: inline-block;',
      '  padding: 2px 7px;',
      '  border-radius: 999px;',
      '  font-size: 10.5px;',
      '  font-weight: 800;',
      '  white-space: nowrap;',
      '  line-height: 1.2;',
      '}',
      /* 普通親代：亮金底深棕字 + 金色發光邊框 */
      '.tier-base {',
      '  background: #ffd700;',
      '  color: #2b1700;',
      '  border: 1px solid #fff5a8;',
      '  box-shadow: 0 0 8px rgba(255, 215, 0, 0.78);',
      '}',
      /* 吃果普通親代：漸層閃金底深棕字 + 柔和金光 */
      '.tier-berry {',
      '  background: linear-gradient(135deg, #fff2a6 0%, #f5b700 100%);',
      '  color: #2b1700;',
      '  border: 1px solid #fde047;',
      '  box-shadow: 0 0 6px rgba(245, 183, 0, 0.45);',
      '}',
      /* 閃光親代：深底金色邊框 + 金色字體 */
      '.tier-parent {',
      '  background: rgba(42, 30, 6, 0.92);',
      '  color: #ffd700;',
      '  border: 1px solid #f5b700;',
      '}',
      /* 吃果閃光親代：淡香檳金底深棕字 + 金色細框 */
      '.tier-pb {',
      '  background: #f3e3b2;',
      '  color: #362000;',
      '  border: 1px solid #d4af37;',
      '}',
      /* 持有蛋頁籤：固定 2x2 四宮格卡片（比照序列預測上方四張摘要卡） */
      '.egg-grid {',
      '  display: grid;',
      '  grid-template-columns: repeat(2, 1fr);',
      '  gap: 8px;',
      '}',
      '.egg-card {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 6px;',
      '  width: 100%;',
      '  min-height: 62px;',
      '  height: 62px;',
      '  padding: 6px 10px;',
      '  border-radius: 9px;',
      '  background: rgba(30, 41, 59, 0.54);',
      '  border: 1px solid rgba(148, 163, 184, 0.22);',
      '  overflow: hidden;',
      '}',
      '.egg-card.shiny {',
      '  border: 1.5px solid #ffd700;',
      '  background: linear-gradient(135deg, rgba(45, 32, 8, 0.85) 0%, rgba(30, 41, 59, 0.72) 100%);',
      '  box-shadow: inset 0 0 12px rgba(255, 215, 0, 0.22), 0 0 10px rgba(255, 215, 0, 0.24);',
      '}',
      '.egg-card.empty-slot {',
      '  justify-content: center;',
      '  background: rgba(30, 41, 59, 0.34);',
      '  border: 1px solid rgba(148, 163, 184, 0.14);',
      '}',
      '.egg-empty-text {',
      '  font-size: 12px;',
      '  font-weight: 600;',
      '  color: #64748b;',
      '  letter-spacing: 0.5px;',
      '}',
      '.egg-left {',
      '  display: flex;',
      '  flex-direction: column;',
      '  justify-content: center;',
      '  align-items: flex-start;',
      '  gap: 3px;',
      '  min-width: 0;',
      '  flex: 1 1 auto;',
      '  overflow: hidden;',
      '}',
      '.egg-name {',
      '  font-size: 13px;',
      '  font-weight: 800;',
      '  color: #f1f5f9;',
      '  white-space: nowrap;',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '  max-width: 100%;',
      '}',
      '.egg-card.shiny .egg-name { color: #fef08a; }',
      '.empty { padding: 16px 8px; text-align: center; color: #94a3b8; }',
      '.debug-box {',
      '  padding: 7px 8px;',
      '  border-radius: 8px;',
      '  background: rgba(2, 6, 23, 0.82);',
      '  border: 1px solid rgba(148, 163, 184, 0.22);',
      '  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;',
      '  font-size: 10px;',
      '  color: #94a3b8;',
      '  word-break: break-all;',
      '  line-height: 1.48;',
      '  max-height: 160px;',
      '  overflow-y: auto;',
      '  user-select: text;',
      '}',
      '.footer {',
      '  display: flex;',
      '  justify-content: space-between;',
      '  align-items: center;',
      '  padding: 5px 11px;',
      '  border-top: 1px solid rgba(148, 163, 184, 0.14);',
      '  background: rgba(15, 23, 42, 0.85);',
      '  font-size: 10px;',
      '  color: #64748b;',
      '}',
      '.link-btn { background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 10px; padding: 0; text-decoration: underline; }',
      '.link-btn:hover { color: #fde047; }'
    ].join('\n');
  }

  function applyHostPosition() {
    if (!hostEl) return;
    if (uiState.pos) {
      var maxR = Math.max(8, window.innerWidth - 80);
      var maxB = Math.max(8, window.innerHeight - 50);
      var r = Math.min(Math.max(8, uiState.pos.right), maxR);
      var b = Math.min(Math.max(8, uiState.pos.bottom), maxB);
      hostEl.style.right = r + 'px';
      hostEl.style.bottom = b + 'px';
    } else {
      hostEl.style.right = '16px';
      hostEl.style.bottom = '16px';
    }
  }

  function attachDragHandler(headerEl) {
    if (!headerEl || !hostEl) return;
    headerEl.addEventListener('mousedown', function (e) {
      if (e.target && e.target.closest && e.target.closest('button, input')) return;
      e.preventDefault();
      var startX = e.clientX;
      var startY = e.clientY;
      var rect = hostEl.getBoundingClientRect();
      var startRight = window.innerWidth - rect.right;
      var startBottom = window.innerHeight - rect.bottom;

      function onMove(ev) {
        var dx = ev.clientX - startX;
        var dy = ev.clientY - startY;
        var nextRight = Math.min(Math.max(8, startRight - dx), Math.max(8, window.innerWidth - rect.width - 8));
        var nextBottom = Math.min(Math.max(8, startBottom - dy), Math.max(8, window.innerHeight - rect.height - 8));
        uiState.pos = { right: Math.round(nextRight), bottom: Math.round(nextBottom) };
        applyHostPosition();
      }

      function onUp() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        saveUiPrefs();
      }

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  function ensureHost() {
    if (hostEl && shadowRoot) return;
    hostEl = document.getElementById(HOST_ID);
    if (!hostEl) {
      hostEl = document.createElement('div');
      hostEl.id = HOST_ID;
      (document.body || document.documentElement).appendChild(hostEl);
    }
    shadowRoot = hostEl.shadowRoot || hostEl.attachShadow({ mode: 'open' });
    applyHostPosition();
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

    var imgClass = 'mon-avatar' + (mon.isStaticFallback ? ' fallback-scale' : '');

    return (
      '<div class="mon-row' + (mon.shiny ? ' shiny' : '') + '">' +
      '<div class="mon-left">' +
      '<span class="mon-slot">' + escapeHtml(slotLabel) + '</span>' +
      nameHtml +
      (mon.shiny ? '<span class="shiny-mark">✦閃光</span>' : '') +
      '</div>' +
      midHtml +
      '<div class="mon-avatar-box">' +
      '<img class="' + imgClass + '" src="' + escapeHtml(mon.imgSrc) + '" alt="">' +
      '</div>' +
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
    ensureHost();

    // 重繪前記錄列表與主體的 scrollTop，重繪後立即還原
    var prevPredList = shadowRoot.getElementById('pkc-pred-list');
    var prevEggList = shadowRoot.getElementById('pkc-egg-list');
    var prevBody = shadowRoot.getElementById('pkc-panel-body');
    var savedPredScroll = prevPredList ? prevPredList.scrollTop : 0;
    var savedEggScroll = prevEggList ? prevEggList.scrollTop : 0;
    var savedBodyScroll = prevBody ? prevBody.scrollTop : 0;

    var state = currentState;
    var hasShinyHeld = !!(state && state.shinyEggs.length > 0);
    var pred = state ? predictSequence(state, uiState.filterTier) : null;

    lastRenderSig = computeRenderSignature(state);

    var html = '<style>' + getShadowStyles() + '</style>';

    if (uiState.collapsed) {
      var pillDist = '—';
      if (pred && pred.earliestShiny) {
        pillDist = pred.earliestShiny.step === 0
          ? '下一顆是！'
          : '再過 ' + pred.earliestShiny.step + ' 顆';
      }
      html +=
        '<div class="pill' + (hasShinyHeld ? ' has-shiny' : '') + '" id="pkc-expand">' +
        '<span>🥚 色違預測</span>' +
        (state ? '<span class="pill-badge">k=' + state.laid + '</span>' : '') +
        (hasShinyHeld
          ? '<span class="pill-badge gold">持有 ✨' + state.shinyEggs.length + '</span>'
          : '') +
        '<span class="pill-badge">' + escapeHtml(pillDist) + '</span>' +
        '</div>';

      shadowRoot.innerHTML = html;
      var expandBtn = shadowRoot.getElementById('pkc-expand');
      if (expandBtn) {
        expandBtn.addEventListener('click', function () {
          uiState.collapsed = false;
          saveUiPrefs();
          renderUI();
        });
      }
      return;
    }

    html += '<div class="panel' + (hasShinyHeld ? ' has-shiny' : '') + '">';
    html +=
      '<div class="header" id="pkc-drag-header">' +
      '<div class="title"><span>🥚</span><span>PokéCatch 色違預測</span></div>' +
      '<div class="header-actions">' +
      '<button class="icon-btn" id="pkc-refresh" title="立即重新讀取存檔">刷新</button>' +
      '<button class="icon-btn" id="pkc-collapse" title="收合面板">—</button>' +
      '</div>' +
      '</div>';

    html += '<div class="body" id="pkc-panel-body">';

    if (!state) {
      html +=
        '<div class="empty">尚無 <code>' + escapeHtml(SAVE_KEY) + '</code> 存檔資料<br>請進入遊戲建立或載入存檔後自動偵測</div>';
    } else {
      // 1. 頂部第一列：目前孵蛋數 k={laid}、靛莓果：已吃 / 未吃
      html +=
        '<div class="status-bar">' +
        '<div class="status-k">目前孵蛋數 <strong>k=' + state.laid + '</strong></div>' +
        '<div class="status-bx' + (state.berryActive ? ' eaten' : '') + '">' +
        '靛莓果：' + (state.berryActive ? '已吃' : '未吃') +
        '</div>' +
        '</div>';

      // 2. 培育屋親代顯示（三段式佈局 + 右側 48x48 垂直置中最大化寶可夢圖片）
      html += renderPensionSection(state.pensionInfo);

      // 分頁切換
      html +=
        '<div class="tabs">' +
        '<button class="tab-btn' + (uiState.activeTab === 'predict' ? ' active' : '') + '" data-tab="predict">序列預測</button>' +
        '<button class="tab-btn' + (uiState.activeTab === 'eggs' ? ' active' : '') + '" data-tab="eggs">' +
        '持有蛋 (' + state.eggs.length + (hasShinyHeld ? ' / ✨' + state.shinyEggs.length : '') + ')' +
        '</button>' +
        '</div>';

      if (uiState.activeTab === 'predict') {
        // 3. 上方 4 張摘要卡（維持往後找各自檔位第一筆色違）
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

        // 區塊標題：生蛋預測（1000顆內）
        html +=
          '<div class="toolbar">' +
          '<div class="section-title">生蛋預測（' + LIST_TOTAL_EGGS + '顆內）</div>' +
          (uiState.filterTier !== 'all'
            ? '<button type="button" class="clear-filter-btn" id="pkc-clear-filter">顯示全部蛋序</button>'
            : '') +
          '</div>';

        // 4. 下方生蛋預測列表（顯示全部蛋序，分批每次 200 筆）
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
        // 持有蛋頁籤：固定 2x2 四宮格卡片（比照序列預測上方四張摘要卡，永遠固定渲染 4 個蛋位）
        html += '<div class="egg-grid" id="pkc-egg-list">';
        for (var slotIdx = 0; slotIdx < 4; slotIdx++) {
          var eg = slotIdx < state.eggs.length ? state.eggs[slotIdx] : null;
          if (eg) {
            html +=
              '<div class="egg-card' + (eg.isShiny ? ' shiny' : '') + '">' +
              '<div class="egg-left">' +
              '<span class="egg-name">' + escapeHtml(eg.displayName) + '</span>' +
              (eg.isShiny ? '<span class="shiny-mark">✦閃光</span>' : '') +
              '</div>' +
              '<div class="mon-avatar-box">' +
              (eg.imgSrc
                ? '<img class="mon-avatar fallback-scale" src="' + escapeHtml(eg.imgSrc) + '" alt="">'
                : '') +
              '</div>' +
              '</div>';
          } else {
            html +=
              '<div class="egg-card empty-slot">' +
              '<span class="egg-empty-text">沒蛋</span>' +
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
      '<span>' + (state ? 'Seed: ' + escapeHtml(state.seed) : '唯讀本地運算') + '</span>' +
      '<button type="button" class="link-btn" id="pkc-toggle-debug">' + (uiState.showDebug ? '收起除錯資訊' : '除錯資訊') + '</button>' +
      '</div>';
    html += '</div>'; // .panel

    shadowRoot.innerHTML = html;

    // 立即還原滾動條位置（防止彈回頂部）
    var newBody = shadowRoot.getElementById('pkc-panel-body');
    if (newBody && savedBodyScroll > 0) newBody.scrollTop = savedBodyScroll;
    var newPredList = shadowRoot.getElementById('pkc-pred-list');
    if (newPredList && savedPredScroll > 0) newPredList.scrollTop = savedPredScroll;
    var newEggList = shadowRoot.getElementById('pkc-egg-list');
    if (newEggList && savedEggScroll > 0) newEggList.scrollTop = savedEggScroll;

    // 綁定圖片載入失敗隱藏（CSP 安全）
    var avatars = shadowRoot.querySelectorAll('.mon-avatar');
    for (var av = 0; av < avatars.length; av++) {
      avatars[av].addEventListener('error', function () {
        this.style.display = 'none';
      });
    }

    // 綁定互動事件
    attachDragHandler(shadowRoot.getElementById('pkc-drag-header'));

    var collapseBtn = shadowRoot.getElementById('pkc-collapse');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', function () {
        uiState.collapsed = true;
        saveUiPrefs();
        renderUI();
      });
    }

    var refreshBtn = shadowRoot.getElementById('pkc-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        refreshFromSave(true);
      });
    }

    var debugBtn = shadowRoot.getElementById('pkc-toggle-debug');
    if (debugBtn) {
      debugBtn.addEventListener('click', function () {
        uiState.showDebug = !uiState.showDebug;
        renderUI();
      });
    }

    var tabBtns = shadowRoot.querySelectorAll('.tab-btn');
    for (var tb = 0; tb < tabBtns.length; tb++) {
      tabBtns[tb].addEventListener('click', function () {
        uiState.activeTab = this.getAttribute('data-tab');
        saveUiPrefs();
        renderUI();
      });
    }

    var radarCards = shadowRoot.querySelectorAll('.radar-card');
    for (var rc = 0; rc < radarCards.length; rc++) {
      radarCards[rc].addEventListener('click', function () {
        var tid = this.getAttribute('data-tier');
        uiState.filterTier = uiState.filterTier === tid ? 'all' : tid;
        uiState.visibleCount = LIST_PAGE_SIZE;
        saveUiPrefs();
        renderUI();
      });
    }

    var clearFilterBtn = shadowRoot.getElementById('pkc-clear-filter');
    if (clearFilterBtn) {
      clearFilterBtn.addEventListener('click', function () {
        uiState.filterTier = 'all';
        uiState.visibleCount = LIST_PAGE_SIZE;
        saveUiPrefs();
        renderUI();
      });
    }

    var loadMoreBtn = shadowRoot.getElementById('pkc-load-more');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        uiState.visibleCount = Math.min(LIST_TOTAL_EGGS, uiState.visibleCount + LIST_PAGE_SIZE);
        renderUI();
      });
    }
  }

  // ============================================================================
  // 輪詢與 DOM 變化監聽（簽名比對，無變更絕不重繪 DOM）
  // ============================================================================
  function scheduleDomSync() {
    if (!currentState) return;
    if (mutationTimer) return;
    mutationTimer = window.setTimeout(function () {
      mutationTimer = null;
      var pension = currentState.save && currentState.save.pension ? currentState.save.pension : null;
      refreshDomPensionInfo(pension);
      syncDomHighlights(currentState);

      if (currentState.save) {
        var nextState = extractGameState(currentState.save);
        var nextSig = computeRenderSignature(nextState);
        if (nextSig !== lastRenderSig) {
          currentState = nextState;
          renderUI();
        }
      }
    }, 200);
  }

  function refreshFromSave(forceRender) {
    var raw = readRawSave();
    if (!forceRender && raw === lastRawSave) {
      return;
    }
    lastRawSave = raw;
    var save = parseSaveRaw(raw);
    var nextState = save ? extractGameState(save) : null;
    currentState = nextState;
    syncDomHighlights(currentState);

    var nextSig = computeRenderSignature(currentState);
    if (!forceRender && nextSig === lastRenderSig) {
      return;
    }
    renderUI();
  }

  function startWatching() {
    if (!pollTimer) {
      pollTimer = window.setInterval(function () {
        if (document.hidden) return;
        refreshFromSave(false);
      }, POLL_INTERVAL_MS);
    }

    window.addEventListener('storage', function (e) {
      if (!e || e.key === SAVE_KEY || e.key === null) {
        refreshFromSave(false);
      }
    });

    window.addEventListener('focus', function () {
      refreshFromSave(false);
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        refreshFromSave(false);
        scheduleDomSync();
      }
    });

    if (typeof MutationObserver !== 'undefined' && document.body) {
      observer = new MutationObserver(function (mutations) {
        if (!currentState) return;
        for (var i = 0; i < mutations.length; i++) {
          var target = mutations[i].target;
          if (target && !isInsideOurHost(target)) {
            scheduleDomSync();
            break;
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  // 啟動入口
  loadUiPrefs(function () {
    refreshFromSave(true);
    startWatching();
  });
})();
