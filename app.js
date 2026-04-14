/* ── Sesh SPIFF App v2 ──────────────────────────────────────── */
const API = (location.hostname === "127.0.0.1" || location.hostname === "localhost")
  ? "http://127.0.0.1:8000" : "";

const app = document.getElementById("app");

// ── Session persistence ─────────────────────────────────────
const _saved = (() => { try { return JSON.parse(sessionStorage.getItem("sesh_session") || "null"); } catch(e) { return null; } })();

let state = {
  token: _saved?.token || null,
  user:  _saved?.user  || null,
  view:  _saved?.token ? (_saved?.user?.role === "admin" ? "admin-claims" : "rep-dashboard") : "login",
  loginTab: "signin",
  lbFilter: "my-dist",   // "all" | "my-dist"
  quickClaim: false,
};

function saveSession() {
  if (state.token && state.user) {
    sessionStorage.setItem("sesh_session", JSON.stringify({ token: state.token, user: state.user }));
  } else {
    sessionStorage.removeItem("sesh_session");
  }
}

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
    if (res.status === 401) { window.logout && window.logout(); return; }
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
  // Normalize: handle both "2026-04-13T..." and "2026-04-13 ..." formats from DB
  const normalized = String(d).replace(" ", "T").slice(0, 10);
  const dt = new Date(normalized + "T00:00:00");
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
  const label = earned === 0
    ? `First milestone: <strong>${fmtCurrency(milestone)}</strong>`
    : `Next milestone: <strong>${fmtCurrency(milestone)}</strong> <span class="milestone-to-go">${fmtCurrency(toNext)} to go</span>`;
  return `
    <div class="milestone-wrap">
      <div class="milestone-label" style="font-size:11px;color:var(--text-muted);margin-bottom:var(--sp-2)">${label}</div>
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
    case "rep-notes": renderRepNotes(); break;
    case "rep-requests": renderRepRequests(); break;
    case "admin-claims": renderAdminDashboard("claims"); break;
    case "admin-requests": renderAdminDashboard("requests"); break;
    case "admin-funds": renderAdminDashboard("funds"); break;
    case "admin-doors": renderAdminDashboard("doors"); break;
    case "admin-notes": renderAdminDashboard("notes"); break;
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
        saveSession();
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
        saveSession();
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

window.logout = function() { state = { token: null, user: null, view: "login", loginTab: "signin", lbFilter: "my-dist", quickClaim: false }; saveSession(); render(); };
window.navigate = function(view) { state.view = view; render(); };

function repNavHTML(active) {
  return `<nav class="rep-nav">
    <button class="rep-nav-item ${active === "dashboard" ? "active" : ""}" onclick="navigate('rep-dashboard')"><i data-lucide="home" style="width:22px;height:22px"></i>Dashboard</button>
    <button class="rep-nav-item ${active === "submit" ? "active" : ""}" onclick="navigate('rep-submit')"><i data-lucide="plus-circle" style="width:22px;height:22px"></i>Log Claim</button>
    <button class="rep-nav-item ${active === "requests" ? "active" : ""}" onclick="navigate('rep-requests')"><i data-lucide="package" style="width:22px;height:22px"></i>Requests</button>
    <button class="rep-nav-item ${active === "notes" ? "active" : ""}" onclick="navigate('rep-notes')"><i data-lucide="notebook-pen" style="width:22px;height:22px"></i>Notes</button>
    <button class="rep-nav-item ${active === "leaderboard" ? "active" : ""}" onclick="navigate('rep-leaderboard')"><i data-lucide="trophy" style="width:22px;height:22px"></i>Leaderboard</button>
  </nav>`;
}

/* ── Rep Dashboard ──────────────────────────────────────────── */
async function renderRepDashboard() {
  app.innerHTML = `${headerHTML()}${repNavHTML("dashboard")}<main class="app-main has-bottom-nav"><div class="loading-spinner"><div class="spinner"></div></div></main>`;
  lucide.createIcons();
  try {
    const [stats, claims, doorData] = await Promise.all([api("/api/stats/me"), api("/api/claims"), api("/api/doors/me")]);
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
          <div class="stat-value ${stats.total_earned > 0 ? 'green' : ''}">${fmtCurrency(stats.total_earned)}</div>
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

      <div class="door-list-section" id="door-list-section">
        <div class="door-list-header" onclick="toggleDoorSection()">
          <div style="display:flex;align-items:center;gap:var(--sp-3)">
            <i data-lucide="map-pin" style="width:18px;height:18px"></i>
            <div>
              <div style="font-weight:600;font-size:14px">My Door List</div>
              <div style="font-size:12px;color:var(--text-muted)">${doorData.active_count} active &middot; ${doorData.target_count} target${dist?.door_bonus_enabled ? (doorData.bonus_earned ? " &middot; <span style=\'color:#16a34a;font-weight:600\'>$10 bonus earned ✓</span>" : " &middot; <span style=\'color:var(--pending);font-weight:600\'>Submit both lists to earn $10</span>") : ""}</div>
            </div>
          </div>
          <i data-lucide="chevron-down" id="door-chevron" style="width:18px;height:18px;transition:transform .2s;${state.doorSectionOpen ? 'transform:rotate(180deg)' : ''}"></i>
        </div>
        <div id="door-section-body" style="display:${state.doorSectionOpen ? 'block' : 'none'}">
          ${doorSectionBodyHTML(doorData, dist)}
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
  app.innerHTML = `${headerHTML()}${repNavHTML("submit")}<main class="app-main has-bottom-nav"><div class="loading-spinner"><div class="spinner"></div></div></main>`;
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
        } catch (e) { /* ignore */ }
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
  app.innerHTML = `${headerHTML()}${repNavHTML("leaderboard")}<main class="app-main has-bottom-nav"><div class="loading-spinner"><div class="spinner"></div></div></main>`;
  lucide.createIcons();
  try {
    const board = await api("/api/leaderboard");
    const myEntry = board.find(r => r.is_current_user);
    const myDist = myEntry?.distributor_name || "";

    const filtered = myDist
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
      <button class="admin-tab ${active === "requests" ? "active" : ""}" onclick="navigate('admin-requests')"><i data-lucide="package" style="width:16px;height:16px"></i> Requests</button>
      <button class="admin-tab ${active === "doors" ? "active" : ""}" onclick="navigate('admin-doors')"><i data-lucide="map-pin" style="width:16px;height:16px"></i> Doors</button>
      <button class="admin-tab ${active === "funds" ? "active" : ""}" onclick="navigate('admin-funds')"><i data-lucide="landmark" style="width:16px;height:16px"></i> Funds</button>
      <button class="admin-tab ${active === "notes" ? "active" : ""}" onclick="navigate('admin-notes')"><i data-lucide="notebook-pen" style="width:16px;height:16px"></i> Notes</button>
      <button class="admin-tab ${active === "health" ? "active" : ""}" onclick="navigate('admin-health')"><i data-lucide="activity" style="width:16px;height:16px"></i> Health</button>
      <button class="admin-tab ${active === "settings" ? "active" : ""}" onclick="navigate('admin-settings')"><i data-lucide="settings" style="width:16px;height:16px"></i> Settings</button>
    </div>`;
}

async function renderAdminDashboard(section) {
  app.innerHTML = `${headerHTML()}<main class="app-main">${adminNavHTML(section)}<div id="admin-content"><div class="loading-spinner"><div class="spinner"></div></div></div></main>`;
  lucide.createIcons();
  if (section === "claims") await renderAdminClaims();
  else if (section === "requests") await renderAdminRequests();
  else if (section === "funds") await renderAdminFunds();
  else if (section === "doors") await renderAdminDoors();
  else if (section === "notes") await renderAdminNotes();
  else if (section === "health") await renderAdminHealth();
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
              <div style="margin-top:var(--sp-2);display:flex;align-items:center;gap:var(--sp-2);font-size:12px;color:var(--text-muted)">
                <label style="display:flex;align-items:center;gap:var(--sp-2);cursor:pointer">
                  <input type="checkbox" ${d.door_bonus_enabled ? "checked" : ""} onchange="toggleDoorBonus('${d.id}', this.checked)" style="cursor:pointer">
                  $10 door list bonus enabled
                </label>
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

window.toggleDoorBonus = async function(distId, enabled) {
  try {
    await api(`/api/distributors/${distId}/fund`, { method: "PUT", body: { door_bonus_enabled: enabled } });
    showToast(enabled ? "Door list bonus enabled." : "Door list bonus disabled.", "success");
  } catch (err) { showToast(err.message, "error"); renderAdminFunds(); }
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

/* ── Door List ───────────────────────────────────────────────── */
state.doorSectionOpen = false;
state.doorActiveTab = "ACTIVE";   // "ACTIVE" | "TARGET"

function doorSectionBodyHTML(doorData, dist) {
  const doors = doorData.doors || [];
  const activeTab = state.doorActiveTab || "ACTIVE";
  const activeDoors = doors.filter(d => d.door_type === "ACTIVE");
  const targetDoors = doors.filter(d => d.door_type === "TARGET");
  const shown = activeTab === "ACTIVE" ? activeDoors : targetDoors;
  const storeListId = "door-datalist";
  const storeDatalist = `<datalist id="${storeListId}">${(window._doorStores||[]).map(s => `<option value="${esc(s.store_name)}"></option>`).join("")}</datalist>`;

  return `
    <div style="padding:var(--sp-4) 0 var(--sp-2)">
      ${dist?.door_bonus_enabled && !doorData.bonus_earned ? `
      <div class="door-bonus-banner">
        <i data-lucide="gift" style="width:16px;height:16px"></i>
        <span>Submit your <strong>Active</strong> and <strong>Target</strong> door lists to earn a <strong>$10 bonus</strong> — one time, auto-approved.</span>
      </div>` : ""}

      <div class="door-type-tabs">
        <button class="door-tab ${activeTab === "ACTIVE" ? "active" : ""}" onclick="setDoorTab('ACTIVE')">
          Active Doors <span class="door-count">${activeDoors.length}</span>
        </button>
        <button class="door-tab ${activeTab === "TARGET" ? "active" : ""}" onclick="setDoorTab('TARGET')">
          Target Doors <span class="door-count">${targetDoors.length}</span>
        </button>
      </div>

      <div class="door-add-row">
        ${storeDatalist}
        <input type="text" class="form-input" id="door-store-input" placeholder="Store name" list="${storeListId}" style="flex:1;min-width:0">
        <input type="text" class="form-input" id="door-city-input" placeholder="City" style="width:100px">
        <select class="form-input" id="door-state-input" style="width:72px">
          <option value="">ST</option>
          ${["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"].map(s => `<option value="${s}">${s}</option>`).join("")}
        </select>
        <button class="btn btn-primary btn-sm" onclick="addSingleDoor('${activeTab}')">Add</button>
      </div>

      <div style="margin-bottom:var(--sp-3)">
        <label class="door-csv-label">
          <i data-lucide="upload" style="width:14px;height:14px"></i> Upload CSV
          <input type="file" accept=".csv,.txt" onchange="handleDoorCSV(this,'${activeTab}')" style="display:none">
        </label>
        <span style="font-size:11px;color:var(--text-muted);margin-left:var(--sp-2)">Columns: store_name, city, state (header row optional)</span>
      </div>

      ${shown.length === 0
        ? `<div style="text-align:center;padding:var(--sp-6) 0;color:var(--text-muted);font-size:13px">No ${activeTab.toLowerCase()} doors yet — add one above or upload a CSV.</div>`
        : `<div class="door-list-table-wrap">
            <table class="claims-table" style="font-size:12px">
              <thead><tr><th>Store</th><th>City</th><th>ST</th><th></th></tr></thead>
              <tbody>
                ${shown.map(d => `<tr>
                  <td>${esc(d.store_name)}${d.verified ? " <span style=\'font-size:10px;color:#16a34a\'>✓</span>" : ""}</td>
                  <td style="color:var(--text-muted)">${esc(d.store_city||"")}</td>
                  <td style="color:var(--text-muted)">${esc(d.store_state||"")}</td>
                  <td><button class="btn-icon-sm" onclick="deleteDoor(\'${d.id}\')" title="Remove"><i data-lucide="x" style="width:12px;height:12px"></i></button></td>
                </tr>`).join("")}
              </tbody>
            </table>
          </div>`}
    </div>`;
}

window.toggleDoorSection = function() {
  state.doorSectionOpen = !state.doorSectionOpen;
  const body = document.getElementById("door-section-body");
  const chevron = document.getElementById("door-chevron");
  if (body) body.style.display = state.doorSectionOpen ? "block" : "none";
  if (chevron) chevron.style.transform = state.doorSectionOpen ? "rotate(180deg)" : "";
  if (state.doorSectionOpen) lucide.createIcons();
};

window.setDoorTab = function(tab) {
  state.doorActiveTab = tab;
  renderRepDashboard();
};

window.addSingleDoor = async function(doorType) {
  const name = document.getElementById("door-store-input")?.value.trim();
  if (!name) { showToast("Store name required.", "error"); return; }
  const city = document.getElementById("door-city-input")?.value.trim() || "";
  const st = document.getElementById("door-state-input")?.value || "";
  try {
    const res = await api("/api/doors", { method: "POST", body: {
      doors: [{ door_type: doorType, store_name: name, store_city: city, store_state: st }]
    }});
    if (res.bonus_awarded) {
      showToast(`Door added! 🎉 +$10 bonus unlocked — both lists submitted!`, "success");
    } else if (res.skipped > 0) {
      showToast("That store is already in your list.", "info");
    } else {
      showToast("Door added ✓", "success");
    }
    state.doorSectionOpen = true;
    renderRepDashboard();
  } catch (err) { showToast(err.message, "error"); }
};

window.handleDoorCSV = async function(input, doorType) {
  const file = input.files[0];
  if (!file) return;
  const text = await file.text();
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const doors = [];
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(",").map(p => p.trim().replace(/^["\']|["\']$/g, ""));
    const name = parts[0];
    if (!name || name.toLowerCase() === "store_name" || name.toLowerCase() === "store name") continue;
    doors.push({ door_type: doorType, store_name: name, store_city: parts[1] || "", store_state: parts[2] || "" });
  }
  if (!doors.length) { showToast("No valid rows found in CSV.", "error"); return; }
  try {
    const res = await api("/api/doors", { method: "POST", body: { doors } });
    let msg = `${res.inserted} door${res.inserted !== 1 ? "s" : ""} added`;
    if (res.skipped) msg += `, ${res.skipped} skipped (duplicates)`;
    if (res.bonus_awarded) msg += ` 🎉 +$10 bonus unlocked!`;
    showToast(msg, "success");
    state.doorSectionOpen = true;
    renderRepDashboard();
  } catch (err) { showToast(err.message, "error"); }
};

window.deleteDoor = async function(id) {
  try {
    await api(`/api/doors/${id}`, { method: "DELETE" });
    renderRepDashboard();
  } catch (err) { showToast(err.message, "error"); }
};

/* ── Admin: Door Lists ───────────────────────────────────────── */
async function renderAdminDoors() {
  const content = document.getElementById("admin-content");
  try {
    const data = await api("/api/doors/admin");
    const summary = data.summary || [];
    const doors = data.doors || [];
    const selectedRep = state.adminDoorRepFilter || null;
    const filteredDoors = selectedRep ? doors.filter(d => d.user_id === selectedRep) : doors;

    content.innerHTML = `
      <div class="section-header" style="margin-bottom:var(--sp-4)">
        <h3>Rep Door Lists</h3>
        <button class="btn btn-secondary btn-sm" onclick="exportDoors()">
          <i data-lucide="download" style="width:14px;height:14px"></i> Export CSV
        </button>
      </div>

      <div style="margin-bottom:var(--sp-6)">
        <h4 style="font-size:13px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:var(--sp-3)">By Rep</h4>
        <div class="table-wrapper"><table class="claims-table">
          <thead><tr><th>Rep</th><th>Distributor</th><th>Active</th><th>Target</th><th>Verified</th><th>Bonus</th><th></th></tr></thead>
          <tbody>
            ${summary.length === 0
              ? `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:var(--sp-6)">No doors submitted yet.</td></tr>`
              : summary.map(s => `<tr>
                  <td><strong>${esc(s.rep_name)}</strong></td>
                  <td>${esc(s.distributor_name)}</td>
                  <td style="text-align:center">${s.active_count}</td>
                  <td style="text-align:center">${s.target_count}</td>
                  <td style="text-align:center">${s.verified_count}</td>
                  <td>${s.bonus_earned ? '<span class="badge badge-approved">Paid</span>' : '<span class="badge" style="background:var(--bg-muted)">Pending</span>'}</td>
                  <td><button class="btn btn-secondary btn-sm" onclick="filterAdminDoors('${s.user_id}')">${state.adminDoorRepFilter === s.user_id ? "Hide" : "View"}</button></td>
                </tr>`).join("")}
          </tbody>
        </table></div>
      </div>

      ${selectedRep ? `
        <div class="section-header" style="margin-bottom:var(--sp-3)">
          <h4>${esc(summary.find(s => s.user_id === selectedRep)?.rep_name || "")}'s Doors</h4>
          <button class="btn btn-secondary btn-sm" onclick="filterAdminDoors(null)">Close</button>
        </div>
        <div class="door-type-tabs" style="margin-bottom:var(--sp-3)">
          <button class="door-tab ${state.adminDoorTypeFilter !== 'TARGET' ? 'active' : ''}" onclick="setAdminDoorType('ACTIVE')">Active</button>
          <button class="door-tab ${state.adminDoorTypeFilter === 'TARGET' ? 'active' : ''}" onclick="setAdminDoorType('TARGET')">Target</button>
        </div>
        <div class="table-wrapper"><table class="claims-table" style="font-size:12px">
          <thead><tr><th>Store</th><th>City</th><th>ST</th><th>Verified</th><th>Action</th></tr></thead>
          <tbody>
            ${filteredDoors.filter(d => d.door_type === (state.adminDoorTypeFilter || "ACTIVE")).map(d => `<tr>
              <td>${esc(d.store_name)}</td>
              <td style="color:var(--text-muted)">${esc(d.store_city||"")}</td>
              <td style="color:var(--text-muted)">${esc(d.store_state||"")}</td>
              <td style="text-align:center">${d.verified ? '<span style="color:#16a34a;font-weight:600">✓</span>' : '—'}</td>
              <td>
                <button class="btn btn-secondary btn-sm" onclick="toggleDoorVerify('${d.id}',${d.verified ? 0 : 1})">
                  ${d.verified ? "Unverify" : "Verify"}
                </button>
              </td>
            </tr>`).join("")}
          </tbody>
        </table></div>` : ""}`;

    lucide.createIcons();
  } catch (err) { showToast(err.message, "error"); }
}

window.filterAdminDoors = function(userId) {
  state.adminDoorRepFilter = state.adminDoorRepFilter === userId ? null : userId;
  state.adminDoorTypeFilter = "ACTIVE";
  renderAdminDoors();
};

window.setAdminDoorType = function(type) {
  state.adminDoorTypeFilter = type;
  renderAdminDoors();
};

window.toggleDoorVerify = async function(id, verified) {
  try {
    await api(`/api/doors/${id}/verify`, { method: "PUT", body: { verified: !!verified } });
    renderAdminDoors();
  } catch (err) { showToast(err.message, "error"); }
};

window.exportDoors = async function() {
  try {
    const blob = await api("/api/doors/export");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `sesh_doors_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  } catch (err) { showToast(err.message, "error"); }
};

/* ── Rep: POP / Sample Requests ─────────────────────────────── */
const POP_REQUEST_TYPES = [
  "POP Display","Shelf Talker","Product Samples","Counter Display","Window Cling","Door Strike"
];
const POP_STATUS_STYLE = {
  PENDING:     { badge: "badge-pending",  label: "Submitted" },
  IN_PROGRESS: { badge: "badge-type",     label: "In Progress" },
  FULFILLED:   { badge: "badge-approved", label: "Fulfilled" },
  DECLINED:    { badge: "badge-rejected", label: "Declined" },
};

async function renderRepRequests() {
  app.innerHTML = `${headerHTML()}${repNavHTML("requests")}<main class="app-main has-bottom-nav"><div class="loading-spinner"><div class="spinner"></div></div></main>`;
  lucide.createIcons();
  try {
    const [requests, stores] = await Promise.all([
      api("/api/pop-requests"),
      api("/api/my-stores"),
    ]);

    const storeListId = "store-datalist-" + Date.now();
    const storeDatalist = `<datalist id="${storeListId}">${stores.map(s => `<option value="${esc(s.store_name)}" data-city="${esc(s.store_city || '')}" data-state="${esc(s.store_state || '')}"></option>`).join("")}</datalist>`;

    const main = app.querySelector(".app-main");
    main.innerHTML = `
      <div class="section-header" style="margin-bottom:var(--sp-5)">
        <h3>POP &amp; Sample Requests</h3>
      </div>

      <div class="claim-form-wrapper" style="margin-bottom:var(--sp-8)">
        <h4 style="font-size:13px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:var(--sp-4)">New Request</h4>
        <form id="pop-form">
          ${storeDatalist}
          <div class="form-group">
            <label>Request Type *</label>
            <div class="claim-type-toggle" id="pop-type-toggle" style="grid-template-columns:repeat(3,1fr);gap:var(--sp-2)">
              ${POP_REQUEST_TYPES.map((t, i) => `
                <div class="claim-type-btn ${i === 0 ? "active" : ""}" data-pop-type="${esc(t)}" onclick="selectPopType(this)" style="padding:var(--sp-3) var(--sp-2)">
                  <div class="type-label" style="font-size:12px;line-height:1.3">${esc(t)}</div>
                </div>`).join("")}
            </div>
          </div>
          <div class="form-group">
            <label>Store Name *</label>
            <input type="text" class="form-input" id="pop-store" placeholder="Quick Stop Market" required autocomplete="off" list="${storeListId}" oninput="autofillPopStore(this)">
          </div>
          <div class="form-row">
            <div class="form-group"><label>City</label><input type="text" class="form-input" id="pop-city" placeholder="Seattle"></div>
            <div class="form-group"><label>State</label>${stateSelectHTML().replace('id="store-state"','id="pop-state"')}</div>
          </div>
          <div class="form-group">
            <label>Quantity</label>
            <input type="number" class="form-input" id="pop-qty" min="1" max="99" value="1">
          </div>
          <div class="form-group">
            <label>Notes <span style="color:var(--text-muted);font-weight:400">(optional)</span></label>
            <textarea class="form-input" id="pop-notes" rows="2" placeholder="Specific placement, account context, etc." style="resize:vertical;min-height:64px"></textarea>
          </div>
          <button type="submit" class="btn btn-primary btn-block" id="pop-submit-btn">
            <i data-lucide="send" style="width:16px;height:16px"></i> Submit Request
          </button>
        </form>
      </div>

      <div class="section-header" style="margin-bottom:var(--sp-4)">
        <h3>My Requests</h3>
      </div>
      ${requests.length === 0
        ? `<div class="empty-state"><i data-lucide="package" style="width:48px;height:48px"></i><h4>No requests yet</h4><p>Submit your first POP or sample request above.</p></div>`
        : `<div class="table-wrapper"><table class="claims-table">
            <thead><tr><th>Date</th><th>Type</th><th>Store</th><th>Qty</th><th>Status</th></tr></thead>
            <tbody>
              ${requests.map(r => {
                const s = POP_STATUS_STYLE[r.status] || POP_STATUS_STYLE.PENDING;
                return `<tr>
                  <td style="white-space:nowrap">${fmtDate(r.created_at?.split("T")[0] || r.created_at?.slice(0,10))}</td>
                  <td><span class="badge badge-type">${esc(r.request_type)}</span></td>
                  <td>${esc(r.store_name)}<br><span style="font-size:11px;color:var(--text-muted)">${esc(r.store_city || "")}${r.store_city && r.store_state ? ", " : ""}${esc(r.store_state || "")}</span></td>
                  <td style="text-align:center">${r.quantity}</td>
                  <td>
                    <span class="badge ${s.badge}">${s.label}</span>
                    ${r.admin_note ? `<br><span style="font-size:10px;color:var(--text-muted)">${esc(r.admin_note)}</span>` : ""}
                  </td>
                </tr>`;
              }).join("")}
            </tbody>
          </table></div>`}`;

    lucide.createIcons();

    // Store autofill from datalist selection
    window._popStores = stores;

    document.getElementById("pop-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("pop-submit-btn");
      const activeType = document.querySelector(".claim-type-btn.active[data-pop-type]")?.dataset.popType;
      if (!activeType) { showToast("Select a request type.", "error"); return; }
      const storeName = document.getElementById("pop-store").value.trim();
      if (!storeName) { showToast("Store name is required.", "error"); return; }
      btn.disabled = true; btn.lastChild.textContent = " Submitting...";
      try {
        await api("/api/pop-requests", { method: "POST", body: {
          request_type: activeType,
          store_name: storeName,
          store_city: document.getElementById("pop-city").value.trim(),
          store_state: document.getElementById("pop-state").value,
          quantity: parseInt(document.getElementById("pop-qty").value, 10) || 1,
          notes: document.getElementById("pop-notes").value.trim(),
        }});
        showToast("Request submitted ✓", "success");
        renderRepRequests();
      } catch (err) { showToast(err.message, "error"); btn.disabled = false; btn.lastChild.textContent = " Submit Request"; }
    });

  } catch (err) { showToast(err.message, "error"); }
}

window.selectPopType = function(el) {
  document.querySelectorAll(".claim-type-btn[data-pop-type]").forEach(b => b.classList.remove("active"));
  el.classList.add("active");
};

window.autofillPopStore = function(input) {
  const stores = window._popStores || [];
  const match = stores.find(s => s.store_name.toLowerCase() === input.value.toLowerCase());
  if (match) {
    const cityEl = document.getElementById("pop-city");
    const stateEl = document.getElementById("pop-state");
    if (cityEl && match.store_city) cityEl.value = match.store_city;
    if (stateEl && match.store_state) stateEl.value = match.store_state;
  }
};

/* ── Admin: POP / Sample Requests ───────────────────────────── */
async function renderAdminRequests() {
  const content = document.getElementById("admin-content");
  try {
    const [requests, stats] = await Promise.all([
      api("/api/pop-requests"),
      api("/api/pop-requests/admin-stats").catch(() => ({ total:0, pending:0, in_progress:0, fulfilled:0, declined:0 })),
    ]);

    content.innerHTML = `
      <div class="stats-grid" style="margin-bottom:var(--sp-6)">
        <div class="stat-card"><div class="stat-label">Pending</div><div class="stat-value" style="color:var(--pending)">${stats.pending || 0}</div></div>
        <div class="stat-card"><div class="stat-label">In Progress</div><div class="stat-value teal">${stats.in_progress || 0}</div></div>
        <div class="stat-card"><div class="stat-label">Fulfilled</div><div class="stat-value green">${stats.fulfilled || 0}</div></div>
        <div class="stat-card"><div class="stat-label">Total</div><div class="stat-value">${stats.total || 0}</div></div>
      </div>
      <div class="section-header" style="margin-bottom:var(--sp-4)"><h3>POP &amp; Sample Requests</h3></div>
      ${requests.length === 0
        ? `<div class="empty-state"><i data-lucide="package" style="width:48px;height:48px"></i><h4>No requests yet</h4><p>Requests from reps will appear here.</p></div>`
        : `<div class="table-wrapper"><table class="claims-table">
            <thead><tr><th>Date</th><th>Rep</th><th>Distributor</th><th>Type</th><th>Store</th><th>Qty</th><th>Notes</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              ${requests.map(r => {
                const s = POP_STATUS_STYLE[r.status] || POP_STATUS_STYLE.PENDING;
                return `<tr>
                  <td style="white-space:nowrap">${fmtDate(r.created_at?.split("T")[0] || r.created_at?.slice(0,10))}</td>
                  <td><strong>${esc(r.rep_name)}</strong><br><span style="font-size:11px;color:var(--text-muted)">${esc(r.rep_email)}</span></td>
                  <td>${esc(r.distributor_name)}</td>
                  <td><span class="badge badge-type">${esc(r.request_type)}</span></td>
                  <td>${esc(r.store_name)}<br><span style="font-size:11px;color:var(--text-muted)">${esc(r.store_city || "")}${r.store_city && r.store_state ? ", " : ""}${esc(r.store_state || "")}</span></td>
                  <td style="text-align:center">${r.quantity}</td>
                  <td style="max-width:160px;font-size:12px;color:var(--text-muted)">${esc(r.notes || "—")}</td>
                  <td>
                    <span class="badge ${s.badge}">${s.label}</span>
                    ${r.admin_note ? `<br><span style="font-size:10px;color:var(--text-muted)">${esc(r.admin_note)}</span>` : ""}
                  </td>
                  <td>
                    ${r.status !== "FULFILLED" && r.status !== "DECLINED" ? `
                    <div class="claim-actions">
                      ${r.status === "PENDING" ? `<button class="btn btn-secondary btn-sm" onclick="updatePopRequest('${r.id}','IN_PROGRESS')">In Progress</button>` : ""}
                      ${r.status !== "FULFILLED" ? `<button class="btn btn-success btn-sm" onclick="updatePopRequest('${r.id}','FULFILLED')">Fulfill</button>` : ""}
                      <button class="btn btn-danger btn-sm" onclick="declinePopRequestPrompt('${r.id}')">Decline</button>
                    </div>` : "—"}
                  </td>
                </tr>`;
              }).join("")}
            </tbody>
          </table></div>`}`;

    lucide.createIcons();
  } catch (err) { showToast(err.message, "error"); }
}

window.updatePopRequest = async function(id, status, adminNote) {
  try {
    await api(`/api/pop-requests/${id}`, { method: "PUT", body: { status, admin_note: adminNote || null } });
    showToast(status === "FULFILLED" ? "Marked as fulfilled ✓" : "Status updated", "success");
    renderAdminRequests();
  } catch (err) { showToast(err.message, "error"); }
};

window.declinePopRequestPrompt = function(id) {
  const modal = document.createElement("div"); modal.className = "modal-overlay";
  modal.innerHTML = `<div class="modal-card"><h3>Decline Request</h3>
    <div class="form-group"><label>Reason (optional)</label><input type="text" class="form-input" id="decline-note" placeholder="e.g. Out of stock, check back next month"></div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
      <button class="btn btn-danger" onclick="updatePopRequest('${id}','DECLINED',document.getElementById('decline-note')?.value);this.closest('.modal-overlay').remove()">Decline</button>
    </div></div>`;
  document.body.appendChild(modal);
};

/* ── Init ───────────────────────────────────────────────────── */
render();

/* ── Rep Notes ───────────────────────────────────────────────── */
let _scratchpadTimer = null;

async function renderRepNotes() {
  app.innerHTML = `${headerHTML()}${repNavHTML("notes")}<main class="app-main has-bottom-nav"><div class="loading-spinner"><div class="spinner"></div></div></main>`;
  lucide.createIcons();
  try {
    const [scratch, notesData] = await Promise.all([
      api("/api/notes/scratchpad").catch(() => ({ content: "" })),
      api("/api/notes/stores").catch(() => ({ notes: [], stores: [] })),
    ]);

    const notes  = notesData.notes  || [];
    const stores = notesData.stores || [];

    // Group store notes by store_name
    const byStore = {};
    for (const n of notes) {
      if (!byStore[n.store_name]) byStore[n.store_name] = [];
      byStore[n.store_name].push(n);
    }
    const storeNames = Object.keys(byStore).sort();

    // Active store filter
    const activeStore = state.notesStoreFilter || null;
    const storeListId = "notes-store-datalist";

    const main = app.querySelector(".app-main");
    main.innerHTML = `
      <div class="section-header" style="margin-bottom:var(--sp-5)">
        <h3>Notes</h3>
      </div>

      <!-- Scratchpad -->
      <div class="notes-section-card">
        <div class="notes-section-label">
          <i data-lucide="pencil-line" style="width:15px;height:15px"></i>
          General Scratchpad
          <span id="scratch-status" class="scratch-status"></span>
        </div>
        <textarea
          id="scratchpad-area"
          class="form-input scratchpad-textarea"
          placeholder="Quick thoughts, follow-ups, anything on your mind…"
          rows="5"
        >${esc(scratch.content || "")}</textarea>
      </div>

      <!-- Store Notes -->
      <div class="notes-section-card" style="margin-top:var(--sp-5)">
        <div class="notes-section-label">
          <i data-lucide="store" style="width:15px;height:15px"></i>
          Account Notes
        </div>

        <!-- Add note form -->
        <div class="store-note-add-row">
          <datalist id="${storeListId}">
            ${stores.map(s => `<option value="${esc(s)}"></option>`).join("")}
          </datalist>
          <input type="text" class="form-input" id="note-store-input"
            placeholder="Store name" list="${storeListId}"
            style="flex:1;min-width:0">
          <textarea class="form-input" id="note-text-input"
            placeholder="Note…" rows="2"
            style="flex:2;min-width:0;resize:vertical;min-height:60px"></textarea>
          <button class="btn btn-primary btn-sm" style="align-self:flex-end" onclick="addStoreNote()">
            <i data-lucide="plus" style="width:14px;height:14px"></i> Add
          </button>
        </div>

        <!-- Filter pills -->
        ${storeNames.length > 0 ? `
        <div class="store-filter-row" id="store-filter-row">
          <button class="store-pill ${!activeStore ? "active" : ""}" onclick="filterNoteStore(null)">All</button>
          ${storeNames.map(s => `
            <button class="store-pill ${activeStore === s ? "active" : ""}" onclick="filterNoteStore(${JSON.stringify(s)})">
              ${esc(s)} <span class="store-pill-count">${byStore[s].length}</span>
            </button>`).join("")}
        </div>` : ""}

        <!-- Notes log -->
        <div id="store-notes-log">
          ${storeNames.length === 0
            ? `<div style="text-align:center;padding:var(--sp-6);color:var(--text-muted);font-size:13px">No account notes yet — add one above.</div>`
            : (activeStore ? [activeStore] : storeNames).map(store => `
              <div class="store-note-group">
                <div class="store-note-group-header">
                  <i data-lucide="store" style="width:13px;height:13px"></i>
                  ${esc(store)}
                  <span class="store-pill-count" style="margin-left:var(--sp-2)">${byStore[store].length}</span>
                </div>
                ${byStore[store].map(n => `
                  <div class="store-note-entry" id="note-${n.id}">
                    <div class="store-note-text">${esc(n.note)}</div>
                    <div class="store-note-meta">
                      <span>${fmtNoteDate(n.created_at)}</span>
                      <button class="btn-icon-sm" onclick="deleteStoreNote('${n.id}')" title="Delete note">
                        <i data-lucide="trash-2" style="width:12px;height:12px"></i>
                      </button>
                    </div>
                  </div>`).join("")}
              </div>`).join("")}
        </div>
      </div>`;

    lucide.createIcons();

    // Scratchpad autosave
    document.getElementById("scratchpad-area").addEventListener("input", function() {
      const status = document.getElementById("scratch-status");
      if (status) { status.textContent = "saving…"; status.className = "scratch-status saving"; }
      clearTimeout(_scratchpadTimer);
      _scratchpadTimer = setTimeout(async () => {
        try {
          await api("/api/notes/scratchpad", { method: "PUT", body: { content: this.value } });
          const s = document.getElementById("scratch-status");
          if (s) { s.textContent = "saved"; s.className = "scratch-status saved"; setTimeout(() => { if(s) s.textContent = ""; }, 2000); }
        } catch (e) { /* silent */ }
      }, 800);
    });

  } catch (err) { showToast(err.message || "Failed to load notes", "error"); }
}

function fmtNoteDate(d) {
  if (!d) return "";
  const dt = new Date(d.includes("T") ? d : d + "Z");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " · " + dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

window.filterNoteStore = function(store) {
  state.notesStoreFilter = store;
  renderRepNotes();
};

window.addStoreNote = async function() {
  const storeName = document.getElementById("note-store-input")?.value.trim();
  const noteText  = document.getElementById("note-text-input")?.value.trim();
  if (!storeName) { showToast("Store name required.", "error"); return; }
  if (!noteText)  { showToast("Note cannot be empty.", "error"); return; }
  try {
    await api("/api/notes/stores", { method: "POST", body: { store_name: storeName, note: noteText } });
    state.notesStoreFilter = storeName;
    renderRepNotes();
  } catch (err) { showToast(err.message, "error"); }
};

window.deleteStoreNote = async function(id) {
  try {
    await api(`/api/notes/stores/${id}`, { method: "DELETE" });
    renderRepNotes();
  } catch (err) { showToast(err.message, "error"); }
};

/* ── Admin Notes ─────────────────────────────────────────────── */
async function renderAdminNotes() {
  const content = document.getElementById("admin-content");
  try {
    const data = await api("/api/notes/admin");
    const scratchpads  = data.scratchpads  || [];
    const storeNotes   = data.store_notes  || [];

    // Group store notes by rep
    const notesByRep = {};
    for (const n of storeNotes) {
      const key = n.user_id;
      if (!notesByRep[key]) notesByRep[key] = { rep_name: n.rep_name, distributor_name: n.distributor_name, notes: [] };
      notesByRep[key].notes.push(n);
    }
    const repIds = Object.keys(notesByRep);

    content.innerHTML = `
      <div class="section-header" style="margin-bottom:var(--sp-6)"><h3>Rep Notes</h3></div>

      <!-- Scratchpads -->
      <h4 class="admin-notes-section-title">General Scratchpads</h4>
      ${scratchpads.length === 0
        ? `<p style="color:var(--text-muted);font-size:13px;margin-bottom:var(--sp-6)">No scratchpad content yet.</p>`
        : scratchpads.map(s => `
          <div class="admin-note-card">
            <div class="admin-note-card-header">
              <strong>${esc(s.rep_name)}</strong>
              <span style="color:var(--text-muted);font-size:12px">${esc(s.distributor_name || "")}</span>
              <span style="color:var(--text-muted);font-size:11px;margin-left:auto">Updated ${fmtNoteDate(s.updated_at)}</span>
            </div>
            <div class="admin-note-card-body">${esc(s.content)}</div>
          </div>`).join("")}

      <!-- Store Notes by rep -->
      <h4 class="admin-notes-section-title" style="margin-top:var(--sp-6)">Account Notes</h4>
      ${repIds.length === 0
        ? `<p style="color:var(--text-muted);font-size:13px">No account notes yet.</p>`
        : repIds.map(uid => {
            const rep = notesByRep[uid];
            const byStore = {};
            for (const n of rep.notes) {
              if (!byStore[n.store_name]) byStore[n.store_name] = [];
              byStore[n.store_name].push(n);
            }
            return `
              <div class="admin-note-card">
                <div class="admin-note-card-header">
                  <strong>${esc(rep.rep_name)}</strong>
                  <span style="color:var(--text-muted);font-size:12px">${esc(rep.distributor_name || "")}</span>
                  <span style="color:var(--text-muted);font-size:11px;margin-left:auto">${rep.notes.length} note${rep.notes.length !== 1 ? "s" : ""}</span>
                </div>
                ${Object.entries(byStore).map(([store, notes]) => `
                  <div class="store-note-group" style="margin:var(--sp-3) 0 0">
                    <div class="store-note-group-header">
                      <i data-lucide="store" style="width:13px;height:13px"></i> ${esc(store)}
                    </div>
                    ${notes.map(n => `
                      <div class="store-note-entry">
                        <div class="store-note-text">${esc(n.note)}</div>
                        <div class="store-note-meta"><span>${fmtNoteDate(n.created_at)}</span></div>
                      </div>`).join("")}
                  </div>`).join("")}
              </div>`;
          }).join("")}`;

    lucide.createIcons();
  } catch (err) { showToast(err.message, "error"); }
}

/* ── Admin Health ─────────────────────────────────────────────── */
async function renderAdminHealth() {
  const content = document.getElementById("admin-content");
  try {
    const reps = await api("/api/stats/health");

    const flagged = reps.filter(r => r.is_flagged);
    const healthy = reps.filter(r => !r.is_flagged);

    const flagLabel = f => {
      if (f === "never_active") return `<span class="badge" style="background:#fee2e2;color:#dc2626">Never active</span>`;
      if (f === "gone_quiet") return `<span class="badge" style="background:#fef3c7;color:#d97706">Gone quiet</span>`;
      if (f === "no_reorders") return `<span class="badge" style="background:#ede9fe;color:#7c3aed">No reorders</span>`;
      return "";
    };

    const repRow = r => `<tr>
      <td><strong>${esc(r.rep_name)}</strong><br><span style="font-size:11px;color:var(--text-muted)">${esc(r.rep_email)}</span></td>
      <td style="font-size:12px">${esc(r.distributor_name || "—")}</td>
      <td style="text-align:center">${r.last_claim_date ? fmtDate(r.last_claim_date) : "<span style='color:var(--text-muted)'>—</span>"}</td>
      <td style="text-align:center">${r.days_since_last_claim != null ? r.days_since_last_claim + "d" : "—"}</td>
      <td style="text-align:center">${r.new_door_stores}</td>
      <td style="text-align:center">${r.reorder_stores}</td>
      <td style="text-align:center">${fmtCurrency(r.total_earned)}</td>
      <td>${(r.flags || []).map(flagLabel).join(" ")}</td>
    </tr>`;

    content.innerHTML = `
      <div class="section-header" style="margin-bottom:var(--sp-4)">
        <h3>Account Health</h3>
        <span style="font-size:13px;color:var(--text-muted)">${flagged.length} flagged &middot; ${healthy.length} healthy</span>
      </div>

      ${flagged.length > 0 ? `
      <h4 style="font-size:13px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:var(--sp-3)">
        ⚠️ Needs Attention (${flagged.length})
      </h4>
      <div class="table-wrapper" style="margin-bottom:var(--sp-6)">
        <table class="claims-table">
          <thead><tr><th>Rep</th><th>Distributor</th><th>Last Claim</th><th>Days Ago</th><th>New Doors</th><th>Reorders</th><th>Earned</th><th>Flags</th></tr></thead>
          <tbody>${flagged.map(repRow).join("")}</tbody>
        </table>
      </div>` : `<p style="color:#16a34a;font-weight:600;margin-bottom:var(--sp-6)">✓ All reps are active — no flags.</p>`}

      ${healthy.length > 0 ? `
      <h4 style="font-size:13px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:var(--sp-3)">
        Healthy Reps (${healthy.length})
      </h4>
      <div class="table-wrapper">
        <table class="claims-table">
          <thead><tr><th>Rep</th><th>Distributor</th><th>Last Claim</th><th>Days Ago</th><th>New Doors</th><th>Reorders</th><th>Earned</th><th>Flags</th></tr></thead>
          <tbody>${healthy.map(repRow).join("")}</tbody>
        </table>
      </div>` : ""}`;

    lucide.createIcons();
  } catch (err) { showToast(err.message, "error"); }
}
