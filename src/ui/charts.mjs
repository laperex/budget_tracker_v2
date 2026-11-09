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
 * Enhanced SVG cash trajectory chart with:
 * - Gradient area confidence bands
 * - Event glyphs (▲ income, ▼ bill)
 * - Interactive hover & touch scrubber with floating tooltip
 */
export function renderTrajectoryChart({ trajectory = [], width = 700, height = 240 }) {
  if (!trajectory.length) {
    return `<div class="sub" style="text-align:center;padding:30px;">No trajectory points for this horizon.</div>`;
  }

  const padding = { top: 25, right: 30, bottom: 40, left: 60 };
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

  // Ensure breathing room around bounds
  minVal = Math.min(minVal, 0);
  const margin = (maxVal - minVal) * 0.08 || 500;
  maxVal = Math.max(maxVal + margin, minVal + 1000);
  minVal = Math.min(minVal - margin * 0.5, 0);

  const valRange = maxVal - minVal || 1;
  const getY = (v) => padding.top + plotH - ((v - minVal) / valRange) * plotH;
  const getX = (i) => padding.left + (i / Math.max(1, trajectory.length - 1)) * plotW;
  const zeroY = getY(0);

  let capPath = '';
  let pacePath = '';
  let paceAreaPath = '';
  let capAreaPath = '';

  const eventMarkers = [];

  trajectory.forEach((pt, idx) => {
    const x = getX(idx);
    const yCap = Math.min(height, Math.max(0, getY(pt.cap)));
    const yPace = Math.min(height, Math.max(0, getY(pt.pace)));

    if (idx === 0) {
      capPath += `M ${x.toFixed(1)} ${yCap.toFixed(1)}`;
      pacePath += `M ${x.toFixed(1)} ${yPace.toFixed(1)}`;
      paceAreaPath += `M ${x.toFixed(1)} ${getY(minVal).toFixed(1)} L ${x.toFixed(1)} ${yPace.toFixed(1)}`;
      capAreaPath += `M ${x.toFixed(1)} ${getY(minVal).toFixed(1)} L ${x.toFixed(1)} ${yCap.toFixed(1)}`;
    } else {
      capPath += ` L ${x.toFixed(1)} ${yCap.toFixed(1)}`;
      pacePath += ` L ${x.toFixed(1)} ${yPace.toFixed(1)}`;
      paceAreaPath += ` L ${x.toFixed(1)} ${yPace.toFixed(1)}`;
      capAreaPath += ` L ${x.toFixed(1)} ${yCap.toFixed(1)}`;
    }

    if (pt.events && pt.events.length) {
      pt.events.forEach((ev) => {
        eventMarkers.push({
          x,
          y: yPace,
          date: pt.date,
          direction: ev.direction,
          name: ev.name,
          amount: ev.amount
        });
      });
    }
  });

  const lastX = getX(trajectory.length - 1);
  const baseBottomY = getY(minVal);
  paceAreaPath += ` L ${lastX.toFixed(1)} ${baseBottomY.toFixed(1)} Z`;
  capAreaPath += ` L ${lastX.toFixed(1)} ${baseBottomY.toFixed(1)} Z`;

  // X Axis Date ticks
  const numDateTicks = Math.min(6, trajectory.length);
  const dateStep = Math.max(1, Math.floor((trajectory.length - 1) / (numDateTicks - 1)));
  const xLabels = [];
  for (let i = 0; i < trajectory.length; i += dateStep) {
    xLabels.push({
      x: getX(i),
      text: shortDate(trajectory[i].date)
    });
  }
  // Ensure last date is included
  const lastIndex = trajectory.length - 1;
  if (!xLabels.some((l) => Math.abs(l.x - getX(lastIndex)) < 30)) {
    xLabels.push({
      x: getX(lastIndex),
      text: shortDate(trajectory[lastIndex].date)
    });
  }

  // Y Axis ticks (4 levels)
  const yTicks = [
    minVal,
    minVal + valRange * 0.33,
    minVal + valRange * 0.66,
    maxVal
  ];

  const chartId = 'traj-' + Math.random().toString(36).slice(2, 7);

  const escAttr = (s) => String(s).replace(/"/g, '&quot;');

  return `
    <div class="interactive-chart-container" style="position:relative;user-select:none;">
      <!-- Floating AMOLED Scrubber Tooltip -->
      <div class="chart-tooltip" style="display:none;position:absolute;top:10px;left:70px;background:#11111b;border:2px solid #74c7ec;padding:8px 12px;font-family:monospace;font-size:11px;z-index:20;box-shadow:0 6px 20px rgba(0,0,0,0.8);pointer-events:none;min-width:180px;">
        <div class="tt-date" style="color:#a6adc8;font-weight:700;margin-bottom:4px;border-bottom:1px solid #313244;padding-bottom:2px;"></div>
        <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:2px;">
          <span style="color:#a6e3a1;font-weight:700;">■ Pace:</span>
          <span class="tt-pace" style="color:#a6e3a1;font-weight:700;"></span>
        </div>
        <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px;">
          <span style="color:#f38ba8;font-weight:700;">- - Cap:</span>
          <span class="tt-cap" style="color:#f38ba8;"></span>
        </div>
        <div class="tt-events" style="border-top:1px solid #313244;padding-top:4px;margin-top:4px;color:#cdd6f4;"></div>
      </div>

      <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;display:block;background:#050608;border:1px solid #313244;">
        <defs>
          <!-- Gradient for Pace Area -->
          <linearGradient id="${chartId}-pace-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#a6e3a1" stop-opacity="0.22"/>
            <stop offset="100%" stop-color="#a6e3a1" stop-opacity="0.01"/>
          </linearGradient>
          <!-- Gradient for Cap Area -->
          <linearGradient id="${chartId}-cap-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f38ba8" stop-opacity="0.14"/>
            <stop offset="100%" stop-color="#f38ba8" stop-opacity="0.00"/>
          </linearGradient>
        </defs>

        <!-- Y Axis Grid Lines & Text -->
        ${yTicks.map((v) => {
          const y = getY(v);
          return `
            <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#1e1e2e" stroke-dasharray="2,2"/>
            <text x="${padding.left - 8}" y="${y + 4}" fill="#6c7086" font-size="10" font-family="monospace" text-anchor="end">${compactINR(v)}</text>
          `;
        }).join('')}

        <!-- Zero Baseline -->
        ${zeroY >= padding.top && zeroY <= padding.top + plotH ? `
          <line x1="${padding.left}" y1="${zeroY}" x2="${width - padding.right}" y2="${zeroY}" stroke="#585b70" stroke-width="1.5"/>
        ` : ''}

        <!-- Shaded Area Fills -->
        <path d="${paceAreaPath}" fill="url(#${chartId}-pace-grad)"/>
        <path d="${capAreaPath}" fill="url(#${chartId}-cap-grad)"/>

        <!-- Cap Floor Curve (Pink/Red Dash) -->
        <path d="${capPath}" fill="none" stroke="#f38ba8" stroke-width="2" stroke-dasharray="4,3"/>

        <!-- Pace Expected Curve (Green Solid) -->
        <path d="${pacePath}" fill="none" stroke="#a6e3a1" stroke-width="2.5"/>

        <!-- Event Glyphs on Curve -->
        ${eventMarkers.map((m) => `
          <polygon points="${m.direction === 'in' ? `${m.x},${m.y - 8} ${m.x - 4},${m.y} ${m.x + 4},${m.y}` : `${m.x - 4},${m.y - 6} ${m.x + 4},${m.y - 6} ${m.x},${m.y + 2}`}" fill="${m.direction === 'in' ? '#a6e3a1' : '#f38ba8'}" stroke="#000" stroke-width="1"/>
        `).join('')}

        <!-- X Axis Date Labels -->
        ${xLabels.map((l) => `
          <text x="${l.x}" y="${height - 12}" fill="#a6adc8" font-size="10" font-family="monospace" text-anchor="middle">${l.text}</text>
        `).join('')}

        <!-- Scrubber Vertical Line (Dynamic) -->
        <line class="chart-scrubber" x1="-100" y1="${padding.top}" x2="-100" y2="${padding.top + plotH}" stroke="#74c7ec" stroke-width="1.5" stroke-dasharray="2,2" style="display:none;"/>

        <!-- Transparent Hover Columns for High-Precision Scrubbing -->
        ${trajectory.map((pt, i) => {
          const colW = plotW / Math.max(1, trajectory.length - 1);
          const colX = getX(i) - colW / 2;
          return `
            <rect x="${colX}" y="${padding.top}" width="${colW}" height="${plotH}" fill="transparent" style="cursor:crosshair;" data-point-x="${getX(i)}" data-date="${pt.date}" data-pace="${pt.pace}" data-cap="${pt.cap}" data-events="${escAttr(JSON.stringify(pt.events || []))}"/>
          `;
        }).join('')}
      </svg>

      <!-- Chart Legend -->
      <div style="display:flex;justify-content:center;gap:18px;margin-top:8px;font-family:monospace;font-size:11px;flex-wrap:wrap;">
        <span style="color:#a6e3a1;font-weight:700;">■ Pace (Expected Trajectory)</span>
        <span style="color:#f38ba8;font-weight:700;">- - Cap (Conservative Floor)</span>
        <span style="color:#a6e3a1;">▲ Income Scheduled</span>
        <span style="color:#f38ba8;">▼ Bill / Debt Due</span>
      </div>
    </div>
  `;
}

/**
 * Attaches mouse & touch interaction handlers for the trajectory chart.
 */
export function attachChartInteractions(rootElement) {
  rootElement.querySelectorAll('.interactive-chart-container').forEach((wrap) => {
    const tooltip = wrap.querySelector('.chart-tooltip');
    const scrubber = wrap.querySelector('.chart-scrubber');
    const dateEl = wrap.querySelector('.tt-date');
    const paceEl = wrap.querySelector('.tt-pace');
    const capEl = wrap.querySelector('.tt-cap');
    const eventsEl = wrap.querySelector('.tt-events');

    if (!tooltip || !scrubber) return;

    wrap.querySelectorAll('[data-point-x]').forEach((el) => {
      const onMove = () => {
        const x = Number(el.getAttribute('data-point-x'));
        const date = el.getAttribute('data-date');
        const pace = Number(el.getAttribute('data-pace'));
        const cap = Number(el.getAttribute('data-cap'));
        let events = [];
        try {
          events = JSON.parse(el.getAttribute('data-events') || '[]');
        } catch (e) {}

        scrubber.style.display = 'block';
        scrubber.setAttribute('x1', x);
        scrubber.setAttribute('x2', x);

        if (dateEl) dateEl.textContent = date;
        if (paceEl) paceEl.textContent = '₹' + Math.round(pace).toLocaleString('en-IN');
        if (capEl) capEl.textContent = '₹' + Math.round(cap).toLocaleString('en-IN');

        if (eventsEl) {
          if (events && events.length) {
            eventsEl.style.display = 'block';
            eventsEl.innerHTML = events.map((ev) =>
              '<div style="margin-top:2px;font-size:10px;">' +
              (ev.direction === 'in' ? '<span style="color:#a6e3a1;">+ ' : '<span style="color:#f38ba8;">− ') +
              (ev.name || 'Event') + ': ₹' + Number(ev.amount).toLocaleString('en-IN') + '</span></div>'
            ).join('');
          } else {
            eventsEl.style.display = 'none';
          }
        }

        tooltip.style.display = 'block';
        const rect = wrap.getBoundingClientRect();
        let ttLeft = (x / 700) * rect.width - 90;
        ttLeft = Math.max(10, Math.min(rect.width - 200, ttLeft));
        tooltip.style.left = ttLeft + 'px';
      };

      el.addEventListener('mousemove', onMove);
      el.addEventListener('touchmove', onMove);
    });

    wrap.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
      scrubber.style.display = 'none';
    });
  });
}

/**
 * Horizontal spend vs funded bar chart for budgets & envelopes.
 */
export function renderSpendBarChart({ budgetDetails = [], width = 700 }) {
  if (!budgetDetails.length) {
    return `<div class="sub">No budgets configured yet.</div>`;
  }

  const rowH = 34;
  const padding = { top: 12, right: 100, bottom: 12, left: 120 };
  const totalH = padding.top + padding.bottom + budgetDetails.length * rowH;
  const barW = width - padding.left - padding.right;

  return `
    <svg viewBox="0 0 ${width} ${totalH}" style="width:100%;height:auto;display:block;background:#050608;border:1px solid #313244;">
      ${budgetDetails.map((b, idx) => {
        const y = padding.top + idx * rowH;
        const total = b.kind === 'daily' ? b.state.B : b.state.funded;
        const spent = b.kind === 'daily' ? b.state.spent : b.state.spent;
        const pct = total > 0 ? Math.min(100, (spent / total) * 100) : (spent > 0 ? 100 : 0);
        const isOver = spent > total;
        const fillW = Math.max(0, (pct / 100) * barW);

        return `
          <!-- Label -->
          <text x="${padding.left - 10}" y="${y + 16}" fill="#cdd6f4" font-size="11" font-family="monospace" text-anchor="end">${b.name}</text>
          
          <!-- Background bar -->
          <rect x="${padding.left}" y="${y + 6}" width="${barW}" height="14" fill="#181825" stroke="#313244" stroke-width="1"/>
          
          <!-- Filled bar -->
          <rect x="${padding.left}" y="${y + 6}" width="${fillW}" height="14" fill="${isOver ? '#f38ba8' : '#a6e3a1'}"/>
          
          <!-- Value Text -->
          <text x="${width - padding.right + 8}" y="${y + 17}" fill="${isOver ? '#f38ba8' : '#a6adc8'}" font-size="11" font-family="monospace">${formatINR(spent)} / ${formatINR(total)}</text>
        `;
      }).join('')}
    </svg>
  `;
}

/**
 * Segmented proportion bar representing distribution across physical pools.
 */
export function renderPoolProportions({ poolBalances = [], width = 700, height = 36 }) {
  const activePools = poolBalances.filter((p) => !p.isArchived && p.balance > 0);
  const total = activePools.reduce((sum, p) => sum + p.balance, 0);

  if (!total) {
    return `<div class="sub" style="padding:10px;text-align:center;">No positive pool balances recorded.</div>`;
  }

  const colors = ['#74c7ec', '#a6e3a1', '#cba6f7', '#fab387', '#f9e2af'];
  let currentX = 0;

  return `
    <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;display:block;background:#050608;border:1px solid #313244;">
      ${activePools.map((p, idx) => {
        const segW = (p.balance / total) * width;
        const x = currentX;
        currentX += segW;
        const color = colors[idx % colors.length];

        return `
          <rect x="${x}" y="0" width="${segW}" height="${height}" fill="${color}" stroke="#000" stroke-width="1"/>
          ${segW > 50 ? `
            <text x="${x + segW / 2}" y="${height / 2 + 4}" fill="#000" font-size="10" font-weight="700" font-family="monospace" text-anchor="middle">
              ${p.name.slice(0, 10)} (${Math.round((p.balance / total) * 100)}%)
            </text>
          ` : ''}
        `;
      }).join('')}
    </svg>
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:6px;font-family:monospace;font-size:11px;">
      ${activePools.map((p, idx) => `
        <span style="color:${colors[idx % colors.length]};">■ ${p.name}: ${formatINR(p.balance)}</span>
      `).join('')}
    </div>
  `;
}
