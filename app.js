/**
 * Swinglytics - Swing Trade & Partnership Tracker
 * Clean, Robust, High-Performance Dashboard
 * Features: Monthly Filtering, Live CMP, Partnership Split, Sleek Aesthetic Icons
 */

const DEFAULT_STATE = {
  settings: {
    partner1: { name: "Karthi", initialCapital: 100000 },
    partner2: { name: "Person 2", initialCapital: 0 },
    taxRate: 0.20, // 20% STCG
    strategies: ["Breakout", "Pullback", "EMA Bounce", "Support Bounce", "Chart Pattern", "Positional"]
  },
  trades: [
    {
      id: "trade_1",
      stock: "CUB",
      qty: 137,
      entryPrice: 230.34,
      exitPrice: 225.00,
      entryDate: "2026-09-10",
      exitDate: "2026-09-18",
      status: "CLOSED",
      p1SharePct: 100,
      p2SharePct: 0
    },
    {
      id: "trade_2",
      stock: "HINDZINC",
      qty: 22,
      entryPrice: 595.20,
      exitPrice: 554.50,
      entryDate: "2026-09-15",
      exitDate: "2026-09-22",
      status: "CLOSED",
      p1SharePct: 100,
      p2SharePct: 0
    },
    {
      id: "trade_3",
      stock: "CUPID",
      qty: 80,
      entryPrice: 312.00,
      exitPrice: 365.00,
      entryDate: "2026-09-20",
      exitDate: "2026-10-02",
      status: "CLOSED",
      p1SharePct: 100,
      p2SharePct: 0
    }
  ]
};

let appState = loadState();
let activeFilter = "ALL";
let selectedMonth = "ALL"; // 'ALL' or 'YYYY-MM'
let livePrices = {};
let isFetchingLivePrices = false;
let growthChartInstance = null;
let stockChartInstance = null;

// =================== HELPER FUNCTIONS ===================

function getTradeYearMonth(trade) {
  const dateStr = trade.exitDate || trade.entryDate;
  if (!dateStr) return null;
  return dateStr.substring(0, 7); // 'YYYY-MM'
}

function formatMonthName(ym) {
  if (!ym || ym === "ALL") return "All Months";
  const [year, month] = ym.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleString("en-US", { month: "long", year: "numeric" });
}

function formatINR(val, decimals = 2) {
  const num = Number(val || 0);
  const prefix = num < 0 ? "-₹" : "₹";
  return prefix + Math.abs(num).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

// =================== STATE MANAGEMENT ===================

function loadState() {
  try {
    const raw = localStorage.getItem("swing_trade_state_v1");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.trades && parsed.trades.length > 0) {
        if (!parsed.settings) parsed.settings = DEFAULT_STATE.settings;
        if (!parsed.settings.strategies || !Array.isArray(parsed.settings.strategies)) {
          parsed.settings.strategies = ["Breakout", "Pullback", "EMA Bounce", "Support Bounce", "Chart Pattern", "Positional"];
        }
        return parsed;
      }
    }
  } catch (e) {
    console.error("Failed to load local storage:", e);
  }
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function saveState() {
  localStorage.setItem("swing_trade_state_v1", JSON.stringify(appState));
  renderAll();
}

// =================== CALCULATIONS ===================

// Zerodha Kite Swing / Delivery Charges Calculator
function calculateZerodhaCharges(buyValue, sellValue) {
  if (!buyValue || buyValue <= 0) return 0;
  const sell = (sellValue && sellValue > 0) ? sellValue : buyValue;
  const turnover = buyValue + sell;

  // 1. Brokerage: ₹0 for Equity Delivery (Swing)
  const brokerage = 0;

  // 2. STT: 0.1% on Buy + 0.1% on Sell
  const stt = turnover * 0.001;

  // 3. Exchange Transaction Charges (NSE): 0.00297% of turnover
  const exchTxn = turnover * 0.0000297;

  // 4. SEBI Turnover Charges: ₹10 / crore (0.0001% of turnover)
  const sebi = turnover * 0.000001;

  // 5. Stamp Duty: 0.015% on Buy turnover
  const stampDuty = buyValue * 0.00015;

  // 6. DP Charges: ₹13 + 18% GST = ₹15.34 per scrip on sell
  const dpCharges = 15.34;

  // 7. GST: 18% on (Brokerage + Exchange Txn Charges + SEBI Fees)
  const gst = 0.18 * (brokerage + exchTxn + sebi);

  const totalCharges = stt + exchTxn + sebi + stampDuty + dpCharges + gst;
  return Math.round(totalCharges * 100) / 100;
}

function calculateTradeMetrics(trade) {
  const invested = trade.qty * trade.entryPrice;
  const isOpen = trade.status === "OPEN";

  let effectiveExitPrice = trade.exitPrice;
  let isLivePrice = false;

  if (isOpen) {
    const liveObj = livePrices[trade.stock.toUpperCase()];
    if (liveObj && liveObj.price) {
      effectiveExitPrice = liveObj.price;
      isLivePrice = true;
    } else if (!effectiveExitPrice || effectiveExitPrice === 0) {
      effectiveExitPrice = trade.entryPrice;
    }
  }

  const exitValue = trade.qty * (effectiveExitPrice || trade.entryPrice);
  const grossPnL = exitValue - invested;
  const pnlPercent = invested > 0 ? (grossPnL / invested) * 100 : 0;
  
  const tax = (!isOpen && grossPnL > 0) ? grossPnL * appState.settings.taxRate : 0;
  const charges = isOpen ? 0 : calculateZerodhaCharges(invested, exitValue);
  const netPnL = grossPnL - tax - charges;

  const p1Ratio = (trade.p1SharePct || 100) / 100;
  const p2Ratio = (trade.p2SharePct || 0) / 100;

  const p1Share = netPnL * p1Ratio;
  const p2Share = netPnL * p2Ratio;

  return {
    invested,
    effectiveExitPrice,
    isLivePrice,
    isOpen,
    exitValue,
    grossPnL,
    pnlPercent,
    tax,
    charges,
    netPnL,
    p1Share,
    p2Share
  };
}

function calculateSummary() {
  // Respect month filtering for KPIs & summary
  let closedTrades = appState.trades.filter(t => t.status === "CLOSED" || !t.status);
  let openTrades = appState.trades.filter(t => t.status === "OPEN");

  if (selectedMonth !== "ALL") {
    closedTrades = closedTrades.filter(t => getTradeYearMonth(t) === selectedMonth);
    openTrades = openTrades.filter(t => getTradeYearMonth(t) === selectedMonth);
  }
  
  let totalTrades = closedTrades.length;
  let winningTrades = 0;
  let losingTrades = 0;
  let totalGrossWin = 0;
  let totalGrossLoss = 0;
  let totalInvested = 0;
  let totalGrossPnL = 0;
  let totalTax = 0;
  let totalCharges = 0;
  let totalNetPnL = 0;
  let p1TotalProfitShare = 0;
  let p1TotalLossShare = 0;
  let p2TotalProfitShare = 0;
  let p2TotalLossShare = 0;

  closedTrades.forEach(t => {
    const m = calculateTradeMetrics(t);
    totalInvested += m.invested;
    totalGrossPnL += m.grossPnL;
    totalTax += m.tax;
    totalCharges += m.charges;
    totalNetPnL += m.netPnL;

    if (m.grossPnL > 0) {
      winningTrades++;
      totalGrossWin += m.grossPnL;
      p1TotalProfitShare += m.p1Share;
      p2TotalProfitShare += m.p2Share;
    } else if (m.grossPnL < 0) {
      losingTrades++;
      totalGrossLoss += Math.abs(m.grossPnL);
      p1TotalLossShare += Math.abs(m.p1Share);
      p2TotalLossShare += Math.abs(m.p2Share);
    }
  });

  openTrades.forEach(t => {
    totalInvested += (t.qty * t.entryPrice);
  });

  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
  const profitFactor = totalGrossLoss > 0 ? (totalGrossWin / totalGrossLoss) : (totalGrossWin > 0 ? 99 : 0);
  const avgWin = winningTrades > 0 ? (totalGrossWin / winningTrades) : 0;
  const avgLoss = losingTrades > 0 ? (totalGrossLoss / losingTrades) : 0;

  const p1Initial = appState.settings.partner1.initialCapital || 0;
  const p2Initial = appState.settings.partner2.initialCapital || 0;
  
  // Real Demat Balance: Initial capital + Net gains
  const p1NetShare = p1TotalProfitShare - p1TotalLossShare;
  const p2NetShare = p2TotalProfitShare - p2TotalLossShare;

  const p1Current = p1Initial + p1NetShare;
  const p2Current = p2Initial + p2NetShare;
  const totalCurrentCapital = p1Current + p2Current;

  return {
    totalTrades,
    winningTrades,
    losingTrades,
    openCount: openTrades.length,
    winRate,
    totalInvested,
    totalGrossPnL,
    totalTax,
    totalCharges,
    totalNetPnL,
    profitFactor,
    avgWin,
    avgLoss,
    p1Initial,
    p2Initial,
    p1Current,
    p2Current,
    p1NetShare,
    p2NetShare,
    totalCurrentCapital,
    p1TotalProfitShare,
    p1TotalLossShare,
    p2TotalProfitShare,
    p2TotalLossShare
  };
}

// =================== UI RENDERERS ===================

function renderAll() {
  populateMonthDropdown();
  const summary = calculateSummary();
  renderKPIs(summary);
  renderPartnerCards(summary);
  renderTable(summary);
  renderCharts();
  lucide.createIcons();
}

function populateMonthDropdown() {
  const select = document.getElementById("monthFilterSelect");
  const label = document.getElementById("monthDropdownLabel");
  const menu = document.getElementById("monthDropdownMenu");

  const monthSet = new Set();
  appState.trades.forEach(t => {
    const ym = getTradeYearMonth(t);
    if (ym) monthSet.add(ym);
  });

  const sortedMonths = Array.from(monthSet).sort().reverse();
  const currentVal = selectedMonth;

  // Update button label
  if (label) {
    label.textContent = currentVal === "ALL" ? "All Months" : formatMonthName(currentVal);
  }

  // Update hidden select if present
  if (select) {
    select.innerHTML = `<option value="ALL">All Months</option>`;
    sortedMonths.forEach(ym => {
      const opt = document.createElement("option");
      opt.value = ym;
      opt.textContent = formatMonthName(ym);
      if (ym === currentVal) opt.selected = true;
      select.appendChild(opt);
    });
  }

  // Populate custom menu
  if (menu) {
    const options = [
      { value: "ALL", label: "All Months" },
      ...sortedMonths.map(ym => ({ value: ym, label: formatMonthName(ym) }))
    ];

    menu.innerHTML = options.map(opt => {
      const isSelected = opt.value === currentVal;
      return `
        <button type="button" data-value="${opt.value}" class="month-option-btn w-full text-left px-3 py-2 text-xs sm:text-sm rounded-lg flex items-center justify-between transition-colors ${
          isSelected 
            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold' 
            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60'
        }">
          <span>${opt.label}</span>
          ${isSelected ? '<i data-lucide="check" class="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400"></i>' : ''}
        </button>
      `;
    }).join("");

    menu.querySelectorAll(".month-option-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        selectedMonth = btn.getAttribute("data-value");
        closeMonthDropdown();
        renderAll();
      });
    });
  }
}

function toggleMonthDropdown() {
  const menu = document.getElementById("monthDropdownMenu");
  const chevron = document.getElementById("monthDropdownChevron");
  if (!menu) return;
  const isHidden = menu.classList.contains("hidden");
  if (isHidden) {
    menu.classList.remove("hidden");
    if (chevron) chevron.classList.add("rotate-180");
  } else {
    menu.classList.add("hidden");
    if (chevron) chevron.classList.remove("rotate-180");
  }
}

function closeMonthDropdown() {
  const menu = document.getElementById("monthDropdownMenu");
  const chevron = document.getElementById("monthDropdownChevron");
  if (menu && !menu.classList.contains("hidden")) {
    menu.classList.add("hidden");
    if (chevron) chevron.classList.remove("rotate-180");
  }
}

function renderKPIs(s) {
  document.getElementById("kpiTotalCapital").textContent = formatINR(s.totalCurrentCapital);
  document.getElementById("kpiInvestedCapital").textContent = formatINR(s.totalInvested);
  
  // Gross P&L Card (Gross minus Charges)
  const grossCard = document.getElementById("kpiGrossPnLCard");
  const grossAfterCharges = s.totalGrossPnL - s.totalCharges;
  if (grossCard) {
    grossCard.textContent = formatINR(grossAfterCharges);
    grossCard.className = `text-lg sm:text-xl font-bold mono ${grossAfterCharges >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`;
  }

  const chargesElem = document.getElementById("kpiChargesPaid");
  if (chargesElem) {
    chargesElem.textContent = formatINR(s.totalCharges);
  }

  // Net P&L Card
  const netElem = document.getElementById("kpiNetPnL");
  netElem.textContent = formatINR(s.totalNetPnL);
  netElem.className = `text-lg sm:text-xl font-bold mono ${s.totalNetPnL >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`;

  document.getElementById("kpiTaxPaid").textContent = formatINR(s.totalTax);

  document.getElementById("kpiWinRate").textContent = `${s.winRate.toFixed(1)}%`;
  document.getElementById("kpiTradeCounts").textContent = `(${s.winningTrades}W / ${s.losingTrades}L)`;
  document.getElementById("kpiTotalTrades").textContent = s.totalTrades;

  document.getElementById("kpiProfitFactor").textContent = s.profitFactor > 50 ? "MAX" : s.profitFactor.toFixed(2);
  document.getElementById("kpiAvgWin").textContent = formatINR(s.avgWin, 0);
  document.getElementById("kpiAvgLoss").textContent = formatINR(s.avgLoss, 0);
}

function renderPartnerCards(s) {
  const p1 = appState.settings.partner1;
  const p2 = appState.settings.partner2;

  document.getElementById("partner1NameDisplay").textContent = p1.name;
  document.getElementById("partner2NameDisplay").textContent = p2.name;

  const thP1 = document.getElementById("thP1ShareHeader");
  const thP2 = document.getElementById("thP2ShareHeader");
  if (thP1) thP1.textContent = `${p1.name} Share`;
  if (thP2) thP2.textContent = `${p2.name} Share`;

  const totalCap = s.totalCurrentCapital || 1;
  const p1SharePct = ((s.p1Current / totalCap) * 100).toFixed(0);
  const p2SharePct = ((s.p2Current / totalCap) * 100).toFixed(0);

  document.getElementById("partner1SharePercent").textContent = `${p1SharePct}% Capital Share`;
  document.getElementById("partner2SharePercent").textContent = `${p2SharePct}% Capital Share`;

  document.getElementById("p1CurrentCap").textContent = formatINR(s.p1Current);
  document.getElementById("p1ProfitShare").textContent = formatINR(s.p1NetShare);
  document.getElementById("p1LossShare").textContent = formatINR(s.p1TotalLossShare);

  document.getElementById("p2CurrentCap").textContent = formatINR(s.p2Current);
  document.getElementById("p2ProfitShare").textContent = formatINR(s.p2NetShare);
  document.getElementById("p2LossShare").textContent = formatINR(s.p2TotalLossShare);

  document.getElementById("p1LabelModal").textContent = p1.name;
  document.getElementById("p2LabelModal").textContent = p2.name;
}

function renderTable(s) {
  const tbody = document.getElementById("tradeTableBody");
  tbody.innerHTML = "";

  const openBadge = document.getElementById("openCountBadge");
  if (openBadge) openBadge.textContent = s.openCount || 0;

  const searchKeyword = (document.getElementById("searchTradeInput").value || "").trim().toUpperCase();

  let filtered = appState.trades.filter(t => {
    // Month filter
    if (selectedMonth !== "ALL" && getTradeYearMonth(t) !== selectedMonth) {
      return false;
    }
    if (searchKeyword) {
      const matchStock = t.stock && t.stock.toUpperCase().includes(searchKeyword);
      const matchStrategy = t.strategy && t.strategy.toUpperCase().includes(searchKeyword);
      if (!matchStock && !matchStrategy) return false;
    }
    const m = calculateTradeMetrics(t);
    if (activeFilter === "OPEN") return t.status === "OPEN";
    if (activeFilter === "PROFIT") return m.grossPnL > 0;
    if (activeFilter === "LOSS") return m.grossPnL < 0;
    return true;
  });

  document.getElementById("badgeTradeCount").textContent = filtered.length;

  let totalQty = 0;
  let totalInvested = 0;
  let totalGross = 0;
  let totalTax = 0;
  let totalCharges = 0;
  let totalNet = 0;
  let totalP1Share = 0;
  let totalP2Share = 0;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="14" class="px-4 py-8 text-center text-slate-500">
          No trades found. Click "+ Add Trade" to log a new position.
        </td>
      </tr>
    `;
  } else {
    filtered.forEach(t => {
      const m = calculateTradeMetrics(t);
      totalQty += Number(t.qty);
      totalInvested += m.invested;
      totalGross += m.grossPnL;
      totalTax += m.tax;
      totalCharges += m.charges;
      totalNet += m.netPnL;
      totalP1Share += m.p1Share;
      totalP2Share += m.p2Share;

      const isProfit = m.grossPnL >= 0;
      let statusBadge = "";

      if (t.status === "OPEN") {
        statusBadge = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30 animate-pulse">
          <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span> OPEN
        </span>`;
      } else {
        statusBadge = isProfit 
          ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Profit</span>`
          : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">Loss</span>`;
      }

      let exitPriceDisplay = "";
      if (t.status === "OPEN") {
        if (m.isLivePrice) {
          exitPriceDisplay = `
            <div class="text-emerald-400 font-bold">${formatINR(m.effectiveExitPrice)}</div>
            <span class="text-[9px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-semibold uppercase">Live CMP</span>
          `;
        } else {
          exitPriceDisplay = `
            <div class="text-amber-400 font-semibold">${m.effectiveExitPrice > 0 ? formatINR(m.effectiveExitPrice) : 'Fetching...'}</div>
            <span class="text-[9px] text-slate-500 uppercase">Live CMP</span>
          `;
        }
      } else {
        exitPriceDisplay = `<div class="text-slate-300">${formatINR(t.exitPrice)}</div>`;
      }

      // Calculate Holding Days
      let holdingDaysBadge = "";
      if (t.entryDate) {
        const d1 = new Date(t.entryDate);
        const d2 = (t.status === "OPEN" || !t.exitDate) ? new Date() : new Date(t.exitDate);
        if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
          const diffDays = Math.max(0, Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)));
          holdingDaysBadge = `<span class="px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 font-mono text-[9px] font-semibold" title="Holding Period: ${diffDays} day(s)">${diffDays}d</span>`;
        }
      }

      const tr = document.createElement("tr");
      tr.className = "hover:bg-slate-50 dark:hover:bg-slate-800/40 transition group";
      tr.innerHTML = `
        <td class="px-4 py-3">
          <div class="font-bold text-slate-900 dark:text-white tracking-wide flex items-center gap-1.5 flex-wrap">
            <span>${t.stock}</span>
            ${t.status === "OPEN" ? '<span class="text-[9px] bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-300 px-1 rounded">Holding</span>' : ''}
            ${t.strategy ? `<span class="text-[9px] px-1.5 py-0.2 rounded bg-purple-500/10 dark:bg-purple-500/20 text-purple-600 dark:text-purple-300 border border-purple-500/20 font-medium">${t.strategy}</span>` : ''}
          </div>
          <div class="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span>${t.entryDate || "-"} &rarr; ${t.exitDate || (t.status === "OPEN" ? "Holding" : "-")}</span>
            ${holdingDaysBadge}
          </div>
        </td>
        <td class="px-3 py-3 text-right mono font-medium text-slate-700 dark:text-slate-300">${t.qty}</td>
        <td class="px-3 py-3 text-right mono text-slate-700 dark:text-slate-300">${formatINR(t.entryPrice)}</td>
        <td class="px-3 py-3 text-right mono">${exitPriceDisplay}</td>
        <td class="px-3 py-3 text-right mono font-medium text-slate-800 dark:text-slate-200">${formatINR(m.invested)}</td>
        <td class="px-3 py-3 text-right mono font-semibold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}">
          ${formatINR(m.grossPnL)}
          <span class="text-[10px] block opacity-75">${m.pnlPercent >= 0 ? '+' : ''}${m.pnlPercent.toFixed(2)}%</span>
        </td>
        <td class="px-3 py-3 text-right mono text-amber-500 dark:text-amber-400">${t.status === "OPEN" ? '-' : formatINR(m.tax)}</td>
        <td class="px-3 py-3 text-right mono text-amber-500 dark:text-amber-400">${t.status === "OPEN" ? '-' : formatINR(m.charges)}</td>
        <td class="px-3 py-3 text-right mono font-bold ${m.netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}">
          ${formatINR(m.netPnL)}
          ${t.status === "OPEN" ? '<span class="text-[9px] font-normal block text-slate-400">(Unrealized)</span>' : ''}
        </td>
        <td class="px-3 py-3 text-center text-[11px] font-mono text-slate-400">
          <span class="text-blue-400 font-semibold">${t.p1SharePct}%</span> / <span class="text-purple-400 font-semibold">${t.p2SharePct}%</span>
        </td>
        <td class="px-3 py-3 text-right mono font-medium ${m.p1Share >= 0 ? 'text-blue-400' : 'text-rose-400'}">
          ${formatINR(m.p1Share)}
        </td>
        <td class="px-3 py-3 text-right mono font-medium ${m.p2Share >= 0 ? 'text-purple-400' : 'text-rose-400'}">
          ${formatINR(m.p2Share)}
        </td>
        <td class="px-3 py-3 text-center">
          ${statusBadge}
        </td>
        <td class="px-4 py-3 text-right">
          <div class="flex items-center justify-end gap-1.5">
            ${t.status === "OPEN" ? `
              <button onclick="quickCloseTrade('${t.id}')" class="px-2 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-[11px] transition shadow-sm" title="Close Position">
                Close
              </button>
            ` : ''}
            <button onclick="editTrade('${t.id}')" class="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition" title="Edit">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <button onclick="deleteTrade('${t.id}')" class="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition" title="Delete">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Footer Totals
  document.getElementById("tfootTotalQty").textContent = totalQty;
  document.getElementById("tfootTotalInvested").textContent = formatINR(totalInvested);
  
  const gElem = document.getElementById("tfootGrossPnL");
  gElem.textContent = formatINR(totalGross);
  gElem.className = `px-3 py-3 text-right mono font-bold ${totalGross >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

  document.getElementById("tfootTax").textContent = formatINR(totalTax);

  const cElem = document.getElementById("tfootCharges");
  if (cElem) cElem.textContent = formatINR(totalCharges);

  const nElem = document.getElementById("tfootNetPnL");
  nElem.textContent = formatINR(totalNet);
  nElem.className = `px-3 py-3 text-right mono font-bold ${totalNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

  document.getElementById("tfootP1Share").textContent = formatINR(totalP1Share);
  document.getElementById("tfootP2Share").textContent = formatINR(totalP2Share);
}

// =================== CHARTS ===================

function renderCharts() {
  let closedTrades = appState.trades.filter(t => t.status === "CLOSED" || !t.status);

  if (selectedMonth !== "ALL") {
    closedTrades = closedTrades.filter(t => getTradeYearMonth(t) === selectedMonth);
  }

  const isDark = document.documentElement.classList.contains("dark");
  const tickColor = isDark ? '#94a3b8' : '#64748b';
  const gridColor = isDark ? 'rgba(51, 65, 85, 0.3)' : 'rgba(226, 232, 240, 0.8)';
  const tooltipBg = isDark ? '#0f172a' : '#ffffff';
  const tooltipBorder = isDark ? '#334155' : '#e2e8f0';
  const tooltipTitle = isDark ? '#94a3b8' : '#475569';

  // 1. Cumulative Growth Chart
  const growthCtx = document.getElementById("growthChart").getContext("2d");
  let runningPnL = 0;
  const growthLabels = ["Start"];
  const growthData = [0];

  closedTrades.forEach(t => {
    const m = calculateTradeMetrics(t);
    runningPnL += m.netPnL;
    growthLabels.push(t.stock);
    growthData.push(runningPnL);
  });

  if (growthChartInstance) growthChartInstance.destroy();

  growthChartInstance = new Chart(growthCtx, {
    type: 'line',
    data: {
      labels: growthLabels,
      datasets: [{
        label: 'Cumulative Net P&L (₹)',
        data: growthData,
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        borderWidth: 2.5,
        fill: true,
        tension: 0.35,
        pointBackgroundColor: '#10b981',
        pointRadius: 4,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: tooltipBg,
          titleColor: tooltipTitle,
          bodyColor: '#10b981',
          borderColor: tooltipBorder,
          borderWidth: 1,
          callbacks: {
            label: (ctx) => ` P&L: ₹${ctx.parsed.y.toLocaleString('en-IN')}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: { color: tickColor, font: { size: 10 } }
        },
        y: {
          grid: { color: gridColor },
          ticks: {
            color: tickColor,
            font: { size: 10 },
            callback: (v) => '₹' + v.toLocaleString('en-IN')
          }
        }
      }
    }
  });

  // 2. Stock-wise P&L Bar Chart
  const stockCtx = document.getElementById("stockChart").getContext("2d");
  const stockLabels = [];
  const stockValues = [];
  const stockColors = [];

  closedTrades.forEach(t => {
    const m = calculateTradeMetrics(t);
    stockLabels.push(t.stock);
    stockValues.push(m.grossPnL);
    stockColors.push(m.grossPnL >= 0 ? '#10b981' : '#f43f5e');
  });

  if (stockChartInstance) stockChartInstance.destroy();

  stockChartInstance = new Chart(stockCtx, {
    type: 'bar',
    data: {
      labels: stockLabels,
      datasets: [{
        label: 'Gross P&L (₹)',
        data: stockValues,
        backgroundColor: stockColors,
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: tooltipBg,
          titleColor: tooltipTitle,
          bodyColor: isDark ? '#ffffff' : '#0f172a',
          borderColor: tooltipBorder,
          borderWidth: 1,
          callbacks: {
            label: (ctx) => ` P&L: ₹${ctx.parsed.y.toLocaleString('en-IN')}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: tickColor, font: { size: 10 } }
        },
        y: {
          grid: { color: gridColor },
          ticks: {
            color: tickColor,
            font: { size: 10 },
            callback: (v) => '₹' + v.toLocaleString('en-IN')
          }
        }
      }
    }
  });
}

// =================== TRADE MODAL & FORM ===================

const tradeModal = document.getElementById("tradeModal");
const tradeForm = document.getElementById("tradeForm");
const tradeEditId = document.getElementById("tradeEditId");
const tradeStock = document.getElementById("tradeStock");
const tradeQty = document.getElementById("tradeQty");
const tradeEntryPrice = document.getElementById("tradeEntryPrice");
const tradeExitPrice = document.getElementById("tradeExitPrice");
const tradeEntryDate = document.getElementById("tradeEntryDate");
const tradeExitDate = document.getElementById("tradeExitDate");
const tradeStatusSelect = document.getElementById("tradeStatusSelect");
const tradeP1Share = document.getElementById("tradeP1Share");
const tradeP2Share = document.getElementById("tradeP2Share");
const modalEstPnL = document.getElementById("modalEstPnL");

// =================== STRATEGY MANAGEMENT ===================

function populateStrategyPresetDropdown(selectedVal = "") {
  const select = document.getElementById("tradeStrategyPreset");
  if (!select) return;

  const list = (appState.settings && appState.settings.strategies) ? appState.settings.strategies : [];
  select.innerHTML = `<option value="">Select Preset...</option>` + 
    list.map(s => `<option value="${s}" ${s === selectedVal ? 'selected' : ''}>${s}</option>`).join("") +
    `<option value="__MANAGE__">⚙️ Add / Delete Strategies...</option>`;
}

function renderStrategyManagerList() {
  const container = document.getElementById("strategyListContainer");
  const countElem = document.getElementById("strategyCount");
  if (!container) return;

  const list = (appState.settings && appState.settings.strategies) ? appState.settings.strategies : [];
  if (countElem) countElem.textContent = list.length;

  if (list.length === 0) {
    container.innerHTML = `<div class="p-3 text-center text-xs text-slate-400">No strategies yet. Add your first setup above!</div>`;
    return;
  }

  container.innerHTML = list.map((strat, idx) => `
    <div class="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/60 transition group hover:border-slate-300 dark:hover:border-slate-600">
      <span class="text-xs font-semibold text-slate-800 dark:text-slate-200">${strat}</span>
      <button type="button" onclick="deleteStrategy(${idx})" class="p-1 rounded text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition" title="Delete ${strat}">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
      </button>
    </div>
  `).join("");
}

function addNewStrategy() {
  const input = document.getElementById("newStrategyInput");
  if (!input) return;
  const val = input.value.trim();
  if (!val) return;

  if (!appState.settings) appState.settings = {};
  if (!appState.settings.strategies) appState.settings.strategies = [];
  
  if (appState.settings.strategies.some(s => s.toLowerCase() === val.toLowerCase())) {
    alert("This strategy already exists!");
    return;
  }

  appState.settings.strategies.push(val);
  saveState();
  input.value = "";
  renderStrategyManagerList();
  populateStrategyPresetDropdown(val);
  const tradeStrat = document.getElementById("tradeStrategy");
  if (tradeStrat) tradeStrat.value = val;
}

function deleteStrategy(index) {
  if (!appState.settings || !appState.settings.strategies) return;
  const removed = appState.settings.strategies[index];
  if (confirm(`Delete strategy "${removed}"?`)) {
    appState.settings.strategies.splice(index, 1);
    saveState();
    renderStrategyManagerList();
    populateStrategyPresetDropdown();
  }
}

function openStrategyModal() {
  const modal = document.getElementById("strategyModal");
  if (!modal) return;
  renderStrategyManagerList();
  modal.classList.remove("hidden");
  const input = document.getElementById("newStrategyInput");
  if (input) {
    input.value = "";
    setTimeout(() => input.focus(), 50);
  }
}

function closeStrategyModal() {
  const modal = document.getElementById("strategyModal");
  if (modal) modal.classList.add("hidden");
}

function openTradeModal(editId = null) {
  tradeForm.reset();
  tradeEditId.value = "";
  
  if (editId) {
    const trade = appState.trades.find(t => t.id === editId);
    if (trade) {
      document.getElementById("tradeModalTitle").innerHTML = `<i data-lucide="edit-3" class="w-5 h-5 text-emerald-400"></i> Edit Trade`;
      tradeEditId.value = trade.id;
      tradeStock.value = trade.stock;
      tradeQty.value = trade.qty;
      tradeEntryPrice.value = trade.entryPrice;
      tradeExitPrice.value = trade.exitPrice || "";
      tradeEntryDate.value = trade.entryDate || "";
      tradeExitDate.value = trade.exitDate || "";
      tradeStatusSelect.value = trade.status || "CLOSED";
      tradeP1Share.value = trade.p1SharePct !== undefined ? trade.p1SharePct : 100;
      tradeP2Share.value = 100 - Number(tradeP1Share.value);
      const stratInput = document.getElementById("tradeStrategy");
      if (stratInput) stratInput.value = trade.strategy || "";
      populateStrategyPresetDropdown(trade.strategy || "");
    }
  } else {
    document.getElementById("tradeModalTitle").innerHTML = `<i data-lucide="plus-circle" class="w-5 h-5 text-emerald-400"></i> Add New Trade`;
    const summary = calculateSummary();
    const total = summary.totalCurrentCapital || 1;
    const p1Pct = Math.round((summary.p1Current / total) * 100);
    tradeP1Share.value = p1Pct;
    tradeP2Share.value = 100 - p1Pct;
    tradeStatusSelect.value = "OPEN";
    tradeEntryDate.value = new Date().toISOString().split('T')[0];
    const stratInput = document.getElementById("tradeStrategy");
    if (stratInput) stratInput.value = "";
    populateStrategyPresetDropdown("");
  }

  updateModalCalculation();
  tradeModal.classList.remove("hidden");
  lucide.createIcons();
  tradeStock.focus();
}

function closeTradeModal() {
  tradeModal.classList.add("hidden");
}

function updateModalCalculation() {
  const qty = parseFloat(tradeQty.value) || 0;
  const entry = parseFloat(tradeEntryPrice.value) || 0;
  const exit = parseFloat(tradeExitPrice.value) || 0;
  
  const invested = qty * entry;
  const gross = (exit - entry) * qty;
  const pct = invested > 0 ? (gross / invested) * 100 : 0;

  if (invested > 0 && exit > 0) {
    modalEstPnL.textContent = `${formatINR(gross)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
    modalEstPnL.className = `font-bold mono ${gross >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
  } else {
    modalEstPnL.textContent = "Live CMP will calculate automatically";
    modalEstPnL.className = "font-medium text-xs text-slate-400";
  }
}

tradeP1Share.addEventListener("input", () => {
  let val = Math.min(100, Math.max(0, parseInt(tradeP1Share.value) || 0));
  tradeP1Share.value = val;
  tradeP2Share.value = 100 - val;
});

const tradeStrategyPresetElem = document.getElementById("tradeStrategyPreset");
const tradeStrategyElem = document.getElementById("tradeStrategy");
if (tradeStrategyPresetElem && tradeStrategyElem) {
  tradeStrategyPresetElem.addEventListener("change", (e) => {
    if (e.target.value === "__MANAGE__") {
      openStrategyModal();
      tradeStrategyPresetElem.value = "";
    } else if (e.target.value) {
      tradeStrategyElem.value = e.target.value;
    }
  });
}

// Strategy Modal button listeners
const btnOpenStrat = document.getElementById("btnOpenStrategyModal");
if (btnOpenStrat) btnOpenStrat.addEventListener("click", openStrategyModal);

const btnCloseStrat = document.getElementById("btnCloseStrategyModal");
if (btnCloseStrat) btnCloseStrat.addEventListener("click", closeStrategyModal);

const btnDoneStrat = document.getElementById("btnDoneStrategyModal");
if (btnDoneStrat) btnDoneStrat.addEventListener("click", closeStrategyModal);

const btnAddStrat = document.getElementById("btnAddStrategy");
if (btnAddStrat) btnAddStrat.addEventListener("click", addNewStrategy);

const newStratInput = document.getElementById("newStrategyInput");
if (newStratInput) {
  newStratInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addNewStrategy();
    }
  });
}

tradeQty.addEventListener("input", updateModalCalculation);
tradeEntryPrice.addEventListener("input", updateModalCalculation);
tradeExitPrice.addEventListener("input", updateModalCalculation);

tradeForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const id = tradeEditId.value || `trade_${Date.now()}`;
  const status = tradeStatusSelect.value;
  const exitVal = parseFloat(tradeExitPrice.value);
  const strategyInput = document.getElementById("tradeStrategy");

  const newTrade = {
    id,
    stock: tradeStock.value.trim().toUpperCase(),
    qty: parseFloat(tradeQty.value),
    entryPrice: parseFloat(tradeEntryPrice.value),
    exitPrice: !isNaN(exitVal) ? exitVal : 0,
    entryDate: tradeEntryDate.value,
    exitDate: tradeExitDate.value,
    status: status,
    strategy: strategyInput ? strategyInput.value.trim() : "",
    p1SharePct: parseInt(tradeP1Share.value) || 0,
    p2SharePct: parseInt(tradeP2Share.value) || 0
  };

  if (tradeEditId.value) {
    const idx = appState.trades.findIndex(t => t.id === tradeEditId.value);
    if (idx !== -1) appState.trades[idx] = newTrade;
  } else {
    appState.trades.push(newTrade);
  }

  saveState();
  closeTradeModal();

  if (status === "OPEN") {
    fetchLiveCMP(newTrade.stock).then(() => renderAll());
  }
});

// Quick close an OPEN position
window.quickCloseTrade = function(id) {
  const trade = appState.trades.find(t => t.id === id);
  if (!trade) return;

  const currentCMP = livePrices[trade.stock.toUpperCase()]?.price || trade.entryPrice;
  const exitInput = prompt(`Enter Sold / Exit Price for ${trade.stock}:`, currentCMP);
  if (exitInput === null) return;

  const exitPrice = parseFloat(exitInput);
  if (isNaN(exitPrice) || exitPrice <= 0) {
    alert("Please enter a valid exit price.");
    return;
  }

  trade.status = "CLOSED";
  trade.exitPrice = exitPrice;
  trade.exitDate = new Date().toISOString().split('T')[0];
  saveState();
};

window.editTrade = function(id) {
  openTradeModal(id);
};

window.deleteTrade = function(id) {
  if (confirm("Are you sure you want to delete this trade?")) {
    appState.trades = appState.trades.filter(t => t.id !== id);
    saveState();
  }
};

// =================== LIVE PRICE (YAHOO FINANCE) ===================

async function fetchLiveCMP(symbol) {
  const cleanSymbol = symbol.trim().toUpperCase();
  const querySymbol = cleanSymbol.includes(".") ? cleanSymbol : `${cleanSymbol}.NS`;

  try {
    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${querySymbol}?interval=1d&range=1d`;
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
    
    const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(6000) });
    if (response.ok) {
      const data = await response.json();
      const parsed = JSON.parse(data.contents);
      const currentPrice = parsed.chart.result[0].meta.regularMarketPrice;

      if (currentPrice && !isNaN(currentPrice)) {
        livePrices[cleanSymbol] = {
          price: Number(currentPrice),
          lastUpdated: Date.now()
        };
        return livePrices[cleanSymbol];
      }
    }
  } catch (err) {
    console.warn(`Primary proxy failed for ${cleanSymbol}`);
  }
  return null;
}

async function refreshAllOpenPrices() {
  const openTrades = appState.trades.filter(t => t.status === "OPEN");
  const refreshIcon = document.getElementById("cmpRefreshIcon");
  
  if (refreshIcon) refreshIcon.classList.add("animate-spin");

  if (openTrades.length === 0) {
    setTimeout(() => {
      if (refreshIcon) refreshIcon.classList.remove("animate-spin");
      alert("No 'OPEN' trades currently. When you add a trade with status OPEN, this button fetches its live price!");
    }, 300);
    return;
  }

  let successCount = 0;
  for (const t of openTrades) {
    const res = await fetchLiveCMP(t.stock);
    if (res) successCount++;
  }

  if (refreshIcon) refreshIcon.classList.remove("animate-spin");
  renderAll();
  alert(`Live CMP updated successfully for ${successCount}/${openTrades.length} open position(s)!`);
}

// =================== CAPITAL MODAL ===================

const capitalModal = document.getElementById("capitalModal");
const capitalForm = document.getElementById("capitalForm");

function openCapitalModal() {
  document.getElementById("capP1Name").value = appState.settings.partner1.name;
  document.getElementById("capP1Initial").value = appState.settings.partner1.initialCapital;
  document.getElementById("capP2Name").value = appState.settings.partner2.name;
  document.getElementById("capP2Initial").value = appState.settings.partner2.initialCapital;
  capitalModal.classList.remove("hidden");
}

function closeCapitalModal() {
  capitalModal.classList.add("hidden");
}

capitalForm.addEventListener("submit", (e) => {
  e.preventDefault();
  appState.settings.partner1.name = document.getElementById("capP1Name").value.trim() || "Karthi";
  appState.settings.partner1.initialCapital = parseFloat(document.getElementById("capP1Initial").value) || 0;
  appState.settings.partner2.name = document.getElementById("capP2Name").value.trim() || "Person 2";
  appState.settings.partner2.initialCapital = parseFloat(document.getElementById("capP2Initial").value) || 0;
  saveState();
  closeCapitalModal();
});

// =================== EXPORT & IMPORT ===================

function exportJSON() {
  const blob = new Blob([JSON.stringify(appState, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `swing_trades_backup_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCSV() {
  const headers = [
    "Stock", "Strategy", "Qty", "Entry Price", "Exit Price", "Invested (INR)",
    "Gross P&L (INR)", "P&L %", "Tax @20% (INR)", "Charges (INR)", "Net P&L (INR)",
    "P1 Share %", "P2 Share %", "P1 Share (INR)", "P2 Share (INR)",
    "Entry Date", "Exit Date", "Status"
  ];

  const rows = appState.trades.map(t => {
    const m = calculateTradeMetrics(t);
    return [
      t.stock,
      t.strategy || "",
      t.qty,
      t.entryPrice,
      m.effectiveExitPrice || t.exitPrice,
      m.invested.toFixed(2),
      m.grossPnL.toFixed(2),
      m.pnlPercent.toFixed(2) + "%",
      m.tax.toFixed(2),
      m.charges.toFixed(2),
      m.netPnL.toFixed(2),
      t.p1SharePct + "%",
      t.p2SharePct + "%",
      m.p1Share.toFixed(2),
      m.p2Share.toFixed(2),
      t.entryDate || "",
      t.exitDate || "",
      t.status || "CLOSED"
    ].join(",");
  });

  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
  const encodedUri = encodeURI(csvContent);
  const a = document.createElement("a");
  a.href = encodedUri;
  a.download = `swing_trades_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (parsed.trades && parsed.settings) {
        appState = parsed;
        saveState();
        alert("Backup imported successfully!");
      } else {
        alert("Invalid backup format.");
      }
    } catch (err) {
      alert("Error reading file: " + err.message);
    }
  };
  reader.readAsText(file);
}

// Zerodha Tradebook CSV Parser & FIFO Swing Matcher
function importZerodhaCSV(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const text = e.target.result;
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length < 2) {
        alert("The selected CSV file appears to be empty.");
        return;
      }

      const parseCSVLine = (line) => {
        const result = [];
        let cur = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (c === '"') {
            inQuotes = !inQuotes;
          } else if (c === ',' && !inQuotes) {
            result.push(cur.trim().replace(/^"|"$/g, ''));
            cur = "";
          } else {
            cur += c;
          }
        }
        result.push(cur.trim().replace(/^"|"$/g, ''));
        return result;
      };

      const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, ''));
      
      const colSymbol = headers.findIndex(h => h === "symbol" || h === "stock" || h === "scrip");
      const colDate = headers.findIndex(h => h === "tradedate" || h === "trade_date" || h === "date" || h === "orderexecutiontime");
      const colType = headers.findIndex(h => h === "tradetype" || h === "trade_type" || h === "type" || h === "transactiontype");
      const colQty = headers.findIndex(h => h === "quantity" || h === "qty");
      const colPrice = headers.findIndex(h => h === "price" || h === "rate" || h === "tradeprice" || h === "averageprice");

      if (colSymbol === -1 || colQty === -1 || colPrice === -1) {
        alert("Could not detect Zerodha Tradebook columns. Please ensure CSV contains Symbol, Quantity, and Price.");
        return;
      }

      const rawTrades = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (cols.length < 3) continue;

        const symbol = (cols[colSymbol] || "").toUpperCase().trim();
        if (!symbol) continue;

        let rawDate = colDate !== -1 ? (cols[colDate] || "") : "";
        let tradeDate = "";
        if (rawDate) {
          const dPart = rawDate.split(" ")[0];
          if (dPart.includes("-")) {
            const parts = dPart.split("-");
            if (parts[0].length === 4) tradeDate = dPart;
            else if (parts[2] && parts[2].length === 4) tradeDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
          } else if (dPart.includes("/")) {
            const parts = dPart.split("/");
            if (parts[2] && parts[2].length === 4) tradeDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
          }
        }
        if (!tradeDate) tradeDate = new Date().toISOString().split("T")[0];

        const typeStr = colType !== -1 ? (cols[colType] || "buy").toLowerCase().trim() : "buy";
        const isBuy = typeStr.includes("buy") || typeStr === "b";
        const qty = Math.abs(parseFloat(cols[colQty])) || 0;
        const price = Math.abs(parseFloat(cols[colPrice])) || 0;

        if (qty > 0 && price > 0) {
          rawTrades.push({ symbol, date: tradeDate, isBuy, qty, price });
        }
      }

      if (rawTrades.length === 0) {
        alert("No valid trade records found in this CSV.");
        return;
      }

      rawTrades.sort((a, b) => a.date.localeCompare(b.date));

      const buyQueues = {};
      const newImportedTrades = [];

      rawTrades.forEach(t => {
        if (!buyQueues[t.symbol]) buyQueues[t.symbol] = [];

        if (t.isBuy) {
          buyQueues[t.symbol].push({ ...t, remQty: t.qty });
        } else {
          let sellRem = t.qty;
          while (sellRem > 0 && buyQueues[t.symbol].length > 0) {
            const earliestBuy = buyQueues[t.symbol][0];
            const matchedQty = Math.min(sellRem, earliestBuy.remQty);

            newImportedTrades.push({
              id: `zerodha_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
              stock: t.symbol,
              qty: matchedQty,
              entryPrice: earliestBuy.price,
              exitPrice: t.price,
              entryDate: earliestBuy.date,
              exitDate: t.date,
              status: "CLOSED",
              p1SharePct: 100,
              p2SharePct: 0,
              strategy: "Zerodha Import"
            });

            earliestBuy.remQty -= matchedQty;
            sellRem -= matchedQty;
            if (earliestBuy.remQty <= 0.0001) {
              buyQueues[t.symbol].shift();
            }
          }
        }
      });

      Object.keys(buyQueues).forEach(symbol => {
        buyQueues[symbol].forEach(openBuy => {
          if (openBuy.remQty > 0.0001) {
            newImportedTrades.push({
              id: `zerodha_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
              stock: symbol,
              qty: openBuy.remQty,
              entryPrice: openBuy.price,
              exitPrice: 0,
              entryDate: openBuy.date,
              exitDate: "",
              status: "OPEN",
              p1SharePct: 100,
              p2SharePct: 0,
              strategy: "Zerodha Import"
            });
          }
        });
      });

      if (newImportedTrades.length === 0) {
        alert("Could not generate any swing trades from the CSV.");
        return;
      }

      let addedCount = 0;
      newImportedTrades.forEach(nt => {
        const exists = appState.trades.some(existing => 
          existing.stock === nt.stock && 
          existing.entryDate === nt.entryDate && 
          existing.qty === nt.qty && 
          Math.abs(existing.entryPrice - nt.entryPrice) < 0.01 &&
          existing.status === nt.status
        );
        if (!exists) {
          appState.trades.push(nt);
          addedCount++;
        }
      });

      saveState();
      renderAll();
      alert(`🎉 Successfully imported ${addedCount} trades from Zerodha Tradebook! (${newImportedTrades.length - addedCount} duplicates skipped)`);
    } catch (err) {
      console.error(err);
      alert("Error parsing Zerodha CSV: " + err.message);
    }
  };
  reader.readAsText(file);
}

// =================== EVENT LISTENERS ===================

document.getElementById("btnOpenTradeModal").addEventListener("click", () => openTradeModal());
document.getElementById("btnQuickAddTrade").addEventListener("click", () => openTradeModal());
document.getElementById("btnCloseTradeModal").addEventListener("click", closeTradeModal);
document.getElementById("btnCancelTradeModal").addEventListener("click", closeTradeModal);

document.getElementById("btnOpenCapitalModal").addEventListener("click", openCapitalModal);
document.getElementById("btnCloseCapitalModal").addEventListener("click", closeCapitalModal);
document.getElementById("btnCancelCapitalModal").addEventListener("click", closeCapitalModal);

// Month Filter Dropdown Event Listeners
const monthDropdownBtn = document.getElementById("monthDropdownBtn");
if (monthDropdownBtn) {
  monthDropdownBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMonthDropdown();
    lucide.createIcons();
  });
}

document.addEventListener("click", (e) => {
  const container = document.getElementById("monthDropdownContainer");
  if (container && !container.contains(e.target)) {
    closeMonthDropdown();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeMonthDropdown();
  }
});

const monthFilterSelect = document.getElementById("monthFilterSelect");
if (monthFilterSelect) {
  monthFilterSelect.addEventListener("change", (e) => {
    selectedMonth = e.target.value;
    renderAll();
  });
}

document.getElementById("searchTradeInput").addEventListener("input", () => renderTable(calculateSummary()));

const tabAll = document.getElementById("tabAll");
const tabOpen = document.getElementById("tabOpen");
const tabProfit = document.getElementById("tabProfit");
const tabLoss = document.getElementById("tabLoss");

function setFilter(filter, activeBtn) {
  activeFilter = filter;
  [tabAll, tabOpen, tabProfit, tabLoss].forEach(btn => {
    if (btn) btn.className = "px-2.5 py-1 text-xs font-medium rounded-md text-slate-400 hover:text-white transition";
  });
  if (activeBtn) activeBtn.className = "px-2.5 py-1 text-xs font-medium rounded-md bg-emerald-500 text-slate-950 transition";
  renderTable(calculateSummary());
}

if (tabAll) tabAll.addEventListener("click", () => setFilter("ALL", tabAll));
if (tabOpen) tabOpen.addEventListener("click", () => setFilter("OPEN", tabOpen));
if (tabProfit) tabProfit.addEventListener("click", () => setFilter("PROFIT", tabProfit));
if (tabLoss) tabLoss.addEventListener("click", () => setFilter("LOSS", tabLoss));

const btnRefreshCMP = document.getElementById("btnRefreshCMP");
if (btnRefreshCMP) {
  btnRefreshCMP.addEventListener("click", () => {
    refreshAllOpenPrices();
  });
}

const btnDataMenu = document.getElementById("btnDataMenu");
const dataMenuDropdown = document.getElementById("dataMenuDropdown");
btnDataMenu.addEventListener("click", (e) => {
  e.stopPropagation();
  dataMenuDropdown.classList.toggle("hidden");
});
document.addEventListener("click", () => dataMenuDropdown.classList.add("hidden"));

document.getElementById("btnExportJSON").addEventListener("click", exportJSON);
document.getElementById("btnExportCSV").addEventListener("click", exportCSV);
document.getElementById("importFileInput").addEventListener("change", (e) => {
  if (e.target.files.length > 0) importJSON(e.target.files[0]);
});

const importZerodhaInput = document.getElementById("importZerodhaInput");
if (importZerodhaInput) {
  importZerodhaInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      importZerodhaCSV(e.target.files[0]);
      e.target.value = "";
    }
  });
}

document.getElementById("btnResetData").addEventListener("click", () => {
  if (confirm("Reset all data back to original sample data?")) {
    appState = JSON.parse(JSON.stringify(DEFAULT_STATE));
    selectedMonth = "ALL";
    saveState();
  }
});

// =================== THEME MANAGEMENT (LIGHT / DARK) ===================

function initTheme() {
  const savedTheme = localStorage.getItem("swing_trade_theme") || "dark";
  applyTheme(savedTheme);

  const toggleBtn = document.getElementById("themeToggleBtn");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      const isCurrentlyDark = document.documentElement.classList.contains("dark");
      const newTheme = isCurrentlyDark ? "light" : "dark";
      applyTheme(newTheme);
      renderCharts(); // Re-render charts with appropriate axis/grid colors
    });
  }
}

function applyTheme(theme) {
  const sunIcon = document.getElementById("themeIconSun");
  const moonIcon = document.getElementById("themeIconMoon");

  if (theme === "dark") {
    document.documentElement.classList.add("dark");
    if (sunIcon) sunIcon.classList.remove("hidden");
    if (moonIcon) moonIcon.classList.add("hidden");
  } else {
    document.documentElement.classList.remove("dark");
    if (sunIcon) sunIcon.classList.add("hidden");
    if (moonIcon) moonIcon.classList.remove("hidden");
  }
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta) {
    themeColorMeta.setAttribute("content", theme === "dark" ? "#0b0f17" : "#ffffff");
  }
  localStorage.setItem("swing_trade_theme", theme);
}

// Initialize on page load
window.addEventListener("DOMContentLoaded", () => {
  initTheme();
  renderAll();
  const hasOpen = appState.trades.some(t => t.status === "OPEN");
  if (hasOpen) refreshAllOpenPrices();

  // Register PWA Service Worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").then((reg) => {
      console.log("Swinglytics PWA Service Worker Registered:", reg.scope);
    }).catch((err) => {
      console.log("Service Worker Registration notice:", err);
    });
  }
});

// Capture install prompt for mobile
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  console.log("PWA install prompt ready");
});

