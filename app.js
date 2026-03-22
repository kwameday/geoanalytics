const DEFAULT_CONFIG = {
  totalSlots: 500,
  rampFactor: 0.75,
  scoreWeightGap: 0.35,
  scoreWeightDensity: 0.2,
  scoreWeightDiversity: 0.15,
  scoreWeightSpacing: 0.15,
  scoreWeightVolume: 0.15,
  bboxMinLat: 5.48,
  bboxMaxLat: 5.82,
  bboxMinLng: -0.38,
  bboxMaxLng: 0.08,
  monthlyGMV: {
    'Supermarkets': 32700,
    'Restaurants': 24000,
    'Pharmacy': 29500,
    'Mobile': 26500,
    'Electronics': 28500,
    'Computers': 23000,
    'Home & Office': 16500,
    'Auto': 15500,
    'Spas & Salons': 12000,
    'Baby & Kids': 12500,
    'Bakery': 9000,
    'Fashion & Footwear': 8000,
    'Other': 10000,
  },
  targetMix: {
    'Supermarkets': 0.16,
    'Restaurants': 0.14,
    'Pharmacy': 0.12,
    'Mobile': 0.12,
    'Electronics': 0.10,
    'Computers': 0.09,
    'Home & Office': 0.08,
    'Auto': 0.06,
    'Spas & Salons': 0.05,
    'Baby & Kids': 0.03,
    'Bakery': 0.03,
    'Fashion & Footwear': 0.02,
  },
};

const CATEGORY_MAP = {
  'Restaurants & Fast Food': 'Restaurants',
  'Pharmacy & Health': 'Pharmacy',
  'Mobile Phones & Accessories': 'Mobile',
  'Electronics & Appliances': 'Electronics',
  'Computers & Games': 'Computers',
  'Auto & More': 'Auto',
};

const CATEGORY_COLORS = {
  'Supermarkets': '#ef4444',
  'Restaurants': '#f97316',
  'Pharmacy': '#10b981',
  'Mobile': '#0ea5e9',
  'Electronics': '#8b5cf6',
  'Computers': '#6366f1',
  'Home & Office': '#14b8a6',
  'Auto': '#64748b',
  'Spas & Salons': '#ec4899',
  'Baby & Kids': '#f59e0b',
  'Bakery': '#a16207',
  'Fashion & Footwear': '#334155',
  'Other': '#94a3b8',
};

const ZONES = [
  { id: 0, name: 'West Corridor (Dansoman / Mallam / Weija)', test: (p) => p.lng < -0.255 },
  { id: 5, name: 'Central Accra (Circle / Kokomlemle / Adabraka)', test: (p) => p.lng >= -0.255 && p.lng < -0.19 && p.lat < 5.64 },
  { id: 3, name: 'North-West Corridor (Achimota / Lapaz / Atomic)', test: (p) => p.lng >= -0.255 && p.lng < -0.15 && p.lat >= 5.64 },
  { id: 1, name: 'East Corridor (Spintex / Sakumono)', test: (p) => p.lng >= -0.19 && p.lng < -0.08 && p.lat < 5.62 },
  { id: 2, name: 'North-East Corridor (East Legon / Madina / Haatso)', test: (p) => p.lng >= -0.19 && p.lng < -0.08 && p.lat >= 5.62 },
  { id: 4, name: 'Tema Corridor (Tema / Ashaiman)', test: (p) => p.lng >= -0.08 },
];

let currentConfig = structuredClone(DEFAULT_CONFIG);
let currentRows = [];
let lastOutputs = { zoneRows: [], next500Rows: [] };
let map, markersLayer, zoneLayer;

function normalizeCategory(category) {
  return CATEGORY_MAP[category] || category || 'Other';
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', maximumFractionDigits: 0 }).format(value || 0);
}

function slugify(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function downloadCSV(filename, rows) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  rows.forEach((row) => {
    const values = headers.map((header) => {
      const value = row[header] ?? '';
      const safe = String(value).replace(/"/g, '""');
      return /,|\n|"/.test(safe) ? `"${safe}"` : safe;
    });
    lines.push(values.join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function approxAreaKm2(points) {
  if (!points.length) return 0;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const latKm = (maxLat - minLat) * 111;
  const meanLat = (minLat + maxLat) / 2;
  const lngKm = (maxLng - minLng) * 111 * Math.cos((meanLat * Math.PI) / 180);
  return Math.max(latKm * lngKm, 1);
}

function avgNearestNeighbor(points) {
  if (points.length < 2) return 0;
  const nearest = points.map((p, idx) => {
    let best = Infinity;
    points.forEach((q, j) => {
      if (idx === j) return;
      const d = haversine(p.lat, p.lng, q.lat, q.lng);
      if (d < best) best = d;
    });
    return best;
  });
  return nearest.reduce((a, b) => a + b, 0) / nearest.length;
}

function assignZone(point) {
  const zone = ZONES.find((z) => z.test(point));
  return zone || ZONES[0];
}

function cleanRows(rows) {
  const excluded = [];
  const kept = [];
  rows.forEach((row) => {
    const lat = Number(row.Latitude);
    const lng = Number(row.Longitude);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      excluded.push({ ...row, reason: 'Invalid coordinates' });
      return;
    }
    if (lat < currentConfig.bboxMinLat || lat > currentConfig.bboxMaxLat || lng < currentConfig.bboxMinLng || lng > currentConfig.bboxMaxLng) {
      excluded.push({ ...row, reason: 'Outside active study area' });
      return;
    }
    const category = normalizeCategory(row.Category);
    const point = { name: row.Name || 'Unnamed merchant', rawCategory: row.Category, category, lat, lng };
    const zone = assignZone(point);
    kept.push({ ...point, zoneId: zone.id, zoneName: zone.name });
  });
  return { kept, excluded };
}

function normalizeScores(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return values.map((v) => max === min ? 1 : (v - min) / (max - min));
}

function buildAnalysis(rows) {
  const zoneMap = new Map();
  const allCategories = [...new Set(rows.map((r) => r.category))].sort();

  rows.forEach((row) => {
    if (!zoneMap.has(row.zoneId)) {
      zoneMap.set(row.zoneId, {
        zone_id: row.zoneId,
        Zone: row.zoneName,
        merchants: [],
        byCategory: {},
      });
    }
    const zone = zoneMap.get(row.zoneId);
    zone.merchants.push(row);
    zone.byCategory[row.category] = (zone.byCategory[row.category] || 0) + 1;
  });

  const zoneRows = [...zoneMap.values()].map((zone) => {
    const currentMerchants = zone.merchants.length;
    const categoryDiversity = Object.keys(zone.byCategory).length;
    const area = approxAreaKm2(zone.merchants);
    const density = currentMerchants / area;
    const spacing = avgNearestNeighbor(zone.merchants);
    const essentialsCount = (zone.byCategory['Supermarkets'] || 0) + (zone.byCategory['Restaurants'] || 0) + (zone.byCategory['Pharmacy'] || 0) + (zone.byCategory['Mobile'] || 0);
    const essentialsGap = Math.max(0, 1 - essentialsCount / Math.max(currentMerchants, 1));
    const currentMonthlyGMV = zone.merchants.reduce((sum, m) => sum + (currentConfig.monthlyGMV[m.category] || currentConfig.monthlyGMV.Other), 0);
    return {
      zone_id: zone.zone_id,
      Zone: zone.Zone,
      'Current Merchants': currentMerchants,
      'Category Diversity': categoryDiversity,
      'Approx Area km2': Number(area.toFixed(1)),
      'Density per km2': Number(density.toFixed(2)),
      'Avg NN Dist km': Number(spacing.toFixed(2)),
      'Essentials Gap Index': Number(essentialsGap.toFixed(3)),
      currentMonthlyGMV,
      byCategory: zone.byCategory,
      merchants: zone.merchants,
    };
  });

  const densities = zoneRows.map((z) => z['Density per km2']);
  const diversities = zoneRows.map((z) => z['Category Diversity']);
  const spacings = zoneRows.map((z) => z['Avg NN Dist km']);
  const gmv = zoneRows.map((z) => z.currentMonthlyGMV);
  const densityNorm = normalizeScores(densities.map((v) => -v));
  const diversityNorm = normalizeScores(diversities.map((v) => -v));
  const spacingNorm = normalizeScores(spacings);
  const volumeNorm = normalizeScores(gmv);

  zoneRows.forEach((zone, idx) => {
    const rawScore = (
      zone['Essentials Gap Index'] * currentConfig.scoreWeightGap +
      densityNorm[idx] * currentConfig.scoreWeightDensity +
      diversityNorm[idx] * currentConfig.scoreWeightDiversity +
      spacingNorm[idx] * currentConfig.scoreWeightSpacing +
      volumeNorm[idx] * currentConfig.scoreWeightVolume
    );
    zone['Zone Score'] = Number((rawScore * 100).toFixed(1));
  });

  zoneRows.sort((a, b) => b['Zone Score'] - a['Zone Score']);
  zoneRows.forEach((z, i) => { z['Zone Rank'] = i + 1; });

  const totalScore = zoneRows.reduce((sum, z) => sum + z['Zone Score'], 0) || 1;
  let allocated = 0;
  zoneRows.forEach((zone, idx) => {
    let slots = Math.round((zone['Zone Score'] / totalScore) * currentConfig.totalSlots);
    if (idx === zoneRows.length - 1) slots = currentConfig.totalSlots - allocated;
    zone['Next 500 Slots'] = slots;
    allocated += slots;
  });

  const next500Rows = [];
  zoneRows.forEach((zone) => {
    const currentShares = {};
    const totalInZone = zone['Current Merchants'] || 1;
    Object.entries(zone.byCategory).forEach(([category, count]) => { currentShares[category] = count / totalInZone; });
    const categoryDemand = Object.entries(currentConfig.targetMix).map(([category, target]) => {
      const currentShare = currentShares[category] || 0;
      const gap = Math.max(target - currentShare, 0);
      const gmvm = currentConfig.monthlyGMV[category] || currentConfig.monthlyGMV.Other;
      return {
        category,
        gapScore: gap * 0.65 + (gmvm / 33000) * 0.35,
      };
    }).sort((a, b) => b.gapScore - a.gapScore);

    const demandTotal = categoryDemand.reduce((sum, d) => sum + d.gapScore, 0) || 1;
    let used = 0;
    const allocations = categoryDemand.map((d, idx) => {
      let count = Math.round((d.gapScore / demandTotal) * zone['Next 500 Slots']);
      if (idx === categoryDemand.length - 1) count = zone['Next 500 Slots'] - used;
      used += count;
      return { ...d, count };
    }).filter((d) => d.count > 0);

    allocations.forEach((alloc) => {
      const projectedMonthly = currentConfig.monthlyGMV[alloc.category] || currentConfig.monthlyGMV.Other;
      const wave = zone['Zone Rank'] <= 2 ? 1 : zone['Zone Rank'] <= 4 ? 2 : 3;
      const priority = zone['Zone Rank'] <= 2 ? 'High' : zone['Zone Rank'] <= 4 ? 'Medium' : 'Seed';
      const focus = ['Supermarkets', 'Pharmacy', 'Mobile', 'Restaurants'].includes(alloc.category)
        ? 'Anchor + essential merchants'
        : 'Long-tail assortment merchants';
      const rationale = `${zone.Zone}: ${alloc.category} closes category mix gaps and improves local assortment coverage.`;
      for (let i = 0; i < alloc.count; i += 1) {
        next500Rows.push({
          'Slot ID': next500Rows.length + 1,
          'Zone Rank': zone['Zone Rank'],
          'Zone ID': zone.zone_id,
          Zone: zone.Zone,
          Category: alloc.category,
          Wave: wave,
          'Priority Tier': priority,
          'Suggested Sourcing Focus': focus,
          'Projected Monthly GMV (GHS)': projectedMonthly,
          'Projected Annual GMV (GHS)': projectedMonthly * 12,
          'Ops Rationale': rationale,
        });
      }
    });

    const newMonthly = next500Rows
      .filter((r) => r['Zone ID'] === zone.zone_id)
      .reduce((sum, r) => sum + r['Projected Monthly GMV (GHS)'], 0) * currentConfig.rampFactor;
    zone['Current Monthly GMV (Modelled)'] = Math.round(zone.currentMonthlyGMV);
    zone['New Monthly GMV (Ramp 75%)'] = Math.round(newMonthly);
    zone['Post-500 Monthly GMV'] = Math.round(zone.currentMonthlyGMV + newMonthly);
  });

  return { zoneRows, next500Rows, categories: allCategories };
}

function buildInsights(zoneRows, rows) {
  const insights = [];
  const topZone = zoneRows[0];
  if (topZone) {
    insights.push(`<strong>${topZone.Zone}</strong> is the highest-priority zone with a score of <strong>${topZone['Zone Score']}</strong> and <strong>${topZone['Next 500 Slots']}</strong> recommended slots.`);
  }
  const categoryCounts = rows.reduce((acc, row) => {
    acc[row.category] = (acc[row.category] || 0) + 1;
    return acc;
  }, {});
  const total = rows.length || 1;
  const topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0];
  if (topCategory) {
    insights.push(`<strong>${topCategory[0]}</strong> already represents <strong>${((topCategory[1] / total) * 100).toFixed(1)}%</strong> of mapped merchants, so new onboarding should stay selective there.`);
  }
  const underservedZone = [...zoneRows].sort((a, b) => b['Essentials Gap Index'] - a['Essentials Gap Index'])[0];
  if (underservedZone) {
    insights.push(`<strong>${underservedZone.Zone}</strong> has the largest essentials gap. Focus field teams on supermarkets, pharmacy, restaurants, and mobile merchants first.`);
  }
  const wideSpacing = [...zoneRows].sort((a, b) => b['Avg NN Dist km'] - a['Avg NN Dist km'])[0];
  if (wideSpacing) {
    insights.push(`<strong>${wideSpacing.Zone}</strong> shows the widest merchant spacing, which usually signals white-space potential and weaker neighborhood assortment density.`);
  }
  return insights;
}

function renderInsights(insights) {
  const el = document.getElementById('insights');
  el.innerHTML = insights.map((text) => `<div class="insight">${text}</div>`).join('');
}

function renderCategoryLegend(categories) {
  const el = document.getElementById('categoryLegend');
  el.innerHTML = categories.map((category) => `
    <span class="legend-item"><span class="legend-dot" style="background:${CATEGORY_COLORS[category] || CATEGORY_COLORS.Other}"></span>${category}</span>
  `).join('');
}

function renderZoneTable(zoneRows) {
  const table = document.getElementById('zoneTable');
  const columns = ['Zone Rank', 'Zone', 'Current Merchants', 'Category Diversity', 'Density per km2', 'Avg NN Dist km', 'Essentials Gap Index', 'Zone Score', 'Next 500 Slots', 'Current Monthly GMV (Modelled)', 'New Monthly GMV (Ramp 75%)', 'Post-500 Monthly GMV'];
  table.querySelector('thead').innerHTML = `<tr>${columns.map((c) => `<th>${c}</th>`).join('')}</tr>`;
  table.querySelector('tbody').innerHTML = zoneRows.map((row) => `
    <tr>
      ${columns.map((col) => {
        const value = String(col).includes('GMV') ? formatCurrency(row[col]) : row[col];
        return `<td>${value}</td>`;
      }).join('')}
    </tr>
  `).join('');
}

function renderCategoryMatrix(rows) {
  const total = rows.length || 1;
  const counts = rows.reduce((acc, row) => {
    acc[row.category] = (acc[row.category] || 0) + 1;
    return acc;
  }, {});
  const ordered = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const el = document.getElementById('categoryMatrix');
  el.innerHTML = ordered.map(([category, count]) => {
    const share = (count / total) * 100;
    return `
      <div class="matrix-row">
        <div>${category}</div>
        <div class="matrix-bar"><div class="matrix-fill" style="width:${share}%;background:${CATEGORY_COLORS[category] || CATEGORY_COLORS.Other}"></div></div>
        <div>${share.toFixed(1)}%</div>
      </div>
    `;
  }).join('');
}

function renderNext500Table(next500Rows) {
  const table = document.getElementById('next500Table');
  const columns = ['Slot ID', 'Zone Rank', 'Zone', 'Category', 'Wave', 'Priority Tier', 'Suggested Sourcing Focus', 'Projected Monthly GMV (GHS)', 'Projected Annual GMV (GHS)', 'Ops Rationale'];
  table.querySelector('thead').innerHTML = `<tr>${columns.map((c) => `<th>${c}</th>`).join('')}</tr>`;

  const searchValue = document.getElementById('next500Search').value.toLowerCase();
  const filtered = next500Rows.filter((row) => {
    if (!searchValue) return true;
    return Object.values(row).some((value) => String(value).toLowerCase().includes(searchValue));
  });

  table.querySelector('tbody').innerHTML = filtered.map((row) => `
    <tr>
      ${columns.map((col) => {
        const value = String(col).includes('GMV') ? formatCurrency(row[col]) : row[col];
        return `<td>${value}</td>`;
      }).join('')}
    </tr>
  `).join('');
}

function renderMetrics(zoneRows, rows) {
  const currentGMV = zoneRows.reduce((sum, z) => sum + z['Current Monthly GMV (Modelled)'], 0);
  const postGMV = zoneRows.reduce((sum, z) => sum + z['Post-500 Monthly GMV'], 0);
  const topZone = zoneRows[0]?.Zone || '-';
  document.getElementById('metricMerchants').textContent = rows.length.toLocaleString();
  document.getElementById('metricZones').textContent = zoneRows.length;
  document.getElementById('metricTopZone').textContent = topZone;
  document.getElementById('metricCurrentGMV').textContent = formatCurrency(currentGMV);
  document.getElementById('metricPostGMV').textContent = formatCurrency(postGMV);
  document.getElementById('metricIncrementalGMV').textContent = formatCurrency(postGMV - currentGMV);
}

function initMap() {
  if (!map) {
    map = L.map('map').setView([5.63, -0.18], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
    zoneLayer = L.layerGroup().addTo(map);
  }
}

function renderMap(rows) {
  initMap();
  markersLayer.clearLayers();
  zoneLayer.clearLayers();

  const bounds = [];
  rows.forEach((row) => {
    const color = CATEGORY_COLORS[row.category] || CATEGORY_COLORS.Other;
    const marker = L.circleMarker([row.lat, row.lng], {
      radius: 6,
      color,
      fillColor: color,
      fillOpacity: 0.7,
      weight: 1,
    }).bindPopup(`<strong>${row.name}</strong><br>${row.category}<br>${row.zoneName}`);
    marker.addTo(markersLayer);
    bounds.push([row.lat, row.lng]);
  });

  ZONES.forEach((zone) => {
    const zonePoints = rows.filter((r) => r.zoneId === zone.id);
    if (!zonePoints.length) return;
    const latlngs = zonePoints.map((r) => [r.lat, r.lng]);
    const polygon = L.polygon(latlngs, {
      color: '#94a3b8',
      weight: 1,
      fillOpacity: 0.04,
    }).bindTooltip(zone.name, { sticky: true });
    polygon.addTo(zoneLayer);
  });

  if (bounds.length) map.fitBounds(bounds, { padding: [20, 20] });
}

function renderConfig() {
  const configGrid = document.getElementById('configGrid');
  const fields = [
    ['totalSlots', 'Total onboarding slots'],
    ['rampFactor', 'Ramp factor'],
    ['scoreWeightGap', 'Weight: essentials gap'],
    ['scoreWeightDensity', 'Weight: density'],
    ['scoreWeightDiversity', 'Weight: diversity'],
    ['scoreWeightSpacing', 'Weight: spacing'],
    ['scoreWeightVolume', 'Weight: GMV volume'],
    ['bboxMinLat', 'Min latitude'],
    ['bboxMaxLat', 'Max latitude'],
    ['bboxMinLng', 'Min longitude'],
    ['bboxMaxLng', 'Max longitude'],
  ];
  configGrid.innerHTML = fields.map(([key, label]) => `
    <div>
      <label for="cfg-${key}">${label}</label>
      <input id="cfg-${key}" data-key="${key}" type="number" step="0.01" value="${currentConfig[key]}" />
    </div>
  `).join('');
}

function syncConfigFromInputs() {
  document.querySelectorAll('#configGrid input').forEach((input) => {
    currentConfig[input.dataset.key] = Number(input.value);
  });
}

function updateSourceInfo(source, keptCount, excludedCount) {
  document.getElementById('sourceLabel').textContent = source;
  document.getElementById('rowsLoaded').textContent = keptCount.toLocaleString();
  document.getElementById('rowsExcluded').textContent = excludedCount.toLocaleString();
}

function runDashboard(rawRows, sourceLabel) {
  syncConfigFromInputs();
  const { kept, excluded } = cleanRows(rawRows);
  currentRows = kept;
  updateSourceInfo(sourceLabel, kept.length, excluded.length);
  const outputs = buildAnalysis(kept);
  lastOutputs = outputs;
  renderCategoryLegend(outputs.categories);
  renderZoneTable(outputs.zoneRows);
  renderCategoryMatrix(kept);
  renderNext500Table(outputs.next500Rows);
  renderMetrics(outputs.zoneRows, kept);
  renderInsights(buildInsights(outputs.zoneRows, kept));
  renderMap(kept);
}

async function loadCSVFromUrl(url, sourceLabel) {
  const response = await fetch(url);
  const text = await response.text();
  Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    complete: (result) => runDashboard(result.data, sourceLabel),
  });
}

function wireEvents() {
  document.getElementById('csvUpload').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => runDashboard(result.data, file.name),
    });
  });

  document.getElementById('loadSampleBtn').addEventListener('click', () => {
    loadCSVFromUrl('data/current_map_data.csv', 'Bundled sample dataset');
  });

  document.getElementById('resetConfigBtn').addEventListener('click', () => {
    currentConfig = structuredClone(DEFAULT_CONFIG);
    renderConfig();
    if (currentRows.length) runDashboard(currentRows, document.getElementById('sourceLabel').textContent + ' (rerun)');
  });

  document.getElementById('rerunBtn').addEventListener('click', () => {
    if (currentRows.length) runDashboard(currentRows, document.getElementById('sourceLabel').textContent + ' (rerun)');
  });

  document.getElementById('downloadZoneBtn').addEventListener('click', () => {
    const rows = lastOutputs.zoneRows.map((row) => ({
      zone_id: row.zone_id,
      Zone: row.Zone,
      'Current Merchants': row['Current Merchants'],
      'Category Diversity': row['Category Diversity'],
      'Approx Area km2': row['Approx Area km2'],
      'Density per km2': row['Density per km2'],
      'Avg NN Dist km': row['Avg NN Dist km'],
      'Essentials Gap Index': row['Essentials Gap Index'],
      'Zone Score': row['Zone Score'],
      'Zone Rank': row['Zone Rank'],
      'Next 500 Slots': row['Next 500 Slots'],
      'Current Monthly GMV (Modelled)': row['Current Monthly GMV (Modelled)'],
      'New Monthly GMV (Ramp 75%)': row['New Monthly GMV (Ramp 75%)'],
      'Post-500 Monthly GMV': row['Post-500 Monthly GMV'],
    }));
    downloadCSV('zone_scores_and_gmv.csv', rows);
  });

  document.getElementById('downloadNext500Btn').addEventListener('click', () => {
    downloadCSV('next_500_merchants_plan.csv', lastOutputs.next500Rows);
  });

  document.getElementById('next500Search').addEventListener('input', () => renderNext500Table(lastOutputs.next500Rows));
}

renderConfig();
wireEvents();
loadCSVFromUrl('data/current_map_data.csv', 'Bundled sample dataset');
