# 📈 Swing Trade & Partnership Tracker

A modern, high-performance web dashboard for swing traders running partnerships. Features automatic STCG tax calculations, dynamic partner capital splitting, interactive P&L charts, and offline-first LocalStorage state management.

---

## 🚀 Features

- **📊 Live Financial Metrics**: Active Capital, Net P&L, Gross P&L, STCG Tax @20%, Win Rate, Profit Factor, Average Win / Average Loss.
- **🤝 Partnership Capital Tracking**:
  - Automatically calculates partner capital, profits withdrawn, and loss absorbed based on trade-by-trade ownership split.
  - Interactive "Manage Capital" dialog to customize names and initial funds.
- **⚡ Trade Log & Entry Modal**:
  - Enter stock trades with `Stock Name`, `Qty`, `Entry Price`, `Exit Price`, `Dates`, and `Capital Split %`.
  - Automatic split sync (`P2% = 100% - P1%`).
  - Search by stock name & filter by Wins / Losses.
- **📈 Interactive Visualizations**:
  - Cumulative Net P&L line graph (trajectory of trading performance).
  - Stock-wise P&L breakdown bar chart.
- **💾 100% Offline & Private (LocalStorage)**:
  - All data stays inside your browser. No server or external database needed.
  - **1-Click Backup Export**: Export full database as `.json` or download trade records as Excel `.csv`.
  - **Import / Restore**: Load your backup onto any device anytime.

---

## 🌐 How to Host on GitHub Pages (Free, 2 Minutes)

1. Create a new repository on GitHub (e.g. `swing-tracker`).
2. Upload the files:
   - `index.html`
   - `app.js`
   - `README.md`
3. In your GitHub repository:
   - Go to **Settings** &rarr; **Pages** (under "Code and automation").
   - Under **Build and deployment** &rarr; **Branch**, select `main` (or `master`) and `/ (root)`.
   - Click **Save**.
4. In about 30 seconds, GitHub will give you your live URL:
   `https://<your-username>.github.io/swing-tracker/`
5. Open this link on your phone or PC browser, bookmark it, and start logging trades!

---

## 🛠 Local Preview

To test locally on your computer, simply double click `index.html` to open it in Chrome, Edge, or Brave, or serve with any simple HTTP server:

```powershell
python -m http.server 8080
# Visit http://localhost:8080 in your browser
```
