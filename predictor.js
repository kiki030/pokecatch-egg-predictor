(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PokeCatchPredictor = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ============================================================================
  // 核心演算法（自 v1.0.0 逐字抽離，嚴禁更改任何常數與位元運算）
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
    if (typeof save === 'string') return save;
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
  // 檔位與欄位抽籤純函式
  // ============================================================================
  const TIERS = [
    {
      id: 'base',
      cardTitle: '普通親代 (1/512)',
      tagName: '普通親代',
      sp: 0,
      bx: 0,
      needsShinyParent: false,
      needsBerry: false,
      th: shinyThreshold({ sp: 0, bx: 0 }),
      badgeClass: 'tier-base'
    },
    {
      id: 'berry',
      cardTitle: '吃果普通親代 (1/256)',
      tagName: '吃果普通親代',
      sp: 0,
      bx: 1,
      needsShinyParent: false,
      needsBerry: true,
      th: shinyThreshold({ sp: 0, bx: 1 }),
      badgeClass: 'tier-berry'
    },
    {
      id: 'parent',
      cardTitle: '閃光親代 (1/16)',
      tagName: '閃光親代',
      sp: 2,
      bx: 0,
      needsShinyParent: true,
      needsBerry: false,
      th: shinyThreshold({ sp: 2, bx: 0 }),
      badgeClass: 'tier-parent'
    },
    {
      id: 'parentBerry',
      cardTitle: '吃果閃光親代 (1/8)',
      tagName: '吃果閃光親代',
      sp: 2,
      bx: 1,
      needsShinyParent: true,
      needsBerry: true,
      th: shinyThreshold({ sp: 2, bx: 1 }),
      badgeClass: 'tier-pb'
    }
  ];

  function classifyMinTier(roll) {
    if (roll < TIERS[0].th) return TIERS[0]; // roll < 1/512
    if (roll < TIERS[1].th) return TIERS[1]; // 1/512 <= roll < 1/256
    if (roll < TIERS[2].th) return TIERS[2]; // 1/256 <= roll < 1/16
    if (roll < TIERS[3].th) return TIERS[3]; // 1/16 <= roll < 1/8
    return null;
  }

  function normalizeParents(parents) {
    if (!Array.isArray(parents)) return [];
    var pool = [];
    for (var i = 0; i < parents.length; i++) {
      var p = parents[i];
      if (!p || typeof p !== 'object') continue;
      pool.push({
        slotNum: pool.length + 1,
        name: typeof p.name === 'string' ? p.name.trim() : '',
        shiny: !!p.shiny
      });
    }
    return pool;
  }

  function resolveParentForK(k, parentPool) {
    if (!parentPool || parentPool.length === 0) return null;
    var idx = ((k % parentPool.length) + parentPool.length) % parentPool.length;
    return parentPool[idx];
  }

  /**
   * 序列預測主函式
   * @param {Object} options
   * @param {string|Object} options.seed - 訓練家種子字串（"since:id"）或含 trainer 物件的 save
   * @param {number} options.laid - 目前已產蛋數 k（下一顆蛋的序號）
   * @param {Array<{name?: string, shiny?: boolean}>} [options.parents] - 培育屋可產蛋親代池（1～3 隻）
   * @param {boolean} [options.berryActive=false] - 目前是否已吃靛莓果（×2）
   * @param {number} [options.scanDepth=2000] - 序列列表掃描深度
   * @param {number} [options.cardSearchMax=8000] - 摘要卡最大往後搜尋深度
   */
  function predictSequence(options) {
    var opts = options || {};
    var seedInput = opts.seed != null ? opts.seed : ':';
    var laid = Number.isInteger(opts.laid) && opts.laid >= 0 ? opts.laid : 0;
    var parentPool = normalizeParents(opts.parents);
    var berryActive = !!opts.berryActive;
    var scanDepth = Number.isInteger(opts.scanDepth) && opts.scanDepth > 0 ? opts.scanDepth : 2000;
    var cardSearchMax = Number.isInteger(opts.cardSearchMax) && opts.cardSearchMax >= scanDepth
      ? opts.cardSearchMax
      : Math.max(scanDepth, 8000);

    var maxTh = TIERS[3].th; // 1/8 = 0.125

    var nearest = {
      base: null,        // roll < 1/512
      berry: null,       // 1/512 <= roll < 1/256
      parent: null,      // 1/256 <= roll < 1/16
      parentBerry: null  // 1/16 <= roll < 1/8
    };

    var hits = [];

    for (var step = 0; step < cardSearchMax; step++) {
      var k = laid + step;
      var roll = eggKHash(k, seedInput);

      if (roll < maxTh) {
        var minTier = classifyMinTier(roll);
        var slotParent = resolveParentForK(k, parentPool);
        var slotNum = slotParent ? slotParent.slotNum : null;
        var slotName = slotParent ? slotParent.name : '';
        var parentIsShiny = slotParent ? slotParent.shiny : false;

        var thNoBerry = shinyThreshold({ sp: parentIsShiny ? 2 : 0, bx: 0 });
        var thWithBerry = shinyThreshold({ sp: parentIsShiny ? 2 : 0, bx: 1 });
        var willHitNoBerry = slotParent ? roll < thNoBerry : false;
        var willHitWithBerry = slotParent ? roll < thWithBerry : false;
        var willHitCurrent = berryActive ? willHitWithBerry : willHitNoBerry;
        var missedDueToNormalParent = !!(slotParent && !parentIsShiny && minTier.needsShinyParent);
        var needsBerryForCurrentParent = !!(slotParent && !missedDueToNormalParent && !willHitNoBerry && willHitWithBerry);

        var hitObj = {
          k: k,
          step: step,
          nth: step + 1,
          roll: roll,
          minTier: minTier,
          tierId: minTier.id,
          slotNum: slotNum,
          slotName: slotName,
          parentIsShiny: parentIsShiny,
          willHitNoBerry: willHitNoBerry,
          willHitWithBerry: willHitWithBerry,
          willHitCurrent: willHitCurrent,
          missedDueToNormalParent: missedDueToNormalParent,
          needsBerryForCurrentParent: needsBerryForCurrentParent
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

        if (step < scanDepth) {
          hits.push(hitObj);
        }
      }

      if (
        step + 1 >= scanDepth &&
        nearest.base &&
        nearest.berry &&
        nearest.parent &&
        nearest.parentBerry
      ) {
        break;
      }
    }

    return {
      seed: trainerSeed(seedInput),
      laid: laid,
      berryActive: berryActive,
      parents: parentPool,
      scanDepth: scanDepth,
      nearest: nearest,
      hits: hits
    };
  }

  return {
    SHINY_RATE: SHINY_RATE,
    SHINY_PARENT_RATE: SHINY_PARENT_RATE,
    SHINY_PARENT_RATE_OLD: SHINY_PARENT_RATE_OLD,
    SHINY_BERRY_MULT: SHINY_BERRY_MULT,
    DITTO_ID: DITTO_ID,
    NO_EGG_IDS: NO_EGG_IDS,
    TIERS: TIERS,
    eggHash: eggHash,
    trainerSeed: trainerSeed,
    eggKHash: eggKHash,
    shinyThreshold: shinyThreshold,
    eggIsShiny: eggIsShiny,
    classifyMinTier: classifyMinTier,
    normalizeParents: normalizeParents,
    resolveParentForK: resolveParentForK,
    predictSequence: predictSequence
  };
});
