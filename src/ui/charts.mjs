import { formatINR, shortDate } from '../domain/dateUtils.mjs';

function compactINR(val) {
  const v = Math.round(Number(val) || 0);
  const sign = v < 0 ? '−₹' : '₹';
  const abs = Math.abs(v);
  if (abs >= 100000) return `${sign}${(abs / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}k`;
  return `${sign}${abs}`;
}

/**
 * Calculates control points for Cubic Bézier curve smoothness (Monotone style).
 */
function getControlPoint(current, previous, next, reverse, smoothing = 0.16) {
  const p = previous || current;
  const n = next || current;
  const opposedX = n.x - p.x;
  const opposedY = n.y - p.y;
  const angle = Math.atan2(opposedY, opposedX) + (reverse ? Math.PI : 0);
  const length = Math.sqrt(Math.pow(opposedX, 2) + Math.pow(opposedY, 2)) * smoothing;
  const x = current.x + Math.cos(angle) * length;
  const y = current.y + Math.sin(angle) * length;
  return [x, y];
}

/**
 * Converts an array of { x, y } points into a smooth SVG Cubic Bézier path string ('C' command).
 */
function getSmoothPathData(points, smoothing = 0.16) {
  if (!points || !points.length) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;

  return points.reduce((acc, point, i, a) => {
    if (i === 0) return `M ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    const [cpsX, cpsY] = getControlPoint(a[i - 1], a[i - 2], point, false, smoothing);
    const [cpeX, cpeY] = getControlPoint(point, a[i - 1], a[i + 1], true, smoothing);
    return `${acc} C ${cpsX.toFixed(1)},${cpsY.toFixed(1)} ${cpeX.toFixed(1)},${cpeY.toFixed(1)} ${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }, '');
}

/**
 * Modern, Robinhood/Revolut-grade stock trajectory graph.
 * Features:
 * - Fluid Monotone Cubic Bézier curve
 * - Ambient emerald glowing area fill fading to AMOLED black
 * - Cap risk floor & shaded confidence corridor
 * - Live top header readout (no thumb-blocking floating popups)
 * - Mobile-first responsive aspect ratio (tall & tactile)
 * - Stock timeframe segmented pills
 * - Summary metrics strip (peak, floor, net cashflow)
 */
export function renderTrajectoryChart(options = {}) {
  // Support either raw trajectory array or projection object
  const trajectory = Array.isArray(options) ? options : (options.trajectory || []);
  const daysToTarget = options.daysToTarget ?? (trajectory.length ? trajectory.length - 1 : 0);
  const currentTotal = options.currentTotal ?? (trajectory[0]?.pace ?? 0);
  const horizonDate = options.targetDate || options.horizonDate || trajectory[trajectory.length - 1]?.date || '';

  if (!trajectory.length) {
    return `
      <div class="stock-chart-card empty-chart">
        <div style="padding:40px 20px;text-align:center;color:var(--mut);font-family:var(--font-mono);">
          <div style="font-size:14px;font-weight:700;color:var(--fg);margin-bottom:6px;">No Trajectory Data</div>
          <div style="font-size:12px;">Add physical accounts and budgets to project future cash flow.</div>
        </div>
      </div>
    `;
  }

  // ViewBox layout (responsive 800 x 320 for desktop & high-res mobile)
  const width = 800;
  const height = 300;
  const padding = { top: 20, right: 35, bottom: 35, left: 55 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  let minVal = Infinity;
  let maxVal = -Infinity;

  for (const pt of trajectory) {
    if (pt.cap < minVal) minVal = pt.cap;
    if (pt.pace < minVal) minVal = pt.pace;
    if (pt.cap > maxVal) maxVal = pt.cap;
    if (pt.pace > maxVal) maxVal = pt.pace;
  }

  // Ensure breathing room around min/max
  minVal = Math.min(minVal, 0);
  const valMargin = (maxVal - minVal) * 0.1 || 1000;
  maxVal = Math.max(maxVal + valMargin, minVal + 2000);
  minVal = Math.min(minVal - valMargin * 0.4, 0);
  const valRange = maxVal - minVal || 1;

  const getY = (v) => padding.top + plotH - ((v - minVal) / valRange) * plotH;
  const getX = (i) => padding.left + (i / Math.max(1, trajectory.length - 1)) * plotW;
  const zeroY = getY(0);

  // Map trajectory to {x, y} coordinate sets
  const pacePoints = [];
  const capPoints = [];
  const eventPins = [];

  trajectory.forEach((pt, idx) => {
    const x = getX(idx);
    const yPace = Math.min(height, Math.max(0, getY(pt.pace)));
    const yCap = Math.min(height, Math.max(0, getY(pt.cap)));

    pacePoints.push({ x, y: yPace, data: pt, index: idx });
    capPoints.push({ x, y: yCap, data: pt, index: idx });

    if (pt.events && pt.events.length) {
      pt.events.forEach((ev) => {
        eventPins.push({
          x,
          y: yPace,
          date: pt.date,
          direction: ev.direction,
          name: ev.name,
          amount: ev.amount,
          type: ev.type
        });
      });
    }
  });

  // Generate smooth cubic curves
  const paceCurve = getSmoothPathData(pacePoints);
  const capCurve = getSmoothPathData(capPoints);

  // Bottom baseline Y for area fill
  const baseY = getY(minVal).toFixed(1);
  const firstX = pacePoints[0].x.toFixed(1);
  const lastX = pacePoints[pacePoints.length - 1].x.toFixed(1);

  const paceAreaPath = `${paceCurve} L ${lastX} ${baseY} L ${firstX} ${baseY} Z`;

  // Shaded corridor between Pace and Cap (Confidence Corridor)
  const capReversed = [...capPoints].reverse();
  const capReversePath = capReversed.map((p, i) => `${i === 0 ? 'L' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const corridorPath = `${paceCurve} ${capReversePath} Z`;

  // X Axis Date Ticks (5-6 evenly spaced)
  const numDateTicks = Math.min(5, trajectory.length);
  const dateStep = Math.max(1, Math.floor((trajectory.length - 1) / (numDateTicks - 1)));
  const xLabels = [];
  for (let i = 0; i < trajectory.length; i += dateStep) {
    xLabels.push({ x: getX(i), text: shortDate(trajectory[i].date) });
  }
  const lastIdx = trajectory.length - 1;
  if (!xLabels.some((l) => Math.abs(l.x - getX(lastIdx)) < 40)) {
    xLabels.push({ x: getX(lastIdx), text: shortDate(trajectory[lastIdx].date) });
  }

  // Y Axis Ticks (4 levels)
  const yTicks = [
    minVal,
    minVal + valRange * 0.33,
    minVal + valRange * 0.66,
    maxVal
  ];

  // Target metrics
  const targetPt = trajectory[trajectory.length - 1];
  const targetPace = targetPt.pace;
  const targetCap = targetPt.cap;
  const delta = targetPace - currentTotal;
  const deltaPct = currentTotal > 0 ? (delta / currentTotal) * 100 : 0;
  const isPositive = delta >= 0;

  // Range extremes for summary strip
  const peakVal = Math.max(...trajectory.map((t) => t.pace));
  const troughVal = Math.min(...trajectory.map((t) => t.cap));
  const totalEventsIn = eventPins.filter((e) => e.direction === 'in').reduce((s, e) => s + e.amount, 0);
  const totalEventsOut = eventPins.filter((e) => e.direction === 'out').reduce((s, e) => s + e.amount, 0);

  const chartId = 'stk-' + Math.random().toString(36).slice(2, 7);
  const serializedPoints = JSON.stringify(trajectory.map((t, idx) => ({
    x: getX(idx),
    date: t.date,
    pace: t.pace,
    cap: t.cap,
    events: t.events || []
  }))).replace(/"/g, '&quot;');

  return `
    <div class="stock-chart-card interactive-chart-container" id="${chartId}" data-chart-id="${chartId}" data-points="${serializedPoints}" data-current="${currentTotal}">
      
      <!-- Live Top Financial Header (Stock Ticker) -->
      <div class="stock-chart-header">
        <div class="stock-header-main">
          <div class="stock-ticker-row">
            <span class="stock-ticker-val mono" id="${chartId}-val">${formatINR(targetPace)}</span>
            <span class="stock-delta-pill ${isPositive ? 'good' : 'bad'}" id="${chartId}-delta">
              ${isPositive ? '+' : ''}${formatINR(delta)} (${isPositive ? '+' : ''}${deltaPct.toFixed(1)}%)
            </span>
          </div>
          <div class="stock-ticker-sub">
            <span class="stock-date-lbl" id="${chartId}-date">${shortDate(horizonDate)} (${daysToTarget} days out)</span>
            <span class="stock-mode-lbl" id="${chartId}-mode">Expected Pace</span>
          </div>
        </div>

        <!-- Cap Floor Comparison Pill -->
        <div class="stock-cap-stat">
          <span style="font-size:10px;color:var(--bad);text-transform:uppercase;font-weight:700;">Worst-Case Floor</span>
          <span class="mono" id="${chartId}-cap" style="font-weight:700;color:var(--bad);">${formatINR(targetCap)}</span>
        </div>
      </div>

      <!-- Active Event Banner (when scrubbing over a scheduled event) -->
      <div class="stock-event-banner" id="${chartId}-event-banner" style="display:none;"></div>

      <!-- Timeframe Segmented Control (Stock Pills) -->
      <div class="stock-timeframe-bar">
        <button class="stock-pill ${daysToTarget === 7 ? 'active' : ''}" data-set-days="7">7D</button>
        <button class="stock-pill ${daysToTarget === 14 ? 'active' : ''}" data-set-days="14">14D</button>
        <button class="stock-pill ${daysToTarget === 30 ? 'active' : ''}" data-set-days="30">1M</button>
        <button class="stock-pill ${daysToTarget === 60 ? 'active' : ''}" data-set-days="60">2M</button>
        <button class="stock-pill ${daysToTarget === 90 ? 'active' : ''}" data-set-days="90">3M</button>
        <button class="stock-pill" data-set-cycle="1">EOC</button>
        <div class="stock-custom-date">
          <span style="font-size:10px;color:var(--mut);">📅</span>
          <input type="date" id="horizon-date-picker" value="${horizonDate}" title="Pick custom date">
        </div>
      </div>

      <!-- SVG Graph Canvas -->
      <div class="stock-canvas-wrap">
        <svg viewBox="0 0 ${width} ${height}" class="stock-svg" preserveAspectRatio="none">
          <defs>
            <!-- Ambient Glowing Green Area Gradient -->
            <linearGradient id="${chartId}-pace-glow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#a6e3a1" stop-opacity="0.28"/>
              <stop offset="50%" stop-color="#a6e3a1" stop-opacity="0.08"/>
              <stop offset="100%" stop-color="#a6e3a1" stop-opacity="0.00"/>
            </linearGradient>

            <!-- Cap Risk Corridor Gradient -->
            <linearGradient id="${chartId}-corridor" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#74c7ec" stop-opacity="0.12"/>
              <stop offset="100%" stop-color="#f38ba8" stop-opacity="0.03"/>
            </linearGradient>
          </defs>

          <!-- Subtle Horizontal Grid Lines & Y Axis Ticks -->
          ${yTicks.map((v) => {
            const y = getY(v);
            return `
              <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#1e1e2e" stroke-dasharray="3,3" stroke-width="1"/>
              <text x="${padding.left - 8}" y="${y + 4}" fill="#6c7086" font-size="10" font-family="monospace" text-anchor="end">${compactINR(v)}</text>
            `;
          }).join('')}

          <!-- Zero Baseline (if in range) -->
          ${zeroY >= padding.top && zeroY <= padding.top + plotH ? `
            <line x1="${padding.left}" y1="${zeroY}" x2="${width - padding.right}" y2="${zeroY}" stroke="#585b70" stroke-width="1.2" stroke-dasharray="2,2"/>
          ` : ''}

          <!-- Shaded Risk Corridor between Cap & Pace -->
          <path d="${corridorPath}" fill="url(#${chartId}-corridor)"/>

          <!-- Glowing Gradient Fill under Pace Curve -->
          <path d="${paceAreaPath}" fill="url(#${chartId}-pace-glow)"/>

          <!-- Cap Risk Floor Curve (Dashed Coral Line) -->
          <path d="${capCurve}" fill="none" stroke="#f38ba8" stroke-width="1.8" stroke-dasharray="5,4" stroke-opacity="0.85"/>

          <!-- Pace Expected Trajectory Curve (Crisp Emerald Line) -->
          <path d="${paceCurve}" fill="none" stroke="#a6e3a1" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>

          <!-- Milestone Event Pins on Curve -->
          ${eventPins.map((m) => `
            <g transform="translate(${m.x.toFixed(1)}, ${m.y.toFixed(1)})">
              <circle r="4.5" fill="${m.direction === 'in' ? '#a6e3a1' : '#f38ba8'}" stroke="#000000" stroke-width="1.5"/>
            </g>
          `).join('')}

          <!-- X Axis Date Labels -->
          ${xLabels.map((l) => `
            <text x="${l.x}" y="${height - 10}" fill="#a6adc8" font-size="10" font-family="monospace" text-anchor="middle">${l.text}</text>
          `).join('')}

          <!-- Dynamic Interactive Crosshair Line -->
          <line class="stock-crosshair-v" x1="-100" y1="${padding.top}" x2="-100" y2="${padding.top + plotH}" stroke="#74c7ec" stroke-width="1.5" stroke-dasharray="3,3" style="display:none;"/>

          <!-- Glowing Cursor Pip on Curve -->
          <g class="stock-cursor-pip" style="display:none;" transform="translate(-100, -100)">
            <circle r="12" fill="#a6e3a1" fill-opacity="0.25"/>
            <circle r="5" fill="#a6e3a1" stroke="#000000" stroke-width="2"/>
          </g>
        </svg>
      </div>

      <!-- Bottom Range Summary Metrics Strip -->
      <div class="stock-metrics-strip">
        <div class="stock-metric-item">
          <span class="lbl">Horizon Peak</span>
          <span class="val good mono">${formatINR(peakVal)}</span>
        </div>
        <div class="stock-metric-item">
          <span class="lbl">Drawdown Floor</span>
          <span class="val bad mono">${formatINR(troughVal)}</span>
        </div>
        <div class="stock-metric-item">
          <span class="lbl">Scheduled In</span>
          <span class="val good mono">+${formatINR(totalEventsIn)}</span>
        </div>
        <div class="stock-metric-item">
          <span class="lbl">Scheduled Out</span>
          <span class="val bad mono">−${formatINR(totalEventsOut)}</span>
        </div>
      </div>

    </div>
  `;
}

/**
 * Attaches modern, continuous pointer/touch scrubbing to the stock chart.
 */
export function attachChartInteractions(rootElement) {
  rootElement.querySelectorAll('.stock-chart-card').forEach((card) => {
    const rawData = card.getAttribute('data-points');
    if (!rawData) return;

    let points = [];
    try {
      points = JSON.parse(rawData);
    } catch (e) {
      return;
    }
    if (!points.length) return;

    const currentTotal = Number(card.getAttribute('data-current')) || 0;
    const canvasWrap = card.querySelector('.stock-canvas-wrap');
    const crosshairV = card.querySelector('.stock-crosshair-v');
    const cursorPip = card.querySelector('.stock-cursor-pip');
    const valEl = card.querySelector('[id$="-val"]');
    const deltaEl = card.querySelector('[id$="-delta"]');
    const dateEl = card.querySelector('[id$="-date"]');
    const capEl = card.querySelector('[id$="-cap"]');
    const modeEl = card.querySelector('[id$="-mode"]');
    const bannerEl = card.querySelector('[id$="-event-banner"]');

    if (!canvasWrap || !crosshairV || !cursorPip) return;

    // Default target state to revert on pointer up/leave
    const defaultPt = points[points.length - 1];
    const defaultPace = defaultPt.pace;
    const defaultCap = defaultPt.cap;
    const defaultDate = defaultPt.date;
    const defaultDelta = defaultPace - currentTotal;
    const defaultPct = currentTotal > 0 ? (defaultDelta / currentTotal) * 100 : 0;
    const defaultIsPos = defaultDelta >= 0;

    let lastIndex = -1;

    const resetToDefault = () => {
      crosshairV.style.display = 'none';
      cursorPip.style.display = 'none';
      if (bannerEl) bannerEl.style.display = 'none';

      if (valEl) valEl.textContent = formatINR(defaultPace);
      if (deltaEl) {
        deltaEl.className = `stock-delta-pill ${defaultIsPos ? 'good' : 'bad'}`;
        deltaEl.textContent = `${defaultIsPos ? '+' : ''}${formatINR(defaultDelta)} (${defaultIsPos ? '+' : ''}${defaultPct.toFixed(1)}%)`;
      }
      if (dateEl) dateEl.textContent = `${shortDate(defaultDate)} (${points.length - 1} days out)`;
      if (capEl) capEl.textContent = formatINR(defaultCap);
      if (modeEl) modeEl.textContent = 'Expected Pace';
      lastIndex = -1;
    };

    const updateScrub = (clientX) => {
      const rect = canvasWrap.getBoundingClientRect();
      if (!rect.width) return;

      const relX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const idx = Math.round(relX * (points.length - 1));
      const pt = points[idx];
      if (!pt) return;

      // Haptic tick when crossing days on mobile
      if (idx !== lastIndex) {
        lastIndex = idx;
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          if (pt.events && pt.events.length) {
            navigator.vibrate(8); // Stronger pulse for event dates
          } else {
            navigator.vibrate(3);
          }
        }
      }

      // Calculate SVG coordinates
      const svgX = pt.x;
      // Estimate Y proportional from height
      // Pace Y
      const minVal = Math.min(...points.map((p) => Math.min(p.pace, p.cap)), 0);
      const maxVal = Math.max(...points.map((p) => Math.max(p.pace, p.cap)), minVal + 1000);
      const valRange = maxVal - minVal || 1;
      const padding = { top: 20, bottom: 35 };
      const plotH = 300 - padding.top - padding.bottom;
      const svgY = padding.top + plotH - ((pt.pace - minVal) / valRange) * plotH;

      // Position crosshair & glowing pip
      crosshairV.style.display = 'block';
      crosshairV.setAttribute('x1', svgX);
      crosshairV.setAttribute('x2', svgX);

      cursorPip.style.display = 'block';
      cursorPip.setAttribute('transform', `translate(${svgX.toFixed(1)}, ${svgY.toFixed(1)})`);

      // Update Header Ticker
      const scrubDelta = pt.pace - currentTotal;
      const scrubPct = currentTotal > 0 ? (scrubDelta / currentTotal) * 100 : 0;
      const scrubIsPos = scrubDelta >= 0;

      if (valEl) valEl.textContent = formatINR(pt.pace);
      if (deltaEl) {
        deltaEl.className = `stock-delta-pill ${scrubIsPos ? 'good' : 'bad'}`;
        deltaEl.textContent = `${scrubIsPos ? '+' : ''}${formatINR(scrubDelta)} (${scrubIsPos ? '+' : ''}${scrubPct.toFixed(1)}%)`;
      }
      if (dateEl) dateEl.textContent = `${shortDate(pt.date)} (${idx}d from today)`;
      if (capEl) capEl.textContent = formatINR(pt.cap);
      if (modeEl) modeEl.textContent = `Scrubbing Day ${idx + 1}`;

      // Update Event Banner
      if (bannerEl) {
        if (pt.events && pt.events.length) {
          bannerEl.style.display = 'flex';
          bannerEl.innerHTML = pt.events.map((ev) => `
            <span class="event-chip ${ev.direction === 'in' ? 'chip-in' : 'chip-out'}">
              ${ev.direction === 'in' ? '▲' : '▼'} ${ev.name || 'Event'}: ${ev.direction === 'in' ? '+' : '−'}${formatINR(ev.amount)}
            </span>
          `).join('');
        } else {
          bannerEl.style.display = 'none';
        }
      }
    };

    // Continuous pointer events (handles mouse and touch smoothly with touch-action: none)
    let isTracking = false;

    canvasWrap.addEventListener('pointerdown', (e) => {
      isTracking = true;
      canvasWrap.setPointerCapture(e.pointerId);
      updateScrub(e.clientX);
    });

    canvasWrap.addEventListener('pointermove', (e) => {
      if (isTracking || e.pointerType === 'mouse') {
        updateScrub(e.clientX);
      }
    });

    canvasWrap.addEventListener('pointerup', (e) => {
      isTracking = false;
      try {
        canvasWrap.releasePointerCapture(e.pointerId);
      } catch (err) {}
      resetToDefault();
    });

    canvasWrap.addEventListener('pointercancel', () => {
      isTracking = false;
      resetToDefault();
    });

    canvasWrap.addEventListener('pointerleave', () => {
      if (!isTracking) {
        resetToDefault();
      }
    });
  });
}

/**
 * Modern Spend vs Funded progress cards with high-contrast brutalist meters.
 */
export function renderSpendBarChart(options = {}) {
  // Gracefully handle either { budgetDetails } or { budgets, transactions } or array
  let details = [];
  if (Array.isArray(options)) {
    details = options;
  } else if (Array.isArray(options.budgetDetails)) {
    details = options.budgetDetails;
  } else if (Array.isArray(options.budgets)) {
    const txs = options.transactions || [];
    details = options.budgets.map((b) => {
      const spent = txs.filter((t) => t.type === 'expense' && t.budgetId === b.id).reduce((s, t) => s + (Number(t.amount) || 0), 0);
      const funded = Number(b.amount) || 0;
      return {
        id: b.id,
        name: b.name,
        kind: b.kind,
        state: { spent, funded: funded || spent, B: funded || spent }
      };
    });
  }

  if (!details.length) {
    return `<div style="padding:24px;text-align:center;color:var(--mut);font-family:var(--font-mono);">No active budgets or envelopes configured.</div>`;
  }

  return `
    <div class="spend-bars-grid">
      ${details.map((b) => {
        const total = b.kind === 'daily' ? (b.state.B || 0) : (b.state.funded || 0);
        const spent = b.state ? (b.state.spent || 0) : 0;
        const pct = total > 0 ? Math.min(100, Math.round((spent / total) * 100)) : (spent > 0 ? 100 : 0);
        const isOver = spent > total;
        const isWarn = pct >= 80 && !isOver;

        return `
          <div class="spend-card ${isOver ? 'overspent' : ''}">
            <div class="spend-card-header">
              <div>
                <strong style="color:var(--fg);font-size:13px;">${b.name}</strong>
                <span class="badge ${b.kind === 'daily' ? 'green' : 'blue'}" style="margin-left:6px;font-size:9px;">${b.kind.toUpperCase()}</span>
              </div>
              <span class="mono" style="font-weight:700;color:${isOver ? 'var(--bad)' : isWarn ? 'var(--peach)' : 'var(--acc)'};font-size:12px;">
                ${pct}% ${isOver ? 'OVER' : 'USED'}
              </span>
            </div>

            <!-- Segmented High-Contrast Meter -->
            <div class="meter-track">
              <div class="meter-fill ${isOver ? 'meter-bad' : isWarn ? 'meter-warn' : 'meter-good'}" style="width:${pct}%;"></div>
            </div>

            <div class="spend-card-footer mono">
              <span>Spent: <strong>${formatINR(spent)}</strong></span>
              <span>Funded: <strong>${formatINR(total)}</strong></span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/**
 * Modern Physical Pool Distribution Cards & Proportional Strip.
 */
export function renderPoolProportions(options = {}) {
  let pools = [];
  if (Array.isArray(options)) {
    pools = options;
  } else if (Array.isArray(options.poolBalances)) {
    pools = options.poolBalances;
  }

  const activePools = pools.filter((p) => !p.isArchived && p.balance > 0);
  const total = activePools.reduce((sum, p) => sum + p.balance, 0);

  if (!total) {
    return `<div style="padding:24px;text-align:center;color:var(--mut);font-family:var(--font-mono);">No positive physical pool balances recorded.</div>`;
  }

  const colors = ['#74c7ec', '#a6e3a1', '#cba6f7', '#fab387', '#f9e2af'];

  return `
    <div class="pool-dist-card">
      <!-- Proportional Segmented Color Strip -->
      <div class="pool-strip-bar">
        ${activePools.map((p, idx) => {
          const pct = ((p.balance / total) * 100).toFixed(1);
          const color = colors[idx % colors.length];
          return `
            <div class="pool-strip-seg" style="width:${pct}%;background:${color};" title="${p.name}: ${pct}%"></div>
          `;
        }).join('')}
      </div>

      <!-- Asset Breakdown Chips -->
      <div class="pool-asset-grid">
        ${activePools.map((p, idx) => {
          const pct = Math.round((p.balance / total) * 100);
          const color = colors[idx % colors.length];
          return `
            <div class="pool-asset-chip">
              <div style="display:flex;align-items:center;gap:6px;">
                <span class="color-dot" style="background:${color};"></span>
                <strong>${p.name}</strong>
                <span class="badge gray" style="font-size:9px;">${p.type || 'bank'}</span>
              </div>
              <div class="mono" style="text-align:right;">
                <div style="font-weight:700;">${formatINR(p.balance)}</div>
                <div style="font-size:10px;color:var(--mut);">${pct}%</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}
