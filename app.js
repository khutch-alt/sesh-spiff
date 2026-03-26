/* ── Sesh SPIFF App v2 ──────────────────────────────────────── */
const API = (location.hostname === "127.0.0.1" || location.hostname === "localhost")
  ? "http://127.0.0.1:8000" : "";

const app = document.getElementById("app");

let state = {
  token: null,
  user: null,
  view: "login",
  loginTab: "signin",
  lbFilter: "all",   // "all" | "my-dist"
  quickClaim: false,
};

/* ── US States ──────────────────────────────────────────────── */
const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"
];
function stateSelectHTML(selected = "") {
  return `<select class="form-input" id="store-state">
    <option value="">State</option>
    ${US_STATES.map(s => `<option value="${s}"${s === selected ? " selected" : ""}>${s}</option>`).join("")}
  </select>`;
}

/* ── API ────────────────────────────────────────────────────── */
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (state.token) headers["Authorization"] = `Bearer ${state.token}`;
  if (opts.body && !(opts.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(err.detail || "Request failed");
  }
  if (res.headers.get("content-type")?.includes("text/csv")) return res.blob();
  return res.json();
}

/* ── Toast ──────────────────────────────────────────────────── */
function showToast(msg, type = "info") {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 3500);
}

/* ── Celebration flash ──────────────────────────────────────── */
function celebrateClaim(amount) {
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;
    align-items:center;justify-content:center;pointer-events:none;
    background:rgba(80,80,80,0.45);animation:fadeInOut 2.2s ease forwards;
  `;
  overlay.innerHTML = `
    <div style="font-size:56px;animation:popIn 0.4s cubic-bezier(.17,.67,.24,1.4) forwards;">🏪</div>
    <div style="color:#ffffff;font-size:32px;font-weight:700;margin-top:12px;letter-spacing:-0.5px;">+${fmtCurrency(amount)}</div>
    <div style="color:rgba(255,255,255,0.85);font-size:16px;margin-top:6px;">Claim submitted!</div>
  `;
  document.head.insertAdjacentHTML("beforeend", `<style>
    @keyframes fadeInOut{0%{opacity:0}15%{opacity:1}75%{opacity:1}100%{opacity:0}}
    @keyframes popIn{0%{transform:scale(0.3);opacity:0}100%{transform:scale(1);opacity:1}}
  </style>`);
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 2300);
}

/* ── Helpers ────────────────────────────────────────────────── */
function seshLogo(size = 32) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" fill="none"><rect width="40" height="40" rx="10" fill="#111111"/><text x="20" y="27" text-anchor="middle" fill="#ffffff" font-family="'Space Grotesk',sans-serif" font-size="20" font-weight="700">S</text></svg>`;
}
function fmtCurrency(n) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);
}
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function esc(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
function streakLabel(n) {
  if (n === 0) return "";
  if (n === 1) return "🔥 1-week streak";
  return `🔥 ${n}-week streak`;
}
function motivatorMessage(stats) {
  const { doors_this_month, claims_this_week, streak_weeks, rank } = stats;
  if (claims_this_week === 0) return { emoji: "⚡", msg: "You haven't logged anything this week — get back out there." };
  if (streak_weeks >= 4) return { emoji: "🏆", msg: `${streak_weeks}-week streak. You're on fire — keep it going.` };
  if (rank === 1) return { emoji: "👑", msg: "You're #1 this month. Defend it." };
  if (rank <= 3) return { emoji: "🎯", msg: `You're #${rank} this month. One push and you could take the top spot.` };
  if (doors_this_month === 0) return { emoji: "🚪", msg: "No new doors yet this month. First one's the hardest." };
  return { emoji: "📈", msg: `${doors_this_month} new door${doors_this_month !== 1 ? "s" : ""} this month — keep the streak alive.` };
}

/* ── Streak Banner (3+ weeks) ───────────────────────────────── */
function streakBannerHTML(weeks) {
  if (!weeks || weeks < 3) return "";
  const msgs = [
    null, null, null,
    "3-week streak 🔥 You're building serious momentum.",
    "4-week streak 🔥🔥 You're on fire. Keep it going!",
    "5-week streak ⚡🔥 Unstoppable. The leaderboard is watching.",
  ];
  const msg = msgs[Math.min(weeks, 5)] || `${weeks}-week streak 🏆 Elite consistency.`;
  return `<div class="streak-banner">${msg}</div>`;
}

/* ── Week Comparison ────────────────────────────────────────── */
function weekCompareHTML(stats) {
  const thisWeek = stats.doors_this_week ?? stats.claims_this_week ?? 0;
  const lastWeek = stats.doors_last_week ?? null;
  if (lastWeek === null) return "";
  const diff = thisWeek - lastWeek;
  let arrow = "";
  if (diff > 0) arrow = `<span class="week-up">▲ ${diff} vs last week</span>`;
  else if (diff < 0) arrow = `<span class="week-down">▼ ${Math.abs(diff)} vs last week</span>`;
  else arrow = `<span class="week-neutral">same as last week</span>`;
  return `<div class="week-compare">This week: <strong>${thisWeek}</strong> door${thisWeek !== 1 ? "s" : ""} &nbsp;${arrow}</div>`;
}

/* ── Milestone Progress ─────────────────────────────────────── */
function milestoneHTML(totalEarned) {
  const earned = totalEarned || 0;
  const milestone = Math.ceil((earned + 0.01) / 50) * 50;
  const progress = Math.min(100, ((earned % 50) / 50) * 100);
  const toNext = milestone - earned;
  return `
    <div class="milestone-wrap">
      <div class="milestone-label">
        <span>Next milestone: <strong>${fmtCurrency(milestone)}</strong></span>
        <span class="milestone-to-go">${fmtCurrency(toNext)} to go</span>
      </div>
      <div class="fund-meter-bar"><div class="fund-meter-fill" style="width:${progress.toFixed(1)}%"></div></div>
    </div>`;
}

/* ── Pull-to-refresh ────────────────────────────────────────── */
function setupPullToRefresh(el, refreshFn) {
  let startY = 0;
  let indicator = null;
  let triggered = false;

  el.addEventListener("touchstart", e => {
    if (el.scrollTop === 0) startY = e.touches[0].clientY;
  }, { passive: true });

  el.addEventListener("touchmove", e => {
    if (el.scrollTop > 0 || !startY) return;
    const dist = e.touches[0].clientY - startY;
    if (dist > 55 && !indicator) {
      indicator = document.createElement("div");
      indicator.className = "pull-indicator";
      indicator.textContent = "↓ Release to refresh";
      el.prepend(indicator);
    }
    if (dist > 55) triggered = true;
  }, { passive: true });

  el.addEventListener("touchend", () => {
    indicator?.remove(); indicator = null;
    if (triggered) { triggered = false; refreshFn(); }
    startY = 0;
  }, { passive: true });
}

/* ── Router ─────────────────────────────────────────────────── */
function render() {
  switch (state.view) {
    case "login": renderLogin(); break;
    case "rep-dashboard": renderRepDashboard(); break;
    case "rep-submit": renderRepSubmit(); break;
    case "rep-leaderboard": renderLeaderboard(); break;
    case "admin-claims": renderAdminDashboard("claims"); break;
    case "admin-funds": renderAdminDashboard("funds"); break;
    case "admin-settings": renderAdminDashboard("settings"); break;
    default: renderLogin();
  }
  lucide.createIcons();
}

/* ── Login / Signup / Forgot / Reset ───────────────────────── */
function renderLogin() {
  const tab = state.loginTab || "signin";
  app.innerHTML = `
    <div class="login-wrapper">
      <div class="login-card">
        <div class="login-logo">
          ${seshLogo(48)}
          <h1>Sesh SPIFF</h1>
          <p>Distributor Incentive Program</p>
        </div>
        <div class="login-tabs">
          <button class="login-tab ${tab === "signin" ? "active" : ""}" onclick="setLoginTab('signin')">Sign In</button>
          <button class="login-tab ${tab === "signup" ? "active" : ""}" onclick="setLoginTab('signup')">Join Program</button>
          <button class="login-tab ${tab === "forgot" ? "active" : ""}" onclick="setLoginTab('forgot')">Reset Password</button>
        </div>

        ${tab === "signin" ? `
        <form id="login-form">
          <div class="form-group"><label>Email</label><input type="email" id="email" class="form-input" placeholder="you@company.com" required autocomplete="email"></div>
          <div class="form-group"><label>Password</label><input type="password" id="password" class="form-input" placeholder="Password" required></div>
          <button type="submit" class="btn btn-primary btn-block" id="login-btn">Sign In</button>
        </form>` : ""}

        ${tab === "signup" ? `
        <form id="signup-form">
          <div class="invite-code-banner">Enter your distributor invite code to join</div>
          <div class="form-group"><label>Invite Code</label><input type="text" id="invite-code" class="form-input" placeholder="e.g. HARBOR2026" required style="text-transform:uppercase;font-weight:600;letter-spacing:1px;"></div>
          <div class="form-group"><label>Your Full Name</label><input type="text" id="signup-name" class="form-input" placeholder="Jane Smith" required></div>
          <div class="form-group"><label>Email</label><input type="email" id="signup-email" class="form-input" placeholder="you@company.com" required></div>
          <div class="form-group"><label>Password</label><input type="password" id="signup-password" class="form-input" placeholder="At least 6 characters" required></div>
          <button type="submit" class="btn btn-primary btn-block" id="signup-btn">Create Account</button>
        </form>` : ""}

        ${tab === "forgot" ? `
        <form id="forgot-form">
          <p style="font-size:13px;color:var(--text-muted);margin-bottom:var(--sp-5);">Enter your email and Karson will send you a reset token.</p>
          <div class="form-group"><label>Email</label><input type="email" id="forgot-email" class="form-input" placeholder="you@company.com" required></div>
          <button type="submit" class="btn btn-primary btn-block" id="forgot-btn">Request Reset</button>
        </form>
        <div id="reset-section" style="display:none;margin-top:var(--sp-6);">
          <hr style="border:none;border-top:1px solid var(--border);margin-bottom:var(--sp-5);">
          <p style="font-size:13px;color:var(--text-muted);margin-bottom:var(--sp-4);">Got your token? Enter it below.</p>
          <form id="reset-form">
            <div class="form-group"><label>Reset Token</label><input type="text" id="reset-token" class="form-input" placeholder="Paste token here" required></div>
            <div class="form-group"><label>New Password</label><input type="password" id="reset-password" class="form-input" placeholder="At least 6 characters" required></div>
            <button type="submit" class="btn btn-primary btn-block" id="reset-btn">Set New Password</button>
          </form>
        </div>` : ""}

      </div>
    </div>`;

  lucide.createIcons();

  if (tab === "signin") {
    document.getElementById("login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("login-btn");
      btn.disabled = true; btn.textContent = "Signing in...";
      try {
        const data = await api("/api/auth/login", { method: "POST", body: { email: document.getElementById("email").value, password: document.getElementById("password").value } });
        state.token = data.token; state.user = data.user;
        state.view = data.user.role === "admin" ? "admin-claims" : "rep-dashboard";
        render();
      } catch (err) { showToast(err.message, "error"); btn.disabled = false; btn.textContent = "Sign In"; }
    });
  }

  if (tab === "signup") {
    document.getElementById("signup-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("signup-btn");
      btn.disabled = true; btn.textContent = "Creating account...";
      try {
        const data = await api("/api/auth/signup", { method: "POST", body: {
          name: document.getElementById("signup-name").value,
          email: document.getElementById("signup-email").value,
          password: document.getElementById("signup-password").value,
          invite_code: document.getElementById("invite-code").value.trim().toUpperCase(),
        }});
        state.token = data.token; state.user = data.user;
        state.view = "rep-dashboard";
        showToast(`Welcome to Sesh SPIFF, ${data.user.name}! 🎉`, "success");
        render();
      } catch (err) { showToast(err.message, "error"); btn.disabled = false; btn.textContent = "Create Account"; }
    });
  }

  if (tab === "forgot") {
    document.getElementById("forgot-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("forgot-btn");
      btn.disabled = true; btn.textContent = "Sending...";
      try {
        await api("/api/auth/forgot-password", { method: "POST", body: { email: document.getElementById("forgot-email").value } });
        showToast("Request sent. Karson will share your reset token.", "success");
        document.getElementById("reset-section").style.display = "block";
        btn.disabled = false; btn.textContent = "Request Reset";
      } catch (err) { showToast(err.message, "error"); btn.disabled = false; btn.textContent = "Request Reset"; }
    });
    document.getElementById("reset-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("reset-btn");
      btn.disabled = true; btn.textContent = "Updating...";
      try {
        await api("/api/auth/reset-password", { method: "POST", body: {
          token: document.getElementById("reset-token").value.trim(),
          new_password: document.getElementById("reset-password").value,
        }});
        showToast("Password updated! Sign in with your new password.", "success");
        state.loginTab = "signin"; render();
      } catch (err) { showToast(err.message, "error"); btn.disabled = false; btn.textContent = "Set New Password"; }
    });
  }
}

window.setLoginTab = function(tab) { state.loginTab = tab; render(); };

/* ── Header & Nav ───────────────────────────────────────────── */
function headerHTML() {
  const initial = (state.user?.name || "?")[0].toUpperCase();
  return `
    <header class="app-header">
      <div class="app-header-left">
        ${seshLogo(28)}
        <div><h2>SPIFF Program</h2><span>${state.user?.role === "admin" ? "Admin Dashboard" : "Rep Portal"}</span></div>
      </div>
      <div class="app-header-right">
        <div class="user-badge"><div class="avatar">${initial}</div><span>${state.user?.name || ""}</span></div>
        <button class="btn-logout" onclick="logout()"><i data-lucide="log-out" style="width:16px;height:16px"></i></button>
      </div>
    </header>`;
}

window.logout = function() { state = { token: null, user: null, view: "login", loginTab: "signin", lbFilter: "all", quickClaim: false }; render(); };
window.navigate = function(view) { state.view = view; render(); };

function repNavHTML(active) {
  return `<nav class="rep-nav">
    <button class="rep-nav-item ${active === "dashboard" ? "active" : ""}" onclick="navigate('rep-dashboard')"><i data-lucide="home" style="width:22px;height:22px"></i>Dashboard</button>
    <button class="rep-nav-item ${active === "submit" ? "active" : ""}" onclick="navigate('rep-submit')"><i data-lucide="plus-circle" style="width:22px;height:22px"></i>Log Claim</button>
    <button class="rep-nav-item ${active === "leaderboard" ? "active" : ""}" onclick="navigate('rep-leaderboard')"><i data-lucide="trophy" style="width:22px;height:22px"></i>Leaderboard</button>
  </nav>`;
}

/* ── Rep Dashboard ──────────────────────────────────────────── */
async function renderRepDashboard() {
  app.innerHTML = `${headerHTML()}<main class="app-main has-bottom-nav"><div class="loading-spinner"><div class="spinner"></div></div></main>${repNavHTML("dashboard")}`;
  lucide.createIcons();
  try {
    const [stats, claims] = await Promise.all([api("/api/stats/me"), api("/api/claims")]);
    const dist = stats.distributor;
    const pct = dist ? Math.min(100, (dist.current_fund_balance / dist.initial_fund_amount) * 100) : 0;
    const motivator = motivatorMessage(stats);

    const main = app.querySelector(".app-main");
    main.innerHTML = `
      ${streakBannerHTML(stats.streak_weeks || 0)}

      <div class="motivator-card">
        <span class="motivator-emoji">${motivator.emoji}</span>
        <span class="motivator-text">${motivator.msg}</span>
        ${stats.streak_weeks > 0 ? `<span class="streak-badge">${streakLabel(stats.streak_weeks)}</span>` : ""}
      </div>

      ${weekCompareHTML(stats)}

      <div class="stats-grid">
        <div class="stat-card" style="grid-column:1/-1;">
          <div class="stat-label">${esc(dist?.name)} SPIFF Fund</div>
          <div class="stat-value teal">${fmtCurrency(dist?.current_fund_balance)}</div>
          <div class="stat-sub">${fmtCurrency(dist?.initial_fund_amount)} total &middot; ${Math.round(pct)}% remaining</div>
          <div class="fund-meter"><div class="fund-meter-bar"><div class="fund-meter-fill" style="width:${Math.round(pct)}%"></div></div></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Earned</div>
          <div class="stat-value green">${fmtCurrency(stats.total_earned)}</div>
          <div class="stat-sub">${stats.approved_claims} approved</div>
          ${milestoneHTML(stats.total_earned)}
        </div>
        <div class="stat-card">
          <div class="stat-label">This Month</div>
          <div class="stat-value">${fmtCurrency(stats.earned_this_month)}</div>
          <div class="stat-sub">${stats.doors_this_month} new door${stats.doors_this_month !== 1 ? "s" : ""}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Rank</div>
          <div class="stat-value">#${stats.rank}</div>
          <div class="stat-sub">this month</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Pending</div>
          <div class="stat-value">${stats.pending_claims}</div>
          <div class="stat-sub">awaiting review</div>
        </div>
      </div>

      <div class="section-header">
        <h3>My Claims</h3>
        <div style="display:flex;gap:var(--sp-2);flex-wrap:wrap;">
          <button class="btn btn-secondary btn-sm" onclick="quickClaim()"><i data-lucide="zap" style="width:14px;height:14px"></i> Quick Claim</button>
          <button class="btn btn-primary" onclick="navigate('rep-submit')"><i data-lucide="plus" style="width:16px;height:16px"></i> Log Claim</button>
        </div>
      </div>
      ${claims.length === 0
        ? `<div class="empty-state"><i data-lucide="store" style="width:48px;height:48px"></i><h4>No claims yet</h4><p>Hit the street and log your first new door.</p></div>`
        : `<div class="table-wrapper"><table class="claims-table"><thead><tr><th>Date</th><th>Store</th><th>Type</th><th>Payout</th><th>Status</th></tr></thead><tbody>
          ${claims.map(c => `<tr>
            <td>${fmtDate(c.order_date)}</td>
            <td>${esc(c.store_name)}<br><span style="font-size:11px;color:var(--text-muted)">${esc(c.store_city)}${c.store_city && c.store_state ? ", " : ""}${esc(c.store_state)}</span></td>
            <td><span class="badge badge-type">${c.claim_type_icon || ""} ${esc(c.claim_type_label)}</span></td>
            <td>${fmtCurrency(c.payout_amount)}${c.bonus_applied ? `<br><span style="font-size:11px;color:var(--sesh-dark)">${esc(c.bonus_applied)}</span>` : ""}</td>
            <td><span class="badge badge-${c.status.toLowerCase()}">${c.status}</span></td>
          </tr>`).join("")}
          </tbody></table></div>`}`;

    lucide.createIcons();
    setupPullToRefresh(main, renderRepDashboard);
  } catch (err) { showToast(err.message, "error"); }
}

window.quickClaim = function() {
  state.quickClaim = true;
  state.view = "rep-submit";
  render();
};

/* ── Rep Submit ─────────────────────────────────────────────── */
async function renderRepSubmit() {
  app.innerHTML = `${headerHTML()}<main class="app-main has-bottom-nav"><div class="loading-spinner"><div class="spinner"></div></div></main>${repNavHTML("submit")}`;
  lucide.createIcons();
  try {
    const claimTypes = await api("/api/claim-types");
    const activeTypes = claimTypes.filter(ct => ct.is_active);

    app.querySelector(".app-main").innerHTML = `
      <div class="section-header"><h3>Log a Claim</h3><button class="btn btn-secondary" onclick="navigate('rep-dashboard')"><i data-lucide="arrow-left" style="width:16px;height:16px"></i> Back</button></div>
      <div class="claim-form-wrapper">
        <form id="claim-form">
          <div class="claim-type-toggle" id="type-toggle">
            ${activeTypes.map((ct, i) => `
              <div class="claim-type-btn ${i === 0 ? "active" : ""}" data-type-id="${ct.id}" data-min-rolls="${ct.min_rolls}" onclick="selectClaimTypeById('${ct.id}')">
                <div class="type-icon">${ct.icon}</div>
                <div class="type-label">${esc(ct.label)}</div>
                <div class="type-payout">${fmtCurrency(ct.base_payout)}</div>
              </div>
            `).join("")}
          </div>
          <div id="payout-preview" class="payout-preview-bar" style="display:none"></div>
          <div class="form-group"><label>Store Name *</label><input type="text" class="form-input" id="store-name" placeholder="e.g. Quick Stop Market" required autocomplete="off"></div>
          <div class="form-row">
            <div class="form-group"><label>City</label><input type="text" class="form-input" id="store-city" placeholder="Seattle"></div>
            <div class="form-group"><label>State</label>${stateSelectHTML()}</div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Order Date *</label><input type="date" class="form-input" id="order-date" required></div>
            <div class="form-group"><label>Rolls Ordered</label><input type="number" class="form-input" id="rolls-count" min="0" placeholder="0"></div>
          </div>
          <div class="form-group"><label>Invoice / PO Number</label><input type="text" class="form-input" id="invoice-number" placeholder="Optional"></div>
          <div class="form-group"><label>Invoice Photo</label>
            <div class="file-upload-area" id="upload-area">
              <i data-lucide="upload" class="upload-icon" style="width:24px;height:24px"></i>
              <div class="upload-text">Tap to upload invoice</div>
              <div class="upload-hint">JPG, PNG, or PDF</div>
              <input type="file" id="invoice-file" accept="image/*,.pdf" onchange="handleFileSelect(this)">
            </div>
          </div>
          <button type="submit" class="btn btn-primary btn-block" id="submit-btn"><i data-lucide="send" style="width:16px;height:16px"></i> Submit Claim</button>
        </form>
      </div>`;

    document.getElementById("order-date").valueAsDate = new Date();
    lucide.createIcons();

    if (state.quickClaim) {
      state.quickClaim = false;
      setTimeout(() => document.getElementById("store-name")?.focus(), 80);
    }

    const updatePreview = async () => {
      const activeBtn = document.querySelector(".claim-type-btn.active");
      const dateEl = document.getElementById("order-date");
      if (activeBtn && dateEl?.value) {
        try {
          const info = await api(`/api/payout-preview?claim_type_id=${activeBtn.dataset.typeId}&order_date=${dateEl.value}`);
          const preview = document.getElementById("payout-preview");
          if (info.bonus_info) {
            preview.style.display = "flex";
            preview.innerHTML = `<i data-lucide="zap" style="width:14px;height:14px;color:var(--sesh-dark)"></i> <strong>${fmtCurrency(info.payout)}</strong> payout &middot; ${esc(info.bonus_info)}`;
            lucide.createIcons();
          } else { preview.style.display = "none"; }
        } catch { /* ignore */ }
      }
    };
    document.getElementById("order-date").addEventListener("change", updatePreview);
    updatePreview();

    document.getElementById("claim-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("submit-btn");
      btn.disabled = true;
      const activeBtn = document.querySelector(".claim-type-btn.active");
      const claimTypeId = activeBtn?.dataset.typeId;
      const minRolls = parseInt(activeBtn?.dataset.minRolls || "0", 10);
      const rollsCount = parseInt(document.getElementById("rolls-count").value, 10) || 0;
      if (minRolls > 0 && rollsCount < minRolls) {
        showToast(`Minimum ${minRolls} rolls required for this claim.`, "error");
        btn.disabled = false; return;
      }
      const fd = new FormData();
      fd.append("claim_type_id", claimTypeId);
      fd.append("store_name", document.getElementById("store-name").value);
      fd.append("store_city", document.getElementById("store-city").value);
      fd.append("store_state", document.getElementById("store-state").value);
      fd.append("order_date", document.getElementById("order-date").value);
      fd.append("rolls_count", rollsCount);
      fd.append("invoice_number", document.getElementById("invoice-number").value);
      const file = document.getElementById("invoice-file").files[0];
      if (file) fd.append("invoice_image", file);
      try {
        const claim = await api("/api/claims", { method: "POST", body: fd });
        celebrateClaim(claim.payout_amount);
        setTimeout(() => { state.view = "rep-dashboard"; render(); }, 2400);
      } catch (err) { showToast(err.message, "error"); btn.disabled = false; }
    });
  } catch (err) { showToast(err.message, "error"); }
}

window.selectClaimTypeById = function(id) {
  document.querySelectorAll(".claim-type-btn").forEach(b => b.classList.remove("active"));
  document.querySelector(`[data-type-id="${id}"]`)?.classList.add("active");
};
window.handleFileSelect = function(input) {
  const area = document.getElementById("upload-area");
  if (input.files.length > 0) {
    area.classList.add("has-file");
    area.querySelector(".upload-text").textContent = input.files[0].name;
    area.querySelector(".upload-hint").textContent = "File selected";
  }
};

/* ── Leaderboard ────────────────────────────────────────────── */
async function renderLeaderboard() {
  app.innerHTML = `${headerHTML()}<main class="app-main has-bottom-nav"><div class="loading-spinner"><div class="spinner"></div></div></main>${repNavHTML("leaderboard")}`;
  lucide.createIcons();
  try {
    const board = await api("/api/leaderboard");
    const myEntry = board.find(r => r.is_current_user);
    const myDist = myEntry?.distributor_name || "";

    const filtered = (state.lbFilter === "my-dist" && myDist)
      ? board.filter(r => r.distributor_name === myDist)
      : board;

    // Re-number ranks within filtered view
    const reranked = filtered.map((r, i) => ({ ...r, display_rank: i + 1 }));
    const top3 = reranked.slice(0, 3);
    const rest = reranked.slice(3);
    const medals = ["🥇","🥈","🥉"];

    const rankChangeHTML = (r) => {
      if (r.rank_change == null) return "";
      if (r.rank_change > 0) return ` <span class="rank-up">▲${r.rank_change}</span>`;
      if (r.rank_change < 0) return ` <span class="rank-down">▼${Math.abs(r.rank_change)}</span>`;
      return "";
    };

    const podiumHTML = top3.length ? `
      <div class="podium">
        ${top3.map((r, i) => `
          <div class="podium-card ${r.is_current_user ? "is-me" : ""}">
            <div class="podium-medal">${medals[i]}</div>
            <div class="podium-avatar">${r.name[0].toUpperCase()}</div>
            <div class="podium-name">${esc(r.name)}${r.is_current_user ? " <span class='you-badge'>You</span>" : ""}</div>
            <div class="podium-dist">${esc(r.distributor_name || "")}</div>
            <div class="podium-doors">${r.doors_this_month} this mo.</div>
            <div class="podium-earned">${r.doors_alltime != null ? r.doors_alltime + " all-time" : fmtCurrency(r.total_earned)}</div>
            ${r.streak_weeks > 0 ? `<div class="podium-streak">${streakLabel(r.streak_weeks)}</div>` : ""}
          </div>
        `).join("")}
      </div>` : "";

    const restHTML = rest.length ? `
      <div class="leaderboard-list">
        ${rest.map(r => `
          <div class="lb-row ${r.is_current_user ? "is-me" : ""}" id="${r.is_current_user ? "lb-me" : ""}">
            <span class="lb-rank">#${r.display_rank}${rankChangeHTML(r)}</span>
            <div class="lb-avatar">${r.name[0].toUpperCase()}</div>
            <div class="lb-info">
              <div class="lb-name">${esc(r.name)}${r.is_current_user ? " <span class='you-badge'>You</span>" : ""}</div>
              <div class="lb-dist">${esc(r.distributor_name || "")}</div>
            </div>
            <div class="lb-right">
              <div class="lb-doors">${r.doors_this_month} this mo.</div>
              <div class="lb-earned">${r.doors_alltime != null ? r.doors_alltime + " all-time" : fmtCurrency(r.total_earned)}</div>
              ${r.streak_weeks > 0 ? `<div style="font-size:11px;color:var(--sesh-dark);font-weight:600;">${streakLabel(r.streak_weeks)}</div>` : ""}
            </div>
          </div>
        `).join("")}
      </div>` : "";

    app.querySelector(".app-main").innerHTML = `
      <div class="section-header" style="margin-bottom:var(--sp-4)">
        <h3>Leaderboard</h3>
        <span style="font-size:12px;color:var(--text-muted)">New doors this month</span>
      </div>
      ${myDist ? `
      <div class="lb-filter-bar">
        <button class="lb-filter-btn ${state.lbFilter === "all" ? "active" : ""}" onclick="setLbFilter('all')">All Reps</button>
        <button class="lb-filter-btn ${state.lbFilter === "my-dist" ? "active" : ""}" onclick="setLbFilter('my-dist')">${esc(myDist)}</button>
      </div>` : ""}
      ${reranked.length === 0
        ? `<div class="empty-state"><i data-lucide="trophy" style="width:48px;height:48px"></i><h4>No activity yet</h4><p>Be the first to log a new door.</p></div>`
        : podiumHTML + restHTML}`;

    lucide.createIcons();

    // Scroll current user row into view after short delay
    setTimeout(() => {
      document.getElementById("lb-me")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);

  } catch (err) { showToast(err.message, "error"); }
}

window.setLbFilter = function(filter) { state.lbFilter = filter; renderLeaderboard(); };

/* ── Admin Dashboard ────────────────────────────────────────── */
function adminNavHTML(active) {
  return `
    <div class="admin-tabs">
      <button class="admin-tab ${active === "claims" ? "active" : ""}" onclick="navigate('admin-claims')"><i data-lucide="file-check" style="width:16px;height:16px"></i> Claims</button>
      <button class="admin-tab ${active === "funds" ? "active" : ""}" onclick="navigate('admin-funds')"><i data-lucide="landmark" style="width:16px;height:16px"></i> Funds</button>
      <button class="admin-tab ${active === "settings" ? "active" : ""}" onclick="navigate('admin-settings')"><i data-lucide="settings" style="width:16px;height:16px"></i> Settings</button>
    </div>`;
}

async function renderAdminDashboard(section) {
  app.innerHTML = `${headerHTML()}<main class="app-main">${adminNavHTML(section)}<div id="admin-content"><div class="loading-spinner"><div class="spinner"></div></div></div></main>`;
  lucide.createIcons();
  if (section === "claims") await renderAdminClaims();
  else if (section === "funds") await renderAdminFunds();
  else if (section === "settings") await renderAdminSettings();
}

/* ── Admin Claims — invoice thumb + bulk approve ────────────── */
async function renderAdminClaims() {
  const content = document.getElementById("admin-content");
  try {
    const [claims, stats] = await Promise.all([api("/api/claims"), api("/api/stats/admin")]);
    window._pendingSelected = new Set();

    content.innerHTML = `
      <div class="stats-grid" style="margin-bottom:var(--sp-6)">
        <div class="stat-card"><div class="stat-label">Pending Review</div><div class="stat-value" style="color:var(--pending)">${stats.pending_claims || 0}</div></div>
        <div class="stat-card"><div class="stat-label">Approved</div><div class="stat-value green">${stats.approved_claims || 0}</div></div>
        <div class="stat-card"><div class="stat-label">Total Paid</div><div class="stat-value teal">${fmtCurrency(stats.total_paid)}</div></div>
        <div class="stat-card"><div class="stat-label">Total Claims</div><div class="stat-value">${stats.total_claims || 0}</div></div>
      </div>
      <div class="section-header">
        <h3>All Claims</h3>
        <div style="display:flex;gap:var(--sp-2);align-items:center;flex-wrap:wrap;">
          <button class="btn btn-success btn-sm" id="bulk-approve-btn" style="display:none" onclick="bulkApprove()">
            <i data-lucide="check-circle" style="width:14px;height:14px"></i> Approve Selected (<span id="bulk-count">0</span>)
          </button>
          <button class="btn btn-secondary btn-sm" onclick="exportClaims()"><i data-lucide="download" style="width:14px;height:14px"></i> Export CSV</button>
        </div>
      </div>
      ${claims.length === 0
        ? `<div class="empty-state"><i data-lucide="inbox" style="width:48px;height:48px"></i><h4>No claims yet</h4></div>`
        : `<div class="table-wrapper"><table class="claims-table">
            <thead><tr>
              <th><input type="checkbox" id="bulk-select-all" onchange="toggleAllPending(this.checked)" style="width:16px;height:16px;cursor:pointer;accent-color:var(--sesh-dark)"></th>
              <th>Rep</th><th>Distributor</th><th>Store</th><th>Type</th><th>Date</th><th>Payout</th><th>Invoice</th><th>Status</th><th>Action</th>
            </tr></thead>
            <tbody>
              ${claims.map(c => `<tr>
                <td>${c.status === "PENDING" ? `<input type="checkbox" class="bulk-cb" data-id="${c.id}" onchange="toggleBulkSelect('${c.id}',this.checked)" style="width:16px;height:16px;cursor:pointer;accent-color:var(--sesh-dark)">` : ""}</td>
                <td><strong>${esc(c.rep_name)}</strong><br><span style="font-size:11px;color:var(--text-muted)">${esc(c.rep_email)}</span></td>
                <td>${esc(c.distributor_name)}</td>
                <td>${esc(c.store_name)}<br><span style="font-size:11px;color:var(--text-muted)">${esc(c.store_city)}${c.store_city && c.store_state ? ", " : ""}${esc(c.store_state)}</span></td>
                <td><span class="badge badge-type">${c.claim_type_icon || ""} ${esc(c.claim_type_label)}</span><br>${c.rolls_count > 0 ? `<span style="font-size:11px;color:var(--text-muted)">${c.rolls_count} rolls</span>` : ""}</td>
                <td>${fmtDate(c.order_date)}</td>
                <td>${fmtCurrency(c.payout_amount)}${c.bonus_applied ? `<br><span style="font-size:11px;color:var(--sesh-dark)">${esc(c.bonus_applied)}</span>` : ""}</td>
                <td>${c.invoice_image_url ? `<img src="${esc(c.invoice_image_url)}" class="invoice-thumb" onclick="viewInvoice('${esc(c.invoice_image_url)}')" alt="Invoice" loading="lazy">` : "—"}</td>
                <td><span class="badge badge-${c.status.toLowerCase()}">${c.status}</span>${c.rejection_reason ? `<br><span style="font-size:10px;color:var(--text-muted)">${esc(c.rejection_reason)}</span>` : ""}</td>
                <td>${c.status === "PENDING" ? `
                  <div class="claim-actions">
                    <button class="btn btn-success btn-sm" onclick="reviewClaim('${c.id}','APPROVED')">Approve</button>
                    <button class="btn btn-danger btn-sm" onclick="rejectClaimPrompt('${c.id}')">Reject</button>
                  </div>` : "—"}</td>
              </tr>`).join("")}
            </tbody>
          </table></div>`}`;
    lucide.createIcons();
  } catch (err) { showToast(err.message, "error"); }
}

window.toggleBulkSelect = function(id, checked) {
  const sel = window._pendingSelected || (window._pendingSelected = new Set());
  checked ? sel.add(id) : sel.delete(id);
  const count = sel.size;
  const btn = document.getElementById("bulk-approve-btn");
  const countEl = document.getElementById("bulk-count");
  if (btn) btn.style.display = count > 0 ? "inline-flex" : "none";
  if (countEl) countEl.textContent = count;
};

window.toggleAllPending = function(checked) {
  document.querySelectorAll(".bulk-cb").forEach(cb => {
    cb.checked = checked;
    window.toggleBulkSelect(cb.dataset.id, checked);
  });
};

window.bulkApprove = async function() {
  const sel = window._pendingSelected;
  if (!sel || sel.size === 0) return;
  const ids = [...sel];
  const btn = document.getElementById("bulk-approve-btn");
  if (btn) { btn.disabled = true; btn.querySelector("span")?.remove(); btn.lastChild.textContent = " Approving..."; }
  try {
    await Promise.all(ids.map(id =>
      api(`/api/claims/${id}/review`, { method: "PUT", body: { status: "APPROVED", rejection_reason: null } })
    ));
    showToast(`${ids.length} claim${ids.length !== 1 ? "s" : ""} approved ✓`, "success");
    renderAdminClaims();
  } catch (err) { showToast(err.message, "error"); renderAdminClaims(); }
};

window.viewInvoice = function(url) {
  const modal = document.createElement("div"); modal.className = "modal-overlay";
  modal.innerHTML = `<div class="modal-card" style="max-width:640px;text-align:center">
    <h3 style="margin-bottom:var(--sp-4)">Invoice</h3>
    <img src="${url}" class="invoice-preview" alt="Invoice photo">
    <div class="modal-actions" style="justify-content:center;margin-top:var(--sp-4)">
      <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Close</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
};

window.reviewClaim = async function(id, status, reason) {
  try {
    await api(`/api/claims/${id}/review`, { method: "PUT", body: { status, rejection_reason: reason || null } });
    showToast(status === "APPROVED" ? "Claim approved ✓" : "Claim rejected", status === "APPROVED" ? "success" : "info");
    renderAdminClaims();
  } catch (err) { showToast(err.message, "error"); }
};

window.rejectClaimPrompt = function(id) {
  const modal = document.createElement("div"); modal.className = "modal-overlay";
  modal.innerHTML = `<div class="modal-card"><h3>Reject Claim</h3>
    <div class="form-group"><label>Reason (optional)</label><input type="text" class="form-input" id="reject-reason" placeholder="e.g. Duplicate submission"></div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
      <button class="btn btn-danger" onclick="reviewClaim('${id}','REJECTED',document.getElementById('reject-reason')?.value);this.closest('.modal-overlay').remove()">Reject</button>
    </div></div>`;
  document.body.appendChild(modal);
};

window.exportClaims = async function() {
  try {
    const blob = await api("/api/claims/export");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `sesh_spiff_claims.csv`; a.click();
    URL.revokeObjectURL(url);
  } catch (err) { showToast(err.message, "error"); }
};

/* ── Admin Funds — with rep count ───────────────────────────── */
async function renderAdminFunds() {
  const content = document.getElementById("admin-content");
  try {
    const distributors = await api("/api/distributors");
    content.innerHTML = `
      <div class="section-header"><h3>Distributor Funds & Invite Codes</h3></div>
      ${distributors.map(d => {
        const pct = d.initial_fund_amount ? Math.min(100, (d.current_fund_balance / d.initial_fund_amount) * 100) : 0;
        const repCount = d.rep_count ?? d.active_reps ?? null;
        return `<div class="dist-fund-card">
          <div class="dist-fund-header">
            <div>
              <h4>${esc(d.name)}</h4>
              <div class="invite-code-display">
                Invite code: <strong>${esc(d.invite_code || "—")}</strong>
                <button class="btn btn-secondary btn-xs" onclick="editInviteCode('${d.id}','${esc(d.invite_code || "")}')">Edit</button>
              </div>
            </div>
            <button class="btn btn-primary btn-sm" onclick="openAddFundsModal('${d.id}','${esc(d.name)}',${d.current_fund_balance})">Manage Fund</button>
          </div>
          <div class="fund-meter"><div class="fund-meter-bar"><div class="fund-meter-fill" style="width:${Math.round(pct)}%"></div></div></div>
          <div class="dist-fund-stats">
            <span>${fmtCurrency(d.current_fund_balance)} remaining</span>
            <span>${fmtCurrency(d.total_paid_out)} paid out</span>
            <span>${d.approved_claims} approved claims</span>
            ${repCount != null ? `<span><strong>${repCount}</strong> rep${repCount !== 1 ? "s" : ""}</span>` : ""}
          </div>
        </div>`;
      }).join("")}`;
    lucide.createIcons();
  } catch (err) { showToast(err.message, "error"); }
}

window.editInviteCode = function(distId, currentCode) {
  const modal = document.createElement("div"); modal.className = "modal-overlay";
  modal.innerHTML = `<div class="modal-card"><h3>Edit Invite Code</h3>
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:var(--sp-5);">Share this code with reps at this distributor so they can self-register.</p>
    <div class="form-group"><label>Invite Code</label><input type="text" class="form-input" id="new-invite-code" value="${esc(currentCode)}" placeholder="e.g. HARBOR2026" style="text-transform:uppercase;font-weight:600;letter-spacing:1px;"></div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="saveInviteCode('${distId}')">Save</button>
    </div></div>`;
  document.body.appendChild(modal);
};

window.saveInviteCode = async function(distId) {
  const code = document.getElementById("new-invite-code")?.value?.trim().toUpperCase();
  document.querySelector(".modal-overlay")?.remove();
  if (!code) return;
  try {
    await api(`/api/distributors/${distId}/fund`, { method: "PUT", body: { invite_code: code } });
    showToast("Invite code updated.", "success"); renderAdminFunds();
  } catch (err) { showToast(err.message, "error"); }
};

window.openAddFundsModal = function(distId, distName, currentBalance) {
  const modal = document.createElement("div"); modal.className = "modal-overlay";
  modal.innerHTML = `<div class="modal-card"><h3>Manage Fund — ${esc(distName)}</h3>
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:var(--sp-5);">Current balance: <strong>${fmtCurrency(currentBalance)}</strong></p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:var(--sp-5);">
      <button class="fund-mode-btn active" id="mode-set" onclick="setFundMode('set')">Set Balance</button>
      <button class="fund-mode-btn" id="mode-add" onclick="setFundMode('add')">Add Funds</button>
    </div>
    <div id="fund-mode-set">
      <div class="form-group"><label>New Balance ($)</label><input type="number" class="form-input" id="set-balance-amount" min="0" placeholder="5000"></div>
      <p style="font-size:11px;color:var(--text-muted);">This replaces the current balance entirely.</p>
    </div>
    <div id="fund-mode-add" style="display:none">
      <div class="form-group"><label>Amount to Add ($)</label><input type="number" class="form-input" id="add-funds-amount" min="1" placeholder="1000"></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="submitFundUpdate('${distId}')">Save</button>
    </div></div>`;
  document.body.appendChild(modal);
};

window.setFundMode = function(mode) {
  document.getElementById("fund-mode-set").style.display = mode === "set" ? "block" : "none";
  document.getElementById("fund-mode-add").style.display = mode === "add" ? "block" : "none";
  document.getElementById("mode-set").classList.toggle("active", mode === "set");
  document.getElementById("mode-add").classList.toggle("active", mode === "add");
};

window.submitFundUpdate = async function(distId) {
  const isSet = document.getElementById("fund-mode-set").style.display !== "none";
  const amount = parseFloat((isSet
    ? document.getElementById("set-balance-amount")
    : document.getElementById("add-funds-amount"))?.value || "0");
  document.querySelector(".modal-overlay")?.remove();
  if (amount < 0 || (!isSet && amount <= 0)) { showToast("Enter a valid amount.", "error"); return; }
  try {
    // Set Balance resets initial_fund_amount too, so "paid out" (= initial − current) stays clean
    const body = isSet ? { set_balance: amount, initial_fund_amount: amount } : { add_funds: amount };
    await api(`/api/distributors/${distId}/fund`, { method: "PUT", body });
    showToast(isSet ? `Balance set to ${fmtCurrency(amount)}.` : `${fmtCurrency(amount)} added.`, "success");
    renderAdminFunds();
  } catch (err) { showToast(err.message, "error"); }
};

/* ── Admin Settings ─────────────────────────────────────────── */
async function renderAdminSettings() {
  const content = document.getElementById("admin-content");
  try {
    const [claimTypes, bonusPrograms, distributors] = await Promise.all([
      api("/api/claim-types"), api("/api/bonus-programs"), api("/api/distributors"),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    content.innerHTML = `
      <div class="section-header"><h3>Claim Types & Payouts</h3><button class="btn btn-primary btn-sm" onclick="openAddClaimTypeModal()"><i data-lucide="plus" style="width:14px;height:14px"></i> Add Type</button></div>
      <div class="table-wrapper" style="margin-bottom:var(--sp-8)">
        <table class="claims-table">
          <thead><tr><th></th><th>Label</th><th>Base Payout</th><th>Min Rolls</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${claimTypes.map(ct => `<tr>
              <td style="font-size:20px">${ct.icon}</td>
              <td><strong>${esc(ct.label)}</strong><br><span style="font-size:12px;color:var(--text-muted)">${esc(ct.description || "")}</span></td>
              <td><strong>${fmtCurrency(ct.base_payout)}</strong></td>
              <td>${ct.min_rolls || "—"}</td>
              <td><span class="badge ${ct.is_active ? "badge-approved" : "badge-rejected"}">${ct.is_active ? "Active" : "Inactive"}</span></td>
              <td><button class="btn btn-secondary btn-sm" onclick='openEditClaimTypeModal(${JSON.stringify(ct).replace(/'/g, "\\'")})'>Edit</button></td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div class="section-header"><h3>Bonus Programs & Contests</h3><button class="btn btn-primary btn-sm" onclick="openAddBonusModal()"><i data-lucide="plus" style="width:14px;height:14px"></i> Add Bonus</button></div>
      ${bonusPrograms.length === 0
        ? `<div class="empty-state" style="padding:var(--sp-8)"><i data-lucide="zap" style="width:40px;height:40px"></i><h4>No bonus programs</h4><p>Create time-limited bonuses, multipliers, or contests.</p></div>`
        : `<div class="table-wrapper"><table class="claims-table">
          <thead><tr><th>Name</th><th>Type</th><th>Value</th><th>Applies To</th><th>Dates</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${bonusPrograms.map(bp => {
              const isActive = bp.is_active && bp.start_date <= today && bp.end_date >= today;
              const isPast = bp.end_date < today;
              return `<tr style="${isPast ? "opacity:0.5" : ""}">
                <td><strong>${esc(bp.name)}</strong><br><span style="font-size:12px;color:var(--text-muted)">${esc(bp.description || "")}</span></td>
                <td><span class="badge badge-type">${bp.bonus_type === "FLAT_BONUS" ? "Flat Bonus" : bp.bonus_type === "MULTIPLIER" ? "Multiplier" : "Override"}</span></td>
                <td><strong>${bp.bonus_type === "MULTIPLIER" ? bp.bonus_value + "x" : fmtCurrency(bp.bonus_value)}</strong></td>
                <td>${esc(bp.claim_type_label || "All types")}<br><span style="font-size:12px;color:var(--text-muted)">${esc(bp.distributor_name || "All distributors")}</span></td>
                <td>${fmtDate(bp.start_date)} — ${fmtDate(bp.end_date)}</td>
                <td><span class="badge ${isActive ? "badge-approved" : isPast ? "badge-rejected" : bp.is_active ? "badge-pending" : "badge-rejected"}">${isActive ? "Active" : isPast ? "Ended" : bp.is_active ? "Scheduled" : "Paused"}</span></td>
                <td><div class="claim-actions">
                  <button class="btn btn-secondary btn-sm" onclick="toggleBonus('${bp.id}')">${bp.is_active ? "Pause" : "Resume"}</button>
                  <button class="btn btn-danger btn-sm" onclick="deleteBonus('${bp.id}')">Delete</button>
                </div></td>
              </tr>`;
            }).join("")}
          </tbody></table></div>`}`;
    lucide.createIcons();
    window._settingsData = { claimTypes, distributors };
  } catch (err) { showToast(err.message, "error"); }
}

/* ── Settings Modals ────────────────────────────────────────── */
window.openAddClaimTypeModal = function() {
  const modal = document.createElement("div"); modal.className = "modal-overlay";
  modal.innerHTML = `<div class="modal-card"><h3>Add Claim Type</h3>
    <div class="form-group"><label>Label</label><input type="text" class="form-input" id="ct-label" placeholder="Chain Authorization" required></div>
    <div class="form-group"><label>Description</label><input type="text" class="form-input" id="ct-desc" placeholder="Brief description"></div>
    <div class="form-row">
      <div class="form-group"><label>Base Payout ($)</label><input type="number" class="form-input" id="ct-payout" min="0" placeholder="500"></div>
      <div class="form-group"><label>Min Rolls</label><input type="number" class="form-input" id="ct-min-rolls" min="0" value="0"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Max Payout Cap ($)</label><input type="number" class="form-input" id="ct-max-payout" min="0" placeholder="No cap"></div>
      <div class="form-group"><label>Icon (emoji)</label><input type="text" class="form-input" id="ct-icon" value="📋" maxlength="4"></div>
    </div>
    <div class="modal-actions"><button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button><button class="btn btn-primary" onclick="submitAddClaimType()">Create</button></div></div>`;
  document.body.appendChild(modal);
};

window.submitAddClaimType = async function() {
  const label = document.getElementById("ct-label")?.value;
  const payout = parseFloat(document.getElementById("ct-payout")?.value || "0");
  if (!label || payout < 0) { showToast("Fill in required fields.", "error"); return; }
  document.querySelector(".modal-overlay")?.remove();
  try {
    await api("/api/claim-types", { method: "POST", body: {
      name: label.toUpperCase().replace(/\s+/g, "_"),
      label, description: document.getElementById("ct-desc")?.value || "",
      base_payout: payout, min_rolls: parseInt(document.getElementById("ct-min-rolls")?.value || "0", 10),
      max_payout: parseFloat(document.getElementById("ct-max-payout")?.value) || null,
      icon: document.getElementById("ct-icon")?.value || "📋",
    }});
    showToast("Claim type created.", "success"); render();
  } catch (err) { showToast(err.message, "error"); }
};

window.openEditClaimTypeModal = function(ct) {
  const modal = document.createElement("div"); modal.className = "modal-overlay";
  modal.innerHTML = `<div class="modal-card"><h3>Edit: ${esc(ct.label)}</h3>
    <div class="form-group"><label>Label</label><input type="text" class="form-input" id="ct-edit-label" value="${esc(ct.label)}"></div>
    <div class="form-group"><label>Description</label><input type="text" class="form-input" id="ct-edit-desc" value="${esc(ct.description || "")}"></div>
    <div class="form-row">
      <div class="form-group"><label>Base Payout ($)</label><input type="number" class="form-input" id="ct-edit-payout" value="${ct.base_payout}"></div>
      <div class="form-group"><label>Min Rolls</label><input type="number" class="form-input" id="ct-edit-min-rolls" value="${ct.min_rolls || 0}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Max Payout Cap ($)</label><input type="number" class="form-input" id="ct-edit-max-payout" value="${ct.max_payout || ""}" placeholder="0 = no cap"></div>
      <div class="form-group"><label>Icon</label><input type="text" class="form-input" id="ct-edit-icon" value="${ct.icon || "📋"}" maxlength="4"></div>
    </div>
    <div class="form-group" style="display:flex;align-items:center;gap:var(--sp-3)">
      <label style="margin:0">Active</label>
      <input type="checkbox" id="ct-edit-active" ${ct.is_active ? "checked" : ""} style="width:20px;height:20px">
    </div>
    <div class="modal-actions"><button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button><button class="btn btn-primary" onclick="submitEditClaimType('${ct.id}')">Save</button></div></div>`;
  document.body.appendChild(modal);
};

window.submitEditClaimType = async function(id) {
  const body = {
    label: document.getElementById("ct-edit-label")?.value,
    description: document.getElementById("ct-edit-desc")?.value,
    base_payout: parseFloat(document.getElementById("ct-edit-payout")?.value || "0"),
    min_rolls: parseInt(document.getElementById("ct-edit-min-rolls")?.value || "0", 10),
    max_payout: parseFloat(document.getElementById("ct-edit-max-payout")?.value) || 0,
    is_active: document.getElementById("ct-edit-active")?.checked,
    icon: document.getElementById("ct-edit-icon")?.value || "📋",
  };
  document.querySelector(".modal-overlay")?.remove();
  try { await api(`/api/claim-types/${id}`, { method: "PUT", body }); showToast("Updated.", "success"); render(); }
  catch (err) { showToast(err.message, "error"); }
};

window.openAddBonusModal = function() {
  const data = window._settingsData || {};
  const modal = document.createElement("div"); modal.className = "modal-overlay";
  modal.innerHTML = `<div class="modal-card"><h3>Create Bonus / Contest</h3>
    <div class="form-group"><label>Name</label><input type="text" class="form-input" id="bp-name" placeholder="March Madness — 2x New Doors"></div>
    <div class="form-group"><label>Description</label><input type="text" class="form-input" id="bp-desc" placeholder="Optional details"></div>
    <div class="form-row">
      <div class="form-group"><label>Bonus Type</label>
        <select class="form-input" id="bp-type"><option value="FLAT_BONUS">Flat Bonus (+$)</option><option value="MULTIPLIER">Multiplier (x)</option><option value="OVERRIDE">Override ($)</option></select>
      </div>
      <div class="form-group"><label>Value</label><input type="number" class="form-input" id="bp-value" step="0.1" placeholder="e.g. 5 or 2.0"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Claim Type (optional)</label>
        <select class="form-input" id="bp-claim-type"><option value="">All types</option>${(data.claimTypes || []).map(ct => `<option value="${ct.id}">${esc(ct.label)}</option>`).join("")}</select>
      </div>
      <div class="form-group"><label>Distributor (optional)</label>
        <select class="form-input" id="bp-distributor"><option value="">All distributors</option>${(data.distributors || []).map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join("")}</select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Start Date</label><input type="date" class="form-input" id="bp-start"></div>
      <div class="form-group"><label>End Date</label><input type="date" class="form-input" id="bp-end"></div>
    </div>
    <div class="modal-actions"><button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button><button class="btn btn-primary" onclick="submitAddBonus()">Create</button></div></div>`;
  document.body.appendChild(modal);
};

window.submitAddBonus = async function() {
  const name = document.getElementById("bp-name")?.value;
  if (!name) { showToast("Name is required.", "error"); return; }
  const body = {
    name, description: document.getElementById("bp-desc")?.value || "",
    bonus_type: document.getElementById("bp-type")?.value,
    bonus_value: parseFloat(document.getElementById("bp-value")?.value || "0"),
    claim_type_id: document.getElementById("bp-claim-type")?.value || null,
    distributor_id: document.getElementById("bp-distributor")?.value || null,
    start_date: document.getElementById("bp-start")?.value,
    end_date: document.getElementById("bp-end")?.value,
  };
  if (!body.start_date || !body.end_date) { showToast("Set start and end dates.", "error"); return; }
  document.querySelector(".modal-overlay")?.remove();
  try { await api("/api/bonus-programs", { method: "POST", body }); showToast("Bonus program created.", "success"); render(); }
  catch (err) { showToast(err.message, "error"); }
};

window.toggleBonus = async function(id) {
  try { await api(`/api/bonus-programs/${id}/toggle`, { method: "PUT" }); showToast("Updated.", "success"); render(); }
  catch (err) { showToast(err.message, "error"); }
};
window.deleteBonus = async function(id) {
  try { await api(`/api/bonus-programs/${id}`, { method: "DELETE" }); showToast("Deleted.", "success"); render(); }
  catch (err) { showToast(err.message, "error"); }
};

/* ── Init ───────────────────────────────────────────────────── */
render();
