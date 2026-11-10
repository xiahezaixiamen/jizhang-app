/* 手机端本地数据层 —— 用 IndexedDB 复刻 app.py 的接口。
 *
 * 设计：本文件只做一件事——定义 window.localApi(path, opts)，
 * 其返回结构、错误文案、校验规则与 Python 后端保持一致。
 * index.html 的 api() 在检测到它存在时会直接转交给它，
 * 因此电脑版（有 Python 服务）完全不受影响，两边共用同一份界面代码。
 *
 * 与后端唯一的行为差异：虚拟自动流水（定投/固定支出）在此按日历实时派生，
 * 同样不落库，保证「配置版本 + 日历」重算的幂等性。
 */
(function () {
  'use strict';

  var DB_NAME = 'jizhang';
  var DB_VER = 2;
  var MAX_AMOUNT = 1e12;
  var STORES = ['accounts', 'transactions', 'dca', 'fixed', 'skips', 'meta'];

  var ACCOUNT_TYPES = { deposit: 1, bank: 1, bankwealth: 1, fixed: 1, stock: 1, fund: 1, other: 1, liability: 1 };
  var DAILY_TYPES = { deposit: 1, bank: 1 };
  var HOLD_TYPES = { fixed: 1, stock: 1, fund: 1, other: 1, bankwealth: 1 };
  var PARENT_TYPES = { deposit: 1, bank: 1 };
  var WEALTH_TYPE = 'bankwealth';
  var TX_TYPES = { expense: 1, income: 1, transfer: 1, adjust: 1 };
  var FIXED_CATS = { '餐饮': 1, '交通': 1, '购物': 1, '居住': 1, '娱乐': 1, '医疗': 1, '教育': 1, '通讯': 1, '人情': 1, '其他': 1 };
  var MAX_DAYS = 20000;

  /* ---------- 基础工具 ---------- */

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function todayStr() {
    var d = new Date();
    return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  /* 日期统一换算成「自 1970 起的整数天」，避开夏令时与跨时区误差 */
  function dayNum(s) {
    var p = String(s).split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000;
  }
  function numDay(n) {
    var d = new Date(n * 86400000);
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  function weekdayOf(n) { return new Date(n * 86400000).getUTCDay(); }

  function clip(v, n) { return String(v == null ? '' : v).trim().slice(0, n); }

  function checkDate(v) {
    var s = String(v == null ? '' : v).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('日期格式应为 YYYY-MM-DD');
    var p = s.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    if (d.getUTCFullYear() !== +p[0] || d.getUTCMonth() !== +p[1] - 1 || d.getUTCDate() !== +p[2]) {
      throw new Error('日期格式应为 YYYY-MM-DD');
    }
    return s;
  }

  function checkAmount(v, allowNegative) {
    var a = Number(v);
    if (!isFinite(a)) throw new Error('金额必须是数字');
    if (Math.abs(a) > MAX_AMOUNT) throw new Error('金额超出允许范围');
    if (!allowNegative && a <= 0) throw new Error('金额必须大于 0');
    if (allowNegative && Math.abs(a) < 0.005) throw new Error('差额过小，无需调整');
    return Math.round(a * 100) / 100;
  }

  function newId() {
    var buf = new Uint8Array(6);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    var s = '';
    for (var i = 0; i < buf.length; i++) s += ('0' + buf[i].toString(16)).slice(-2);
    return s;
  }

  function normalizeType(t) { return t === 'cash' ? 'deposit' : t; }

  /* ---------- IndexedDB ---------- */

  var db = null;
  var opening = null;

  function openDb() {
    if (opening) return opening;
    opening = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('此浏览器不支持本地数据库，请换用 Safari 或 Chrome'));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains('accounts')) d.createObjectStore('accounts', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('transactions')) d.createObjectStore('transactions', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('dca')) d.createObjectStore('dca', { keyPath: 'id', autoIncrement: true });
        if (!d.objectStoreNames.contains('fixed')) d.createObjectStore('fixed', { keyPath: 'id', autoIncrement: true });
        /* 已删除的单笔自动支出：key = ruleId + '|' + date，派生时跳过 */
        if (!d.objectStoreNames.contains('skips')) d.createObjectStore('skips', { keyPath: 'k' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'k' });
      };
      req.onsuccess = function () { db = req.result; resolve(db); };
      req.onerror = function () {
        var e = req.error;
        if (e && e.name === 'QuotaExceededError') {
          reject(new Error('存储空间不足'));
        } else {
          reject(new Error('本地数据库打开失败：' + (e && e.message ? e.message : '未知原因')));
        }
      };
      req.onblocked = function () { reject(new Error('本地数据库被其他标签页占用，请关闭其他页面后重试')); };
    });
    return opening;
  }

  function ready() { return db ? Promise.resolve(db) : openDb(); }

  function readAll(store) {
    return ready().then(function () {
      return new Promise(function (resolve, reject) {
        var q = db.transaction(store, 'readonly').objectStore(store).getAll();
        q.onsuccess = function () { resolve(q.result || []); };
        q.onerror = function () { reject(q.error || new Error('读取失败')); };
      });
    });
  }

  /* 批量写：把多次 put/delete 压进同一个事务，保证原子性 */
  function write(ops) {
    return ready().then(function () {
      return new Promise(function (resolve, reject) {
        var touched = {};
        ops.forEach(function (op) { touched[op.store] = 1; });
        var names = Object.keys(touched);
        var t = db.transaction(names, 'readwrite');
        var last = null;
        try {
          ops.forEach(function (op) {
            var s = t.objectStore(op.store);
            if (op.op === 'put') last = s.put(op.value);
            else if (op.op === 'add') last = s.add(op.value);
            else if (op.op === 'del') last = s.delete(op.key);
            else if (op.op === 'clear') last = s.clear();
          });
        } catch (e) { reject(e); return; }
        t.oncomplete = function () { resolve(last ? last.result : null); };
        t.onerror = function () { reject(t.error || new Error('保存失败')); };
        t.onabort = function () { reject(t.error || new Error('保存被中止')); };
      });
    });
  }

  /* 插入序号：保证列表顺序与插入先后一致（IndexedDB 默认按主键排序，不可靠） */
  var seq = 0;
  function nextSeq() { seq += 1; return seq; }

  function bumpSeq(rows) {
    rows.forEach(function (r) {
      if (r && typeof r._seq === 'number' && r._seq > seq) seq = r._seq;
    });
  }

  /* ---------- 虚拟自动流水：定投 + 每日固定支出 ----------
   * 与 app.py 的 _expand_versions / auto_virtual 一一对应：
   * 按日历逐日展开「一条规则」的配置版本，起始日到「今天」全覆盖，
   * 该规则一天至多一笔，配置变更当日按新版本算一次。
   * 固定支出按 ruleId 分组，每条规则各展开一次，同一天可以有多笔。
   * 不写库，每次读取重算。 */
  function expandVersions(versions, asOf, build) {
    if (!versions.length) return [];
    var startN = dayNum(versions[0].effectiveFrom);
    var endN = dayNum(asOf);
    if (!isFinite(startN) || !isFinite(endN) || startN > endN) return [];
    if (endN - startN > MAX_DAYS) startN = endN - MAX_DAYS;

    var out = [], vi = 0, cur = null, n;
    for (n = startN; n <= endN; n++) {
      var iso = numDay(n);
      while (vi < versions.length && versions[vi].effectiveFrom <= iso) {
        cur = versions[vi];
        vi += 1;
      }
      if (!cur || !cur.enabled || !(cur.amount > 0)) continue;
      var md = +cur.monthlyDay || 0;
      if (md) {
        /* 每月固定日：当月没有这一天（如 31 号遇到 2 月）时顺延到月末 */
        var lastDay = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7), 0)).getUTCDate();
        if (+iso.slice(8, 10) !== Math.min(md, lastDay)) continue;
      } else if (cur.weekdaysOnly) {
        var wd = weekdayOf(n);
        if (wd === 0 || wd === 6) continue;
      }
      var item = build(cur, iso);
      if (item) out.push(item);
    }
    return out;
  }

  function buildAuto(dcaVersions, fixedVersions, accounts, asOf, skips) {
    var valid = {};
    accounts.forEach(function (a) { valid[a.id] = 1; });

    var txs = expandVersions(dcaVersions, asOf, function (cur, iso) {
      if (!valid[cur.fromId] || !valid[cur.toId] || cur.fromId === cur.toId) return null;
      return {
        date: iso, type: 'transfer', accountId: cur.fromId, toAccountId: cur.toId,
        category: '', amount: cur.amount, note: '每日定投', auto: true, autoKind: 'dca',
        ruleId: 'dca'   /* 定投只有一条版本链，固定 ruleId 用于按天排除单笔 */
      };
    });

    var groups = {}, order = [];
    fixedVersions.forEach(function (v) {
      var rid = v.ruleId || 'default';
      if (!groups[rid]) { groups[rid] = []; order.push(rid); }
      groups[rid].push(v);
    });
    order.sort();
    order.forEach(function (rid) {
      var vs = groups[rid].slice().sort(function (a, b) {
        if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom < b.effectiveFrom ? -1 : 1;
        return (a.id || 0) - (b.id || 0);
      });
      txs = txs.concat(expandVersions(vs, asOf, function (cur, iso) {
        if (!valid[cur.accountId]) return null;
        return {
          date: iso, type: 'expense', accountId: cur.accountId, toAccountId: '',
          category: cur.category, amount: cur.amount,
          note: cur.monthlyDay ? '每月固定支出' : '每日固定支出',
          auto: true, autoKind: 'fixed', ruleId: rid
        };
      }));
    });

    /* 手动删掉的单笔自动流水：按 (ruleId, date) 排除，定投与固定支出同口径；
       与 jz/derive.py 的 auto_virtual 对齐 */
    if (skips && skips.length) {
      var skip = {};
      skips.forEach(function (s) { skip[(s.ruleId || 'default') + '|' + s.date] = 1; });
      txs = txs.filter(function (t) {
        return !skip[(t.ruleId || 'default') + '|' + t.date];
      });
    }
    txs.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.autoKind < b.autoKind ? -1 : (a.autoKind > b.autoKind ? 1 : 0);
    });
    return txs;
  }

  /* ---------- 组装一份完整数据 ---------- */

  function snapshot() {
    return Promise.all([
      readAll('accounts'), readAll('transactions'), readAll('dca'), readAll('fixed'),
      readAll('skips')
    ]).then(function (r) {
      var accounts = r[0].sort(function (a, b) { return (a._seq || 0) - (b._seq || 0); });
      var txs = r[1].sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return (a._seq || 0) - (b._seq || 0);
      });
      var dca = r[2].sort(function (a, b) {
        if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom < b.effectiveFrom ? -1 : 1;
        return a.id - b.id;
      });
      r[3].forEach(function (v) { if (!v.ruleId) v.ruleId = 'default'; });
      var fixed = r[3].sort(function (a, b) {
        if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
        if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom < b.effectiveFrom ? -1 : 1;
        return a.id - b.id;
      });
      var skips = r[4].map(function (s) {
        return { ruleId: s.ruleId || 'default', date: s.date };
      }).sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return a.ruleId < b.ruleId ? -1 : (a.ruleId > b.ruleId ? 1 : 0);
      });
      bumpSeq(accounts);
      bumpSeq(txs);
      return {
        accounts: accounts, transactions: txs, dca: dca, fixed: fixed,
        autoTransactions: buildAuto(dca, fixed, accounts, todayStr(), skips),
        skips: skips
      };
    });
  }

  /* ---------- 余额（含虚拟流水，与后端 account_balance 同口径） ---------- */

  function balanceOf(accounts, txs, virtuals, aid, asOf) {
    var acc = null;
    for (var i = 0; i < accounts.length; i++) if (accounts[i].id === aid) { acc = accounts[i]; break; }
    if (!acc) throw new Error('账户不存在');
    var bal = Number(acc.initial_balance) || 0;
    txs.forEach(function (t) {
      if (t.date > asOf) return;
      var a = Number(t.amount) || 0;
      if (t.type === 'transfer') {
        if (t.accountId === aid) bal -= a;
        if (t.toAccountId === aid) bal += a;
      } else if (t.accountId === aid) {
        /* 收支/调整只作用于自己的账户。后端用 SQL 的 account_id 过滤，
           这里必须显式判断，否则会把全部账户的流水算到当前账户上。 */
        if (t.type === 'income' || t.type === 'adjust') bal += a;
        else if (t.type === 'expense') bal -= a;
      }
    });
    virtuals.forEach(function (v) {
      if (v.date > asOf) return;
      if (v.type === 'transfer') {
        if (v.accountId === aid) bal -= v.amount;
        if (v.toAccountId === aid) bal += v.amount;
      } else if (v.accountId === aid) {
        if (v.type === 'expense') bal -= v.amount;
        else if (v.type === 'income' || v.type === 'adjust') bal += v.amount;
      }
    });
    return Math.round(bal * 100) / 100;
  }

  /* ---------- 写接口 ---------- */

  function addAccount(d) {
    var name = clip(d.name, 50);
    if (!name) throw new Error('账户名称不能为空');
    var typ = normalizeType(d.type || 'other');
    if (!ACCOUNT_TYPES[typ]) typ = 'other';
    var bal = Number(d.initial_balance || 0);
    if (!isFinite(bal) || Math.abs(bal) > MAX_AMOUNT) throw new Error('初始余额超出允许范围');
    bal = Math.round(bal * 100) / 100;
    var idate = d.initial_date ? checkDate(d.initial_date) : todayStr();
    var row = {
      id: newId(), name: name, type: typ, initial_balance: bal, initial_date: idate,
      note: clip(d.note, 100), parentAccountId: '', _seq: nextSeq(),
      created_at: new Date().toISOString()
    };
    return write([{ op: 'put', store: 'accounts', value: row }]).then(function () { return row; });
  }

  function updateAccount(aid, d) {
    return readAll('accounts').then(function (rows) {
      var cur = null;
      for (var i = 0; i < rows.length; i++) if (rows[i].id === aid) { cur = rows[i]; break; }
      if (!cur) throw new Error('账户不存在');
      var next = Object.assign({}, cur);
      if ('name' in d) {
        var name = clip(d.name, 50);
        if (!name) throw new Error('账户名称不能为空');
        next.name = name;
      }
      if ('type' in d) {
        var typ = normalizeType(d.type);
        if (!ACCOUNT_TYPES[typ]) throw new Error('账户类型无效');
        next.type = typ;
      }
      if ('initial_balance' in d) {
        var bal = Number(d.initial_balance || 0);
        if (!isFinite(bal) || Math.abs(bal) > MAX_AMOUNT) throw new Error('初始余额超出允许范围');
        next.initial_balance = Math.round(bal * 100) / 100;
      }
      if ('initial_date' in d) next.initial_date = checkDate(d.initial_date);
      if ('note' in d) next.note = clip(d.note, 100);
      if (next.type !== WEALTH_TYPE) next.parentAccountId = '';
      return write([{ op: 'put', store: 'accounts', value: next }]).then(function () { return { ok: true }; });
    });
  }

  function deleteAccount(aid) {
    return Promise.all([readAll('transactions'), readAll('accounts')]).then(function (r) {
      var txs = r[0], accounts = r[1];
      if (!accounts.some(function (a) { return a.id === aid; })) throw new Error('账户不存在');
      var ops = [];
      txs.forEach(function (t) {
        if (t.accountId === aid || t.toAccountId === aid) ops.push({ op: 'del', store: 'transactions', key: t.id });
      });
      accounts.forEach(function (a) {
        if (a.parentAccountId === aid) {
          ops.push({ op: 'put', store: 'accounts', value: Object.assign({}, a, { parentAccountId: '' }) });
        }
      });
      ops.push({ op: 'del', store: 'accounts', key: aid });
      return write(ops).then(function () { return { ok: true }; });
    });
  }

  function addTransaction(d) {
    var typ = d.type || 'expense';
    if (!TX_TYPES[typ]) throw new Error('记录类型无效');
    var date = checkDate(d.date);
    var aid = clip(d.account_id, 40);
    var toAid = clip(d.to_account_id, 40);
    var note = clip(d.note, 60);
    var category = clip(d.category, 20);
    var amount;

    if (typ === 'expense' || typ === 'income') {
      if (!aid) throw new Error('请选择账户');
      if (!category) category = '其他';
      amount = checkAmount(d.amount);
    } else if (typ === 'transfer') {
      if (!aid || !toAid) throw new Error('请选择转出和转入账户');
      if (aid === toAid) throw new Error('转出与转入不能是同一个账户');
      amount = checkAmount(d.amount);
      category = '';
    } else {
      if (!aid) throw new Error('请选择账户');
      amount = checkAmount(d.amount, true);
      category = '';
    }

    return readAll('accounts').then(function (rows) {
      var ids = {};
      rows.forEach(function (a) { ids[a.id] = 1; });
      if (aid && !ids[aid]) throw new Error('账户不存在');
      if (toAid && !ids[toAid]) throw new Error('账户不存在');
      var row = {
        id: newId(), date: date, type: typ, accountId: aid,
        toAccountId: typ === 'transfer' ? toAid : '', category: category,
        amount: amount, note: note, _seq: nextSeq(), created_at: new Date().toISOString()
      };
      return write([{ op: 'put', store: 'transactions', value: row }]).then(function () { return row; });
    });
  }

  function deleteTransaction(tid) {
    return readAll('transactions').then(function (rows) {
      if (!rows.some(function (t) { return t.id === tid; })) throw new Error('记录不存在');
      return write([{ op: 'del', store: 'transactions', key: tid }]).then(function () { return { ok: true }; });
    });
  }

  /* 编辑流水：类型不可变更，其余字段与新增同一套校验 */
  function updateTransaction(tid, d) {
    return Promise.all([readAll('transactions'), readAll('accounts')]).then(function (r) {
      var txs = r[0], accounts = r[1];
      var cur = null;
      for (var i = 0; i < txs.length; i++) if (txs[i].id === tid) { cur = txs[i]; break; }
      if (!cur) throw new Error('记录不存在');

      var typ = cur.type;
      var date = checkDate(d.date);
      var aid = clip(d.account_id, 40);
      var toAid = clip(d.to_account_id, 40);
      var note = clip(d.note, 60);
      var category = clip(d.category, 20);
      var amount;

      if (typ === 'expense' || typ === 'income') {
        if (!aid) throw new Error('请选择账户');
        if (!category) category = '其他';
        amount = checkAmount(d.amount);
      } else if (typ === 'transfer') {
        if (!aid || !toAid) throw new Error('请选择转出和转入账户');
        if (aid === toAid) throw new Error('转出与转入不能是同一个账户');
        amount = checkAmount(d.amount);
        category = '';
      } else {
        if (!aid) throw new Error('请选择账户');
        amount = checkAmount(d.amount, true);
        category = '';
      }
      if (typ !== 'transfer') toAid = '';

      var ids = {};
      accounts.forEach(function (a) { ids[a.id] = 1; });
      if (aid && !ids[aid]) throw new Error('账户不存在');
      if (toAid && !ids[toAid]) throw new Error('账户不存在');

      var row = Object.assign({}, cur, {
        date: date, accountId: aid, toAccountId: toAid,
        category: category, amount: amount, note: note
      });
      return write([{ op: 'put', store: 'transactions', value: row }]).then(function () {
        return { id: tid, date: date, type: typ, accountId: aid,
                 toAccountId: toAid, category: category, amount: amount, note: note };
      });
    });
  }

  function revalue(d) {
    var aid = clip(d.account_id, 40);
    var date = checkDate(d.date || todayStr());
    /* 差额按「截至今天」的余额算，写到未来日期当天不生效，下次会重复生成同额调整 */
    if (date > todayStr()) date = todayStr();
    var target = Number(d.value);
    if (!isFinite(target) || Math.abs(target) > MAX_AMOUNT) throw new Error('市值超出允许范围');
    target = Math.round(target * 100) / 100;

    return snapshot().then(function (snap) {
      var curBal = balanceOf(snap.accounts, snap.transactions, snap.autoTransactions, aid, todayStr());
      var delta = Math.round((target - curBal) * 100) / 100;
      if (Math.abs(delta) < 0.005) return { changed: false, balance: curBal, delta: 0 };
      var row = {
        id: newId(), date: date, type: 'adjust', accountId: aid, toAccountId: '',
        category: '', amount: delta, note: clip(d.note, 60) || '市值变动',
        _seq: nextSeq(), created_at: new Date().toISOString()
      };
      return write([{ op: 'put', store: 'transactions', value: row }])
        .then(function () { return { changed: true, balance: target, delta: delta }; });
    });
  }

  /* ---------- 配置版本 ---------- */

  function saveDca(d) {
    var amount = Math.round(Number(d.amount || 0) * 100) / 100;
    if (!isFinite(amount) || amount < 0 || amount > MAX_AMOUNT) throw new Error('金额超出允许范围');
    var fid = clip(d.fromId || d.from_id, 40);
    var tid = clip(d.toId || d.to_id, 40);
    if (!fid || !tid || fid === tid) throw new Error('请选择不同的扣款账户与转入账户');
    var enabled = d.enabled !== false;
    var weekdays = d.weekdaysOnly !== undefined ? !!d.weekdaysOnly : (d.weekdays_only !== false);

    return Promise.all([readAll('accounts'), readAll('dca')]).then(function (r) {
      var accounts = r[0], versions = r[1];
      var types = {};
      accounts.forEach(function (a) { types[a.id] = a.type; });
      if (!DAILY_TYPES[types[fid]]) throw new Error('扣款账户需为「活期」或「银行卡」');
      if (!HOLD_TYPES[types[tid]]) throw new Error('转入账户需为长期持有类（定期/股票/基金/其他）');

      versions.sort(function (a, b) {
        if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom < b.effectiveFrom ? -1 : 1;
        return a.id - b.id;
      });

      var eff, same = null;
      if (!versions.length) {
        eff = checkDate(d.startDate || d.start_date || todayStr());
        if (eff > todayStr()) throw new Error('起始日不能晚于今天');
      } else {
        eff = todayStr();
        for (var i = versions.length - 1; i >= 0; i--) {
          if (versions[i].effectiveFrom === eff) { same = versions[i]; break; }
        }
      }
      var row = {
        id: same ? same.id : undefined, effectiveFrom: eff, amount: amount,
        fromId: fid, toId: tid, weekdaysOnly: weekdays, enabled: enabled
      };
      if (same) row.id = same.id; else delete row.id;
      return write([{ op: 'put', store: 'dca', value: row }]).then(function () {
        return readAll('dca').then(function (v) {
          v.sort(function (a, b) {
            if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom < b.effectiveFrom ? -1 : 1;
            return a.id - b.id;
          });
          return { dca: v };
        });
      });
    });
  }

  /* 与 app.py save_fixed 对齐：不传 ruleId 为新增规则，
     首条可指定起始日，之后新增一律从今天起；传 ruleId 为修改该规则。 */
  function saveFixed(d) {
    var amount = Math.round(Number(d.amount || 0) * 100) / 100;
    if (!isFinite(amount) || amount < 0 || amount > MAX_AMOUNT) throw new Error('金额超出允许范围');
    var aid = clip(d.accountId || d.account_id, 40);
    if (!aid) throw new Error('请选择扣款账户');
    var category = clip(d.category, 20) || '其他';
    if (!FIXED_CATS[category]) throw new Error('分类无效');
    var enabled = d.enabled !== false;
    var weekdays = d.weekdaysOnly !== undefined ? !!d.weekdaysOnly : !!d.weekdays_only;
    var monthlyDay = Math.floor(Number(d.monthlyDay || d.monthly_day || 0));
    if (!isFinite(monthlyDay) || monthlyDay < 0 || monthlyDay > 31) {
      throw new Error('每月扣款日应为 1-31');
    }
    var rid = clip(d.ruleId || d.rule_id, 40);

    return Promise.all([readAll('accounts'), readAll('fixed')]).then(function (r) {
      var accounts = r[0], versions = r[1];
      var acc = null;
      accounts.forEach(function (a) { if (a.id === aid) acc = a; });
      if (!acc || !DAILY_TYPES[acc.type]) throw new Error('扣款账户需为「活期」或「银行卡」');

      versions.forEach(function (v) { if (!v.ruleId) v.ruleId = 'default'; });
      versions.sort(function (a, b) {
        if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom < b.effectiveFrom ? -1 : 1;
        return a.id - b.id;
      });

      var eff, same = null, exists = false, i;
      if (rid) {
        var firstEff = null;
        for (i = 0; i < versions.length; i++) {
          if (versions[i].ruleId === rid) {
            exists = true;
            if (firstEff === null || versions[i].effectiveFrom < firstEff) {
              firstEff = versions[i].effectiveFrom;
            }
          }
        }
        if (!exists) throw new Error('规则不存在或已被删除');
        eff = todayStr();
        /* 首次扣款日在未来的月付规则：改动落在首次版本上，不提前生效 */
        if (monthlyDay && firstEff && firstEff > eff) eff = firstEff;
      } else if (!versions.length || monthlyDay) {
        /* 月付规则允许指定未来的首次扣款日，到那天之前不产生支出 */
        eff = checkDate(d.startDate || d.start_date || todayStr());
        if (eff > todayStr() && !monthlyDay) throw new Error('起始日不能晚于今天');
        rid = !versions.length ? 'default' : newId();
      } else {
        eff = todayStr();
        rid = newId();
      }
      for (i = versions.length - 1; i >= 0; i--) {
        if (versions[i].ruleId === rid && versions[i].effectiveFrom === eff) {
          same = versions[i]; break;
        }
      }
      var row = {
        ruleId: rid, effectiveFrom: eff, amount: amount, accountId: aid,
        category: category, weekdaysOnly: weekdays, monthlyDay: monthlyDay,
        enabled: enabled
      };
      if (same) row.id = same.id;
      return write([{ op: 'put', store: 'fixed', value: row }]).then(function () {
        return readAll('fixed').then(function (v) {
          v.forEach(function (x) { if (!x.ruleId) x.ruleId = 'default'; });
          v.sort(function (a, b) {
            if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
            if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom < b.effectiveFrom ? -1 : 1;
            return a.id - b.id;
          });
          return { fixed: v };
        });
      });
    });
  }

  /* 删除一条规则的全部版本，不影响其他规则 */
  function deleteFixedRule(ruleId) {
    var rid = clip(ruleId, 40);
    return Promise.all([readAll('fixed'), readAll('skips')]).then(function (r) {
      var ops = [];
      r[0].forEach(function (v) {
        if ((v.ruleId || 'default') === rid) {
          ops.push({ op: 'del', store: 'fixed', key: v.id });
        }
      });
      if (!ops.length) throw new Error('规则不存在或已被删除');
      /* 规则没了，它名下的排除记录也就没有意义了 */
      r[1].forEach(function (s) {
        if ((s.ruleId || 'default') === rid) ops.push({ op: 'del', store: 'skips', key: s.k });
      });
      return write(ops).then(function () { return { ok: true }; });
    });
  }

  /* 删掉某一天的某笔自动流水（定投或固定支出，等同 jz 的 add_skip / delete_skip） */
  function addSkip(d) {
    d = d || {};
    var rid = clip(d.ruleId || d.rule_id, 40) || 'default';
    var ds = checkDate(d.date);
    /* 定投只有一条版本链（ruleId 固定为 dca），配置还在就允许排除 */
    var store = rid === 'dca' ? 'dca' : 'fixed';
    return readAll(store).then(function (rows) {
      var has = false;
      rows.forEach(function (v) {
        if (rid === 'dca' || (v.ruleId || 'default') === rid) has = true;
      });
      if (!has) throw new Error('规则不存在或已被删除');
      return write([{
        op: 'put', store: 'skips',
        value: { k: rid + '|' + ds, ruleId: rid, date: ds }
      }]).then(function () { return { ok: true, ruleId: rid, date: ds }; });
    });
  }

  function removeSkip(ruleId, date) {
    var rid = clip(ruleId, 40) || 'default';
    var ds = checkDate(date);
    return write([{ op: 'del', store: 'skips', key: rid + '|' + ds }])
      .then(function () { return { ok: true }; });
  }

  function clearAll() {
    return write([
      { op: 'clear', store: 'transactions' },
      { op: 'clear', store: 'accounts' },
      { op: 'clear', store: 'dca' },
      { op: 'clear', store: 'fixed' },
      { op: 'clear', store: 'skips' }
    ]).then(function () { seq = 0; return { ok: true }; });
  }

  /* 导入：与 replace_all 同语义——整体替换，不是合并 */
  function replaceAll(d) {
    d = d || {};
    var accounts = d.accounts || [];
    var txs = d.transactions || [];
    var ids = {};
    var accOps = [];

    accounts.forEach(function (a) {
      var oldId = clip(a.id, 40);
      var aid = oldId || newId();
      if (ids[aid]) aid = newId();
      ids[aid] = 1;
      var typ = normalizeType(a.type);
      if (!ACCOUNT_TYPES[typ]) typ = 'other';
      var bal = Number(a.initial_balance || 0);
      if (!isFinite(bal)) bal = 0;
      accOps.push({
        op: 'put', store: 'accounts', value: {
          id: aid, name: clip(a.name, 50) || '未命名账户', type: typ,
          initial_balance: Math.round(bal * 100) / 100, initial_date: a.initial_date || '',
          note: clip(a.note, 100), parentAccountId: '', _seq: nextSeq(),
          created_at: new Date().toISOString()
        }
      });
    });

    var txOps = [];
    txs.forEach(function (t) {
      if (!TX_TYPES[t.type]) return;
      var aid = t.accountId || t.account_id || '';
      var toAid = t.toAccountId || t.to_account_id || '';
      if (aid && !ids[aid]) return;
      if (toAid && !ids[toAid]) toAid = '';
      var amt = Math.round(Number(t.amount || 0) * 100) / 100;
      var date;
      try { date = checkDate(t.date); } catch (e) { return; }
      if (t.type === 'adjust') { if (Math.abs(amt) < 0.005) return; }
      else if (amt <= 0) return;
      txOps.push({
        op: 'put', store: 'transactions', value: {
          id: clip(t.id, 40) || newId(), date: date, type: t.type, accountId: aid,
          toAccountId: toAid, category: clip(t.category, 20), amount: amt,
          note: clip(t.note, 60), _seq: nextSeq(), created_at: new Date().toISOString()
        }
      });
    });

    /* 配置版本一并恢复：换手机搬家时定投/固定支出不该丢 */
    var cfgOps = [];
    (d.dca || []).forEach(function (v) {
      var f = v.fromId || v.from_id, t = v.toId || v.to_id;
      if (!ids[f] || !ids[t] || f === t) return;
      var amt = Math.round(Number(v.amount || 0) * 100) / 100;
      if (!(amt > 0)) return;
      var eff;
      try { eff = checkDate(v.effectiveFrom || v.effective_from); } catch (e) { return; }
      cfgOps.push({
        op: 'put', store: 'dca', value: {
          effectiveFrom: eff, amount: amt, fromId: f, toId: t,
          weekdaysOnly: v.weekdaysOnly !== false, enabled: v.enabled !== false
        }
      });
    });
    (d.fixed || []).forEach(function (v) {
      var aid = v.accountId || v.account_id;
      if (!ids[aid]) return;
      var amt = Math.round(Number(v.amount || 0) * 100) / 100;
      if (!(amt > 0)) return;
      var eff;
      try { eff = checkDate(v.effectiveFrom || v.effective_from); } catch (e) { return; }
      var cat = clip(v.category, 20) || '其他';
      if (!FIXED_CATS[cat]) cat = '其他';
      /* 旧备份没有 ruleId / monthlyDay，整条版本链归入默认的每日规则 */
      var rid = clip(v.ruleId || v.rule_id, 40) || 'default';
      var md = Math.floor(Number(v.monthlyDay || v.monthly_day || 0));
      if (!isFinite(md) || md < 0 || md > 31) md = 0;
      cfgOps.push({
        op: 'put', store: 'fixed', value: {
          ruleId: rid, effectiveFrom: eff, amount: amt, accountId: aid, category: cat,
          weekdaysOnly: v.weekdaysOnly === true, monthlyDay: md,
          enabled: v.enabled !== false
        }
      });
    });

    /* 已删除的自动支出也随备份一起搬家，否则换设备后删掉的那几笔会「复活」 */
    var skipOps = [];
    (d.skips || []).forEach(function (s) {
      if (!s || typeof s !== 'object') return;
      var rid = clip(s.ruleId || s.rule_id, 40) || 'default';
      var ds;
      try { ds = checkDate(s.date); } catch (e) { return; }
      skipOps.push({
        op: 'put', store: 'skips', value: { k: rid + '|' + ds, ruleId: rid, date: ds }
      });
    });

    return write([
      { op: 'clear', store: 'transactions' },
      { op: 'clear', store: 'accounts' },
      { op: 'clear', store: 'dca' },
      { op: 'clear', store: 'fixed' },
      { op: 'clear', store: 'skips' }
    ]).then(function () {
      seq = 0;
      accOps.forEach(function (o) {
        if (o.store === 'accounts') o.value._seq = nextSeq();
      });
      txOps.forEach(function (o) { o.value._seq = nextSeq(); });
      return write(accOps.concat(txOps, cfgOps, skipOps));
    }).then(function () {
      return { accounts: accOps.length, transactions: txOps.length };
    });
  }

  /* ---------- 路由 ---------- */

  function route(path, opts) {
    opts = opts || {};
    var method = String(opts.method || 'GET').toUpperCase();
    var body = opts.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    var parts = path.split('?')[0].split('/').filter(Boolean);

    if (method === 'GET' && path.split('?')[0] === '/api/data') return snapshot();

    if (method === 'POST' && path.split('?')[0] === '/api/accounts') return addAccount(body);
    if (method === 'POST' && path.split('?')[0] === '/api/transactions') return addTransaction(body);
    if (method === 'POST' && path.split('?')[0] === '/api/revalue') return revalue(body);
    if (method === 'POST' && path.split('?')[0] === '/api/import') return replaceAll(body);
    if (method === 'POST' && path.split('?')[0] === '/api/clear') return clearAll();
    if (method === 'POST' && path.split('?')[0] === '/api/dca') return saveDca(body);
    if (method === 'POST' && path.split('?')[0] === '/api/fixed') return saveFixed(body);
    if (method === 'POST' && path.split('?')[0] === '/api/skips') return addSkip(body);

    if (method === 'PUT' && parts.length === 3 && parts[1] === 'accounts') {
      return updateAccount(parts[2], body);
    }
    if (method === 'PUT' && parts.length === 3 && parts[1] === 'transactions') {
      return updateTransaction(parts[2], body);
    }
    if (method === 'DELETE' && parts.length === 3 && parts[1] === 'accounts') {
      return deleteAccount(parts[2]);
    }
    if (method === 'DELETE' && parts.length === 3 && parts[1] === 'transactions') {
      return deleteTransaction(parts[2]);
    }
    if (method === 'DELETE' && parts.length === 4 && parts[1] === 'skips') {
      return removeSkip(decodeURIComponent(parts[2]), parts[3]);
    }
    if (method === 'DELETE' && parts.length === 2 && parts[1] === 'dca') {
      /* 配置清空时，针对定投的排除记录也一并清掉，避免留下孤儿 */
      return readAll('skips').then(function (rows) {
        var ops = [{ op: 'clear', store: 'dca' }];
        rows.forEach(function (s) {
          if ((s.ruleId || 'default') === 'dca') ops.push({ op: 'del', store: 'skips', key: s.k });
        });
        return write(ops).then(function () { return { ok: true }; });
      });
    }
    if (method === 'DELETE' && parts.length === 3 && parts[1] === 'fixed') {
      return deleteFixedRule(parts[2]);
    }
    if (method === 'DELETE' && parts.length === 2 && parts[1] === 'fixed') {
      return write([{ op: 'clear', store: 'fixed' }]).then(function () { return { ok: true }; });
    }

    return Promise.reject(new Error('接口不存在'));
  }

  window.localApi = function (path, opts) {
    return Promise.resolve().then(function () { return route(path, opts); });
  };

  /* 供导出/导入面板使用 */
  window.localDb = {
    snapshot: snapshot,
    replaceAll: replaceAll,
    clearAll: clearAll,
    today: todayStr
  };
})();
