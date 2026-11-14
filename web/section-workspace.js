import { escapeHTML as esc, demoSeries, download } from './store.js';
import { sectionMetrics, profileWaterPolygons } from './engineering.js';
import { createSectionModel } from './section-model.js';

const number = (value, digits = 2) => Number(value).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export function profileSVG(metrics, level, availableWidth = 860) {
  const { profile } = metrics;
  if (profile.length < 2) return '<div class="empty">该断面的有效测点不足，无法生成剖面。</div>';
  const width = Math.max(320, Math.min(1100, availableWidth)), height = 236, margin = { left: 62, right: 28, top: 25, bottom: 40 };
  const low = Math.min(metrics.minElevation, level) - .25, high = Math.max(metrics.maxElevation, level) + .3;
  const x = d => margin.left + d / Math.max(metrics.measuredWidth, .01) * (width - margin.left - margin.right);
  const y = h => margin.top + (high - h) / Math.max(high - low, .1) * (height - margin.top - margin.bottom);
  const bed = profile.map(p => `${x(p.distance)},${y(p.elevation)}`).join(' ');
  const water = profileWaterPolygons(profile, level).map(poly => `<polygon points="${poly.map(p => `${x(p.distance)},${y(p.elevation)}`).join(' ')}" fill="#4d97d3" fill-opacity=".27"/>`).join('');
  const grid = Array.from({ length: 5 }, (_, i) => {
    const h = low + (high - low) * i / 4, d = metrics.measuredWidth * i / 4;
    return `<path d="M${margin.left} ${y(h)}H${width - margin.right}" stroke="#1c2b40"/><text x="${margin.left - 10}" y="${y(h) + 4}" text-anchor="end">${h.toFixed(2)}</text><text x="${x(d)}" y="${height - 17}" text-anchor="middle">${d.toFixed(1)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="原始断面剖面，参考水位 ${level.toFixed(2)} 米，断面内过水面积 ${metrics.area.toFixed(2)} 平方米"><g font-size="11" fill="#8199b9" font-family="inherit">${grid}<text x="${margin.left}" y="13">吴淞高程 / m</text><text x="${width - margin.right}" y="${height - 1}" text-anchor="end">沿实测断面累计距离 / m</text></g>${water}<polyline points="${bed}" fill="none" stroke="#d8c59b" stroke-width="2.1"/><path d="M${margin.left} ${y(level)}H${width - margin.right}" stroke="#79b6ed" stroke-dasharray="6 5"/><text x="${width - margin.right}" y="${y(level) - 7}" text-anchor="end" fill="#a6d1f4" font-size="11">参考水面 ${level.toFixed(2)} m</text>${profile.filter((_, i) => i % Math.max(1, Math.floor(profile.length / 60)) === 0).map(p => `<circle cx="${x(p.distance)}" cy="${y(p.elevation)}" r="2.3" fill="#efdbb2"/>`).join('')}</svg>`;
}

export function mountSectionWorkspace(container, ctx) {
  const all = ctx.sections;
  const rivers = [...new Set(all.map(s => s.river))];
  const initial = rivers.includes(ctx.initialRiver) ? ctx.initialRiver : rivers.includes('九曲河') ? '九曲河' : rivers[0];
  const stationIds = [...new Set(ctx.observations.map(r => r.station_id))];
  container.innerHTML = `<div class="page-head"><div><div class="eyebrow">ENGINEERING WORKSPACE · MEASURED GEOMETRY</div><h1>河道三维研判</h1><p>从原始测点到河槽、参考水面与断面指标，空间与数值同步核对。</p></div><div class="head-actions"><span class="pill blue">原始测点 · 吴淞高程</span><button class="button" id="section-snapshot">导出研判快照 ↓</button></div></div>
  <div class="engineering-workbench"><aside class="panel engineering-controls">
   <div class="engineering-control-title"><span class="eyebrow">MODEL EXPLORER</span><h3>河道与断面</h3></div>
   <div class="field"><label for="river-select">研究河道</label><select id="river-select">${rivers.map(r => `<option${r === initial ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
   <div class="field"><label for="section-select">联动断面</label><select id="section-select"></select></div>
   <div class="engineering-mini-stats" id="section-source-count"></div>
   <div class="engineering-divider"></div><h3>显示设置</h3>
   <div class="segmented model-scope" aria-label="模型显示范围"><button class="active" data-scope="corridor">河段模型</button><button data-scope="single">单断面</button></div>
   <div class="field"><label for="exaggeration">垂向显示比例 <output id="exag-value">5×</output></label><input id="exaggeration" type="range" min="1" max="12" value="5"><p class="hint">仅调整视觉比例，指标始终按原始尺寸计算。</p></div>
   <div class="model-layer-list">${[['bed', '插值河床'], ['water', '断面内参考水面'], ['lines', '实测断面线'], ['points', '原始测点']].map(([key, text]) => `<label><input type="checkbox" data-model-layer="${key}" checked><span>${text}</span></label>`).join('')}</div>
   <div class="engineering-divider"></div><h3>参考水面</h3>
   <div class="field"><label for="reference-source">过程来源</label><select id="reference-source"><option value="manual">手动设置参考水位</option><option value="demo">${ctx.runs.length ? '最近情景过程（演示）' : '演示参考过程'}</option>${stationIds.map(id => `<option value="station:${esc(id)}">站点参考 · ${esc(ctx.network.stations.find(s => s.id === id)?.name ?? id)}</option>`).join('')}</select></div>
   <div class="field"><label for="section-water">参考水位 / m <output id="water-value">3.50</output></label><input id="section-water" type="range" min="0" max="6" step=".01" value="3.5"></div>
   <p class="engineering-source-note" id="section-reference-note">手动参考值，不代表实时水位。</p>
   <button class="button engineering-ask" id="section-ask">结合当前断面询问助手 ↗</button>
   <details class="engineering-method"><summary>数据来源与计算边界</summary><p>测点来自 river.txt；保留本地平面坐标及吴淞高程。断面间按原文件顺序插值，仅用于几何观察，未验证水流连接关系。</p><p>面积、宽度和水力半径按当前断面折线与参考水面计算；不代表流量预报或淹没范围。原始坐标未经高程转换，不叠加到卫星地形上。</p></details>
  </aside><div class="engineering-deck">
   <section class="panel model-panel"><div class="panel-head"><div class="panel-title"><span id="model-title"></span><span class="panel-sub">3D SECTION MODEL</span></div><div class="model-view-tools" aria-label="模型视角"><button class="active" data-model-view="oblique">斜视</button><button data-model-view="plan">俯视</button><button data-model-view="side">断面正视</button><button data-model-view="extent">全河段</button><button id="model-reset" title="复位模型">复位</button></div></div>
    <div class="engineering-model" id="section-scene"><div class="model-corner"><span class="model-live-dot"></span><span id="model-renderer-label">三维引擎初始化</span></div><div class="model-coordinate">本地平面坐标 / m<br>高程：吴淞高程 / m</div><div class="model-legend"><span><i style="background:#dac69b"></i>实测点 / 断面</span><span><i style="background:#436078"></i>插值河床</span><span><i style="background:#579ad0"></i>参考水面</span></div><div class="model-gesture">拖动旋转 · 右键平移 · 滚轮缩放</div></div>
    <div class="model-timeline"><button class="timeline-play" id="section-play" aria-label="播放参考水位过程">▶</button><div class="timeline-caption"><b id="timeline-label">手动参考</b><small id="timeline-source-label">开启演示，体验参考水位变化</small></div><input type="range" id="section-time" min="0" max="24" value="0" disabled aria-label="参考水位过程时刻"><select id="playback-speed" aria-label="回放速度"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select><span id="playback-badge" class="pill muted">手动参考</span></div>
   </section>
   <div class="section-measures" id="section-measures"></div>
   <section class="panel profile-panel"><div class="panel-head"><div class="panel-title">联动横断面<span class="panel-sub" id="profile-name"></span></div><button class="panel-link" id="export-sections">导出实测点 ↓</button></div><div id="section-profile" class="section-profile"></div><div class="profile-footnote"><span><i class="legend-dot amber"></i>原始测点连线</span><span><i class="legend-dot blue"></i>参考水面</span><b id="section-bank-status"></b></div></section>
  </div></div>`;
  const q = s => container.querySelector(s);
  let riverSections = [], selected, model, scope = 'corridor', entries = [], timer = null, playing = false, dead = false;
  const stop = () => { clearTimeout(timer); timer = null; playing = false; q('#section-play').textContent = '▶'; q('#section-play').setAttribute('aria-label', '播放参考水位过程'); };
  const level = () => Number(q('#section-water').value);
  function showMetrics() {
    if (!selected) return;
    const wl = level(), metrics = sectionMetrics(selected, wl);
    q('#water-value').textContent = wl.toFixed(2);
    q('#profile-name').textContent = `${selected.river} · 断面 ${selected.section}`;
    q('#section-profile').innerHTML = profileSVG(metrics, wl, q('#section-profile').clientWidth - 30);
    q('#section-measures').innerHTML = [['断面内过水面积', metrics.area, 'm²', '按实测折线积分'], ['断面内水面宽', metrics.wetWidth, 'm', '仅计实测范围'], ['水力半径 A/P', metrics.hydraulicRadius, 'm', '未估算流速、流量'], ['实测最低高程', metrics.minElevation, 'm', '吴淞高程']].map(([title, value, unit, note]) => `<div class="section-measure"><span>${title}</span><b>${number(value)}<small>${unit}</small></b><em>${note}</em></div>`).join('');
    q('#section-bank-status').textContent = metrics.openBanks ? '水面超出一侧实测边界，几何结果仅限断面内。' : '参考水面位于实测边界内';
    q('#section-bank-status').classList.toggle('attention', metrics.openBanks);
    q('#section-measures').dataset.area = String(metrics.area);
    model?.setWaterLevel(wl);
  }
  function rebuildModel() {
    model?.destroy();
    q('#model-title').textContent = `${q('#river-select').value} · ${scope === 'single' ? '断面 ' + selected.section : riverSections.length + ' 个断面'}`;
    model = createSectionModel(q('#section-scene'), scope === 'single' ? [selected] : riverSections, { exaggeration: Number(q('#exaggeration').value), waterLevel: level() });
    q('#model-renderer-label').textContent = q('#section-scene').dataset.renderer === 'webgl' ? '三维几何已就绪' : '兼容投影模式';
    for (const input of container.querySelectorAll('[data-model-layer]')) model.setLayer(input.dataset.modelLayer, input.checked);
    model.selectSection(selected.id); showMetrics();
  }
  function chooseRiver() {
    stop();
    riverSections = all.filter(s => s.river === q('#river-select').value);
    q('#section-select').innerHTML = riverSections.map(s => `<option value="${esc(s.id)}">断面 ${esc(s.section)} · ${s.points.length} 个测点</option>`).join('');
    selected = riverSections[0];
    const points = riverSections.flatMap(s => s.points);
    q('#section-source-count').innerHTML = `<div><strong>${riverSections.length}</strong><span>实测断面</span></div><div><strong>${points.length.toLocaleString()}</strong><span>原始测点</span></div>`;
    const heights = points.map(p => p[2]);
    q('#section-water').min = String(Math.floor((Math.min(...heights) - .5) * 10) / 10);
    q('#section-water').max = String(Math.ceil((Math.max(...heights) + 1) * 10) / 10);
    ctx.onRiverChange?.(q('#river-select').value); rebuildModel();
    if (q('#reference-source').value !== 'manual') chooseSource();
  }
  q('#river-select').onchange = chooseRiver;
  q('#section-select').onchange = () => { selected = riverSections.find(s => s.id === q('#section-select').value); if (scope === 'single') rebuildModel(); else { model.selectSection(selected.id); showMetrics(); } };
  q('#section-water').oninput = () => { stop(); q('#reference-source').value = 'manual'; entries = []; updateTimeline(); showMetrics(); };
  q('#exaggeration').oninput = () => { q('#exag-value').textContent = q('#exaggeration').value + '×'; model.setExaggeration(Number(q('#exaggeration').value)); };
  for (const button of container.querySelectorAll('[data-scope]')) button.onclick = () => { scope = button.dataset.scope; for (const b of container.querySelectorAll('[data-scope]')) b.classList.toggle('active', b === button); rebuildModel(); };
  for (const button of container.querySelectorAll('[data-model-view]')) button.onclick = () => { for (const b of container.querySelectorAll('[data-model-view]')) b.classList.toggle('active', b === button); model.setView(button.dataset.modelView); };
  q('#model-reset').onclick = () => model.setView('oblique');
  for (const input of container.querySelectorAll('[data-model-layer]')) input.onchange = () => model.setLayer(input.dataset.modelLayer, input.checked);
  function updateTimeline() {
    const mode = q('#reference-source').value, index = Number(q('#section-time').value), entry = entries[index];
    q('#section-time').disabled = entries.length < 2;
    q('#playback-badge').textContent = mode === 'manual' ? '手动参考' : mode === 'demo' ? '演示过程' : '站点参考';
    q('#playback-badge').className = 'pill ' + (mode === 'demo' ? 'amber' : 'muted');
    q('#timeline-label').textContent = entry ? entry.label : '手动参考';
    q('#timeline-source-label').textContent = entries.length ? `${Math.min(index + 1, entries.length)} / ${entries.length} 个时刻` : '开启演示，体验参考水位变化';
    q('#section-reference-note').textContent = mode === 'manual' ? '手动参考值，不代表实时水位。' : mode === 'demo' ? '演示公式输出，仅观察参考水面变化；不代表洪水演进或计算淹没范围。' : '使用选定站点资料作为参考，未证明站点与断面位于同一水力位置。';
    if (entry) { q('#section-water').value = String(entry.level); showMetrics(); }
  }
  function chooseSource() {
    stop();
    const mode = q('#reference-source').value;
    if (mode === 'demo') entries = (ctx.runs[0]?.series ?? demoSeries(0, { initial: 3.5 })).map(p => ({ level: p.level, label: '+' + p.hour + ' h' }));
    else if (mode.startsWith('station:')) entries = ctx.observations.filter(r => r.station_id === mode.slice(8) && Number.isFinite(Number(r.water_level)) && Number.isFinite(Date.parse(r.monitor_time))).sort((a, b) => Date.parse(a.monitor_time) - Date.parse(b.monitor_time)).map(r => ({ level: Number(r.water_level), label: new Date(r.monitor_time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }));
    else entries = [];
    if (entries.length) { q('#section-water').min = String(Math.min(Number(q('#section-water').min), ...entries.map(p => p.level))); q('#section-water').max = String(Math.max(Number(q('#section-water').max), ...entries.map(p => p.level))); }
    q('#section-time').max = String(Math.max(0, entries.length - 1)); q('#section-time').value = '0'; updateTimeline();
  }
  q('#reference-source').onchange = chooseSource;
  q('#section-time').oninput = () => { stop(); updateTimeline(); };
  function tick() {
    if (!playing || dead) return;
    const next = Number(q('#section-time').value) + 1;
    if (next >= entries.length) { stop(); return; }
    q('#section-time').value = String(next); updateTimeline();
    timer = setTimeout(tick, 850 / Number(q('#playback-speed').value));
  }
  q('#section-play').onclick = () => {
    if (playing) { stop(); return; }
    if (!entries.length) { q('#reference-source').value = 'demo'; chooseSource(); }
    if (entries.length < 2) { ctx.toast('当前资料不足两个时刻，暂不能回放。'); return; }
    if (Number(q('#section-time').value) >= entries.length - 1) q('#section-time').value = '0';
    playing = true; q('#section-play').textContent = 'Ⅱ'; q('#section-play').setAttribute('aria-label', '暂停参考水位过程'); timer = setTimeout(tick, 150);
  };
  q('#export-sections').onclick = () => download('河道原始断面.csv', '\uFEFFRiverName,SectionID,PlaneX,PlaneY,Elevation\n' + riverSections.flatMap(s => s.points.map(p => [s.river, s.section, ...p].join(','))).join('\n'), 'text/csv;charset=utf-8');
  q('#section-snapshot').onclick = () => { const m = sectionMetrics(selected, level()); download('断面研判快照.json', JSON.stringify({ generatedAt: new Date().toISOString(), river: selected.river, section: selected.section, referenceWaterLevel: level(), referenceSource: q('#reference-source').value, originalSection: selected, verticalDisplayExaggeration: Number(q('#exaggeration').value), withinMeasuredSection: { area: m.area, wetWidth: m.wetWidth, perimeter: m.perimeter, hydraulicRadius: m.hydraulicRadius, openBanks: m.openBanks }, datum: '吴淞高程', note: '几何参考研判，不是水动力求解、流量或淹没范围预报。' }, null, 2)); };
  q('#section-ask').onclick = () => ctx.onAsk(`当前查看${selected.river}断面${selected.section}，参考水位${level().toFixed(2)}米（吴淞高程）。请说明如何理解断面内过水面积、水力半径，以及参考水面和插值河床的适用边界。`);
  chooseRiver();
  const resize = new ResizeObserver(() => { if (selected) q('#section-profile').innerHTML = profileSVG(sectionMetrics(selected, level()), level(), q('#section-profile').clientWidth - 30); });
  resize.observe(q('#section-profile'));
  return () => { dead = true; stop(); resize.disconnect(); model?.destroy(); };
}
