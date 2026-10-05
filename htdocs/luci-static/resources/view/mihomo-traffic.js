'use strict';
'require view';
'require rpc';
'require poll';
'require dom';
'require ui';

const callStats = rpc.declare({
	object: 'luci.mihomo-traffic',
	method: 'stats',
	params: [ 'hours', 'dims', 'where', 'limit' ]
});

const callStatus = rpc.declare({
	object: 'luci.mihomo-traffic',
	method: 'status'
});

const callController = rpc.declare({
	object: 'luci.mihomo-traffic',
	method: 'controller'
});

const HOURS = [ [1, '1 小时'], [6, '6 小时'], [24, '24 小时'], [72, '3 天'], [168, '7 天'], [720, '30 天'] ];
const DIMS = [
	[ 'src', '设备' ], [ 'node', '出口节点' ], [ 'host', '目标' ],
	[ 'src,host', '设备 / 目标' ], [ 'src,node', '设备 / 出口节点' ], [ 'node,host', '出口节点 / 目标' ]
];
const TRENDS = [ [ 'dir', '上传 / 下载' ], [ 'src', '按设备' ], [ 'node', '按出口节点' ] ];
const LABEL = { src: '设备', node: '出口节点', host: '目标' };
// 点击某一维度的值后，按它过滤并换到下一层维度
const DRILL = { src: 'host', node: 'host', host: 'src' };
// 不算「代理」的出口
const NOT_PROXY = { DIRECT: true, REJECT: true, 'REJECT-DROP': true };

const PALETTE = [ '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#8c9bb5' ];
const COLOR_UP = '#f59e0b', COLOR_DOWN = '#3b82f6';
const LIVE_SECONDS = 120;
const OTHER_SRC = '其他设备';

const CSS = `
.mt-root { min-width:0; max-width:100% }
.mt-root .cbi-section { padding:1em 1.2em }
.mt-tabbar { display:flex; flex-wrap:wrap; align-items:flex-end; justify-content:space-between; gap:.4em 1em;
	border-bottom:1px solid var(--mt-border); margin:-.2em 0 1em }
.mt-tabs { display:flex; gap:1.6em }
.mt-tab { appearance:none; background:none; border:0; margin:0 0 -1px; padding:.5em .1em .6em; font:inherit; font-size:105%;
	color:inherit; opacity:.6; cursor:pointer; border-bottom:2px solid transparent; display:inline-flex; align-items:center; gap:.45em }
.mt-tab:hover { opacity:.9 }
.mt-tab.mt-on { opacity:1; font-weight:600; color:var(--mt-accent); border-bottom-color:var(--mt-accent) }
.mt-dot { width:7px; height:7px; border-radius:50%; background:transparent }
.mt-dot.mt-live { background:#2ea043; box-shadow:0 0 0 0 rgba(46,160,67,.6); animation:mt-pulse 1.6s infinite }
@keyframes mt-pulse { 70% { box-shadow:0 0 0 6px rgba(46,160,67,0) } 100% { box-shadow:0 0 0 0 rgba(46,160,67,0) } }
.mt-tabbar .mt-status { font-size:85%; padding-bottom:.7em }
.mt-toolbar { display:flex; flex-wrap:wrap; gap:.6em 1.2em; align-items:center; margin:0 0 .8em }
.mt-toolbar label { display:flex; gap:.5em; align-items:center; white-space:nowrap }
.mt-seg { display:inline-flex; flex-wrap:wrap; border:1px solid var(--mt-border); border-radius:6px; overflow:hidden }
.mt-seg button { appearance:none; border:0; margin:0; padding:.35em .9em; background:transparent; color:inherit;
	font:inherit; line-height:1.5; cursor:pointer; border-left:1px solid var(--mt-border) }
.mt-seg button:first-child { border-left:0 }
.mt-seg button:hover { background:var(--mt-soft-2) }
.mt-seg button.mt-on { background:var(--mt-accent); color:#fff }
.mt-chips { min-height:1.8em; margin-bottom:.6em }
.mt-chip { display:inline-flex; align-items:center; gap:.4em; margin:0 .5em .3em 0; padding:.15em .7em; border-radius:999px;
	border:1px solid var(--mt-border); background:var(--mt-soft); cursor:pointer; font-size:90% }
.mt-chip:hover { border-color:${COLOR_DOWN} }
.mt-muted { opacity:.65 }
.mt-cards { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:.8em; margin-bottom:1em }
.mt-card { padding:.8em 1em; border-radius:8px; border:1px solid var(--mt-border); background:var(--mt-soft) }
.mt-card .mt-k { font-size:85%; opacity:.7 }
.mt-card .mt-v { font-size:150%; font-weight:600; margin-top:.2em; white-space:nowrap }
.mt-card .mt-s { font-size:80%; opacity:.6; margin-top:.2em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
.mt-panel { padding:.6em .8em; border-radius:8px; border:1px solid var(--mt-border); margin-bottom:1em; min-width:0 }
.mt-panel h4 { margin:.2em 0 .4em; font-size:100%; font-weight:600 }
.mt-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(380px, 1fr)); gap:0 1em }
/* ECharts 的 canvas 是固定像素宽，contain 让它不参与外层宽度计算，否则窗口变窄时整页被撑住缩不回来 */
.mt-chart { width:100%; height:280px; contain:inline-size; overflow:hidden }
.mt-chart.mt-tall { height:320px }
.mt-table-wrap { overflow-x:auto }
.mt-table-wrap .td { word-break:break-all }
.mt-bar { display:flex; align-items:center; gap:.4em }
.mt-bar > div { flex:1; height:6px; border-radius:3px; background:var(--mt-soft-2); overflow:hidden }
.mt-bar > div > div { height:100% }
.mt-loading { opacity:.5; transition:opacity .2s }
@media (max-width: 600px) { .mt-grid { grid-template-columns:1fr } .mt-chart { height:240px } }
`;

function fmt(n) {
	n = +n || 0;
	if (n >= 1e12) return '%.2f TB'.format(n / 1e12);
	if (n >= 1e9) return '%.2f GB'.format(n / 1e9);
	if (n >= 1e6) return '%.1f MB'.format(n / 1e6);
	if (n >= 1e3) return '%.0f KB'.format(n / 1e3);
	return '%d B'.format(n);
}

function rate(n) {
	return fmt(n) + '/s';
}

function bucketLabel(b) {
	// 2026-10-05 13 → 10-05 13:00；2026-10-05 → 10-05
	const m = /^\d{4}-(\d\d-\d\d)(?: (\d\d))?$/.exec(b);
	return m ? (m[2] ? '%s %s:00'.format(m[1], m[2]) : m[1]) : b;
}

function luminance(color) {
	const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color || '');
	return m ? (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 : 0;
}

function loadECharts() {
	if (window.echarts)
		return Promise.resolve(window.echarts);
	return new Promise((resolve, reject) => {
		const s = document.createElement('script');
		s.src = L.resource('mihomo-traffic/echarts.min.js');
		s.onload = () => resolve(window.echarts);
		s.onerror = () => reject(new Error('ECharts 加载失败'));
		document.head.appendChild(s);
	});
}

return view.extend({
	state: { hours: 24, dims: 'src', trend: 'dir', where: {} },
	charts: {},

	load() {
		return Promise.all([ callStatus(), this.fetch(), loadECharts().catch(() => null) ]);
	},

	fetch() {
		const s = this.state;
		return callStats(s.hours, s.dims, s.where, 200);
	},

	/* ---------- 主题 ---------- */

	// 不按主题名判断：Argon 跟随系统、Bootstrap 用 data-darkmode，统一看正文文字的实际颜色
	readTheme() {
		// 根节点挂到页面之前读不到继承的颜色，退回 body
		const cs = getComputedStyle(this.root.isConnected ? this.root : document.body);
		const dark = luminance(cs.color) > 0.5;
		return {
			dark,
			text: cs.color,
			muted: dark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.5)',
			line: dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.1)',
			tooltipBg: dark ? 'rgba(30,32,40,.95)' : 'rgba(255,255,255,.97)',
			font: cs.fontFamily
		};
	},

	applyTheme() {
		this.theme = this.readTheme();
		const t = this.theme;
		// 强调色跟主题走：Argon 是 --primary，Bootstrap 是 --primary-color-medium
		const rs = getComputedStyle(document.documentElement);
		const accent = [ '--primary', '--primary-color-medium' ].map((v) => rs.getPropertyValue(v).trim()).find((v) => v) || COLOR_DOWN;
		this.root.style.setProperty('--mt-accent', accent);
		this.root.style.setProperty('--mt-border', t.line);
		this.root.style.setProperty('--mt-soft', t.dark ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.025)');
		this.root.style.setProperty('--mt-soft-2', t.dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.08)');
	},

	watchTheme() {
		const rerender = () => {
			const before = this.theme?.dark;
			this.applyTheme();
			if (before !== this.theme.dark) {
				if (this.stats)
					this.drawHistory(this.stats);
				this.drawLive();
			}
		};
		window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(rerender, 50));
		new MutationObserver(() => setTimeout(rerender, 50))
			.observe(document.documentElement, { attributes: true, attributeFilter: [ 'data-darkmode', 'class' ] });
	},

	baseOption() {
		const t = this.theme;
		return {
			color: PALETTE,
			backgroundColor: 'transparent',
			textStyle: { color: t.text, fontFamily: t.font },
			animationDuration: 400,
			tooltip: {
				backgroundColor: t.tooltipBg,
				borderColor: t.line,
				textStyle: { color: t.text },
				confine: true
			}
		};
	},

	axisStyle() {
		const t = this.theme;
		return {
			axisLine: { lineStyle: { color: t.line } },
			axisTick: { show: false },
			axisLabel: { color: t.muted },
			splitLine: { lineStyle: { color: t.line } }
		};
	},

	chart(id, node) {
		if (!window.echarts)
			return null;
		let c = this.charts[id];
		if (c && c.getDom() !== node) {
			c.dispose();
			c = null;
		}
		if (!c) {
			c = this.charts[id] = window.echarts.init(node, null, { renderer: 'canvas' });
			// 切到另一个页签时容器宽度为 0，这时不重排，切回来再按实际尺寸重排
			new ResizeObserver(() => node.offsetWidth && c.resize()).observe(node);
		}
		return c;
	},

	// 后台刷新只换数据，序列结构（类型、名称、堆叠）变了才整体重画，省掉每次重建图形和过渡动画
	paint(c, option) {
		// 合并模式删不掉组件，dataZoom 有无变化也要整体重画
		const sig = JSON.stringify([ (option.series || []).map((s) => [ s.type, s.name, s.stack ]), (option.dataZoom || []).length ]);
		const full = c.mtSig !== sig;
		c.mtSig = sig;
		if (!full)
			option.animation = false;
		c.setOption(option, { notMerge: full, lazyUpdate: true });
	},

	displayName(d, v) {
		if (d == 'src' && this.stats?.names?.[v])
			return '%s (%s)'.format(this.stats.names[v], v);
		return v;
	},

	/* ---------- 历史统计 ---------- */

	// silent：后台轮询时不变暗，免得每分钟闪一下
	refresh(silent) {
		// 后台轮询：页面不可见或停在实时页签时什么都不做，切回来时再刷新
		if (silent === true && (document.hidden || this.historyNode.style.display == 'none')) {
			this.stale = true;
			return Promise.resolve();
		}
		this.stale = false;
		if (silent !== true)
			this.historyNode.classList.add('mt-loading');
		return Promise.all([ callStatus(), this.fetch() ]).then(([ status, stats ]) => {
			dom.content(this.statusNode, this.renderStatus(status));
			this.stats = stats;
			this.renderHistory(stats);
		}).finally(() => {
			this.historyNode.classList.remove('mt-loading');
		});
	},

	update(patch) {
		Object.assign(this.state, patch);
		dom.content(this.toolbarNode, this.renderToolbar());
		dom.content(this.chipsNode, this.renderChips());
		return this.refresh();
	},

	drill(d, v) {
		if (v == null || v == this.stats?.inner)
			return;
		this.state.where[d] = v;
		const dims = this.state.dims.split(',').length > 1 ? this.state.dims : DRILL[d];
		return this.update({ dims });
	},

	renderStatus(st) {
		const run = st.running
			? E('span', { style: 'color:#2ea043' }, '● 采集运行中')
			: E('span', { style: 'color:#d1242f' }, '● 采集未运行');
		const age = st.snapshot_age != null ? '快照 %d 秒前'.format(st.snapshot_age) : '暂无快照';
		return E('span', { class: 'mt-muted' },
			[ run, ' · %s · 已存 %d 天 / %s（保留 %d 天）'.format(age, st.days, fmt(st.size), st.keep_days) ]);
	},

	renderToolbar() {
		const s = this.state;
		const seg = (opts, value, key) => E('div', { class: 'mt-seg' }, opts.map(([ v, t ]) => E('button', {
			class: String(v) == String(value) ? 'mt-on' : '',
			click: () => this.update({ [key]: typeof value == 'number' ? +v : v })
		}, t)));
		const sel = (opts, value, key) => E('select', {
			class: 'cbi-input-select',
			change: (ev) => this.update({ [key]: ev.target.value })
		}, opts.map(([ v, t ]) => E('option', { value: v, selected: v == value ? '' : null }, t)));

		return [
			E('label', {}, [ '时间范围', seg(HOURS, s.hours, 'hours') ]),
			E('label', {}, [ '趋势', sel(TRENDS, s.trend, 'trend') ]),
			E('label', {}, [ '表格维度', sel(DIMS, s.dims, 'dims') ]),
			E('button', { class: 'cbi-button cbi-button-reload', click: ui.createHandlerFn(this, 'refresh') }, '刷新')
		];
	},

	renderChips() {
		const w = this.state.where;
		const keys = Object.keys(w);
		if (!keys.length)
			return E('span', { class: 'mt-muted' }, '提示：点击图表或表格里的设备、节点、目标可以下钻过滤');

		return keys.map((k) => E('span', {
			class: 'mt-chip',
			title: '移除这个过滤',
			click: () => {
				delete w[k];
				this.update({});
			}
		}, [ E('span', { class: 'mt-muted' }, LABEL[k]), this.displayName(k, w[k]), '✕' ]));
	},

	renderCards(st) {
		const total = st.up + st.down;
		// 排行只带前 10 个节点；节点通常没这么多，够用
		const proxy = st.top.node.reduce((a, [ n, u, d ]) => a + (NOT_PROXY[n] ? 0 : u + d), 0);
		const peak = st.hourly.reduce((p, h) => (h[1] + h[2] > p[1] + p[2] ? h : p), [ '', 0, 0 ]);
		const topSrc = st.top.src?.[0];
		const card = (k, v, sub) => E('div', { class: 'mt-card' }, [
			E('div', { class: 'mt-k' }, k), E('div', { class: 'mt-v' }, v), E('div', { class: 'mt-s', title: sub || '' }, sub || ' ')
		]);

		return [
			card('合计', fmt(total), '自 %s 起'.format(bucketLabel(st.since))),
			card('上传', E('span', { style: 'color:' + COLOR_UP }, fmt(st.up)), total ? '占 %.0f%%'.format(st.up / total * 100) : ''),
			card('下载', E('span', { style: 'color:' + COLOR_DOWN }, fmt(st.down)), total ? '占 %.0f%%'.format(st.down / total * 100) : ''),
			card('经代理', fmt(proxy), total ? '占 %.0f%%，其余直连'.format(proxy / total * 100) : ''),
			card('活跃设备', String(st.devices), topSrc ? '最多：%s'.format(this.displayName('src', topSrc[0])) : ''),
			card(st.step == 'day' ? '峰值日' : '峰值小时', fmt(peak[1] + peak[2]), peak[0] ? bucketLabel(peak[0]) : '')
		];
	},

	drawTrend(st) {
		const c = this.chart('trend', this.trendNode);
		if (!c)
			return;
		const t = this.theme;
		const x = st.hourly.map((h) => bucketLabel(h[0]));
		const bar = st.step == 'day' || x.length <= 24;
		const mode = this.state.trend;
		let series;

		const mk = (name, data, color) => ({
			name, data, type: bar ? 'bar' : 'line', stack: 'total',
			smooth: true, showSymbol: false, barMaxWidth: 28,
			lineStyle: { width: 1.5 },
			areaStyle: bar ? undefined : { opacity: t.dark ? .35 : .25 },
			emphasis: { focus: 'series' },
			itemStyle: color ? { color } : undefined
		});

		if (mode == 'dir')
			series = [ mk('上传', st.hourly.map((h) => h[1]), COLOR_UP), mk('下载', st.hourly.map((h) => h[2]), COLOR_DOWN) ];
		else {
			const s = st.series[mode];
			series = s.names.map((n, i) => mk(this.displayName(mode, n), s.data.map((row) => row[i]),
				n == '其他' ? (t.dark ? '#6b7280' : '#b0b7c3') : null));
		}

		this.paint(c, Object.assign(this.baseOption(), {
			grid: { left: 8, right: 16, top: 36, bottom: x.length > 72 ? 48 : 8, containLabel: true },
			legend: { type: 'scroll', top: 0, textStyle: { color: t.text }, pageTextStyle: { color: t.muted } },
			tooltip: Object.assign(this.baseOption().tooltip, {
				trigger: 'axis',
				axisPointer: { type: bar ? 'shadow' : 'line' },
				formatter: (ps) => {
					const sum = ps.reduce((a, p) => a + (+p.value || 0), 0);
					return [ '<b>%s</b>　合计 %s'.format(ps[0].axisValue, fmt(sum)) ]
						.concat(ps.filter((p) => +p.value > 0).sort((a, b) => b.value - a.value)
							.map((p) => '%s %s　<b>%s</b>'.format(p.marker, p.seriesName, fmt(p.value))))
						.join('<br>');
				}
			}),
			xAxis: Object.assign({ type: 'category', data: x, boundaryGap: bar }, this.axisStyle(), { splitLine: { show: false } }),
			yAxis: Object.assign({ type: 'value', axisLabel: { color: t.muted, formatter: (v) => fmt(v) } }, {
				axisLine: { show: false }, splitLine: { lineStyle: { color: t.line, type: 'dashed' } }
			}),
			dataZoom: x.length > 72 ? [ { type: 'inside' }, { type: 'slider', height: 18, bottom: 6, borderColor: t.line, textStyle: { color: t.muted } } ] : [],
			series
		}));
	},

	drawNodes(st) {
		const c = this.chart('nodes', this.nodesNode);
		if (!c)
			return;
		const t = this.theme;
		const data = st.top.node.map(([ n, u, d ]) => ({ name: n, value: u + d, up: u, down: d }));
		c.off('click');
		c.on('click', (p) => this.drill('node', p.name));
		this.paint(c, Object.assign(this.baseOption(), {
			tooltip: Object.assign(this.baseOption().tooltip, {
				trigger: 'item',
				formatter: (p) => '%s <b>%s</b><br>合计 %s（%.1f%%）<br>上传 %s　下载 %s'.format(
					p.marker, p.name, fmt(p.value), p.percent, fmt(p.data.up), fmt(p.data.down))
			}),
			legend: { show: false },
			series: [ {
				type: 'pie', radius: [ '48%', '72%' ], center: [ '50%', '52%' ],
				itemStyle: { borderRadius: 6, borderColor: t.dark ? '#1f2128' : '#fff', borderWidth: 2 },
				label: { color: t.text, formatter: (p) => '{n|%s}\n{v|%s · %.0f%%}'.format(p.name.length > 22 ? p.name.slice(0, 21) + '…' : p.name, fmt(p.value), p.percent),
					rich: { n: { fontSize: 12 }, v: { fontSize: 11, color: t.muted, padding: [ 3, 0, 0, 0 ] } } },
				labelLine: { lineStyle: { color: t.line } },
				labelLayout: { hideOverlap: true },
				emphasis: { scaleSize: 6 },
				data
			} ]
		}));
	},

	drawFlow(st) {
		const c = this.chart('flow', this.flowNode);
		if (!c)
			return;
		const t = this.theme;
		// 小流量设备太多会让左侧标签挤成一团：只保留前 8 个设备，其余并成一个节点
		const bySrc = {};
		for (const [ s, , v ] of st.links)
			bySrc[s] = (bySrc[s] || 0) + v;
		const keep = new Set(Object.keys(bySrc).sort((a, b) => bySrc[b] - bySrc[a]).slice(0, 8));
		const merged = {};
		for (const [ s, n, v ] of st.links) {
			if (v <= 0)
				continue;
			const k = (keep.has(s) ? s : OTHER_SRC) + '\t' + n;
			merged[k] = (merged[k] || 0) + v;
		}
		const links = Object.entries(merged).map(([ k, v ]) => [ ...k.split('\t'), v ]);
		const srcs = [ ...new Set(links.map((l) => l[0])) ], nodes = [ ...new Set(links.map((l) => l[1])) ];
		// 设备和节点放在不同层，名字加前缀避免碰撞
		// 占比不到 3% 的节点只留色块不写标签，悬停仍有提示
		const total = links.reduce((a, l) => a + l[2], 0) || 1;
		const sum = (i, k) => links.reduce((a, l) => a + (l[i] == k ? l[2] : 0), 0);
		const label = (text, v) => ({ show: v / total >= 0.03, formatter: text });
		const data = srcs.map((s) => ({ name: 's:' + s, label: label(this.stats.names[s] || s, sum(0, s)), depth: 0 }))
			.concat(nodes.map((n) => ({ name: 'n:' + n, label: label(n, sum(1, n)), depth: 1 })));
		c.off('click');
		c.on('click', (p) => {
			if (p.dataType == 'node' && p.name != 's:' + OTHER_SRC)
				this.drill(p.name.startsWith('s:') ? 'src' : 'node', p.name.slice(2));
		});
		this.paint(c, Object.assign(this.baseOption(), {
			tooltip: Object.assign(this.baseOption().tooltip, {
				trigger: 'item',
				formatter: (p) => p.dataType == 'edge'
					? '%s → %s<br><b>%s</b>'.format(this.displayName('src', p.data.source.slice(2)), p.data.target.slice(2), fmt(p.value))
					: '%s<br><b>%s</b>'.format(p.name.startsWith('s:') ? this.displayName('src', p.name.slice(2)) : p.name.slice(2), fmt(p.value))
			}),
			series: [ {
				type: 'sankey', left: 8, right: 180, top: 8, bottom: 8,
				nodeWidth: 10, nodeGap: 6, layoutIterations: 32, draggable: false,
				label: { color: t.text, fontSize: 11, width: 170, overflow: 'truncate' },
				lineStyle: { color: 'gradient', opacity: t.dark ? .35 : .3, curveness: .5 },
				emphasis: { focus: 'adjacency', lineStyle: { opacity: .6 } },
				data,
				links: links.map(([ s, n, v ]) => ({ source: 's:' + s, target: 'n:' + n, value: v }))
			} ]
		}));
	},

	drawHosts(st) {
		const c = this.chart('hosts', this.hostsNode);
		if (!c)
			return;
		const t = this.theme;
		const top = st.top.host.slice().reverse();
		c.off('click');
		c.on('click', (p) => this.drill('host', top[p.dataIndex][0]));
		this.paint(c, Object.assign(this.baseOption(), {
			grid: { left: 8, right: 24, top: 28, bottom: 4, containLabel: true },
			legend: { top: 0, right: 0, textStyle: { color: t.text } },
			tooltip: Object.assign(this.baseOption().tooltip, {
				trigger: 'axis', axisPointer: { type: 'shadow' },
				formatter: (ps) => '<b>%s</b><br>'.format(top[ps[0].dataIndex][0]) +
					ps.map((p) => '%s %s　<b>%s</b>'.format(p.marker, p.seriesName, fmt(p.value))).join('<br>')
			}),
			xAxis: Object.assign({ type: 'value', axisLabel: { color: t.muted, formatter: (v) => fmt(v) } },
				{ splitLine: { lineStyle: { color: t.line, type: 'dashed' } } }),
			yAxis: Object.assign({ type: 'category', data: top.map((h) => h[0].length > 30 ? '…' + h[0].slice(-29) : h[0]) },
				this.axisStyle(), { splitLine: { show: false }, axisLabel: { color: t.text, fontSize: 11 } }),
			series: [
				{ name: '上传', type: 'bar', stack: 't', data: top.map((h) => h[1]), itemStyle: { color: COLOR_UP }, barMaxWidth: 14 },
				{ name: '下载', type: 'bar', stack: 't', data: top.map((h) => h[2]), itemStyle: { color: COLOR_DOWN, borderRadius: [ 0, 3, 3, 0 ] }, barMaxWidth: 14 }
			]
		}));
	},

	drawHistory(st) {
		if (!window.echarts)
			return;
		this.drawTrend(st);
		this.drawNodes(st);
		this.drawFlow(st);
		this.drawHosts(st);
	},

	renderCell(d, v, stats) {
		const name = d == 'src' ? stats.names[v] : null;
		const text = name ? [ name, E('br'), E('small', { class: 'mt-muted' }, v) ] : v;
		if (v == stats.inner)
			return E('td', { class: 'td mt-muted', title: 'mihomo 自身发起的连接（链式代理承载、DoH 等），与设备流量重复，不计入合计' }, text);
		return E('td', { class: 'td' }, E('a', {
			href: '#',
			click: (ev) => {
				ev.preventDefault();
				this.drill(d, v);
			}
		}, text));
	},

	renderTable(stats) {
		const dims = stats.dims;
		const sum = stats.up + stats.down || 1;
		const num = 'text-align:right;white-space:nowrap';
		const rows = stats.rows.map((r) => {
			const t = r.up + r.down;
			const inner = r.src == stats.inner;
			return E('tr', { class: 'tr' + (inner ? ' mt-muted' : '') }, [
				...dims.map((d) => this.renderCell(d, r[d], stats)),
				E('td', { class: 'td', style: num }, fmt(r.up)),
				E('td', { class: 'td', style: num }, fmt(r.down)),
				E('td', { class: 'td', style: num }, E('strong', {}, fmt(t))),
				E('td', { class: 'td', style: 'min-width:120px' }, inner ? '' : E('div', { class: 'mt-bar' }, [
					E('div', {}, E('div', { style: 'width:%.1f%%;background:linear-gradient(90deg,%s %.0f%%,%s %.0f%%)'.format(
						Math.min(100, t / sum * 100), COLOR_UP, r.up / (t || 1) * 100, COLOR_DOWN, r.up / (t || 1) * 100) })),
					E('small', { style: 'width:3.5em;text-align:right' }, '%.1f%%'.format(t / sum * 100))
				]))
			]);
		});

		return E('div', { class: 'mt-table-wrap' }, E('table', { class: 'table' }, [
			E('tr', { class: 'tr table-titles' }, [
				...dims.map((d) => E('th', { class: 'th' }, LABEL[d])),
				E('th', { class: 'th', style: num }, '上传'),
				E('th', { class: 'th', style: num }, '下载'),
				E('th', { class: 'th', style: num }, '合计'),
				E('th', { class: 'th' }, '占比')
			]),
			...(rows.length ? rows : [ E('tr', { class: 'tr placeholder' }, E('td', { class: 'td' }, E('em', {}, '暂无数据'))) ])
		]));
	},

	renderHistory(st) {
		this.applyTheme();
		dom.content(this.cardsNode, this.renderCards(st));
		dom.content(this.tableTitleNode, st.count > st.rows.length
			? '明细（共 %d 行，显示流量最大的 %d 行）'.format(st.count, st.rows.length)
			: '明细（共 %d 行）'.format(st.count));
		dom.content(this.tableNode, this.renderTable(st));
		this.trendTitleNode.textContent = st.step == 'day' ? '每日流量' : '每小时流量';
		this.drawHistory(st);
	},

	/* ---------- 实时 ---------- */

	liveStart() {
		if (this.ws || location.protocol == 'https:')
			return;
		this.ws = {};
		this.live = this.live || { t: [], up: [], down: [] };

		callController().then((ctl) => {
			if (!this.ws)
				return;
			const base = 'ws://%s:%d'.format(location.hostname, ctl.port);
			const q = ctl.secret ? '?token=' + encodeURIComponent(ctl.secret) : '';
			const open = (path, extra, onmsg) => {
				const ws = new WebSocket(base + path + q + (extra ? (q ? '&' : '?') + extra : ''));
				ws.onmessage = (ev) => onmsg(JSON.parse(ev.data));
				ws.onerror = () => this.liveError('连接 mihomo WebSocket 失败（%s）'.format(path));
				return ws;
			};
			this.ws.traffic = open('/traffic', '', (m) => this.onTraffic(m));
			this.ws.memory = open('/memory', '', (m) => { this.liveMem = m.inuse; });
			this.ws.conns = open('/connections', 'interval=2000', (m) => this.onConnections(m));
		});
	},

	liveStop() {
		for (const ws of Object.values(this.ws || {}))
			ws.close();
		this.ws = null;
		this.liveDotNode?.classList.remove('mt-live');
		this.prevConns = null;
	},

	liveError(msg) {
		dom.content(this.liveMsgNode, E('em', { style: 'color:#d1242f' }, msg));
	},

	onTraffic(m) {
		const L_ = this.live;
		const now = new Date();
		L_.t.push('%02d:%02d:%02d'.format(now.getHours(), now.getMinutes(), now.getSeconds()));
		L_.up.push(m.up);
		L_.down.push(m.down);
		if (L_.t.length > LIVE_SECONDS) {
			L_.t.shift(); L_.up.shift(); L_.down.shift();
		}
		this.liveNow = m;
		this.liveDotNode?.classList.add('mt-live');
		this.drawLive();
	},

	onConnections(m) {
		const now = Date.now();
		const prev = this.prevConns;
		const next = {};
		const bySrc = {};
		const conns = [];
		const names = this.stats?.names || {};

		for (const c of m.connections || []) {
			next[c.id] = [ c.upload, c.download ];
			if (!prev)
				continue;
			const p = prev.map[c.id] || [ c.upload, c.download ];
			const dt = (now - prev.at) / 1000;
			const ru = Math.max(0, c.upload - p[0]) / dt, rd = Math.max(0, c.download - p[1]) / dt;
			const md = c.metadata;
			const inner = md.type == 'Inner';
			const src = inner ? this.stats?.inner : md.sourceIP;
			if (!inner) {
				const s = bySrc[src] = bySrc[src] || { up: 0, down: 0, n: 0 };
				s.up += ru; s.down += rd; s.n++;
			}
			conns.push({ src, inner, host: md.host || md.sniffHost || md.destinationIP, port: md.destinationPort,
				node: (c.chains || [])[0], rule: c.rule, up: ru, down: rd, total: c.upload + c.download });
		}
		this.prevConns = { at: now, map: next };
		this.liveConnCount = (m.connections || []).length;
		if (!prev)
			return;

		const devs = Object.entries(bySrc).sort((a, b) => (b[1].up + b[1].down) - (a[1].up + a[1].down));
		const maxDev = devs.length ? devs[0][1].up + devs[0][1].down || 1 : 1;
		const num = 'text-align:right;white-space:nowrap';

		dom.content(this.liveDevNode, E('div', { class: 'mt-table-wrap' }, E('table', { class: 'table' }, [
			E('tr', { class: 'tr table-titles' }, [
				E('th', { class: 'th' }, '设备'), E('th', { class: 'th', style: num }, '上传'),
				E('th', { class: 'th', style: num }, '下载'), E('th', { class: 'th', style: num }, '连接'), E('th', { class: 'th' }, '')
			]),
			...devs.slice(0, 15).map(([ ip, s ]) => E('tr', { class: 'tr' }, [
				E('td', { class: 'td' }, names[ip] ? [ names[ip], E('br'), E('small', { class: 'mt-muted' }, ip) ] : ip),
				E('td', { class: 'td', style: num + ';color:' + COLOR_UP }, rate(s.up)),
				E('td', { class: 'td', style: num + ';color:' + COLOR_DOWN }, rate(s.down)),
				E('td', { class: 'td', style: num }, String(s.n)),
				E('td', { class: 'td', style: 'min-width:90px' }, E('div', { class: 'mt-bar' },
					E('div', {}, E('div', { style: 'width:%.1f%%;background:%s'.format((s.up + s.down) / maxDev * 100, COLOR_DOWN) }))))
			]))
		])));

		const top = conns.filter((c) => c.up + c.down > 0).sort((a, b) => (b.up + b.down) - (a.up + a.down)).slice(0, 20);
		dom.content(this.liveConnNode, E('div', { class: 'mt-table-wrap' }, E('table', { class: 'table' }, [
			E('tr', { class: 'tr table-titles' }, [
				E('th', { class: 'th' }, '目标'), E('th', { class: 'th' }, '设备'), E('th', { class: 'th' }, '出口 / 规则'),
				E('th', { class: 'th', style: num }, '上传'), E('th', { class: 'th', style: num }, '下载'), E('th', { class: 'th', style: num }, '累计')
			]),
			...(top.length ? top.map((c) => E('tr', { class: 'tr' + (c.inner ? ' mt-muted' : '') }, [
				E('td', { class: 'td' }, '%s:%s'.format(c.host, c.port)),
				E('td', { class: 'td' }, c.inner ? c.src : (names[c.src] || c.src)),
				E('td', { class: 'td' }, [ c.node || '-', E('br'), E('small', { class: 'mt-muted' }, c.rule || '') ]),
				E('td', { class: 'td', style: num + ';color:' + COLOR_UP }, rate(c.up)),
				E('td', { class: 'td', style: num + ';color:' + COLOR_DOWN }, rate(c.down)),
				E('td', { class: 'td', style: num }, fmt(c.total))
			])) : [ E('tr', { class: 'tr placeholder' }, E('td', { class: 'td' }, E('em', {}, '当前没有活跃传输'))) ])
		])));
	},

	drawLive() {
		if (!this.liveChartNode || !this.live)
			return;
		const n = this.liveNow || { up: 0, down: 0 };
		const card = (k, v, color) => E('div', { class: 'mt-card' }, [
			E('div', { class: 'mt-k' }, k), E('div', { class: 'mt-v', style: color ? 'color:' + color : '' }, v), E('div', { class: 'mt-s' }, ' ')
		]);
		dom.content(this.liveCardsNode, [
			card('上传速率', rate(n.up), COLOR_UP),
			card('下载速率', rate(n.down), COLOR_DOWN),
			card('活跃连接', this.liveConnCount != null ? String(this.liveConnCount) : '-'),
			card('mihomo 内存', this.liveMem != null ? fmt(this.liveMem) : '-')
		]);

		const c = this.chart('live', this.liveChartNode);
		if (!c)
			return;
		const t = this.theme;
		const area = (color) => ({ color: new window.echarts.graphic.LinearGradient(0, 0, 0, 1,
			[ { offset: 0, color: color + (t.dark ? '88' : '66') }, { offset: 1, color: color + '05' } ]) });
		this.paint(c, Object.assign(this.baseOption(), {
			animation: false,
			grid: { left: 8, right: 16, top: 30, bottom: 8, containLabel: true },
			legend: { top: 0, textStyle: { color: t.text } },
			tooltip: Object.assign(this.baseOption().tooltip, {
				trigger: 'axis',
				formatter: (ps) => '<b>%s</b><br>'.format(ps[0].axisValue) +
					ps.map((p) => '%s %s　<b>%s</b>'.format(p.marker, p.seriesName, rate(p.value))).join('<br>')
			}),
			xAxis: Object.assign({ type: 'category', data: this.live.t, boundaryGap: false }, this.axisStyle(), { splitLine: { show: false } }),
			yAxis: { type: 'value', axisLabel: { color: t.muted, formatter: (v) => rate(v) }, splitLine: { lineStyle: { color: t.line, type: 'dashed' } } },
			series: [
				{ name: '上传', type: 'line', data: this.live.up, smooth: true, showSymbol: false, itemStyle: { color: COLOR_UP }, lineStyle: { width: 1.5 }, areaStyle: area(COLOR_UP) },
				{ name: '下载', type: 'line', data: this.live.down, smooth: true, showSymbol: false, itemStyle: { color: COLOR_DOWN }, lineStyle: { width: 1.5 }, areaStyle: area(COLOR_DOWN) }
			]
		}));
	},

	/* ---------- 页面 ---------- */

	panel(title, body, extra) {
		return E('div', { class: 'mt-panel' + (extra ? ' ' + extra : '') }, [ E('h4', {}, title), body ]);
	},

	render([ status, stats, echarts ]) {
		this.stats = stats;
		this.root = E('div', { class: 'cbi-map mt-root' });
		this.applyTheme();

		this.statusNode = E('div', { class: 'mt-status' }, this.renderStatus(status));
		this.toolbarNode = E('div', { class: 'mt-toolbar' }, this.renderToolbar());
		this.chipsNode = E('div', { class: 'mt-chips' }, this.renderChips());
		this.cardsNode = E('div', { class: 'mt-cards' });
		this.trendTitleNode = E('span', {}, '');
		this.trendNode = E('div', { class: 'mt-chart mt-tall' });
		this.nodesNode = E('div', { class: 'mt-chart' });
		this.flowNode = E('div', { class: 'mt-chart' });
		this.hostsNode = E('div', { class: 'mt-chart mt-tall' });
		this.tableTitleNode = E('span', {}, '明细');
		this.tableNode = E('div');

		this.historyNode = E('div', {}, [
			this.toolbarNode, this.chipsNode, this.cardsNode,
			// E() 不展开嵌套数组，这里要摊平
			...(echarts ? [
				E('div', { class: 'mt-panel' }, [ E('h4', {}, this.trendTitleNode), this.trendNode ]),
				E('div', { class: 'mt-grid' }, [
					this.panel('出口节点占比', this.nodesNode),
					this.panel('设备 → 出口节点', this.flowNode)
				]),
				this.panel('流量最大的目标', this.hostsNode)
			] : [ E('p', { style: 'color:#d1242f' }, '图表库加载失败，只显示表格。') ]),
			E('div', { class: 'mt-panel' }, [ E('h4', {}, this.tableTitleNode), this.tableNode ])
		]);

		this.liveMsgNode = E('div', { class: 'mt-muted', style: 'margin:.3em 0 .8em' },
			location.protocol == 'https:'
				? E('em', { style: 'color:#d1242f' }, '当前通过 HTTPS 访问 LuCI，浏览器不允许连接 mihomo 的 ws:// 接口，实时面板不可用。')
				: '浏览器直连 mihomo 的 WebSocket 接口：速率每秒更新，设备和连接每 2 秒更新；离开本页签即断开。');
		this.liveCardsNode = E('div', { class: 'mt-cards' });
		this.liveChartNode = E('div', { class: 'mt-chart' });
		this.liveDevNode = E('div', {}, E('em', { class: 'mt-muted' }, '等待数据…'));
		this.liveConnNode = E('div', {}, E('em', { class: 'mt-muted' }, '等待数据…'));
		const liveNode = E('div', {}, [
			this.liveMsgNode, this.liveCardsNode,
			echarts ? this.panel('最近 %d 秒速率'.format(LIVE_SECONDS), this.liveChartNode) : '',
			E('div', { class: 'mt-grid' }, [
				this.panel('设备实时速率', this.liveDevNode),
				this.panel('最活跃的连接', this.liveConnNode)
			])
		]);

		// 不用 LuCI 的 cbi-tabmenu：它在 Argon 下是悬在面板外的灰块。页签、状态和内容放进同一个 cbi-section
		const panes = { history: this.historyNode, live: liveNode };
		const tabButtons = {};
		let active = 'history';
		try { active = sessionStorage.getItem('mihomo-traffic.tab') == 'live' ? 'live' : 'history'; } catch (e) {}

		// 实时面板只在可见时保持 WebSocket 连接
		// 历史统计在后台期间跳过的轮询，回到前台时补一次
		const sync = () => {
			if (active == 'live' && !document.hidden)
				this.liveStart();
			else
				this.liveStop();
			if (active == 'history' && !document.hidden && this.stale)
				this.refresh(true);
		};
		const select = (name) => {
			active = name;
			try { sessionStorage.setItem('mihomo-traffic.tab', name); } catch (e) {}
			for (const k in panes) {
				panes[k].style.display = k == name ? '' : 'none';
				tabButtons[k].classList.toggle('mt-on', k == name);
			}
			sync();
		};
		this.liveDotNode = E('span', { class: 'mt-dot' });
		tabButtons.history = E('button', { class: 'mt-tab', click: () => select('history') }, '历史统计');
		tabButtons.live = E('button', { class: 'mt-tab', click: () => select('live') }, [ '实时', this.liveDotNode ]);

		dom.append(this.root, [
			E('style', {}, CSS),
			E('h2', {}, 'Mihomo 流量'),
			E('div', { class: 'cbi-map-descr' }, '按来源设备、出口节点和目标统计经过 OpenClash（mihomo）的连接流量，直连也包含在内；(内部) 是 mihomo 自身的连接，与设备流量重复，不计入合计。'),
			E('div', { class: 'cbi-section' }, [
				E('div', { class: 'mt-tabbar' }, [ E('div', { class: 'mt-tabs' }, [ tabButtons.history, tabButtons.live ]), this.statusNode ]),
				this.historyNode,
				liveNode
			])
		]);

		document.addEventListener('visibilitychange', sync);
		window.addEventListener('beforeunload', () => this.liveStop());
		select(active);

		this.watchTheme();
		// 不用 requestAnimationFrame：后台标签页里它不会触发，首屏就一直空着
		setTimeout(() => this.renderHistory(stats), 0);
		poll.add(() => this.refresh(true), 60);

		return this.root;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
