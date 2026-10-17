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

function saveState(skipCloudPush = false) {
  localStorage.setItem("swing_trade_state_v1", JSON.stringify(appState));
  renderAll();
  if (!skipCloudPush && typeof pushStateToCloud === "function") {
    pushStateToCloud();
  }
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

  // Calculate Streaks, Drawdown, and Holding periods (chronologically)
  const sortedClosed = [...closedTrades].sort((a, b) => (a.exitDate || a.entryDate || "").localeCompare(b.exitDate || b.entryDate || ""));
  
  let bestWinStreak = 0;
  let curWinStreak = 0;
  let curLossStreak = 0;
  let currentStreak = "0W";

  let runningEquity = 0;
  let peakEquity = 0;
  let maxDrawdown = 0;

  let totalWinHoldingDays = 0;
  let totalLossHoldingDays = 0;

  let bestTrade = null;
  let worstTrade = null;

  sortedClosed.forEach(t => {
    const m = calculateTradeMetrics(t);
    
    // Streaks
    if (m.netPnL > 0) {
      curWinStreak++;
      curLossStreak = 0;
      if (curWinStreak > bestWinStreak) bestWinStreak = curWinStreak;
      currentStreak = `${curWinStreak}W`;
    } else if (m.netPnL < 0) {
      curLossStreak++;
      curWinStreak = 0;
      currentStreak = `${curLossStreak}L`;
    }

    // Peak & Drawdown
    runningEquity += m.netPnL;
    if (runningEquity > peakEquity) {
      peakEquity = runningEquity;
    }
    const dd = peakEquity - runningEquity;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
    }

    // Holding Days
    if (t.entryDate && t.exitDate) {
      const d1 = new Date(t.entryDate);
      const d2 = new Date(t.exitDate);
      if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
        const days = Math.max(0, Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)));
        if (m.netPnL >= 0) totalWinHoldingDays += days;
        else totalLossHoldingDays += days;
      }
    }

    // Best & Worst
    if (!bestTrade || m.netPnL > bestTrade.netPnL) {
      bestTrade = { stock: t.stock, netPnL: m.netPnL };
    }
    if (!worstTrade || m.netPnL < worstTrade.netPnL) {
      worstTrade = { stock: t.stock, netPnL: m.netPnL };
    }
  });

  const avgHoldingWins = winningTrades > 0 ? (totalWinHoldingDays / winningTrades).toFixed(1) : "0";
  const avgHoldingLoss = losingTrades > 0 ? (totalLossHoldingDays / losingTrades).toFixed(1) : "0";
  const mddPercent = totalCurrentCapital > 0 ? ((maxDrawdown / (totalCurrentCapital + maxDrawdown)) * 100).toFixed(1) : "0.0";

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
    p2TotalLossShare,
    bestWinStreak,
    currentStreak,
    maxDrawdown,
    mddPercent,
    avgHoldingWins,
    avgHoldingLoss,
    bestTrade,
    worstTrade
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
  renderTradingCalendar();
  applyViewMode();
  if (typeof lucide !== "undefined") lucide.createIcons();
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

  // Performance Streaks & Drawdown Elements
  const streakBest = document.getElementById("streakBestWin");
  if (streakBest) streakBest.textContent = `${s.bestWinStreak || 0} Trades`;

  const streakCur = document.getElementById("streakCurrent");
  if (streakCur) streakCur.textContent = `Current: ${s.currentStreak || '0W'} streak`;

  const mddElem = document.getElementById("mddAmount");
  if (mddElem) mddElem.textContent = formatINR(s.maxDrawdown || 0);

  const mddPctElem = document.getElementById("mddPercent");
  if (mddPctElem) mddPctElem.textContent = `-${s.mddPercent || '0.0'}% from peak`;

  const holdWinElem = document.getElementById("holdingAvgWins");
  if (holdWinElem) holdWinElem.innerHTML = `${s.avgHoldingWins || 0}d <span class="text-xs font-normal text-slate-400">(Wins)</span>`;

  const holdLossElem = document.getElementById("holdingAvgLoss");
  if (holdLossElem) holdLossElem.textContent = `Losses: ${s.avgHoldingLoss || 0}d avg`;

  const bestElem = document.getElementById("bestTradeText");
  if (bestElem) {
    bestElem.textContent = s.bestTrade ? `${s.bestTrade.stock} (${formatINR(s.bestTrade.netPnL, 0)})` : "-";
  }

  const worstElem = document.getElementById("worstTradeText");
  if (worstElem) {
    worstElem.textContent = s.worstTrade ? `Worst: ${s.worstTrade.stock} (${formatINR(s.worstTrade.netPnL, 0)})` : "Worst: -";
  }
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
            ${t.mistakeTag ? `<span class="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-medium">${t.mistakeTag}</span>` : ''}
          </div>
          <div class="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span>${t.entryDate || "-"} &rarr; ${t.exitDate || (t.status === "OPEN" ? "Holding" : "-")}</span>
            ${holdingDaysBadge}
            ${t.chartUrl ? `<a href="${t.chartUrl}" target="_blank" rel="noopener noreferrer" class="text-emerald-500 hover:underline flex items-center gap-0.5" title="Open TradingView Chart">📸 Chart</a>` : ''}
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
              <button onclick="openQuickCloseModal('${t.id}')" class="px-2 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-[11px] transition shadow-sm" title="Square Off Position">
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

  // Render Mobile & Card View
  renderTradeCards(filtered);
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

// =================== RESPONSIVE TRADE CARDS ===================

function renderTradeCards(filtered) {
  const container = document.getElementById("tradeCardsContainer");
  if (!container) return;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-span-full p-8 text-center text-slate-500 text-xs">
        No trades found matching current filter.
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(t => {
    const m = calculateTradeMetrics(t);
    const isOpen = t.status === "OPEN";
    const isProfit = m.grossPnL >= 0;

    let statusPill = "";
    if (isOpen) {
      statusPill = `
        <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/30 animate-pulse">
          <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span> OPEN
        </span>
      `;
    } else {
      statusPill = isProfit
        ? `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">Profit</span>`
        : `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20">Loss</span>`;
    }

    // Holding days
    let holdingDaysText = "";
    if (t.entryDate) {
      const d1 = new Date(t.entryDate);
      const d2 = (isOpen || !t.exitDate) ? new Date() : new Date(t.exitDate);
      if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
        const days = Math.max(0, Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)));
        holdingDaysText = `${days}d holding`;
      }
    }

    // R:R Display if available
    let rrText = "";
    if (t.stopLoss && t.targetPrice && t.entryPrice) {
      const risk = Math.abs(t.entryPrice - t.stopLoss);
      const reward = Math.abs(t.targetPrice - t.entryPrice);
      if (risk > 0) {
        const rr = (reward / risk).toFixed(1);
        rrText = `R:R 1:${rr}`;
      }
    }

    return `
      <div class="bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 hover:border-emerald-500/50 rounded-2xl p-4 shadow-sm dark:shadow-none flex flex-col justify-between transition-all group hover:scale-[1.01]">
        <!-- Top Bar: Symbol, Status & Holding -->
        <div>
          <div class="flex items-center justify-between gap-2 mb-2">
            <div class="flex items-center gap-2">
              <span class="text-base font-extrabold text-slate-900 dark:text-white tracking-wide">${t.stock}</span>
              ${statusPill}
            </div>
            ${holdingDaysText ? `<span class="text-[10px] font-mono text-slate-400">${holdingDaysText}</span>` : ''}
          </div>

          <!-- Tags Row: Strategy & Discipline Tag -->
          <div class="flex items-center gap-1.5 flex-wrap mb-3">
            ${t.strategy ? `
              <span class="text-[10px] px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-300 border border-purple-500/20 font-semibold">
                ${t.strategy}
              </span>
            ` : ''}
            ${t.mistakeTag ? `
              <span class="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-semibold">
                ${t.mistakeTag}
              </span>
            ` : ''}
            ${rrText ? `
              <span class="text-[10px] px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-300 border border-blue-500/20 font-mono font-semibold">
                ${rrText}
              </span>
            ` : ''}
          </div>

          <!-- 2x2 Price & Quantity Grid -->
          <div class="grid grid-cols-2 gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-700/60 text-xs mb-3">
            <div>
              <div class="text-[10px] text-slate-400 uppercase font-medium">Entry Price</div>
              <div class="font-bold mono text-slate-800 dark:text-slate-200 mt-0.5">${formatINR(t.entryPrice)}</div>
              <div class="text-[10px] text-slate-400 mt-0.5">${t.qty} shares (${formatINR(m.invested, 0)})</div>
            </div>
            <div>
              <div class="text-[10px] text-slate-400 uppercase font-medium">${isOpen ? 'Live CMP' : 'Exit Price'}</div>
              <div class="font-bold mono ${isOpen && m.isLivePrice ? 'text-emerald-500' : 'text-slate-800 dark:text-slate-200'} mt-0.5">
                ${formatINR(m.effectiveExitPrice)}
              </div>
              <div class="text-[10px] text-slate-400 mt-0.5">${isOpen ? 'Current value' : (t.exitDate || '-')}</div>
            </div>
          </div>

          <!-- Net P&L Banner -->
          <div class="p-3 rounded-xl ${m.netPnL >= 0 ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-rose-500/10 border-rose-500/20'} border flex items-center justify-between mb-3">
            <div>
              <div class="text-[10px] ${m.netPnL >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} font-semibold uppercase">
                ${isOpen ? 'Unrealized P&L' : 'Net Realized P&L'}
              </div>
              <div class="text-base font-extrabold mono ${m.netPnL >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} mt-0.5">
                ${m.netPnL >= 0 ? '+' : ''}${formatINR(m.netPnL)}
              </div>
            </div>
            <div class="text-right">
              <span class="text-xs font-bold mono px-2 py-0.5 rounded-full ${m.pnlPercent >= 0 ? 'bg-emerald-500/20 text-emerald-500' : 'bg-rose-500/20 text-rose-500'}">
                ${m.pnlPercent >= 0 ? '+' : ''}${m.pnlPercent.toFixed(2)}%
              </span>
              ${!isOpen && (m.charges > 0 || m.tax > 0) ? `
                <div class="text-[10px] text-slate-400 mt-1 font-mono">Tax+Fee: ${formatINR(m.tax + m.charges, 0)}</div>
              ` : ''}
            </div>
          </div>

          <!-- Partner Split Micro-Bar -->
          <div class="text-[10px] text-slate-400 flex items-center justify-between mb-4 font-mono">
            <span>P1: <strong class="${m.p1Share >= 0 ? 'text-blue-500' : 'text-rose-500'}">${formatINR(m.p1Share, 0)}</strong> (${t.p1SharePct}%)</span>
            <span>P2: <strong class="${m.p2Share >= 0 ? 'text-purple-500' : 'text-rose-500'}">${formatINR(m.p2Share, 0)}</strong> (${t.p2SharePct}%)</span>
          </div>
        </div>

        <!-- Card Footer Actions -->
        <div class="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-700/60 text-xs">
          <div class="flex items-center gap-1.5">
            ${t.chartUrl ? `
              <a href="${t.chartUrl}" target="_blank" rel="noopener noreferrer" class="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-700/70 text-slate-600 dark:text-slate-300 hover:text-emerald-500 transition" title="TradingView Chart">
                <i data-lucide="image" class="w-3.5 h-3.5"></i>
              </a>
            ` : ''}
            <button onclick="editTrade('${t.id}')" class="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-700/70 text-slate-600 dark:text-slate-300 hover:text-emerald-500 transition" title="Edit Trade">
              <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
            </button>
            <button onclick="deleteTrade('${t.id}')" class="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-700/70 text-slate-600 dark:text-slate-300 hover:text-rose-500 transition" title="Delete Trade">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>

          ${isOpen ? `
            <button onclick="openQuickCloseModal('${t.id}')" class="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1 shadow-sm transition active:scale-95">
              <i data-lucide="check" class="w-3.5 h-3.5"></i> Square Off
            </button>
          ` : `
            <span class="text-[10px] text-slate-400 font-mono">${t.entryDate || ''}</span>
          `}
        </div>
      </div>
    `;
  }).join("");
}

// =================== TRADING CALENDAR & HEATMAP ===================

let calendarCurrentDate = new Date();

function renderTradingCalendar() {
  const label = document.getElementById("calendarMonthLabel");
  const grid = document.getElementById("calendarDaysGrid");
  const winDaysElem = document.getElementById("calWinDays");
  const lossDaysElem = document.getElementById("calLossDays");
  const monthNetElem = document.getElementById("calMonthNet");

  if (!grid) return;

  const year = calendarCurrentDate.getFullYear();
  const month = calendarCurrentDate.getMonth(); // 0-indexed

  if (label) {
    label.textContent = calendarCurrentDate.toLocaleString("en-US", { month: "long", year: "numeric" });
  }

  // Days in month & first day index (0=Sun, 1=Mon, ..., 6=Sat)
  const firstDayIndex = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Find all closed trades in this month
  const targetYM = `${year}-${String(month + 1).padStart(2, '0')}`;
  const dayTradesMap = {};

  let winDays = 0;
  let lossDays = 0;
  let monthNet = 0;

  appState.trades.forEach(t => {
    if (t.status === "CLOSED" || !t.status) {
      const exitD = t.exitDate || t.entryDate;
      if (exitD && exitD.startsWith(targetYM)) {
        if (!dayTradesMap[exitD]) {
          dayTradesMap[exitD] = [];
        }
        dayTradesMap[exitD].push(t);
      }
    }
  });

  // Calculate day stats
  Object.keys(dayTradesMap).forEach(d => {
    const list = dayTradesMap[d];
    let dayNet = 0;
    list.forEach(t => {
      const m = calculateTradeMetrics(t);
      dayNet += m.netPnL;
    });
    monthNet += dayNet;
    if (dayNet > 0) winDays++;
    else if (dayNet < 0) lossDays++;
  });

  if (winDaysElem) winDaysElem.textContent = winDays;
  if (lossDaysElem) lossDaysElem.textContent = lossDays;
  if (monthNetElem) {
    monthNetElem.textContent = formatINR(monthNet);
    monthNetElem.className = `font-bold font-mono ${monthNet >= 0 ? 'text-emerald-500' : 'text-rose-500'}`;
  }

  grid.innerHTML = "";

  // 1. Pad blank cells before firstDayIndex
  for (let i = 0; i < firstDayIndex; i++) {
    const empty = document.createElement("div");
    empty.className = "h-16 sm:h-20 rounded-xl bg-slate-50/40 dark:bg-slate-900/30 border border-transparent";
    grid.appendChild(empty);
  }

  // 2. Render each day of the month
  const todayStr = new Date().toISOString().split("T")[0];

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayTrades = dayTradesMap[dateStr] || [];
    const isToday = dateStr === todayStr;

    let dayNet = 0;
    dayTrades.forEach(t => {
      const m = calculateTradeMetrics(t);
      dayNet += m.netPnL;
    });

    const hasTrades = dayTrades.length > 0;
    const isWinDay = hasTrades && dayNet >= 0;

    let bgClass = "bg-slate-50 dark:bg-slate-800/40 border-slate-200/80 dark:border-slate-700/60 text-slate-700 dark:text-slate-300";
    if (hasTrades) {
      if (isWinDay) {
        bgClass = "bg-emerald-500/10 dark:bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 cursor-pointer shadow-sm hover:scale-[1.02] active:scale-95";
      } else {
        bgClass = "bg-rose-500/10 dark:bg-rose-500/15 border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 cursor-pointer shadow-sm hover:scale-[1.02] active:scale-95";
      }
    }

    const cell = document.createElement("div");
    cell.className = `h-16 sm:h-20 p-1.5 sm:p-2 rounded-xl border flex flex-col justify-between transition-all ${bgClass} ${isToday ? 'ring-2 ring-emerald-500/70' : ''}`;
    
    cell.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="text-[11px] sm:text-xs font-bold ${isToday ? 'text-emerald-500 underline' : 'text-slate-500 dark:text-slate-400'}">${day}</span>
        ${hasTrades ? `<span class="text-[9px] px-1 rounded bg-black/10 dark:bg-black/30 font-semibold font-mono">${dayTrades.length} txn</span>` : ''}
      </div>
      ${hasTrades ? `
        <div class="mt-auto">
          <div class="text-[10px] sm:text-xs font-bold mono truncate ${isWinDay ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}">
            ${dayNet >= 0 ? '+' : ''}${formatINR(dayNet, 0)}
          </div>
        </div>
      ` : `
        <div class="mt-auto text-[9px] text-slate-300 dark:text-slate-700">&bull;</div>
      `}
    `;

    if (hasTrades) {
      cell.title = `Click to view ${dayTrades.length} trades closed on ${dateStr}`;
      cell.addEventListener("click", () => {
        openDayTradesModal(dateStr, dayTrades);
      });
    }

    grid.appendChild(cell);
  }
}

// Day Trades Modal functions
function openDayTradesModal(dateStr, trades) {
  const modal = document.getElementById("dayTradesModal");
  const title = document.getElementById("dayTradesModalTitle");
  const subtitle = document.getElementById("dayTradesModalSubtitle");
  const listContainer = document.getElementById("dayTradesListContainer");

  if (!modal || !listContainer) return;

  let totalDayNet = 0;
  trades.forEach(t => {
    const m = calculateTradeMetrics(t);
    totalDayNet += m.netPnL;
  });

  const formattedDate = new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (title) title.innerHTML = `<i data-lucide="calendar" class="w-4 h-4 text-emerald-500"></i> Trades on ${formattedDate}`;
  if (subtitle) {
    subtitle.innerHTML = `${trades.length} trade(s) &bull; Net P&L: <strong class="${totalDayNet >= 0 ? 'text-emerald-500' : 'text-rose-500'} font-mono">${formatINR(totalDayNet)}</strong>`;
  }

  listContainer.innerHTML = trades.map(t => {
    const m = calculateTradeMetrics(t);
    const isProfit = m.netPnL >= 0;
    return `
      <div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-bold text-slate-900 dark:text-white text-sm">${t.stock}</span>
            ${t.strategy ? `<span class="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/15 text-purple-600 dark:text-purple-300 font-semibold">${t.strategy}</span>` : ''}
            ${t.mistakeTag ? `<span class="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold">${t.mistakeTag}</span>` : ''}
          </div>
          <span class="text-xs font-bold mono ${isProfit ? 'text-emerald-500' : 'text-rose-500'}">
            ${isProfit ? '+' : ''}${formatINR(m.netPnL)}
          </span>
        </div>

        <div class="grid grid-cols-3 gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
          <div>Qty: <span class="text-slate-800 dark:text-slate-200 font-medium">${t.qty}</span></div>
          <div>Entry: <span class="text-slate-800 dark:text-slate-200 font-medium">${formatINR(t.entryPrice)}</span></div>
          <div>Exit: <span class="text-slate-800 dark:text-slate-200 font-medium">${formatINR(t.exitPrice)}</span></div>
        </div>

        ${t.chartUrl ? `
          <div class="pt-1 flex items-center justify-between text-[11px]">
            <a href="${t.chartUrl}" target="_blank" rel="noopener noreferrer" class="text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 font-semibold">
              <i data-lucide="external-link" class="w-3 h-3"></i> View Chart / Screenshot
            </a>
          </div>
        ` : ''}
      </div>
    `;
  }).join("");

  modal.classList.remove("hidden");
  if (typeof lucide !== "undefined") lucide.createIcons();
}

function closeDayTradesModal() {
  const modal = document.getElementById("dayTradesModal");
  if (modal) modal.classList.add("hidden");
}

const btnCloseDayTradesModal = document.getElementById("btnCloseDayTradesModal");
if (btnCloseDayTradesModal) btnCloseDayTradesModal.addEventListener("click", closeDayTradesModal);

const btnDoneDayTradesModal = document.getElementById("btnDoneDayTradesModal");
if (btnDoneDayTradesModal) btnDoneDayTradesModal.addEventListener("click", closeDayTradesModal);

// Calendar Navigation listeners
const btnCalPrevMonth = document.getElementById("btnCalPrevMonth");
if (btnCalPrevMonth) {
  btnCalPrevMonth.addEventListener("click", () => {
    calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() - 1);
    renderTradingCalendar();
    if (typeof lucide !== "undefined") lucide.createIcons();
  });
}

const btnCalNextMonth = document.getElementById("btnCalNextMonth");
if (btnCalNextMonth) {
  btnCalNextMonth.addEventListener("click", () => {
    calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() + 1);
    renderTradingCalendar();
    if (typeof lucide !== "undefined") lucide.createIcons();
  });
}

const btnCalToday = document.getElementById("btnCalToday");
if (btnCalToday) {
  btnCalToday.addEventListener("click", () => {
    calendarCurrentDate = new Date();
    renderTradingCalendar();
    if (typeof lucide !== "undefined") lucide.createIcons();
  });
}

// =================== VIEW MODE (CARDS VS TABLE) ===================

let currentViewMode = localStorage.getItem("swing_trade_view_mode") || (window.innerWidth < 768 ? "cards" : "table");

function setViewMode(mode) {
  currentViewMode = mode;
  localStorage.setItem("swing_trade_view_mode", mode);
  applyViewMode();
}

function applyViewMode() {
  const tableContainer = document.getElementById("tableContainer");
  const cardsContainer = document.getElementById("tradeCardsContainer");
  const btnCards = document.getElementById("btnViewCards");
  const btnTable = document.getElementById("btnViewTable");

  if (!tableContainer || !cardsContainer) return;

  if (currentViewMode === "cards") {
    tableContainer.classList.add("hidden");
    cardsContainer.classList.remove("hidden");
    if (btnCards) btnCards.className = "px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-semibold rounded-md transition flex items-center gap-1 bg-emerald-500 text-slate-950";
    if (btnTable) btnTable.className = "px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-semibold rounded-md transition flex items-center gap-1 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white";
  } else {
    tableContainer.classList.remove("hidden");
    cardsContainer.classList.add("hidden");
    if (btnCards) btnCards.className = "px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-semibold rounded-md transition flex items-center gap-1 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white";
    if (btnTable) btnTable.className = "px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-semibold rounded-md transition flex items-center gap-1 bg-emerald-500 text-slate-950";
  }
}

const btnViewCardsElem = document.getElementById("btnViewCards");
if (btnViewCardsElem) btnViewCardsElem.addEventListener("click", () => setViewMode("cards"));

const btnViewTableElem = document.getElementById("btnViewTable");
if (btnViewTableElem) btnViewTableElem.addEventListener("click", () => setViewMode("table"));

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
  
  const sizerFeedback = document.getElementById("sizerFeedback");
  if (sizerFeedback) sizerFeedback.classList.add("hidden");

  const tradeSL = document.getElementById("tradeStopLoss");
  const tradeTgt = document.getElementById("tradeTarget");
  const tradeMistake = document.getElementById("tradeMistakeTag");
  const tradeChart = document.getElementById("tradeChartUrl");
  
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

      if (tradeSL) tradeSL.value = trade.stopLoss || "";
      if (tradeTgt) tradeTgt.value = trade.targetPrice || "";
      if (tradeMistake) tradeMistake.value = trade.mistakeTag || "";
      if (tradeChart) tradeChart.value = trade.chartUrl || "";

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

    if (tradeSL) tradeSL.value = "";
    if (tradeTgt) tradeTgt.value = "";
    if (tradeMistake) tradeMistake.value = "";
    if (tradeChart) tradeChart.value = "";

    const stratInput = document.getElementById("tradeStrategy");
    if (stratInput) stratInput.value = "";
    populateStrategyPresetDropdown("");
  }

  updateModalCalculation();
  tradeModal.classList.remove("hidden");
  if (typeof lucide !== "undefined") lucide.createIcons();
  tradeStock.focus();
}

function closeTradeModal() {
  tradeModal.classList.add("hidden");
}

function updateModalCalculation() {
  const qty = parseFloat(tradeQty.value) || 0;
  const entry = parseFloat(tradeEntryPrice.value) || 0;
  const exit = parseFloat(tradeExitPrice.value) || 0;
  const sl = parseFloat(document.getElementById("tradeStopLoss")?.value) || 0;
  const target = parseFloat(document.getElementById("tradeTarget")?.value) || 0;
  const rrBadge = document.getElementById("modalRRBadge");

  // R:R calculation
  if (entry > 0 && sl > 0) {
    const risk = Math.abs(entry - sl);
    if (target > 0) {
      const reward = Math.abs(target - entry);
      const rr = risk > 0 ? (reward / risk).toFixed(2) : "0";
      if (rrBadge) {
        rrBadge.textContent = `R:R 1 : ${rr}`;
        rrBadge.className = `text-[10px] px-2 py-0.5 rounded-full font-bold font-mono ${Number(rr) >= 2 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`;
      }
    } else if (rrBadge) {
      rrBadge.textContent = `Risk: ${formatINR(risk)}/sh`;
      rrBadge.className = `text-[10px] px-2 py-0.5 rounded-full font-bold font-mono bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300`;
    }
  } else if (rrBadge) {
    rrBadge.textContent = "R:R --";
    rrBadge.className = `text-[10px] px-2 py-0.5 rounded-full font-bold font-mono bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300`;
  }
  
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

function autoSizeQuantity(riskOption) {
  const entry = parseFloat(tradeEntryPrice?.value) || 0;
  const sl = parseFloat(document.getElementById("tradeStopLoss")?.value) || 0;
  const feedback = document.getElementById("sizerFeedback");

  if (!entry || entry <= 0 || !sl || sl <= 0) {
    alert("Please enter both Entry Price and Stop-Loss (SL) first!");
    return;
  }

  const riskPerShare = Math.abs(entry - sl);
  if (riskPerShare <= 0) {
    alert("Entry price and Stop-Loss cannot be identical.");
    return;
  }

  const summary = calculateSummary();
  const totalCap = summary.totalCurrentCapital || 100000;
  let riskAmount = 0;

  if (riskOption === "custom") {
    const input = prompt("Enter Max Risk in ₹ for this trade:", "2000");
    if (input === null) return;
    riskAmount = parseFloat(input);
  } else {
    const pct = Number(riskOption) || 1;
    riskAmount = (totalCap * pct) / 100;
  }

  if (isNaN(riskAmount) || riskAmount <= 0) {
    alert("Invalid risk amount.");
    return;
  }

  const suggestedQty = Math.max(1, Math.floor(riskAmount / riskPerShare));
  tradeQty.value = suggestedQty;
  updateModalCalculation();

  if (feedback) {
    feedback.textContent = `✓ Sized ${suggestedQty} shares (Risk: ${formatINR(riskAmount, 0)} on ${riskOption === 'custom' ? 'custom' : riskOption + '%'} risk)`;
    feedback.classList.remove("hidden");
  }
}
window.autoSizeQuantity = autoSizeQuantity;

const btnSize1 = document.getElementById("btnSizeRisk1");
if (btnSize1) btnSize1.addEventListener("click", () => autoSizeQuantity(1));

const btnSize2 = document.getElementById("btnSizeRisk2");
if (btnSize2) btnSize2.addEventListener("click", () => autoSizeQuantity(2));

const btnSizeCust = document.getElementById("btnSizeRiskCustom");
if (btnSizeCust) btnSizeCust.addEventListener("click", () => autoSizeQuantity("custom"));

const tradeStopLossInput = document.getElementById("tradeStopLoss");
if (tradeStopLossInput) tradeStopLossInput.addEventListener("input", updateModalCalculation);

const tradeTargetInput = document.getElementById("tradeTarget");
if (tradeTargetInput) tradeTargetInput.addEventListener("input", updateModalCalculation);

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
  const slVal = parseFloat(document.getElementById("tradeStopLoss")?.value);
  const tgtVal = parseFloat(document.getElementById("tradeTarget")?.value);
  const mistakeInput = document.getElementById("tradeMistakeTag");
  const chartInput = document.getElementById("tradeChartUrl");

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
    stopLoss: !isNaN(slVal) ? slVal : 0,
    targetPrice: !isNaN(tgtVal) ? tgtVal : 0,
    mistakeTag: mistakeInput ? mistakeInput.value : "",
    chartUrl: chartInput ? chartInput.value.trim() : "",
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

// =================== QUICK CLOSE / SQUARE OFF MODAL ===================
const quickCloseModal = document.getElementById("quickCloseModal");
const btnCloseQuickCloseModal = document.getElementById("btnCloseQuickCloseModal");
const btnCancelQuickClose = document.getElementById("btnCancelQuickClose");
const btnConfirmQuickClose = document.getElementById("btnConfirmQuickClose");
const qcExitPrice = document.getElementById("qcExitPrice");

function openQuickCloseModal(tradeId) {
  const trade = appState.trades.find(t => t.id === tradeId);
  if (!trade || !quickCloseModal) return;

  document.getElementById("qcTradeId").value = trade.id;
  document.getElementById("qcStockSymbol").textContent = trade.stock;

  const invested = trade.qty * trade.entryPrice;
  document.getElementById("qcInvestedDetails").textContent = `${trade.qty} shares @ ${formatINR(trade.entryPrice)} (${formatINR(invested)})`;

  const currentCMP = livePrices[trade.stock.toUpperCase()]?.price || trade.entryPrice;
  document.getElementById("qcExitPrice").value = currentCMP;
  document.getElementById("qcExitDate").value = new Date().toISOString().split("T")[0];

  updateQuickCloseCalculation();
  quickCloseModal.classList.remove("hidden");
  if (typeof lucide !== "undefined") lucide.createIcons();
}

function closeQuickCloseModal() {
  if (quickCloseModal) quickCloseModal.classList.add("hidden");
}

function updateQuickCloseCalculation() {
  const tradeId = document.getElementById("qcTradeId")?.value;
  const trade = appState.trades.find(t => t.id === tradeId);
  if (!trade) return;

  const exitPrice = parseFloat(document.getElementById("qcExitPrice")?.value) || 0;
  const invested = trade.qty * trade.entryPrice;
  const exitValue = trade.qty * exitPrice;
  const grossPnL = exitValue - invested;
  const pnlPercent = invested > 0 ? (grossPnL / invested) * 100 : 0;

  const tax = grossPnL > 0 ? grossPnL * (appState.settings?.taxRate || 0.20) : 0;
  const charges = calculateZerodhaCharges(invested, exitValue);
  const netPnL = grossPnL - tax - charges;

  const grossElem = document.getElementById("qcGrossPnL");
  if (grossElem) {
    grossElem.textContent = `${formatINR(grossPnL)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`;
    grossElem.className = `font-bold mono ${grossPnL >= 0 ? 'text-emerald-500' : 'text-rose-500'}`;
  }

  const feeElem = document.getElementById("qcChargesTax");
  if (feeElem) {
    feeElem.textContent = formatINR(tax + charges);
  }

  const netElem = document.getElementById("qcNetPnL");
  if (netElem) {
    netElem.textContent = `${netPnL >= 0 ? '+' : ''}${formatINR(netPnL)}`;
    netElem.className = `font-bold mono text-sm ${netPnL >= 0 ? 'text-emerald-500' : 'text-rose-500'}`;
  }
}

if (qcExitPrice) qcExitPrice.addEventListener("input", updateQuickCloseCalculation);
if (btnCloseQuickCloseModal) btnCloseQuickCloseModal.addEventListener("click", closeQuickCloseModal);
if (btnCancelQuickClose) btnCancelQuickClose.addEventListener("click", closeQuickCloseModal);

if (btnConfirmQuickClose) {
  btnConfirmQuickClose.addEventListener("click", () => {
    const tradeId = document.getElementById("qcTradeId")?.value;
    const trade = appState.trades.find(t => t.id === tradeId);
    if (!trade) return;

    const exitVal = parseFloat(document.getElementById("qcExitPrice")?.value);
    const exitD = document.getElementById("qcExitDate")?.value;

    if (isNaN(exitVal) || exitVal <= 0) {
      alert("Please enter a valid exit price.");
      return;
    }

    trade.status = "CLOSED";
    trade.exitPrice = exitVal;
    trade.exitDate = exitD || new Date().toISOString().split("T")[0];

    saveState();
    closeQuickCloseModal();
  });
}

window.quickCloseTrade = function(id) {
  openQuickCloseModal(id);
};
window.openQuickCloseModal = openQuickCloseModal;

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

const btnOpenCapitalMobile = document.getElementById("btnOpenCapitalMobile");
if (btnOpenCapitalMobile) {
  btnOpenCapitalMobile.addEventListener("click", () => {
    document.getElementById("dataMenuDropdown")?.classList.add("hidden");
    openCapitalModal();
  });
}

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

// =================== CROSS-DEVICE CLOUD SYNC MODULE (FIREBASE) ===================
const STORAGE_KEY_CLOUD_CONFIG = "swinglytics_cloud_sync_config_v1";

const btnOpenCloudSync = document.getElementById("btnOpenCloudSync");
const btnCloudSyncMenuItem = document.getElementById("btnCloudSyncMenuItem");
const cloudSyncModal = document.getElementById("cloudSyncModal");
const btnCloseCloudSyncModal = document.getElementById("btnCloseCloudSyncModal");
const btnCancelCloudSync = document.getElementById("btnCancelCloudSync");
const btnSaveCloudSync = document.getElementById("btnSaveCloudSync");
const btnDisconnectCloud = document.getElementById("btnDisconnectCloud");
const btnPushToCloudNow = document.getElementById("btnPushToCloudNow");

const cloudFirebaseDbUrl = document.getElementById("cloudFirebaseDbUrl");
const cloudFirebaseToken = document.getElementById("cloudFirebaseToken");
const cloudSyncStatusDot = document.getElementById("cloudSyncStatusDot");
const cloudSyncMenuBadge = document.getElementById("cloudSyncMenuBadge");
const cloudModalStatusBadge = document.getElementById("cloudModalStatusBadge");
const cloudLiveDot = document.getElementById("cloudLiveDot");
const cloudLiveTitle = document.getElementById("cloudLiveTitle");
const cloudLiveSubtitle = document.getElementById("cloudLiveSubtitle");

let cloudDbInstance = null;
let cloudSyncRef = null;
let isApplyingCloudUpdate = false;
let lastSyncedTimestamp = 0;

function loadCloudConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CLOUD_CONFIG);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("Failed to load cloud config:", e);
  }
  return { dbUrl: "", token: "" };
}

function saveCloudConfig(cfg) {
  localStorage.setItem(STORAGE_KEY_CLOUD_CONFIG, JSON.stringify(cfg));
}

const cloudSyncMenuDotMobile = document.getElementById("cloudSyncMenuDotMobile");

function updateCloudUIStatus(status, text) {
  if (status === "connected") {
    if (cloudSyncStatusDot) cloudSyncStatusDot.className = "w-2 h-2 rounded-full bg-emerald-500 animate-pulse";
    if (cloudSyncMenuDotMobile) cloudSyncMenuDotMobile.className = "w-2 h-2 rounded-full bg-emerald-500 animate-pulse absolute top-1 right-1 md:hidden";
    if (cloudSyncMenuBadge) {
      cloudSyncMenuBadge.className = "text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 font-mono font-semibold";
      cloudSyncMenuBadge.textContent = "Live";
    }
    if (cloudModalStatusBadge) {
      cloudModalStatusBadge.className = "text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 dark:text-emerald-400 font-mono font-semibold";
      cloudModalStatusBadge.textContent = "Live Cloud Connected";
    }
    if (cloudLiveDot) cloudLiveDot.className = "w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse";
    if (cloudLiveTitle) cloudLiveTitle.textContent = "Real-Time Cloud Sync Active";
    if (cloudLiveSubtitle) cloudLiveSubtitle.textContent = text || "Phone & Laptop sync automatically on any trade changes";
    if (btnPushToCloudNow) btnPushToCloudNow.classList.remove("hidden");
  } else if (status === "connecting") {
    if (cloudSyncStatusDot) cloudSyncStatusDot.className = "w-2 h-2 rounded-full bg-amber-400";
    if (cloudSyncMenuDotMobile) cloudSyncMenuDotMobile.className = "w-2 h-2 rounded-full bg-amber-400 absolute top-1 right-1 md:hidden";
    if (cloudSyncMenuBadge) {
      cloudSyncMenuBadge.className = "text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 font-mono";
      cloudSyncMenuBadge.textContent = "Connecting";
    }
    if (cloudModalStatusBadge) {
      cloudModalStatusBadge.className = "text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 font-mono";
      cloudModalStatusBadge.textContent = "Connecting...";
    }
    if (cloudLiveDot) cloudLiveDot.className = "w-2.5 h-2.5 rounded-full bg-amber-400";
    if (cloudLiveTitle) cloudLiveTitle.textContent = "Connecting to Firebase...";
    if (cloudLiveSubtitle) cloudLiveSubtitle.textContent = text || "Establishing connection...";
  } else {
    if (cloudSyncStatusDot) cloudSyncStatusDot.className = "w-2 h-2 rounded-full bg-slate-400";
    if (cloudSyncMenuDotMobile) cloudSyncMenuDotMobile.className = "w-2 h-2 rounded-full bg-slate-400 absolute top-1 right-1 md:hidden";
    if (cloudSyncMenuBadge) {
      cloudSyncMenuBadge.className = "text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400 font-mono";
      cloudSyncMenuBadge.textContent = "Offline";
    }
    if (cloudModalStatusBadge) {
      cloudModalStatusBadge.className = "text-[10px] px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono";
      cloudModalStatusBadge.textContent = "Offline";
    }
    if (cloudLiveDot) cloudLiveDot.className = "w-2.5 h-2.5 rounded-full bg-slate-400";
    if (cloudLiveTitle) cloudLiveTitle.textContent = "Device Offline / Local Only";
    if (cloudLiveSubtitle) cloudLiveSubtitle.textContent = text || "Connect Firebase Database to auto-sync with your laptop";
    if (btnPushToCloudNow) btnPushToCloudNow.classList.add("hidden");
  }
}

function openCloudSyncModal() {
  const cfg = loadCloudConfig();
  if (cloudFirebaseDbUrl) cloudFirebaseDbUrl.value = cfg.dbUrl || "";
  if (cloudFirebaseToken) cloudFirebaseToken.value = cfg.token || "";
  if (cloudSyncModal) cloudSyncModal.classList.remove("hidden");
  if (typeof lucide !== "undefined") lucide.createIcons();
}

function closeCloudSyncModal() {
  if (cloudSyncModal) cloudSyncModal.classList.add("hidden");
}

function pushStateToCloud() {
  if (!cloudSyncRef || isApplyingCloudUpdate) return;
  try {
    const payload = {
      appState: appState,
      updatedAt: Date.now(),
      clientDeviceId: getOrCreateDeviceId()
    };
    lastSyncedTimestamp = payload.updatedAt;
    cloudSyncRef.set(payload).then(() => {
      console.log("Swinglytics data pushed to Firebase Cloud successfully");
    }).catch(err => {
      console.error("Cloud push failed:", err);
    });
  } catch (e) {
    console.error("Failed to prepare state for cloud:", e);
  }
}

function getOrCreateDeviceId() {
  let id = localStorage.getItem("swinglytics_device_id");
  if (!id) {
    id = "dev_" + Math.random().toString(36).substring(2, 9) + "_" + Date.now().toString(36);
    localStorage.setItem("swinglytics_device_id", id);
  }
  return id;
}

function initCloudSync() {
  const cfg = loadCloudConfig();
  if (!cfg.dbUrl) {
    updateCloudUIStatus("offline");
    return;
  }

  if (typeof firebase === "undefined") {
    console.warn("Firebase SDK not loaded on this page");
    updateCloudUIStatus("offline", "Firebase SDK not available");
    return;
  }

  try {
    updateCloudUIStatus("connecting");
    let app = null;
    const appName = "SwinglyticsSyncApp";
    
    // Check if Swinglytics app instance exists
    const existing = firebase.apps.find(a => a.name === appName);
    if (existing) {
      app = existing;
    } else {
      app = firebase.initializeApp({
        databaseURL: cfg.dbUrl
      }, appName);
    }

    cloudDbInstance = app.database();
    cloudSyncRef = cloudDbInstance.ref("swinglytics/shared_state");

    // Listen for realtime changes from other device (Phone / Laptop)
    cloudSyncRef.on("value", (snapshot) => {
      const data = snapshot.val();
      if (!data || !data.appState) {
        // Initial setup: If database node is empty, push current local data to seed it
        updateCloudUIStatus("connected", "Ready. Initializing cloud backup...");
        pushStateToCloud();
        return;
      }

      // Check if update came from a different save
      if (data.updatedAt && data.updatedAt === lastSyncedTimestamp) {
        // Echo of our own write
        updateCloudUIStatus("connected");
        return;
      }

      const incomingState = data.appState;
      if (incomingState && Array.isArray(incomingState.trades)) {
        isApplyingCloudUpdate = true;
        appState = incomingState;
        lastSyncedTimestamp = data.updatedAt || Date.now();
        saveState(true); // Save locally without echoing back to cloud
        isApplyingCloudUpdate = false;
        updateCloudUIStatus("connected", `Synced with ${data.clientDeviceId ? 'other device' : 'cloud'} at ${new Date(lastSyncedTimestamp).toLocaleTimeString()}`);
        console.log("Swinglytics updated from Firebase Cloud!");
      }
    }, (error) => {
      console.error("Firebase Realtime listener error:", error);
      updateCloudUIStatus("offline", "Sync error: " + error.message);
    });

    updateCloudUIStatus("connected");
  } catch (err) {
    console.error("Firebase init failed:", err);
    updateCloudUIStatus("offline", "Connection error: " + err.message);
  }
}

// Cloud Modal UI Event Listeners
if (btnOpenCloudSync) btnOpenCloudSync.addEventListener("click", openCloudSyncModal);
if (btnCloudSyncMenuItem) {
  btnCloudSyncMenuItem.addEventListener("click", () => {
    document.getElementById("dataMenuDropdown")?.classList.add("hidden");
    openCloudSyncModal();
  });
}
if (btnCloseCloudSyncModal) btnCloseCloudSyncModal.addEventListener("click", closeCloudSyncModal);
if (btnCancelCloudSync) btnCancelCloudSync.addEventListener("click", closeCloudSyncModal);

if (btnSaveCloudSync) {
  btnSaveCloudSync.addEventListener("click", () => {
    const dbUrl = (cloudFirebaseDbUrl?.value || "").trim();
    const token = (cloudFirebaseToken?.value || "").trim();
    if (!dbUrl) {
      alert("Please enter a valid Firebase Realtime Database URL.\n(e.g. https://your-project-default-rtdb.firebaseio.com)");
      return;
    }
    saveCloudConfig({ dbUrl, token });
    initCloudSync();
    pushStateToCloud();
    closeCloudSyncModal();
    alert("✅ Realtime Cloud Sync Connected!\n\nYour Phone and Laptop will now sync trades and portfolio automatically in real-time.");
  });
}

if (btnDisconnectCloud) {
  btnDisconnectCloud.addEventListener("click", () => {
    if (confirm("Disconnect Cloud Sync? Your trades will stay saved safely on this device offline.")) {
      if (cloudSyncRef) {
        cloudSyncRef.off();
        cloudSyncRef = null;
      }
      saveCloudConfig({ dbUrl: "", token: "" });
      updateCloudUIStatus("offline");
      closeCloudSyncModal();
      alert("Cloud Sync disconnected. Swinglytics is now running in local offline mode.");
    }
  });
}

if (btnPushToCloudNow) {
  btnPushToCloudNow.addEventListener("click", () => {
    pushStateToCloud();
    alert("✅ Synced! All latest data pushed to cloud.");
  });
}

// Esc key closes cloud sync modal
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && cloudSyncModal && !cloudSyncModal.classList.contains("hidden")) {
    closeCloudSyncModal();
  }
});

// Boot Cloud Sync on load
window.addEventListener("DOMContentLoaded", () => {
  initCloudSync();
});

