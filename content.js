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
  const HOST_ID = 'pkc-egg-predictor-host';
  const GOLD_STYLE_ID = 'pkc-shiny-egg-gold-style';
  const GOLD_CLASS = 'pkc-shiny-egg-gold';
  const GOLD_REL_CLASS = 'pkc-shiny-egg-rel';
  const POLL_INTERVAL_MS = 900;

  const TIERS = [
    {
      id: 'base',
      label: '一般',
      shortLabel: '純素',
      rateText: '1/512',
      sp: 0,
      bx: 0,
      th: shinyThreshold({ sp: 0, bx: 0 }),
      badgeClass: 'tier-base'
    },
    {
      id: 'berry',
      label: '一般+果',
      shortLabel: '單果',
      rateText: '1/256',
      sp: 0,
      bx: 1,
      th: shinyThreshold({ sp: 0, bx: 1 }),
      badgeClass: 'tier-berry'
    },
    {
      id: 'parent',
      label: '色違親代',
      shortLabel: '親代',
      rateText: '1/16',
      sp: 2,
      bx: 0,
      th: shinyThreshold({ sp: 2, bx: 0 }),
      badgeClass: 'tier-parent'
    },
    {
      id: 'parentBerry',
      label: '親代+果',
      shortLabel: '親代+果',
      rateText: '1/8',
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
    scanLimit: 2000,
    manualK: null, // null = 自動推算
    showDebug: false,
    pos: null // { right, bottom }
  };

  let lastRawSave = null;
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
      if (cur && typeof cur === 'object' && !cur.trainer) {
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
  // 存檔結構自動偵測（蛋陣列、下一個 k、培育屋親代）
  // ============================================================================
  function getByPath(obj, path) {
    var cur = obj;
    for (var i = 0; i < path.length; i++) {
      if (!cur || typeof cur !== 'object') return undefined;
      cur = cur[path[i]];
    }
    return cur;
  }

  function looksLikeEggObject(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    if (typeof item.k === 'number' && Number.isInteger(item.k)) return true;
    if (item.laidAt != null || item.hatchAt != null || item.hatchSteps != null) return true;
    if (
      (Object.prototype.hasOwnProperty.call(item, 'sp') || Object.prototype.hasOwnProperty.call(item, 'bx')) &&
      (item.uid != null || item.species != null || item.speciesId != null || item.id != null || item.pokemonId != null)
    ) {
      return true;
    }
    return false;
  }

  function detectEggs(save) {
    var candidates = [
      ['eggs'],
      ['daycare', 'eggs'],
      ['breeding', 'eggs'],
      ['nursery', 'eggs'],
      ['incubator', 'eggs'],
      ['eggBox'],
      ['eggStorage'],
      ['daycareEggs']
    ];

    for (var i = 0; i < candidates.length; i++) {
      var val = getByPath(save, candidates[i]);
      if (Array.isArray(val)) {
        return { eggs: val, path: 'save.' + candidates[i].join('.') };
      }
    }

    // 備援：淺層掃描（最多 2 層）尋找蛋物件陣列
    var topKeys = Object.keys(save);
    for (var a = 0; a < topKeys.length; a++) {
      var k1 = topKeys[a];
      var v1 = save[k1];
      if (Array.isArray(v1) && v1.length > 0 && looksLikeEggObject(v1[0])) {
        return { eggs: v1, path: 'save.' + k1 };
      }
      if (v1 && typeof v1 === 'object' && !Array.isArray(v1)) {
        var subKeys = Object.keys(v1);
        for (var b = 0; b < subKeys.length; b++) {
          var k2 = subKeys[b];
          var v2 = v1[k2];
          if (Array.isArray(v2) && v2.length > 0 && looksLikeEggObject(v2[0])) {
            return { eggs: v2, path: 'save.' + k1 + '.' + k2 };
          }
        }
      }
    }

    return { eggs: [], path: '未偵測' };
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
      egg && (egg.speciesId != null ? egg.speciesId :
      egg.pokemonId != null ? egg.pokemonId :
      egg.dexId != null ? egg.dexId :
      egg.species != null ? egg.species :
      egg.monId != null ? egg.monId :
      (typeof egg.id === 'number' ? egg.id : null));

    var name =
      egg && (egg.name || egg.speciesName || egg.zhName || egg.label || null);

    return {
      index: idx,
      egg: egg,
      k: egg && typeof egg.k === 'number' && Number.isInteger(egg.k) ? egg.k : null,
      uid: egg && egg.uid != null ? String(egg.uid) : null,
      laidAt: egg && egg.laidAt != null ? egg.laidAt : null,
      speciesId: speciesId,
      name: name,
      sp: egg && egg.sp ? +egg.sp : 0,
      bx: !!(egg && egg.bx),
      roll: roll,
      th: th,
      method: method,
      isShiny: isShiny
    };
  }

  function detectNextK(save, evaluatedEggs) {
    var maxEggK = null;
    for (var i = 0; i < evaluatedEggs.length; i++) {
      var ek = evaluatedEggs[i].k;
      if (ek != null && (maxEggK === null || ek > maxEggK)) {
        maxEggK = ek;
      }
    }

    var counterPaths = [
      ['eggSeq'],
      ['nextEggK'],
      ['eggK'],
      ['eggCounter'],
      ['eggCount'],
      ['eggIndex'],
      ['daycare', 'eggSeq'],
      ['daycare', 'nextEggK'],
      ['daycare', 'eggK'],
      ['daycare', 'k'],
      ['daycare', 'seq'],
      ['daycare', 'count'],
      ['breeding', 'eggSeq'],
      ['breeding', 'k'],
      ['breeding', 'seq'],
      ['nursery', 'eggSeq'],
      ['nursery', 'k'],
      ['trainer', 'eggSeq'],
      ['trainer', 'eggK'],
      ['trainer', 'eggCounter'],
      ['stats', 'eggsLaid'],
      ['stats', 'totalEggs'],
      ['stats', 'eggs']
    ];

    for (var c = 0; c < counterPaths.length; c++) {
      var val = getByPath(save, counterPaths[c]);
      if (typeof val === 'number' && Number.isInteger(val) && val >= 0) {
        var pathStr = 'save.' + counterPaths[c].join('.');
        if (maxEggK !== null && val <= maxEggK) {
          return {
            nextK: maxEggK + 1,
            source: 'max(egg.k)+1（' + pathStr + '=' + val + '）'
          };
        }
        return {
          nextK: val,
          source: pathStr + ' = ' + val
        };
      }
    }

    if (maxEggK !== null) {
      return {
        nextK: maxEggK + 1,
        source: '推算 max(egg.k)+1'
      };
    }

    return {
      nextK: 0,
      source: '預設 0（尚無蛋計數）'
    };
  }

  function buildMonLookup(save) {
    var map = Object.create(null);
    var poolKeys = ['box', 'party', 'pokemon', 'mons', 'roster', 'storage', 'collection', 'team', 'inventory'];
    for (var i = 0; i < poolKeys.length; i++) {
      var arr = save[poolKeys[i]];
      if (!Array.isArray(arr)) continue;
      for (var j = 0; j < arr.length; j++) {
        var m = arr[j];
        if (!m || typeof m !== 'object') continue;
        if (m.uid != null) map[String(m.uid)] = m;
        if (m.id != null && typeof m.id === 'string') map[m.id] = m;
      }
    }
    return map;
  }

  function extractMonInfo(rawMon, monLookup) {
    if (rawMon == null) return null;
    var m = rawMon;
    if (typeof rawMon === 'string' || typeof rawMon === 'number') {
      m = monLookup[String(rawMon)] || null;
      if (!m) {
        return {
          speciesId: typeof rawMon === 'number' ? rawMon : null,
          name: '#' + rawMon,
          shiny: false
        };
      }
    }
    if (!m || typeof m !== 'object') return null;
    var sid =
      m.speciesId != null ? +m.speciesId :
      m.pokemonId != null ? +m.pokemonId :
      m.dexId != null ? +m.dexId :
      m.monId != null ? +m.monId :
      typeof m.species === 'number' ? m.species :
      typeof m.id === 'number' ? m.id : null;
    var isShiny = !!(m.shiny || m.isShiny);
    var name = m.nickname || m.name || m.speciesName || (sid != null ? '#' + sid : '未知');
    return {
      speciesId: Number.isFinite(sid) ? sid : null,
      name: String(name),
      shiny: isShiny
    };
  }

  function detectDaycare(save) {
    var dc = save.daycare || save.breeding || save.nursery || save.pension || null;
    if (!dc || typeof dc !== 'object') return null;

    var rawParents = [];
    if (Array.isArray(dc)) {
      rawParents = dc.slice(0, 2);
    } else if (Array.isArray(dc.slots)) {
      rawParents = dc.slots;
    } else if (Array.isArray(dc.parents)) {
      rawParents = dc.parents;
    } else if (Array.isArray(dc.pair)) {
      rawParents = dc.pair;
    } else if (Array.isArray(dc.mons)) {
      rawParents = dc.mons;
    } else if (Array.isArray(dc.pokemon)) {
      rawParents = dc.pokemon;
    } else if (dc.p1 !== undefined || dc.p2 !== undefined) {
      rawParents = [dc.p1, dc.p2];
    } else if (dc.a !== undefined || dc.b !== undefined) {
      rawParents = [dc.a, dc.b];
    } else if (dc.slot1 !== undefined || dc.slot2 !== undefined) {
      rawParents = [dc.slot1, dc.slot2];
    }

    var lookup = buildMonLookup(save);
    var parents = [];
    for (var i = 0; i < rawParents.length; i++) {
      var info = extractMonInfo(rawParents[i], lookup);
      if (info) parents.push(info);
    }

    var warnings = [];
    var hasShinyParent = false;
    var dittoCount = 0;

    for (var j = 0; j < parents.length; j++) {
      var p = parents[j];
      if (p.shiny) hasShinyParent = true;
      if (p.speciesId === DITTO_ID) dittoCount++;
      if (p.speciesId != null && NO_EGG_IDS.indexOf(p.speciesId) !== -1) {
        warnings.push('#' + p.speciesId + ' 屬於不可生蛋品種（NO_EGG_IDS）');
      }
    }

    if (dittoCount >= 2) {
      warnings.push('雙百變怪（#132）無法生蛋');
    }

    var berryActive = !!(
      (!Array.isArray(dc) && (dc.bx || dc.shinyBerry || dc.berryActive || (dc.berry && dc.berry > 0))) ||
      save.shinyBerryActive
    );

    if (parents.length === 0 && !berryActive) return null;

    return {
      parents: parents,
      hasShinyParent: hasShinyParent,
      berryActive: berryActive,
      warnings: warnings
    };
  }

  function extractGameState(save) {
    var seed = trainerSeed(save);
    var hasTrainer = !!(save && save.trainer && (save.trainer.since != null || save.trainer.id != null));
    var eggDetect = detectEggs(save);
    var evaluatedEggs = [];
    var shinyEggs = [];

    for (var i = 0; i < eggDetect.eggs.length; i++) {
      var ev = evaluateEgg(eggDetect.eggs[i], i, save);
      evaluatedEggs.push(ev);
      if (ev.isShiny) shinyEggs.push(ev);
    }

    var kDetect = detectNextK(save, evaluatedEggs);
    var daycare = detectDaycare(save);

    return {
      save: save,
      seed: seed,
      hasTrainer: hasTrainer,
      eggsPath: eggDetect.path,
      eggs: evaluatedEggs,
      shinyEggs: shinyEggs,
      autoNextK: kDetect.nextK,
      kSource: kDetect.source,
      daycare: daycare,
      topKeys: Object.keys(save).slice(0, 24)
    };
  }

  // ============================================================================
  // 色違序列預測引擎
  // ============================================================================
  function classifyMinTier(roll) {
    if (roll < TIERS[0].th) return TIERS[0]; // base 1/512
    if (roll < TIERS[1].th) return TIERS[1]; // berry 1/256
    if (roll < TIERS[2].th) return TIERS[2]; // parent 1/16
    if (roll < TIERS[3].th) return TIERS[3]; // parentBerry 1/8
    return null;
  }

  function predictSequence(save, startK, scanLimit, filterTier) {
    var maxTh = TIERS[3].th; // 1/8 = 0.125
    var filterTh = maxTh;
    for (var t = 0; t < TIERS.length; t++) {
      if (TIERS[t].id === filterTier) {
        filterTh = TIERS[t].th;
        break;
      }
    }

    var nearest = {
      base: null,
      berry: null,
      parent: null,
      parentBerry: null
    };
    var hits = [];
    var MAX_TABLE_ROWS = 100;
    var EXTENDED_MAX = Math.max(scanLimit, 8000);

    for (var offset = 0; offset < EXTENDED_MAX; offset++) {
      var k = startK + offset;
      var roll = eggKHash(k, save);

      if (roll < maxTh) {
        var minTier = classifyMinTier(roll);
        if (!nearest.parentBerry) nearest.parentBerry = { k: k, offset: offset, roll: roll };
        if (!nearest.parent && roll < TIERS[2].th) nearest.parent = { k: k, offset: offset, roll: roll };
        if (!nearest.berry && roll < TIERS[1].th) nearest.berry = { k: k, offset: offset, roll: roll };
        if (!nearest.base && roll < TIERS[0].th) nearest.base = { k: k, offset: offset, roll: roll };

        if (offset < scanLimit && hits.length < MAX_TABLE_ROWS && roll < filterTh) {
          hits.push({
            k: k,
            offset: offset,
            nth: offset + 1,
            roll: roll,
            minTier: minTier
          });
        }
      }

      // 若已達使用者掃描上限且 4 個層級都找到最近命中，提早結束
      if (
        offset + 1 >= scanLimit &&
        nearest.base &&
        nearest.berry &&
        nearest.parent &&
        nearest.parentBerry
      ) {
        break;
      }
    }

    return {
      startK: startK,
      scanLimit: scanLimit,
      nearest: nearest,
      hits: hits
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

  function hasEggCue(el) {
    if (!el) return false;
    var cls = typeof el.className === 'string' ? el.className : '';
    if (/egg/i.test(cls)) return true;
    var txt = el.textContent || '';
    if (txt.indexOf('🥚') !== -1) return true;
    if (el.querySelector && el.querySelector('img[src*="egg" i], img[alt*="egg" i], img[alt*="蛋"]')) return true;
    return false;
  }

  function findBestCardAncestor(el) {
    var cur = el;
    var best = null;
    for (var depth = 0; depth < 5 && cur && cur !== document.body; depth++) {
      if (isCardSizedVisible(cur)) {
        var rect = cur.getBoundingClientRect();
        if (rect.width >= 48 && rect.height >= 40 && rect.width <= 520 && rect.height <= 360) {
          best = cur;
          // 若同層有多個同標籤兄弟元素，這通常就是蛋卡片本體
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
    var matchedMap = new Map(); // Element -> label string

    var shinyUidMap = Object.create(null);
    var shinyKMap = Object.create(null);
    for (var i = 0; i < shinyEggs.length; i++) {
      var se = shinyEggs[i];
      if (se.uid) shinyUidMap[se.uid] = se;
      if (se.k != null) shinyKMap[String(se.k)] = se;
    }

    // 策略 A：精準 data-* 屬性比對（uid / k）
    var attrEls = document.querySelectorAll('[data-egg-uid], [data-uid], [data-egg-id], [data-egg-k], [data-k]');
    for (var a = 0; a < attrEls.length; a++) {
      var el = attrEls[a];
      if (!isCardSizedVisible(el)) continue;
      var uidVal = el.getAttribute('data-egg-uid') || el.getAttribute('data-uid') || el.getAttribute('data-egg-id');
      var kVal = el.getAttribute('data-egg-k') || el.getAttribute('data-k');
      var hit = (uidVal && shinyUidMap[uidVal]) || (kVal && shinyKMap[kVal]) || null;
      if (hit && (hasEggCue(el) || el.hasAttribute('data-egg-uid') || el.hasAttribute('data-egg-k'))) {
        matchedMap.set(el, '✨ 色違蛋' + (hit.k != null ? ' k=' + hit.k : ''));
      }
    }

    // 策略 B：同父容器蛋卡片順序對應（完全符合 eggs.length）
    if (matchedMap.size < shinyEggs.length && eggs.length > 0) {
      var eggMarkers = [];
      var candidateNodes = document.querySelectorAll(
        '[class*="egg" i], img[src*="egg" i], img[alt*="egg" i], img[alt*="蛋"]'
      );
      for (var c = 0; c < candidateNodes.length; c++) {
        if (!isInsideOurHost(candidateNodes[c])) eggMarkers.push(candidateNodes[c]);
      }

      // 也掃描含 🥚 emoji 的可見短元素
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

      var parentGroups = new Map(); // parentElement -> Set<cardElement>
      for (var m = 0; m < eggMarkers.length; m++) {
        var card = findBestCardAncestor(eggMarkers[m]);
        if (!card || !card.parentElement) continue;
        var p = card.parentElement;
        if (!parentGroups.has(p)) parentGroups.set(p, new Set());
        parentGroups.get(p).add(card);
      }

      parentGroups.forEach(function (cardSet, parentEl) {
        // 按 DOM 順序排列
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

      // 策略 C：若所有持有蛋都是色違且尚未標記，標記唯一合理蛋卡片組
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

    // 清除過期標記
    var existing = document.querySelectorAll('.' + GOLD_CLASS);
    for (var x = 0; x < existing.length; x++) {
      if (!matchedMap.has(existing[x])) {
        existing[x].classList.remove(GOLD_CLASS);
        existing[x].classList.remove(GOLD_REL_CLASS);
        existing[x].removeAttribute('data-pkc-shiny-label');
      }
    }

    // 套用新標記
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
  // chrome.storage.local 偏好存取（僅儲存面板收合/位置/篩選設定）
  // ============================================================================
  function loadUiPrefs(cb) {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([STORAGE_KEY], function (res) {
          var saved = res && res[STORAGE_KEY];
          if (saved && typeof saved === 'object') {
            if (typeof saved.collapsed === 'boolean') uiState.collapsed = saved.collapsed;
            if (saved.activeTab === 'predict' || saved.activeTab === 'eggs') uiState.activeTab = saved.activeTab;
            if (typeof saved.filterTier === 'string') uiState.filterTier = saved.filterTier;
            if (typeof saved.scanLimit === 'number') uiState.scanLimit = saved.scanLimit;
            if (saved.pos && typeof saved.pos.right === 'number' && typeof saved.pos.bottom === 'number') {
              uiState.pos = saved.pos;
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
          scanLimit: uiState.scanLimit,
          pos: uiState.pos
        };
        chrome.storage.local.set(payload);
      }
    } catch (e) {
      // ignore
    }
  }

  // ============================================================================
  // Shadow DOM 浮動介面（零依賴純原生 CSS + HTML）
  // ============================================================================
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatRoll(roll) {
    if (roll == null || !Number.isFinite(roll)) return '—';
    return roll.toFixed(6);
  }

  function formatDist(hit) {
    if (!hit) return '>8000';
    if (hit.offset === 0) return '下一顆！';
    return '第 ' + (hit.offset + 1) + ' 顆';
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
      '  padding: 2px 6px;',
      '  border-radius: 999px;',
      '  font-size: 11px;',
      '  font-weight: 700;',
      '  background: rgba(255, 255, 255, 0.1);',
      '  font-variant-numeric: tabular-nums;',
      '}',
      '.pill-badge.gold {',
      '  background: linear-gradient(135deg, #fff2a1, #f5b700);',
      '  color: #1f1400;',
      '}',
      '.panel {',
      '  width: 348px;',
      '  max-width: calc(100vw - 24px);',
      '  max-height: calc(100vh - 32px);',
      '  display: flex;',
      '  flex-direction: column;',
      '  background: rgba(13, 18, 30, 0.95);',
      '  backdrop-filter: blur(10px);',
      '  border: 1px solid rgba(148, 163, 184, 0.28);',
      '  border-radius: 14px;',
      '  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55);',
      '  overflow: hidden;',
      '}',
      '.panel.has-shiny { border-color: rgba(255, 215, 0, 0.72); }',
      '.header {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  padding: 9px 11px;',
      '  background: linear-gradient(180deg, rgba(30, 41, 59, 0.9), rgba(15, 23, 42, 0.9));',
      '  border-bottom: 1px solid rgba(148, 163, 184, 0.18);',
      '  cursor: grab;',
      '}',
      '.header:active { cursor: grabbing; }',
      '.title { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 13px; color: #f8fafc; }',
      '.header-actions { display: flex; align-items: center; gap: 4px; }',
      '.icon-btn {',
      '  border: 1px solid rgba(148, 163, 184, 0.25);',
      '  background: rgba(30, 41, 59, 0.7);',
      '  color: #cbd5e1;',
      '  border-radius: 6px;',
      '  padding: 3px 7px;',
      '  font-size: 11px;',
      '  cursor: pointer;',
      '}',
      '.icon-btn:hover { background: rgba(51, 65, 85, 0.9); color: #fff; border-color: rgba(255, 215, 0, 0.5); }',
      '.body { padding: 10px; overflow-y: auto; display: flex; flex-direction: column; gap: 9px; }',
      '.meta-bar {',
      '  display: flex;',
      '  flex-wrap: wrap;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 6px;',
      '  padding: 6px 8px;',
      '  border-radius: 8px;',
      '  background: rgba(30, 41, 59, 0.55);',
      '  border: 1px solid rgba(148, 163, 184, 0.15);',
      '  font-variant-numeric: tabular-nums;',
      '}',
      '.seed-text { font-size: 11px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; max-width: 140px; white-space: nowrap; }',
      '.k-ctrl { display: inline-flex; align-items: center; gap: 3px; }',
      '.k-input {',
      '  width: 56px;',
      '  padding: 2px 5px;',
      '  border-radius: 5px;',
      '  border: 1px solid rgba(148, 163, 184, 0.35);',
      '  background: rgba(15, 23, 42, 0.9);',
      '  color: #fde047;',
      '  font-size: 11px;',
      '  font-weight: 700;',
      '  text-align: center;',
      '  font-variant-numeric: tabular-nums;',
      '}',
      '.mini-btn {',
      '  border: 1px solid rgba(148, 163, 184, 0.28);',
      '  background: rgba(30, 41, 59, 0.85);',
      '  color: #e2e8f0;',
      '  border-radius: 5px;',
      '  padding: 2px 6px;',
      '  font-size: 11px;',
      '  cursor: pointer;',
      '}',
      '.mini-btn:hover { border-color: #ffd700; color: #fff; }',
      '.mini-btn.active { background: rgba(245, 183, 0, 0.22); border-color: #ffd700; color: #fde047; }',
      '.daycare-box {',
      '  padding: 6px 8px;',
      '  border-radius: 8px;',
      '  background: rgba(30, 41, 59, 0.45);',
      '  border: 1px solid rgba(148, 163, 184, 0.18);',
      '  font-size: 11px;',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 4px;',
      '}',
      '.daycare-warn { color: #fca5a5; font-weight: 700; }',
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
      '  border-color: rgba(255, 215, 0, 0.65);',
      '  color: #fef08a;',
      '}',
      '.radar-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }',
      '.radar-card {',
      '  padding: 7px 8px;',
      '  border-radius: 9px;',
      '  border: 1px solid rgba(148, 163, 184, 0.2);',
      '  background: rgba(30, 41, 59, 0.52);',
      '  cursor: pointer;',
      '  transition: border-color 0.12s ease, background 0.12s ease;',
      '  text-align: left;',
      '}',
      '.radar-card:hover { border-color: rgba(255, 215, 0, 0.55); }',
      '.radar-card.selected { border-color: #ffd700; background: rgba(245, 183, 0, 0.16); }',
      '.radar-card.imminent { border-color: #ffd700; box-shadow: inset 0 0 10px rgba(255, 215, 0, 0.22); }',
      '.radar-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px; }',
      '.radar-name { font-size: 11px; color: #cbd5e1; font-weight: 600; }',
      '.radar-rate { font-size: 10px; color: #94a3b8; font-variant-numeric: tabular-nums; }',
      '.radar-dist { font-size: 14px; font-weight: 800; color: #f8fafc; font-variant-numeric: tabular-nums; }',
      '.radar-dist.hot { color: #fde047; }',
      '.radar-k { font-size: 10px; color: #94a3b8; font-variant-numeric: tabular-nums; }',
      '.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 11px; color: #94a3b8; }',
      '.hits-wrap {',
      '  max-height: 215px;',
      '  overflow-y: auto;',
      '  border: 1px solid rgba(148, 163, 184, 0.18);',
      '  border-radius: 8px;',
      '  background: rgba(15, 23, 42, 0.65);',
      '}',
      'table { width: 100%; border-collapse: collapse; font-size: 11px; font-variant-numeric: tabular-nums; }',
      'thead th {',
      '  position: sticky;',
      '  top: 0;',
      '  background: rgba(30, 41, 59, 0.96);',
      '  color: #94a3b8;',
      '  text-align: left;',
      '  padding: 5px 6px;',
      '  font-weight: 600;',
      '  border-bottom: 1px solid rgba(148, 163, 184, 0.2);',
      '}',
      'tbody td { padding: 5px 6px; border-bottom: 1px solid rgba(148, 163, 184, 0.1); }',
      'tbody tr.row-next { background: rgba(255, 215, 0, 0.14); }',
      'tbody tr.row-base { background: rgba(255, 215, 0, 0.08); }',
      '.tag {',
      '  display: inline-block;',
      '  padding: 1px 6px;',
      '  border-radius: 999px;',
      '  font-size: 10px;',
      '  font-weight: 700;',
      '  white-space: nowrap;',
      '}',
      '.tier-base { background: linear-gradient(135deg, #fff2a1, #f5b700); color: #1f1400; }',
      '.tier-berry { background: rgba(236, 72, 153, 0.25); color: #f9a8d4; border: 1px solid rgba(236, 72, 153, 0.45); }',
      '.tier-parent { background: rgba(56, 189, 248, 0.22); color: #7dd3fc; border: 1px solid rgba(56, 189, 248, 0.45); }',
      '.tier-pb { background: rgba(168, 85, 247, 0.22); color: #d8b4fe; border: 1px solid rgba(168, 85, 247, 0.45); }',
      '.egg-list { display: flex; flex-direction: column; gap: 6px; max-height: 270px; overflow-y: auto; }',
      '.egg-card {',
      '  padding: 7px 9px;',
      '  border-radius: 9px;',
      '  border: 1px solid rgba(148, 163, 184, 0.2);',
      '  background: rgba(30, 41, 59, 0.5);',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 3px;',
      '  font-variant-numeric: tabular-nums;',
      '}',
      '.egg-card.shiny {',
      '  border: 1.5px solid #ffd700;',
      '  background: linear-gradient(135deg, rgba(255, 215, 0, 0.18), rgba(30, 41, 59, 0.72));',
      '  box-shadow: 0 0 12px rgba(255, 215, 0, 0.28);',
      '}',
      '.egg-row { display: flex; justify-content: space-between; align-items: center; gap: 6px; }',
      '.egg-sub { font-size: 10px; color: #94a3b8; }',
      '.dom-status {',
      '  font-size: 11px;',
      '  padding: 5px 8px;',
      '  border-radius: 7px;',
      '  background: rgba(30, 41, 59, 0.6);',
      '  border: 1px solid rgba(148, 163, 184, 0.16);',
      '  color: #cbd5e1;',
      '}',
      '.dom-status.ok { border-color: rgba(255, 215, 0, 0.55); color: #fde047; }',
      '.empty { padding: 16px 8px; text-align: center; color: #94a3b8; }',
      '.debug-box {',
      '  padding: 7px 8px;',
      '  border-radius: 8px;',
      '  background: rgba(2, 6, 23, 0.75);',
      '  border: 1px solid rgba(148, 163, 184, 0.2);',
      '  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;',
      '  font-size: 10px;',
      '  color: #94a3b8;',
      '  word-break: break-all;',
      '  line-height: 1.45;',
      '}',
      '.footer {',
      '  display: flex;',
      '  justify-content: space-between;',
      '  align-items: center;',
      '  padding: 5px 10px;',
      '  border-top: 1px solid rgba(148, 163, 184, 0.14);',
      '  background: rgba(15, 23, 42, 0.8);',
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

  function renderUI(fromPoll) {
    ensureHost();
    if (fromPoll && shadowRoot.activeElement && shadowRoot.activeElement.id === 'pkc-k-input') {
      return;
    }

    var state = currentState;
    var hasShinyHeld = !!(state && state.shinyEggs.length > 0);
    var effectiveK = state ? (uiState.manualK != null ? uiState.manualK : state.autoNextK) : 0;
    var pred = state ? predictSequence(state.save, effectiveK, uiState.scanLimit, uiState.filterTier) : null;

    var html = '<style>' + getShadowStyles() + '</style>';

    if (uiState.collapsed) {
      var pillDist = '—';
      if (pred) {
        var activeNearest =
          uiState.filterTier !== 'all' && pred.nearest[uiState.filterTier]
            ? pred.nearest[uiState.filterTier]
            : pred.nearest.parentBerry;
        pillDist = activeNearest ? (activeNearest.offset === 0 ? '下顆✨' : '+' + (activeNearest.offset + 1)) : '—';
      }
      html +=
        '<div class="pill' + (hasShinyHeld ? ' has-shiny' : '') + '" id="pkc-expand">' +
        '<span>🥚 色違預測</span>' +
        (hasShinyHeld
          ? '<span class="pill-badge gold">持有 ✨' + state.shinyEggs.length + '</span>'
          : '<span class="pill-badge">蛋 ' + (state ? state.eggs.length : 0) + '</span>') +
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

    html += '<div class="body">';

    if (!state) {
      html +=
        '<div class="empty">尚無 <code>' + escapeHtml(SAVE_KEY) + '</code> 存檔資料<br>請進入遊戲建立或載入存檔後自動偵測</div>';
    } else {
      // Seed 與 k 控制列
      html +=
        '<div class="meta-bar">' +
        '<div class="seed-text" title="trainerSeed: ' + escapeHtml(state.seed) + '">Seed: ' + escapeHtml(state.seed) + '</div>' +
        '<div class="k-ctrl">' +
        '<span style="font-size:11px;color:#94a3b8;">k=</span>' +
        '<button class="mini-btn" id="pkc-k-dec" title="k - 1">-1</button>' +
        '<input class="k-input" id="pkc-k-input" type="number" min="0" step="1" value="' + effectiveK + '">' +
        '<button class="mini-btn" id="pkc-k-inc" title="k + 1">+1</button>' +
        (uiState.manualK != null
          ? '<button class="mini-btn active" id="pkc-k-reset" title="恢復自動偵測">自動</button>'
          : '') +
        '</div>' +
        '</div>';

      // 培育屋親代狀態提示（套用 DITTO_ID / NO_EGG_IDS）
      if (state.daycare) {
        var pNames = state.daycare.parents
          .map(function (p) {
            return (p.shiny ? '✨' : '') + p.name;
          })
          .join(' × ');
        html += '<div class="daycare-box">';
        html +=
          '<div class="egg-row"><span>培育屋：' +
          escapeHtml(pNames || '已偵測') +
          '</span><span>' +
          (state.daycare.hasShinyParent ? '<span class="tag tier-parent">sp=2</span> ' : '') +
          (state.daycare.berryActive ? '<span class="tag tier-berry">bx=1</span>' : '') +
          '</span></div>';
        for (var w = 0; w < state.daycare.warnings.length; w++) {
          html += '<div class="daycare-warn">⚠️ ' + escapeHtml(state.daycare.warnings[w]) + '</div>';
        }
        html += '</div>';
      }

      // 分頁切換
      html +=
        '<div class="tabs">' +
        '<button class="tab-btn' + (uiState.activeTab === 'predict' ? ' active' : '') + '" data-tab="predict">序列預測</button>' +
        '<button class="tab-btn' + (uiState.activeTab === 'eggs' ? ' active' : '') + '" data-tab="eggs">' +
        '持有蛋 (' + state.eggs.length + (hasShinyHeld ? ' / ✨' + state.shinyEggs.length : '') + ')' +
        '</button>' +
        '</div>';

      if (uiState.activeTab === 'predict') {
        // 4 層機率雷達卡
        html += '<div class="radar-grid">';
        for (var t = 0; t < TIERS.length; t++) {
          var tier = TIERS[t];
          var hit = pred.nearest[tier.id];
          var isSel = uiState.filterTier === tier.id;
          var isHot = !!(hit && hit.offset === 0);
          html +=
            '<button class="radar-card' +
            (isSel ? ' selected' : '') +
            (isHot ? ' imminent' : '') +
            '" data-tier="' + tier.id + '">' +
            '<div class="radar-top"><span class="radar-name">' + tier.label + '</span><span class="radar-rate">' + tier.rateText + '</span></div>' +
            '<div class="radar-dist' + (isHot ? ' hot' : '') + '">' + formatDist(hit) + '</div>' +
            '<div class="radar-k">' + (hit ? 'k=' + hit.k + ' · ' + formatRoll(hit.roll) : '掃描內無命中') + '</div>' +
            '</button>';
        }
        html += '</div>';

        // 篩選與掃描範圍工具列
        html +=
          '<div class="toolbar">' +
          '<div>' +
          '<button class="mini-btn' + (uiState.filterTier === 'all' ? ' active' : '') + '" id="pkc-filter-all">全部命中</button>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:4px;">' +
          '<span>範圍</span>' +
          [500, 2000, 5000]
            .map(function (lim) {
              return (
                '<button class="mini-btn' +
                (uiState.scanLimit === lim ? ' active' : '') +
                '" data-limit="' + lim + '">' + lim + '</button>'
              );
            })
            .join('') +
          '</div>' +
          '</div>';

        // 預測序列列表
        html += '<div class="hits-wrap">';
        if (pred.hits.length === 0) {
          html += '<div class="empty">目前範圍內無符合條件的色違序列</div>';
        } else {
          html +=
            '<table><thead><tr><th>次序</th><th>k</th><th>最低條件</th><th>Roll</th></tr></thead><tbody>';
          for (var h = 0; h < pred.hits.length; h++) {
            var row = pred.hits[h];
            var rowCls =
              row.offset === 0
                ? 'row-next'
                : row.minTier && row.minTier.id === 'base'
                  ? 'row-base'
                  : '';
            var nthText = row.offset === 0 ? '下一顆' : '+' + row.nth;
            html +=
              '<tr class="' + rowCls + '">' +
              '<td>' + nthText + '</td>' +
              '<td>' + row.k + '</td>' +
              '<td><span class="tag ' + row.minTier.badgeClass + '">' + row.minTier.shortLabel + '</span></td>' +
              '<td>' + formatRoll(row.roll) + '</td>' +
              '</tr>';
          }
          html += '</tbody></table>';
        }
        html += '</div>';
      } else {
        // 持有蛋清單 + DOM 金框狀態
        var domText =
          state.shinyEggs.length === 0
            ? '目前未持有色違蛋'
            : lastDomMatchInfo.matched > 0
              ? 'DOM 金框提示：已標記 ' + lastDomMatchInfo.matched + ' / ' + lastDomMatchInfo.totalShiny + ' 顆色違蛋'
              : 'DOM 金框提示：持有 ' + state.shinyEggs.length + ' 顆色違蛋（切換至蛋介面即自動上金框）';
        html += '<div class="dom-status' + (lastDomMatchInfo.matched > 0 ? ' ok' : '') + '">' + escapeHtml(domText) + '</div>';

        html += '<div class="egg-list">';
        if (state.eggs.length === 0) {
          html += '<div class="empty">目前存檔中沒有持有任何蛋</div>';
        } else {
          for (var e = 0; e < state.eggs.length; e++) {
            var eg = state.eggs[e];
            var titleStr =
              '#' + (eg.index + 1) + ' ' +
              (eg.name ? eg.name : eg.speciesId != null ? '寶可夢 #' + eg.speciesId : '蛋');
            var flags = [];
            if (eg.sp === 2) flags.push('親代(1/16)');
            else if (eg.sp) flags.push('舊親代(10%)');
            if (eg.bx) flags.push('色違果×2');
            if (flags.length === 0) flags.push('一般');

            html +=
              '<div class="egg-card' + (eg.isShiny ? ' shiny' : '') + '">' +
              '<div class="egg-row">' +
              '<strong>' + escapeHtml(titleStr) + '</strong>' +
              (eg.isShiny
                ? '<span class="tag tier-base">✨ 色違蛋</span>'
                : '<span class="egg-sub">一般</span>') +
              '</div>' +
              '<div class="egg-row egg-sub">' +
              '<span>' + escapeHtml(eg.method) + ' · ' + escapeHtml(flags.join(' + ')) + '</span>' +
              '<span>' + (eg.roll != null ? formatRoll(eg.roll) + ' / ' + eg.th.toFixed(4) : '固定旗標') + '</span>' +
              '</div>' +
              '</div>';
          }
        }
        html += '</div>';
      }

      if (uiState.showDebug) {
        html +=
          '<div class="debug-box">' +
          'trainerSeed: ' + escapeHtml(state.seed) + '<br>' +
          'eggsPath: ' + escapeHtml(state.eggsPath) + ' (' + state.eggs.length + ')<br>' +
          'kSource: ' + escapeHtml(state.kSource) + '<br>' +
          'topKeys: ' + escapeHtml(state.topKeys.join(', ')) +
          '</div>';
      }
    }

    html += '</div>'; // .body
    html +=
      '<div class="footer">' +
      '<span>唯讀本地運算 · 零網路請求</span>' +
      '<button class="link-btn" id="pkc-toggle-debug">' + (uiState.showDebug ? '隱藏除錯' : '除錯資訊') + '</button>' +
      '</div>';
    html += '</div>'; // .panel

    shadowRoot.innerHTML = html;

    // 綁定事件
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
        saveUiPrefs();
        renderUI();
      });
    }

    var allFilterBtn = shadowRoot.getElementById('pkc-filter-all');
    if (allFilterBtn) {
      allFilterBtn.addEventListener('click', function () {
        uiState.filterTier = 'all';
        saveUiPrefs();
        renderUI();
      });
    }

    var limitBtns = shadowRoot.querySelectorAll('[data-limit]');
    for (var lb = 0; lb < limitBtns.length; lb++) {
      limitBtns[lb].addEventListener('click', function () {
        uiState.scanLimit = parseInt(this.getAttribute('data-limit'), 10) || 2000;
        saveUiPrefs();
        renderUI();
      });
    }

    var kDec = shadowRoot.getElementById('pkc-k-dec');
    if (kDec) {
      kDec.addEventListener('click', function () {
        uiState.manualK = Math.max(0, effectiveK - 1);
        renderUI();
      });
    }

    var kInc = shadowRoot.getElementById('pkc-k-inc');
    if (kInc) {
      kInc.addEventListener('click', function () {
        uiState.manualK = effectiveK + 1;
        renderUI();
      });
    }

    var kReset = shadowRoot.getElementById('pkc-k-reset');
    if (kReset) {
      kReset.addEventListener('click', function () {
        uiState.manualK = null;
        renderUI();
      });
    }

    var kInput = shadowRoot.getElementById('pkc-k-input');
    if (kInput) {
      kInput.addEventListener('change', function () {
        var parsed = parseInt(this.value, 10);
        if (Number.isInteger(parsed) && parsed >= 0) {
          uiState.manualK = parsed;
        } else {
          uiState.manualK = null;
        }
        renderUI();
      });
    }
  }

  // ============================================================================
  // 輪詢與 DOM 變化監聽（僅在頁面可見時低耗執行）
  // ============================================================================
  function scheduleDomSync() {
    if (!currentState || currentState.shinyEggs.length === 0) return;
    if (mutationTimer) return;
    mutationTimer = window.setTimeout(function () {
      mutationTimer = null;
      var prevMatched = lastDomMatchInfo.matched;
      var info = syncDomHighlights(currentState);
      if (info.matched !== prevMatched && !uiState.collapsed && uiState.activeTab === 'eggs') {
        renderUI();
      }
    }, 180);
  }

  function refreshFromSave(force) {
    var raw = readRawSave();
    if (!force && raw === lastRawSave) {
      return;
    }
    lastRawSave = raw;
    var save = parseSaveRaw(raw);
    currentState = save ? extractGameState(save) : null;
    syncDomHighlights(currentState);
    renderUI(!force);
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
        refreshFromSave(true);
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
        if (!currentState || currentState.shinyEggs.length === 0) return;
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
