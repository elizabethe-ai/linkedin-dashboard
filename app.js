/* ──────────────────────────────────────────────────────────────
   LinkedIn Analytics Dashboard — app.js
   Uses: PapaParse (CSV), Chart.js + date-fns adapter
────────────────────────────────────────────────────────────── */

'use strict';

// ── Column aliases ───────────────────────────────────────────
// Maps internal keys → possible CSV column name variants
const COL = {
  date:        ['date', 'post publish date', 'published date', 'publish date', 'day'],
  title:       ['post title', 'title', 'content', 'post content', 'description', 'post url', 'url', 'link'],
  impressions: ['impressions', 'total impressions', 'post impressions'],
  clicks:      ['clicks', 'link clicks', 'total clicks'],
  likes:       ['likes', 'reactions', 'total reactions', 'post reactions'],
  comments:    ['comments', 'total comments', 'post comments'],
  shares:      ['shares', 'reposts', 'total shares'],
  engagement:  ['engagement rate', 'engagement rate (%)', 'engagement rate(%)', 'engagement (%)'],
  ctr:         ['click-through rate', 'click through rate', 'ctr'],
};

// ── State ────────────────────────────────────────────────────
let allRows   = [];   // parsed, normalised rows
let filtered  = [];   // rows after date-range filter
let charts    = {};   // Chart instances keyed by id

// ── Colour palette for charts ─────────────────────────────────
const PALETTE = {
  blue:   { line: '#0A66C2', fill: 'rgba(10,102,194,0.12)' },
  green:  { line: '#057642', fill: 'rgba(5,118,66,0.12)'   },
  purple: { line: '#6B46C1', fill: 'rgba(107,70,193,0.12)' },
  orange: { line: '#C26A0A', fill: 'rgba(194,106,10,0.12)' },
};

// ── DOM refs ─────────────────────────────────────────────────
const uploadScreen  = document.getElementById('uploadScreen');
const dashboard     = document.getElementById('dashboard');
const headerActions = document.getElementById('headerActions');
const uploadZone    = document.getElementById('uploadZone');
const fileInput     = document.getElementById('fileInput');
const resetBtn      = document.getElementById('resetBtn');
const exportBtn     = document.getElementById('exportBtn');
const loadSampleBtn = document.getElementById('loadSampleBtn');
const dateRangeLabel= document.getElementById('dateRangeLabel');
const tableSearch   = document.getElementById('tableSearch');
const tableSort     = document.getElementById('tableSort');
const toastContainer= document.getElementById('toastContainer');

// ── Boot ─────────────────────────────────────────────────────
fileInput.addEventListener('change', e => handleFile(e.target.files[0]));
resetBtn.addEventListener('click', resetDashboard);
loadSampleBtn.addEventListener('click', e => { e.preventDefault(); loadSampleData(); });
exportBtn.addEventListener('click', exportCharts);
tableSearch.addEventListener('input', renderTable);
tableSort.addEventListener('change', renderTable);

// Drag-and-drop
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) handleFile(f);
});

// Click anywhere on the zone (not just the label) to open file picker
uploadZone.addEventListener('click', e => {
  if (e.target !== fileInput) fileInput.click();
});

// Date range filters
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyDateFilter(btn.dataset.range);
  });
});

// ── File handling ─────────────────────────────────────────────
function handleFile(file) {
  if (!file) return;
  if (!file.name.endsWith('.csv')) {
    showToast('Please upload a CSV file.', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = e => parseCSV(e.target.result);
  reader.readAsText(file);
}

function parseCSV(text) {
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: h => h.trim().toLowerCase(),
  });

  if (!result.data || result.data.length === 0) {
    showToast('The CSV appears to be empty.', 'error');
    return;
  }

  const rows = normaliseRows(result.data);
  if (rows.length === 0) {
    showToast('Could not detect required columns (date, impressions, etc.).', 'error');
    return;
  }

  allRows = rows;
  filtered = [...allRows];
  showDashboard();
}

// ── Column detection & row normalisation ──────────────────────
function findCol(headers, candidates) {
  for (const c of candidates) {
    const match = headers.find(h => h === c || h.includes(c));
    if (match) return match;
  }
  return null;
}

function parseNum(val) {
  if (val === undefined || val === null || val === '') return 0;
  const s = String(val).replace(/[,%]/g, '').trim();
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function parseDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  // Try yyyy-mm-dd, mm/dd/yyyy, dd/mm/yyyy, etc.
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  // Try dd-mm-yyyy
  const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (m) return new Date(`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`);
  return null;
}

function normaliseRows(raw) {
  if (!raw.length) return [];
  const headers = Object.keys(raw[0]);

  const colDate        = findCol(headers, COL.date);
  const colImpressions = findCol(headers, COL.impressions);

  // Need at least date + impressions
  if (!colDate && !colImpressions) return [];

  const colTitle    = findCol(headers, COL.title);
  const colLikes    = findCol(headers, COL.likes);
  const colComments = findCol(headers, COL.comments);
  const colShares   = findCol(headers, COL.shares);
  const colClicks   = findCol(headers, COL.clicks);
  const colEngagement = findCol(headers, COL.engagement);
  const colCtr      = findCol(headers, COL.ctr);

  const rows = [];
  for (const r of raw) {
    const date = parseDate(colDate ? r[colDate] : null);
    if (!date) continue;

    const impressions = parseNum(colImpressions ? r[colImpressions] : 0);
    const likes       = parseNum(colLikes       ? r[colLikes]       : 0);
    const comments    = parseNum(colComments    ? r[colComments]    : 0);
    const shares      = parseNum(colShares      ? r[colShares]      : 0);
    const clicks      = parseNum(colClicks      ? r[colClicks]      : 0);

    // Engagement rate: use column value or compute from impressions
    let engagement = parseNum(colEngagement ? r[colEngagement] : 0);
    if (!engagement && impressions > 0) {
      engagement = ((likes + comments + shares + clicks) / impressions) * 100;
    }

    const ctr = parseNum(colCtr ? r[colCtr] : 0);
    const title = colTitle ? String(r[colTitle] || '').trim() : '';

    rows.push({ date, title, impressions, likes, comments, shares, clicks, engagement, ctr, raw: r });
  }

  // Sort by date ascending
  rows.sort((a, b) => a.date - b.date);
  return rows;
}

// ── Dashboard rendering ───────────────────────────────────────
function showDashboard() {
  uploadScreen.style.display = 'none';
  dashboard.style.display    = 'block';
  headerActions.style.display = 'flex';

  // Reset filter
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-range="all"]').classList.add('active');

  updateAll();
}

function updateAll() {
  updateDateLabel();
  updateKPIs();
  updateCharts();
  renderTable();
}

function applyDateFilter(range) {
  if (range === 'all' || !allRows.length) {
    filtered = [...allRows];
  } else {
    const days = parseInt(range, 10);
    const cutoff = new Date(allRows[allRows.length - 1].date);
    cutoff.setDate(cutoff.getDate() - days);
    filtered = allRows.filter(r => r.date >= cutoff);
  }
  updateAll();
}

// ── KPI cards ─────────────────────────────────────────────────
function fmtNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(Math.round(n));
}

function sum(arr, key) { return arr.reduce((a, r) => a + r[key], 0); }
function avg(arr, key) { return arr.length ? sum(arr, key) / arr.length : 0; }

function updateDateLabel() {
  if (!filtered.length) { dateRangeLabel.textContent = '—'; return; }
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  dateRangeLabel.textContent = `${fmt(filtered[0].date)} – ${fmt(filtered[filtered.length - 1].date)} · ${filtered.length} post${filtered.length !== 1 ? 's' : ''}`;
}

function updateKPIs() {
  const totalImpressions = sum(filtered, 'impressions');
  const totalLikes       = sum(filtered, 'likes');
  const totalComments    = sum(filtered, 'comments');
  const totalShares      = sum(filtered, 'shares');
  const totalClicks      = sum(filtered, 'clicks');
  const avgEngagement    = avg(filtered, 'engagement');

  document.getElementById('valImpressions').textContent = fmtNum(totalImpressions);
  document.getElementById('valLikes').textContent       = fmtNum(totalLikes);
  document.getElementById('valComments').textContent    = fmtNum(totalComments);
  document.getElementById('valShares').textContent      = fmtNum(totalShares);
  document.getElementById('valClicks').textContent      = fmtNum(totalClicks);
  document.getElementById('valEngagement').textContent  = avgEngagement.toFixed(2) + '%';

  document.getElementById('subImpressions').textContent = `${filtered.length} posts`;
  document.getElementById('subLikes').textContent       = `${(totalLikes / (filtered.length || 1)).toFixed(1)} avg/post`;
  document.getElementById('subComments').textContent    = `${(totalComments / (filtered.length || 1)).toFixed(1)} avg/post`;
  document.getElementById('subShares').textContent      = `${(totalShares / (filtered.length || 1)).toFixed(1)} avg/post`;
  document.getElementById('subClicks').textContent      = `${(totalClicks / (filtered.length || 1)).toFixed(1)} avg/post`;
  document.getElementById('subEngagement').textContent  = `across ${filtered.length} posts`;
}

// ── Chart helpers ─────────────────────────────────────────────
const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 400 },
  plugins: {
    legend: {
      position: 'bottom',
      labels: { font: { family: 'Inter', size: 11 }, boxWidth: 10, padding: 16, usePointStyle: true },
    },
    tooltip: {
      backgroundColor: '#1D2226',
      titleFont: { family: 'Inter', size: 12, weight: '600' },
      bodyFont:  { family: 'Inter', size: 11 },
      padding: 10,
      cornerRadius: 6,
      callbacks: {
        label: ctx => {
          const val = ctx.parsed.y;
          const label = ctx.dataset.label || '';
          if (label.toLowerCase().includes('rate') || label.toLowerCase().includes('%')) {
            return ` ${label}: ${val.toFixed(2)}%`;
          }
          return ` ${label}: ${val.toLocaleString()}`;
        }
      }
    }
  },
  scales: {
    x: {
      type: 'time',
      time: { unit: 'day', tooltipFormat: 'MMM d, yyyy', displayFormats: { day: 'MMM d' } },
      grid: { display: false },
      ticks: { font: { family: 'Inter', size: 10 }, color: '#9CA3AF', maxTicksLimit: 8 },
      border: { display: false },
    },
    y: {
      grid: { color: '#F3F2EF' },
      ticks: { font: { family: 'Inter', size: 10 }, color: '#9CA3AF' },
      border: { display: false },
    }
  }
};

function makeLineDataset(label, data, color, fill = true) {
  return {
    label,
    data,
    borderColor: color.line,
    backgroundColor: fill ? color.fill : 'transparent',
    borderWidth: 2,
    pointRadius: data.length > 60 ? 0 : 3,
    pointHoverRadius: 5,
    pointBackgroundColor: color.line,
    fill,
    tension: 0.4,
  };
}

function toTimePoints(rows, key) {
  return rows.map(r => ({ x: r.date, y: r[key] }));
}

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

function createOrUpdate(id, config) {
  destroyChart(id);
  const ctx = document.getElementById(id).getContext('2d');
  charts[id] = new Chart(ctx, config);
}

// ── Build charts ──────────────────────────────────────────────
function updateCharts() {
  buildImpressionsChart();
  buildEngagementChart();
  buildEngagementRateChart();
  buildTopPostsChart();
}

function buildImpressionsChart() {
  createOrUpdate('impressionsChart', {
    type: 'line',
    data: {
      datasets: [makeLineDataset('Impressions', toTimePoints(filtered, 'impressions'), PALETTE.blue)],
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { display: false },
      },
      scales: {
        ...CHART_DEFAULTS.scales,
        y: {
          ...CHART_DEFAULTS.scales.y,
          ticks: {
            ...CHART_DEFAULTS.scales.y.ticks,
            callback: v => fmtNum(v),
          }
        }
      }
    }
  });
}

function buildEngagementChart() {
  createOrUpdate('engagementChart', {
    type: 'line',
    data: {
      datasets: [
        makeLineDataset('Likes',    toTimePoints(filtered, 'likes'),    PALETTE.green,  false),
        makeLineDataset('Comments', toTimePoints(filtered, 'comments'), PALETTE.purple, false),
        makeLineDataset('Shares',   toTimePoints(filtered, 'shares'),   PALETTE.orange, false),
      ]
    },
    options: CHART_DEFAULTS,
  });
}

function buildEngagementRateChart() {
  createOrUpdate('engagementRateChart', {
    type: 'line',
    data: {
      datasets: [makeLineDataset('Engagement Rate', toTimePoints(filtered, 'engagement'), PALETTE.orange)],
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { display: false },
      },
      scales: {
        ...CHART_DEFAULTS.scales,
        y: {
          ...CHART_DEFAULTS.scales.y,
          ticks: {
            ...CHART_DEFAULTS.scales.y.ticks,
            callback: v => v.toFixed(1) + '%',
          }
        }
      }
    }
  });
}

function buildTopPostsChart() {
  // Top 10 posts by impressions
  const top = [...filtered]
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10);

  const labels = top.map((r, i) => {
    if (r.title) {
      return r.title.length > 35 ? r.title.slice(0, 33) + '…' : r.title;
    }
    return r.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ` (post ${i + 1})`;
  });

  createOrUpdate('topPostsChart', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Impressions',
        data: top.map(r => r.impressions),
        backgroundColor: PALETTE.blue.fill.replace('0.12', '0.7'),
        borderColor: PALETTE.blue.line,
        borderWidth: 1.5,
        borderRadius: 4,
        borderSkipped: false,
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { display: false },
        tooltip: {
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: {
            label: ctx => ` Impressions: ${ctx.parsed.y.toLocaleString()}`,
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { family: 'Inter', size: 10 }, color: '#9CA3AF', maxRotation: 30 },
          border: { display: false },
        },
        y: {
          ...CHART_DEFAULTS.scales.y,
          ticks: {
            ...CHART_DEFAULTS.scales.y.ticks,
            callback: v => fmtNum(v),
          }
        }
      }
    }
  });
}

// ── Table ─────────────────────────────────────────────────────
const TABLE_COLS = [
  { key: 'date',        label: 'Date',             type: 'date'   },
  { key: 'title',       label: 'Post',             type: 'text'   },
  { key: 'impressions', label: 'Impressions',      type: 'bar'    },
  { key: 'likes',       label: 'Likes',            type: 'number' },
  { key: 'comments',    label: 'Comments',         type: 'number' },
  { key: 'shares',      label: 'Shares',           type: 'number' },
  { key: 'clicks',      label: 'Clicks',           type: 'number' },
  { key: 'engagement',  label: 'Eng. Rate',        type: 'pct'    },
];

const PAGE_SIZE = 50;
let tablePage = 1;

function renderTable() {
  const query = tableSearch.value.toLowerCase();
  const sortVal = tableSort.value;

  let rows = [...filtered];

  // Search
  if (query) {
    rows = rows.filter(r =>
      r.title.toLowerCase().includes(query) ||
      r.date.toLocaleDateString().includes(query)
    );
  }

  // Sort
  const [sortKey, sortDir] = sortVal.split('-');
  rows.sort((a, b) => {
    let av = a[sortKey === 'date' ? 'date' : sortKey === 'impressions' ? 'impressions' : 'engagement'];
    let bv = b[sortKey === 'date' ? 'date' : sortKey === 'impressions' ? 'impressions' : 'engagement'];
    if (sortKey === 'date') { av = av.getTime(); bv = bv.getTime(); }
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  const maxImpressions = Math.max(...rows.map(r => r.impressions), 1);
  const total = rows.length;
  const start = (tablePage - 1) * PAGE_SIZE;
  const page  = rows.slice(start, start + PAGE_SIZE);

  // Header (only build once)
  const thead = document.getElementById('tableHead');
  if (!thead.children.length) {
    thead.innerHTML = TABLE_COLS.map(c => `<th>${c.label}</th>`).join('');
  }

  // Body
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = page.map(r => `
    <tr>
      ${TABLE_COLS.map(c => {
        if (c.type === 'date') {
          return `<td class="td-date">${r.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>`;
        }
        if (c.type === 'text') {
          const t = r.title || '<span style="color:var(--text-light)">—</span>';
          return `<td title="${r.title}">${t.length > 50 ? t.slice(0, 48) + '…' : t}</td>`;
        }
        if (c.type === 'bar') {
          const pct = Math.min(100, (r[c.key] / maxImpressions) * 100).toFixed(1);
          return `<td class="td-bar-cell">
            <div class="td-bar-wrap">
              <div class="td-bar"><div class="td-bar-fill" style="width:${pct}%"></div></div>
              <span class="td-bar-val">${r[c.key].toLocaleString()}</span>
            </div>
          </td>`;
        }
        if (c.type === 'pct') {
          return `<td class="td-number">${r[c.key].toFixed(2)}%</td>`;
        }
        return `<td class="td-number">${r[c.key].toLocaleString()}</td>`;
      }).join('')}
    </tr>
  `).join('');

  // Footer
  document.getElementById('tableFooter').textContent =
    `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, total)} of ${total} posts`;
}

// ── Reset ─────────────────────────────────────────────────────
function resetDashboard() {
  allRows = [];
  filtered = [];
  Object.values(charts).forEach(c => c.destroy());
  charts = {};
  fileInput.value = '';
  document.getElementById('tableHead').innerHTML = '';
  document.getElementById('tableBody').innerHTML = '';
  dashboard.style.display     = 'none';
  uploadScreen.style.display  = 'flex';
  headerActions.style.display = 'none';
}

// ── Export ────────────────────────────────────────────────────
function exportCharts() {
  const ids = ['impressionsChart', 'engagementChart', 'engagementRateChart', 'topPostsChart'];
  ids.forEach(id => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `linkedin-${id}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  });
  showToast('Charts exported as PNG files.', 'success');
}

// ── Toast notifications ───────────────────────────────────────
function showToast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('hiding');
    el.addEventListener('animationend', () => el.remove());
  }, 3500);
}

// ── Sample data generator ─────────────────────────────────────
function loadSampleData() {
  const rows = generateSampleRows();
  allRows  = rows;
  filtered = [...rows];
  showToast('Sample data loaded — explore the dashboard!', 'success');
  showDashboard();
}

function generateSampleRows() {
  const titles = [
    'Excited to share our Q1 results — incredible team effort!',
    'Just published: "10 trends shaping the future of work"',
    'Thrilled to announce our Series B funding round 🎉',
    'Great conversation at last week's leadership summit',
    'We\'re hiring! Senior engineers — link in comments',
    'How we reduced churn by 40% in 6 months',
    'Congrats to our team on the industry award nomination',
    'Reflecting on 5 years building this company',
    'New product feature just launched — check it out!',
    'Lessons from our biggest product failure',
    'The one habit that changed how I lead teams',
    'Customer spotlight: how Acme Corp grew 3× in a year',
  ];

  const rows = [];
  const start = new Date('2024-09-01');

  for (let i = 0; i < 90; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);

    // Skip weekends (fewer posts)
    const dow = date.getDay();
    if (dow === 0 || dow === 6) {
      if (Math.random() > 0.3) continue;
    }

    // Skip some weekdays too (not posting every day)
    if (Math.random() > 0.65) continue;

    // Simulate a "viral" spike occasionally
    const spike = Math.random() > 0.92 ? 4 : 1;
    const base = 800 + Math.round(Math.random() * 600);
    const impressions = Math.round(base * spike * (1 + i * 0.008));
    const likes    = Math.round(impressions * (0.015 + Math.random() * 0.025) * spike);
    const comments = Math.round(impressions * (0.003 + Math.random() * 0.007) * spike);
    const shares   = Math.round(impressions * (0.002 + Math.random() * 0.005) * spike);
    const clicks   = Math.round(impressions * (0.02  + Math.random() * 0.04)  * spike);
    const engagement = ((likes + comments + shares + clicks) / impressions) * 100;

    rows.push({
      date,
      title: titles[Math.floor(Math.random() * titles.length)],
      impressions,
      likes,
      comments,
      shares,
      clicks,
      engagement,
      ctr: (clicks / impressions) * 100,
      raw: {},
    });
  }

  rows.sort((a, b) => a.date - b.date);
  return rows;
}
