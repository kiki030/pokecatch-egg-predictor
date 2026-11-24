'use strict';

const assert = require('assert');
const predictor = require('./predictor.js');

function runTests() {
  const SEED = '1794493981827:15950';
  const LAID = 144;
  const PARENTS = [
    { name: '親代1', shiny: true },
    { name: '親代2', shiny: true },
    { name: '親代3', shiny: true }
  ];

  const result = predictor.predictSequence({
    seed: SEED,
    laid: LAID,
    parents: PARENTS,
    berryActive: false,
    scanDepth: 2000
  });

  const hitByK = new Map();
  for (let i = 0; i < result.hits.length; i++) {
    hitByK.set(result.hits[i].k, result.hits[i]);
  }

  let passed = 0;
  function check(label, fn) {
    fn();
    passed++;
    console.log('[PASS] ' + label);
  }

  // 1. 閃光親代 (1/16) 下一次：k = 156（再過 12 顆，1號位）
  check('閃光親代 (1/16) 下一次 -> k=156, step=12, 1號位', function () {
    assert.ok(result.nearest.parent, '應找到閃光親代命中');
    assert.strictEqual(result.nearest.parent.k, 156);
    assert.strictEqual(result.nearest.parent.step, 12);
    assert.strictEqual(result.nearest.parent.slotNum, 1);
  });

  // 2. 吃果閃光親代 (1/8) 下一次：k = 162（再過 18 顆，1號位）
  check('吃果閃光親代 (1/8) 下一次 -> k=162, step=18, 1號位', function () {
    assert.ok(result.nearest.parentBerry, '應找到吃果閃光親代命中');
    assert.strictEqual(result.nearest.parentBerry.k, 162);
    assert.strictEqual(result.nearest.parentBerry.step, 18);
    assert.strictEqual(result.nearest.parentBerry.slotNum, 1);
  });

  // 3. 閃光親代序列節點驗證
  const expectedNodes = [
    { k: 166, tierId: 'parent', slotNum: 2, desc: 'k=166（閃光親代，2號位）' },
    { k: 184, tierId: 'parentBerry', slotNum: 2, desc: 'k=184（吃果閃光親代，2號位）' },
    { k: 192, tierId: 'parent', slotNum: 1, desc: 'k=192（閃光親代，1號位）' },
    { k: 198, tierId: 'parent', slotNum: 1, desc: 'k=198（閃光親代，1號位）' },
    { k: 200, tierId: 'parent', slotNum: 3, desc: 'k=200（閃光親代，3號位）' }
  ];

  for (let i = 0; i < expectedNodes.length; i++) {
    const exp = expectedNodes[i];
    check('序列節點 -> ' + exp.desc, function () {
      const node = hitByK.get(exp.k);
      assert.ok(node, '序列中應包含 k=' + exp.k);
      assert.strictEqual(node.tierId, exp.tierId);
      assert.strictEqual(node.slotNum, exp.slotNum);
    });
  }

  // 4. 普通親代 (1/512) 下一次：k = 217（再過 73 顆，2號位）
  check('普通親代 (1/512) 下一次 -> k=217, step=73, 2號位', function () {
    assert.ok(result.nearest.base, '應找到普通親代命中');
    assert.strictEqual(result.nearest.base.k, 217);
    assert.strictEqual(result.nearest.base.step, 73);
    assert.strictEqual(result.nearest.base.slotNum, 2);
  });

  // 5. 吃果普通親代 (1/256) 下一次：k = 609（再過 465 顆，1號位）
  check('吃果普通親代 (1/256) 下一次 -> k=609, step=465, 1號位', function () {
    assert.ok(result.nearest.berry, '應找到吃果普通親代命中');
    assert.strictEqual(result.nearest.berry.k, 609);
    assert.strictEqual(result.nearest.berry.step, 465);
    assert.strictEqual(result.nearest.berry.slotNum, 1);
  });

  // 6. 額外驗證：非閃光親代配置時 missedDueToNormalParent 標記正確
  check('混合親代配置 -> 1號位改普通親代時 k=156 應標記會錯過', function () {
    const mixed = predictor.predictSequence({
      seed: SEED,
      laid: LAID,
      parents: [
        { name: '普通1號', shiny: false },
        { name: '閃光2號', shiny: true },
        { name: '閃光3號', shiny: true }
      ],
      berryActive: false,
      scanDepth: 200
    });
    const node156 = mixed.hits.find(function (h) { return h.k === 156; });
    assert.ok(node156);
    assert.strictEqual(node156.slotNum, 1);
    assert.strictEqual(node156.missedDueToNormalParent, true);
    assert.strictEqual(node156.willHitCurrent, false);
  });

  console.log('\nALL ' + passed + ' ASSERTIONS PASSED!');
}

runTests();
