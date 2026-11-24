(function () {
  'use strict';

  const Predictor = window.PokeCatchPredictor;
  if (!Predictor) {
    throw new Error('找不到 PokeCatchPredictor 核心模組，請確認 predictor.js 已正確載入。');
  }

  const STORAGE_KEY = 'pokecatch_v2_offline_state_v1';
  const SCAN_DEPTH = 2000;
  const PAGE_SIZE = 150;

  const state = {
    seed: '',
    seedLocked: false,
    laid: 0,
    berryActive: false,
    parents: [
      { name: '', shiny: true }
    ],
    filter: 'all', // 'all' | 'noBerry' | 'currentHit' | 'missed'
    visibleCount: PAGE_SIZE
  };

  // DOM 參照
  const elNextSlotPill = document.getElementById('next-slot-pill');
  const elBtnSeedToggle = document.getElementById('btn-seed-toggle');
  const elInputSeed = document.getElementById('input-seed');
  const elBtnSeedSave = document.getElementById('btn-seed-save');
  const elSeedHint = document.getElementById('seed-hint');
  const elInputK = document.getElementById('input-k');
  const elBtnKMinus = document.getElementById('btn-k-minus');
  const elBtnKPlus = document.getElementById('btn-k-plus');
  const elToggleBerry = document.getElementById('toggle-berry');
  const elBerryLabel = document.getElementById('berry-label');
  const elParentCountLabel = document.getElementById('parent-count-label');
  const elBtnAddParent = document.getElementById('btn-add-parent');
  const elParentList = document.getElementById('parent-list');
  const elRadarGrid = document.getElementById('radar-grid');
  const elSeqCountLabel = document.getElementById('seq-count-label');
  const elFilterBar = document.getElementById('filter-bar');
  const elSeqList = document.getElementById('seq-list');

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function loadState() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return;
      if (typeof saved.seed === 'string') state.seed = saved.seed;
      if (typeof saved.seedLocked === 'boolean') state.seedLocked = saved.seedLocked;
      if (Number.isInteger(saved.laid) && saved.laid >= 0) state.laid = saved.laid;
      if (typeof saved.berryActive === 'boolean') state.berryActive = saved.berryActive;
      if (Array.isArray(saved.parents) && saved.parents.length >= 1 && saved.parents.length <= 3) {
        state.parents = saved.parents.map(function (p) {
          return {
            name: typeof p.name === 'string' ? p.name : '',
            shiny: !!p.shiny
          };
        });
      }
      if (['all', 'noBerry', 'currentHit', 'missed'].indexOf(saved.filter) !== -1) {
        state.filter = saved.filter;
      }
    } catch (e) {
      // ignore storage errors
    }
  }

  function saveState() {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          seed: state.seed,
          seedLocked: state.seedLocked,
          laid: state.laid,
          berryActive: state.berryActive,
          parents: state.parents,
          filter: state.filter
        })
      );
    } catch (e) {
      // ignore storage errors
    }
  }

  function formatDist(step) {
    return step === 0 ? '下一顆是！' : '再過 ' + step + ' 顆';
  }

  function renderSeedSection() {
    var locked = state.seedLocked && state.seed.trim() !== '';
    elInputSeed.value = state.seed;
    elInputSeed.readOnly = locked;
    elBtnSeedSave.style.display = locked ? 'none' : '';
    elBtnSeedToggle.textContent = locked ? '編輯 Seed' : (state.seed.trim() ? '鎖定' : '輸入中');
    elSeedHint.innerHTML = locked
      ? '格式為 <code>trainer.since:trainer.id</code>，已鎖定防誤觸。'
      : '輸入你的訓練家 <code>since:id</code> 後點擊儲存即可鎖定。';
  }

  function renderCounterSection() {
    if (document.activeElement !== elInputK) {
      elInputK.value = String(state.laid);
    }
    elToggleBerry.checked = state.berryActive;
    elBerryLabel.textContent = state.berryActive ? '靛莓果：已吃（×2）' : '靛莓果：未吃';
    elBerryLabel.className = 'switch-text' + (state.berryActive ? ' active' : '');
  }

  function renderParentsSection() {
    elParentCountLabel.textContent = '(' + state.parents.length + '/3)';
    elBtnAddParent.disabled = state.parents.length >= 3;

    var html = '';
    for (var i = 0; i < state.parents.length; i++) {
      var p = state.parents[i];
      var slotNum = i + 1;
      html +=
        '<div class="parent-row' + (p.shiny ? ' shiny' : '') + '" data-idx="' + i + '">' +
        '<div class="parent-left">' +
        '<span class="parent-slot-badge">' + slotNum + '號位</span>' +
        '<input type="text" class="parent-name-input" data-role="name" data-idx="' + i + '" ' +
        'value="' + escapeHtml(p.name) + '" placeholder="輸入名稱（選填，如伊布）" maxlength="16">' +
        '</div>' +
        '<div class="parent-right">' +
        '<label class="shiny-toggle">' +
        '<input type="checkbox" data-role="shiny" data-idx="' + i + '"' + (p.shiny ? ' checked' : '') + '>' +
        '<span class="switch-track"><span class="switch-thumb"></span></span>' +
        '<span class="switch-text' + (p.shiny ? ' active' : '') + '">' + (p.shiny ? '✦閃光' : '普通') + '</span>' +
        '</label>' +
        (state.parents.length > 1
          ? '<button type="button" class="btn-remove-parent" data-role="remove" data-idx="' + i + '">移除</button>'
          : '') +
        '</div>' +
        '</div>';
    }
    elParentList.innerHTML = html;
  }

  function renderPredictions() {
    var trimmedSeed = state.seed.trim();
    var nextParent = Predictor.resolveParentForK(state.laid, Predictor.normalizeParents(state.parents));
    if (nextParent) {
      elNextSlotPill.textContent =
        '下一顆：' + nextParent.slotNum + '號位' +
        (nextParent.name ? ' ' + nextParent.name : '') +
        (nextParent.shiny ? ' ✦' : '');
    } else {
      elNextSlotPill.textContent = '尚未設定親代';
    }

    if (!trimmedSeed) {
      elRadarGrid.innerHTML = Predictor.TIERS.map(function (tier) {
        return (
          '<div class="radar-card">' +
          '<div class="radar-title">' + escapeHtml(tier.cardTitle) + '</div>' +
          '<div class="radar-dist">—</div>' +
          '<div class="radar-sub">請先輸入 Seed</div>' +
          '</div>'
        );
      }).join('');
      elSeqCountLabel.textContent = '(請先輸入 Seed)';
      elSeqList.innerHTML = '<div class="empty-state">請先於上方輸入並儲存你的訓練家 <code>Seed</code> 即可開始預測。</div>';
      return;
    }

    var pred = Predictor.predictSequence({
      seed: trimmedSeed,
      laid: state.laid,
      parents: state.parents,
      berryActive: state.berryActive,
      scanDepth: SCAN_DEPTH
    });

    // 1. 渲染 2x2 摘要卡
    var radarHtml = '';
    for (var t = 0; t < Predictor.TIERS.length; t++) {
      var tier = Predictor.TIERS[t];
      var hit = pred.nearest[tier.id];
      var isHot = !!(hit && hit.step === 0);
      var subText = '範圍內無命中';
      var warnHtml = '';

      if (hit) {
        subText =
          'k=' + hit.k +
          (hit.slotNum != null
            ? ' · ' + hit.slotNum + '號位' + (hit.slotName ? ' ' + hit.slotName : '')
            : '');
        if (hit.missedDueToNormalParent) {
          warnHtml = '<div class="radar-warn">⚠️ 該號位目前非閃光</div>';
        }
      }

      radarHtml +=
        '<div class="radar-card' + (isHot ? ' imminent' : '') + '">' +
        '<div class="radar-title">' + escapeHtml(tier.cardTitle) + '</div>' +
        '<div class="radar-dist' + (isHot ? ' hot' : '') + '">' +
        escapeHtml(hit ? formatDist(hit.step) : '>8000 顆') +
        '</div>' +
        '<div class="radar-sub">' + escapeHtml(subText) + '</div>' +
        warnHtml +
        '</div>';
    }
    elRadarGrid.innerHTML = radarHtml;

    // 2. 篩選序列
    var filtered = pred.hits.filter(function (row) {
      if (state.filter === 'noBerry') return !row.minTier.needsBerry;
      if (state.filter === 'currentHit') return row.willHitCurrent;
      if (state.filter === 'missed') return row.missedDueToNormalParent;
      return true;
    });

    elSeqCountLabel.textContent = '(' + SCAN_DEPTH + '顆內 · ' + filtered.length + ' 筆)';

    // 更新篩選按鈕高亮
    var chips = elFilterBar.querySelectorAll('.filter-chip');
    for (var c = 0; c < chips.length; c++) {
      var f = chips[c].getAttribute('data-filter');
      chips[c].classList.toggle('active', f === state.filter);
    }

    if (filtered.length === 0) {
      elSeqList.innerHTML = '<div class="empty-state">目前篩選條件下，未來 ' + SCAN_DEPTH + ' 顆內沒有符合的節點。</div>';
      return;
    }

    var sliceCount = Math.min(filtered.length, state.visibleCount);
    var listHtml = '';

    for (var i = 0; i < sliceCount; i++) {
      var item = filtered[i];
      var isFirst = i === 0;
      var isImmediate = item.step === 0;
      var slotText = item.slotNum != null
        ? '[' + item.slotNum + '號位' + (item.slotName ? '·' + item.slotName : '') + ']'
        : '';

      var statusBadge = '';
      if (item.missedDueToNormalParent) {
        statusBadge = '<span class="status-pill missed">⚠️ 親代非閃光會錯過</span>';
      } else if (item.willHitCurrent) {
        statusBadge = '<span class="status-pill hit">✦ 配置命中</span>';
      } else if (item.needsBerryForCurrentParent) {
        statusBadge = '<span class="status-pill berry">需吃靛莓果</span>';
      }

      var rightText = isImmediate
        ? '下一顆是 · k=' + item.k
        : '再過 ' + item.step + ' 顆 · k=' + item.k;

      var rowClass = 'seq-row' +
        (isFirst ? ' first-hit' : '') +
        (item.missedDueToNormalParent ? ' missed-row' : '');

      listHtml +=
        '<div class="' + rowClass + '">' +
        '<div class="seq-left">' +
        '<span class="seq-nth">第 ' + item.nth + ' 顆</span>' +
        '<span class="tag ' + item.minTier.badgeClass + '">' + escapeHtml(item.minTier.tagName) + '</span>' +
        (slotText ? '<span class="slot-badge">' + escapeHtml(slotText) + '</span>' : '') +
        statusBadge +
        '</div>' +
        '<div class="seq-right' + (isFirst || isImmediate ? ' highlight' : '') + '">' +
        escapeHtml(rightText) +
        '</div>' +
        '</div>';
    }

    if (sliceCount < filtered.length) {
      var remain = filtered.length - sliceCount;
      var nextAdd = Math.min(PAGE_SIZE, remain);
      listHtml +=
        '<button type="button" class="load-more-btn" id="btn-load-more">' +
        '顯示更多（+' + nextAdd + ' 筆 · 目前 ' + sliceCount + '/' + filtered.length + '）' +
        '</button>';
    }

    elSeqList.innerHTML = listHtml;
  }

  function renderAll() {
    renderSeedSection();
    renderCounterSection();
    renderParentsSection();
    renderPredictions();
  }

  // ============================================================================
  // 事件綁定
  // ============================================================================
  elBtnSeedToggle.addEventListener('click', function () {
    if (!state.seed.trim()) {
      elInputSeed.focus();
      return;
    }
    state.seedLocked = !state.seedLocked;
    saveState();
    renderSeedSection();
    if (!state.seedLocked) elInputSeed.focus();
  });

  function commitSeed() {
    state.seed = elInputSeed.value.trim();
    state.seedLocked = state.seed !== '';
    state.visibleCount = PAGE_SIZE;
    saveState();
    renderSeedSection();
    renderPredictions();
  }

  elBtnSeedSave.addEventListener('click', commitSeed);
  elInputSeed.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitSeed();
    }
  });

  elBtnKPlus.addEventListener('click', function () {
    state.laid += 1;
    saveState();
    renderCounterSection();
    renderPredictions();
  });

  elBtnKMinus.addEventListener('click', function () {
    state.laid = Math.max(0, state.laid - 1);
    saveState();
    renderCounterSection();
    renderPredictions();
  });

  elInputK.addEventListener('change', function () {
    var v = parseInt(elInputK.value, 10);
    state.laid = Number.isInteger(v) && v >= 0 ? v : 0;
    elInputK.value = String(state.laid);
    saveState();
    renderPredictions();
  });

  elToggleBerry.addEventListener('change', function () {
    state.berryActive = !!elToggleBerry.checked;
    saveState();
    renderCounterSection();
    renderPredictions();
  });

  elBtnAddParent.addEventListener('click', function () {
    if (state.parents.length >= 3) return;
    state.parents.push({ name: '', shiny: true });
    saveState();
    renderParentsSection();
    renderPredictions();
  });

  elParentList.addEventListener('input', function (e) {
    var target = e.target;
    if (!target || target.getAttribute('data-role') !== 'name') return;
    var idx = parseInt(target.getAttribute('data-idx'), 10);
    if (state.parents[idx]) {
      state.parents[idx].name = target.value;
      saveState();
      renderPredictions();
    }
  });

  elParentList.addEventListener('change', function (e) {
    var target = e.target;
    if (!target || target.getAttribute('data-role') !== 'shiny') return;
    var idx = parseInt(target.getAttribute('data-idx'), 10);
    if (state.parents[idx]) {
      state.parents[idx].shiny = !!target.checked;
      saveState();
      renderParentsSection();
      renderPredictions();
    }
  });

  elParentList.addEventListener('click', function (e) {
    var target = e.target;
    if (!target || target.getAttribute('data-role') !== 'remove') return;
    var idx = parseInt(target.getAttribute('data-idx'), 10);
    if (state.parents.length > 1 && state.parents[idx]) {
      state.parents.splice(idx, 1);
      saveState();
      renderParentsSection();
      renderPredictions();
    }
  });

  elFilterBar.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('.filter-chip') : null;
    if (!btn) return;
    var nextFilter = btn.getAttribute('data-filter');
    if (nextFilter && nextFilter !== state.filter) {
      state.filter = nextFilter;
      state.visibleCount = PAGE_SIZE;
      saveState();
      renderPredictions();
      elSeqList.scrollTop = 0;
    }
  });

  elSeqList.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'btn-load-more') {
      var prevScroll = elSeqList.scrollTop;
      state.visibleCount += PAGE_SIZE;
      renderPredictions();
      elSeqList.scrollTop = prevScroll;
    }
  });

  // 啟動
  loadState();
  renderAll();
})();
