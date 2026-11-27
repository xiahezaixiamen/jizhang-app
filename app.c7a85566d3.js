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
var TAB_ICONS = {
overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h12v3"/><path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-1z"/><circle cx="16.5" cy="13.5" r="1.2"/></svg>',
ledger:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h11l3 3v13H5z"/><path d="M8 11h8M8 15h8"/></svg>',
analysis: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>',
salary:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg>',
data:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/></svg>'
};
function buildNav(){
var nav = document.getElementById('nav');
if (!nav) return;
nav.innerHTML = TABS.map(function(t){
return '<button data-tab="' + t.id + '"' +
(t.id === activeTab ? ' class="active"' : '') + '>' + (TAB_ICONS[t.id] || '') +
'<span>' + t.label + '</span></button>';
}).join('');
}
var AUTO_KIND = {DCA:'dca', FIXED:'fixed'};
function autoTxOf(kind){
return db.autoTx.filter(function(t){ return t.autoKind === kind; });
}
var EX_CATS = ['餐饮','交通','购物','居住','娱乐','医疗','教育','通讯','人情','其他'];
var IN_CATS = ['工资','奖金','投资收益','红包','报销','其他'];
var CAT_COLORS = ['#0071e3','#ff9500','#ff3b30','#30b0c7','#5856d6','#af52de','#ff2d55','#34c759','#ffcc00','#8e8e93'];
var TYPE_COLORS_DARK = {
deposit:'#5f8fb8', bank:'#468f68', bankwealth:'#b09a5c', fixed:'#4d8a96',
stock:'#b2625c', fund:'#b3814f', other:'#74719e', liability:'#9068a8'
};
var CAT_COLORS_DARK = ['#5f8fb8','#b3814f','#b2625c','#4d8a96','#74719e','#9068a8',
'#b0668a','#468f68','#b09a5c','#8a92a0'];
function typeColor(t){
var m = TYPE_META[t] || TYPE_META.other;
return isDarkTheme() ? (TYPE_COLORS_DARK[t] || m.color) : m.color;
}
function catColor(cat){
var i = EX_CATS.indexOf(cat);
if (i < 0) i = EX_CATS.length - 1;
return isDarkTheme() ? CAT_COLORS_DARK[i] : CAT_COLORS[i];
}
function lineFill(){
return function(ctx){
var chart = ctx.chart, area = chart.chartArea, c = chart.ctx;
var top = cssv('--primary-weak', 'rgba(0,102,204,.18)');
if (!area || !c) return top;
var g = c.createLinearGradient(0, area.top, 0, area.bottom);
g.addColorStop(0, top);
g.addColorStop(0.55, 'rgba(0,0,0,0)');
g.addColorStop(1, 'rgba(0,0,0,0)');
return g;
};
}
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
/* ================= 报销标记与统计总开关 =================
reimbursable 是流水本身的属性，随数据落库、导出、备份一起走；
excludeReimb 只是本地显示口径：打开时被标记「公司报销」的流水不进入任何收支统计，
关闭时全部照常计入。余额、账户资产、净资产曲线始终按真实流水算，不受开关影响。 */
var REIMB_KEY = 'jz_exclude_reimb';
var excludeReimb = false;
try { excludeReimb = localStorage.getItem(REIMB_KEY) === '1'; } catch(e){}
function invalidateStats(){ _cache.statTx = null; _cache.months = null; }
function setExcludeReimb(v){
excludeReimb = !!v;
try { localStorage.setItem(REIMB_KEY, excludeReimb ? '1' : '0'); } catch(e){}
invalidateStats();
renderAll();
}
/* 统计口径的流水：月度收支、花销洞察、自定义周期都走这里，一处收口 */
function statTx(){
var c = cache();
if (!c.statTx){
var list = allTx();
c.statTx = excludeReimb
? list.filter(function(t){ return !t.reimbursable; })
: list;
}
return c.statTx;
}
function updateReimbBar(){
var box = document.getElementById('reimb-toggle');
var info = document.getElementById('reimb-info');
var bar = document.getElementById('reimb-bar');
var viewBtn = document.getElementById('reimb-view');
if (box) box.checked = excludeReimb;
if (!info) return;
var m = thisMonth(), n = 0, sum = 0;
allTx().forEach(function(t){
if (t.reimbursable && t.type === 'expense' &&
monthKey(t.date) === m && t.date <= today()){ n++; sum += t.amount; }
});
/* 没有可剔的就不占位置：开关开着时仍显示，好让用户能关掉 */
if (bar) bar.style.display = (n || excludeReimb) ? '' : 'none';
if (viewBtn) viewBtn.style.display = n ? '' : 'none';
if (!n){
info.textContent = excludeReimb ? '本月暂无报销标记 · 开关已开启' : '';
return;
}
info.textContent = '本月 ' + n + ' 笔 ' + money(sum) +
(excludeReimb ? ' · 已从统计中剔除' : ' · 当前全部计入统计');
}
var _cache = {db:null, txAll:null, statTx:null, balances:null, months:null, series:null, size:null};
function cache(){
if (_cache.db !== db){
_cache = {db:db, txAll:null, statTx:null, balances:null, months:null, series:null, size:null};
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
总开关打开时，被标记「公司报销」的流水在这里被整体剔除（含分类构成）。
未来日期的记录尚未生效，与余额、周期统计保持同一口径，这里统一排除。 */
statTx().forEach(function(t){
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
/* ================= 主题：浅色 / 暗色玻璃 =================
配色全部挂在 CSS 变量上，这里只切 html[data-theme]，再让图表重新读一遍颜色。
默认浅色；用户切过就记在本地，下次由 head 里的内联脚本在首帧前恢复。 */
var THEME_KEY = 'jz_theme';
function cssv(name, fallback){
try {
var v = getComputedStyle(document.documentElement).getPropertyValue(name);
v = (v || '').trim();
return v || fallback;
} catch(e){ return fallback; }
}
function isDarkTheme(){
return document.documentElement.getAttribute('data-theme') === 'dark';
}
function updateThemeBtn(){
var btn = document.getElementById('theme-btn');
if (!btn) return;
var label = isDarkTheme() ? '切换浅色主题' : '切换深色主题';
btn.setAttribute('aria-label', label);
btn.title = label;
btn.setAttribute('aria-pressed', String(isDarkTheme()));
}
function applyChartDefaults(){
if (typeof Chart === 'undefined') return;
Chart.defaults.color = cssv('--ink-soft', 'rgba(60,60,67,.7)');
Chart.defaults.borderColor = cssv('--grid-line', 'rgba(0,0,0,.06)');
}
function applyTheme(t, save){
var root = document.documentElement;
if (t === 'dark') root.setAttribute('data-theme', 'dark');
else root.removeAttribute('data-theme');
if (save){ try { localStorage.setItem(THEME_KEY, t); } catch(e){} }
/* 手机版 PWA 的状态栏颜色跟着走，否则暗色界面顶着一条白边 */
var meta = document.querySelector ? document.querySelector('meta[name="theme-color"]') : null;
if (meta) meta.setAttribute('content', t === 'dark' ? '#0b1322' : '#f5f5f7');
updateThemeBtn();
applyChartDefaults();
}
function currentTheme(){
/* 主题模式（跟随系统 / 浅色 / 深色）由 10-features.js 解析 */
if (typeof resolveTheme === 'function') return resolveTheme();
try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; }
catch(e){ return 'light'; }
}
function toggleTheme(){
var next = isDarkTheme() ? 'light' : 'dark';
applyTheme(next, true);
/* 顶栏手动切换 = 明确指定，退出「跟随系统」 */
try { localStorage.setItem('jz_theme_mode', next); } catch(e){}
if (typeof renderThemeSeg === 'function') renderThemeSeg();
if (typeof renderAll === 'function') renderAll();
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
/* 洞察区只在资产页渲染。人在别的页签切换隐私时，隐藏 section 里会留着上一次的
金额文本；直接清空即可，不必重跑整套统计（切回资产页时会重新渲染）。 */
if (activeTab !== 'overview'){
var g = document.getElementById('insight-grid');
if (g) g.innerHTML = '';
}
if (wasHidden && !privacyOn) rollMetrics();
}
document.getElementById('privacy-btn').addEventListener('click', togglePrivacy);
document.getElementById('theme-btn').addEventListener('click', toggleTheme);
/* ================= 通用提示与确认弹窗 ================= */
var ALERT_SVG = {
info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9.2"/><path d="M12 11.2v5"/><path d="M12 7.6h.01"/></svg>',
success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.2"/><path d="M7.8 12.3l2.8 2.8 5.6-5.8"/></svg>',
error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9.2"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
warn:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.8L2.8 19.5a1.2 1.2 0 0 0 1 1.8h16.4a1.2 1.2 0 0 0 1-1.8L12 3.8z"/><path d="M12 9.5v4.8"/><path d="M12 17.5h.01"/></svg>'
};
var alertOpen = false, alertLastFocus = null, alertResolve = null;
var _nativeConfirm = (typeof confirm === 'function') ? confirm : null;
function alertKind(msg, opt){
if (opt && opt.kind) return opt.kind;
if (/失败|错误|异常|无法|不可恢复/.test(msg)) return 'error';
if (/成功|已完成|完成：|已载入|已写入|已迁移/.test(msg)) return 'success';
return 'info';
}
function showAlert(msg, opt){
opt = opt || {};
/* 若上一个确认框尚未结算，先按取消收尾，避免悬挂的 Promise */
if (alertResolve){ var prevR = alertResolve; alertResolve = null; prevR(false); }
var text = String(msg == null ? '' : msg);
var kind = alertKind(text, opt);
alertLastFocus = document.activeElement;
document.getElementById('alert-text').textContent = text;
document.getElementById('alert-title').textContent = opt.title ||
(kind === 'error' ? '操作失败' : kind === 'success' ? '已完成' : kind === 'warn' ? '请确认' : '提示');
var ic = document.getElementById('alert-icon');
ic.className = 'alert-icon ' + kind;
ic.innerHTML = ALERT_SVG[kind] || ALERT_SVG.info;
var cancelBtn = document.getElementById('alert-cancel');
if (cancelBtn){
cancelBtn.style.display = opt.confirm ? '' : 'none';
cancelBtn.textContent = opt.cancelLabel || '取消';
}
var okBtn = document.getElementById('alert-ok');
if (okBtn){
okBtn.textContent = opt.okLabel || '确定';
okBtn.className = 'btn ' + (opt.danger ? 'btn-danger' : 'btn-primary') + ' alert-ok';
}
document.getElementById('alert-mask').classList.add('show');
alertOpen = true;
setTimeout(function(){
var box = document.querySelector('#alert-mask .alert-box');
if (box && box.focus){ try { box.focus({preventScroll:true}); } catch(e){ box.focus(); } }
}, 30);
}
function closeAlert(result){
if (!alertOpen) return;
alertOpen = false;
document.getElementById('alert-mask').classList.remove('show');
var res = alertResolve; alertResolve = null;
var prev = alertLastFocus; alertLastFocus = null;
if (prev && prev.focus){ try { prev.focus({preventScroll:true}); } catch(e){ try { prev.focus(); } catch(_){} } }
if (res) res(!!result);
}
/* 异步确认框：替代浏览器原生 window.confirm，适配全屏 PWA 与深色玻璃主题。
若测试环境显式桩了全局 confirm，则直接走测试桩以便同步断言。 */
function askConfirm(msg, opt){
if (typeof confirm === 'function' && confirm !== _nativeConfirm && !(opt && opt.forceUI)){
return Promise.resolve(!!confirm(msg));
}
opt = Object.assign({
confirm: true,
kind: (opt && opt.danger) ? 'error' : 'warn',
title: '请确认',
okLabel: '确定',
cancelLabel: '取消'
}, opt || {});
return new Promise(function(resolve){
showAlert(msg, opt);
alertResolve = resolve;
});
}
document.getElementById('alert-ok').addEventListener('click', function(){ closeAlert(true); });
(function(){
var c = document.getElementById('alert-cancel');
if (c && c.addEventListener) c.addEventListener('click', function(){ closeAlert(false); });
var m = document.getElementById('alert-mask');
if (m && m.addEventListener) m.addEventListener('click', function(e){
if (e.target === m) closeAlert(false);
});
})();
document.addEventListener('keydown', function(e){
if (!alertOpen) return;
if (e.key === 'Escape'){
e.preventDefault(); e.stopPropagation(); closeAlert(false);
} else if (e.key === 'Enter' || (!alertResolve && e.key === ' ')){
e.preventDefault(); e.stopPropagation(); closeAlert(true);
}
}, true);
/* 提示类型不再靠中文文案正则去猜：成功/失败由调用点显式声明。
alertKind() 里的正则只作为兜底，留给「请填写金额」这类中性校验提示。 */
window.alert = function(msg){ showAlert(msg); };
window.alert.error = function(msg){ showAlert(msg, {kind:'error'}); };
window.alert.success = function(msg){ showAlert(msg, {kind:'success'}); };
/* 首屏占位（手机版 build 时注入）：数据与界面都画完后移除。
桌面版没有这个元素，这里判空直接跳过，不影响任何逻辑。 */
function hideSplash(){
var el = document.getElementById('boot-splash');
if (el && el.parentNode) el.parentNode.removeChild(el);
}
/* ================= 表单弹窗 ================= */
var modalOK = null, modalDel = null, modalReturn = null, modalFocus = null;
function syncModalViewport(){
var mask = document.getElementById('modal-mask');
if (!mask || !mask.style || !mask.style.setProperty) return;
var vv = typeof window !== 'undefined' && window.visualViewport;
if (!vv || !mask.classList.contains('show')){
mask.style.removeProperty('--kb-offset');
mask.style.removeProperty('--vv-height');
mask.classList.remove('kb-open');
return;
}
var kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
mask.style.setProperty('--kb-offset', kb + 'px');
mask.style.setProperty('--vv-height', Math.round(vv.height) + 'px');
mask.classList.toggle('kb-open', kb > 60);
}
(function(){
if (typeof window === 'undefined' || !window.visualViewport) return;
window.visualViewport.addEventListener('resize', syncModalViewport);
window.visualViewport.addEventListener('scroll', syncModalViewport);
var body = document.getElementById('modal-body');
if (body && body.addEventListener){
body.addEventListener('focusin', function(e){
var t = e.target;
if (!t || !t.scrollIntoView) return;
setTimeout(function(){
syncModalViewport();
try { t.scrollIntoView({block:'nearest', behavior:'smooth'}); } catch(err){}
}, 120);
});
}
})();
function openModal(title, bodyHTML, onOK, okLabel, hideCancel, okClass){
var mask = document.getElementById('modal-mask');
/* 只在最外层记录来源焦点：从整月明细点进编辑时不会再覆盖它，
最终关闭时才能回到当初点开的那个按钮。 */
if (!modalFocus) modalFocus = document.activeElement;
document.getElementById('modal-title').textContent = title;
var box = document.getElementById('modal-body');
box.innerHTML = bodyHTML;
/* 正文容器是全站复用的：从滚到底的整月弹窗点进编辑时，
不归零会让日期、金额落在可视区之外，看着像个空表单。 */
box.scrollTop = 0;
modalOK = onOK;
modalDel = null;
/* 每次打开都是新的一层：清掉上一层的「关闭后返回」动作与单日弹窗标记。
调用方若要「关闭后回到原弹窗」，在 openModal 之后再设置 modalReturn。 */
modalReturn = null;
delete mask.dataset.day;
delete mask.dataset.month;
var delBtn = document.getElementById('modal-del');
if (delBtn) delBtn.style.display = 'none';
var okBtn = document.getElementById('modal-ok');
okBtn.textContent = okLabel || '保存';
okBtn.className = 'btn ' + (okClass || 'btn-primary');
var cancel = document.getElementById('modal-cancel');
if (cancel) cancel.style.display = hideCancel ? 'none' : '';
hideUndo();
mask.classList.add('show');
syncModalViewport();
/* 遮罩外的页面不再跟着滚：移动端到底后手指一划，弹窗还在、人已经跑别处了 */
document.documentElement.classList.add('modal-open');
/* 焦点移进弹窗，读屏才会朗读 role="dialog" 与标题（aria-labelledby）；
必须带 preventScroll，否则移动端底部抽屉入场时会被浏览器往上顶一段再回弹 */
var dlg = mask.querySelector ? mask.querySelector('.modal') : null;
if (dlg && dlg.focus){ try { dlg.focus({preventScroll:true}); } catch(e){ dlg.focus(); } }
}
function setModalDelete(label, onDel){
modalDel = onDel;
var delBtn = document.getElementById('modal-del');
if (!delBtn) return;
delBtn.textContent = label || '删除';
delBtn.style.display = onDel ? '' : 'none';
}
function closeModal(){
var mask = document.getElementById('modal-mask');
mask.classList.remove('show');
syncModalViewport();
document.documentElement.classList.remove('modal-open');
delete mask.dataset.day;
delete mask.dataset.month;
modalOK = null;
modalDel = null;
var delBtn = document.getElementById('modal-del');
if (delBtn) delBtn.style.display = 'none';
/* 编辑弹窗由单日弹窗点进来：保存 / 取消 / 删除 / Esc / 点遮罩都会回到当日弹窗，
且只用一次，避免第二次关闭时又弹回来。 */
var back = modalReturn;
modalReturn = null;
if (back){ back(); return; }
/* 焦点还给打开它的那个按钮：键盘用户关掉弹窗后不会掉到页面顶部 */
var prev = modalFocus;
modalFocus = null;
if (prev && prev.focus){ try { prev.focus({preventScroll:true}); } catch(e){ prev.focus(); } }
}
(function(){
var delBtn = document.getElementById('modal-del');
if (delBtn && delBtn.addEventListener){
delBtn.addEventListener('click', async function(){
var fn = modalDel;
if (!fn) return;
/* 先关闭编辑弹窗（若有 modalReturn 则恢复单日/整月弹窗），再执行删除与 showUndo，
避免返回弹窗的 openModal 把刚弹出的撤销提示条清掉。 */
closeModal();
try { await fn(); } catch(e){ alert.error((e && e.message) || '删除失败'); }
});
}
})();
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
category: t.category || '', amount: +t.amount || 0, note: t.note || '',
reimbursable: !!t.reimbursable
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
enabled: v.enabled !== false, reimbursable: !!v.reimbursable
};
});
/* autoTx 含两类：dca=transfer（净资产不变）、fixed=expense（净资产减少） */
var autoTx = (d.autoTransactions || []).map(function(t){
return {
date: t.date, type: t.type || 'transfer',
accountId: t.accountId || '', toAccountId: t.toAccountId || '',
category: t.category || '', amount: +t.amount || 0,
note: t.note || '', auto: true, autoKind: t.autoKind || AUTO_KIND.DCA,
ruleId: t.ruleId || '', reimbursable: !!t.reimbursable
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
/* 单日 / 整月明细弹窗里的记录被编辑/删除/撤销后，数据变了但弹窗 DOM 还是旧的。
就地刷新一次弹窗内容（不重开弹窗，撤销提示才不会被 hideUndo 清掉）。 */
if (typeof ledRefreshPopup === 'function') ledRefreshPopup();
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
/* 图表颜色跟着主题走：每次重绘都重新读一次 CSS 变量，切主题后重画即生效 */
var ink = cssv('--ink-soft', 'rgba(60,60,67,.7)');
var gridLine = cssv('--grid-line', 'rgba(0,0,0,.06)');
var tip = cssv('--tooltip', 'rgba(0,0,0,.82)');
var catAxis = {grid:{display:false}, ticks:{font:{size:11}, color:ink}, border:{display:false}};
var numAxis = {grid:{color:gridLine}, border:{display:false},
ticks:{font:{size:11}, color:ink,
callback:function(v){ return privacyOn ? '' : (Math.abs(v)>=10000 ? (v/10000)+'万' : v); }}};
var timeAxis = {grid:{display:false}, border:{display:false},
ticks:{font:{size:11}, color:ink, maxTicksLimit:8, autoSkip:true, maxRotation:0}};
var o = {
responsive: true,
maintainAspectRatio: false,
interaction: {mode:'index', intersect:false},
plugins: {
legend: {display:false},
tooltip: {
backgroundColor:tip, padding:10, cornerRadius:8,
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
return statTx().filter(function(t){
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
/* 三段时间窗共用一次 statTx 扫描，避免 spendIn 各过滤一遍全量流水。
口径与 spendIn 完全一致：只算已发生（<=今天）的支出。 */
var cur = [], prev = [], d30 = [], all = statTx(), curCatCount = {};
for (var i = 0; i < all.length; i++){
var tx = all[i];
if (tx.type !== 'expense' || tx.date > t0) continue;
if (tx.date >= curFrom){
cur.push(tx);
var ck = tx.category || '其他';
curCatCount[ck] = (curCatCount[ck] || 0) + 1;
}
if (tx.date >= prevFrom && tx.date <= prevTo) prev.push(tx);
if (tx.date >= d30From) d30.push(tx);
}
var curTotal = spendTotal(cur), prevTotal = spendTotal(prev);
var curMan = spendManual(cur), curAuto = spendAuto(cur);
var cats = spendByCat(cur), prevCats = spendByCat(prev);
/* 手动支出的分类 / 金额区间 / 星期分布只扫一遍，供「笔均 / 笔数 / 周末」三张卡复用 */
var manCat = {}, manBucket = [0, 0, 0, 0], manWeek = [0, 0, 0, 0, 0, 0, 0],
manWeekSum = [0, 0, 0, 0, 0, 0, 0], manTotal = 0, manMax = 0,
manWECount = 0, manWETotal = 0, manWDCount = 0, manWDTotal = 0;
curMan.forEach(function(t){
var a = t.amount || 0, k = t.category || '其他';
var c = manCat[k] || (manCat[k] = {count: 0, total: 0});
c.count++; c.total += a;
manBucket[a < 50 ? 0 : a < 100 ? 1 : a < 300 ? 2 : 3]++;
var w = new Date(t.date + 'T00:00:00').getDay();
manWeek[w]++; manWeekSum[w] += a;
manTotal += a;
if (a > manMax) manMax = a;
if (w === 0 || w === 6){ manWECount++; manWETotal += a; }
else { manWDCount++; manWDTotal += a; }
});
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
insCount(curCatCount[c.cat] || 0)];
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
['手动记录', money(manTotal), insCount(curMan.length),
insPct(curTotal>0 ? manTotal/curTotal*100 : 0)],
['合计', money(curTotal), insCount(cur.length), insPct(100)]
]) + '<div class="note">' + cfg + '</div>',
empty: none
});
/* 5 · 笔均支出（仅手动） */
var avg = curMan.length ? manTotal/curMan.length : 0;
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
['手动支出总额', money(manTotal)],
['笔均', money(avg)],
['中位数', money(med)],
['最大单笔', money(manMax)]
]) + insTable([{t:'金额区间'},{t:'笔数',num:true}],
buckets.map(function(b, bi){
return [insText(b[2]), insCount(manBucket[bi])];
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
out.push({
lab:'手动支出笔数',
val: curMan.length ? insCount(curMan.length) : insNA(),
foot: '本月至今 · 不含规则生成',
title:'手动支出笔数',
body: insHead('', '只数手动记录；规则自动支出按日历每天一笔，计入笔数会让它失去意义。') +
insTable([{t:'分类'},{t:'笔数',num:true},{t:'金额',num:true}],
Object.keys(manCat).sort(function(a,b){ return manCat[b].count-manCat[a].count; }).map(function(k){
return [insText(esc(k)), insCount(manCat[k].count), money(manCat[k].total)];
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
var avgWE = we > 0 ? manWETotal/we : 0;
var avgWD = wd > 0 ? manWDTotal/wd : 0;
var mult = avgWD > 0 ? avgWE/avgWD : null;
var weekNames = ['周日','周一','周二','周三','周四','周五','周六'];
var wdist = [];
for (var wi = 0; wi < 7; wi++){
wdist.push([insText(weekNames[wi]), insCount(manWeek[wi]), money(manWeekSum[wi])]);
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
['工作日', insText(wd + ' 天'), insCount(manWDCount), money(manWDTotal), money(avgWD)],
['周末', insText(we + ' 天'), insCount(manWECount), money(manWETotal), money(avgWE)]
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
renderInsights(); /* 洞察区属于资产页：只在看这一页时算 */
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
/* ---- 首屏：一个主数字（本月可花）+ 一张支出构成环图 ---- */
var heroVal = document.getElementById('ov-hero-val');
if (heroVal){
heroVal.className = 'ov-hero-val' + (dailySum < -0.005 ? ' red' : '');
heroVal.innerHTML = rollSpan(dailySum, moneyShort(dailySum));
}
var heroFoot = document.getElementById('ov-hero-foot');
if (heroFoot) heroFoot.textContent = dailyN
? '活期 + 银行卡余额 · ' + dailyN + ' 个账户'
: '还没有日常可用账户';
var expEl = document.getElementById('ov-hero-exp');
if (expEl) expEl.innerHTML = rollSpan(m.expense, moneyShort(m.expense));
var balEl = document.getElementById('ov-hero-bal');
if (balEl){
var pos = m.balance > 0.005, neg = m.balance < -0.005;
balEl.className = neg ? 'red' : (pos ? 'green' : '');
balEl.innerHTML = (neg ? '−' : (pos ? '+' : '')) +
rollSpan(Math.abs(m.balance), moneyShort(Math.abs(m.balance)));
}
/* 支出构成：与明细页同一个 monthStats.byCat 口径（含自动支出、排除报销） */
var cats = Object.keys(m.byCat || {}).sort(function(a,b){ return m.byCat[b] - m.byCat[a]; });
var catTotal = cats.reduce(function(s,c){ return s + m.byCat[c]; }, 0);
var catTotalEl = document.getElementById('ov-cat-total');
if (catTotalEl) catTotalEl.textContent = privacyOn ? PRIVACY_MASK : moneyShort(catTotal);
var catNote = document.getElementById('ov-cat-note');
if (catNote) catNote.textContent = (!cats.length || catTotal <= 0) ? ''
: (privacyOn ? PRIVACY_MASK
: cats.slice(0,2).map(function(c){
return c + ' ' + Math.round(m.byCat[c]/catTotal*100) + '%';
}).join(' · '));
if (cats.length && catTotal > 0){
draw('c-ov-cat', {
type: 'doughnut',
data: {
labels: cats,
datasets: [{
data: cats.map(function(c){ return Math.round(m.byCat[c]*100)/100; }),
backgroundColor: cats.map(function(c){ return catColor(c); }),
borderWidth: 0, spacing: 2
}]
},
options: {responsive:true, maintainAspectRatio:false, cutout:'68%', layout:{padding:8},
onClick:function(ev, els){
if (typeof ovCatPick === 'function') ovCatPick(els && els.length ? els[0].index : -1);
},
plugins:{legend:{display:false},
tooltip:{callbacks:{label:function(c){
return c.label + '：' + money(c.parsed) +
(catTotal > 0 ? ' · ' + Math.round(c.parsed/catTotal*100) + '%' : '');
}}}}}
});
} else {
draw('c-ov-cat', {type:'doughnut',
data:{labels:['本月还没有支出'], datasets:[{data:[1], backgroundColor:[cssv('--fill-hover','#e5e7eb')], borderWidth:0}]},
options:{responsive:true, maintainAspectRatio:false, cutout:'68%',
plugins:{legend:{display:false}, tooltip:{enabled:false}}}});
}
document.getElementById('ov-metrics').innerHTML =
metricCard('净资产', moneyShort(n.net), deltaText, null, rollIndex(n.net)) +
metricCard('银行理财', moneyShort(wealthSum), wealthN + ' 个 · 挂卡不计入可用余额', null, rollIndex(wealthSum)) +
metricCard('长期持有', moneyShort(holdSum), holdN + ' 个 · 不参与日常消费', null, rollIndex(holdSum)) +
metricCard('本月收入', moneyShort(m.income),
'工资 / 奖金 / 报销等', null, rollIndex(m.income));
/* 折叠区里的图表在 display:none 下建实例拿不到尺寸，展开后必须重新量一次 */
var fold = document.getElementById('ov-fold');
if (fold && !fold.dataset.bound){
fold.dataset.bound = '1';
fold.addEventListener('toggle', function(){
if (!fold.open) return;
requestAnimationFrame(function(){
['c-ov-comp','c-ov-net','c-ov-cat'].forEach(function(id){
if (charts[id] && charts[id].resize) charts[id].resize();
});
});
});
}
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
backgroundColor: keys.map(function(k){ return typeColor(k); }),
borderWidth: 0, spacing: 2
}]
},
options: {responsive:true, maintainAspectRatio:false, cutout:'62%',
plugins:{legend:{position:'right', labels:{boxWidth:10, boxHeight:10, font:{size:11},
color:cssv('--ink-soft','rgba(60,60,67,.7)'), padding:10}},
tooltip:{callbacks:{label:function(c){ return c.label + '：' + money(c.parsed); }}}}}
});
} else {
draw('c-ov-comp', {type:'doughnut', data:{labels:['暂无数据'], datasets:[{data:[1], backgroundColor:[cssv('--fill-hover','#e5e7eb')], borderWidth:0}]},
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
borderColor: cssv('--primary','#0071e3'), backgroundColor: lineFill(),
fill: !isDarkTheme(), tension: .3, pointRadius: 2, pointHoverRadius: 4, borderWidth: 2
}]
},
options: baseOpts({plugins:{legend:{display:false}}})
});
} else {
draw('c-ov-net', {type:'line', data:{labels:[], datasets:[]},
options: Object.assign(baseOpts(), {scales:{x:{display:false}, y:{display:false}},
plugins:{legend:{display:false}, tooltip:{enabled:false},
title:{display:true, text:'记账满两天后这里会出现趋势线',
color:cssv('--ink-faint','rgba(60,60,67,.45)'), font:{size:12, weight:'400'}}}})});
}
/* 账户表：桌面保留四列操作，手机端收起底部按钮排，改为点卡片打开操作抽屉 */
function acctRow(a){
var b = bal[a.id] || 0;
var meta = TYPE_META[a.type];
var role = roleOf(a);
var cls = role === 'debt' ? 'tag-liab'
: role === 'wealth' ? 'tag-wealth'
: a.type === 'bank' ? 'tag-bank'
: role === 'hold' ? 'tag-invest' : 'tag-cash';
return '<tr class="acct-row" role="button" tabindex="0" data-act="acct-sheet" data-id="' + esc(a.id) + '">' +
'<td><strong>' + esc(a.name) + '</strong>' +
'<span class="tag ' + cls + ' acct-mob-tag">' + meta.label + '</span> ' +
'<button class="btn btn-sm acct-desk-edit" style="padding:1px 8px;font-size:11px" data-act="acct-edit" data-id="' + esc(a.id) + '">编辑</button>' +
(a.note ? '<br><span class="muted" style="font-size:11px">' + esc(a.note) + '</span>' : '') + '</td>' +
'<td><span class="tag ' + cls + '">' + meta.label + '</span></td>' +
'<td class="num" style="font-variant-numeric:tabular-nums' + (b < -0.005 && !privacyOn ? ';color:var(--red)' : '') + '">' +
'<span>' + money(b) + '</span><span class="acct-chev" aria-hidden="true">›</span></td>' +
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
if (typeof renderOverviewExtras === 'function') renderOverviewExtras();
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
var prev = acctEl.value, prevTo = toEl.value;
acctEl.innerHTML = acctOptionsHtml(allow) || '<option value="">（先添加账户）</option>';
toEl.innerHTML = acctOptionsHtml(ROLE_ORDER) || '<option value="">（先添加账户）</option>';
/* 转入账户也要留住：下拉重建后不还原，转账时选好的目标会被悄悄打回第一个 */
if (prevTo) toEl.value = prevTo;
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
var rb = document.getElementById('f-reimb');
if (rb) rb.style.display = (t === 'transfer') ? 'none' : '';
document.getElementById('lbl-from').textContent = (t === 'transfer') ? '转出账户' : '账户';
document.getElementById('tx-submit').textContent = (t === 'transfer') ? '转账' : '添加';
if (t !== 'transfer') fillCatSelect();
fillAccountSelects();
}
/* 明细分批渲染 + 筛选：一次最多上 LED_PAGE 条 DOM，点「显示更多」再追加一批。
筛选是纯前端过滤（数据本来就在内存里），不改后端接口。
切页签、记一笔不会把已展开的页数收回去；只有改筛选条件才回到第一批。 */
var LED_PAGE = 50, ledShown = LED_PAGE, ledMonth = '';
/* 日历视图：ledCalMonth 跟随顶部月份选择器；ledSelDate 只表示日历高亮的那天。
点格子与点月份名都走弹窗（单日 / 整月），不把明细内联铺到日历下方；
ledViewAll 为 true 时下方列表才平铺记录——现在只由筛选触发（命中可能跨天，
要能一屏看全），不再有「整月铺开」的入口。 */
var ledCalMonth = '', ledSelDate = '', ledCalInit = false, ledViewAll = false;
/* 日历是否需要重画：只有数据、月份、选中日期变了才需要 */
var ledCalDirty = true;
function ledPad2(n){ return n < 10 ? '0' + n : String(n); }
function ledEnsureSel(month){
if (ledSelDate && monthKey(ledSelDate) !== month)
ledSelDate = (month === thisMonth()) ? today() : month + '-01';
}
function ledMore(){
ledShown += LED_PAGE;
renderLedList();
}
function renderLedger(){
/* 数据或月份变了，日历的净额与高亮都要重算一次 */
ledCalDirty = true;
ROLL_SLOTS.length = 0;
renderFixed();
var month = document.getElementById('led-month').value || thisMonth();
if (ledMonth !== month){ ledMonth = month; ledShown = LED_PAGE; }
if (!ledCalInit){ ledCalInit = true; ledSelDate = today(); }
ledCalMonth = month;
ledEnsureSel(month);
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
backgroundColor: cats.map(function(c){ return catColor(c); }),
borderWidth: 0, spacing: 2
}]
},
options: {responsive:true, maintainAspectRatio:false, cutout:'62%',
plugins:{legend:{position:'right', labels:{boxWidth:10, boxHeight:10, font:{size:11},
color:cssv('--ink-soft','rgba(60,60,67,.7)'), padding:10}},
tooltip:{callbacks:{label:function(c){ return c.label + '：' + money(c.parsed); }}}}}
});
} else {
draw('c-led-cat', {type:'doughnut', data:{labels:['暂无支出'], datasets:[{data:[1], backgroundColor:[cssv('--fill-hover','#e5e7eb')], borderWidth:0}]},
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
{label:'支出', data: exps, backgroundColor:cssv('--red','#ff3b30'), maxBarThickness:18, borderRadius:4},
{label:'收入', data: incs, backgroundColor:cssv('--green','#34c759'), maxBarThickness:18, borderRadius:4}
]
},
options: baseOpts({plugins:{legend:{display:true, position:'top', align:'end',
labels:{boxWidth:8, boxHeight:8, font:{size:11}, color:cssv('--ink-soft','rgba(60,60,67,.7)')}}}})
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
t.reimbursable ? '报销' : '',
String(t.amount)].join(' ').toLowerCase();
if (hay.indexOf(f.q) < 0) return false;
}
return true;
}
/* 单行 HTML。日期已由分组头给，行里不再重复一列日期，正文能多显示几个字。
移除行尾易误触的「删」按钮：手动流水点整行进编辑弹窗（底部左侧提供删除 + 撤销）；
自动派生的流水点整行弹出确认框以排除当天记录。 */
function ledRowHtml(t, readOnly){
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
var interactive = !readOnly;
var rowAttrs = '';
if (interactive){
rowAttrs = t.auto
? ' role="button" tabindex="0" data-act="auto-delete" data-id="' + esc(t.ruleId || '') +
'" data-date="' + esc(t.date) + '"'
: ' role="button" tabindex="0" data-act="tx-edit" data-id="' + esc(t.id) + '"';
}
return '<div class="list-item' + (interactive ? ' is-editable' : '') + (t.auto ? ' is-auto' : '') + '"' +
rowAttrs + '>' +
'<span class="grow"><span title="' + esc(plain) + '">' +
((t.type === 'expense' || t.type === 'income') && typeof catIcon === 'function' ? catIcon(t.category) + ' ' : '') +
esc(plain) + '</span>' +
(t.auto ? '<span class="tag tag-off">自动</span>' : '') +
(t.reimbursable ? '<span class="tag tag-wait">报销</span>' : '') + '</span>' +
'<span class="amt ' + (t.type === 'expense' ? 'neg' : (t.type === 'income' ? 'pos' : 'muted')) + '">' +
(t.type === 'transfer' ? money(t.amount) : sign + num(t.amount)) + '</span>' +
(interactive ? '<span class="row-arr" aria-hidden="true">›</span>' : '') +
'</div>';
}
/* ================= 明细日历 ================= */
/* 日历只是视图层：点格子弹出当天全部明细，不在日历下方内联展开。
配色与格内净额都取自「当天全部记录」的汇总（不受筛选影响），
且只按汇总净额判定，绝不按单条记录的正负号上色。 */
/* 日历格子里只显示金额本身，不带 +/−：红绿底色与文字颜色已经区分收多还是花多，
符号在这里是重复噪音，还会把 9.5px 的小字挤窄。 */
function ledCalAmt(v){
if (privacyOn) return PRIVACY_MASK;
var a = Math.abs(v);
if (a >= 10000) return (Math.round(a / 1000) / 10).toFixed(1) + '万';
return a.toFixed(2);
}
function ledDateCn(iso){
return (+String(iso).slice(5, 7)) + '月' + (+String(iso).slice(8, 10)) + '日';
}
/* 浮点累加会有 1e-15 级尾巴，用半分钱做阈值，避免 0 被判成红/绿 */
var LED_EPS = 0.005;
function ledNetOf(s){ return (s.income || 0) - (s.expense || 0); }
/* out=支出>收入（净额负，绿）；in=收入>支出（净额正，红）；flat=相抵，沿用原样式 */
function ledNetTone(net){
return net < -LED_EPS ? 'out' : (net > LED_EPS ? 'in' : 'flat');
}
/* 当天全部记录汇总：真实流水 + 自动派生，不看筛选条件。
转账是账户间挪钱、不改变净资产，只记笔数，不进收支净额。 */
function ledDaySumAll(){
var sum = {};
allTx().forEach(function(t){
var d = sum[t.date] || (sum[t.date] = {expense: 0, income: 0, transfer: 0});
if (t.type === 'expense') d.expense += t.amount;
else if (t.type === 'income') d.income += t.amount;
else d.transfer++;
});
return sum;
}
function ledDayRows(iso){
return allTx().filter(function(t){ return t.date === iso; });
}
function renderLedCalendar(month, dayAll){
var title = ledEl('led-cal-title'), grid = ledEl('led-cal-grid');
if (!title || !grid) return;
var y = +month.slice(0, 4), m = +month.slice(5, 7);
if (!y || !m) return;
title.textContent = y + '年 ' + m + '月';
var first = new Date(y, m - 1, 1).getDay();
var days = new Date(y, m, 0).getDate();
var t0 = today(), html = '', i;
for (i = 0; i < first; i++) html += '<span class="led-cal-cell blank"></span>';
for (var d = 1; d <= days; d++){
var iso = month + '-' + ledPad2(d);
var s = dayAll[iso];
var has = !!s;
var net = has ? ledNetOf(s) : 0;
/* 只看汇总净额：同日 -20 与 +15 合计 -5 → 绿；-20 与 +100 合计 +80 → 红 */
var tone = has ? ledNetTone(net) : 'flat';
var future = iso > t0;
var cls = 'led-cal-cell';
if (tone === 'out') cls += ' has-out';
else if (tone === 'in') cls += ' has-in';
if (iso === t0) cls += ' is-today';
if (future) cls += ' is-future';
if (iso === ledSelDate) cls += ' is-sel';
var vCls = tone === 'in' ? ' pos' : (tone === 'out' ? ' neg' : '');
var v = (has && !future) ? ledCalAmt(net) : '';
/* 视觉上不写符号，但读屏仍要能听出是收还是支 */
var ariaNet = !has || future ? '0.00'
: (privacyOn ? '金额已隐藏' : ((net >= 0 ? '+' : '−') + Math.abs(net).toFixed(2)));
html += '<button type="button" class="' + cls + '" data-act="led-day" data-date="' + iso +
'" aria-label="' + iso + (iso === t0 ? ' 今天' : '') + ' 净额 ' + ariaNet + '">' +
'<span class="d">' + d + '</span>' +
(v ? '<span class="v' + vCls + '">' + v + '</span>' : '') +
(iso === t0 ? '<span class="today-dot"></span>' : '') + '</button>';
}
grid.innerHTML = html;
}
/* 日历只在「数据 / 月份 / 选中日期」变化时才重画。
筛选、翻页、改条件都不改变日历内容（配色取当天全部记录，不看筛选），
逐字输入时反复全量汇总 + 重建整个日历 DOM 是纯浪费，还会让输入发涩。 */
function ledDrawCalendar(month){
if (!ledCalDirty) return;
renderLedCalendar(month, ledDaySumAll());
ledCalDirty = false;
}
/* 单日弹窗内容：该日全部记录 + 支出/收入/合计。抽成纯函数，
编辑/删除后可以不重开弹窗、就地换掉内容（保留撤销提示）。 */
function ledDayBody(iso){
var list = ledDayRows(iso);
var s = ledDaySumAll()[iso] || {expense: 0, income: 0, transfer: 0};
var net = ledNetOf(s), tone = ledNetTone(net);
var body = '';
if (list.length){
body += '<div class="muted" style="font-size:11.5px;margin:0 0 6px">' +
'点击记录可编辑或删除；带「自动」标签的记录点击可排除当天。</div>';
body += '<div class="day-lines">' +
list.map(function(t){ return ledRowHtml(t); }).join('') + '</div>';
} else {
body += '<div class="day-empty">这一天还没有记录。</div>';
}
var netTxt = privacyOn ? PRIVACY_MASK : ((net >= 0 ? '+' : '−') + num(Math.abs(net)));
body += '<div class="day-sum">' +
'<span><span class="lbl">支出</span> −' + money(s.expense) + '</span>' +
'<span><span class="lbl">收入</span> +' + money(s.income) + '</span>' +
'<span><span class="lbl">合计</span> <b class="net ' +
(tone === 'in' ? 'pos' : (tone === 'out' ? 'neg' : '')) + '">' + netTxt + '</b></span>' +
(s.transfer ? '<span class="lbl">另有转账 ' + s.transfer + ' 笔，不计入合计</span>' : '') +
'</div>';
return {
title: ledDateCn(iso) + ' ' + ledWeekday(iso) + ' · 当天收支',
body: body
};
}
/* 当前打开的是不是单日弹窗、是哪一天。标记挂在遮罩上，openModal/closeModal 会自动清。 */
function ledDayIsoOf(){
var mask = document.getElementById('modal-mask');
if (!mask || !mask.classList.contains('show')) return '';
return mask.dataset.day || '';
}
/* 当前打开的是哪种明细弹窗：day=单日、month=整月。标记挂在遮罩上，
openModal/closeModal 会一起清掉，避免关掉后还残留旧口径。 */
function ledMonthOf(){
var mask = document.getElementById('modal-mask');
if (!mask || !mask.classList.contains('show')) return '';
return mask.dataset.month || '';
}
function ledPopupCtx(){
var iso = ledDayIsoOf();
if (iso) return {kind: 'day', key: iso};
var m = ledMonthOf();
if (m) return {kind: 'month', key: m};
return null;
}
/* 数据变更后只换弹窗内容：不调 openModal，撤销 toast 不会被 hideUndo 清掉，
弹窗也不会闪一下。由 reload() 在每次数据刷新后调用。 */
function ledRefreshPopup(){
var iso = ledDayIsoOf();
if (iso){
var x = ledDayBody(iso);
document.getElementById('modal-title').textContent = x.title;
document.getElementById('modal-body').innerHTML = x.body;
return;
}
var m = ledMonthOf();
if (!m) return;
var y = ledMonthBody(m);
document.getElementById('modal-title').textContent = y.title;
document.getElementById('modal-body').innerHTML = y.body;
}
function ledOpenDay(iso){
var x = ledDayBody(iso);
/* 与洞察卡弹窗同一套用法：主按钮显示「关闭」，点一下即关闭 */
openModal(x.title, x.body, function(){ return true; }, '关闭', true);
var mask = document.getElementById('modal-mask');
if (mask) mask.dataset.day = iso;
}
/* 整月弹窗：和单日弹窗同一套交互（点记录可编辑、点「删」删除）。
日历上的月份名与「本月明细」按钮都走这里 —— 整月流水不再铺到日历下方。 */
function ledMonthRows(month){
return allTx().filter(function(t){ return String(t.date).slice(0, 7) === month; })
.sort(function(x, y){ return x.date < y.date ? 1 : (x.date > y.date ? -1 : 0); });
}
function ledMonthBody(month){
var rows = ledMonthRows(month), tot = {expense: 0, income: 0, transfer: 0};
var daySum = {}, lines = '', lastDate = '';
rows.forEach(function(t){
var d = daySum[t.date] || (daySum[t.date] = {expense: 0, income: 0});
if (t.type === 'expense'){ tot.expense += t.amount; d.expense += t.amount; }
else if (t.type === 'income'){ tot.income += t.amount; d.income += t.amount; }
else tot.transfer++;
if (t.date !== lastDate){
lastDate = t.date;
var ps = [];
if (d.expense) ps.push('支出 −' + money(d.expense));
if (d.income) ps.push('收入 +' + money(d.income));
lines += '<div class="led-day"><span>' + esc(ledDateCn(t.date) + ' ' + ledWeekday(t.date)) +
'</span><span>' + ps.join(' · ') + '</span></div>';
}
lines += ledRowHtml(t);
});
var net = tot.income - tot.expense, tone = ledNetTone(net);
var netTxt = privacyOn ? PRIVACY_MASK : ((net >= 0 ? '+' : '−') + num(Math.abs(net)));
var body = rows.length
? '<div class="muted" style="font-size:11.5px;margin:0 0 6px">' +
'点击记录可编辑或删除；带「自动」标签的记录点击可排除当天。</div>' +
'<div class="day-lines">' + lines + '</div>'
: '<div class="day-empty">这个月还没有记录。</div>';
body += '<div class="day-sum">' +
'<span><span class="lbl">支出</span> −' + money(tot.expense) + '</span>' +
'<span><span class="lbl">收入</span> +' + money(tot.income) + '</span>' +
'<span><span class="lbl">合计</span> <b class="net ' +
(tone === 'in' ? 'pos' : (tone === 'out' ? 'neg' : '')) + '">' + netTxt + '</b></span>' +
(tot.transfer ? '<span class="lbl">另有转账 ' + tot.transfer + ' 笔，不计入合计</span>' : '') +
'</div>';
return {
title: (+month.slice(0, 4)) + '年 ' + (+month.slice(5, 7)) + '月 · 本月明细',
body: body
};
}
function ledOpenMonth(month){
var m = month || ledCalMonth || thisMonth();
var x = ledMonthBody(m);
openModal(x.title, x.body, function(){ return true; }, '关闭', true);
var mask = document.getElementById('modal-mask');
if (mask) mask.dataset.month = m;
}
/* 弹窗内点行编辑：编辑弹窗会覆盖当前明细弹窗，保存/取消/Esc/点遮罩后回到原来那一层。
返回动作必须在 openModal 之后设置（openModal 会清掉它）。 */
function ledPopupEdit(id){
var ctx = ledPopupCtx();
if (!ctx) return;
var exists = db.transactions.some(function(t){ return t.id === id; });
if (!exists) return;
openTxModal(id);
modalReturn = function(){
if (ctx.kind === 'day') ledOpenDay(ctx.key);
else ledOpenMonth(ctx.key);
};
}
function ledDayEdit(id){ ledPopupEdit(id); }
/* 列表独立渲染：改筛选条件或切换日期时只重画列表与日历，不重建指标卡和两张图表 */
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
/* 日历配色与单日弹窗都不看筛选；分组头的当日收支仍按筛选命中显示，保持台账口径。
只画必须的那些次：筛选命中变化时日历内容一个字都不会变。 */
ledDrawCalendar(ledCalMonth || month);
/* 点日期、点月份都只弹窗，不在日历下方铺明细。
只有筛选命中（ledViewAll）才在下方平铺记录（分页 + 按日分组）。 */
var viewRows = ledViewAll ? rows : [];
var shown = viewRows.slice(0, ledShown);
/* 结果跨年时才给日期补上年份：两年前的 11-10 和今年的不能长得一样；
单月/单年视图继续用短格式，不给眼睛加噪音。 */
var withYear = ledSpansYears(viewRows);
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
var emptyTxt = '';
if (!shown.length){
if (!ledViewAll)
emptyTxt = '点日历上的某一天看当天明细，点月份名或「本月明细」弹窗查看整月。';
else if (ledHasFilter(f))
emptyTxt = '没有符合条件的记录，放宽条件或点「清空筛选」试试。';
else
emptyTxt = '这个月还没有记录';
}
box.innerHTML = (shown.length ? html : '<div class="empty">' + emptyTxt + '</div>') +
(viewRows.length > ledShown
? '<div class="led-more"><button class="btn" data-act="led-more">显示更多（还有 ' +
(viewRows.length - ledShown) + ' 条）</button></div>'
: '');
}
/* 当前查看范围：默认引导看弹窗，筛选平铺结果则标明范围 */
var dt = ledEl('led-day-title');
if (dt){
dt.innerHTML = ledViewAll
? '<strong>全月明细</strong><span>按日期分组 · 共 ' + viewRows.length + ' 笔</span>'
: '<strong>按日查看</strong><span>点日期看当天，点月份看整月</span>';
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
if (!ledViewAll) line += ' · 点日期看当天明细';
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
/* 筛选命中往往跨天，自动平铺命中结果（筛选是唯一还会把记录铺在日历下方的地方） */
ledShowAll();
}
/* 筛选调度：文本框逐字输入加 160ms 防抖（每敲一个键都全量过滤 + 重排列表会发涩），
下拉等离散选择仍即点即生效。清空筛选要取消待执行的回调，
否则它会在清空之后又把「按日查看」切成全月。 */
var ledFilterTimer = 0;
function ledCancelFilter(){
if (ledFilterTimer){ clearTimeout(ledFilterTimer); ledFilterTimer = 0; }
}
function ledScheduleFilter(ev, debounce){
ledCancelFilter();
if (!debounce){ ledOnFilter(ev); return; }
ledFilterTimer = setTimeout(function(){
ledFilterTimer = 0;
ledOnFilter(ev);
}, 160);
}
function ledClearFilters(){
ledCancelFilter();
ledCalDirty = true; /* 选中日期要回到今天，日历高亮得跟着变 */
['led-q', 'led-min', 'led-max', 'led-cat', 'led-acct'].forEach(function(id){
var el = ledEl(id);
if (el) el.value = '';
});
var scope = ledEl('led-scope');
if (scope) scope.value = 'month';
/* 清空筛选回到「按日查看」：既不平铺每一天的记录，也不在下方内联展开当天 */
ledSelDate = today();
ledViewAll = false;
ledEnsureSel(ledCalMonth || thisMonth());
ledShown = LED_PAGE;
renderLedList();
}
/* ================= 日历交互 ================= */
function ledSelectDate(iso){
if (!iso) return;
ledSelDate = iso;
/* 只重画日历高亮，下方列表一概不动：弹窗关闭后页面自然就是原样 */
ledCalDirty = true;
ledDrawCalendar(ledCalMonth || thisMonth());
ledOpenDay(iso);
}
/* 平铺命中记录（筛选专用）。整月明细不走这里，改由 ledOpenMonth() 弹窗。
取消选中态才需要重画日历高亮；本来就没选中时筛选不动日历（降噪也降开销）。 */
function ledShowAll(){
if (ledSelDate) ledCalDirty = true; /* 要去掉那格 is-sel */
ledSelDate = '';
ledViewAll = true;
ledShown = LED_PAGE;
renderLedList();
}
/* 切月同步顶部月份选择器，指标卡与两张图表一起跟着变 */
function ledShiftMonth(delta){
var base = ledCalMonth || thisMonth();
var y = +base.slice(0, 4), m = +base.slice(5, 7) - 1 + delta;
var d = new Date(y, m, 1);
var next = d.getFullYear() + '-' + ledPad2(d.getMonth() + 1);
var el = ledEl('led-month');
if (el) el.value = next;
renderLedger();
}
function ledGoToday(){
var el = ledEl('led-month');
if (el) el.value = thisMonth();
ledSelDate = today();
ledViewAll = false;
renderLedger();
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
statTx().forEach(function(t){
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
/* 分类少时容器不再硬撑 200px：一条数据孤零零飘在空白里很难看 */
if (box) box.style.height = Math.min(420, Math.max(132, cats.length * 40 + 64)) + 'px';
var opts = baseOpts({indexAxis:'y'});
opts.interaction = {mode:'nearest', intersect:true};
opts.plugins.tooltip.callbacks.label = function(c){ return money(c.parsed.x); };
opts.scales.y.ticks.autoSkip = false;
opts.onClick = function(evt, els){
if (els && els.length && cats[els[0].index]) cpOpenDetail(cats[els[0].index].cat);
else cpOpenDetail(null);
};
/* 支出条不再用满饱和的实心红：横向渐隐 + 全圆角，面积大也不刺眼。
分类只有一个时它就是一条长条，柔和度比饱和度重要。 */
draw('cp-chart', {
type:'bar',
data:{labels:cats.map(function(c){ return c.cat; }),
datasets:[{label:'支出', data:cats.map(function(c){ return c.amount; }),
backgroundColor: function(ctx){
var chart = ctx.chart, area = chart.chartArea;
if (!area) return 'rgba(255,59,48,.55)';
var g = chart.ctx.createLinearGradient(area.left, 0, area.right, 0);
g.addColorStop(0, 'rgba(255,59,48,.66)');
g.addColorStop(1, 'rgba(255,59,48,.26)');
return g;
},
borderRadius:6, borderSkipped:false, maxBarThickness:18}]},
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
borderColor:cssv('--primary','#0071e3'), backgroundColor:lineFill(),
fill:!isDarkTheme(), tension:.3, pointRadius:2, pointHoverRadius:4, borderWidth:2
}]
},
options: baseOpts({plugins:{legend:{display:false}}})
});
} else {
draw('c-ana-net', {type:'line', data:{labels:[], datasets:[]},
options: Object.assign(baseOpts(), {scales:{x:{display:false}, y:{display:false}},
plugins:{legend:{display:false}, tooltip:{enabled:false},
title:{display:true, text:'所选区间内还没有足够的数据点', color:cssv('--ink-faint','rgba(60,60,67,.45)'), font:{size:12, weight:'400'}}}})});
}
/* 近 30 天每日支出：与洞察区「近 30 天支出」同口径（含自动支出、排除报销与未来）。
柱子看节奏，虚线是区间日均，一眼能看出哪几天超支。 */
var t0 = today();
var from30 = shiftDate(t0, -29);
var list30 = spendIn(from30, t0);
var byDay = {};
list30.forEach(function(t){ byDay[t.date] = (byDay[t.date] || 0) + t.amount; });
var days = [], vals = [], peak = {date:'', amount:0};
for (var di = 0; di < 30; di++){
var d = shiftDate(from30, di);
var v = byDay[d] || 0;
days.push(d.slice(5));
vals.push(Math.round(v * 100) / 100);
if (v > peak.amount) peak = {date: d, amount: v};
}
var total30 = list30.reduce(function(s, t){ return s + t.amount; }, 0);
var avg30 = total30 / 30;
var dailyNote = document.getElementById('ana-daily-note');
if (dailyNote) dailyNote.textContent = privacyOn
? '近 30 天 · 日均 ' + PRIVACY_MASK
: (list30.length
? '日均 ' + money(avg30) + ' · 最高 ' + money(peak.amount) + '（' + peak.date.slice(5) + '）'
: '近 30 天还没有支出记录');
if (total30 > 0){
draw('c-ana-daily', {
type: 'bar',
data: {
labels: days,
datasets: [
{label:'每日支出', data: vals, backgroundColor:'rgba(0,113,227,.72)',
borderRadius:3, maxBarThickness:16, order:2},
{label:'日均', type:'line', data: days.map(function(){ return Math.round(avg30*100)/100; }),
borderColor:'#ff9500', borderWidth:1.5, borderDash:[4,4],
pointRadius:0, pointHoverRadius:0, fill:false, order:1}
]
},
options: baseOpts({plugins:{legend:{display:true, position:'top', align:'end',
labels:{boxWidth:8, boxHeight:8, font:{size:11}, color:cssv('--ink-soft','rgba(60,60,67,.7)')}}}})
});
} else {
draw('c-ana-daily', {type:'bar', data:{labels:[], datasets:[]},
options: Object.assign(baseOpts(), {scales:{x:{display:false}, y:{display:false}},
plugins:{legend:{display:false}, tooltip:{enabled:false},
title:{display:true, text:'近 30 天还没有支出记录', color:cssv('--ink-faint','rgba(60,60,67,.45)'),
font:{size:12, weight:'400'}}}})});
}
var months = lastMonths(6);
var incs = months.map(function(mm){ return monthStats(mm).income; });
var exps = months.map(function(mm){ return monthStats(mm).expense; });
var bal = months.map(function(mm){ return monthStats(mm).balance; });
/* 渐变填充用的线条下方色块：顶部有色、底部透明，比实心柱轻很多 */
function areaGrad(rgb){
return function(ctx){
var chart = ctx.chart, area = chart.chartArea, c = chart.ctx;
if (!area) return 'rgba(' + rgb + ',.14)';
var g = c.createLinearGradient(0, area.top, 0, area.bottom);
g.addColorStop(0, 'rgba(' + rgb + ',.26)');
g.addColorStop(1, 'rgba(' + rgb + ',0)');
return g;
};
}
var expOpt = baseOpts({plugins:{
legend:{display:true, position:'top', align:'end',
labels:{boxWidth:8, boxHeight:8, font:{size:11}, color:cssv('--ink-soft','rgba(60,60,67,.7)')}},
tooltip:{backgroundColor:cssv('--tooltip','rgba(0,0,0,.82)'), padding:10, cornerRadius:8,
titleFont:{size:12}, bodyFont:{size:12},
callbacks:{
label:function(c){ return c.dataset.label + '：' + money(c.parsed.y); },
footer:function(items){
if (!items.length) return '';
var i = items[0].dataIndex, v = bal[i] || 0;
return '结余：' + (privacyOn ? PRIVACY_MASK
: (v >= 0 ? '+' : '−') + money(Math.abs(v)));
}
}}
}});
expOpt.scales.y.beginAtZero = true;
draw('c-ana-exp', {
type: 'line',
data: {
labels: months.map(function(mm){ return mm.slice(5) + '月'; }),
datasets: [
{label:'收入', data: incs, borderColor:cssv('--green','#34c759'), borderWidth:2,
tension:.35, pointRadius:2, pointHoverRadius:4, fill:!isDarkTheme(),
backgroundColor: areaGrad('52,199,89')},
{label:'支出', data: exps, borderColor:cssv('--red','#ff3b30'), borderWidth:2,
tension:.35, pointRadius:2, pointHoverRadius:4, fill:!isDarkTheme(),
backgroundColor: areaGrad('255,59,48')}
]
},
options: expOpt
});
cpRender();
if (typeof renderMonthlyBill === 'function') renderMonthlyBill();
if (typeof renderHeatmap === 'function') renderHeatmap();
if (typeof renderAchievements === 'function') renderAchievements();
}
/* ================= 渲染：数据 ================= */
/* 数据规模：只算会落到 SQLite 里的部分。逐日派生的 autoTx 不入库，
把它算进来既不符合「本机数据库大小」这行文案，又会随使用年限线性变大。
按 db 引用缓存一次，而且只有切到「数据」页时才会用到。 */
function dataSize(){
var c = cache();
if (c.size == null){
try {
c.size = JSON.stringify({
accounts: db.accounts, transactions: db.transactions,
dca: db.dca, fixed: db.fixed, skips: db.skips
}).length;
} catch(e){ c.size = 0; }
}
return c.size;
}
/* ================= 版本更新 =================
版本号由 build_mobile.py 从 mobile/sw.js 的 CACHE 解析后写进
<meta name="app-version">，桌面版读源码里的同一个值。
CHANGELOG 第一条的 v 必须等于当前版本（release.py 会校验），
所以「版本号」和「这次改了什么」永远不会对不上；只写用户看得懂的改动。 */
var CHANGELOG = [
{v:'95', date:'2026-11-27', items:[
'代码结构整理与性能优化：拆分分析页独立模块、合并热力图与成就墙的 90 天统计缓存，修复切换自定义周期时多余重绘',
'清理冗余样式并优化深色模式下近 7 天支出柱状图的可见度'
]},
{v:'94', date:'2026-11-27', items:[
'分析页新增「记账成就徽章墙」：8 枚极简矢量徽章（初次落笔、坚持 30 天、极简三连、月度克制、攒钱能手、预算守护、长期主义、资产新高），自动记录解锁日期，点击可看达成进度'
]},
{v:'93', date:'2026-11-27', items:[
'界面恢复为 v91 经典苹果极简风格（保留 iOS 软键盘防遮挡修复与无消费日打卡/热力图/拿铁因子功能）'
]},
{v:'91', date:'2026-11-27', items:[
'分析页新增「无消费日打卡 & 近 90 天消费热力图」：零支出日亮绿打卡，消费越高颜色越深，点击格子直接看当天明细',
'新增「拿铁因子」雷达：自动统计近 90 天单笔 ≤ ¥50 的高频小额支出 Top 3，帮你发现不知不觉花掉的小钱'
]},
{v:'90', date:'2026-11-26', items:[
'新增「公司报销明细与一键入账」：总览报销条点「查看明细」可核对本月全部报销记录，并一键预填报销入账',
'分析页新增「月度账单速览」：支持左右切换月份，一屏看清收入、支出环比、净结余、储蓄率与 Top 3 消费分类'
]},
{v:'89', date:'2026-11-26', items:[
'移动端细节修复：修复「每日定投」紧凑卡片标题与按钮被挤成竖排；图表容器防止跨卡片溢出',
'明细筛选「金额区间」手机端独占一行，日历 ≥1 万金额自动简写防贴边；优化账户抽屉关闭按钮与底栏通透度'
]},
{v:'88', date:'2026-11-26', items:[
'移动端视觉精修：隐藏快速记账卡片内与右下角「＋」重叠的重复按钮；报销剔除改为原生 iOS 拨动开关',
'去掉环形图图例重复的小圆点；首屏支出构成区增加细分隔线；底部标签栏升级为毛玻璃通透质感'
]},
{v:'87', date:'2026-11-26', items:[
'修复总览「本月支出 / 本月结余」数字被样式误伤变小变灰、导致绿色「+」号错位突兀的问题'
]},
{v:'86', date:'2026-11-26', items:[
'补齐细节微动效：快速记一笔延迟防滚动聚焦，不再与抽屉动画冲突；悬浮「＋」按钮、折叠面板、页签切换与分类点选过渡更顺滑'
]},
{v:'85', date:'2026-11-26', items:[
'微动效升级：手机端底部抽屉改为从屏底完整滑出、关闭时顺滑收回；确认弹窗增加轻弹性缩放过渡；底部标签栏切换更跟手'
]},
{v:'84', date:'2026-11-26', items:[
'修复手机端点击账户卡片或弹出底部抽屉时，弹窗先向上多顶一段再回缩抖动的问题'
]},
{v:'83', date:'2026-11-26', items:[
'总览与账户视觉减负：未启用的月度预算与每日定投自动收成单行紧凑条；手机端账户卡收起底部按钮排，点卡片弹出操作菜单',
'明细行防误触：去掉每行末尾的「删」按钮，手动记录点进编辑弹窗可删除并支持撤销，自动记录点击弹窗确认排除当天',
'全站分类图标升级为单色描边矢量徽标，跟随分类色与深色香槟金自动适配；所有确认框统一为应用内弹窗，不再弹系统原生框',
'快速记一笔支持一键选分类图标与算式计算（如 68/2、18+5），方便午饭拼单或合并记账'
]},
{v:'82', date:'2026-11-26', items:[
'总览新增「快速记账」：常记的支出（比如每天的午饭）一键记好，右下角「＋」随时记一笔，备注会自动联想分类和金额',
'新增月度预算：可设总预算和各分类预算，进度条按用量变色，记完一笔会提示是否快超支',
'手机改为底部标签栏；弹窗顶部可下滑关闭；总览加了「较上月同期」和近 7 天支出小柱图',
'环形图点扇区可看该分类金额；分类加了图标；新用户有 3 步引导；外观可选「跟随系统」',
'备份更醒目：提醒更勤、数据页显示上次备份时间，并申请浏览器的持久化存储，预算也随备份一起走'
]},
{v:'81', date:'2026-11-26', items:[
'导入备份更安全：清空与写入合成一步，中途出错不会丢掉原有数据',
'导入时会过滤异常金额（非数字/超大数），避免余额和图表出现 NaN',
'删除账户时一并清掉引用它的定投和固定支出规则，不再留下悬空配置'
]},
{v:'80', date:'2026-11-24', items:[
'真正修掉深色主题下弹窗底部那块白框：手机版底栏背景写死了白色，现在会跟着主题变色'
]},
{v:'79', date:'2026-11-24', items:[
'再修一次手机上「关闭」按钮外的白框：把按钮的原生白底和内核额外加的边框一起清掉'
]},
{v:'78', date:'2026-11-23', items:[
'修掉手机上按钮周围那圈浅色描边（浏览器给按钮的原生样式没有完全关掉，弹窗底部的「关闭」最明显）'
]},
{v:'77', date:'2026-11-23', items:[
'修掉深色主题下弹窗外围多出的一圈白边（点日历某天看当日花销时最明显）'
]},
{v:'76', date:'2026-11-23', items:[
'深色主题去掉磨砂模糊：卡片改成实心面板，文字和图表更清晰，不再有隔着一层毛玻璃的感觉'
]},
{v:'75', date:'2026-11-23', items:[
'深色主题下的图表重新配色：不再是刺眼的亮绿亮蓝，改为沉静的一套',
'折线图去掉了整片面积填充，图表区域有了自己均匀的深色底，和玻璃卡片不再打架'
]},
{v:'74', date:'2026-11-23', items:[
'深色主题补上动效：鼠标移到卡片上会轻轻浮起，切换主题时颜色平滑过渡不再硬切',
'主按钮的光晕跟着主题走，深色下是香槟金'
]},
{v:'73', date:'2026-11-23', items:[
'新增深色主题：顶栏右上角点月亮图标切换，深墨底 + 玻璃面板，香槟金做主色',
'浅色主题保持原样；切换过一次之后会自动记住，下次打开直接是那个主题'
]},
{v:'72', date:'2026-11-23', items:[
'表单标签与输入框正确关联：读屏能念出每个框是填什么的，点标签也会直接聚焦',
'每张图表补了文字说明，读屏不再把它当成一块空白跳过',
'弹窗打开时焦点自动进入，关闭后回到刚才那个按钮，键盘操作不会「丢位置」'
]},
{v:'71', date:'2026-11-23', items:[
'删账户时会一并删掉引用它的定投 / 固定支出规则，确认框里会先说明删几条',
'修掉「未来才开始扣的月付规则改成每日后，当天就开始扣款」',
'记完一笔报销后勾选自动复位，不会带到下一笔',
'导入时账户缺失、转账不完整的记录会被丢弃，不再产生对不上账的流水',
'弹窗打开时背后的页面不再跟着滚；从整月明细点进编辑，表单不会再被顶到看不见',
'双击两次启动脚本不会再开出两个服务实例'
]},
{v:'70', date:'2026-11-23', items:[
'「剔除公司报销」挪到资产页「本月支出」卡片底部；本月没有报销标记时自动收起，不再占一行'
]},
{v:'69', date:'2026-11-19', items:[
'修掉「更新市值」选历史日期时差额算错的问题：现在按那一天的实际余额算',
'首页统计和规则页加载快一些，流水记多了以后更明显',
'连点「检查更新」不会再重复刷新一次'
]},
{v:'68', date:'2026-11-18', items:[
'图标改用 JPEG，首次打开要下载的体积从 468KB 降到 200KB 左右'
]},
{v:'67', date:'2026-11-18', items:[
'更新时显示「正在更新…」，回来还停在原来的页签和滚动位置'
]},
{v:'66', date:'2026-11-18', items:[
'修掉「提示更新到新版、刷新后却还是旧版」：缓存层不再把旧页面当成新版存下来'
]},
{v:'65', date:'2026-11-18', items:[
'更新后不再跳回首页：刷新时先淡出，回来还停在原来的页签和位置'
]},
{v:'64', date:'2026-11-18', items:[
'优化缓存层的注册方式：同一版本内打开不再重复下载，只有点「检查更新」才动缓存'
]},
{v:'63', date:'2026-11-18', items:[
'数据页去掉冗长的「数据说明」，只保留版本、备份、数据规模和反馈'
]},
{v:'62', date:'2026-11-18', items:[
'「检查更新」在旧缓存卡住时会强制换一条通道重新拉取，不再干等十分钟'
]},
{v:'61', date:'2026-11-18', items:[
'「自定义周期花销」的红色柱子改成横向渐隐 + 全圆角，分类少时卡片高度也收紧了'
]},
{v:'60', date:'2026-11-18', items:[
'「检查更新」会先向服务器确认真实版本号，能分清「确实最新」和「本机缓存还没过期」'
]},
{v:'59', date:'2026-11-18', items:[
'「近 6 个月收支趋势」改成双色折线 + 渐变面积，比原来的并排柱子清爽；结余放进了悬浮提示'
]},
{v:'58', date:'2026-11-18', items:[
'「检查更新」点一下就自动装好并刷新，不用再关掉应用重开'
]},
{v:'57', date:'2026-11-18', items:[
'「版本更新」改为跟着实际版本走：每次发布都会在这里显示对应的改动'
]},
{v:'56', date:'2026-11-18', items:[
'打开应用时自动检查新版本，不用再等系统慢慢发现',
'主屏图标换成新的二次元头像；图标文件名也换了，彻底避开旧缓存'
]},
{v:'52', date:'2026-11-18', items:[
'数据页新增「版本更新」，可以查看当前版本号和最近的改动'
]},
{v:'51', date:'2026-11-18', items:[
'日历格子里的金额去掉 + / −，只显示数字，红绿继续区分当天是花多还是收多',
'点开某一天的明细里，金额仍保留 + / −'
]},
{v:'49', date:'2026-11-18', items:[
'分析页新增「近 30 天每日支出」图（柱子 + 日均虚线），替换原来的账户收益明细表'
]},
{v:'48', date:'2026-11-18', items:[
'修复「打开变慢、卡片一直加载」：图表库和脚本改为跨版本缓存，换版本不再重下约 400KB'
]},
{v:'47', date:'2026-11-17', items:[
'概览页改版：首页只留一个「本月可花」大数字 + 本月支出构成环图',
'净资产、理财、长期持有、本月收入与两张资产图收进「查看全部资产与趋势」折叠里'
]},
{v:'46', date:'2026-11-17', items:[
'金额输入框统一弹出带小数点的数字键盘，备注、搜索仍是文字键盘'
]},
{v:'45', date:'2026-11-17', items:[
'分析页去掉与「账户收益明细」重复的账户盈亏柱状图'
]}
];
function appVersion(){
var m = document.querySelector('meta[name="app-version"]');
return m ? (m.getAttribute('content') || '') : '';
}
function verItemHtml(it){
return '<div class="ver-item"><div class="ver-head"><b>v' + esc(String(it.v)) + '</b>' +
'<span>' + esc(it.date) + '</span></div><ul>' +
it.items.map(function(t){ return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>';
}
/* 只展示最近两条：版本说明是「这次更新了什么」，不是更新日志归档，
全部铺开会把数据页压得很长。完整记录留在 CHANGELOG 里备查。 */
function renderChangelog(){
var box = document.getElementById('ver-log');
if (!box) return;
var cur = appVersion();
var badge = document.getElementById('ver-badge');
if (badge) badge.textContent = cur ? 'v' + cur : '本地版';
box.innerHTML = CHANGELOG.slice(0, 2).map(verItemHtml).join('');
}
/* 手动触发一次更新并直接切到新版本。
旧版注册的 SW 会把 sw.js 按 HTTP 缓存压最多十分钟，update() 可能根本看不到新版，
所以先直接向服务器要一份首页、读它声明的版本号：这一步绕开 SW 缓存，
能明确区分「服务器上确实有新版」和「这台设备的缓存还没过期」。 */
var _updControllerHandler = null;
function checkUpdate(){
var btn = document.getElementById('check-update-btn');
if (!('serviceWorker' in navigator)){
alert('这个浏览器不支持离线缓存，直接刷新页面即可拿到最新版。');
return;
}
if (btn && btn.disabled) return;
var cur = appVersion();
if (btn){ btn.disabled = true; btn.textContent = '检查中…'; }
var reloading = false;
function restore(){
if (reloading) return;
if (btn){ btn.disabled = false; btn.textContent = '检查更新'; }
}
/* 新 SW 接管的那一刻刷新：这是「真的换版本了」的唯一可靠信号。
每次点击先摘掉上一次的监听器，避免「已是最新」反复点击后累积多个 handler，
真正换代时触发多次 reload 与状态写入。 */
if (_updControllerHandler){
navigator.serviceWorker.removeEventListener('controllerchange', _updControllerHandler);
_updControllerHandler = null;
}
_updControllerHandler = function(){
if (reloading) return;
reloading = true;
if (btn) btn.textContent = '正在更新…';
/* 记下当前页签与滚动位置，刷新后原样还原；先淡出 160ms，
避免旧页面「啪」地变成白屏再跳出新内容。 */
try {
sessionStorage.setItem('jzUpd', JSON.stringify({tab: activeTab, y: window.scrollY}));
} catch(e){}
document.documentElement.classList.add('jz-fadeout');
setTimeout(function(){ location.reload(); }, 160);
};
navigator.serviceWorker.addEventListener('controllerchange', _updControllerHandler, {once:true});
fetch('./?probe=' + Date.now(), {cache:'no-store'}).then(function(r){
return r.text();
}).then(function(html){
var m = /app-version"\s+content="(\d+)"/.exec(html);
var srv = m ? m[1] : '';
if (srv && +srv <= +cur){
restore();
alert('已是最新版本（v' + cur + '）。');
return null;
}
if (btn) btn.textContent = '更新到 v' + (srv || '?') + '…';
/* 旧注册（updateViaCache 还是默认值）会把 sw.js 按 HTTP 缓存压十分钟，
reg.update() 拿到的仍是旧脚本，永远发现不了新版。
换一个带时间戳的脚本地址重新注册：浏览器会当作新脚本去下载，
绕开旧缓存策略，装好后照样 skipWaiting + claim，触发 controllerchange。 */
return navigator.serviceWorker
.register('sw.js?v=' + (srv || Date.now()), {updateViaCache:'none'})
.then(function(reg){ return reg.update(); })
.catch(function(){ return null; })
.then(function(){
setTimeout(function(){
if (reloading) return;
restore();
alert('服务器上已经是 v' + (srv || '?') + '，但这台设备还没切过来。'
+ '请关闭应用再打开一次；打开后就会是新版了。');
}, 8000);
});
}).catch(function(){
restore();
alert.error('检查更新失败，请确认网络后再试。');
});
}
function renderData(){
renderChangelog();
var bytes = dataSize();
document.getElementById('data-stats').textContent =
'账户 ' + db.accounts.length + ' 个 · 流水 ' + db.transactions.length + ' 条 · 自动 ' +
db.autoTx.length + ' 笔 · 约 ' + (bytes/1024).toFixed(1) + ' KB';
if (typeof renderDataExtras === 'function') renderDataExtras();
}
/* ================= 重绘状态保留 =================
renderAll 会重建当前页的大块 innerHTML。不把「刚滚到哪 / 展开了什么」还回去，
每记一笔都会被弹回顶部、展开的面板又合上，感觉很跳。
只抓几个固定容器，不为保存状态反过来遍历整棵 DOM 树。 */
var VIEW_STATE_SEL = '#insight-hero, #led-list, #fixed-scroll';
function captureViewState(){
var st = {y:0, scroll:[], open:[]};
try {
st.y = window.pageYOffset || document.documentElement.scrollTop || 0;
/* #insight-hero 会被 innerHTML 替换掉，所以只记序号，恢复时按选择器重新取 */
Array.prototype.forEach.call(document.querySelectorAll(VIEW_STATE_SEL), function(el, i){
st.scroll.push([i, el.scrollTop || 0, el.scrollLeft || 0]);
});
var ds = document.querySelectorAll('details');
Array.prototype.forEach.call(ds, function(d, i){ if (d.open) st.open.push(i); });
} catch(e){}
return st;
}
function restoreViewState(st){
if (!st) return;
try {
var els = document.querySelectorAll(VIEW_STATE_SEL);
st.scroll.forEach(function(x){
if (els[x[0]]){ els[x[0]].scrollTop = x[1]; els[x[0]].scrollLeft = x[2]; }
});
var ds = document.querySelectorAll('details');
st.open.forEach(function(i){ if (ds[i]) ds[i].open = true; });
if (typeof window.scrollTo === 'function') window.scrollTo(0, st.y);
} catch(e){}
}
/* ================= 总渲染 =================
只渲染「当前看得见的那一页」+ 常驻的顶部开关条：
洞察区、数据页规模统计各自在所属页签的 render() 里算，
在记账页记一笔时不必再把两个没看的页面也全量跑一遍。 */
function renderAll(){
var viewState = captureViewState();
stopRoll();
ROLL_SLOTS.length = 0;
updateReimbBar();
fillAccountSelects();
tabById(activeTab).render();
if (typeof afterRenderAll === 'function') afterRenderAll();
restoreViewState(viewState);
hideSplash();
restoreAfterUpdate();
}
/* 「检查更新」刷新回来后：回到原来那一页和滚动位置，页面就不会从数据页跳回概览。 */
function restoreAfterUpdate(){
var raw = null;
try { raw = sessionStorage.getItem('jzUpd'); } catch(e){}
if (!raw) return;
try { sessionStorage.removeItem('jzUpd'); } catch(e){}
try {
var st = JSON.parse(raw) || {};
if (st.tab && st.tab !== activeTab){
var btn = document.querySelector('#nav button[data-tab="' + st.tab + '"]');
if (btn) btn.click();
}
/* 等一帧再滚：数据页刚渲染完，立即 scrollTo 会被高度还没撑开的内容顶回去 */
var y = st.y || 0;
requestAnimationFrame(function(){ window.scrollTo(0, y); });
} catch(e){}
document.documentElement.classList.remove('jz-fadeout');
/* 更新遮罩：淡出后移除，让「正在更新…」自然过渡到原来的页面 */
var mask = document.querySelector('.upd-mask');
if (mask){
mask.classList.add('out');
setTimeout(function(){ if (mask.parentNode) mask.parentNode.removeChild(mask); }, 240);
}
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
var salCfg = null, salTimer = 0, salTodayCache = null;
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
/* 每秒钟都要问一次，而它的值一天内不会变：读一次 localStorage 就够，
跨天（缓存日期对不上）再重读。 */
var d = today();
if (salTodayCache && salTodayCache.date === d) return salTodayCache.mode;
var mode = 'auto';
try {
var v = JSON.parse(lsGet(SAL_TODAY_KEY) || 'null');
if (v && v.date === d && ['auto','work','off'].indexOf(v.mode) >= 0) mode = v.mode;
} catch(e){}
salTodayCache = {date: d, mode: mode};
return mode;
}
function salSetToday(mode){
lsSet(SAL_TODAY_KEY, JSON.stringify({date:today(), mode:mode}));
salTodayCache = {date: today(), mode: mode};
}
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
salTimer = setInterval(salPaint, 1000);
}
/* 切到后台就停掉计时器：这块每秒重算并写十几个节点，挂着不动也在耗电；
回到前台且还停在算薪页时再续上。 */
document.addEventListener('visibilitychange', function(){
if (document.hidden){
stopSalary();
} else if (activeTab === 'salary' && !salTimer){
salPaint();
salTimer = setInterval(salPaint, 1000);
}
});
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
if (txType !== 'transfer'){
payload.reimbursable = document.getElementById('tx-reimb').checked;
}
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
/* 报销是「这一笔」的属性，不清掉就会带到下一笔：
帮同事记完报销再记自己的咖啡，咖啡也被算作报销而从统计里剔除。 */
document.getElementById('tx-reimb').checked = false;
await reload();
var amEl = document.getElementById('tx-amount');
if (amEl && amEl.focus){ try { amEl.focus({preventScroll:true}); } catch(e){ amEl.focus(); } }
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
amount: t.amount, note: t.note, reimbursable: !!t.reimbursable
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
var msg;
if (isTransfer){
var from = accountById(t.accountId), to = accountById(t.toAccountId);
msg = '排除 ' + date.slice(5) + ' 的这笔定投（' + money(t.amount) + '）？\n' +
(from ? from.name : '转出账户') + ' 与 ' + (to ? to.name : '转入账户') +
' 的余额会同时还原，定投规则本身不受影响。';
} else {
msg = '排除 ' + date.slice(5) + ' 的这笔自动支出' +
(t ? '（' + t.category + ' ' + money(t.amount) + '）' : '') +
'？\n仅跳过当天这一笔，固定支出规则本身不受影响。';
}
if (!(await askConfirm(msg, {title: '排除当天自动记录', okLabel: '排除这笔', danger: true}))) return;
try {
await api('/api/skips', {method:'POST', body:{ruleId: ruleId, date: date}});
await reload();
alert.success('已排除 ' + date.slice(5) + ' 的' +
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
'<input type="number" id="et-amount" step="0.01" min="0.01" inputmode="decimal" value="' + amtVal + '" placeholder="' + ph + '"></div>' +
'<div class="field"><label>从</label><select id="et-from">' + acctOptions(t.accountId) + '</select></div>' +
'<div class="field"><label>转到</label><select id="et-to">' + acctOptions(t.toAccountId) + '</select></div>';
} else if (t.type === 'adjust'){
body += '<div class="field"><label>调整额 (¥，可负)</label>' +
'<input type="number" id="et-amount" step="0.01" inputmode="decimal" value="' + amtVal + '"></div>' +
'<div class="field"><label>账户</label><select id="et-from">' + acctOptions(t.accountId) + '</select></div>';
} else {
body += '<div class="field"><label>金额 (¥)</label>' +
'<input type="number" id="et-amount" step="0.01" min="0.01" inputmode="decimal" value="' + amtVal + '" placeholder="' + ph + '"></div>' +
'<div class="field"><label>分类</label><select id="et-cat">' + catOptions(t.type, t.category) + '</select></div>' +
'<div class="field"><label>账户</label><select id="et-from">' + acctOptions(t.accountId) + '</select></div>' +
'<div class="field"><label style="flex-direction:row;align-items:center;gap:7px;cursor:pointer">' +
'<input type="checkbox" id="et-reimb" style="width:16px;height:16px" ' +
(t.reimbursable ? 'checked' : '') + '> 公司报销（总开关开启时不计入统计）</label></div>';
}
body += '<div class="field"><label>备注 (可选)</label>' +
'<input id="et-note" type="text" inputmode="text" maxlength="60" value="' + esc(t.note) + '"></div>' +
'<span class="muted small">改完余额立即重算；记录类型不可更改。</span>';
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
if (t.type === 'expense' || t.type === 'income'){
var rb = document.getElementById('et-reimb');
payload.reimbursable = rb ? rb.checked : !!t.reimbursable;
}
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
if (typeof setModalDelete === 'function'){
setModalDelete('删除', function(){ return delTx(id); });
}
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
var card = document.getElementById('dca-card');
var note = document.getElementById('dca-note');
var btn = document.getElementById('dca-btn');
var c = dcaCurrent(), s = dcaStats();
var rm = document.getElementById('dca-remove');
if (rm) rm.style.display = c ? '' : 'none';
if (card && card.classList && card.classList.toggle) card.classList.toggle('is-compact', !c);
if (btn) btn.className = c ? 'btn btn-primary btn-sm' : 'btn btn-sm';
if (!c){
if (note) note.textContent = '未启用 · 工作日自动转入基金/理财';
box.innerHTML = '';
return;
}
if (note) note.textContent = '';
var from = accountById(c.fromId), to = accountById(c.toId);
var invalid = !from || !to;
var tag = !c.enabled
? '<span class="tag tag-off">已暂停</span>'
: invalid
? '<span class="tag tag-bad">账户失效</span>'
: '<span class="tag tag-ok">运行中</span>';
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
box.innerHTML = line1 + line2 + warn;
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
'<input type="number" id="dca-amt" step="0.01" min="0" inputmode="decimal" value="' +
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
'<span class="muted small" style="line-height:1.7">' +
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
var ok = await askConfirm(
'清除后，此前所有自动定投都会从余额中消失，历史余额随之变化。建议先导出一份备份。',
{title: '清除每日定投？', okLabel: '确认清除', danger: true}
);
if (!ok) return;
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
/* 一次遍历所有自动支出，按 ruleId 汇总，避免每条规则各扫一遍全量流水。
无 ruleId 的老流水按原口径计入所有规则；last 取遍历顺序的最后一条。 */
function fixedStatsMap(rules){
var m = thisMonth(), map = {};
rules.forEach(function(r){
map[r.ruleId] = {count:0, total:0, mCount:0, mTotal:0, last:''};
});
autoTxOf(AUTO_KIND.FIXED).forEach(function(t){
var targets = t.ruleId
? (map[t.ruleId] ? [map[t.ruleId]] : [])
: rules.map(function(r){ return map[r.ruleId]; });
targets.forEach(function(st){
st.count++; st.total += t.amount; st.last = t.date;
if (monthKey(t.date) === m){ st.mCount++; st.mTotal += t.amount; }
});
});
return map;
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
var statsMap = fixedStatsMap(rules);
box.innerHTML = rules.map(function(r){
var c = r.current, s = statsMap[r.ruleId];
var acc = accountById(c.accountId), invalid = !acc;
var future = !!(c.monthlyDay && r.start > today());
var tag = future
? '<span class="tag tag-wait">待首次扣款</span>'
: !c.enabled
? '<span class="tag tag-off">已停用</span>'
: invalid
? '<span class="tag tag-bad">账户失效</span>'
: '<span class="tag tag-ok">运行中</span>';
var freq = c.monthlyDay ? '每月 ' + c.monthlyDay + ' 号'
: (c.weekdaysOnly ? '每个工作日' : '每天');
var top = '<div class="fx-top">' +
'<span class="fx-amt">' + money(c.amount) + '</span>' +
'<span class="muted">/ ' + freq + '</span>' + tag +
(c.reimbursable
? '<span class="tag tag-wait">报销</span>'
: '') + '</div>';
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
'<input type="number" id="fx-amt" step="0.01" min="0" inputmode="decimal" value="' +
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
(isNew ? '' : '<span class="muted small" style="line-height:1.7">扣款周期已生效，如需更换请删除这条规则后重新添加。</span>') +
'<div class="field"><label>状态</label><select id="fx-on">' +
'<option value="on"' + (!c || c.enabled ? ' selected' : '') + '>启用</option>' +
'<option value="off"' + (c && !c.enabled ? ' selected' : '') + '>停用</option></select></div>' +
'<div class="field"><label style="flex-direction:row;align-items:center;gap:7px;cursor:pointer;color:var(--text)">' +
'<input type="checkbox" id="fx-reimb" style="width:16px;height:16px" ' +
(c && c.reimbursable ? 'checked' : '') + '> 公司报销（总开关开启时不计入统计）</label></div>' +
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
enabled: document.getElementById('fx-on').value === 'on',
reimbursable: document.getElementById('fx-reimb').checked
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
monthlyDay: c.monthlyDay || 0, enabled: !c.enabled,
reimbursable: !!c.reimbursable
}});
await reload();
alert.success(c.enabled ? '已停用，从今天起不再扣款。' : '已启用，从今天起恢复扣款。');
} catch(e){ alert.error(e.message || '操作失败'); }
}
async function removeFixed(ruleId){
var r = fixedRuleById(ruleId);
if (!r) return;
var ok = await askConfirm(
'删除后，这条规则此前产生的所有自动支出都会从余额和统计中消失，历史随之变化。建议先导出一份备份。',
{title: '删除固定支出规则？', okLabel: '确认删除', danger: true}
);
if (!ok) return;
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
'<input type="number" id="ac-balance" step="0.01" inputmode="decimal" value="0" placeholder="0.00">' +
'<span class="muted small">填今天的真实余额，作为建账起点。负债填正数（欠多少）。日常类的账户会作为记账时的默认扣款来源。</span></div>' +
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
'<input type="number" id="ed-balance" step="0.01" inputmode="decimal" value="' +
(privacyOn ? '' : a.initial_balance) + '"' +
(privacyOn ? ' placeholder="留空表示不修改（当前金额已隐藏）"' : '') + '></div>' +
'<div class="field"><label>余额日期</label>' +
'<input type="date" id="ed-date" value="' + esc(a.initial_date || today()) + '"></div>' +
'<div class="field"><label>备注 (可选)</label>' +
'<input id="ed-note" maxlength="60" value="' + esc(a.note) + '"></div>' +
'<span class="muted small" style="line-height:1.7">' +
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
'<input type="number" id="rv-value" step="0.01" inputmode="decimal" value="' +
(privacyOn ? '' : bal.toFixed(2)) + '"' +
(privacyOn ? ' placeholder="请输入实际金额（当前金额已隐藏）"' : '') + '></div>' +
'<div class="field"><label>日期</label><input type="date" id="rv-date" max="' + today() + '" value="' + today() + '"></div>' +
'<span class="muted small">' +
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
'<div class="field"><label>金额 (¥)</label><input type="number" id="tr-amt" step="0.01" min="0.01" inputmode="decimal" required></div>' +
'<div class="field"><label>日期</label><input type="date" id="tr-date" value="' + today() + '"></div>' +
'<div class="field"><label>备注 (可选)</label><input id="tr-note" maxlength="60"></div>' +
'<span class="muted small">转账不算收入也不算支出，只改变两个账户的余额。</span>',
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
function openAccountSheet(aid){
var a = accountById(aid); if (!a) return;
var b = currentBalances()[aid] || 0;
var meta = TYPE_META[a.type] || TYPE_META.other;
var role = roleOf(a);
var cls = role === 'debt' ? 'tag-liab'
: role === 'wealth' ? 'tag-wealth'
: a.type === 'bank' ? 'tag-bank'
: role === 'hold' ? 'tag-invest' : 'tag-cash';
var isCash = kindOf(a) === 'cash';
var body =
'<div class="act-sheet-meta"><span><span class="tag ' + cls + '">' + meta.label + '</span>' +
(a.note ? ' <span class="muted small">· ' + esc(a.note) + '</span>' : '') + '</span>' +
'<b' + (b < -0.005 && !privacyOn ? ' style="color:var(--red)"' : '') + '>' + money(b) + '</b></div>' +
'<div class="act-list">' +
'<button type="button" class="act-btn" data-act="acct-revalue" data-id="' + esc(a.id) + '">' +
'<span>更新余额 / 最新市值<br><small>' + (isCash ? '核对实际余额，差额记为调整' : '更新股票/基金最新持仓市值') + '</small></span><span>›</span></button>' +
'<button type="button" class="act-btn" data-act="acct-transfer" data-id="' + esc(a.id) + '">' +
'<span>账户间转账<br><small>从该账户划转资金，不影响收支统计</small></span><span>›</span></button>' +
'<button type="button" class="act-btn" data-act="acct-edit" data-id="' + esc(a.id) + '">' +
'<span>编辑账户信息<br><small>修改名称、分类、建账起点或备注</small></span><span>›</span></button>' +
'<button type="button" class="act-btn danger" data-act="acct-delete" data-id="' + esc(a.id) + '">' +
'<span>删除账户<br><small>连同关联流水与规则一并清理</small></span><span>›</span></button>' +
'</div>';
openModal(a.name, body, function(){ return true; }, '关闭', true, 'btn');
}
async function delAccount(id){
var a = accountById(id); if (!a) return;
var txs = db.transactions.filter(function(t){
return t.accountId === id || t.toAccountId === id;
});
/* 引用它的规则会被一并删掉（后端同事务清理），这里先说清楚，别让配置无声消失 */
var ruleN = 0;
if (db.dca.some(function(v){ return v.fromId === id || v.toId === id; })) ruleN++;
var seenRule = {};
db.fixed.forEach(function(f){
if (f.accountId === id && !seenRule[f.ruleId]){ seenRule[f.ruleId] = 1; ruleN++; }
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
}
if (ruleN){
body += '<div class="muted">引用它的定投 / 固定支出规则 ' + ruleN + ' 条也会一并删除。</div>';
}
body += '<div class="note">此操作不可撤销。建议先导出一份备份再删。</div>' +
'<button class="btn btn-sm" type="button" style="align-self:flex-start" ' +
'onclick="exportJSON()">先导出备份</button>';
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
dca: db.dca, fixed: db.fixed, skips: db.skips || [],
budgets: (typeof loadBudgets === 'function') ? loadBudgets() : undefined}};
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
if (days >= 5) return {reason: 'days', days: days, added: added};
if (added >= 15) return {reason: 'count', days: days, added: added};
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
el.className = 'bk-bar' + (due.reason === 'never' ? ' strong' : '');
el.innerHTML = '<span class="bk-txt">🛟 ' + esc(txt) + '</span>' +
'<span class="bk-act">' +
'<button class="btn btn-sm btn-primary" type="button" onclick="exportJSON()">立即备份</button>' +
'<button class="btn btn-sm" type="button" onclick="snoozeBackup()">稍后</button>' +
'</span>';
el.style.display = '';
}
function exportCSV(kind){
var rows = [];
if (kind === 'transactions'){
rows.push(['日期','类型','账户','转入账户','分类','金额','报销','备注']);
/* 明细里显示什么就导出什么（定投转账 + 固定支出），否则导出与界面对不上 */
db.transactions.concat(db.autoTx).forEach(function(t){
var a = accountById(t.accountId), b = accountById(t.toAccountId);
rows.push([t.date,
{expense:'支出', income:'收入', transfer:'转账', adjust:'余额调整'}[t.type] || t.type,
a ? a.name : '', b ? b.name : '', t.category, t.amount,
t.reimbursable ? '是' : '',
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
if (!(await askConfirm('导入将覆盖当前全部账户、流水与规则，确定继续？',
{title: '导入备份', okLabel: '覆盖导入', danger: true}))) return;
var res = await api('/api/import', {method:'POST', body: data});
if (data.budgets && typeof importBudgets === 'function') importBudgets(data.budgets);
await reload();
alert('导入完成：' + res.accounts + ' 个账户、' + res.transactions + ' 条流水。');
} catch(e){
alert('导入失败：' + (e.message || '不是有效的备份文件'));
}
};
reader.readAsText(file);
}
async function clearAll(){
if (!(await askConfirm('确定清空全部数据？建议先导出一份备份。',
{title: '清空全部数据', okLabel: '继续', danger: true}))) return;
if (!(await askConfirm('最后确认：所有账户和流水都将从本地数据库删除，不可恢复。',
{title: '不可恢复操作', okLabel: '确认清空', danger: true}))) return;
try {
await api('/api/clear', {method:'POST', body:{}});
await reload();
} catch(e){ alert('清空失败：' + e.message); }
}
async function loadDemo(){
if (!(await askConfirm('载入示例数据将覆盖数据库中的现有全部数据，确定继续？',
{title: '载入示例数据', okLabel: '载入示例', danger: true}))) return;
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
'acct-sheet': openAccountSheet,
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
'led-clear': ledClearFilters,
'led-day': function(id, el){ ledSelectDate(el ? el.getAttribute('data-date') : ''); },
'led-all': function(){ ledOpenMonth(); },
'led-month': function(){ ledOpenMonth(); },
'led-today': ledGoToday,
'led-cal-prev': function(){ ledShiftMonth(-1); },
'led-cal-next': function(){ ledShiftMonth(1); }
};
function runAction(el){
var act = el.getAttribute('data-act');
var fn = ACTIONS[act];
if (!fn) return;
var id = el.getAttribute('data-id');
if (act === 'tx-edit' && typeof ledPopupCtx === 'function' && ledPopupCtx()){
ledPopupEdit(id);
return;
}
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
document.getElementById('reimb-toggle').addEventListener('change', function(e){
setExcludeReimb(e.target.checked);
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
ledScheduleFilter(e, type === 'input' && t.tagName === 'INPUT');
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
updateReimbBar();
document.getElementById('tx-date').value = today();
document.getElementById('led-month').value = thisMonth();
setTxType('expense');
if (typeof Chart !== 'undefined'){
Chart.defaults.font.family = '-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
Chart.defaults.font.size = 11;
}
applyTheme(currentTheme(), false);
if (location.protocol === 'file:'){
hideSplash();
errBox.style.display = '';
errBox.textContent = '请通过本地服务打开：双击 D:\\记账\\启动记账.bat，浏览器会自动打开 http://127.0.0.1:8765';
return;
}
try {
await reload();
} catch(e){
hideSplash();
errBox.style.display = '';
errBox.textContent = '数据未能加载：' + e.message + '（本地数据加载失败，请确认浏览器未处于无痕模式，或换用 Safari）';
return;
}
try {
var legacy = localStorage.getItem(LS_KEY);
if (legacy && !db.accounts.length){
var old = JSON.parse(legacy);
if (old && old.accounts && old.accounts.length){
if (await askConfirm('检测到浏览器里还有一份旧版数据（' + old.accounts.length + ' 个账户、' +
(old.expenses || []).length + ' 笔开销）。\n是否迁移到新的数据库？迁移后会清除浏览器里的旧副本。',
{title: '发现旧版账本', okLabel: '立即迁移'})){
await api('/api/import', {method:'POST', body: old});
localStorage.removeItem(LS_KEY);
await reload();
alert('迁移完成：' + db.accounts.length + ' 个账户、' + db.transactions.length + ' 条流水。');
}
}
}
} catch(e){}
})();
;
var CAT_SVG = {
'餐饮':     '<path d="M4 11h16a8 8 0 0 1-16 0z"/><path d="M9 19h6M8.5 7.5l1.5-3M13.5 7.5l1.5-3"/>',
'交通':     '<rect x="5" y="4" width="14" height="13" rx="3"/><path d="M5 10.5h14M8 20l2-3M16 20l-2-3"/><circle cx="8.5" cy="14" r=".9"/><circle cx="15.5" cy="14" r=".9"/>',
'购物':     '<path d="M6 7.5h12l-1 12.5H7L6 7.5z"/><path d="M9 7.5a3 3 0 0 1 6 0"/>',
'居住':     '<path d="M3.5 10.5L12 3.5l8.5 7"/><path d="M6 9.2V19.5h12V9.2"/><path d="M10 19.5v-5h4v5"/>',
'娱乐':     '<rect x="3" y="7" width="18" height="10" rx="5"/><path d="M8 10.5v3M6.5 12h3"/><circle cx="15.5" cy="11" r=".9"/><circle cx="17.5" cy="13" r=".9"/>',
'医疗':     '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/>',
'教育':     '<path d="M3.5 6.5A2.5 2.5 0 0 1 6 4h6v15H6a2.5 2.5 0 0 0-2.5 2z"/><path d="M20.5 6.5A2.5 2.5 0 0 0 18 4h-6v15h6a2.5 2.5 0 0 1 2.5 2z"/>',
'通讯':     '<rect x="6.5" y="3" width="11" height="18" rx="2.5"/><path d="M11 17.5h2"/>',
'人情':     '<rect x="4" y="9" width="16" height="11" rx="2"/><path d="M3 9h18M12 9v11"/><path d="M12 9H8.5a2 2 0 1 1 0-4C11 5 12 9 12 9zm0 0h3.5a2 2 0 1 0 0-4C13 5 12 9 12 9z"/>',
'其他':     '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
'工资':     '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 8.8l2.5 2.7 2.5-2.7M9.2 12.2h5.6M9.2 14.8h5.6M12 11.5v5.2"/>',
'奖金':     '<circle cx="12" cy="9.5" r="5.5"/><path d="M9 14.2L7.5 21l4.5-2.3L16.5 21 15 14.2"/>',
'投资收益': '<path d="M4 17l5.5-5.5 3.5 3.5L20 8"/><path d="M15 8h5v5"/>',
'红包':     '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M5 9.5c3.5 2.5 10.5 2.5 14 0"/><circle cx="12" cy="11" r="1.6"/>',
'报销':     '<path d="M6 3.5h12v17l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5v-17z"/><path d="M9 8.5h6M9 12.5h6M9 16.5h4"/>'
};
var IN_CAT_COLORS = {
'工资':'#34c759', '奖金':'#ff9500', '投资收益':'#0071e3', '红包':'#ff3b30', '报销':'#30b0c7'
};
var IN_CAT_COLORS_DARK = {
'工资':'#468f68', '奖金':'#b09a5c', '投资收益':'#5f8fb8', '红包':'#b2625c', '报销':'#4d8a96'
};
function catBadgeColor(c){
if (EX_CATS.indexOf(c) >= 0) return catColor(c);
var map = isDarkTheme() ? IN_CAT_COLORS_DARK : IN_CAT_COLORS;
return map[c] || catColor('其他');
}
function catIcon(c){
var p = CAT_SVG[c] || CAT_SVG['其他'];
return '<span class="cat-ic" style="--cc:' + catBadgeColor(c) + '" aria-hidden="true">' +
'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
p + '</svg></span>';
}
function p2(n){ return n < 10 ? '0' + n : String(n); }
function vibe(ms){
try { if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(ms || 10); } catch(e){}
}
function reducedMotion(){
try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
catch(e){ return false; }
}
function calcExpr(raw){
var s = String(raw == null ? '' : raw).replace(/\s+/g, '')
.replace(/−/g, '-').replace(/[×xX]/g, '*').replace(/÷/g, '/');
if (!s || !/^[0-9.+\-*/()]+$/.test(s)) return NaN;
var pos = 0, n = s.length;
function parseAdd(){
var v = parseMul();
while (pos < n && (s[pos] === '+' || s[pos] === '-')){
var op = s[pos++];
var r = parseMul();
v = op === '+' ? v + r : v - r;
}
return v;
}
function parseMul(){
var v = parseUnary();
while (pos < n && (s[pos] === '*' || s[pos] === '/')){
var op = s[pos++];
var r = parseUnary();
if (op === '/'){ if (r === 0) return NaN; v = v / r; }
else v = v * r;
}
return v;
}
function parseUnary(){
if (pos < n && (s[pos] === '+' || s[pos] === '-')){
var sg = s[pos++];
var u = parseUnary();
return sg === '-' ? -u : u;
}
if (pos < n && s[pos] === '('){
pos++;
var inner = parseAdd();
if (pos >= n || s[pos] !== ')') return NaN;
pos++;
return inner;
}
var st = pos, dots = 0;
while (pos < n && ((s[pos] >= '0' && s[pos] <= '9') || s[pos] === '.')){
if (s[pos] === '.' && ++dots > 1) return NaN;
pos++;
}
if (pos === st || s.slice(st, pos) === '.') return NaN;
return parseFloat(s.slice(st, pos));
}
var res = parseAdd();
if (pos !== n || !isFinite(res)) return NaN;
return Math.round(res * 100) / 100;
}
var _noteCache = {db:null, map:null};
function noteIndex(){
if (_noteCache.db === db && _noteCache.map) return _noteCache.map;
var from = shiftDate(today(), -180), map = {};
db.transactions.forEach(function(t){
if (t.type !== 'expense' || !t.note || t.date < from) return;
var m = map[t.note] || (map[t.note] = {n:0, cats:{}, last:'', amount:0, accountId:''});
m.n++;
m.cats[t.category] = (m.cats[t.category] || 0) + 1;
if (t.date >= m.last){ m.last = t.date; m.amount = t.amount; m.accountId = t.accountId; }
});
_noteCache = {db:db, map:map};
return map;
}
function noteSuggestions(limit){
var m = noteIndex();
return Object.keys(m).sort(function(a, b){ return m[b].n - m[a].n; }).slice(0, limit || 30);
}
function noteTopCat(m){
var best = '', bn = 0;
Object.keys(m.cats).forEach(function(c){ if (m.cats[c] > bn){ bn = m.cats[c]; best = c; } });
return best;
}
function setSelectIf(sel, val){
if (!sel || !val) return;
if (sel.options){
for (var i = 0; i < sel.options.length; i++){
if (sel.options[i].value === val){ sel.value = val; return; }
}
return;
}
sel.value = val;
var grid = document.getElementById('qk-cat-grid');
if (grid && grid.querySelectorAll){
Array.prototype.forEach.call(grid.querySelectorAll('[data-qk-cat]'), function(b){
b.classList.toggle('on', b.getAttribute('data-qk-cat') === val);
});
}
}
function applyNoteHint(noteId, catId, amtId, acctId){
var noteEl = document.getElementById(noteId);
if (!noteEl) return;
var m = noteIndex()[String(noteEl.value || '').trim()];
if (!m) return;
var cat = noteTopCat(m);
if (cat && EX_CATS.indexOf(cat) >= 0) setSelectIf(document.getElementById(catId), cat);
setSelectIf(document.getElementById(acctId), m.accountId);
var am = document.getElementById(amtId);
if (am && !String(am.value).trim() && m.amount && !privacyOn){
am.value = m.amount;
if (am.select) am.select();
}
}
function refreshNoteList(){
var dl = document.getElementById('note-list');
if (!dl) return;
dl.innerHTML = noteSuggestions(40).map(function(n){
return '<option value="' + esc(n) + '"></option>';
}).join('');
}
var QK_CACHE = [], quickBusy = false;
function quickPresets(){
var t0 = today(), from = shiftDate(t0, -60), map = {};
db.transactions.forEach(function(t){
if (t.type !== 'expense' || t.date < from || t.date > t0) return;
if (!accountById(t.accountId)) return;
var key = [t.category, t.note, t.accountId].join('|');
var m = map[key] || (map[key] = {cat: t.category || '其他', note: t.note || '',
accountId: t.accountId, list: []});
m.list.push({date: t.date, amount: t.amount});
});
return Object.keys(map).map(function(k){
var m = map[k];
m.list.sort(function(a, b){ return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
var last3 = m.list.slice(0, 3);
return {cat: m.cat, note: m.note, accountId: m.accountId, n: m.list.length,
last: m.list[0].date, amount: m.list[0].amount,
stable: last3.length >= 3 && last3.every(function(x){ return x.amount === last3[0].amount; })};
}).filter(function(p){ return p.n >= 2; })
.sort(function(a, b){
if (b.n !== a.n) return b.n - a.n;
return a.last < b.last ? 1 : (a.last > b.last ? -1 : 0);
}).slice(0, 4);
}
function renderQuick(){
var card = document.getElementById('quick-card');
if (!card) return;
if (!db.accounts.length){ card.style.display = 'none'; return; }
card.style.display = '';
QK_CACHE = quickPresets();
if (card.classList && card.classList.toggle) card.classList.toggle('is-compact', !QK_CACHE.length);
var box = document.getElementById('quick-chips');
if (!box) return;
if (!QK_CACHE.length){
box.innerHTML = '';
return;
}
box.innerHTML = QK_CACHE.map(function(p, i){
return '<button type="button" class="qk-chip" data-act="quick-chip" data-id="' + i + '">' +
'<span class="ic">' + catIcon(p.cat) + '</span><span>' + esc(p.note || p.cat) + '</span>' +
(p.stable ? '<b>' + money(p.amount) + '</b>' : '<small>约 ' + money(p.amount) + '</small>') +
'</button>';
}).join('');
}
function heroDaily(){ return sumRole('daily'); }
function animateHero(oldV){
if (privacyOn || reducedMotion() || typeof requestAnimationFrame !== 'function') return;
var el = document.querySelector('#ov-hero-val [data-ri]');
if (!el) return;
var nv = heroDaily();
if (Math.abs(nv - oldV) < 0.005) return;
var t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
function step(t){
var p = Math.min(1, (t - t0) / 520), k = 1 - Math.pow(1 - p, 3);
el.textContent = moneyShort(oldV + (nv - oldV) * k);
if (p < 1) requestAnimationFrame(step);
}
requestAnimationFrame(step);
}
async function quickRecord(p){
if (quickBusy) return;
quickBusy = true;
try {
var oldV = heroDaily();
var res = await api('/api/transactions', {method:'POST', body:{
date: p.date || today(), type:'expense', account_id: p.accountId,
amount: p.amount, category: p.category, note: p.note || '', reimbursable: false
}});
lastAccountId = p.accountId;
await reload();
vibe(12);
animateHero(oldV);
var id = res && res.id;
showUndo('已记 ' + (p.note || p.category) + ' ' + num(p.amount) + budgetNote(p.category),
async function(){
if (!id) return;
await api('/api/transactions/' + id, {method:'DELETE'});
await reload();
});
} finally {
quickBusy = false;
}
}
function openQuickModal(p){
p = p || {};
var accs = db.accounts.filter(function(a){
return (ROLE_META[roleOf(a)] || {}).inLedger !== false;
});
if (!accs.length){ alert('请先添加一个可记账的账户（活期 / 银行卡等）。'); return; }
var accId = p.accountId && accountById(p.accountId) ? p.accountId
: (lastAccountId && accountById(lastAccountId) ? lastAccountId : '');
if (!accs.some(function(a){ return a.id === accId; })){
accId = (accountsByRole('daily')[0] || accs[0]).id;
}
var cat = p.cat || '餐饮';
var body =
'<div class="field"><div class="qk-amt-head"><label for="qk-amt">金额 (¥，支持算式如 68/2)</label>' +
'<span class="qk-amt-prev" id="qk-amt-prev"></span></div>' +
'<input type="text" id="qk-amt" inputmode="decimal" autocomplete="off" placeholder="0.00" value="' +
(p.amount && !privacyOn ? p.amount : '') + '">' +
'<div class="qk-ops" id="qk-ops">' +
['+', '−', '×', '÷'].map(function(op){
return '<button type="button" class="qk-op" data-op="' + op + '">' + op + '</button>';
}).join('') +
'</div></div>' +
'<div class="field"><label>分类</label>' +
'<input type="hidden" id="qk-cat" value="' + esc(cat) + '">' +
'<div class="cat-grid" id="qk-cat-grid">' + EX_CATS.map(function(c){
return '<button type="button" class="cat-pill' + (c === cat ? ' on' : '') + '" data-qk-cat="' + c + '">' +
catIcon(c) + '<span>' + c + '</span></button>';
}).join('') + '</div></div>' +
'<div class="field"><label for="qk-note">备注 (可选)</label>' +
'<input id="qk-note" type="text" maxlength="60" inputmode="text" list="qk-notes" placeholder="如：午饭" value="' + esc(p.note || '') + '">' +
'<datalist id="qk-notes">' + noteSuggestions(30).map(function(n){
return '<option value="' + esc(n) + '"></option>';
}).join('') + '</datalist></div>' +
'<div class="grid two" style="gap:10px">' +
'<div class="field"><label for="qk-acct">账户</label><select id="qk-acct">' +
accs.map(function(a){
return '<option value="' + esc(a.id) + '"' + (a.id === accId ? ' selected' : '') + '>' + esc(a.name) + '</option>';
}).join('') + '</select></div>' +
'<div class="field"><label for="qk-date">日期</label><input type="date" id="qk-date" value="' + today() + '"></div>' +
'</div>';
openModal('快速记一笔', body, async function(){
var raw = String(document.getElementById('qk-amt').value).trim();
var amt = calcExpr(raw);
if (raw === '' || !(amt > 0)){ alert('请填写有效金额或算式'); return false; }
await quickRecord({
amount: amt, category: document.getElementById('qk-cat').value,
accountId: document.getElementById('qk-acct').value,
note: document.getElementById('qk-note').value.trim(),
date: document.getElementById('qk-date').value || today()
});
}, '记账');
function syncPreview(){
var el = document.getElementById('qk-amt'), pv = document.getElementById('qk-amt-prev');
if (!el || !pv) return;
var s = String(el.value || '').trim();
if (!/[+\-−*×xX/÷]/.test(s)){ pv.textContent = ''; return; }
var v = calcExpr(s);
pv.textContent = isFinite(v) && v > 0 ? '= ¥' + v.toFixed(2) : '';
}
setTimeout(function(){
var a = document.getElementById('qk-amt');
if (a && a.focus){
try { a.focus({preventScroll:true}); } catch(e){ a.focus(); }
if (a.select) a.select();
}
}, 260);
var amtEl = document.getElementById('qk-amt');
if (amtEl && amtEl.addEventListener){
amtEl.addEventListener('input', syncPreview);
amtEl.addEventListener('keydown', function(e){
if (e.key === 'Enter'){
e.preventDefault();
var ok = document.getElementById('modal-ok');
if (ok && ok.click) ok.click();
}
});
}
var ops = document.getElementById('qk-ops');
if (ops && ops.addEventListener){
ops.addEventListener('click', function(e){
var b = e.target && e.target.closest ? e.target.closest('[data-op]') : null;
if (!b || !amtEl) return;
var op = b.getAttribute('data-op');
var cur = String(amtEl.value || '');
amtEl.value = /[+\-−×÷*/]$/.test(cur) ? cur.slice(0, -1) + op : cur + op;
syncPreview();
if (amtEl.focus){ try { amtEl.focus({preventScroll:true}); } catch(e){ amtEl.focus(); } }
});
}
var grid = document.getElementById('qk-cat-grid');
if (grid && grid.addEventListener){
grid.addEventListener('click', function(e){
var b = e.target && e.target.closest ? e.target.closest('[data-qk-cat]') : null;
if (!b) return;
setSelectIf(document.getElementById('qk-cat'), b.getAttribute('data-qk-cat'));
});
}
var noteEl = document.getElementById('qk-note');
if (noteEl && noteEl.addEventListener){
noteEl.addEventListener('change', function(){
applyNoteHint('qk-note', 'qk-cat', 'qk-amt', 'qk-acct');
syncPreview();
});
}
}
var BUDGET_KEY = 'jz_budgets';
function sanitizeBudgets(o){
var out = {total: 0, cats: {}};
if (o && typeof o === 'object'){
var t = +o.total;
if (isFinite(t) && t > 0 && t <= 1e9) out.total = Math.round(t * 100) / 100;
var c = o.cats || {};
EX_CATS.forEach(function(k){
var v = +c[k];
if (isFinite(v) && v > 0 && v <= 1e9) out.cats[k] = Math.round(v * 100) / 100;
});
}
return out;
}
function loadBudgets(){
var raw = lsGet(BUDGET_KEY);
if (!raw) return {total: 0, cats: {}};
try { return sanitizeBudgets(JSON.parse(raw)); } catch(e){ return {total: 0, cats: {}}; }
}
function saveBudgets(b){ lsSet(BUDGET_KEY, JSON.stringify(sanitizeBudgets(b))); }
function importBudgets(b){ if (b && typeof b === 'object') saveBudgets(b); }
function hasBudget(b){ return b.total > 0 || Object.keys(b.cats).length > 0; }
function bdLevel(r){ return r >= 1 ? 'over' : (r >= 0.8 ? 'warn' : 'ok'); }
function bdBar(r){
return '<div class="bd-bar"><i style="width:' + (privacyOn ? 0 : Math.min(100, Math.round(r * 100))) + '%"></i></div>';
}
function renderBudget(){
var card = document.getElementById('budget-card');
var body = document.getElementById('budget-body');
if (!card || !body) return;
if (!db.accounts.length){ card.style.display = 'none'; return; }
card.style.display = '';
var b = loadBudgets(), active = hasBudget(b), note = document.getElementById('budget-note');
if (card.classList && card.classList.toggle) card.classList.toggle('is-compact', !active);
if (!active){
if (note) note.textContent = '未设置 · 超支自动提醒';
body.innerHTML = '';
return;
}
var ym = thisMonth(), m = monthStats(ym);
var left = daysInMonth(ym) - (+today().slice(8, 10)) + 1;
var html = '';
if (b.total > 0){
var r = m.expense / b.total, remain = b.total - m.expense;
html += '<div class="bd-row bd-main ' + bdLevel(r) + '"><div class="bd-top"><span class="nm">总预算</span>' +
'<span class="amt">' + money(m.expense) + ' / ' + money(b.total) + '</span></div>' + bdBar(r) +
'<div class="bd-sum">' + (privacyOn ? PRIVACY_MASK
: (remain >= 0
? '还剩 <b>' + money(remain) + '</b> · 剩余 ' + left + ' 天，日均可花 ' + money(remain / left)
: '已超支 <b class="over">' + money(-remain) + '</b>')) + '</div></div>';
}
var keys = Object.keys(b.cats).sort(function(x, y){
return (m.byCat[y] || 0) / b.cats[y] - (m.byCat[x] || 0) / b.cats[x];
});
if (keys.length){
html += '<div class="bd-cats">' + keys.map(function(c){
var spent = m.byCat[c] || 0, rr = spent / b.cats[c];
return '<div class="bd-row ' + bdLevel(rr) + '"><div class="bd-top"><span class="nm">' +
catIcon(c) + ' ' + esc(c) + '</span><span class="amt">' + money(spent) + ' / ' + money(b.cats[c]) +
'</span></div>' + bdBar(rr) + '</div>';
}).join('') + '</div>';
}
body.innerHTML = html;
if (note) note.textContent = ym.slice(5) + ' 月';
}
function openBudgetModal(){
if (privacyOn){ alert('先点右上角的眼睛显示金额，再设置预算。'); return; }
var b = loadBudgets();
var body = '<div class="field"><label>每月总预算 (¥，留空不设)</label>' +
'<input type="number" id="bd-total" step="1" min="0" inputmode="decimal" value="' + (b.total || '') + '"></div>' +
'<div class="note">按分类单独设置（可选）：</div>' +
EX_CATS.map(function(c, i){
return '<div class="field"><label style="flex-direction:row;align-items:center;gap:6px">' + catIcon(c) + ' ' + c + '</label>' +
'<input type="number" id="bd-c' + i + '" step="1" min="0" inputmode="decimal" value="' + (b.cats[c] || '') + '"></div>';
}).join('') +
'<span class="muted small" style="line-height:1.7">按自然月统计，含固定支出；开启「剔除公司报销」时同样不计入。</span>';
openModal('月度预算', body, async function(){
function rd(id){
var raw = String(document.getElementById(id).value).trim();
if (raw === '') return 0;
var v = +raw;
if (!isFinite(v) || v < 0) throw new Error('请填写有效的预算金额');
return v;
}
var nb = {total: rd('bd-total'), cats: {}};
EX_CATS.forEach(function(c, i){ var v = rd('bd-c' + i); if (v > 0) nb.cats[c] = v; });
saveBudgets(nb);
renderBudget();
});
}
function budgetNote(cat){
if (privacyOn) return '';
var b = loadBudgets();
if (!hasBudget(b)) return '';
var m = monthStats(thisMonth()), lim = b.cats[cat], out = '';
if (lim > 0){
var r = (m.byCat[cat] || 0) / lim;
if (r >= 1) out = ' · ⚠️ ' + cat + '预算已超支';
else if (r >= 0.8) out = ' · ' + cat + '预算已用 ' + Math.round(r * 100) + '%';
}
if (!out && b.total > 0){
var rt = m.expense / b.total;
if (rt >= 1) out = ' · ⚠️ 总预算已超支';
else if (rt >= 0.8) out = ' · 总预算已用 ' + Math.round(rt * 100) + '%';
}
return out;
}
var OV_CATS = [], OV_TOTAL = 0, ovPick = -1;
function renderHeroExtras(){
var t0 = today(), ym = thisMonth(), day = +t0.slice(8, 10);
var pm = monthShift(ym, -1), pDay = Math.min(day, daysInMonth(pm));
var cmp = document.getElementById('ov-hero-cmp');
if (cmp){
var cur = spendTotal(spendIn(ym + '-01', t0));
var prev = spendTotal(spendIn(pm + '-01', pm + '-' + p2(pDay)));
if (prev > 0){
var pct = (cur - prev) / prev * 100;
cmp.innerHTML = privacyOn ? '较上月同期 ' + PRIVACY_MASK
: '较上月同期 <b class="' + (pct >= 0 ? 'up' : 'down') + '">' + (pct >= 0 ? '↑' : '↓') +
Math.abs(Math.round(pct * 10) / 10).toFixed(1) + '%</b>';
} else cmp.innerHTML = '';
}
var sp = document.getElementById('ov-spark');
if (!sp) return;
if (privacyOn){ sp.innerHTML = ''; return; }
var byDay = {}, days = [], tot = [], max = 0, sum = 0, i;
statTx().forEach(function(t){
if (t.type === 'expense' && t.date <= t0) byDay[t.date] = (byDay[t.date] || 0) + t.amount;
});
for (i = 6; i >= 0; i--){
var d = shiftDate(t0, -i), v = byDay[d] || 0;
days.push(d); tot.push(v); sum += v;
if (v > max) max = v;
}
if (sum <= 0){ sp.innerHTML = ''; return; }
var wk = ['日', '一', '二', '三', '四', '五', '六'];
sp.innerHTML = '<div class="spark-bars">' + days.map(function(d, j){
var h = Math.max(3, Math.round(tot[j] / max * 30));
return '<div class="sp-col' + (j === 6 ? ' on' : '') + '"><i style="height:' + h + 'px"></i><em>' +
wk[new Date(d + 'T00:00:00').getDay()] + '</em></div>';
}).join('') + '</div><div class="spark-cap">近 7 天支出 · 日均 ' + money(sum / 7) + '</div>';
}
function renderCatLegend(){
var m = monthStats(thisMonth());
OV_CATS = Object.keys(m.byCat || {}).sort(function(a, b){ return m.byCat[b] - m.byCat[a]; });
OV_TOTAL = OV_CATS.reduce(function(s, c){ return s + m.byCat[c]; }, 0);
var box = document.getElementById('ov-cat-legend');
if (!box) return;
if (!OV_CATS.length || OV_TOTAL <= 0 || privacyOn){ box.innerHTML = ''; return; }
box.innerHTML = OV_CATS.slice(0, 5).map(function(c, i){
return '<button type="button" class="ov-lg' + (i === ovPick ? ' on' : '') + '" data-act="ov-pick" data-id="' + i + '">' +
catIcon(c) + esc(c) + ' ' +
Math.round(m.byCat[c] / OV_TOTAL * 100) + '%</button>';
}).join('');
}
function ovCatPick(i){
if (privacyOn) return;
ovPick = (i < 0 || i === ovPick) ? -1 : i;
renderCatLegend();
ovApply();
}
function ovApply(){
if (ovPick >= OV_CATS.length) ovPick = -1;
var lab = document.getElementById('ov-cat-lab'), tot = document.getElementById('ov-cat-total');
if (ovPick >= 0 && !privacyOn){
var c = OV_CATS[ovPick], m = monthStats(thisMonth());
if (lab) lab.innerHTML = catIcon(c) + ' ' + esc(c);
if (tot) tot.textContent = moneyShort(m.byCat[c] || 0);
} else {
if (lab) lab.textContent = '本月支出';
if (tot) tot.textContent = privacyOn ? PRIVACY_MASK : moneyShort(OV_TOTAL);
}
var ch = charts['c-ov-cat'];
if (ch && ch.data && ch.data.datasets && ch.data.datasets[0] && OV_CATS.length){
ch.data.datasets[0].offset = OV_CATS.map(function(_, j){ return j === ovPick ? 10 : 0; });
if (ch.update) ch.update();
}
}
function renderOnboard(){
var box = document.getElementById('ov-onboard');
if (!box) return;
var hasAcc = db.accounts.length > 0, hasTx = db.transactions.length > 0;
if (hasAcc && hasTx){ box.style.display = 'none'; box.innerHTML = ''; return; }
var help = document.getElementById('ov-help');
if (help) help.style.display = 'none';
var hasBd = hasBudget(loadBudgets());
function step(n, done, title, sub, act){
return '<div class="onb-step' + (done ? ' done' : '') + '"><span class="onb-num">' + (done ? '✓' : n) + '</span>' +
'<span class="onb-tx">' + title + '<small>' + sub + '</small></span>' + (done ? '' : act) + '</div>';
}
box.innerHTML = '<h3>3 步开始记账</h3><p>两分钟就能用起来，数据只保存在这台设备上。</p>' +
step(1, hasAcc, '添加账户', '填一次当前余额作为起点，之后变动都自动累计',
'<button class="btn btn-primary btn-sm" data-act="ob-add-acct">添加账户</button>') +
step(2, hasTx, '记第一笔', '点右下角「＋」，或进「记账」页',
hasAcc ? '<button class="btn btn-primary btn-sm" data-act="quick-add">记一笔</button>' : '') +
step(3, hasBd, '设个月度预算（可选）', '花得多了会提醒你',
hasAcc ? '<button class="btn btn-sm" data-act="budget-edit">设预算</button>' : '') +
(hasAcc ? '' : '<div class="onb-act"><button class="btn btn-sm" data-act="ob-demo">先看看示例数据</button></div>');
box.style.display = '';
}
function renderOverviewExtras(){
try {
renderOnboard();
renderQuick();
renderBudget();
renderHeroExtras();
renderCatLegend();
ovApply();
} catch(e){
if (typeof console !== 'undefined') console.warn('概览补充渲染失败', e);
}
}
var THEME_MODE_KEY = 'jz_theme_mode';
function themeMode(){
var m = lsGet(THEME_MODE_KEY);
if (m === 'auto' || m === 'light' || m === 'dark') return m;
return lsGet('jz_theme') === 'dark' ? 'dark' : 'light';
}
function systemDark(){
try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
catch(e){ return false; }
}
function resolveTheme(){
var m = themeMode();
return m === 'auto' ? (systemDark() ? 'dark' : 'light') : m;
}
function setThemeMode(m){
if (m !== 'auto' && m !== 'light' && m !== 'dark') return;
lsSet(THEME_MODE_KEY, m);
if (m !== 'auto') lsSet('jz_theme', m);
applyTheme(resolveTheme(), false);
renderThemeSeg();
renderAll();
}
function renderThemeSeg(){
var seg = document.getElementById('theme-seg');
if (!seg || !seg.querySelectorAll) return;
var m = themeMode();
Array.prototype.forEach.call(seg.querySelectorAll('button'), function(b){
b.classList.toggle('on', b.getAttribute('data-id') === m);
});
}
try {
if (window.matchMedia){
var _mq = window.matchMedia('(prefers-color-scheme: dark)');
var _onSys = function(){
if (themeMode() !== 'auto') return;
applyTheme(resolveTheme(), false);
renderAll();
};
if (_mq.addEventListener) _mq.addEventListener('change', _onSys);
else if (_mq.addListener) _mq.addListener(_onSys);
}
} catch(e){}
var PERSIST_OK = null;
function renderBackupStatus(){
var el = document.getElementById('bk-status');
if (!el) return;
var last = lsGet(BK_AT), txt;
if (!last){
txt = '尚未备份过。';
} else {
var d = daysBetween(last, today());
var added = Math.max(0, db.transactions.length - (+lsGet(BK_TX) || 0));
txt = '上次备份：' + last + '（' + (d === 0 ? '今天' : d + ' 天前') + '），之后新增 ' + added + ' 笔。';
}
if (PERSIST_OK === true) txt += ' 存储保护：已开启。';
else if (PERSIST_OK === false) txt += ' 存储保护：浏览器未授予，长期不用可能被清理，请定期备份。';
el.textContent = txt;
}
function requestPersist(){
try {
if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist){
navigator.storage.persist().then(function(ok){
PERSIST_OK = !!ok;
renderBackupStatus();
}).catch(function(){});
}
} catch(e){}
}
function renderDataExtras(){
renderThemeSeg();
renderBackupStatus();
}
function updateFab(){
var fab = document.getElementById('fab');
if (fab) fab.style.display = db.accounts.length ? '' : 'none';
}
function afterRenderAll(){
try { refreshNoteList(); updateFab(); } catch(e){}
}
ACTIONS['quick-add'] = function(){ openQuickModal(); };
ACTIONS['quick-chip'] = function(id){
var p = QK_CACHE[+id];
if (!p) return;
if (p.stable) return quickRecord({amount: p.amount, category: p.cat, accountId: p.accountId, note: p.note});
openQuickModal(p);
};
ACTIONS['budget-edit'] = function(){ openBudgetModal(); };
ACTIONS['ov-pick'] = function(id){ ovCatPick(+id); };
ACTIONS['ob-add-acct'] = function(){ openAccountModal(); };
ACTIONS['ob-demo'] = function(){ return loadDemo(); };
ACTIONS['theme-mode'] = function(id){ setThemeMode(id); };
(function(){
var n = document.getElementById('tx-note');
if (n && n.addEventListener){
n.addEventListener('change', function(){
if (txType !== 'expense') return;
applyNoteHint('tx-note', 'tx-cat', 'tx-amount', 'tx-acct');
updateTxHint();
});
}
})();
(function(){
var mask = document.getElementById('modal-mask');
if (!mask || !mask.addEventListener) return;
var box = null, y0 = 0, dy = 0, drag = false;
function isMobile(){
try { return !!(window.matchMedia && window.matchMedia('(max-width:640px)').matches); }
catch(e){ return false; }
}
mask.addEventListener('touchstart', function(e){
if (!isMobile() || !e.target || !e.target.closest) return;
var m = e.target.closest('.modal');
if (!m) return;
var t = e.touches && e.touches[0];
if (!t || t.clientY - m.getBoundingClientRect().top > 64) return;
box = m; y0 = t.clientY; dy = 0; drag = true;
m.style.transition = 'none';
}, {passive: true});
mask.addEventListener('touchmove', function(e){
if (!drag) return;
dy = Math.max(0, e.touches[0].clientY - y0);
box.style.transform = 'translateY(' + dy + 'px)';
}, {passive: true});
function end(){
if (!drag) return;
drag = false;
var m = box;
m.style.transition = '';
m.style.transform = '';
if (dy > 90) closeModal();
}
mask.addEventListener('touchend', end);
mask.addEventListener('touchcancel', end);
})();
requestPersist();
;
function reimbRows(month){
var m = month || thisMonth(), t0 = today();
return allTx().filter(function(t){
return t.reimbursable && t.type === 'expense' && monthKey(t.date) === m && t.date <= t0;
}).sort(function(a, b){ return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
}
function openReimbIncomeModal(total, count, month){
var accs = db.accounts.filter(function(a){
return (ROLE_META[roleOf(a)] || {}).inLedger !== false;
});
if (!accs.length){ alert('请先添加一个可记账的账户。'); return; }
var defAcc = (accountsByRole('daily')[0] || accs[0]).id;
var m = month || thisMonth();
var body =
'<div class="field"><label for="ri-amt">报销入账金额 (¥)</label>' +
'<input type="number" id="ri-amt" step="0.01" min="0.01" inputmode="decimal" value="' +
(privacyOn ? '' : (Math.round(total * 100) / 100).toFixed(2)) + '"' +
(privacyOn ? ' placeholder="请输入实际到账金额（当前已隐藏）"' : '') + '></div>' +
'<div class="field"><label for="ri-acct">收款账户</label><select id="ri-acct">' +
accs.map(function(a){
return '<option value="' + esc(a.id) + '"' + (a.id === defAcc ? ' selected' : '') + '>' + esc(a.name) + '</option>';
}).join('') + '</select></div>' +
'<div class="field"><label for="ri-date">入账日期</label><input type="date" id="ri-date" value="' + today() + '"></div>' +
'<div class="field"><label for="ri-note">备注</label>' +
'<input type="text" id="ri-note" maxlength="60" inputmode="text" value="' + esc(m.slice(5) + '月公司报销（' + count + '笔）') + '"></div>' +
'<span class="muted small">将记为一条「收入 · 报销」流水，对应收款账户余额随之增加。</span>';
openModal('报销入账', body, async function(){
var raw = String(document.getElementById('ri-amt').value).trim();
var amt = +raw;
if (raw === '' || !(amt > 0)){ alert('请填写有效金额'); return false; }
await api('/api/transactions', {method:'POST', body:{
date: document.getElementById('ri-date').value || today(),
type: 'income',
account_id: document.getElementById('ri-acct').value,
category: '报销',
amount: amt,
note: document.getElementById('ri-note').value.trim()
}});
await reload();
alert.success('报销已入账 ' + money(amt) + '。');
}, '确认入账');
}
function openReimbModal(month){
var m = month || thisMonth();
var rows = reimbRows(m);
var sum = rows.reduce(function(s, t){ return s + t.amount; }, 0);
var body = '';
if (!rows.length){
body = '<div class="day-empty">本月暂无标记为「公司报销」的支出。</div>';
} else {
body = '<div class="day-lines">' + rows.map(function(t){
var acc = accountById(t.accountId);
var sub = t.date.slice(5) + (acc ? ' · ' + acc.name : '') + (t.note ? ' · ' + t.note : '');
return '<div class="list-item"><span class="grow"><span title="' + esc(sub) + '">' +
catIcon(t.category) + ' ' + esc(t.category || '其他') + ' · ' + esc(sub) + '</span>' +
(t.auto ? '<span class="tag tag-off">自动</span>' : '') + '</span>' +
'<span class="amt neg">−' + num(t.amount) + '</span></div>';
}).join('') + '</div>' +
'<div class="day-sum">' +
'<span><span class="lbl">共</span> <b>' + rows.length + ' 笔</b></span>' +
'<span><span class="lbl">待报销合计</span> <b>' + money(sum) + '</b></span>' +
'</div>';
}
if (!rows.length){
openModal((+m.slice(5, 7)) + '月公司报销明细', body, function(){ return true; }, '关闭', true, 'btn');
return;
}
openModal((+m.slice(5, 7)) + '月公司报销明细', body, function(){
openReimbIncomeModal(sum, rows.length, m);
return false;
}, '记一笔报销入账');
}
var mbMonth = '';
function renderMonthlyBill(){
var body = document.getElementById('mb-body');
var ymEl = document.getElementById('mb-ym');
var nextBtn = document.getElementById('mb-next');
if (!body) return;
var curM = thisMonth();
if (!mbMonth || mbMonth > curM) mbMonth = curM;
if (ymEl) ymEl.textContent = (+mbMonth.slice(0, 4)) + '年' + (+mbMonth.slice(5, 7)) + '月';
if (nextBtn) nextBtn.disabled = mbMonth >= curM;
var m = monthStats(mbMonth);
var pm = monthStats(monthShift(mbMonth, -1));
if (!m.income && !m.expense){
body.innerHTML = '<div class="empty">这个月还没有收支记录</div>';
return;
}
var expSub = '';
if (pm.expense > 0){
var pct = (m.expense - pm.expense) / pm.expense * 100;
expSub = privacyOn ? '较上月 ' + PRIVACY_MASK
: '较上月 <b class="' + (pct >= 0 ? 'up' : 'down') + '">' + (pct >= 0 ? '↑' : '↓') +
Math.abs(Math.round(pct)) + '%</b>';
}
var balCls = m.balance > 0.005 ? 'pos' : (m.balance < -0.005 ? 'neg' : '');
var balTxt = privacyOn ? PRIVACY_MASK
: ((m.balance > 0.005 ? '+' : (m.balance < -0.005 ? '−' : '')) + moneyShort(Math.abs(m.balance)));
var saveRate = m.income > 0
? (privacyOn ? PRIVACY_MASK : Math.round(m.balance / m.income * 100) + '%')
: '—';
var html = '<div class="mb-grid">' +
'<div class="mb-cell"><div class="lab">总收入</div><div class="val">' + moneyShort(m.income) + '</div></div>' +
'<div class="mb-cell"><div class="lab">总支出</div><div class="val">' + moneyShort(m.expense) + '</div>' +
(expSub ? '<div class="sub">' + expSub + '</div>' : '') + '</div>' +
'<div class="mb-cell"><div class="lab">净结余</div><div class="val ' + balCls + '">' + balTxt + '</div></div>' +
'<div class="mb-cell"><div class="lab">储蓄率</div><div class="val ' + (m.income > 0 && m.balance >= 0 ? 'pos' : '') + '">' +
saveRate + '</div><div class="sub">结余 / 收入</div></div>' +
'</div>';
var cats = Object.keys(m.byCat || {}).sort(function(a, b){ return m.byCat[b] - m.byCat[a]; }).slice(0, 3);
if (cats.length && m.expense > 0){
html += '<div class="mb-top3"><div class="mb-top3-hd">支出 Top 3</div>' +
cats.map(function(c){
var v = m.byCat[c] || 0, r = Math.min(100, Math.round(v / m.expense * 100));
return '<div class="mb-cat"><span class="nm">' + catIcon(c) + esc(c) + '</span>' +
'<div class="bar"><i style="width:' + (privacyOn ? 0 : r) + '%;background:' + catColor(c) + '"></i></div>' +
'<span class="amt">' + money(v) + (privacyOn ? '' : ' · ' + r + '%') + '</span></div>';
}).join('') + '</div>';
}
body.innerHTML = html;
}
function mbShift(delta){
var curM = thisMonth();
var next = monthShift(mbMonth || curM, delta);
if (next > curM) next = curM;
mbMonth = next;
renderMonthlyBill();
}
function noSpendStats90(){
var t0 = today(), ym = thisMonth();
var c = cache();
if (c.ns90 && c.ns90.t0 === t0) return c.ns90;
var from90 = shiftDate(t0, -89);
var list90 = spendIn(from90, t0);
var byDay = {};
list90.forEach(function(t){ byDay[t.date] = (byDay[t.date] || 0) + t.amount; });
var days = [], vals = [], zero90 = 0, zeroCur = 0;
var streak = 0, maxStreak = 0;
for (var i = 0; i < 90; i++){
var d = shiftDate(from90, i);
var v = byDay[d] || 0;
days.push({date: d, val: v});
if (v <= 0.005){
zero90++;
if (d.slice(0, 7) === ym) zeroCur++;
streak++;
if (streak > maxStreak) maxStreak = streak;
} else {
vals.push(v);
streak = 0;
}
}
vals.sort(function(a, b){ return a - b; });
c.ns90 = {
t0: t0, ym: ym, from90: from90, list90: list90,
days: days, vals: vals, zero90: zero90, zeroCur: zeroCur, maxStreak: maxStreak
};
return c.ns90;
}
function renderHeatmap(){
var body = document.getElementById('hm-body');
if (!body) return;
var st = noSpendStats90();
var t0 = st.t0, from90 = st.from90, vals = st.vals;
var curElapsed = +t0.slice(8, 10);
function qAt(p){ return vals.length ? vals[Math.min(vals.length - 1, Math.floor(vals.length * p))] : 0; }
var q1 = qAt(0.25), q2 = qAt(0.55), q3 = qAt(0.82);
var pad = new Date(from90 + 'T00:00:00').getDay();
var cells = '';
for (var i = 0; i < pad; i++) cells += '<span class="hm-cell blank"></span>';
st.days.forEach(function(it){
var cls = 'hm-cell';
if (privacyOn){
cls += ' lv-mask';
} else if (it.val <= 0.005){
cls += ' lv0';
} else if (it.val <= q1){
cls += ' lv1';
} else if (it.val <= q2){
cls += ' lv2';
} else if (it.val <= q3){
cls += ' lv3';
} else {
cls += ' lv4';
}
if (it.date === t0) cls += ' is-today';
var tip = privacyOn ? it.date
: (it.date + (it.val <= 0.005 ? ' · 无消费日' : ' · 支出 ' + money(it.val)));
cells += '<button type="button" class="' + cls + '" data-act="hm-day" data-date="' +
it.date + '" title="' + esc(tip) + '" aria-label="' + esc(tip) + '"></button>';
});
var lMap = {};
st.list90.forEach(function(t){
if (t.auto || t.amount > 50) return;
var label = (t.note || '').trim() || t.category || '其他';
var m = lMap[label] || (lMap[label] = {label: label, cat: t.category || '其他', n: 0, total: 0});
m.n++; m.total += t.amount;
});
var lattes = Object.keys(lMap).map(function(k){ return lMap[k]; })
.filter(function(x){ return x.n >= 3; })
.sort(function(a, b){ return b.total - a.total; })
.slice(0, 3);
var latteHtml = '<div class="hm-latte"><div class="hm-latte-hd"><span>拿铁因子 · 近 90 天高频小额（≤ ¥50）</span></div>' +
(lattes.length
? lattes.map(function(x){
return '<div class="hm-latte-row"><span class="nm">' + catIcon(x.cat) + esc(x.label) + '</span>' +
'<span class="meta">' + (privacyOn ? PRIVACY_MASK : x.n + ' 笔 · 均 ' + money(x.total / x.n)) + '</span>' +
'<span class="amt">' + money(x.total) + '</span></div>';
}).join('')
: '<div class="muted small">近 90 天暂无单笔 ≤ ¥50 且达 3 次以上的高频小额支出</div>') +
'</div>';
body.innerHTML =
'<div class="hm-stats">' +
'<div class="hm-stat"><div class="lab">本月无消费日</div>' +
'<div class="val ok">' + (privacyOn ? PRIVACY_MASK : st.zeroCur + ' 天') + '</div>' +
'<div class="sub">' + (privacyOn ? PRIVACY_MASK : '本月已过 ' + curElapsed + ' 天') + '</div></div>' +
'<div class="hm-stat"><div class="lab">近 90 天无消费</div>' +
'<div class="val">' + (privacyOn ? PRIVACY_MASK : st.zero90 + ' 天') + '</div>' +
'<div class="sub">' + (privacyOn ? PRIVACY_MASK : (st.maxStreak >= 2 ? '最长连续 ' + st.maxStreak + ' 天' : '继续保持')) + '</div></div>' +
'</div>' +
'<div class="hm-wrap"><div class="hm-grid">' + cells + '</div></div>' +
'<div class="hm-legend">' +
'<span class="hm-leg-items"><i class="hm-leg-dot" style="background:rgba(52,199,89,.72)"></i>无消费日</span>' +
'<span class="hm-leg-items">少 <i class="hm-leg-dot" style="background:rgba(255,59,48,.18)"></i>' +
'<i class="hm-leg-dot" style="background:rgba(255,59,48,.38)"></i>' +
'<i class="hm-leg-dot" style="background:rgba(255,59,48,.62)"></i>' +
'<i class="hm-leg-dot" style="background:rgba(255,59,48,.88)"></i> 多 · 点格子看明细</span>' +
'</div>' +
latteHtml;
}
var ACH_KEY = 'jz_badges';
var ACH_CACHE = [];
function loadBadgeDates(){
try {
var o = JSON.parse(lsGet(ACH_KEY) || '{}');
return (o && typeof o === 'object') ? o : {};
} catch(e){ return {}; }
}
function saveBadgeDates(o){ lsSet(ACH_KEY, JSON.stringify(o)); }
function computeBadges(){
var st = noSpendStats90();
var t0 = st.t0, ym = st.ym;
var dates = loadBadgeDates(), changed = false;
var daySet = {};
db.transactions.forEach(function(t){ if (t.date) daySet[t.date] = 1; });
var txDays = Object.keys(daySet).length;
var m = monthStats(ym);
var savePct = m.income > 0 ? Math.round(m.balance / m.income * 100) : 0;
var bd = loadBudgets(), bdOn = hasBudget(bd);
var bdOk = bdOn && (bd.total > 0 ? m.expense <= bd.total : Object.keys(bd.cats).every(function(c){ return (m.byCat[c] || 0) <= bd.cats[c]; }));
var dcaN = typeof dcaStats === 'function' ? dcaStats().count : 0;
var series = buildSeries();
var curNet = series.length ? series[series.length - 1].net : 0;
var maxNet = series.reduce(function(mx, p){ return p.net > mx ? p.net : mx; }, -Infinity);
var netHigh = series.length >= 2 && curNet > 0 && curNet >= maxNet - 0.005;
var list = [
{id:'first-tx', name:'初次落笔', desc:'记下第一笔账目，开启财务清晰之旅',
svg:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
done: db.transactions.length >= 1, prog: db.transactions.length + ' / 1 笔'},
{id:'days-30', name:'坚持 30 天', desc:'累计有记账记录的不同日期达到 30 天',
svg:'<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M4 10h16"/><path d="M9 15l2 2 4-4"/>',
done: txDays >= 30, prog: txDays + ' / 30 天'},
{id:'nospend-3', name:'极简三连', desc:'近 90 天内实现连续 3 天零支出',
svg:'<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>',
done: st.maxStreak >= 3, prog: '最长 ' + st.maxStreak + ' / 3 天'},
{id:'nospend-10', name:'月度克制', desc:'单月累计无消费日达到 10 天',
svg:'<path d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7l7-4z"/><path d="M9 12l2 2 4-4"/>',
done: st.zeroCur >= 10, prog: '本月 ' + st.zeroCur + ' / 10 天'},
{id:'save-40', name:'攒钱能手', desc:'本月储蓄率（结余 ÷ 收入）达到 40%',
svg:'<circle cx="12" cy="12" r="8.5"/><path d="M9.5 8.8l2.5 2.7 2.5-2.7M9.2 12.2h5.6M9.2 14.8h5.6M12 11.5v5.2"/>',
done: m.income > 0 && savePct >= 40, prog: m.income > 0 ? '当前 ' + savePct + '%' : '本月暂无收入'},
{id:'budget-guard', name:'预算守护', desc:'设置月度预算且本月支出未超支',
svg:'<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
done: bdOk, prog: bdOn ? (bdOk ? '守住预算' : '已超支') : '未设置预算'},
{id:'dca-30', name:'长期主义', desc:'每日定投累计自动结算满 30 笔',
svg:'<path d="M4 17l5.5-5.5 3.5 3.5L20 8"/><path d="M15 8h5v5"/>',
done: dcaN >= 30, prog: dcaN + ' / 30 笔'},
{id:'net-high', name:'资产新高', desc:'当前净资产达到历史记录最高点',
svg:'<path d="M12 3l2.6 5.4 6 .9-4.3 4.2 1 6-5.3-2.8-5.3 2.8 1-6-4.3-4.2 6-.9L12 3z"/>',
done: netHigh, prog: series.length >= 2 ? (netHigh ? '已创新高' : '继续积累') : '需满 2 天记录'}
];
list.forEach(function(b){
if (b.done && !dates[b.id]){ dates[b.id] = t0; changed = true; }
b.unlockedAt = dates[b.id] || '';
b.unlocked = !!(b.done || b.unlockedAt);
});
if (changed) saveBadgeDates(dates);
return list;
}
function renderAchievements(){
var body = document.getElementById('ach-body');
var cnt = document.getElementById('ach-count');
if (!body) return;
ACH_CACHE = computeBadges();
var okN = ACH_CACHE.filter(function(b){ return b.unlocked; }).length;
if (cnt) cnt.textContent = okN + ' / ' + ACH_CACHE.length + ' 已解锁';
body.innerHTML = '<div class="ach-grid">' + ACH_CACHE.map(function(b){
var sub = b.unlocked
? (b.unlockedAt ? b.unlockedAt.slice(5) + ' 解锁' : '已解锁')
: (privacyOn ? '未解锁' : b.prog);
return '<button type="button" class="ach-item' + (b.unlocked ? ' on' : '') +
'" data-act="ach-detail" data-id="' + b.id + '">' +
'<span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
b.svg + '</svg></span>' +
'<span class="nm">' + esc(b.name) + '</span>' +
'<span class="sub">' + esc(sub) + '</span></button>';
}).join('') + '</div>';
}
function openBadgeDetail(id){
var b = ACH_CACHE.filter(function(x){ return x.id === id; })[0];
if (!b) return;
var body = '<div style="text-align:center;padding:6px 0 4px">' +
'<div class="ach-item' + (b.unlocked ? ' on' : '') + '" style="display:inline-flex;pointer-events:none;padding:14px 20px">' +
'<span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
b.svg + '</svg></span>' +
'<span class="nm">' + esc(b.name) + '</span>' +
'<span class="sub">' + (b.unlocked ? (b.unlockedAt ? b.unlockedAt + ' 解锁' : '已解锁') : '未解锁') + '</span>' +
'</div>' +
'<p class="muted" style="margin:14px 0 4px;font-size:13px;color:var(--text)">' + esc(b.desc) + '</p>' +
'<p class="muted small" style="margin:0">' + (privacyOn ? '隐私模式已开启' : '当前进度：' + esc(b.prog)) + '</p>' +
'</div>';
openModal('成就详情', body, function(){ return true; }, '关闭', true, 'btn');
}
ACTIONS['reimb-list'] = function(){ openReimbModal(); };
ACTIONS['mb-prev'] = function(){ mbShift(-1); };
ACTIONS['mb-next'] = function(){ mbShift(1); };
ACTIONS['hm-day'] = function(id, el){
var d = el ? el.getAttribute('data-date') : '';
if (d && typeof ledOpenDay === 'function') ledOpenDay(d);
};
ACTIONS['ach-detail'] = function(id){ openBadgeDetail(id); };