'use strict';
'use strict';
var TYPE_META = {
deposit:   {label:'活期',                color:'#0071e3', kind:'cash',      role:'daily'},
bank:      {label:'银行卡',              color:'#34c759', kind:'cash',      role:'daily'},
bankwealth:{label:'银行理财',            color:'#ffcc00', kind:'invest',    role:'wealth', plainLabel:true},
fixed:     {label:'定期存款',            color:'#30b0c7', kind:'cash',      role:'hold'},
stock:     {label:'股票',                color:'#ff3b30', kind:'invest',    role:'hold'},
fund:      {label:'基金',                color:'#ff9500', kind:'invest',    role:'hold'},
other:     {label:'其他资产',            color:'#5856d6', kind:'invest',    role:'hold'},
liability: {label:'负债',                color:'#a13ff6', kind:'liability', role:'debt'}
};
var ROLE_META = {
daily:  {label:'日常可用',           short:'日常', inLedger:true,
desc:'活期与银行卡分开核算，日常收支默认从这里扣'},
wealth: {label:'银行理财', short:'理财', inLedger:true,
desc:'单独记账、单独汇总，不计入活期或银行卡的可用余额'},
hold:   {label:'长期持有',           short:'长期', inLedger:true,
desc:'不参与日常消费，只在转账或更新市值时变动'},
debt:   {label:'负债',               short:'负债', inLedger:false, suffix:'（欠款）',
desc:'欠款，不计入可用资金'}
};
var ROLE_ORDER = Object.keys(ROLE_META);
var NON_TRANSFER_ROLES = ROLE_ORDER.filter(function(r){ return ROLE_META[r].inLedger !== false; });
var TABS = [
{id:'overview', label:'资产', render:function(){ renderOverview(); }},
{id:'ledger',   label:'记账', render:function(){ renderLedger(); }},
{id:'analysis', label:'分析', render:function(){ renderAnalysis(); }},
{id:'salary',   label:'算薪', render:function(){ renderSalary(); }},
{id:'data',     label:'数据', render:function(){ renderData(); }}
];
function tabById(id){
for (var i=0;i<TABS.length;i++) if (TABS[i].id === id) return TABS[i];
return TABS[0];
}
function buildNav(){
var nav = document.getElementById('nav');
if (!nav) return;
nav.innerHTML = TABS.map(function(t){
return '<button data-tab="' + t.id + '"' +
(t.id === activeTab ? ' class="active"' : '') + '>' + t.label + '</button>';
}).join('');
}
var AUTO_KIND = {DCA:'dca', FIXED:'fixed'};
function autoTxOf(kind){
return db.autoTx.filter(function(t){ return t.autoKind === kind; });
}
var EX_CATS = ['餐饮','交通','购物','居住','娱乐','医疗','教育','通讯','人情','其他'];
var IN_CATS = ['工资','奖金','投资收益','红包','报销','其他'];
var CAT_COLORS = ['#0071e3','#ff9500','#ff3b30','#30b0c7','#5856d6','#af52de','#ff2d55','#34c759','#ffcc00','#8e8e93'];
var LS_KEY = 'pfa_data_v1';
var privacyOn = true;
var PRIVACY_MASK = '••••';
var db = {accounts:[], transactions:[], dca:[], fixed:[], autoTx:[], skips:[]};
var txType = 'expense';
var activeTab = 'overview';
var lastAccountId = '';
function today(){
var d = new Date();
return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function thisMonth(){ return today().slice(0,7); }
function money(v){
if (privacyOn) return PRIVACY_MASK;
var n = Math.round((v||0) * 100) / 100;
var s = Math.abs(n).toLocaleString('zh-CN', {minimumFractionDigits:2, maximumFractionDigits:2});
return (n < 0 ? '-¥' : '¥') + s;
}
function moneyShort(v){
if (privacyOn) return PRIVACY_MASK;
if (Math.abs(v) >= 10000) return (v < 0 ? '-¥' : '¥') + (Math.abs(v)/10000).toFixed(2) + ' 万';
return money(v);
}
function num(v){
if (privacyOn) return PRIVACY_MASK;
return (Math.round((v||0)*100)/100).toLocaleString('zh-CN', {minimumFractionDigits:2, maximumFractionDigits:2});
}
function esc(s){
return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
});
}
function accountById(id){
for (var i=0;i<db.accounts.length;i++) if (db.accounts[i].id === id) return db.accounts[i];
return null;
}
function kindOf(a){ return (TYPE_META[a.type] || TYPE_META.other).kind; }
function roleOf(a){ return (TYPE_META[a.type] || TYPE_META.other).role; }
function accountsByRole(role){
return db.accounts.filter(function(a){ return roleOf(a) === role; });
}
function sumRole(role){
var bal = currentBalances(), s = 0;
accountsByRole(role).forEach(function(a){ s += bal[a.id] || 0; });
return s;
}
/* ================= 计算层 ================= */
function applyTx(bal, t){
var a = t.amount;
if (t.type === 'transfer'){
if (t.accountId) bal[t.accountId] = (bal[t.accountId] || 0) - a;
if (t.toAccountId) bal[t.toAccountId] = (bal[t.toAccountId] || 0) + a;
return;
}
if (!t.accountId) return;
if (t.type === 'income' || t.type === 'adjust') bal[t.accountId] = (bal[t.accountId] || 0) + a;
else if (t.type === 'expense') bal[t.accountId] = (bal[t.accountId] || 0) - a;
}
/* ---------- 派生结果缓存 ----------
db 只在 reload() 里整体替换，所以用「db 引用」当缓存版本：引用一变，全部派生结果
自动失效，不必在每个写接口里手动清理。要缓存的原因：
· currentBalances 被 sumRole×3、renderOverview、输入预览反复调用，
金额框每敲一个键就算两次全量余额；
· monthStats 在一次完整渲染里被调用 30 次，不缓存就是同一次全量扫描做 30 遍；
· buildSeries 是「日期 × 账户」的双层循环，资产页和分析页各算一遍。
缓存对象只读，调用方不得原地修改。 */
var _cache = {db:null, txAll:null, balances:null, months:null, series:null, size:null};
function cache(){
if (_cache.db !== db){
_cache = {db:db, txAll:null, balances:null, months:null, series:null, size:null};
}
return _cache;
}
/* 真实流水 + 虚拟流水：多处都要用同一份合并结果，省掉每次 concat 的数组复制 */
function allTx(){
var c = cache();
if (!c.txAll) c.txAll = db.transactions.concat(db.autoTx);
return c.txAll;
}
function computeBalances(){
var t0 = today();
var bal = {};
db.accounts.forEach(function(a){ bal[a.id] = 0; });
db.accounts.forEach(function(a){
if (!a.initial_date || a.initial_date <= t0) bal[a.id] += a.initial_balance;
});
/* 每日定投/固定支出：虚拟流水不写库，只参与余额推导；
明细里会展示，是否计入收支由 monthIndex 按 type 决定（transfer 不计） */
allTx().forEach(function(t){
if (t.date <= t0) applyTx(bal, t);
});
return bal;
}
function currentBalances(){
var c = cache();
if (!c.balances) c.balances = computeBalances();
return c.balances;
}
function netOf(bal){
var assets = 0, liab = 0;
db.accounts.forEach(function(a){
var v = bal[a.id] || 0;
if (a.type === 'liability') liab += v; else assets += v;
});
return {assets: assets, liab: liab, net: assets - liab};
}
function buildSeries(){
var c = cache();
if (c.series) return c.series;
var t0 = today();
var byDate = {};
/* 自动支出会让净资产逐日减少，必须进入时间序列；定投 transfer 不改变净资产 */
allTx().forEach(function(t){
(byDate[t.date] = byDate[t.date] || []).push(t);
});
var set = {};
Object.keys(byDate).forEach(function(d){ set[d] = 1; });
db.accounts.forEach(function(a){ if (a.initial_date) set[a.initial_date] = 1; });
set[t0] = 1;
var dates = Object.keys(set).sort().filter(function(d){ return d <= t0; });
var bal = {}, applied = {};
db.accounts.forEach(function(a){ bal[a.id] = 0; });
var out = [];
dates.forEach(function(d){
db.accounts.forEach(function(a){
if (applied[a.id]) return;
if (!a.initial_date || a.initial_date <= d){
bal[a.id] += a.initial_balance;
applied[a.id] = true;
}
});
(byDate[d] || []).forEach(function(t){ applyTx(bal, t); });
var n = netOf(bal);
out.push({date: d, net: n.net, assets: n.assets, liab: n.liab});
});
c.series = out;
return out;
}
function monthKey(d){ return d.slice(0,7); }
/* 月份索引：一次遍历建好全部月份。renderLedger + renderAnalysis 一次渲染要取
30 个月份的收支，逐月全表扫描等于把同一份数据扫 30 遍。 */
function monthIndex(){
var c = cache();
if (c.months) return c.months;
var t0 = today(), idx = {};
/* 自动固定支出计入收支统计；定投是 transfer，天然不会被统计。
未来日期的记录尚未生效，与余额、周期统计保持同一口径，这里统一排除。 */
allTx().forEach(function(t){
if (t.date > t0) return;
var k = monthKey(t.date);
var m = idx[k] || (idx[k] = {income:0, expense:0, count:0, byCat:{}, balance:0});
if (t.type === 'income'){
m.income += t.amount; m.count++;
} else if (t.type === 'expense'){
m.expense += t.amount; m.count++;
m.byCat[t.category] = (m.byCat[t.category] || 0) + t.amount;
}
});
Object.keys(idx).forEach(function(k){ idx[k].balance = idx[k].income - idx[k].expense; });
c.months = idx;
return idx;
}
function monthStats(month){
return monthIndex()[month] || {income:0, expense:0, count:0, byCat:{}, balance:0};
}
function lastMonths(n){
var out = [], d = new Date(), y = d.getFullYear(), m = d.getMonth();
for (var i = n-1; i >= 0; i--){
var mm = m - i, yy = y;
while (mm < 0){ mm += 12; yy -= 1; }
out.push(yy + '-' + String(mm+1).padStart(2,'0'));
}
return out;
}
/* 投资类账户盈亏：当前余额 − 建账余额 − 净投入（含虚拟定投，避免把投入误算成盈亏） */
function accountPerf(a, balNow){
var t0 = today();
var invested = 0, withdrawn = 0, hasMarket = false;
allTx().forEach(function(t){
if (t.date > t0) return;
if (t.type === 'transfer'){
if (t.toAccountId === a.id) invested += t.amount;
if (t.accountId === a.id) withdrawn += t.amount;
} else if (t.accountId === a.id && t.type === 'adjust'){
hasMarket = true;
}
});
var netIn = invested - withdrawn;
var end = (balNow == null) ? a.initial_balance + netIn : balNow;
var gain = end - a.initial_balance - netIn;
var base = Math.abs(a.initial_balance) + netIn / 2;
if (base < 0.01) base = Math.abs(gain) || 1;
return {
id: a.id, name: a.name, type: a.type,
start: a.initial_balance, invested: netIn, gain: gain,
end: end, rate: gain / base, hasMarket: hasMarket
};
}
/* ================= 金额隐私 ================= */
var EYE_OFF = '<path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>' +
'<path d="M10.7 5.1A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7"/>' +
'<path d="M6.6 6.6A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/>' +
'<path d="M2 2l20 20"/>';
var EYE_ON = '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/>' +
'<circle cx="12" cy="12" r="2.8"/>';
function updatePrivacyBtn(){
var btn = document.getElementById('privacy-btn');
if (!btn) return;
document.getElementById('privacy-icon').innerHTML = privacyOn ? EYE_OFF : EYE_ON;
var label = privacyOn ? '显示金额' : '隐藏金额';
btn.setAttribute('aria-label', label);
btn.setAttribute('aria-pressed', String(!privacyOn));
btn.title = label;
}
/* 指标数字滚动：渲染时把数值登记在 JS 内存里，DOM 只存索引（不泄露真实金额）。
覆盖资产页 5 张卡、明细页 4 张卡，以及「较上次记录」「收入/支出」里的金额。
只在「隐藏 → 显示」那一次切换时播放；隐私开启时不写真实数值，
reduce 动效时直接保持终值。 */
var ROLL_SLOTS = [];
var rollRaf = 0;
/* 终值 ≥ 1 万时全程用「万」格式，避免中途从 ¥9,999.00 跳成 ¥1.00 万 */
function rollFmtMoney(v, target){
if (Math.abs(target) >= 10000) return (v < 0 ? '-¥' : '¥') + (Math.abs(v)/10000).toFixed(2) + ' 万';
return money(v);
}
function rollFmtNum(v){ return num(v); }
function rollIndex(value, fmt){
var i = ROLL_SLOTS.length;
ROLL_SLOTS.push({v:value, fmt:fmt || rollFmtMoney});
return i;
}
function rollSpan(value, text, fmt){
return '<span data-ri="' + rollIndex(value, fmt) + '">' + text + '</span>';
}
function stopRoll(){
if (rollRaf){ cancelAnimationFrame(rollRaf); rollRaf = 0; }
}
function rollMetrics(){
stopRoll();
if (privacyOn) return;
if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
var scope = document.querySelector('section.tab.show');
if (!scope) return;
var items = [];
Array.prototype.forEach.call(scope.querySelectorAll('[data-ri]'), function(el){
var s = ROLL_SLOTS[+el.getAttribute('data-ri')];
if (s && isFinite(s.v)) items.push({el:el, v:s.v, fmt:s.fmt});
});
if (!items.length) return;
var t0 = performance.now(), dur = 780;
function step(t){
if (privacyOn){ stopRoll(); return; }
var p = Math.min(1, (t - t0) / dur);
var k = 1 - Math.pow(1 - p, 3);
items.forEach(function(it){ it.el.textContent = it.fmt(it.v * k, it.v); });
rollRaf = p < 1 ? requestAnimationFrame(step) : 0;
}
items.forEach(function(it){ it.el.textContent = it.fmt(0, it.v); });
rollRaf = requestAnimationFrame(step);
}
function togglePrivacy(){
var wasHidden = privacyOn;
privacyOn = !privacyOn;
updatePrivacyBtn();
renderAll();
if (wasHidden && !privacyOn) rollMetrics();
}
document.getElementById('privacy-btn').addEventListener('click', togglePrivacy);
/* ================= 通用弹窗 ================= */
var ALERT_SVG = {
info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9.2"/><path d="M12 11.2v5"/><path d="M12 7.6h.01"/></svg>',
success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.2"/><path d="M7.8 12.3l2.8 2.8 5.6-5.8"/></svg>',
error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9.2"/><path d="M9 9l6 6M15 9l-6 6"/></svg>'
};
var alertOpen = false, alertLastFocus = null;
function alertKind(msg, opt){
if (opt && opt.kind) return opt.kind;
if (/失败|错误|异常|无法|不可恢复/.test(msg)) return 'error';
if (/成功|已完成|完成：|已载入|已写入|已迁移/.test(msg)) return 'success';
return 'info';
}
function showAlert(msg, opt){
opt = opt || {};
var text = String(msg == null ? '' : msg);
var kind = alertKind(text, opt);
alertLastFocus = document.activeElement;
document.getElementById('alert-text').textContent = text;
document.getElementById('alert-title').textContent = opt.title ||
(kind === 'error' ? '操作失败' : kind === 'success' ? '已完成' : '提示');
var ic = document.getElementById('alert-icon');
ic.className = 'alert-icon ' + kind;
ic.innerHTML = ALERT_SVG[kind];
document.getElementById('alert-mask').classList.add('show');
alertOpen = true;
setTimeout(function(){
var box = document.querySelector('#alert-mask .alert-box');
if (box) box.focus();
}, 30);
}
function closeAlert(){
if (!alertOpen) return;
alertOpen = false;
document.getElementById('alert-mask').classList.remove('show');
var prev = alertLastFocus; alertLastFocus = null;
if (prev && prev.focus){ try { prev.focus(); } catch(e){} }
}
document.getElementById('alert-ok').addEventListener('click', closeAlert);
document.addEventListener('keydown', function(e){
if (!alertOpen) return;
if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' '){
e.preventDefault(); e.stopPropagation(); closeAlert();
}
}, true);
/* 提示类型不再靠中文文案正则去猜：成功/失败由调用点显式声明。
alertKind() 里的正则只作为兜底，留给「请填写金额」这类中性校验提示。 */
window.alert = function(msg){ showAlert(msg); };
window.alert.error = function(msg){ showAlert(msg, {kind:'error'}); };
window.alert.success = function(msg){ showAlert(msg, {kind:'success'}); };
/* ================= 表单弹窗 ================= */
var modalOK = null;
function openModal(title, bodyHTML, onOK, okLabel, hideCancel, okClass){
document.getElementById('modal-title').textContent = title;
document.getElementById('modal-body').innerHTML = bodyHTML;
modalOK = onOK;
var okBtn = document.getElementById('modal-ok');
okBtn.textContent = okLabel || '保存';
okBtn.className = 'btn ' + (okClass || 'btn-primary');
var cancel = document.getElementById('modal-cancel');
if (cancel) cancel.style.display = hideCancel ? 'none' : '';
hideUndo();
document.getElementById('modal-mask').classList.add('show');
}
function closeModal(){
document.getElementById('modal-mask').classList.remove('show');
modalOK = null;
}
document.getElementById('modal-ok').addEventListener('click', async function(){
if (!modalOK) return;
var btn = this; btn.disabled = true;
try {
var r = await modalOK();
if (r !== false) closeModal();
} catch(e){
alert.error(e.message || '保存失败');
} finally {
btn.disabled = false;
}
});
document.getElementById('modal-mask').addEventListener('click', function(e){
if (e.target === this) closeModal();
});
document.addEventListener('keydown', function(e){
if (e.key === 'Escape' && !alertOpen) closeModal();
});
/* ================= 接口 ================= */
async function api(path, opts){
if (window.localApi) return window.localApi(path, opts);
opts = opts || {};
if (opts.body && typeof opts.body !== 'string'){
opts.headers = Object.assign({'Content-Type':'application/json'}, opts.headers || {});
opts.body = JSON.stringify(opts.body);
}
var res = await fetch(path, opts);
var data = null;
try { data = await res.json(); } catch(e){}
if (!res.ok) throw new Error((data && data.error) || ('请求失败 ' + res.status));
return data;
}
function normalize(d){
var accounts = (d.accounts || []).map(function(a){
return {
id: a.id, name: a.name || '未命名',
type: (a.type === 'cash' ? 'deposit' : (TYPE_META[a.type] ? a.type : 'other')),
initial_balance: +a.initial_balance || 0,
initial_date: a.initial_date || '',
note: a.note || '',
parentAccountId: a.parentAccountId || a.parent_account_id || ''
};
});
var transactions = (d.transactions || []).map(function(t){
return {
id: t.id, date: t.date, type: t.type,
accountId: t.accountId || '', toAccountId: t.toAccountId || '',
category: t.category || '', amount: +t.amount || 0, note: t.note || ''
};
});
var dca = (d.dca || []).map(function(v){
return {
id: v.id, effectiveFrom: v.effectiveFrom || '', amount: +v.amount || 0,
fromId: v.fromId || '', toId: v.toId || '',
weekdaysOnly: v.weekdaysOnly !== false, enabled: v.enabled !== false
};
});
var fixed = (d.fixed || []).map(function(v){
return {
id: v.id, ruleId: v.ruleId || v.rule_id || 'default',
effectiveFrom: v.effectiveFrom || '', amount: +v.amount || 0,
accountId: v.accountId || '', category: v.category || '其他',
weekdaysOnly: v.weekdaysOnly === true, monthlyDay: +v.monthlyDay || 0,
enabled: v.enabled !== false
};
});
/* autoTx 含两类：dca=transfer（净资产不变）、fixed=expense（净资产减少） */
var autoTx = (d.autoTransactions || []).map(function(t){
return {
date: t.date, type: t.type || 'transfer',
accountId: t.accountId || '', toAccountId: t.toAccountId || '',
category: t.category || '', amount: +t.amount || 0,
note: t.note || '', auto: true, autoKind: t.autoKind || AUTO_KIND.DCA,
ruleId: t.ruleId || ''
};
});
/* 手动删除的自动支出：自动支出是按日历派生的，删不掉「那一天」本身，
只能记一条排除记录，重新派生时跳过它 */
var skips = (d.skips || []).map(function(s){
return {ruleId: s.ruleId || s.rule_id || 'default', date: s.date || ''};
}).filter(function(s){ return !!s.date; });
return {accounts: accounts, transactions: transactions,
dca: dca, fixed: fixed, autoTx: autoTx, skips: skips};
}
async function reload(){
db = normalize(await api('/api/data'));
renderAll();
}
;
/* ================= 渲染：资产总览 ================= */
var charts = {};
function draw(id, cfg){
var el = document.getElementById(id);
if (!el || typeof Chart === 'undefined') return;
var prev = charts[id];
if (prev) prev.destroy();
/* 重绘（切页签、记完一笔后刷新）不再重放生长动画：数据没变却整片重新长一遍很跳。
首次绘制仍然带动画；Chart.js 建实例时会缓存动画配置，所以必须在构造前改。 */
if (prev && cfg.options && cfg.options.animation === undefined) cfg.options.animation = false;
charts[id] = new Chart(el, cfg);
}
function baseOpts(extra){
var horizontal = !!(extra && extra.indexAxis === 'y');
var catAxis = {grid:{display:false}, ticks:{font:{size:11}, color:'rgba(60,60,67,.62)'}, border:{display:false}};
var numAxis = {grid:{color:'rgba(0,0,0,.05)'}, border:{display:false},
ticks:{font:{size:11}, color:'rgba(60,60,67,.62)',
callback:function(v){ return privacyOn ? '' : (Math.abs(v)>=10000 ? (v/10000)+'万' : v); }}};
var timeAxis = {grid:{display:false}, border:{display:false},
ticks:{font:{size:11}, color:'rgba(60,60,67,.62)', maxTicksLimit:8, autoSkip:true, maxRotation:0}};
var o = {
responsive: true,
maintainAspectRatio: false,
interaction: {mode:'index', intersect:false},
plugins: {
legend: {display:false},
tooltip: {
backgroundColor:'rgba(0,0,0,.82)', padding:10, cornerRadius:8,
titleFont:{size:12}, bodyFont:{size:12},
callbacks: {
label: function(ctx){
var v = ctx.parsed;
if (v && typeof v === 'object') v = (typeof v.y === 'number' ? v.y : v.x);
return ctx.dataset.label + '：' + money(v);
}
}
}
},
scales: horizontal
? {x: numAxis, y: catAxis}
: {x: timeAxis, y: numAxis}
};
if (extra) {
Object.keys(extra).forEach(function(k){
if (k === 'plugins') o.plugins = Object.assign(o.plugins, extra.plugins);
else if (k !== 'indexAxis') o[k] = extra[k];
else o.indexAxis = extra[k];
});
}
return o;
}
/* ================= 花销洞察 ================= */
/* 统一口径：截至今天、仅 type=expense；金额类含规则自动支出，
笔数/笔均/频次类仅手动记录。全部实时由 db 聚合，不缓存、不落库。
隐私态下金额、占比、笔数、排名一律掩码，避免「笔均 × 笔数」反推总额。 */
function monthShift(ym, delta){
var y = +ym.slice(0,4), m = +ym.slice(5,7) - 1 + delta;
var d = new Date(y, m, 1);
return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
}
function daysInMonth(ym){
return new Date(+ym.slice(0,4), +ym.slice(5,7), 0).getDate();
}
function shiftDate(iso, delta){
var d = new Date(iso + 'T00:00:00');
d.setDate(d.getDate() + delta);
return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') +
'-' + String(d.getDate()).padStart(2,'0');
}
function isWeekend(iso){
var w = new Date(iso + 'T00:00:00').getDay();
return w === 0 || w === 6;
}
function spendIn(from, to){
var t0 = today();
var end = to > t0 ? t0 : to;
return allTx().filter(function(t){
return t.type === 'expense' && t.date >= from && t.date <= end && t.date <= t0;
});
}
function spendTotal(list){
return list.reduce(function(s,t){ return s + (t.amount || 0); }, 0);
}
function spendManual(list){ return list.filter(function(t){ return !t.auto; }); }
function spendAuto(list){ return list.filter(function(t){ return !!t.auto; }); }
function spendByCat(list){
var o = {};
list.forEach(function(t){
var k = t.category || '其他';
o[k] = (o[k] || 0) + (t.amount || 0);
});
return Object.keys(o).map(function(k){ return {cat:k, amount:o[k]}; })
.sort(function(a,b){ return b.amount - a.amount; });
}
function insText(v){ return privacyOn ? PRIVACY_MASK : v; }
function insPct(v){ return privacyOn ? PRIVACY_MASK : (Math.round(v*10)/10).toFixed(1) + '%'; }
function insRate(v){
return privacyOn ? PRIVACY_MASK : (v >= 0 ? '+' : '') + (Math.round(v*10)/10).toFixed(1) + '%';
}
function insCount(v){ return privacyOn ? PRIVACY_MASK : v + ' 笔'; }
function insNA(){ return '数据不足'; }
function insEmpty(note){ return '<div class="empty">' + esc(note) + '</div>'; }
function insTable(head, rows){
if (!rows.length) return insEmpty('这个区间还没有可展示的记录');
return '<table><thead><tr>' + head.map(function(h){
return '<th' + (h.num ? ' class="num"' : '') + '>' + h.t + '</th>';
}).join('') + '</tr></thead><tbody>' + rows.map(function(r){
return '<tr>' + r.map(function(c, i){
return '<td' + (head[i] && head[i].num ? ' class="num"' : '') + '>' + c + '</td>';
}).join('') + '</tr>';
}).join('') + '</tbody></table>';
}
function insRecordRows(list, limit){
var lim = limit || 40;
var rows = list.slice(0, lim).map(function(t){
var acc = accountById(t.accountId);
var sub = t.date.slice(5) + (acc ? ' · ' + acc.name : '') +
(t.auto ? ' · 自动' : '') + (t.note ? ' · ' + t.note : '');
return '<div class="row"><span class="name">' + insText(esc(t.category || '其他')) +
' <small>' + insText(esc(sub)) + '</small></span>' +
'<span class="num">' + money(t.amount) + '</span></div>';
}).join('');
if (!rows) return insEmpty('这个区间还没有支出记录');
return rows + (list.length > lim
? '<div class="note">仅显示前 ' + lim + ' 条，共 ' + insText(list.length + ' 条') + '</div>' : '');
}
function insMedian(list){
if (!list.length) return 0;
var a = list.map(function(t){ return t.amount; }).sort(function(x,y){ return x-y; });
var i = Math.floor(a.length/2);
return a.length % 2 ? a[i] : (a[i-1]+a[i])/2;
}
function insHead(title, note){
return '<div class="insight-detail"><div class="note">' + note + '</div>' + title + '</div>';
}
function buildInsights(){
var t0 = today(), ym = thisMonth(), day = +t0.slice(8,10);
var curFrom = ym + '-01', curTo = t0;
var pm = monthShift(ym, -1);
var pDay = Math.min(day, daysInMonth(pm));
var prevFrom = pm + '-01', prevTo = pm + '-' + String(pDay).padStart(2,'0');
var d30From = shiftDate(t0, -29);
var cur = spendIn(curFrom, curTo);
var prev = spendIn(prevFrom, prevTo);
var d30 = spendIn(d30From, t0);
var curTotal = spendTotal(cur), prevTotal = spendTotal(prev);
var curMan = spendManual(cur), curAuto = spendAuto(cur);
var cats = spendByCat(cur), prevCats = spendByCat(prev);
var none = cur.length === 0;
var hasPrev = prev.length > 0 && prevTotal > 0;
var out = [];
var scope = '本月 ' + curFrom.slice(5) + ' ~ ' + curTo.slice(5) +
'；对比上月同期 ' + prevFrom.slice(5) + ' ~ ' + prevTo.slice(5) +
'。金额含规则自动支出，笔数与笔均仅统计手动记录；未来日期不计入。';
/* 合并两期分类，供环比与增幅使用 */
var catMap = {};
cats.forEach(function(c){ catMap[c.cat] = {cur:c.amount, prev:0}; });
prevCats.forEach(function(c){
if (!catMap[c.cat]) catMap[c.cat] = {cur:0, prev:c.amount};
else catMap[c.cat].prev = c.amount;
});
var cmp = Object.keys(catMap).map(function(k){
return {k:k, cur:catMap[k].cur, prev:catMap[k].prev, d:catMap[k].cur - catMap[k].prev};
}).sort(function(a,b){ return b.d - a.d; });
/* 1 · 最大花销分类 */
var top = cats[0];
var topList = top ? cur.filter(function(x){ return (x.category||'其他') === top.cat; }) : [];
out.push({
lab:'最大花销分类',
val: none ? insNA() : insText(esc(top.cat)),
foot: none ? '本月至今 · 含自动支出'
: insPct(curTotal > 0 ? top.amount/curTotal*100 : 0) + ' · ' + money(top.amount),
title:'最大花销分类' + (none ? '' : ' · ' + (privacyOn ? PRIVACY_MASK : esc(top.cat))),
body: none ? insEmpty('本月至今还没有支出记录') :
insHead('', scope) +
insTable([{t:'分类'},{t:'金额',num:true},{t:'占比',num:true},{t:'笔数',num:true}],
[[insText(esc(top.cat)), money(top.amount),
insPct(curTotal>0 ? top.amount/curTotal*100 : 0), insCount(topList.length)]]) +
insRecordRows(topList),
empty: none
});
/* 2 · 前三分类集中度 */
var top3 = cats.slice(0,3);
var top3sum = top3.reduce(function(s,c){ return s + c.amount; }, 0);
out.push({
lab:'前三分类集中度',
val: none ? insNA() : insPct(curTotal > 0 ? top3sum/curTotal*100 : 0),
foot: none ? '本月至今' : insText(top3.map(function(c){ return c.cat; }).join(' / ')),
title:'前三分类集中度',
body: none ? insEmpty('本月至今还没有支出记录') :
insHead('', '占比越高说明支出越集中在少数几类；分母为本月至今总支出（含自动）。') +
insTable([{t:'分类'},{t:'金额',num:true},{t:'占比',num:true},{t:'笔数',num:true}],
top3.map(function(c){
return [insText(esc(c.cat)), money(c.amount),
insPct(curTotal>0 ? c.amount/curTotal*100 : 0),
insCount(cur.filter(function(t){ return (t.category||'其他') === c.cat; }).length)];
})),
empty: none
});
/* 3 · 本月至今 vs 上月同期 */
var diff = curTotal - prevTotal;
var rate = hasPrev ? diff/prevTotal*100 : 0;
out.push({
lab:'本月至今 vs 上月同期',
val: !hasPrev || none ? insNA() : insRate(rate),
foot: '本期 ' + money(curTotal) + ' · 上期 ' + money(prevTotal),
title:'本月至今 vs 上月同期',
body: !hasPrev ? insEmpty('上月同期没有支出记录，暂时无法对比') :
insHead('', '按相同日序对齐（本月 1 号~今天 vs 上月 1 号~' + pDay + ' 号），避免当月未过完造成的低估。') +
insTable([{t:'分类'},{t:'本期',num:true},{t:'上期',num:true},{t:'差额',num:true}],
cmp.map(function(c){
return [insText(esc(c.k)), money(c.cur), money(c.prev),
(c.d >= 0 ? '+' : '−') + money(Math.abs(c.d))];
}).concat([[ '合计', money(curTotal), money(prevTotal),
(diff >= 0 ? '+' : '−') + money(Math.abs(diff)) ]])),
empty: !hasPrev
});
/* 4 · 自动支出占比 */
var autoSum = spendTotal(curAuto);
var fr = fixedRules();
var fActive = fr.filter(function(r){ return r.current.enabled; });
var fDaily = fActive.filter(function(r){ return !r.current.monthlyDay; })
.reduce(function(s,r){ return s + r.current.amount; }, 0);
var fMonthly = fActive.filter(function(r){ return r.current.monthlyDay; });
var cfg = !fr.length ? '未设置固定支出规则'
: '共 ' + fr.length + ' 条规则（' + fActive.length + ' 条启用）· 每日合计 ' + money(fDaily) +
(fMonthly.length ? ' · 另有 ' + fMonthly.length + ' 条按月扣款' : '');
out.push({
lab:'自动支出占比',
val: none ? insNA() : insPct(curTotal > 0 ? autoSum/curTotal*100 : 0),
foot: none ? '本月至今' : '自动 ' + money(autoSum) + ' / 共 ' + money(curTotal),
title:'自动支出占比',
body: none ? insEmpty('本月至今还没有支出记录') :
insHead('', '自动支出由「固定支出规则」按日历派生（每天 / 工作日 / 每月固定日），不写入流水表；它会主导笔数与频次，所以笔均类指标只看手动记录。') +
insTable([{t:'来源'},{t:'金额',num:true},{t:'笔数',num:true},{t:'占比',num:true}], [
['规则自动', money(autoSum), insCount(curAuto.length), insPct(curTotal>0 ? autoSum/curTotal*100 : 0)],
['手动记录', money(spendTotal(curMan)), insCount(curMan.length),
insPct(curTotal>0 ? spendTotal(curMan)/curTotal*100 : 0)],
['合计', money(curTotal), insCount(cur.length), insPct(100)]
]) + '<div class="note">' + cfg + '</div>',
empty: none
});
/* 5 · 笔均支出（仅手动） */
var avg = curMan.length ? spendTotal(curMan)/curMan.length : 0;
var med = insMedian(curMan);
var buckets = [[0,50,'50 元以下'],[50,100,'50~100 元'],[100,300,'100~300 元'],[300,Infinity,'300 元以上']];
out.push({
lab:'笔均支出 · 仅手动',
val: !curMan.length ? insNA() : money(avg),
foot: insCount(curMan.length) + ' · 不含规则生成',
title:'笔均支出 · 仅手动',
body: !curMan.length ? insEmpty('本月至今还没有手动支出记录') :
insHead('', '中位数比均值更抗偶发大额；两者差距大说明有少数特别大的一笔。') +
insTable([{t:'统计量'},{t:'数值',num:true}], [
['手动支出总额', money(spendTotal(curMan))],
['笔均', money(avg)],
['中位数', money(med)],
['最大单笔', money(Math.max.apply(null, curMan.map(function(t){ return t.amount; })))]
]) + insTable([{t:'金额区间'},{t:'笔数',num:true}],
buckets.map(function(b){
return [insText(b[2]), insCount(curMan.filter(function(t){
return t.amount >= b[0] && t.amount < b[1]; }).length)];
})),
empty: !curMan.length
});
/* 6 · 近 30 天支出（滚动） */
var byDay = {};
d30.forEach(function(t){ byDay[t.date] = (byDay[t.date] || 0) + t.amount; });
var dayKeys = Object.keys(byDay).sort().reverse();
out.push({
lab:'近 30 天支出',
val: d30.length ? moneyShort(spendTotal(d30)) : insNA(),
foot: d30From.slice(5) + ' ~ ' + t0.slice(5) + ' · ' + insCount(d30.length),
title:'近 30 天支出 · 滚动窗口',
body: insHead('', '不含自然月边界，避免月初/月末对比失真；含规则自动支出。') +
insTable([{t:'日期'},{t:'笔数',num:true},{t:'当日合计',num:true}],
dayKeys.map(function(d){
return [insText(d.slice(5)),
insCount(d30.filter(function(t){ return t.date === d; }).length),
money(byDay[d])];
})),
empty: !d30.length
});
/* 7 · 手动支出笔数 */
var manByCat = {};
curMan.forEach(function(t){
var k = t.category || '其他';
manByCat[k] = (manByCat[k] || 0) + 1;
});
out.push({
lab:'手动支出笔数',
val: curMan.length ? insCount(curMan.length) : insNA(),
foot: '本月至今 · 不含规则生成',
title:'手动支出笔数',
body: insHead('', '只数手动记录；规则自动支出按日历每天一笔，计入笔数会让它失去意义。') +
insTable([{t:'分类'},{t:'笔数',num:true},{t:'金额',num:true}],
Object.keys(manByCat).sort(function(a,b){ return manByCat[b]-manByCat[a]; }).map(function(k){
return [insText(esc(k)), insCount(manByCat[k]),
money(spendTotal(curMan.filter(function(t){ return (t.category||'其他') === k; })))];
})),
empty: !curMan.length
});
/* 8 · 最大单笔支出 */
var sorted = cur.slice().sort(function(a,b){ return b.amount - a.amount; });
var mx = sorted[0];
out.push({
lab:'最大单笔支出',
val: !mx ? insNA() : money(mx.amount),
foot: !mx ? '本月至今' : insText(esc(mx.category || '其他') + ' · ' + mx.date.slice(5)),
title:'最大单笔支出',
body: !mx ? insEmpty('本月至今还没有支出记录') :
insHead('', '偶发大额不等于异常；这里只按金额排序，不做统计离群判定。') +
insTable([{t:'项目'},{t:'数值',num:true}], [
['日期', insText(mx.date)],
['分类', insText(esc(mx.category || '其他'))],
['账户', insText(esc((accountById(mx.accountId) || {}).name || '—'))],
['备注', insText(esc(mx.note || '—'))],
['相对笔均', avg > 0 ? insText((Math.round(mx.amount/avg*10)/10).toFixed(1) + ' 倍') : insNA()]
]) + insTable([{t:'日期'},{t:'分类'},{t:'金额',num:true}],
sorted.slice(0,5).map(function(t){
return [insText(t.date.slice(5)), insText(esc(t.category||'其他')), money(t.amount)];
})),
empty: !mx
});
/* 9 · 涨得最快的分类（环比） */
var fast = hasPrev ? cmp.filter(function(c){ return c.d > 0; })[0] : null;
out.push({
lab:'涨得最快的分类',
val: !fast ? insNA() : insText(esc(fast.k)),
foot: !fast ? '需上月同期数据'
: '+' + money(fast.d) + (fast.prev > 0 ? ' · ' + insRate(fast.d/fast.prev*100) : ''),
title:'涨得最快的分类 · 环比',
body: !hasPrev ? insEmpty('上月同期没有支出记录，暂时无法对比') :
insHead('', '按金额差额排序（不是百分比），避免小额基数放大成失真的高增幅；上期金额很小的分类会标注「基数小」。') +
insTable([{t:'分类'},{t:'本期',num:true},{t:'上期',num:true},{t:'差额',num:true},{t:'增幅',num:true}],
cmp.map(function(c){
var r = c.prev > 0 ? c.d/c.prev*100 : null;
return [insText(esc(c.k)) + (c.prev > 0 && c.prev < 50 ? ' <small>基数小</small>' : ''),
money(c.cur), money(c.prev), (c.d>=0?'+':'−') + money(Math.abs(c.d)),
r === null ? '—' : insRate(r)];
})),
empty: !hasPrev
});
/* 10 · 工作日 / 周末日均（仅手动） */
var wd = 0, we = 0, p = curFrom;
while (p <= curTo){
if (isWeekend(p)) we++; else wd++;
p = shiftDate(p, 1);
}
var manWE = curMan.filter(function(t){ return isWeekend(t.date); });
var manWD = curMan.filter(function(t){ return !isWeekend(t.date); });
var avgWE = we > 0 ? spendTotal(manWE)/we : 0;
var avgWD = wd > 0 ? spendTotal(manWD)/wd : 0;
var mult = avgWD > 0 ? avgWE/avgWD : null;
var weekNames = ['周日','周一','周二','周三','周四','周五','周六'];
var wdist = [];
for (var wi = 0; wi < 7; wi++){
var hit = curMan.filter(function(t){
return new Date(t.date + 'T00:00:00').getDay() === wi;
});
wdist.push([insText(weekNames[wi]), insCount(hit.length), money(spendTotal(hit))]);
}
out.push({
lab:'周末 / 工作日日均',
val: (!curMan.length || mult === null) ? insNA()
: insText((Math.round(mult*10)/10).toFixed(1) + ' 倍'),
foot: '周末 ' + money(avgWE) + ' / 工作日 ' + money(avgWD),
title:'周末 / 工作日日均 · 仅手动',
body: (!curMan.length || wd === 0 || we === 0) ? insEmpty('本月至今的工作日或周末还没有完整样本') :
insHead('', '日均按本月至今实际的工作日/周末天数计算；只统计手动记录，避免规则自动支出按日历生成造成系统性偏差。') +
insTable([{t:'类型'},{t:'天数',num:true},{t:'笔数',num:true},{t:'总额',num:true},{t:'日均',num:true}], [
['工作日', insText(wd + ' 天'), insCount(manWD.length), money(spendTotal(manWD)), money(avgWD)],
['周末', insText(we + ' 天'), insCount(manWE.length), money(spendTotal(manWE)), money(avgWE)]
]) + insTable([{t:'星期'},{t:'笔数',num:true},{t:'金额',num:true}], wdist),
empty: !curMan.length
});
return out;
}
var INSIGHT_CACHE = [];
/* 按语义分组；用指标名匹配，避免依赖 buildInsights() 的 push 顺序 */
var INSIGHT_GROUPS = [
{name:'本月总览', labs:['最大花销分类','前三分类集中度','本月至今 vs 上月同期','自动支出占比']},
{name:'笔数与笔均', labs:['笔均支出 · 仅手动','手动支出笔数','最大单笔支出']},
{name:'趋势与结构', labs:['近 30 天支出','涨得最快的分类','周末 / 工作日日均']}
];
var INSIGHT_TEXT_LABS = ['最大花销分类','涨得最快的分类'];
function insightIndex(items, lab){
for (var i = 0; i < items.length; i++){ if (items[i].lab === lab) return i; }
return -1;
}
function insightButton(it, i){
var textual = !it.empty && INSIGHT_TEXT_LABS.indexOf(it.lab) >= 0;
return '<button type="button" class="insight-item' +
(it.empty ? ' empty-val' : '') + (textual ? ' is-text' : '') +
'" onclick="openInsight(' + i + ')">' +
'<span class="lab">' + it.lab + '</span>' +
'<span class="val">' + it.val + '</span>' +
'<span class="foot">' + it.foot + '</span></button>';
}
function renderInsights(){
var box = document.getElementById('insight-grid');
if (!box) return;
var items = buildInsights();
INSIGHT_CACHE = items;
function buttons(labels){
return labels.map(function(lab){
var i = insightIndex(items, lab);
return i < 0 ? '' : insightButton(items[i], i);
}).join('');
}
var hero = INSIGHT_GROUPS[0];
var html = '<div class="insight-hero" id="insight-hero">' + buttons(hero.labs) + '</div>' +
'<div class="insight-dots" id="insight-dots">' +
hero.labs.map(function(_, n){ return '<i' + (n ? '' : ' class="on"') + '></i>'; }).join('') +
'</div>';
INSIGHT_GROUPS.slice(1).forEach(function(g){
html += '<details class="insight-group"><summary>' + g.name +
'<span style="margin-left:auto;font-size:var(--fs-micro)">' + g.labs.length + ' 项</span></summary>' +
'<div class="insight-more">' + buttons(g.labs) + '</div></details>';
});
box.innerHTML = html;
var scope = document.getElementById('insight-scope');
if (scope) scope.textContent = '本月至今 · 含自动支出 · 截至今天';
bindInsightDots();
}
function bindInsightDots(){
var hero = document.getElementById('insight-hero');
var dots = document.getElementById('insight-dots');
if (!hero || !dots || !hero.firstElementChild) return;
hero.addEventListener('scroll', function(){
var step = hero.firstElementChild.offsetWidth + 8;
var n = Math.round(hero.scrollLeft / Math.max(1, step));
Array.prototype.forEach.call(dots.children, function(d, i){
d.className = (i === n) ? 'on' : '';
});
}, {passive:true});
}
function openInsight(i){
var it = INSIGHT_CACHE[i];
if (!it) return;
openModal(it.lab, it.body, function(){ return true; }, '关闭', true);
}
function renderOverview(){
ROLL_SLOTS.length = 0;
renderDca();
renderBackupBar();
var bal = currentBalances();
var n = netOf(bal);
var m = monthStats(thisMonth());
var series = buildSeries();
var prev = series.length >= 2 ? series[series.length-2].net : n.net;
var delta = n.net - prev;
var deltaText = series.length >= 2
? (privacyOn ? '较上次记录 ' + PRIVACY_MASK
: '较上次记录 ' + (delta >= 0 ? '+' : '−') +
rollSpan(Math.abs(delta), num(Math.abs(delta)), rollFmtNum))
: '资产 − 负债';
var dailySum = sumRole('daily'), wealthSum = sumRole('wealth'), holdSum = sumRole('hold');
var dailyN = accountsByRole('daily').length,
wealthN = accountsByRole('wealth').length, holdN = accountsByRole('hold').length;
document.getElementById('ov-metrics').innerHTML =
metricCard('净资产', moneyShort(n.net), deltaText, null, rollIndex(n.net)) +
metricCard('日常可用', moneyShort(dailySum), dailyN + ' 个 · 两类独立核算', null, rollIndex(dailySum)) +
metricCard('银行理财', moneyShort(wealthSum), wealthN + ' 个 · 挂卡不计入可用余额', null, rollIndex(wealthSum)) +
metricCard('长期持有', moneyShort(holdSum), holdN + ' 个 · 不参与日常消费', null, rollIndex(holdSum)) +
metricCard('本月结余', moneyShort(m.balance),
'收入 ' + rollSpan(m.income, moneyShort(m.income)) + ' · 支出 ' + rollSpan(m.expense, moneyShort(m.expense)),
null, rollIndex(m.balance));
var help = document.getElementById('ov-help');
if (!db.accounts.length){
help.style.display = '';
help.textContent = '还没有账户。先「添加账户」，填一次当前余额作为建账起点，之后所有变动都通过记账自动累计，不用再手动更新。';
} else if (!accountsByRole('daily').length){
help.style.display = '';
help.textContent = '还没有「日常可用」账户。建议分别添加「活期」和「银行卡」，各自填当前余额——两者分开核算，记账会默认从这里扣钱。银行理财请单独选「银行理财」，不会混入可用余额。';
} else {
help.style.display = 'none';
}
/* 资产构成 */
var byType = {};
db.accounts.forEach(function(a){
if (a.type === 'liability') return;
var v = bal[a.id] || 0;
if (v > 0) byType[a.type] = (byType[a.type] || 0) + v;
});
var keys = Object.keys(byType);
if (keys.length){
draw('c-ov-comp', {
type: 'doughnut',
data: {
labels: keys.map(function(k){ return TYPE_META[k].label; }),
datasets: [{
data: keys.map(function(k){ return Math.round(byType[k]*100)/100; }),
backgroundColor: keys.map(function(k){ return TYPE_META[k].color; }),
borderWidth: 0
}]
},
options: {responsive:true, maintainAspectRatio:false, cutout:'62%',
plugins:{legend:{position:'right', labels:{boxWidth:10, boxHeight:10, font:{size:11},
color:'rgba(60,60,67,.7)', padding:10}},
tooltip:{callbacks:{label:function(c){ return c.label + '：' + money(c.parsed); }}}}}
});
} else {
draw('c-ov-comp', {type:'doughnut', data:{labels:['暂无数据'], datasets:[{data:[1], backgroundColor:['#e5e7eb'], borderWidth:0}]},
options:{responsive:true, maintainAspectRatio:false, cutout:'62%', plugins:{legend:{display:false}, tooltip:{enabled:false}}}});
}
/* 净资产趋势 */
var pts = series.slice(-24);
if (pts.length >= 2){
draw('c-ov-net', {
type: 'line',
data: {
labels: pts.map(function(p){ return p.date.slice(5); }),
datasets: [{
label: '净资产', data: pts.map(function(p){ return p.net; }),
borderColor: '#0071e3', backgroundColor: 'rgba(0,113,227,.08)',
fill: true, tension: .3, pointRadius: 2, pointHoverRadius: 4, borderWidth: 2
}]
},
options: baseOpts({plugins:{legend:{display:false}}})
});
} else {
draw('c-ov-net', {type:'line', data:{labels:[], datasets:[]},
options: Object.assign(baseOpts(), {scales:{x:{display:false}, y:{display:false}},
plugins:{legend:{display:false}, tooltip:{enabled:false},
title:{display:true, text:'记账满两天后这里会出现趋势线',
color:'rgba(60,60,67,.45)', font:{size:12, weight:'400'}}}})});
}
/* 账户表：按 4 类角色分组；银行理财额外显示归属账户并按归属汇总 */
function acctRow(a){
var b = bal[a.id] || 0;
var meta = TYPE_META[a.type];
var role = roleOf(a);
var cls = role === 'debt' ? 'tag-liab'
: role === 'wealth' ? 'tag-wealth'
: a.type === 'bank' ? 'tag-bank'
: role === 'hold' ? 'tag-invest' : 'tag-cash';
return '<tr>' +
'<td><strong>' + esc(a.name) + '</strong> ' +
'<button class="btn btn-sm" style="padding:1px 8px;font-size:11px" data-act="acct-edit" data-id="' + esc(a.id) + '">编辑</button>' +
(a.note ? '<br><span class="muted" style="font-size:11px">' + esc(a.note) + '</span>' : '') + '</td>' +
'<td><span class="tag ' + cls + '">' + meta.label + '</span></td>' +
'<td class="num" style="font-variant-numeric:tabular-nums' + (b < -0.005 && !privacyOn ? ';color:var(--red)' : '') + '">' + money(b) + '</td>' +
'<td style="text-align:right;white-space:nowrap">' +
'<button class="btn btn-sm" data-act="acct-revalue" data-id="' + esc(a.id) + '">更新余额</button> ' +
'<button class="btn btn-sm" data-act="acct-transfer" data-id="' + esc(a.id) + '">转账</button> ' +
'<button class="btn btn-sm btn-danger" data-act="acct-delete" data-id="' + esc(a.id) + '">删除</button>' +
'</td></tr>';
}
var body = '';
ROLE_ORDER.forEach(function(role){
var list = accountsByRole(role);
if (!list.length) return;
body += list.map(acctRow).join('');
});
document.getElementById('ov-accounts').innerHTML = db.accounts.length
? '<table><thead><tr><th>账户</th><th>类型</th><th class="num">当前余额</th><th style="text-align:right">操作</th></tr></thead><tbody>' + body + '</tbody></table>'
: '<div class="empty">还没有账户，点击右上角「添加账户」开始</div>';
}
function metricCard(lab, val, foot, cls, ri){
return '<div class="metric"><div class="lab">' + lab + '</div>' +
'<div class="val' + (cls ? ' ' + cls : '') + '"' +
(ri == null ? '' : ' data-ri="' + ri + '"') + '>' + val + '</div>' +
'<div class="foot">' + foot + '</div></div>';
}
;
/* ================= 渲染：记账 ================= */
function fillCatSelect(){
var cats = txType === 'income' ? IN_CATS : EX_CATS;
var sel = document.getElementById('tx-cat');
var cur = sel.value;
sel.innerHTML = cats.map(function(c){ return '<option value="' + c + '">' + c + '</option>'; }).join('');
if (cats.indexOf(cur) >= 0) sel.value = cur;
}
/* 账户下拉：按角色分组显示。allow 指定本次允许出现的角色 */
function acctOptionsHtml(allow){
var html = '';
ROLE_ORDER.forEach(function(role){
if (allow.indexOf(role) < 0) return;
var list = accountsByRole(role);
if (!list.length) return;
html += '<optgroup label="' + ROLE_META[role].label + '">';
list.forEach(function(a){
html += '<option value="' + a.id + '">' + esc(a.name) + '</option>';
});
html += '</optgroup>';
});
return html;
}
function fillAccountSelects(){
var acctEl = document.getElementById('tx-acct');
var toEl = document.getElementById('tx-to');
var isTransfer = (txType === 'transfer');
/* 支出/收入排除 inLedger:false 的角色；转账全部角色可用 */
var allow = isTransfer ? ROLE_ORDER : NON_TRANSFER_ROLES;
var prev = acctEl.value;
acctEl.innerHTML = acctOptionsHtml(allow) || '<option value="">（先添加账户）</option>';
toEl.innerHTML = acctOptionsHtml(ROLE_ORDER) || '<option value="">（先添加账户）</option>';
/* 默认账户：优先保留当前选择，其次沿用上次用的，最后取第一个「日常可用」账户 */
var keep = '';
if (prev && accountById(prev) && allow.indexOf(roleOf(accountById(prev))) >= 0) keep = prev;
else if (lastAccountId && accountById(lastAccountId) && allow.indexOf(roleOf(accountById(lastAccountId))) >= 0) keep = lastAccountId;
if (keep) acctEl.value = keep;
if (!acctEl.value){
var d = accountsByRole('daily')[0] || db.accounts[0];
if (d) acctEl.value = d.id;
}
/* 转账：转入账户不能与转出相同 */
if (isTransfer){
for (var i=0;i<toEl.options.length;i++){
if (toEl.options[i].value !== acctEl.value){ toEl.value = toEl.options[i].value; break; }
}
}
updateTxHint();
}
/* 实时预览：这笔记完，账户余额变成多少 */
function updateTxHint(){
var el = document.getElementById('tx-hint');
if (!el) return;
var acc = accountById(document.getElementById('tx-acct').value);
if (!acc){ el.innerHTML = ''; return; }
var amt = +document.getElementById('tx-amount').value || 0;
var bal = currentBalances()[acc.id] || 0;
function delta(v){
var cls = (v < 0 && !privacyOn) ? ' class="warn"' : '';
return '<b' + cls + '>' + money(v) + '</b>';
}
if (txType === 'transfer'){
var toAcc = accountById(document.getElementById('tx-to').value);
if (!toAcc){ el.innerHTML = '转出账户：' + esc(acc.name) + ' 当前 ' + money(bal); return; }
var toBal = currentBalances()[toAcc.id] || 0;
el.innerHTML = esc(acc.name) + ' ' + money(bal) + ' → ' + delta(bal - amt) +
' · ' + esc(toAcc.name) + ' ' + money(toBal) + ' → ' + delta(toBal + amt);
return;
}
var after = (txType === 'income') ? bal + amt : bal - amt;
el.innerHTML = esc(acc.name) + ' 当前 ' + money(bal) +
(amt > 0 ? ' · 记完变为 ' + delta(after) : (roleOf(acc) === 'hold' ? ' · 长期持有账户，日常开支建议走活期' : ''));
}
function setTxType(t){
txType = t;
Array.prototype.forEach.call(document.querySelectorAll('#tx-kind button'), function(b){
b.classList.toggle('on', b.dataset.type === t);
});
document.getElementById('f-cat').style.display = (t === 'transfer') ? 'none' : '';
document.getElementById('f-to').style.display = (t === 'transfer') ? '' : 'none';
document.getElementById('lbl-from').textContent = (t === 'transfer') ? '转出账户' : '账户';
document.getElementById('tx-submit').textContent = (t === 'transfer') ? '转账' : '添加';
if (t !== 'transfer') fillCatSelect();
fillAccountSelects();
}
/* 明细分批渲染 + 筛选：一次最多上 LED_PAGE 条 DOM，点「显示更多」再追加一批。
筛选是纯前端过滤（数据本来就在内存里），不改后端接口。
切页签、记一笔不会把已展开的页数收回去；只有改筛选条件才回到第一批。 */
var LED_PAGE = 50, ledShown = LED_PAGE, ledMonth = '';
function ledMore(){
ledShown += LED_PAGE;
renderLedList();
}
function renderLedger(){
ROLL_SLOTS.length = 0;
renderFixed();
var month = document.getElementById('led-month').value || thisMonth();
if (ledMonth !== month){ ledMonth = month; ledShown = LED_PAGE; }
var m = monthStats(month);
document.getElementById('led-metrics').innerHTML =
metricCard('本月支出', moneyShort(m.expense), m.count + ' 笔记录', null, rollIndex(m.expense)) +
metricCard('本月收入', moneyShort(m.income), '工资、奖金等', null, rollIndex(m.income)) +
metricCard('本月结余', moneyShort(m.balance), privacyOn ? '—' : (m.balance >= 0 ? '有结余' : '超支'),
privacyOn ? '' : (m.balance >= 0 ? 'green' : 'red'), rollIndex(m.balance)) +
metricCard('日均支出', moneyShort(m.expense / 30), '按 30 天估算', null, rollIndex(m.expense / 30));
/* 支出构成 */
var cats = Object.keys(m.byCat).sort(function(x,y){ return m.byCat[y] - m.byCat[x]; });
if (cats.length){
draw('c-led-cat', {
type: 'doughnut',
data: {
labels: cats,
datasets: [{
data: cats.map(function(c){ return Math.round(m.byCat[c]*100)/100; }),
backgroundColor: cats.map(function(c){ return CAT_COLORS[EX_CATS.indexOf(c)] || '#8e8e93'; }),
borderWidth: 0
}]
},
options: {responsive:true, maintainAspectRatio:false, cutout:'62%',
plugins:{legend:{position:'right', labels:{boxWidth:10, boxHeight:10, font:{size:11},
color:'rgba(60,60,67,.7)', padding:10}},
tooltip:{callbacks:{label:function(c){ return c.label + '：' + money(c.parsed); }}}}}
});
} else {
draw('c-led-cat', {type:'doughnut', data:{labels:['暂无支出'], datasets:[{data:[1], backgroundColor:['#e5e7eb'], borderWidth:0}]},
options:{responsive:true, maintainAspectRatio:false, cutout:'62%', plugins:{legend:{display:false}, tooltip:{enabled:false}}}});
}
/* 近 6 个月收支 */
var months = lastMonths(6);
var incs = months.map(function(mm){ return monthStats(mm).income; });
var exps = months.map(function(mm){ return monthStats(mm).expense; });
draw('c-led-month', {
type: 'bar',
data: {
labels: months.map(function(mm){ return mm.slice(5) + '月'; }),
datasets: [
{label:'支出', data: exps, backgroundColor:'#ff3b30', maxBarThickness:18, borderRadius:4},
{label:'收入', data: incs, backgroundColor:'#34c759', maxBarThickness:18, borderRadius:4}
]
},
options: baseOpts({plugins:{legend:{display:true, position:'top', align:'end',
labels:{boxWidth:8, boxHeight:8, font:{size:11}, color:'rgba(60,60,67,.7)'}}}})
});
/* 明细：先把筛选栏的下拉补齐，再渲染列表 */
ledFillFilterSelects();
renderLedList();
}
/* ================= 明细筛选（纯前端） ================= */
function ledEl(id){ return document.getElementById(id); }
/* 英文缩写：给日期分组头用，手工解析避免 new Date('YYYY-MM-DD') 按 UTC 算错一天 */
function ledWeekday(iso){
var p = String(iso || '').split('-');
var d = new Date(+p[0], +p[1] - 1, +p[2]);
return isNaN(d.getTime()) ? '' : '周' + '日一二三四五六'.charAt(d.getDay());
}
/* 这批结果是否跨了年份：跨了才在分组头显示 YYYY-MM-DD */
function ledSpansYears(rows){
var y = '';
for (var i = 0; i < rows.length; i++){
var yy = String(rows[i].date || '').slice(0, 4);
if (!yy) continue;
if (!y) y = yy;
else if (yy !== y) return true;
}
return false;
}
/* 类别下拉：支出 + 收入分类去重，末尾追加「转账」（转账没有分类） */
function ledFillFilterSelects(){
var cat = ledEl('led-cat'), acct = ledEl('led-acct');
if (cat){
var keep = cat.value;
var cats = [];
EX_CATS.concat(IN_CATS).forEach(function(c){ if (cats.indexOf(c) < 0) cats.push(c); });
cat.innerHTML = '<option value="">全部类别</option>' +
cats.map(function(c){ return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('') +
'<option value="__transfer">转账</option>';
cat.value = keep;
if (!cat.value) cat.value = '';
}
if (acct){
var keepA = acct.value;
acct.innerHTML = '<option value="">全部账户</option>' +
db.accounts.map(function(a){
return '<option value="' + esc(a.id) + '">' + esc(a.name) + '</option>';
}).join('');
acct.value = keepA;
if (!acct.value) acct.value = '';
}
}
function ledReadFilters(){
function num(id){
var el = ledEl(id);
if (!el) return null;
var raw = String(el.value == null ? '' : el.value).trim();
if (raw === '') return null;
var v = +raw;
return isNaN(v) ? null : v;
}
var q = ledEl('led-q'), cat = ledEl('led-cat'), acct = ledEl('led-acct'), scope = ledEl('led-scope');
return {
q: q ? String(q.value || '').trim().toLowerCase() : '',
cat: cat ? cat.value : '',
acct: acct ? acct.value : '',
min: num('led-min'), max: num('led-max'),
scope: scope ? (scope.value || 'month') : 'month'
};
}
function ledHasFilter(f){
return !!(f.q || f.cat || f.acct || f.min != null || f.max != null || f.scope === 'all');
}
function ledMatch(t, f, month){
if (f.scope !== 'all' && monthKey(t.date) !== month) return false;
if (f.cat === '__transfer'){
if (t.type !== 'transfer') return false;
} else if (f.cat && (t.type === 'transfer' || t.category !== f.cat)){
return false;
}
if (f.acct && t.accountId !== f.acct && t.toAccountId !== f.acct) return false;
if (f.min != null && t.amount < f.min) return false;
if (f.max != null && t.amount > f.max) return false;
if (f.q){
var from = accountById(t.accountId), to = accountById(t.toAccountId);
var hay = [t.note, t.category, from ? from.name : '', to ? to.name : '',
t.type === 'transfer' ? '转账' : '',
t.autoKind === AUTO_KIND.DCA ? '定投' : '', t.auto ? '自动' : '',
String(t.amount)].join(' ').toLowerCase();
if (hay.indexOf(f.q) < 0) return false;
}
return true;
}
/* 单行 HTML。日期已由分组头给，行里不再重复一列日期，正文能多显示几个字 */
function ledRowHtml(t){
var sign, catLabel;
if (t.type === 'expense'){ sign = '−'; catLabel = t.category; }
else if (t.type === 'income'){ sign = '+'; catLabel = t.category; }
else if (t.type === 'transfer'){
sign = '';
var from = accountById(t.accountId), to = accountById(t.toAccountId);
/* 自动定投标「定投」，手动转账标「转账」，一眼能分开 */
catLabel = (t.autoKind === AUTO_KIND.DCA ? '定投 ' : '转账 ') +
(from ? from.name : '?') + ' → ' + (to ? to.name : '?');
} else {
sign = ''; catLabel = '余额调整';
}
var acc = accountById(t.accountId);
/* 定投的备注固定是「每日定投」，标签已经写了，避免一行里重复两遍 */
var showNote = t.note && !(t.autoKind === AUTO_KIND.DCA && t.note === '每日定投');
var plain = catLabel + (acc && t.type !== 'transfer' ? ' · ' + acc.name : '') +
(showNote ? ' · ' + t.note : '');
return '<div class="list-item' + (t.auto ? '' : ' is-editable') + '"' +
(t.auto ? '' : ' role="button" tabindex="0" data-act="tx-edit" data-id="' + esc(t.id) + '"') + '>' +
'<span class="grow"><span title="' + esc(plain) + '">' + esc(plain) + '</span></span>' +
'<span class="amt ' + (t.type === 'expense' ? 'neg' : (t.type === 'income' ? 'pos' : 'muted')) + '">' +
(t.type === 'transfer' ? money(t.amount) : sign + num(t.amount)) + '</span>' +
(t.auto
? '<button class="btn btn-sm" data-act="auto-delete" data-id="' + esc(t.ruleId || '') +
'" data-date="' + esc(t.date) + '">删</button>'
: '<button class="btn btn-sm" data-act="tx-delete" data-id="' + esc(t.id) + '">删</button>') +
'</div>';
}
/* 列表独立渲染：改筛选条件时只重画列表，不重建指标卡和两张图表 */
function renderLedList(){
var monthEl = ledEl('led-month');
var month = (monthEl && monthEl.value) || thisMonth();
var f = ledReadFilters();
var rows = db.transactions.concat(db.autoTx)
.filter(function(t){ return ledMatch(t, f, month); })
.sort(function(x, y){ return x.date < y.date ? 1 : (x.date > y.date ? -1 : 0); });
/* 当天合计：只算收入/支出；转账是账户间挪钱，不进合计 */
var daySum = {};
rows.forEach(function(t){
var d = daySum[t.date] || (daySum[t.date] = {expense: 0, income: 0});
if (t.type === 'expense') d.expense += t.amount;
else if (t.type === 'income') d.income += t.amount;
});
var shown = rows.slice(0, ledShown);
/* 结果跨年时才给日期补上年份：两年前的 11-10 和今年的不能长得一样；
单月/单年视图继续用短格式，不给眼睛加噪音。 */
var withYear = ledSpansYears(rows);
var html = '', lastDate = '';
shown.forEach(function(t){
if (t.date !== lastDate){
lastDate = t.date;
var s = daySum[t.date] || {expense: 0, income: 0};
var parts = [];
if (s.expense) parts.push('支出 −' + money(s.expense));
if (s.income) parts.push('收入 +' + money(s.income));
var dayLabel = withYear ? String(t.date) : String(t.date).slice(5);
html += '<div class="led-day"><span>' + esc(dayLabel) + ' ' +
ledWeekday(t.date) + '</span><span>' + parts.join(' · ') + '</span></div>';
}
html += ledRowHtml(t);
});
var box = ledEl('led-list');
if (box){
box.innerHTML = (shown.length ? html
: '<div class="empty">' + (ledHasFilter(f)
? '没有符合条件的记录，放宽条件或点「清空筛选」试试。'
: '这个月还没有记录') + '</div>') +
(rows.length > ledShown
? '<div class="led-more"><button class="btn" data-act="led-more">显示更多（还有 ' +
(rows.length - ledShown) + ' 条）</button></div>'
: '');
}
/* 命中摘要：让人明确知道现在看到的是筛选后的结果、还是全部 */
var hit = ledEl('led-hit');
if (hit){
var exp = 0, inc = 0, tr = 0;
rows.forEach(function(t){
if (t.type === 'expense') exp += t.amount;
else if (t.type === 'income') inc += t.amount;
else if (t.type === 'transfer') tr++;
});
var scopeTxt = f.scope === 'all' ? '全部时间' : month;
var line = scopeTxt + ' · ' + (ledHasFilter(f) ? '命中 ' : '共 ') + rows.length + ' 笔';
if (exp) line += ' · 支出 ' + money(exp);
if (inc) line += ' · 收入 ' + money(inc);
if (tr) line += ' · 转账 ' + tr + ' 笔';
hit.textContent = line;
}
var lab = ledEl('led-month-label');
if (lab) lab.textContent = f.scope === 'all' ? '全部时间' : month;
}
/* 筛选条件变化：重置到第一批并重画列表。
关键词一旦有值就自动切「全部时间」——不然「我记得是夏天那会儿」根本搜不到。 */
function ledOnFilter(ev){
var scope = ledEl('led-scope'), q = ledEl('led-q');
if (ev && ev.target && ev.target.id === 'led-q' && scope && q &&
String(q.value || '').trim() && scope.value !== 'all'){
scope.value = 'all';
}
ledShown = LED_PAGE;
renderLedList();
}
function ledClearFilters(){
['led-q', 'led-min', 'led-max', 'led-cat', 'led-acct'].forEach(function(id){
var el = ledEl(id);
if (el) el.value = '';
});
var scope = ledEl('led-scope');
if (scope) scope.value = 'month';
ledShown = LED_PAGE;
renderLedList();
}
;
/* ============ 自定义周期花销：发薪日不固定，按任意起止区间统计 ============ */
var CP_DAY_KEY = 'jizhang.cp.day';
var cpDayMem = 1;
var CP_LAST = null;
/* 当前区间的锚点日。短月会把 31 号压到 30/28 号，若每次都拿「当前输入的日」翻月，
1/31 → 2/28 → 3/28 会越翻越偏；记住锚点日后翻回长月能回到 31 号。 */
var CP_ANCHOR = 0;
function cpGetDay(){
try {
var v = +(localStorage.getItem(CP_DAY_KEY) || 0);
if (v >= 1 && v <= 31) return v;
} catch(e){}
return cpDayMem;
}
function cpSetDay(v){
cpDayMem = v;
try { localStorage.setItem(CP_DAY_KEY, String(v)); } catch(e){}
}
/* 短月没有 31 号时自动落到当月最后一天，避免跨月区间算错 */
function cpAnchor(y, m, day){
while (m < 0){ m += 12; y -= 1; }
while (m > 11){ m -= 12; y += 1; }
return new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
}
function cpISO(d){
return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') +
'-' + String(d.getDate()).padStart(2,'0');
}
/* 初始化定位到含今天的「发薪日 → 下月发薪日」；页面上的上期/下期走 cpShift 相对平移 */
function cpCycle(day, offset){
var d = new Date();
var k = (d.getDate() >= day ? 0 : -1) + (offset || 0);
return {
from: cpISO(cpAnchor(d.getFullYear(), d.getMonth() + k, day)),
to:   cpISO(cpAnchor(d.getFullYear(), d.getMonth() + k + 1, day))
};
}
function cpPreset(offset){
CP_ANCHOR = cpGetDay();
var c = cpCycle(CP_ANCHOR, offset);
document.getElementById('cp-from').value = c.from;
document.getElementById('cp-to').value = c.to;
cpRender();
}
/* 相对当前显示的区间前后平移一个周期；按月份移动，保证「12 号」边界不随天数漂移 */
function cpShift(delta){
var fi = document.getElementById('cp-from'), ti = document.getElementById('cp-to');
if (!fi || !ti || !fi.value || !ti.value) return;
var f = new Date(fi.value + 'T00:00:00'), t = new Date(ti.value + 'T00:00:00');
if (isNaN(f.getTime()) || isNaN(t.getTime())) return;
var day = CP_ANCHOR || f.getDate();
fi.value = cpISO(cpAnchor(f.getFullYear(), f.getMonth() + delta, day));
ti.value = cpISO(cpAnchor(t.getFullYear(), t.getMonth() + delta, day));
CP_ANCHOR = day;
cpRender();
}
function cpStats(from, to){
var end = to > today() ? today() : to;
var inc = 0, exp = 0, expCnt = 0, auto = 0, byCat = {}, list = [];
allTx().forEach(function(t){
if (!t.date || t.date < from || t.date > end) return;
var a = t.amount || 0;
if (t.type === 'income'){
inc += a; list.push(t);
} else if (t.type === 'expense'){
exp += a; expCnt++; list.push(t);
if (t.auto) auto += a;
var k = t.category || '其他';
if (!byCat[k]) byCat[k] = {amount:0, count:0};
byCat[k].amount += a; byCat[k].count++;
}
});
list.sort(function(x,y){ return x.date < y.date ? 1 : (x.date > y.date ? -1 : 0); });
var cats = Object.keys(byCat).map(function(k){
return {cat:k, amount:byCat[k].amount, count:byCat[k].count};
}).sort(function(a,b){ return b.amount - a.amount; });
return {income:inc, expense:exp, count:expCnt, auto:auto, cats:cats, list:list};
}
function cpRender(){
var fi = document.getElementById('cp-from'), ti = document.getElementById('cp-to');
var scope = document.getElementById('cp-scope');
if (!fi || !ti || !scope || !fi.value || !ti.value) return;
var from = fi.value, to = ti.value;
if (from > to){ var tmp = from; from = to; to = tmp; fi.value = from; ti.value = to; }
var span = Math.round((new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00')) / 86400000) + 1;
if (!isFinite(span) || span < 1) span = 1;
var clamped = to > today();
var effEnd = clamped ? today() : to;
var effSpan = Math.round((new Date(effEnd + 'T00:00:00') - new Date(from + 'T00:00:00')) / 86400000) + 1;
if (!isFinite(effSpan) || effSpan < 1) effSpan = 1;
var s = cpStats(from, to);
var p = cpStats(shiftDate(from, -span), shiftDate(from, -1));
var cmp = '上期无数据';
if (p.expense > 0){
var r = (s.expense - p.expense) / p.expense * 100;
cmp = '较上期 ' + (r >= 0 ? '+' : '−') + Math.abs(r).toFixed(1) + '%';
} else if (s.expense > 0) cmp = '上期无支出';
CP_LAST = {from:from, to:to, span:span, effSpan:effSpan, clamped:clamped, stats:s, cmp:cmp};
scope.textContent = from.slice(5) + ' ~ ' + to.slice(5) + ' · ' + span + ' 天' +
(clamped ? ' · 截至今天' : '');
/* 页签隐藏时 Chart.js 拿到 0 宽高，只在可见时画图；切到分析页会再调一次 */
var tab = document.getElementById('tab-analysis');
if (tab && tab.classList.contains('show')) cpDrawChart(s);
}
function cpDrawChart(s){
var box = document.getElementById('cp-chart-box');
var canvas = document.getElementById('cp-chart');
var empty = document.getElementById('cp-empty');
var cats = s.cats;
if (!cats.length){
if (charts['cp-chart']){ charts['cp-chart'].destroy(); delete charts['cp-chart']; }
if (box) box.style.height = '180px';
if (canvas) canvas.style.display = 'none';
if (empty) empty.style.display = 'flex';
return;
}
if (canvas) canvas.style.display = '';
if (empty) empty.style.display = 'none';
if (box) box.style.height = Math.min(420, Math.max(200, cats.length * 34 + 56)) + 'px';
var opts = baseOpts({indexAxis:'y'});
opts.interaction = {mode:'nearest', intersect:true};
opts.plugins.tooltip.callbacks.label = function(c){ return money(c.parsed.x); };
opts.scales.y.ticks.autoSkip = false;
opts.onClick = function(evt, els){
if (els && els.length && cats[els[0].index]) cpOpenDetail(cats[els[0].index].cat);
else cpOpenDetail(null);
};
draw('cp-chart', {
type:'bar',
data:{labels:cats.map(function(c){ return c.cat; }),
datasets:[{label:'支出', data:cats.map(function(c){ return c.amount; }),
backgroundColor:'#ff3b30', borderRadius:4, maxBarThickness:22}]},
options: opts
});
}
/* 点击图表 / 「详细数据」后展开：指标、分类构成、流水明细 */
function cpOpenDetail(cat){
if (!CP_LAST) cpRender();
var L = CP_LAST;
if (!L) return;
var s = L.stats;
var list = s.list.filter(function(t){
return !cat || (t.type === 'expense' && (t.category || '其他') === cat);
});
var html = '<div class="insight-detail">' +
'<div class="note">' + L.from + ' ~ ' + L.to + ' · ' + L.span + ' 天' +
(L.clamped ? ' · 截至今天' : '') + ' · 起止均含当天</div>' +
'<table><thead><tr><th>指标</th><th class="num">金额</th></tr></thead><tbody>' +
'<tr><td>周期支出</td><td class="num">' + moneyShort(s.expense) + '</td></tr>' +
'<tr><td>周期收入</td><td class="num">' + moneyShort(s.income) + '</td></tr>' +
'<tr><td>周期结余</td><td class="num">' + moneyShort(s.income - s.expense) + '</td></tr>' +
'<tr><td>日均支出</td><td class="num">' + moneyShort(s.expense / L.effSpan) + '</td></tr>' +
'<tr><td>支出笔数</td><td class="num">' + s.count + ' 笔 · 自动 ' + money(s.auto) + '</td></tr>' +
'<tr><td>环比</td><td class="num">' + L.cmp + '</td></tr>' +
'</tbody></table>';
if (!cat && s.cats.length){
html += '<div class="note">分类构成</div>' +
'<table><thead><tr><th>分类</th><th class="num">金额</th><th class="num">占比</th><th class="num">笔数</th></tr></thead><tbody>' +
s.cats.map(function(c){
return '<tr><td>' + esc(c.cat) + '</td><td class="num">' + num(c.amount) +
'</td><td class="num">' + (s.expense > 0 ? (c.amount/s.expense*100).toFixed(1) : '0.0') +
'%</td><td class="num">' + c.count + '</td></tr>';
}).join('') + '</tbody></table>';
}
html += '<div class="note">流水明细（' + list.length + ' 笔）</div>';
if (list.length){
html += '<table><thead><tr><th>日期</th><th>分类 · 账户 · 备注</th><th class="num">金额</th></tr></thead><tbody>' +
list.slice(0, 120).map(function(t){
var acc = accountById(t.accountId);
var desc = esc((t.category || (t.type === 'income' ? '收入' : '其他')) +
(acc ? ' · ' + acc.name : '') + (t.note ? ' · ' + t.note : '') +
(t.auto ? ' · 自动' : ''));
return '<tr><td>' + t.date.slice(5) + '</td><td>' + desc + '</td>' +
'<td class="num ' + (t.type === 'expense' ? 'neg' : 'pos') + '">' +
(t.type === 'expense' ? '−' : '+') + num(t.amount) + '</td></tr>';
}).join('') + '</tbody></table>';
if (list.length > 120) html += '<div class="note">仅显示最近 120 笔</div>';
} else {
html += '<div class="empty">这个周期还没有' + (cat ? '该分类的' : '') + '记录</div>';
}
html += '</div>';
openModal(cat ? cat + ' · 周期明细' : '周期详细数据', html,
function(){ return true; }, '关闭', true);
}
function cpInit(){
var sel = document.getElementById('cp-day');
if (!sel) return;
var opts = '';
for (var i = 1; i <= 31; i++) opts += '<option value="' + i + '">' + i + ' 号</option>';
sel.innerHTML = opts;
sel.value = String(cpGetDay());
sel.addEventListener('change', function(){ cpSetDay(+sel.value); cpPreset(0); });
/* 手填起止日后，把起点/终点的「日」当作新锚点，翻月时按它对齐 */
document.getElementById('cp-from').addEventListener('change', function(){
CP_ANCHOR = +this.value.slice(8,10) || CP_ANCHOR;
cpRender();
});
document.getElementById('cp-to').addEventListener('change', function(){
CP_ANCHOR = +this.value.slice(8,10) || CP_ANCHOR;
cpRender();
});
cpPreset(0);
}
/* ================= 渲染：分析 ================= */
function renderAnalysis(){
var period = +(document.getElementById('ana-period').value || 12);
var series = buildSeries();
if (period > 0){
var from = lastMonths(period)[0] + '-01';
series = series.filter(function(p){ return p.date >= from; });
}
if (series.length >= 2){
draw('c-ana-net', {
type: 'line',
data: {
labels: series.map(function(p){ return p.date.slice(5); }),
datasets: [{
label:'净资产', data: series.map(function(p){ return p.net; }),
borderColor:'#0071e3', backgroundColor:'rgba(0,113,227,.08)',
fill:true, tension:.3, pointRadius:2, pointHoverRadius:4, borderWidth:2
}]
},
options: baseOpts({plugins:{legend:{display:false}}})
});
} else {
draw('c-ana-net', {type:'line', data:{labels:[], datasets:[]},
options: Object.assign(baseOpts(), {scales:{x:{display:false}, y:{display:false}},
plugins:{legend:{display:false}, tooltip:{enabled:false},
title:{display:true, text:'所选区间内还没有足够的数据点', color:'rgba(60,60,67,.45)', font:{size:12, weight:'400'}}}})});
}
var inv = db.accounts.filter(function(a){ return kindOf(a) === 'invest'; });
var balNow = currentBalances();
var perf = inv.map(function(a){ return accountPerf(a, balNow[a.id] || 0); });
if (perf.length){
draw('c-ana-rate', {
type: 'bar',
data: {
labels: perf.map(function(p){ return p.name; }),
datasets: [{
label:'盈亏金额', data: perf.map(function(p){ return Math.round(p.gain*100)/100; }),
backgroundColor: perf.map(function(p){ return p.gain >= 0 ? '#ff3b30' : '#34c759'; }),
borderRadius: 4, maxBarThickness: 40
}]
},
options: baseOpts({indexAxis:'y'})
});
} else {
draw('c-ana-rate', {type:'bar', data:{labels:[], datasets:[]},
options: Object.assign(baseOpts({indexAxis:'y'}), {scales:{x:{display:false}, y:{display:false}},
plugins:{legend:{display:false}, tooltip:{enabled:false},
title:{display:true, text:'还没有股票 / 基金类账户', color:'rgba(60,60,67,.45)', font:{size:12, weight:'400'}}}})});
}
var rows = perf.map(function(p){
var a = accountById(p.id);
var rate = p.rate * 100;
var rateCls = privacyOn ? '' : (Math.abs(p.gain) < 0.005 ? 'muted' : (p.gain > 0 ? 'pos' : 'neg'));
var rateText = privacyOn ? PRIVACY_MASK
: ((Math.abs(p.gain) < 0.005) ? '—' : (rate >= 0 ? '+' : '') + rate.toFixed(2) + '%');
return '<tr>' +
'<td><strong>' + esc(a.name) + '</strong><br><span class="muted" style="font-size:11px">' +
(p.hasMarket ? '已记录市值变动' : '尚未更新过市值') + '</span></td>' +
'<td class="num">' + num(p.start) + '</td>' +
'<td class="num">' + num(p.invested) + '</td>' +
'<td class="num ' + (privacyOn ? '' : (p.gain >= 0 ? 'pos' : 'neg')) + '">' +
(privacyOn ? '' : (p.gain >= 0 ? '+' : '')) + num(p.gain) + '</td>' +
'<td class="num">' + num(p.end) + '</td>' +
'<td class="num ' + rateCls + '">' + rateText + '</td>' +
'</tr>';
}).join('');
document.getElementById('ana-table').innerHTML = perf.length
? '<table><thead><tr><th>账户</th><th class="num">建账余额</th><th class="num">净投入</th><th class="num">盈亏</th><th class="num">当前余额</th><th class="num">收益率</th></tr></thead><tbody>' + rows + '</tbody></table>'
: '<div class="empty">还没有股票 / 基金类账户。这类账户的盈亏由「更新余额」时的市值差额产生。</div>';
var months = lastMonths(6);
var incs = months.map(function(mm){ return monthStats(mm).income; });
var exps = months.map(function(mm){ return monthStats(mm).expense; });
var bal = months.map(function(mm){ return monthStats(mm).balance; });
draw('c-ana-exp', {
type: 'bar',
data: {
labels: months.map(function(mm){ return mm.slice(5) + '月'; }),
datasets: [
{label:'收入', data: incs, backgroundColor:'#34c759', maxBarThickness:16, borderRadius:4},
{label:'支出', data: exps, backgroundColor:'#ff3b30', maxBarThickness:16, borderRadius:4},
{label:'结余', type:'line', data: bal, borderColor:'#0071e3', tension:.3,
pointRadius:2, borderWidth:2, fill:false}
]
},
options: baseOpts({plugins:{legend:{display:true, position:'top', align:'end',
labels:{boxWidth:8, boxHeight:8, font:{size:11}, color:'rgba(60,60,67,.7)'}}}})
});
cpRender();
}
/* ================= 渲染：数据 ================= */
/* 数据规模：stringify 整个 db（含逐日派生的虚拟流水）不便宜，按 db 引用缓存一次 */
function dataSize(){
var c = cache();
if (c.size == null){
try { c.size = JSON.stringify(db).length; } catch(e){ c.size = 0; }
}
return c.size;
}
function renderData(){
var bytes = dataSize();
document.getElementById('data-stats').textContent =
'账户 ' + db.accounts.length + ' 个 · 流水 ' + db.transactions.length + ' 条 · 自动 ' +
db.autoTx.length + ' 笔 · 约 ' + (bytes/1024).toFixed(1) + ' KB';
document.getElementById('data-desc').textContent =
'数据保存在本机 SQLite 文件里（data/finance.db），不上传任何服务器。余额由「建账余额 + 累计流水 + 每日定投 + 固定支出规则」自动推导；定投与固定支出按日历派生、不写入流水表，但都会显示在明细里——定投是账户间转账，只在两个账户间挪钱、不计入收支；固定支出是真实花销，计入支出统计。固定支出支持每天、仅工作日与每月固定日（如房租）。活期、银行卡、银行理财分别独立核算。删改任何一笔真实流水后余额和曲线都会立即重算。';
}
/* ================= 总渲染 ================= */
function renderAll(){
stopRoll();
ROLL_SLOTS.length = 0;
fillAccountSelects();
renderInsights();
tabById(activeTab).render();
renderData();
}
function renderCurrent(){
stopRoll();
ROLL_SLOTS.length = 0;
tabById(activeTab).render();
}
;
/* ================= 渲染：算薪（实时收入计数器） ================= */
/* 口径：月薪 ÷ 月工作天数 = 日薪；日薪 ÷ 每日净工作秒数 = 秒薪；
今日已赚按「上班 → 当前」的净工作秒数匀速累加，午休/下班后不再增长。
配置只存本机 localStorage，不进后端、不进备份文件。 */
var SAL_KEY = 'jz_salary_v1', SAL_TODAY_KEY = 'jz_salary_today_v1';
var SAL_DEFAULT = {monthly:12000, daysMode:'auto', days:21.75,
start:'09:00:00', end:'18:00:00', lunchStart:'12:00:00', lunchMin:60};
var salCfg = null, salTimer = 0;
function salNum(v, lo, hi, def){
var n = parseFloat(v);
return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
}
function salTime(v, def){
var m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(v == null ? '' : v));
if (!m) return def;
var h = +m[1], mi = +m[2], s = +(m[3] || 0);
if (h > 23 || mi > 59 || s > 59) return def;
return h * 3600 + mi * 60 + s;
}
function salClock(sec, withSec){
sec = Math.max(0, Math.floor(sec || 0));
var p = function(n){ return n < 10 ? '0' + n : '' + n; };
return p(Math.floor(sec / 3600) % 24) + ':' + p(Math.floor(sec / 60) % 60) +
(withSec ? ':' + p(sec % 60) : '');
}
function salDur(sec){
sec = Math.max(0, Math.floor(sec || 0));
var p = function(n){ return n < 10 ? '0' + n : '' + n; };
return p(Math.floor(sec / 3600)) + ':' + p(Math.floor(sec / 60) % 60) + ':' + p(sec % 60);
}
function salNormTime(v, def){
return salClock(salTime(v, salTime(def, 0)), true);
}
function salLoad(){
var c = {};
try { c = JSON.parse(lsGet(SAL_KEY) || '{}') || {}; } catch(e){ c = {}; }
var start = salNormTime(c.start, SAL_DEFAULT.start);
var end = salNormTime(c.end, SAL_DEFAULT.end);
if (salTime(end, 0) <= salTime(start, 0)){
start = SAL_DEFAULT.start; end = SAL_DEFAULT.end;
}
return {
monthly: salNum(c.monthly, 0, 1e9, SAL_DEFAULT.monthly),
daysMode: c.daysMode === 'manual' ? 'manual' : 'auto',
days: salNum(c.days, 0.5, 31, SAL_DEFAULT.days),
start: start, end: end,
lunchStart: salNormTime(c.lunchStart, SAL_DEFAULT.lunchStart),
lunchMin: Math.round(salNum(c.lunchMin, 0, 480, SAL_DEFAULT.lunchMin))
};
}
function salSave(c){ lsSet(SAL_KEY, JSON.stringify(c)); }
function salTodayMode(){
try {
var v = JSON.parse(lsGet(SAL_TODAY_KEY) || 'null');
if (v && v.date === today() && ['auto','work','off'].indexOf(v.mode) >= 0) return v.mode;
} catch(e){}
return 'auto';
}
function salSetToday(mode){ lsSet(SAL_TODAY_KEY, JSON.stringify({date:today(), mode:mode})); }
function salWorkdays(y, m){
var n = 0, last = new Date(y, m, 0).getDate(), d = new Date(y, m - 1, 1);
for (var i = 1; i <= last; i++){ d.setDate(i); if (d.getDay() >= 1 && d.getDay() <= 5) n++; }
return n;
}
function salPastWorkdays(y, m, day){
var n = 0;
for (var i = 1; i < day; i++){
var w = new Date(y, m - 1, i).getDay();
if (w >= 1 && w <= 5) n++;
}
return n;
}
function salOverlap(a1, a2, b1, b2){
var lo = Math.max(a1, b1), hi = Math.min(a2, b2);
return hi > lo ? hi - lo : 0;
}
/* 纯函数：给定配置与当前时刻算出全部展示数据，便于脱离 DOM 验证 */
function salCalc(c, now, todayMode){
var d = now instanceof Date ? now : new Date(now);
var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate(), w = d.getDay();
var workdays = c.daysMode === 'manual' ? c.days : salWorkdays(y, m);
var isWork = todayMode === 'work' ? true
: todayMode === 'off' ? false : (w >= 1 && w <= 5);
var s = salTime(c.start, 0), e = salTime(c.end, 0);
var ls = salTime(c.lunchStart, 0), le = ls + c.lunchMin * 60;
var lunchIn = salOverlap(s, e, ls, le);
var span = Math.max(1, (e - s) - lunchIn);
var daily = workdays > 0 ? c.monthly / workdays : 0;
var perSec = daily / span;
var nowSec = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() +
d.getMilliseconds() / 1000;
var worked = Math.max(0, Math.min(nowSec, e) - s) -
salOverlap(s, Math.max(s, Math.min(nowSec, e)), ls, le);
var elapsed = Math.min(span, Math.max(0, worked));
var clockProgress = Math.max(0, Math.min(1, (nowSec - s) / Math.max(1, e - s)));
var inLunch = c.lunchMin > 0 && nowSec >= ls && nowSec < le && nowSec > s && nowSec < e;
var state = !isWork ? 'rest'
: nowSec < s ? 'before'
: nowSec >= e ? 'done'
: inLunch ? 'lunch' : 'work';
var earned = isWork ? perSec * elapsed : 0;
var past = salPastWorkdays(y, m, day);
return {
y:y, m:m, day:day, weekday:w, workdays:workdays, isWork:isWork, state:state,
start:s, end:e, lunchStart:ls, lunchEnd:le, lunchIn:lunchIn, span:span,
daily:daily, perSec:perSec, elapsed:elapsed, earned:earned,
progress: isWork ? elapsed / span : 0, clockProgress:clockProgress,
nowSec:nowSec, past:past, monthEarned: past * daily + earned
};
}
function salMoney(v){
if (privacyOn) return PRIVACY_MASK;
var s = (Math.round((v || 0) * 10000) / 10000).toFixed(4).split('.');
return '¥' + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + s[1];
}
function salSet(id, text){ var el = document.getElementById(id); if (el) el.textContent = text; }
function salFillForm(c, tm){
var ids = {'sal-monthly':c.monthly, 'sal-days-mode':c.daysMode, 'sal-days':c.days,
'sal-start':c.start, 'sal-end':c.end, 'sal-lunch-start':c.lunchStart,
'sal-lunch-min':c.lunchMin, 'sal-today':tm};
Object.keys(ids).forEach(function(id){
var el = document.getElementById(id);
if (el) el.value = ids[id];
});
var f = document.getElementById('sal-days-field');
if (f) f.style.display = c.daysMode === 'manual' ? '' : 'none';
}
function salReadForm(){
var v = function(id){ var el = document.getElementById(id); return el ? el.value : ''; };
var c = {
monthly: salNum(v('sal-monthly'), 0, 1e9, SAL_DEFAULT.monthly),
daysMode: v('sal-days-mode') === 'manual' ? 'manual' : 'auto',
days: salNum(v('sal-days'), 0.5, 31, SAL_DEFAULT.days),
start: salNormTime(v('sal-start'), SAL_DEFAULT.start),
end: salNormTime(v('sal-end'), SAL_DEFAULT.end),
lunchStart: salNormTime(v('sal-lunch-start'), SAL_DEFAULT.lunchStart),
lunchMin: Math.round(salNum(v('sal-lunch-min'), 0, 480, SAL_DEFAULT.lunchMin))
};
if (salTime(c.end, 0) <= salTime(c.start, 0)) c.end = '23:59:59';
return c;
}
function salOnSettingChange(){
salCfg = salReadForm();
salSave(salCfg);
var t = document.getElementById('sal-today');
salSetToday(t ? t.value : 'auto');
var f = document.getElementById('sal-days-field');
var mode = document.getElementById('sal-days-mode');
if (f && mode) f.style.display = mode.value === 'manual' ? '' : 'none';
salStaticText();
salPaint();
}
function salMetricsSkeleton(){
var box = document.getElementById('sal-metrics');
if (!box) return;
box.innerHTML =
'<div class="metric"><div class="lab">每秒进账</div><div class="val" id="sal-m-rate"></div><div class="foot">工作时间内匀速增长</div></div>' +
'<div class="metric"><div class="lab">今日目标</div><div class="val" id="sal-m-daily"></div><div class="foot" id="sal-m-daily-foot"></div></div>' +
'<div class="metric"><div class="lab">本月已赚</div><div class="val" id="sal-m-month"></div><div class="foot" id="sal-m-month-foot"></div></div>' +
'<div class="metric"><div class="lab">距下班</div><div class="val" id="sal-m-left"></div><div class="foot" id="sal-m-left-foot"></div></div>';
}
function salStaticText(){
if (!salCfg) salCfg = salLoad();
var r = salCalc(salCfg, new Date(), salTodayMode());
salSet('sal-formula', privacyOn ? '金额已隐藏，点右上角眼睛显示'
: '¥' + salCfg.monthly.toLocaleString('zh-CN') + ' ÷ ' + r.workdays + ' 天 ÷ ' +
(r.span / 3600).toFixed(2) + ' 小时 = ' + salMoney(r.perSec) + '/秒');
salSet('sal-note', '日薪 = 月薪 ÷ 月工作天数；秒薪 = 日薪 ÷ 净工作秒数（自动扣除落在班次内的午休）。' +
'今日已赚从上班时刻按秒累加，午休与下班后停止增长；本月已赚按日历工作日估算。' +
'设置只保存在这台设备的浏览器里，不进账本备份。');
}
var SAL_STATES = {
rest:   ['今天休息',  'background:var(--fill);color:var(--muted)'],
before: ['等待开工',  'background:var(--primary-weak);color:var(--primary)'],
work:   ['搬砖中',    'background:var(--green-weak);color:#248a3d'],
lunch:  ['午休中',    'background:rgba(255,149,0,.14);color:#b26a00'],
done:   ['今日已收工','background:var(--fill);color:var(--muted)']
};
function salPaint(){
if (!document.getElementById('sal-now')) return;
if (!salCfg) salCfg = salLoad();
var r = salCalc(salCfg, new Date(), salTodayMode());
salSet('sal-now', salMoney(r.earned));
salSet('sal-date', r.y + '年' + r.m + '月' + r.day + '日 · 周' +
'日一二三四五六'.charAt(r.weekday) + ' · 本月 ' + r.workdays + ' 个工作日');
var st = SAL_STATES[r.state] || SAL_STATES.rest;
var tag = document.getElementById('sal-state');
if (tag){ tag.textContent = st[0]; tag.setAttribute('style', st[1]); }
var rate;
if (r.state === 'rest') rate = '今天不计费，挂着也不会涨';
else if (privacyOn) rate = '金额已隐藏 · 点右上角眼睛显示';
else rate = '每秒 +' + salMoney(r.perSec);
if (r.state === 'before') rate += ' · 距开工 ' + salDur(r.start - r.nowSec);
else if (r.state !== 'rest') rate += ' · 今日进度 ' + (r.progress * 100).toFixed(1) + '%';
salSet('sal-rate', rate);
var fill = document.getElementById('sal-fill'), pin = document.getElementById('sal-pin');
var lunch = document.getElementById('sal-lunch');
if (fill) fill.style.width = (r.progress * 100).toFixed(2) + '%';
if (pin) pin.style.left = (r.clockProgress * 100).toFixed(2) + '%';
if (lunch){
var lo = Math.max(r.start, r.lunchStart), hi = Math.min(r.end, r.lunchEnd);
if (hi > lo){
lunch.style.display = '';
lunch.style.left = ((lo - r.start) / Math.max(1, r.end - r.start) * 100).toFixed(2) + '%';
lunch.style.width = ((hi - lo) / Math.max(1, r.end - r.start) * 100).toFixed(2) + '%';
} else lunch.style.display = 'none';
}
salSet('sal-t-start', salClock(r.start, false));
salSet('sal-t-now', salClock(r.nowSec, true));
salSet('sal-t-end', salClock(r.end, false));
salSet('sal-m-rate', salMoney(r.perSec));
salSet('sal-m-daily', money(r.daily));
salSet('sal-m-daily-foot', '月薪 ÷ ' + r.workdays + ' 个工作日');
salSet('sal-m-month', money(r.monthEarned));
salSet('sal-m-month-foot', '已过 ' + r.past + ' 个工作日 + 今日');
salSet('sal-m-left', (r.state === 'work' || r.state === 'lunch')
? salDur(r.end - r.nowSec) : '—');
salSet('sal-m-left-foot', '下班 ' + salClock(r.end, false));
}
function stopSalary(){
if (salTimer){ clearInterval(salTimer); salTimer = 0; }
}
function renderSalary(){
stopSalary();
salCfg = salLoad();
salFillForm(salCfg, salTodayMode());
salMetricsSkeleton();
salStaticText();
salPaint();
salTimer = setInterval(salPaint, 200);
}
;
/* ================= 交互：记账 ================= */
async function submitTx(ev){
ev.preventDefault();
var amount = +document.getElementById('tx-amount').value;
if (!(amount > 0)){ alert('请填写有效金额'); return; }
var accId = document.getElementById('tx-acct').value;
if (!accId){ alert('请先添加账户'); return; }
var payload = {
date: document.getElementById('tx-date').value,
type: txType,
account_id: accId,
amount: amount,
note: document.getElementById('tx-note').value.trim()
};
if (txType === 'transfer'){
payload.to_account_id = document.getElementById('tx-to').value;
} else {
payload.category = document.getElementById('tx-cat').value;
}
var btn = document.getElementById('tx-submit');
btn.disabled = true;
try {
await api('/api/transactions', {method:'POST', body: payload});
lastAccountId = accId;
var d = document.getElementById('tx-date');
var keepMonth = d.value.slice(0,7);
document.getElementById('led-month').value = keepMonth;
document.getElementById('tx-amount').value = '';
document.getElementById('tx-note').value = '';
await reload();
document.getElementById('tx-amount').focus();
} catch(e){
alert.error(e.message);
} finally {
btn.disabled = false;
}
}
/* ================= 交互：删除与撤销 ================= */
var undoState = null, undoTimer = null;
function showUndo(msg, action){
var el = document.getElementById('undo-toast');
if (!el) return;
clearTimeout(undoTimer);
undoState = action;
el.innerHTML = '<span class="u-msg">' + esc(msg) + '</span>' +
'<button type="button" id="undo-btn">撤销</button>';
el.classList.add('show');
var btn = document.getElementById('undo-btn');
if (btn) btn.onclick = async function(){
var fn = undoState;
hideUndo();
if (!fn) return;
try { await fn(); } catch(e){ alert('撤销失败：' + (e.message || '未知原因')); }
};
undoTimer = setTimeout(hideUndo, 6000);
}
function hideUndo(){
clearTimeout(undoTimer);
undoState = null;
var el = document.getElementById('undo-toast');
if (el) el.classList.remove('show');
}
function txLabel(t){
var name = t.type === 'expense' ? '支出' : t.type === 'income' ? '收入'
: t.type === 'transfer' ? '转账' : '余额调整';
var tail = (t.type !== 'transfer' && t.category) ? ' · ' + t.category : '';
return name + ' ' + num(t.amount) + tail;
}
async function delTx(id){
var t = db.transactions.filter(function(x){ return x.id === id; })[0];
if (!t) return;
try {
await api('/api/transactions/' + id, {method: 'DELETE'});
await reload();
/* 用原数据重建一条：流水没有外部引用，换个 id 不影响任何东西 */
showUndo('已删除 ' + txLabel(t), async function(){
await api('/api/transactions', {method:'POST', body:{
date: t.date, type: t.type, account_id: t.accountId,
to_account_id: t.toAccountId, category: t.category,
amount: t.amount, note: t.note
}});
await reload();
});
} catch(e){ alert.error(e.message); }
}
/* ============ 删除单笔自动支出（规则派生，删的是「这一天的这笔」） ============ */
/* 自动支出不落库，无法物理删除，只能记一条 (ruleId, date) 排除记录；
派生时跳过它，于是余额、明细、统计、导出会同时少掉这一笔。 */
async function delAutoTx(ruleId, date){
if (!ruleId || !date) return;
var t = db.autoTx.filter(function(x){
return x.ruleId === ruleId && x.date === date;
})[0];
var isTransfer = !!t && t.type === 'transfer';
if (isTransfer){
/* 定投删一笔会同时改动两个账户余额，和固定支出不同，先确认一次 */
var from = accountById(t.accountId), to = accountById(t.toAccountId);
if (!confirm('删除 ' + date.slice(5) + ' 的这笔定投（' + money(t.amount) + '）？\n' +
(from ? from.name : '转出账户') + ' 与 ' + (to ? to.name : '转入账户') +
' 的余额会同时还原，定投规则本身不受影响。')) return;
}
try {
await api('/api/skips', {method:'POST', body:{ruleId: ruleId, date: date}});
await reload();
alert.success('已删除 ' + date.slice(5) + ' 的' +
(isTransfer ? '这笔定投' : '这笔自动支出') + '，规则本身不受影响。');
} catch(e){ alert.error(e.message); }
}
/* ================= 交互：编辑流水 ================= */
function catOptions(typ, sel){
var cats = typ === 'income' ? IN_CATS : EX_CATS;
return cats.map(function(c){
return '<option value="' + c + '"' + (c === sel ? ' selected' : '') + '>' + c + '</option>';
}).join('');
}
function acctOptions(sel){
return db.accounts.map(function(a){
return '<option value="' + a.id + '"' + (a.id === sel ? ' selected' : '') + '>' +
esc(a.name) + '</option>';
}).join('');
}
function openTxModal(id){
var t = db.transactions.filter(function(x){ return x.id === id; })[0];
if (!t) return;
/* 隐私态下预填金额等于把数字写在屏幕上，这里清空并要求重新输入
（与「更新余额」「定投设置」两个弹窗保持一致） */
var amtVal = privacyOn ? '' : t.amount;
var ph = privacyOn ? '重新输入金额' : '';
var body = '<div class="field"><label>日期</label>' +
'<input type="date" id="et-date" value="' + t.date + '"></div>';
if (t.type === 'transfer'){
body += '<div class="field"><label>金额 (¥)</label>' +
'<input type="number" id="et-amount" step="0.01" min="0.01" value="' + amtVal + '" placeholder="' + ph + '"></div>' +
'<div class="field"><label>从</label><select id="et-from">' + acctOptions(t.accountId) + '</select></div>' +
'<div class="field"><label>转到</label><select id="et-to">' + acctOptions(t.toAccountId) + '</select></div>';
} else if (t.type === 'adjust'){
body += '<div class="field"><label>调整额 (¥，可负)</label>' +
'<input type="number" id="et-amount" step="0.01" value="' + amtVal + '"></div>' +
'<div class="field"><label>账户</label><select id="et-from">' + acctOptions(t.accountId) + '</select></div>';
} else {
body += '<div class="field"><label>金额 (¥)</label>' +
'<input type="number" id="et-amount" step="0.01" min="0.01" value="' + amtVal + '" placeholder="' + ph + '"></div>' +
'<div class="field"><label>分类</label><select id="et-cat">' + catOptions(t.type, t.category) + '</select></div>' +
'<div class="field"><label>账户</label><select id="et-from">' + acctOptions(t.accountId) + '</select></div>';
}
body += '<div class="field"><label>备注 (可选)</label>' +
'<input id="et-note" maxlength="60" value="' + esc(t.note) + '"></div>' +
'<span class="muted" style="font-size:11.5px">改完余额立即重算；记录类型不可更改。</span>';
var titles = {expense: '编辑支出', income: '编辑收入',
transfer: '编辑转账', adjust: '编辑余额调整'};
openModal(titles[t.type] || '编辑记录', body, async function(){
var raw = String(document.getElementById('et-amount').value).trim();
if (raw === ''){ alert('请填写金额'); return false; }
var amt = +raw;
if (isNaN(amt)){ alert('请填写有效金额'); return false; }
var payload = {
date: document.getElementById('et-date').value,
account_id: document.getElementById('et-from').value,
amount: amt,
note: document.getElementById('et-note').value.trim()
};
if (t.type === 'transfer'){
payload.to_account_id = document.getElementById('et-to').value;
} else if (t.type === 'expense' || t.type === 'income'){
payload.category = document.getElementById('et-cat').value;
}
try {
await api('/api/transactions/' + id, {method: 'PUT', body: payload});
await reload();
} catch(e){
alert.error(e.message);
return false;
}
}, '保存');
}
/* ================= 交互：账户 ================= */
function typeOptions(selected){
return Object.keys(TYPE_META).map(function(k){
var m = TYPE_META[k];
/* 银行理财名称已自解释，不再追加角色后缀 */
var text = m.plainLabel ? m.label : m.label + ' · ' + ROLE_META[m.role].short;
return '<option value="' + k + '"' + (k === selected ? ' selected' : '') + '>' +
text + '</option>';
}).join('');
}
/* ================= 每日定投 ================= */
function dcaCurrent(){
return db.dca.length ? db.dca[db.dca.length - 1] : null;
}
function dcaStats(){
var st = {count:0, total:0, mCount:0, mTotal:0, last:''};
var m = thisMonth();
autoTxOf(AUTO_KIND.DCA).forEach(function(t){
st.count++; st.total += t.amount; st.last = t.date;
if (monthKey(t.date) === m){ st.mCount++; st.mTotal += t.amount; }
});
return st;
}
function renderDca(){
var box = document.getElementById('dca-summary');
if (!box) return;
var c = dcaCurrent(), s = dcaStats();
var rm = document.getElementById('dca-remove');
if (rm) rm.style.display = c ? '' : 'none';
if (!c){
box.innerHTML = '<div class="muted" style="margin:0">未启用。设置后每个工作日自动从活期转入基金/定投账户，活期减少、基金增加，无需手动记一笔。</div>';
return;
}
var from = accountById(c.fromId), to = accountById(c.toId);
var invalid = !from || !to;
var tag = !c.enabled
? '<span class="tag" style="background:var(--fill);color:var(--muted)">已暂停</span>'
: invalid
? '<span class="tag" style="background:var(--red-weak);color:var(--red)">账户失效</span>'
: '<span class="tag" style="background:rgba(52,199,89,.14);color:#248a3d">运行中</span>';
var line1 = '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
'<span style="font-size:17px;font-weight:600;font-variant-numeric:tabular-nums">' + money(c.amount) + '</span>' +
'<span class="muted">/ ' + (c.weekdaysOnly ? '工作日' : '每天') + '</span>' +
'<span class="muted">·</span><span>' + esc(from ? from.name : '账户已删除') +
' → ' + esc(to ? to.name : '账户已删除') + '</span>' + tag + '</div>';
var start = db.dca[0] ? db.dca[0].effectiveFrom : c.effectiveFrom;
var line2 = '<div class="muted" style="margin-top:7px">累计 ' + s.count + ' 笔 ' + money(s.total) +
' · 本月 ' + s.mCount + ' 笔 ' + money(s.mTotal) +
(s.last ? ' · 最近结算 ' + s.last : '') + ' · 起始 ' + start + '</div>';
var warn = invalid
? '<div class="muted" style="margin-top:6px;color:var(--red)">配置的账户已被删除，期间不产生扣款，请点「设置」重新指定。</div>'
: '';
var note = '<div class="muted" style="margin-top:6px;font-size:11.5px;opacity:.85">' +
'按自然日结算，与脚本是否运行无关：未打开期间的应扣工作日会在下次打开时一次性补齐；每天至多一笔，不重复扣款。修改金额只从今天起生效。</div>';
box.innerHTML = line1 + line2 + warn + note;
}
function openDcaModal(){
var daily = accountsByRole('daily');
var hold = accountsByRole('hold').concat(accountsByRole('wealth'));
if (!daily.length || !hold.length){
alert('需要先各有一个「日常可用」和「长期持有」账户。\n请先在资产页添加账户：活期/银行卡作为扣款方，基金/定期作为转入方。');
return;
}
var c = dcaCurrent(), isFirst = !c;
var fid = c ? c.fromId : daily[0].id;
var tid = c ? c.toId : hold[0].id;
if (!accountById(fid)) fid = daily[0].id;
if (!accountById(tid)) tid = hold[0].id;
function opts(list, sel){
return list.map(function(a){
return '<option value="' + a.id + '"' + (a.id === sel ? ' selected' : '') + '>' + esc(a.name) + '</option>';
}).join('');
}
var body =
'<div class="field"><label>每天扣款金额 (¥)</label>' +
'<input type="number" id="dca-amt" step="0.01" min="0" value="' +
(privacyOn ? '' : (c ? c.amount : 100)) + '"' +
(privacyOn ? ' placeholder="请输入每日金额（当前金额已隐藏）"' : '') + '></div>' +
'<div class="field"><label>扣款账户 · 日常可用</label>' +
'<select id="dca-from">' + opts(daily, fid) + '</select></div>' +
'<div class="field"><label>转入账户 · 长期持有</label>' +
'<select id="dca-to">' + opts(hold, tid) + '</select></div>' +
'<div class="field"><label>扣款日历</label><select id="dca-cal">' +
'<option value="weekday"' + (!c || c.weekdaysOnly ? ' selected' : '') + '>仅工作日（周一至周五）</option>' +
'<option value="all"' + (c && !c.weekdaysOnly ? ' selected' : '') + '>每天（含周末）</option></select></div>' +
'<div class="field"><label>状态</label><select id="dca-on">' +
'<option value="on"' + (!c || c.enabled ? ' selected' : '') + '>启用</option>' +
'<option value="off"' + (c && !c.enabled ? ' selected' : '') + '>暂停</option></select></div>' +
'<div class="field"><label>起始日' + (isFirst ? '' : '（已生效，不可修改）') + '</label>' +
'<input type="date" id="dca-start" value="' + (isFirst ? today() : db.dca[0].effectiveFrom) + '"' +
(isFirst ? '' : ' disabled') + '></div>' +
'<span class="muted" style="font-size:11.5px;line-height:1.7">' +
(isFirst
? '起始日之前不会补算。填过去的日期，表示你确认那些天确实扣过款，系统会一次性补齐到今天。'
: '本次修改从今天起生效，之前的金额保持不变；当天只按新金额结算一次，不会重复扣。') +
'<br>脚本没打开期间的应扣工作日，会在下次打开时按日历补齐。' +
'</span>';
openModal(isFirst ? '开启每日定投' : '修改每日定投', body, async function(){
var rawAmt = String(document.getElementById('dca-amt').value).trim();
if (rawAmt === '' && isFirst){ alert('请填写每日扣款金额'); return false; }
var v = rawAmt === '' ? c.amount : +rawAmt;
if (isNaN(v) || v < 0){ alert('请填写有效金额（0 表示不扣款）'); return false; }
var f = document.getElementById('dca-from').value;
var t = document.getElementById('dca-to').value;
if (f === t){ alert('扣款账户和转入账户不能相同'); return false; }
var payload = {
amount: v, fromId: f, toId: t,
weekdaysOnly: document.getElementById('dca-cal').value === 'weekday',
enabled: document.getElementById('dca-on').value === 'on'
};
if (isFirst) payload.startDate = document.getElementById('dca-start').value || today();
try {
await api('/api/dca', {method:'POST', body: payload});
await reload();
alert.success(isFirst ? '定投已开启，余额已按起始日结算。' : '配置已更新。');
} catch(e){
alert.error(e.message || '保存失败');
return false;
}
});
}
async function removeDca(){
if (!confirm('清除每日定投配置？')) return;
if (!confirm('再次确认：清除后，此前所有自动定投都会从余额中消失，历史余额随之变化。建议先导出备份。')) return;
try {
await api('/api/dca', {method:'DELETE'});
await reload();
alert.success('定投配置已清除。');
} catch(e){ alert.error('清除失败：' + e.message); }
}
;
/* ================= 每日固定支出（多条规则） ================= */
/* db.fixed 是所有规则的「版本合集」；按 ruleId 分组后，每组最后一条版本即该规则当前配置。
后端按规则分组派生自动流水，因此同一天可以有多笔自动支出。 */
function fixedRules(){
var map = {}, order = [];
db.fixed.forEach(function(v){
var rid = v.ruleId || 'default';
if (!map[rid]){ map[rid] = {ruleId:rid, versions:[]}; order.push(map[rid]); }
map[rid].versions.push(v);
});
order.forEach(function(r){
r.versions.sort(function(a,b){
if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom < b.effectiveFrom ? -1 : 1;
return (a.id || 0) - (b.id || 0);
});
r.start = r.versions[0].effectiveFrom;
r.current = r.versions[r.versions.length - 1];
});
return order;
}
function fixedRuleById(ruleId){
var out = null;
fixedRules().forEach(function(r){ if (r.ruleId === ruleId) out = r; });
return out;
}
/* 不传 ruleId 时统计全部自动支出（洞察卡等汇总场景） */
function fixedStats(ruleId){
var st = {count:0, total:0, mCount:0, mTotal:0, last:''};
var m = thisMonth();
autoTxOf(AUTO_KIND.FIXED).forEach(function(t){
if (ruleId && t.ruleId && t.ruleId !== ruleId) return;
st.count++; st.total += t.amount; st.last = t.date;
if (monthKey(t.date) === m){ st.mCount++; st.mTotal += t.amount; }
});
return st;
}
function fxDots(){
var el = document.getElementById('fixed-scroll'), box = document.getElementById('fixed-dots');
if (!el || !box) return;
var items = el.querySelectorAll('.fx-item');
if (items.length < 2){ box.innerHTML = ''; return; }
var step = items[0].getBoundingClientRect().width + 12;
var i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollLeft / (step || 1))));
var html = '';
for (var k = 0; k < items.length; k++) html += '<i class="' + (k === i ? 'on' : '') + '"></i>';
box.innerHTML = html;
}
function renderFixed(){
var box = document.getElementById('fixed-scroll');
if (!box) return;
var rules = fixedRules();
var cnt = document.getElementById('fixed-count');
if (cnt) cnt.textContent = rules.length ? '共 ' + rules.length + ' 条' : '';
if (!rules.length){
box.innerHTML = '<div class="fx-empty" style="flex:1 1 100%">' +
'未启用。点「+ 添加」设置一条自动扣款规则：通勤、午餐可每天或仅工作日扣，' +
'房租可设为每月固定日（含未来的首次扣款日）。可以添加多条，卡片左右滑动查看。</div>';
document.getElementById('fixed-dots').innerHTML = '';
box.onscroll = null;
return;
}
box.innerHTML = rules.map(function(r){
var c = r.current, s = fixedStats(r.ruleId);
var acc = accountById(c.accountId), invalid = !acc;
var future = !!(c.monthlyDay && r.start > today());
var tag = future
? '<span class="tag" style="background:var(--primary-weak);color:var(--primary)">待首次扣款</span>'
: !c.enabled
? '<span class="tag" style="background:#fff;color:var(--muted)">已停用</span>'
: invalid
? '<span class="tag" style="background:var(--red-weak);color:var(--red)">账户失效</span>'
: '<span class="tag" style="background:rgba(52,199,89,.14);color:#248a3d">运行中</span>';
var freq = c.monthlyDay ? '每月 ' + c.monthlyDay + ' 号'
: (c.weekdaysOnly ? '每个工作日' : '每天');
var top = '<div class="fx-top">' +
'<span class="fx-amt">' + money(c.amount) + '</span>' +
'<span class="muted">/ ' + freq + '</span>' + tag + '</div>';
var meta = '<div class="fx-meta">' + esc(c.category) + ' · ' +
esc(acc ? acc.name : '账户已删除') + '<br>' +
'本月 ' + s.mCount + ' 笔 ' + money(s.mTotal) +
' · 累计 ' + s.count + ' 笔 ' + money(s.total) + '<br>' +
(c.monthlyDay ? '首次 ' : '起始 ') + esc(r.start) +
(s.last ? ' · 最近 ' + esc(s.last) : '') +
(future ? '<br>到首次扣款日之前不产生支出' : '') + '</div>';
var warn = invalid
? '<div class="fx-meta" style="color:var(--red)">扣款账户已删除，期间不产生支出，请点「编辑」重新指定。</div>'
: '';
var foot = '<div class="fx-foot">' +
'<button class="btn btn-sm" data-act="fixed-edit" data-id="' + esc(r.ruleId) + '">编辑</button>' +
'<button class="btn btn-sm" data-act="fixed-toggle" data-id="' + esc(r.ruleId) + '">' +
(c.enabled ? '停用' : '启用') + '</button>' +
'<button class="btn btn-sm btn-danger" data-act="fixed-del" data-id="' + esc(r.ruleId) + '">删除</button>' +
'</div>';
return '<div class="fx-item">' + top + meta + warn + foot + '</div>';
}).join('');
box.onscroll = fxDots;
fxDots();
}
function fxScrollToLast(){
var el = document.getElementById('fixed-scroll');
if (!el) return;
if (window.requestAnimationFrame) requestAnimationFrame(function(){
el.scrollLeft = el.scrollWidth;
fxDots();
});
}
/* 月付规则默认给「下个月 1 号」，房租一类的固定日通常从月初起算 */
function nextMonthFirst(){
var d = new Date(), y = d.getFullYear(), m = d.getMonth() + 2;
if (m > 12){ m = 1; y++; }
return y + '-' + (m < 10 ? '0' : '') + m + '-01';
}
function openFixedModal(ruleId){
var daily = accountsByRole('daily');
if (!daily.length){
alert('需要先有一个「日常可用」账户（活期或银行卡）作为扣款来源。');
return;
}
var rule = ruleId ? fixedRuleById(ruleId) : null;
if (ruleId && !rule){ alert.error('这条规则已不存在，请刷新后重试。'); return; }
var isNew = !rule, isFirst = fixedRules().length === 0;
var c = rule ? rule.current : null;
var aid = c ? c.accountId : daily[0].id;
if (!accountById(aid)) aid = daily[0].id;
var cat = c ? c.category : '交通';
function opts(sel){
return EX_CATS.map(function(k){
return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + k + '</option>';
}).join('');
}
/* 周期：每天 / 仅工作日 / 每月固定日。
首条每日规则可指定起始日补算历史；之后新增的每日规则从今天起；
月付规则始终可指定未来的首次扣款日，到那天之前不产生任何支出。 */
var calVal = c ? (c.monthlyDay ? 'monthly' : (c.weekdaysOnly ? 'weekday' : 'all')) : 'all';
var startField = isNew
? '<div class="field" id="fx-start-row"' + (isFirst ? '' : ' style="display:none"') + '>' +
'<label>起始日</label><input type="date" id="fx-start" value="' + today() + '"></div>' +
'<div class="field" id="fx-monthly-row" style="display:none">' +
'<label>首次扣款日（之后每月这一天扣款）</label>' +
'<input type="date" id="fx-first" value="' + nextMonthFirst() + '"></div>'
: '<div class="field"><label>' + (c.monthlyDay ? '首次扣款日' : '起始日') +
'（已生效，不可修改）</label>' +
'<input type="date" value="' + esc(rule.start) + '" disabled></div>';
function syncCal(){
var sel = document.getElementById('fx-cal');
if (!sel) return;
var monthly = sel.value === 'monthly';
var sr = document.getElementById('fx-start-row');
var mr = document.getElementById('fx-monthly-row');
if (sr) sr.style.display = (!monthly && isFirst) ? '' : 'none';
if (mr) mr.style.display = monthly ? '' : 'none';
var h = document.getElementById('fx-hint');
if (!h) return;
h.textContent = monthly
? (isNew
? '从首次扣款日起，每月的这一天扣一笔（如房租）。当月没有这一天时顺延到月末；在此之前不产生支出。'
: '每月 ' + c.monthlyDay + ' 号扣款；当月没有这一天时顺延到月末。')
: isNew && isFirst
? '起始日之前不会补算。填过去的日期，表示你确认那些天确实花过这笔钱，系统会一次性补齐到今天。'
: isNew
? '这条规则从今天起生效，不会补算之前的日期，已有余额与统计保持不变。'
: '本次修改从今天起生效，之前的金额保持不变；当天只按新金额记一次，不会重复。';
}
var body =
'<div class="field"><label>每次扣款金额 (¥)</label>' +
'<input type="number" id="fx-amt" step="0.01" min="0" value="' +
(privacyOn ? '' : (c ? c.amount : 10)) + '"' +
(privacyOn ? ' placeholder="请输入每次扣款金额（当前金额已隐藏）"' : '') + '></div>' +
'<div class="field"><label>分类</label><select id="fx-cat">' + opts(cat) + '</select></div>' +
'<div class="field"><label>扣款账户 · 日常可用</label><select id="fx-acct">' +
daily.map(function(a){
return '<option value="' + esc(a.id) + '"' + (a.id === aid ? ' selected' : '') + '>' + esc(a.name) + '</option>';
}).join('') + '</select></div>' +
'<div class="field"><label>扣款周期</label><select id="fx-cal"' + (isNew ? '' : ' disabled') + '>' +
'<option value="all"' + (calVal === 'all' ? ' selected' : '') + '>每天（含周末）</option>' +
'<option value="weekday"' + (calVal === 'weekday' ? ' selected' : '') + '>仅工作日（周一至周五）</option>' +
'<option value="monthly"' + (calVal === 'monthly' ? ' selected' : '') + '>每月固定日（如房租）</option>' +
'</select></div>' +
(isNew ? '' : '<span class="muted" style="font-size:11.5px;line-height:1.7">扣款周期已生效，如需更换请删除这条规则后重新添加。</span>') +
'<div class="field"><label>状态</label><select id="fx-on">' +
'<option value="on"' + (!c || c.enabled ? ' selected' : '') + '>启用</option>' +
'<option value="off"' + (c && !c.enabled ? ' selected' : '') + '>停用</option></select></div>' +
startField +
'<span class="muted" id="fx-hint" style="font-size:11.5px;line-height:1.7;display:block"></span>' +
'<span class="muted" style="font-size:11.5px;line-height:1.7;display:block;margin-top:6px">' +
'自动支出计入本月支出与分类统计、显示在明细里（可逐条删除某一天），净资产随之减少。</span>';
openModal(isNew ? '添加固定支出规则' : '修改固定支出规则', body, async function(){
var raw = String(document.getElementById('fx-amt').value).trim();
if (raw === '' && isNew){ alert('请填写每次扣款金额'); return false; }
var v = raw === '' ? c.amount : +raw;
if (isNaN(v) || v < 0){ alert('请填写有效金额（0 表示不记录）'); return false; }
var cal = document.getElementById('fx-cal').value;
var monthly = cal === 'monthly';
var payload = {
amount: v,
accountId: document.getElementById('fx-acct').value,
category: document.getElementById('fx-cat').value,
weekdaysOnly: cal === 'weekday',
enabled: document.getElementById('fx-on').value === 'on'
};
if (monthly){
if (isNew){
var first = String(document.getElementById('fx-first').value || '').trim();
if (!first){ alert('请选择首次扣款日'); return false; }
payload.monthlyDay = +first.slice(8,10);
payload.startDate = first;
} else {
payload.monthlyDay = c.monthlyDay;
}
}
if (rule) payload.ruleId = rule.ruleId;
if (isNew && isFirst && !monthly){
payload.startDate = document.getElementById('fx-start').value || today();
}
try {
await api('/api/fixed', {method:'POST', body: payload});
await reload();
if (isNew) fxScrollToLast();
alert.success(isNew
? (monthly ? '已添加，从 ' + payload.startDate + ' 起每月扣一笔。'
: isFirst ? '固定支出已开启，余额已按起始日结算。'
: '已添加，从今天起自动记一笔。')
: '配置已更新。');
} catch(e){
alert.error(e.message || '保存失败');
return false;
}
});
var calSel = document.getElementById('fx-cal');
if (calSel && isNew) calSel.addEventListener('change', syncCal);
syncCal();
}
async function toggleFixed(ruleId){
var r = fixedRuleById(ruleId);
if (!r) return;
var c = r.current;
if (!accountById(c.accountId)){
alert('扣款账户已被删除，请先点「编辑」重新指定账户。');
return;
}
try {
await api('/api/fixed', {method:'POST', body:{
ruleId: r.ruleId, amount: c.amount, accountId: c.accountId,
category: c.category, weekdaysOnly: c.weekdaysOnly,
monthlyDay: c.monthlyDay || 0, enabled: !c.enabled
}});
await reload();
alert.success(c.enabled ? '已停用，从今天起不再扣款。' : '已启用，从今天起恢复扣款。');
} catch(e){ alert.error(e.message || '操作失败'); }
}
async function removeFixed(ruleId){
var r = fixedRuleById(ruleId);
if (!r) return;
if (!confirm('删除这条每日固定支出规则？')) return;
if (!confirm('再次确认：删除后，这条规则此前产生的所有自动支出都会从余额和统计中消失，历史随之变化。建议先导出备份。')) return;
try {
await api('/api/fixed/' + encodeURIComponent(r.ruleId), {method:'DELETE'});
await reload();
alert.success('规则已删除。');
} catch(e){ alert.error(e.message || '删除失败'); }
}
function openAccountModal(){
openModal('添加账户',
'<div class="field"><label>账户名称</label>' +
'<input id="ac-name" placeholder="如：招行工资卡 / 华泰证券 / 房贷"></div>' +
'<div class="field"><label>类型</label>' +
'<select id="ac-type">' + typeOptions('deposit') + '</select></div>' +
'<div class="field"><label>当前余额 (¥)</label>' +
'<input type="number" id="ac-balance" step="0.01" value="0" placeholder="0.00">' +
'<span class="muted" style="font-size:11.5px">填今天的真实余额，作为建账起点。负债填正数（欠多少）。日常类的账户会作为记账时的默认扣款来源。</span></div>' +
'<div class="field"><label>余额日期</label>' +
'<input type="date" id="ac-date" value="' + today() + '"></div>' +
'<div class="field"><label>备注 (可选)</label><input id="ac-note" maxlength="60"></div>',
async function(){
var name = document.getElementById('ac-name').value.trim();
if (!name){ alert('请填写账户名称'); return false; }
var balance = +document.getElementById('ac-balance').value || 0;
var typ = document.getElementById('ac-type').value;
await api('/api/accounts', {method:'POST', body:{
name: name,
type: typ,
initial_balance: balance,
initial_date: document.getElementById('ac-date').value,
note: document.getElementById('ac-note').value.trim()
}});
await reload();
});
}
function openEditAccountModal(aid){
var a = accountById(aid); if (!a) return;
openModal('编辑账户 · ' + a.name,
'<div class="field"><label>账户名称</label>' +
'<input id="ed-name" value="' + esc(a.name) + '"></div>' +
'<div class="field"><label>类型</label>' +
'<select id="ed-type">' + typeOptions(a.type) + '</select></div>' +
'<div class="field"><label>建账余额 (¥)</label>' +
'<input type="number" id="ed-balance" step="0.01" value="' +
(privacyOn ? '' : a.initial_balance) + '"' +
(privacyOn ? ' placeholder="留空表示不修改（当前金额已隐藏）"' : '') + '></div>' +
'<div class="field"><label>余额日期</label>' +
'<input type="date" id="ed-date" value="' + esc(a.initial_date || today()) + '"></div>' +
'<div class="field"><label>备注 (可选)</label>' +
'<input id="ed-note" maxlength="60" value="' + esc(a.note) + '"></div>' +
'<span class="muted" style="font-size:11.5px;line-height:1.7">' +
'活期与银行卡是两个独立分类，各自单独核算；银行理财单独汇总，不并入任何可用余额。</span>',
async function(){
var name = document.getElementById('ed-name').value.trim();
if (!name){ alert('请填写账户名称'); return false; }
var typ = document.getElementById('ed-type').value;
var rawBal = String(document.getElementById('ed-balance').value).trim();
var payload = {
name: name, type: typ,
initial_date: document.getElementById('ed-date').value,
note: document.getElementById('ed-note').value.trim()
};
if (rawBal !== '') payload.initial_balance = +rawBal;
try {
await api('/api/accounts/' + aid, {method:'PUT', body: payload});
await reload();
alert.success('账户已更新。');
} catch(e){
alert.error(e.message || '保存失败');
return false;
}
});
}
function openRevalueModal(aid){
var a = accountById(aid); if (!a) return;
var bal = currentBalances()[aid] || 0;
var isCash = kindOf(a) === 'cash';
openModal('更新余额 · ' + a.name,
'<div class="field"><label>系统当前余额</label>' +
'<div style="font-size:20px;font-weight:600;font-variant-numeric:tabular-nums">' + money(bal) + '</div></div>' +
'<div class="field"><label>实际余额 / 最新市值 (¥)</label>' +
'<input type="number" id="rv-value" step="0.01" value="' +
(privacyOn ? '' : bal.toFixed(2)) + '"' +
(privacyOn ? ' placeholder="请输入实际金额（当前金额已隐藏）"' : '') + '></div>' +
'<div class="field"><label>日期</label><input type="date" id="rv-date" max="' + today() + '" value="' + today() + '"></div>' +
'<span class="muted" style="font-size:11.5px">' +
(isCash
? '只需在余额对不上时用（比如漏记了一笔）。系统会把差额记成「余额调整」，不影响收支统计。'
: '股票、基金这类账户，市值不由收支决定，每月填一次最新市值即可，差额会记为盈亏。') +
'</span>',
async function(){
var rawRv = String(document.getElementById('rv-value').value).trim();
if (rawRv === ''){ alert('请填写实际余额'); return false; }
var v = +rawRv;
if (isNaN(v)){ alert('请填写有效金额'); return false; }
var r = await api('/api/revalue', {method:'POST', body:{
account_id: aid,
date: document.getElementById('rv-date').value,
value: v
}});
await reload();
if (!r.changed) alert('余额没有变化，无需调整。');
});
}
function openTransferModal(fromId){
if (db.accounts.length < 2){ alert('至少需要两个账户才能转账。'); return; }
var opts = db.accounts.filter(function(a){ return a.id !== fromId; })
.map(function(a){ return '<option value="' + a.id + '">' + esc(a.name) + '</option>'; }).join('');
var fromName = accountById(fromId) ? accountById(fromId).name : '';
openModal('账户间转账',
'<div class="field"><label>从</label><div style="font-weight:600">' + esc(fromName) + '</div></div>' +
'<div class="field"><label>转到</label><select id="tr-to">' + opts + '</select></div>' +
'<div class="field"><label>金额 (¥)</label><input type="number" id="tr-amt" step="0.01" min="0.01" required></div>' +
'<div class="field"><label>日期</label><input type="date" id="tr-date" value="' + today() + '"></div>' +
'<div class="field"><label>备注 (可选)</label><input id="tr-note" maxlength="60"></div>' +
'<span class="muted" style="font-size:11.5px">转账不算收入也不算支出，只改变两个账户的余额。</span>',
async function(){
var amt = +document.getElementById('tr-amt').value;
if (!(amt > 0)){ alert('请填写有效金额'); return false; }
await api('/api/transactions', {method:'POST', body:{
date: document.getElementById('tr-date').value,
type: 'transfer',
account_id: fromId,
to_account_id: document.getElementById('tr-to').value,
amount: amt,
note: document.getElementById('tr-note').value.trim()
}});
await reload();
});
}
async function delAccount(id){
var a = accountById(id); if (!a) return;
var txs = db.transactions.filter(function(t){
return t.accountId === id || t.toAccountId === id;
});
var body;
if (!txs.length){
body = '<div class="muted">这个账户还没有任何流水记录，删除后不影响其他账户。</div>';
} else {
var exp = 0, inc = 0, minD = '', maxD = '';
txs.forEach(function(t){
if (!minD || t.date < minD) minD = t.date;
if (!maxD || t.date > maxD) maxD = t.date;
if (t.type === 'expense') exp += t.amount;
else if (t.type === 'income') inc += t.amount;
});
body = '<div class="muted">删除「' + esc(a.name) + '」会一并删除：</div>' +
'<div style="font-size:17px;font-weight:600">' + txs.length + ' 笔流水</div>' +
'<div class="muted">时间范围 ' + minD + ' 至 ' + maxD + '</div>';
if (exp || inc){
body += '<div class="muted">累计支出 ' + money(exp) + '，累计收入 ' + money(inc) + '</div>';
}
body += '<div class="note">此操作不可撤销。建议先导出一份备份再删。</div>' +
'<button class="btn btn-sm" type="button" style="align-self:flex-start" ' +
'onclick="exportJSON()">先导出备份</button>';
}
openModal('删除账户', body, async function(){
try {
await api('/api/accounts/' + id, {method:'DELETE'});
await reload();
} catch(e){
alert.error(e.message);
return false;
}
}, txs.length ? '仍然删除' : '删除', false, 'btn-danger');
}
;
/* ================= 交互：备份 ================= */
function download(name, text, type){
var blob = new Blob([text], {type: type || 'application/json;charset=utf-8'});
var url = URL.createObjectURL(blob);
var a = document.createElement('a');
a.href = url; a.download = name;
document.body.appendChild(a); a.click();
setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 100);
}
/* 分享优先：iOS/安卓上直接调起系统分享面板，「存到文件」「发给自己」一步完成；
不支持或出错时退回原来的下载方式。 */
function shareOrDownload(name, text, mime){
mime = mime || 'application/json';
function fallback(){
download(name, text, mime + ';charset=utf-8');
markBackedUp();
renderBackupBar();
}
try {
var file = new File([text], name, {type: mime});
/* 只在触屏设备上用分享面板；桌面端保持「下载」这个预期行为 */
var touchFirst = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
if (touchFirst && navigator.canShare && navigator.canShare({files: [file]})){
navigator.share({files: [file], title: '记账备份'}).then(function(){
markBackedUp();
renderBackupBar();
}).catch(function(err){
/* 用户点了取消不算失败，也不要再弹下载框骚扰 */
if (err && err.name === 'AbortError') return;
fallback();
});
return;
}
} catch(e){ /* 老浏览器没有 File 构造器，走下载 */ }
fallback();
}
function exportJSON(){
var payload = {version: 5, exported_at: new Date().toISOString(),
data: {accounts: db.accounts, transactions: db.transactions,
dca: db.dca, fixed: db.fixed, skips: db.skips || []}};
shareOrDownload('记账备份-' + today() + '.json', JSON.stringify(payload, null, 2));
}
/* ================= 交互：备份提醒 ================= */
var BK_AT = 'jz_backup_at', BK_TX = 'jz_backup_tx', BK_SNOOZE = 'jz_backup_snooze';
function lsGet(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
function lsSet(k, v){
try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, String(v)); } catch(e){}
}
function daysBetween(fromIso, toIso){
if (!fromIso || !toIso) return null;
var a = new Date(fromIso + 'T00:00:00'), b = new Date(toIso + 'T00:00:00');
if (isNaN(a) || isNaN(b)) return null;
return Math.round((b - a) / 86400000);
}
/* 返回触发提醒的原因；不需要提醒时返回 null */
function backupDue(){
if (!db.accounts.length) return null;
var snooze = lsGet(BK_SNOOZE);
/* 注意：null < 3 在 JS 里为真，必须先判空，否则永远不提醒 */
if (snooze && daysBetween(snooze, today()) < 3) return null;
var last = lsGet(BK_AT);
var added = Math.max(0, db.transactions.length - (+lsGet(BK_TX) || 0));
if (!last) return {reason: 'never', days: null, added: db.transactions.length};
var days = daysBetween(last, today());
if (days >= 7) return {reason: 'days', days: days, added: added};
if (added >= 20) return {reason: 'count', days: days, added: added};
return null;
}
function markBackedUp(){
lsSet(BK_AT, today());
lsSet(BK_TX, db.transactions.length);
lsSet(BK_SNOOZE, null);
}
function snoozeBackup(){
lsSet(BK_SNOOZE, today());
renderBackupBar();
}
function renderBackupBar(){
var el = document.getElementById('bk-bar');
if (!el) return;
var due = backupDue();
if (!due){ el.style.display = 'none'; el.innerHTML = ''; return; }
var txt;
if (due.reason === 'never'){
txt = '还没导出过备份。账目只存在这台设备上，换手机或误删就找不回来了。';
} else if (due.reason === 'days'){
txt = '距上次备份 ' + due.days + ' 天，期间新增 ' + due.added + ' 笔。';
} else {
txt = '上次备份后又记了 ' + due.added + ' 笔，建议导出一份。';
}
el.innerHTML = '<span class="bk-txt">' + esc(txt) + '</span>' +
'<span class="bk-act">' +
'<button class="btn btn-sm btn-primary" type="button" onclick="exportJSON()">立即备份</button>' +
'<button class="btn btn-sm" type="button" onclick="snoozeBackup()">稍后</button>' +
'</span>';
el.style.display = '';
}
function exportCSV(kind){
var rows = [];
if (kind === 'transactions'){
rows.push(['日期','类型','账户','转入账户','分类','金额','备注']);
/* 明细里显示什么就导出什么（定投转账 + 固定支出），否则导出与界面对不上 */
db.transactions.concat(db.autoTx).forEach(function(t){
var a = accountById(t.accountId), b = accountById(t.toAccountId);
rows.push([t.date,
{expense:'支出', income:'收入', transfer:'转账', adjust:'余额调整'}[t.type] || t.type,
a ? a.name : '', b ? b.name : '', t.category, t.amount,
t.note + (t.auto ? ' [规则自动生成]' : '')]);
});
} else {
var bal = currentBalances();
rows.push(['账户','类型','建账余额','建账日期','当前余额','备注']);
db.accounts.forEach(function(a){
rows.push([a.name, TYPE_META[a.type].label,
a.initial_balance, a.initial_date, bal[a.id] || 0, a.note]);
});
}
var csv = rows.map(function(r){
return r.map(function(c){
var s = String(c == null ? '' : c);
return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}).join(',');
}).join('\n');
download('记账-' + kind + '-' + today() + '.csv', '\ufeff' + csv, 'text/csv;charset=utf-8');
}
function importJSON(){
document.getElementById('import-file').click();
}
function doImportJSON(ev){
var file = ev.target.files[0];
ev.target.value = '';
if (!file) return;
var reader = new FileReader();
reader.onload = async function(){
try {
var d = JSON.parse(reader.result);
var data = d.data || d;
if (!data || !Array.isArray(data.accounts)) throw new Error('格式不符');
if (!confirm('导入将覆盖当前全部数据，确定继续？')) return;
var res = await api('/api/import', {method:'POST', body: data});
await reload();
alert('导入完成：' + res.accounts + ' 个账户、' + res.transactions + ' 条流水。');
} catch(e){
alert('导入失败：' + (e.message || '不是有效的备份文件'));
}
};
reader.readAsText(file);
}
async function clearAll(){
if (!confirm('确定清空全部数据？建议先导出备份。')) return;
if (!confirm('再次确认：所有账户和流水都将从数据库删除，不可恢复。')) return;
try {
await api('/api/clear', {method:'POST', body:{}});
await reload();
} catch(e){ alert('清空失败：' + e.message); }
}
async function loadDemo(){
if (!confirm('载入示例数据将覆盖数据库中的现有全部数据，确定？')) return;
var now = new Date();
function pad(n){ return String(n).padStart(2,'0'); }
function ds(offsetMonths, day){
var base = new Date(now.getFullYear(), now.getMonth() - offsetMonths, 1);
var lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
var dd = Math.min(day, lastDay);
if (offsetMonths === 0){
dd = Math.max(1, Math.min(dd, Math.round(day / lastDay * now.getDate())));
}
return base.getFullYear() + '-' + pad(base.getMonth() + 1) + '-' + pad(dd);
}
var accounts = [
{id:'d1', name:'招行工资卡', type:'deposit', initial_balance:18000, initial_date:ds(6,1)},
{id:'d2', name:'日常备用金', type:'deposit', initial_balance:4000, initial_date:ds(6,1)},
{id:'d3', name:'指数基金定投', type:'fund', initial_balance:30000, initial_date:ds(6,1)},
{id:'d4', name:'装修贷款', type:'liability', initial_balance:45000, initial_date:ds(6,1)}
];
var txs = [];
var n = 0;
function add(date, type, acc, cat, amt, note, to){
txs.push({id:'seed' + (++n), date:date, type:type, accountId:acc,
toAccountId:to || '', category:cat || '', amount:amt, note:note || ''});
}
for (var i = 5; i >= 0; i--){
add(ds(i,5), 'income', 'd1', '工资', 15000 + (i*120), '月薪');
add(ds(i,10), 'expense', 'd1', '居住', 2600, '房租');
add(ds(i,12), 'transfer', 'd1', '', 2000, '定投', 'd3');
add(ds(i,20), 'expense', 'd1', '购物', 300 + i*40, '日用品');
if (i % 2 === 0) add(ds(i,25), 'expense', 'd4', '其他', 1500, '还贷');
for (var k = 1; k <= 12; k++){
add(ds(i, Math.min(k*2, 27)), 'expense', 'd2', k % 3 === 0 ? '交通' : '餐饮', 25 + (k*7)%60, '');
}
if (i % 2 === 1) add(ds(i,18), 'expense', 'd1', '娱乐', 180, '电影');
}
add(ds(0,26), 'adjust', 'd3', '', 860, '市值变动');
try {
var res = await api('/api/import', {method:'POST', body:{accounts:accounts, transactions:txs}});
await reload();
document.querySelector('#nav button[data-tab="overview"]').click();
alert('示例数据已载入：' + res.accounts + ' 个账户、' + res.transactions + ' 条流水，覆盖近 6 个月。');
} catch(e){
alert('载入失败：' + e.message);
}
}
;
var ACTIONS = {
'acct-edit': openEditAccountModal,
'acct-revalue': openRevalueModal,
'acct-transfer': openTransferModal,
'acct-delete': delAccount,
'tx-edit': openTxModal,
'tx-delete': delTx,
'fixed-add': function(){ openFixedModal(); },
'fixed-edit': openFixedModal,
'fixed-toggle': toggleFixed,
'fixed-del': removeFixed,
'auto-delete': function(id, el){
return delAutoTx(id, el ? el.getAttribute('data-date') : '');
},
'led-more': ledMore,
'led-clear': ledClearFilters
};
function runAction(el){
var fn = ACTIONS[el.getAttribute('data-act')];
if (!fn) return;
var id = el.getAttribute('data-id');
var r = fn(id, el);
if (r && r.catch) r.catch(function(e){ alert.error((e && e.message) || '操作失败'); });
}
document.addEventListener('click', function(e){
var el = e.target.closest('[data-act]');
if (el) runAction(el);
});
document.addEventListener('keydown', function(e){
if (e.key !== 'Enter' && e.key !== ' ') return;
var el = e.target.closest('[data-act]');
if (!el || el.tagName === 'BUTTON') return;
e.preventDefault();
runAction(el);
});
document.getElementById('nav').addEventListener('click', function(e){
var btn = e.target.closest('button[data-tab]');
if (!btn) return;
activeTab = btn.dataset.tab;
Array.prototype.forEach.call(this.querySelectorAll('button'), function(b){
b.classList.toggle('active', b === btn);
});
Array.prototype.forEach.call(document.querySelectorAll('section.tab'), function(s){
s.classList.toggle('show', s.id === 'tab-' + activeTab);
});
stopSalary();
renderCurrent();
});
document.addEventListener('change', function(e){
var id = (e.target && e.target.id) || '';
if (!/^sal-(monthly|days|days-mode|start|end|lunch-start|lunch-min|today)$/.test(id)) return;
salOnSettingChange();
});
document.getElementById('tx-kind').addEventListener('click', function(e){
var btn = e.target.closest('button[data-type]');
if (btn) setTxType(btn.dataset.type);
});
document.getElementById('tx-form').addEventListener('submit', submitTx);
document.getElementById('tx-amount').addEventListener('input', updateTxHint);
document.getElementById('tx-acct').addEventListener('change', updateTxHint);
document.getElementById('tx-to').addEventListener('change', updateTxHint);
document.getElementById('led-month').addEventListener('change', renderLedger);
['input', 'change'].forEach(function(type){
document.addEventListener(type, function(e){
var t = e.target;
if (!t || !t.closest || !t.closest('#led-filter')) return;
ledOnFilter(e);
});
});
document.getElementById('ana-period').addEventListener('change', renderAnalysis);
cpInit();
(async function boot(){
var errBox = document.getElementById('boot-error');
buildNav();
TABS.forEach(function(t){
if (!document.getElementById('tab-' + t.id)){
console.warn('缺少页签容器：section#tab-' + t.id);
}
});
updatePrivacyBtn();
document.getElementById('tx-date').value = today();
document.getElementById('led-month').value = thisMonth();
setTxType('expense');
if (typeof Chart !== 'undefined'){
Chart.defaults.font.family = '-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
Chart.defaults.color = 'rgba(60,60,67,.6)';
Chart.defaults.font.size = 11;
}
if (location.protocol === 'file:'){
errBox.style.display = '';
errBox.textContent = '请通过本地服务打开：双击 D:\\记账\\启动记账.bat，浏览器会自动打开 http://127.0.0.1:8765';
return;
}
try {
await reload();
} catch(e){
errBox.style.display = '';
errBox.textContent = '数据未能加载：' + e.message + '（本地数据加载失败，请确认浏览器未处于无痕模式，或换用 Safari）';
return;
}
try {
var legacy = localStorage.getItem(LS_KEY);
if (legacy && !db.accounts.length){
var old = JSON.parse(legacy);
if (old && old.accounts && old.accounts.length){
if (confirm('检测到浏览器里还有一份旧版数据（' + old.accounts.length + ' 个账户、' +
(old.expenses || []).length + ' 笔开销）。\n是否迁移到新的数据库？迁移后会清除浏览器里的旧副本。')){
await api('/api/import', {method:'POST', body: old});
localStorage.removeItem(LS_KEY);
await reload();
alert('迁移完成：' + db.accounts.length + ' 个账户、' + db.transactions.length + ' 条流水。');
}
}
}
} catch(e){}
})();