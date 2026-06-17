// ========== 网络智慧教务平台 - 主应用 ==========
// 所有数据存储在 localStorage 中，便于本地演示和持久化

// ========== 工具函数 ==========
const $ = (id) => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
const fmt = (n, d = 2) => (isFinite(n) ? Number(n).toFixed(d) : "-");
const fmtPct = (n) => (isFinite(n) ? (n * 100).toFixed(2) + "%" : "-");

// HTML 转义，防止特殊字符破坏页面结构
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function showToast(msg, type = "info", duration = 2500) {
  const toast = $("toast");
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), duration);
}

function showModal(title, bodyHtml, okText = "确定", onOk) {
  $("modalTitle").textContent = title;
  $("modalBody").innerHTML = bodyHtml;
  $("modalOk").textContent = okText;
  $("modal").classList.remove("hidden");
  $("modalOk").onclick = () => {
    if (onOk) { const r = onOk(); if (r !== false) $("modal").classList.add("hidden"); }
    else $("modal").classList.add("hidden");
  };
}
function closeModal() { $("modal").classList.add("hidden"); }
$("modalClose").onclick = closeModal;

// ========== 数据管理 ==========
const DB_KEY = "smart_edu_platform_db_v1";

let _skipGitHubSync = false; // 防止循环

async function loadDB() {
  // 优先尝试从 GitHub 加载
  if (GitHubService.isConfigured()) {
    const remote = await GitHubService.loadRemoteDB();
    if (remote) {
      localStorage.setItem(DB_KEY, JSON.stringify(remote));
      return remote;
    }
  }
  // 回退到本地存储
  let db = localStorage.getItem(DB_KEY);
  if (!db) {
    db = initDefaultDB();
    // 如果 GitHub 已配置，同步默认数据上去
    if (GitHubService.isConfigured()) {
      _skipGitHubSync = true;
      await GitHubService.tryInitFile(db);
      _skipGitHubSync = false;
    }
    saveDB(db);
  } else {
    try { db = JSON.parse(db); }
    catch (e) { db = initDefaultDB(); saveDB(db); }
  }
  return db;
}

function saveDB(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  // 同时同步到 GitHub
  if (GitHubService.isConfigured() && !_skipGitHubSync) {
    GitHubService.saveRemoteDB(db); // 非阻塞，不等待
  }
}

function initDefaultDB() {
  return {
    users: [
      { id: "u_admin", username: "admin", password: "123456", name: "超级管理员", role: "admin", grade: null, classNo: null, createdAt: Date.now() },
      { id: "u_aca",   username: "academic", password: "123456", name: "张教务", role: "academic", grade: "高一年级", classNo: null, createdAt: Date.now() },
      { id: "u_tch",   username: "teacher", password: "123456", name: "李老师", role: "teacher", grade: "高一年级", classNo: null, subjects: ["数学"], createdAt: Date.now() },
      { id: "u_ht",    username: "headteacher", password: "123456", name: "王班主任", role: "headteacher", grade: "高一年级", classNo: "1班", createdAt: Date.now() }
    ],
    subjects: {
      "高一年级": [
        { name: "语文", fullScore: 150, excellent: 120, good: 105, pass: 90, low: 60 },
        { name: "数学", fullScore: 150, excellent: 120, good: 105, pass: 90, low: 60 },
        { name: "英语", fullScore: 150, excellent: 120, good: 105, pass: 90, low: 60 },
        { name: "物理", fullScore: 100, excellent: 85, good: 75, pass: 60, low: 40 },
        { name: "化学", fullScore: 100, excellent: 85, good: 75, pass: 60, low: 40 }
      ]
    },
    exams: [
      { id: "e_demo1", name: "2024学年第一学期期中考试", grade: "高一年级", date: "2024-11-10", createdAt: Date.now() }
    ],
    records: [],
    sends: [],
    announcements: [],
    rankSends: []
  };
}

let DB = null;
let currentUser = null;
let currentPage = null;

// ========== 角色与权限 ==========
const ROLE_NAMES = {
  admin: "管理员",
  academic: "教务老师",
  teacher: "任课教师",
  headteacher: "班主任"
};

const NAV_MENUS = {
  admin: [
    { id: "dashboard", icon: "📊", text: "平台概览" },
    { id: "users", icon: "👥", text: "教师名单管理" },
    { id: "grades", icon: "🏫", text: "年级设置" },
    { id: "permissions", icon: "🔐", text: "权限管理" },
    { id: "exams", icon: "📝", text: "考试管理" },
    { id: "announcements_all", icon: "📢", text: "公告管理" },
    { id: "github_data", icon: "🔗", text: "GitHub 数据管理" }
  ],
  academic: [
    { id: "dashboard", icon: "📊", text: "工作首页" },
    { id: "subjects", icon: "📚", text: "学科/分值设置" },
    { id: "exams", icon: "📝", text: "考试管理" },
    { id: "grade_summary", icon: "📈", text: "年级成绩汇总" },
    { id: "class_ranking", icon: "🏆", text: "全年级排名" },
    { id: "teacher_ranking", icon: "🎖️", text: "教师排行榜" },
    { id: "send_scores", icon: "📨", text: "发送班级成绩" },
    { id: "send_rank", icon: "📤", text: "发送教师排行" },
    { id: "announcement", icon: "📢", text: "消息播报" },
    { id: "academic_analysis", icon: "🔍", text: "全平台智能分析" }
  ],
  teacher: [
    { id: "dashboard", icon: "📊", text: "工作首页" },
    { id: "my_scores", icon: "📖", text: "我的班级成绩" },
    { id: "my_ranking", icon: "🏅", text: "我的排行信息" },
    { id: "teacher_analysis", icon: "🔍", text: "学科对比分析" }
  ],
  headteacher: [
    { id: "dashboard", icon: "📊", text: "工作首页" },
    { id: "upload_scores", icon: "📥", text: "上传班级成绩" },
    { id: "my_class_scores", icon: "📖", text: "本班考试成绩" },
    { id: "class_ranking", icon: "🏆", text: "本班排名统计" },
    { id: "download_scores", icon: "📤", text: "下载Excel成绩" },
    { id: "headteacher_analysis", icon: "🔍", text: "本班智能对比分析" }
  ]
};

// ========== 登录 ==========
// 读取记住的账号密码
const savedUser = localStorage.getItem("saved_user");
if (savedUser) {
  try {
    const { username, password, role } = JSON.parse(savedUser);
    $("loginUsername").value = username || "";
    $("loginPassword").value = password || "";
    $("loginRole").value = role || "admin";
    $("rememberMe").checked = true;
  } catch (e) {}
}

$("loginBtn").onclick = doLogin;
$("loginPassword").addEventListener("keypress", (e) => { if (e.key === "Enter") doLogin(); });
$("logoutBtn").onclick = doLogout;

async function doLogin() {
  const username = $("loginUsername").value.trim();
  const password = $("loginPassword").value.trim();
  const role = $("loginRole").value;

  if (!username || !password) {
    $("loginError").textContent = "请输入账号和密码";
    return;
  }

  // 确保 DB 已加载
  if (!DB) {
    $("loginError").textContent = "正在加载数据...";
    try {
      DB = await loadDB();
    } catch (e) {
      $("loginError").textContent = "数据加载失败，请刷新重试";
      return;
    }
  }

  const user = DB.users.find((u) => u.username === username && u.password === password && u.role === role);
  if (!user) {
    $("loginError").textContent = "账号、密码或角色不正确";
    return;
  }
  $("loginError").textContent = "";
  currentUser = user;
  sessionStorage.setItem("current_user_id", user.id);

  // 记住密码
  if ($("rememberMe").checked) {
    localStorage.setItem("saved_user", JSON.stringify({ username, password, role }));
  } else {
    localStorage.removeItem("saved_user");
  }

  enterApp();
}

function doLogout() {
  currentUser = null;
  sessionStorage.removeItem("current_user_id");
  $("mainApp").classList.add("hidden");
  $("loginPage").classList.remove("hidden");
  $("loginUsername").value = "";
  $("loginPassword").value = "";
}

function enterApp() {
  $("loginPage").classList.add("hidden");
  $("mainApp").classList.remove("hidden");
  renderUserInfo();
  renderNavMenu();
  renderAnnouncement();
  renderSyncStatus();
  navigate("dashboard");
}

// ========== GitHub 同步状态 ==========
function renderSyncStatus() {
  // 顶部栏右侧追加同步状态
  const statusDiv = document.createElement("div");
  statusDiv.id = "sync-status";
  statusDiv.style.cssText = "display:flex;align-items:center;gap:10px";
  statusDiv.innerHTML = `
    <span id="sync-badge" style="font-size:12px;padding:4px 10px;background:#f0f4ff;border-radius:12px;color:#3b7ddd">🔗 未连接</span>
    <button class="btn btn-sm btn-outline" id="btn-github-setup" onclick="openGithubSetup()">⚙️ GitHub 配置</button>
  `;
  document.querySelector(".topbar-right").insertBefore(statusDiv, document.querySelector(".topbar-right").firstChild);
  updateSyncBadge();
}

function updateSyncBadge() {
  const badge = $("sync-badge");
  if (!badge) return;
  const gs = window.GitHubService;
  if (!gs) return;
  badge.innerHTML = gs.getStatusHTML();
}

window.openGithubSetup = function () {
  GitHubService.showSetupModal(() => {
    updateSyncBadge();
    if (DB) GitHubService.saveRemoteDB(DB);
  });
};

// ========== GitHub 数据管理页面 ==========
function renderGithubData() {
  if (currentUser.role !== "admin") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const gs = window.GitHubService;
  const cfg = gs.config;
  const log = gs.syncLog;

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">🔗 GitHub 数据仓库配置</div>
      <div class="form-row">
        <div class="form-group"><label>GitHub Token</label><input type="password" id="gd_token" value="${cfg.token || ""}" placeholder="ghp_xxxxx" /></div>
        <div class="form-group"><label>仓库所有者</label><input id="gd_owner" value="${cfg.owner || ""}" placeholder="GitHub 用户名" /></div>
        <div class="form-group"><label>仓库名称</label><input id="gd_repo" value="${cfg.repo || ""}" placeholder="repo-name" /></div>
        <div class="form-group"><label>分支</label><input id="gd_branch" value="${cfg.branch || "main"}" placeholder="main" /></div>
        <div class="form-group"><label>文件路径</label><input id="gd_path" value="${cfg.dbPath || "data/db.json"}" placeholder="data/db.json" /></div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-success" id="gd_save">💾 保存配置</button>
        <button class="btn btn-primary" id="gd_sync_now">🔄 立即同步到 GitHub</button>
        <button class="btn btn-info" id="gd_load">📥 从 GitHub 拉取数据</button>
        <button class="btn btn-secondary" id="gd_test">🧪 测试连接</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">📊 同步状态</div>
      <div id="gd_sync_info" style="padding:12px;background:#f8f9fc;border-radius:8px;font-size:13px;color:var(--text-light)">
        <p>• 当前状态：${gs.isConfigured() ? `<b style="color:var(--success)">✅ 已配置（${cfg.owner}/${cfg.repo}）</b>` : `<b style="color:var(--danger)">⚠️ 未配置</b>`}</p>
        <p>• Token：${cfg.token ? "✅ 已设置" : "❌ 未设置"}</p>
        <p>• 数据文件：<code>${cfg.dbPath || "未设置"}</code></p>
      </div>
    </div>

    <div class="card">
      <div class="card-title">📋 同步日志（最近 20 条）</div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>时间</th><th>类型</th><th>消息</th></tr></thead>
        <tbody>${log.map((l) => `<tr>
          <td>${l.time}</td>
          <td><span class="badge badge-${l.type === "success" ? "success" : l.type === "error" ? "danger" : l.type === "warn" ? "warning" : "primary"}">${l.type}</span></td>
          <td>${l.msg}</td>
        </tr>`).join("") || `<tr><td colspan="3"><div class="empty-state"><div class="es-tip">暂无日志</div></div></td></tr>`}</tbody>
      </table></div>
    </div>

    <div class="card">
      <div class="card-title">⚠️ 安全说明</div>
      <div class="analysis-text">
        <h4>⚠️ 安全风险提示</h4>
        <p>• 将 GitHub Token 放在前端代码中存在被他人获取的风险。</p>
        <p>• 建议 Token 权限设置为 <b>最小权限</b>（仅给指定的单个仓库读写权限，禁用其他权限）。</p>
        <p>• 建议尽快在 GitHub 设置中 <b>撤销此 Token</b>，并定期更换。</p>
        <p>• 生产环境推荐通过后端服务器持有 Token，前端仅调用接口。</p>
      </div>
    </div>
  `;

  $("gd_save").onclick = () => {
    const token = $("gd_token").value.trim();
    const owner = $("gd_owner").value.trim();
    const repo = $("gd_repo").value.trim();
    const branch = $("gd_branch").value.trim() || "main";
    const dbPath = $("gd_path").value.trim() || "data/db.json";
    if (token) {
      localStorage.setItem("gh_token", token);
      cfg.token = token;
    }
    localStorage.setItem("gh_owner", owner);
    localStorage.setItem("gh_repo", repo);
    localStorage.setItem("gh_branch", branch);
    localStorage.setItem("gh_path", dbPath);
    cfg.owner = owner;
    cfg.repo = repo;
    cfg.branch = branch;
    cfg.dbPath = dbPath;
    GitHubService.config = cfg;
    showToast("配置已保存到你的浏览器", "success");
    updateSyncBadge();
    renderGithubData();
  };

  $("gd_sync_now").onclick = async () => {
    if (!DB) { showToast("请先登录", "error"); return; }
    const ok = await gs.saveRemoteDB(DB);
    if (ok) showToast("同步成功", "success");
    renderGithubData();
  };

  $("gd_load").onclick = async () => {
    const remote = await gs.loadRemoteDB();
    if (remote) {
      DB = remote;
      localStorage.setItem(DB_KEY, JSON.stringify(remote));
      showToast("拉取成功，数据已更新", "success");
      navigate("dashboard");
    }
    renderGithubData();
  };

  $("gd_test").onclick = async () => {
    const tempToken = $("gd_token").value.trim();
    const tempOwner = $("gd_owner").value.trim();
    const tempRepo = $("gd_repo").value.trim();
    if (!tempToken || !tempOwner || !tempRepo) { showToast("请先填写 Token、用户名和仓库名", "error"); return; }
    try {
      const res = await fetch(`https://api.github.com/repos/${tempOwner}/${tempRepo}`, {
        headers: { Authorization: `Bearer ${tempToken}`, Accept: "application/vnd.github.v3+json" }
      });
      if (res.ok) {
        const data = await res.json();
        showToast(`✅ 连接成功！仓库：${data.full_name}`, "success");
      } else {
        showToast(`❌ 连接失败：HTTP ${res.status}`, "error");
      }
    } catch (e) {
      showToast(`❌ 连接失败：${e.message}`, "error");
    }
    renderGithubData();
  };
}


function renderUserInfo() {
  const u = currentUser;
  const gradeText = u.grade ? ` · ${u.grade}` : "";
  const classText = u.classNo ? ` ${u.classNo}` : "";
  $("currentUserInfo").innerHTML = `
    <div class="ui-name">${u.name}</div>
    <div class="ui-role">${ROLE_NAMES[u.role]}${gradeText}${classText}</div>
  `;
  $("topUserInfo").textContent = `${u.name}（${ROLE_NAMES[u.role]}）`;
}

function renderNavMenu() {
  const menus = NAV_MENUS[currentUser.role] || [];
  $("navMenu").innerHTML = `<div class="nav-group-title">功能导航</div>` +
    menus.map((m) => `<div class="nav-item" data-id="${m.id}"><span class="nav-icon">${m.icon}</span><span class="nav-text">${m.text}</span></div>`).join("");
  $("navMenu").querySelectorAll(".nav-item").forEach((el) => {
    el.onclick = () => navigate(el.dataset.id);
  });
}

async function navigate(pageId) {
  currentPage = pageId;
  $("navMenu").querySelectorAll(".nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.id === pageId);
  });
  const menus = NAV_MENUS[currentUser.role] || [];
  const menu = menus.find((m) => m.id === pageId);
  $("pageTitle").textContent = menu ? menu.text : "页面";

  // 切换页面时自动刷新最新数据
  const savedDB = localStorage.getItem(DB_KEY);
  if (savedDB) {
    try { DB = JSON.parse(savedDB); } catch (e) { /* 保持现有 DB */ }
  }

  const render = PAGE_RENDERERS[pageId];
  if (render) render();
  else $("pageContent").innerHTML = `<div class="empty-state"><div class="es-icon">🚧</div><div class="es-title">功能建设中</div></div>`;
}

function renderAnnouncement() {
  const list = DB.announcements.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
  if (list.length === 0) {
    $("announcementBar").classList.add("hidden");
    $("announcementBadge").classList.add("hidden");
    return;
  }
  $("announcementBar").classList.remove("hidden");
  $("announcementBadge").classList.remove("hidden");
  $("announcementCount").textContent = DB.announcements.length;
  $("announcementContent").innerHTML = list.map((a) => `<span style="margin-right:30px">【${a.title}】${a.content}</span>`).join("");
}

const PAGE_RENDERERS = {
  dashboard: renderDashboard,
  users: renderUsers,
  grades: renderGrades,
  permissions: renderPermissions,
  exams: renderExams,
  subjects: renderSubjects,
  grade_summary: renderGradeSummary,
  class_ranking: renderClassRanking,
  teacher_ranking: renderTeacherRanking,
  send_scores: renderSendScores,
  send_rank: renderSendRank,
  announcement: renderAnnouncementMgr,
  announcements_all: renderAnnouncementMgr,
  academic_analysis: renderAcademicAnalysis,
  upload_scores: renderUploadScores,
  my_class_scores: renderMyClassScores,
  download_scores: renderDownloadScores,
  headteacher_analysis: renderHeadteacherAnalysis,
  my_scores: renderMyScores,
  my_ranking: renderMyRanking,
  teacher_analysis: renderTeacherAnalysis,
  github_data: renderGithubData
};

// ========== 平台概览 ==========
function renderDashboard() {
  const totalUsers = DB.users.length;
  const totalExams = DB.exams.length;
  const totalRecords = DB.records.length;
  const totalAnnouncements = DB.announcements.length;

  let cards = `
    <div class="stats-grid">
      <div class="stat-card success"><div class="sc-icon">👥</div><div class="sc-label">教师总数</div><div class="sc-value">${totalUsers}</div></div>
      <div class="stat-card info"><div class="sc-icon">📝</div><div class="sc-label">考试次数</div><div class="sc-value">${totalExams}</div></div>
      <div class="stat-card warning"><div class="sc-icon">📊</div><div class="sc-label">成绩记录</div><div class="sc-value">${totalRecords}</div></div>
      <div class="stat-card danger"><div class="sc-icon">📢</div><div class="sc-label">公告数量</div><div class="sc-value">${totalAnnouncements}</div></div>
    </div>
  `;

  let roleSection = "";
  if (currentUser.role === "admin") {
    roleSection = `
      <div class="card">
        <div class="card-title">📌 快速开始</div>
        <div class="form-row">
          <button class="btn btn-primary btn-lg" onclick="navigate('users')">➜ 添加教师名单</button>
          <button class="btn btn-info btn-lg" onclick="navigate('exams')">➜ 管理考试</button>
          <button class="btn btn-success btn-lg" onclick="navigate('grades')">➜ 年级设置</button>
        </div>
        <p style="margin-top:16px; color:var(--text-light); font-size:13px;">欢迎，${currentUser.name}！作为平台管理员，您可以添加教师、设置年级学科分值、管理考试与公告。</p>
      </div>
    `;
  } else if (currentUser.role === "academic") {
    roleSection = `
      <div class="card">
        <div class="card-title">📌 教务工作台 - ${currentUser.grade || ""}</div>
        <div class="form-row">
          <button class="btn btn-primary btn-lg" onclick="navigate('subjects')">➜ 学科/分值设置</button>
          <button class="btn btn-info btn-lg" onclick="navigate('exams')">➜ 新建考试</button>
          <button class="btn btn-success btn-lg" onclick="navigate('grade_summary')">➜ 成绩汇总</button>
          <button class="btn btn-warning btn-lg" onclick="navigate('teacher_ranking')">➜ 教师排行</button>
        </div>
      </div>
    `;
  } else if (currentUser.role === "headteacher") {
    roleSection = `
      <div class="card">
        <div class="card-title">📌 班主任工作台 - ${currentUser.grade || ""} ${currentUser.classNo || ""}</div>
        <div class="form-row">
          <button class="btn btn-primary btn-lg" onclick="navigate('upload_scores')">➜ 上传班级成绩</button>
          <button class="btn btn-info btn-lg" onclick="navigate('my_class_scores')">➜ 查看本班成绩</button>
          <button class="btn btn-success btn-lg" onclick="navigate('download_scores')">➜ 下载Excel</button>
          <button class="btn btn-warning btn-lg" onclick="navigate('headteacher_analysis')">➜ 智能对比分析</button>
        </div>
      </div>
    `;
  } else {
    roleSection = `
      <div class="card">
        <div class="card-title">📌 任课教师工作台 - ${currentUser.grade || ""} · 任教：${(currentUser.subjects || []).join("、") || "暂未设置"}</div>
        <div class="form-row">
          <button class="btn btn-primary btn-lg" onclick="navigate('my_scores')">➜ 查看班级成绩</button>
          <button class="btn btn-info btn-lg" onclick="navigate('my_ranking')">➜ 我的排行</button>
          <button class="btn btn-success btn-lg" onclick="navigate('teacher_analysis')">➜ 学科对比分析</button>
        </div>
      </div>
    `;
  }

  const recentAnn = DB.announcements.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const annHtml = recentAnn.length === 0
    ? `<div class="empty-state"><div class="es-tip">暂无公告</div></div>`
    : `<table class="data-table"><thead><tr><th style="width:60%">标题 / 内容</th><th>发布人</th><th>时间</th></tr></thead><tbody>
      ${recentAnn.map((a) => `<tr><td><b>${a.title}</b> - ${a.content}</td><td>${a.createdBy}</td><td>${new Date(a.createdAt).toLocaleString()}</td></tr>`).join("")}
    </tbody></table>`;

  $("pageContent").innerHTML = cards + roleSection + `
    <div class="card"><div class="card-title">📢 最近公告</div>${annHtml}</div>
  `;
}

// ========== 管理员：教师名单 ==========
function renderUsers() {
  if (currentUser.role !== "admin") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }

  const rows = DB.users.filter((u) => u.role !== "admin").map((u) => `
    <tr>
      <td>${esc(u.username)}</td>
      <td>${esc(u.name)}</td>
      <td><span class="badge badge-primary">${esc(ROLE_NAMES[u.role])}</span></td>
      <td>${esc(u.grade || "-")}</td>
      <td>${esc(u.classNo || "-")}</td>
      <td>${u.role === "teacher" ? esc((u.subjects || []).join("、")) || "-" : "-"}</td>
      <td>${new Date(u.createdAt).toLocaleDateString()}</td>
      <td style="display:flex;gap:6px">
        <button class="btn btn-sm btn-info" onclick="editUser('${esc(u.id)}')">编辑</button>
        <button class="btn btn-sm btn-warning" onclick="resetPwd('${esc(u.id)}')">重置密码</button>
        <button class="btn btn-sm btn-danger" onclick="delUser('${esc(u.id)}')">删除</button>
      </td>
    </tr>
  `).join("");

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">
        <span>👥 教师名单管理（共 ${DB.users.filter((u) => u.role !== "admin").length} 人）</span>
        <span class="ct-actions"><button class="btn btn-success" onclick="editUser(null)">+ 添加教师</button></span>
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>账号</th><th>姓名</th><th>角色</th><th>所属年级</th><th>班级</th><th>任教学科</th><th>加入时间</th><th>操作</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8"><div class="empty-state"><div class="es-tip">暂无教师，点击右上角添加</div></div></td></tr>`}</tbody>
      </table></div>
    </div>
  `;
}

window.editUser = function (id) {
  const u = id ? DB.users.find((x) => x.id === id) : null;
  const grades = Object.keys(DB.subjects);
  const html = `
    <div class="form-group"><label>账号（登录用户名）</label><input id="m_username" value="${esc(u?.username || "")}" ${u ? "readonly" : ""} /></div>
    <div class="form-group"><label>姓名</label><input id="m_name" value="${esc(u?.name || "")}" /></div>
    <div class="form-group"><label>${u ? "新密码（留空则不修改）" : "初始密码"}</label><input id="m_password" type="text" placeholder="${u ? "留空保持原密码" : "默认 123456"}" value="${u ? "" : "123456"}" /></div>
    <div class="form-group"><label>角色</label>
      <select id="m_role">
        <option value="academic" ${u?.role === "academic" ? "selected" : ""}>教务老师</option>
        <option value="teacher" ${u?.role === "teacher" ? "selected" : ""}>任课教师</option>
        <option value="headteacher" ${u?.role === "headteacher" ? "selected" : ""}>班主任</option>
      </select>
    </div>
    <div class="form-row">
      <div class="form-group"><label>所属年级</label>
        <select id="m_grade">${grades.map((g) => `<option ${u?.grade === g ? "selected" : ""}>${esc(g)}</option>`).join("")}${grades.length === 0 ? `<option>请先添加年级</option>` : ""}</select>
      </div>
      <div class="form-group"><label>班级（班主任必填，如 1班）</label><input id="m_class" value="${esc(u?.classNo || "")}" placeholder="如 1班 / 2班" /></div>
    </div>
    <div class="form-group"><label>任教学科（逗号分隔，任课教师必填）</label>
      <input id="m_subjects" value="${esc((u?.subjects || []).join(","))}" placeholder="如 语文,数学" />
    </div>
  `;
  showModal(u ? "编辑教师信息" : "添加新教师", html, "保存", () => {
    const username = $("m_username").value.trim();
    const name = $("m_name").value.trim();
    const password = $("m_password").value.trim();
    const role = $("m_role").value;
    const grade = $("m_grade").value.trim();
    const classNo = $("m_class").value.trim();
    const subjects = $("m_subjects").value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);

    if (!username || !name) { showToast("账号和姓名不能为空", "error"); return false; }
    if (!u && DB.users.some((x) => x.username === username)) { showToast("账号已存在", "error"); return false; }

    if (u) {
      u.name = name; u.role = role; u.grade = grade; u.classNo = classNo; u.subjects = subjects;
      if (password) u.password = password;
    } else {
      DB.users.push({ id: uid(), username, password: password || "123456", name, role, grade, classNo, subjects, createdAt: Date.now() });
    }
    saveDB(DB);
    showToast("保存成功", "success");
    renderUsers();
  });
};

window.resetPwd = function (id) {
  const u = DB.users.find((x) => x.id === id);
  if (!u) return;
  if (!confirm(`确认将 ${u.name} 的密码重置为 123456？`)) return;
  u.password = "123456"; saveDB(DB); showToast("密码已重置为 123456", "success");
};

window.delUser = function (id) {
  const u = DB.users.find((x) => x.id === id);
  if (!u) return;
  if (!confirm(`确认删除 ${u.name}？此操作不可恢复。`)) return;
  DB.users = DB.users.filter((x) => x.id !== id); saveDB(DB); showToast("已删除", "success");
  renderUsers();
};

// ========== 管理员：年级设置 ==========
function renderGrades() {
  if (currentUser.role !== "admin") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grades = Object.keys(DB.subjects);
  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title"><span>🏫 年级管理（共 ${grades.length} 个年级）</span><span class="ct-actions"><button class="btn btn-success" onclick="addGrade()">+ 添加年级</button></span></div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>年级名称</th><th>学科数</th><th>考试数</th><th>教师数</th><th>操作</th></tr></thead>
        <tbody>${grades.map((g) => `
          <tr>
            <td>${g}</td>
            <td>${(DB.subjects[g] || []).length}</td>
            <td>${DB.exams.filter((e) => e.grade === g).length}</td>
            <td>${DB.users.filter((u) => u.grade === g).length}</td>
            <td><button class="btn btn-sm btn-danger" onclick="delGrade('${g}')">删除</button></td>
          </tr>`).join("") || `<tr><td colspan="5"><div class="empty-state"><div class="es-tip">暂无年级</div></div></td></tr>`}
        </tbody>
      </table></div>
    </div>
    <div class="card">
      <div class="card-title">📝 说明</div>
      <p style="color:var(--text-light); line-height:2;">添加年级后，教务老师可在"学科/分值设置"中为该年级设置具体学科与分值标准。</p>
    </div>
  `;
}

window.addGrade = function () {
  showModal("添加年级", `<div class="form-group"><label>年级名称</label><input id="m_grade" placeholder="如 高二年级" /></div>`, "添加", () => {
    const g = $("m_grade").value.trim();
    if (!g) { showToast("请输入年级名称", "error"); return false; }
    if (DB.subjects[g]) { showToast("年级已存在", "error"); return false; }
    DB.subjects[g] = []; saveDB(DB); showToast(`已添加：${g}`, "success"); renderGrades();
  });
};

window.delGrade = function (g) {
  if (!confirm(`确认删除年级【${g}】？相关学科、考试、成绩也将一并删除。`)) return;
  delete DB.subjects[g];
  DB.exams = DB.exams.filter((e) => e.grade !== g);
  DB.records = DB.records.filter((r) => r.grade !== g);
  saveDB(DB); showToast("已删除", "success"); renderGrades();
};

// ========== 管理员：权限管理 ==========
function renderPermissions() {
  if (currentUser.role !== "admin") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const roles = [
    { name: "管理员", desc: "拥有平台最高权限，负责教师账号、年级、考试等系统管理" },
    { name: "教务老师", desc: "负责本年级的学科设置、分值设置、成绩汇总、教师排行、消息播报、全平台智能分析" },
    { name: "任课教师", desc: "查看所教学科的班级成绩与教师排行、参与学科对比分析" },
    { name: "班主任", desc: "上传本班考试成绩、查看本班成绩排名、下载Excel成绩、本班智能对比分析" }
  ];
  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">🔐 角色权限说明</div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>角色</th><th>权限范围</th></tr></thead>
        <tbody>${roles.map((r) => `<tr><td><b>${r.name}</b></td><td>${r.desc}</td></tr>`).join("")}</tbody>
      </table></div>
    </div>
  `;
}

// ========== 考试管理 ==========
function renderExams() {
  const canEdit = currentUser.role === "admin" || currentUser.role === "academic";
  const exams = currentUser.grade ? DB.exams.filter((e) => e.grade === currentUser.grade) : DB.exams;
  const rows = exams.slice().sort((a, b) => b.createdAt - a.createdAt).map((e) => {
    const n = DB.records.filter((r) => r.examId === e.id).length;
    return `<tr>
      <td>${e.name}</td><td>${e.grade}</td><td>${e.date}</td><td>${n}</td>
      <td style="display:flex;gap:6px">
        ${canEdit ? `<button class="btn btn-sm btn-danger" onclick="delExam('${e.id}')">删除</button>` : ""}
      </td>
    </tr>`;
  }).join("");

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">
        <span>📝 考试管理（共 ${exams.length} 次）</span>
        <span class="ct-actions">${canEdit ? `<button class="btn btn-success" onclick="addExam()">+ 新建考试</button>` : ""}</span>
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>考试名称</th><th>所属年级</th><th>考试日期</th><th>已上传学生数</th><th>操作</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5"><div class="empty-state"><div class="es-tip">暂无考试</div></div></td></tr>`}</tbody>
      </table></div>
    </div>
  `;
}

window.addExam = function () {
  const grades = currentUser.role === "admin" ? Object.keys(DB.subjects) : (currentUser.grade ? [currentUser.grade] : []);
  showModal("新建考试", `
    <div class="form-group"><label>考试名称</label><input id="m_exam" placeholder="如 2024学年第一学期期末考试" /></div>
    <div class="form-row">
      <div class="form-group"><label>所属年级</label>
        <select id="m_exam_grade">${grades.map((g) => `<option ${g === currentUser.grade ? "selected" : ""}>${g}</option>`).join("")}</select>
      </div>
      <div class="form-group"><label>考试日期</label><input id="m_exam_date" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div>
    </div>
  `, "创建", () => {
    const name = $("m_exam").value.trim();
    const grade = $("m_exam_grade").value.trim();
    const date = $("m_exam_date").value;
    if (!name || !grade || !date) { showToast("请完整填写信息", "error"); return false; }
    DB.exams.push({ id: uid(), name, grade, date, createdAt: Date.now() }); saveDB(DB);
    showToast("考试创建成功", "success"); renderExams();
  });
};

window.delExam = function (id) {
  if (!confirm("确认删除此考试及其所有成绩数据？")) return;
  DB.exams = DB.exams.filter((e) => e.id !== id);
  DB.records = DB.records.filter((r) => r.examId !== id);
  saveDB(DB); showToast("已删除", "success"); renderExams();
};

// ========== 教务老师：学科与分值设置 ==========
function renderSubjects() {
  if (currentUser.role !== "academic") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade || Object.keys(DB.subjects)[0];
  if (!DB.subjects[grade]) DB.subjects[grade] = [];
  const list = DB.subjects[grade];

  const rows = list.map((s, idx) => `
    <tr>
      <td><input value="${s.name}" onchange="updateSubjectField('${grade}', ${idx}, 'name', this.value)" style="width:90px;padding:6px;border:1px solid var(--border);border-radius:4px" /></td>
      <td><input type="number" value="${s.fullScore}" onchange="updateSubjectField('${grade}', ${idx}, 'fullScore', +this.value)" style="width:80px;padding:6px;border:1px solid var(--border);border-radius:4px" /></td>
      <td><input type="number" value="${s.excellent}" onchange="updateSubjectField('${grade}', ${idx}, 'excellent', +this.value)" style="width:80px;padding:6px;border:1px solid var(--border);border-radius:4px" /></td>
      <td><input type="number" value="${s.good}" onchange="updateSubjectField('${grade}', ${idx}, 'good', +this.value)" style="width:80px;padding:6px;border:1px solid var(--border);border-radius:4px" /></td>
      <td><input type="number" value="${s.pass}" onchange="updateSubjectField('${grade}', ${idx}, 'pass', +this.value)" style="width:80px;padding:6px;border:1px solid var(--border);border-radius:4px" /></td>
      <td><input type="number" value="${s.low}" onchange="updateSubjectField('${grade}', ${idx}, 'low', +this.value)" style="width:80px;padding:6px;border:1px solid var(--border);border-radius:4px" /></td>
      <td><button class="btn btn-sm btn-danger" onclick="delSubject('${grade}', ${idx})">删除</button></td>
    </tr>
  `).join("");

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">
        <span>📚 学科与分值设置 - ${grade}</span>
        <span class="ct-actions"><button class="btn btn-success" onclick="addSubject('${grade}')">+ 添加学科</button></span>
      </div>
      <p style="color:var(--text-light); margin-bottom:14px;">💡 直接在表格中修改数值，系统自动保存。</p>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>学科</th><th>满分</th><th>优秀线</th><th>良好线</th><th>及格线</th><th>低分线</th><th>操作</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7"><div class="empty-state"><div class="es-tip">暂无学科</div></div></td></tr>`}</tbody>
      </table></div>
    </div>
  `;
}

window.updateSubjectField = function (grade, idx, field, val) {
  DB.subjects[grade][idx][field] = val; saveDB(DB);
};

window.addSubject = function (grade) {
  showModal("添加学科", `
    <div class="form-group"><label>学科名称</label><input id="m_sn" placeholder="如 生物" /></div>
    <div class="form-row">
      <div class="form-group"><label>满分</label><input type="number" id="m_fs" value="100" /></div>
      <div class="form-group"><label>优秀线</label><input type="number" id="m_ex" value="85" /></div>
      <div class="form-group"><label>良好线</label><input type="number" id="m_gd" value="75" /></div>
      <div class="form-group"><label>及格线</label><input type="number" id="m_ps" value="60" /></div>
      <div class="form-group"><label>低分线</label><input type="number" id="m_lw" value="40" /></div>
    </div>
  `, "添加", () => {
    const name = $("m_sn").value.trim();
    if (!name) { showToast("请填写学科名称", "error"); return false; }
    DB.subjects[grade].push({
      name,
      fullScore: +$("m_fs").value || 100,
      excellent: +$("m_ex").value || 85,
      good: +$("m_gd").value || 75,
      pass: +$("m_ps").value || 60,
      low: +$("m_lw").value || 40
    });
    saveDB(DB); showToast("已添加", "success"); renderSubjects();
  });
};

window.delSubject = function (grade, idx) {
  if (!confirm("确认删除此学科？")) return;
  DB.subjects[grade].splice(idx, 1); saveDB(DB); showToast("已删除", "success"); renderSubjects();
};

// ========== 班主任：上传成绩 ==========
function renderUploadScores() {
  if (currentUser.role !== "headteacher") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const classNo = currentUser.classNo;
  const exams = DB.exams.filter((e) => e.grade === grade);
  const subjects = DB.subjects[grade] || [];

  if (subjects.length === 0) {
    $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-icon">⚠️</div><div class="es-title">${grade} 尚未配置学科</div><div class="es-tip">请联系教务老师先进行学科设置</div></div></div>`;
    return;
  }

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">📥 上传 ${grade} ${classNo} 班级成绩</div>
      <div class="form-row">
        <div class="form-group"><label>选择考试</label>
          <select id="u_exam">
            ${exams.map((e) => `<option value="${e.id}">${e.name}</option>`).join("")}
            ${exams.length === 0 ? `<option>暂无考试</option>` : ""}
          </select>
        </div>
        <div class="form-group" style="display:flex;align-items:flex-end"><button class="btn btn-info" onclick="downloadTemplate()">⬇ 下载Excel模板</button></div>
      </div>

      <div id="uploadArea" class="upload-area">
        <div class="ua-icon">📄</div>
        <div class="ua-title">点击选择 Excel 文件（.xlsx / .xls）</div>
        <div class="ua-tip">或直接拖拽文件到此区域。系统将自动识别${grade} ${classNo}</div>
        <input type="file" id="u_file" accept=".xlsx,.xls" style="display:none" />
      </div>

      <div id="u_preview" style="margin-top:20px"></div>
    </div>
    <div class="card">
      <div class="card-title">📋 Excel 模板说明</div>
      <p style="color:var(--text-light); line-height:1.9;">
        • Excel 首行为表头：<b>学号、姓名、${subjects.map((s) => s.name).join("、")}</b><br/>
        • 系统自动识别年级与班级（当前登录账号）<br/>
        • 学生学号是唯一标识，重复上传将更新覆盖<br/>
        • 留空的分数视为缺考，不计入统计
      </p>
    </div>
  `;

  const ua = $("uploadArea");
  ua.onclick = () => $("u_file").click();
  ua.addEventListener("dragover", (e) => { e.preventDefault(); ua.classList.add("dragover"); });
  ua.addEventListener("dragleave", () => ua.classList.remove("dragover"));
  ua.addEventListener("drop", (e) => {
    e.preventDefault(); ua.classList.remove("dragover");
    if (e.dataTransfer.files.length) handleExcelFile(e.dataTransfer.files[0]);
  });
  $("u_file").addEventListener("change", (e) => {
    if (e.target.files.length) handleExcelFile(e.target.files[0]);
  });
}

window.downloadTemplate = function () {
  const grade = currentUser.grade;
  const subjects = DB.subjects[grade] || [];
  const headers = ["学号", "姓名", ...subjects.map((s) => s.name)];
  const rows = [headers];
  for (let i = 1; i <= 3; i++) {
    rows.push([`2024${String(i).padStart(4, "0")}`, `学生${i}`, ...subjects.map((s) => Math.floor(Math.random() * s.fullScore))]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "成绩模板");
  XLSX.writeFile(wb, `${grade}_${currentUser.classNo}_成绩模板.xlsx`);
  showToast("模板已下载", "success");
};

function handleExcelFile(file) {
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      if (rows.length === 0) { showToast("Excel 为空", "error"); return; }

      const grade = currentUser.grade;
      const classNo = currentUser.classNo;
      const subjects = DB.subjects[grade] || [];
      const subjectNames = subjects.map((s) => s.name);

      const parsed = [];
      for (const row of rows) {
        const studentId = String(row["学号"] || row["id"] || "").trim();
        const studentName = String(row["姓名"] || row["name"] || "").trim();
        if (!studentName) continue;
        const scores = {};
        subjectNames.forEach((sn) => {
          const v = row[sn];
          if (v !== "" && v != null && !isNaN(Number(v))) scores[sn] = Number(v);
        });
        let total = 0;
        subjectNames.forEach((sn) => { if (scores[sn] != null) total += scores[sn]; });
        parsed.push({
          id: uid(), examId: $("u_exam").value, grade, classNo,
          studentId: studentId || "S" + uid(), studentName, scores, total,
          uploadedBy: currentUser.id, uploadedAt: Date.now()
        });
      }

      if (parsed.length === 0) { showToast("未能解析任何有效学生", "error"); return; }

      const subjectNames2 = subjects.map((s) => s.name);
      const preview = `
        <div class="card-title" style="border:none;padding:0;margin-bottom:12px">📋 已解析 ${parsed.length} 名学生 - ${grade} ${classNo}</div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>学号</th><th>姓名</th>${subjectNames2.map((n) => `<th>${n}</th>`).join("")}<th>总分</th></tr></thead>
          <tbody>${parsed.slice(0, 30).map((r) => `<tr><td>${r.studentId}</td><td>${r.studentName}</td>${subjectNames2.map((n) => `<td>${r.scores[n] != null ? r.scores[n] : "<span style='color:#ccc'>缺考</span>"}</td>`).join("")}<td><b>${r.total}</b></td></tr>`).join("")}</tbody>
        </table></div>
        ${parsed.length > 30 ? `<p style="text-align:center;color:var(--text-light);margin-top:10px">仅显示前 30 行，共 ${parsed.length} 行</p>` : ""}
        <div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-secondary" onclick="renderUploadScores()">取消</button>
          <button class="btn btn-success" id="confirm_upload">✓ 确认导入成绩</button>
        </div>
      `;
      $("u_preview").innerHTML = preview;

      $("confirm_upload").onclick = () => {
        const examId = $("u_exam").value;
        DB.records = DB.records.filter((r) => !(r.examId === examId && r.grade === grade && r.classNo === classNo && parsed.some((p) => p.studentId === r.studentId)));
        parsed.forEach((p) => DB.records.push(p));
        saveDB(DB);
        showToast(`成功导入 ${parsed.length} 条学生成绩`, "success");
        $("u_preview").innerHTML = "";
      };
    } catch (err) {
      showToast("文件解析失败：" + err.message, "error");
    }
  };
  reader.readAsArrayBuffer(file);
}

// ========== 成绩统计核心 ==========
function aggregateStats(records, subjects) {
  const stats = {};
  subjects.forEach((s) => {
    const validScores = records.map((r) => r.scores[s.name]).filter((v) => typeof v === "number" && !isNaN(v));
    const n = validScores.length;
    const sum = validScores.reduce((a, b) => a + b, 0);
    const avg = n > 0 ? sum / n : 0;
    const max = n > 0 ? Math.max(...validScores) : 0;
    const min = n > 0 ? Math.min(...validScores) : 0;
    const excellent = validScores.filter((v) => v >= s.excellent).length;
    const good = validScores.filter((v) => v >= s.good && v < s.excellent).length;
    const passCount = validScores.filter((v) => v >= s.pass).length;
    const low = validScores.filter((v) => v < s.low).length;
    const maxCount = validScores.filter((v) => v === max).length;
    const minCount = validScores.filter((v) => v === min).length;
    stats[s.name] = {
      total: n, sum, avg, max, min,
      excellent, good, low, passCount,
      excellentPct: n > 0 ? excellent / n : 0,
      goodPct: n > 0 ? good / n : 0,
      passPct: n > 0 ? passCount / n : 0,
      lowPct: n > 0 ? low / n : 0,
      maxCount, minCount, fullScore: s.fullScore
    };
  });
  const totals = records.map((r) => r.total).filter((v) => typeof v === "number" && !isNaN(v));
  const n = totals.length;
  stats["总分"] = {
    total: n,
    sum: totals.reduce((a, b) => a + b, 0),
    avg: n > 0 ? totals.reduce((a, b) => a + b, 0) / n : 0,
    max: n > 0 ? Math.max(...totals) : 0,
    min: n > 0 ? Math.min(...totals) : 0,
    maxCount: totals.filter((v) => v === Math.max(...totals)).length,
    minCount: totals.filter((v) => v === Math.min(...totals)).length
  };
  return stats;
}

// ========== 教务：年级成绩汇总 ==========
function renderGradeSummary() {
  if (currentUser.role !== "academic") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const exams = DB.exams.filter((e) => e.grade === grade).sort((a, b) => b.createdAt - a.createdAt);

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">📈 ${grade} 成绩汇总</div>
      <div class="form-row">
        <div class="form-group"><label>选择考试</label><select id="s_exam">${exams.map((e) => `<option value="${e.id}">${e.name}</option>`).join("")}${exams.length === 0 ? `<option>暂无考试</option>` : ""}</select></div>
      </div>
      <div id="summary_result"></div>
    </div>
  `;
  const s = $("s_exam");
  if (s) s.onchange = () => drawSummary(s.value, grade);
  if (exams.length) drawSummary(exams[0].id, grade);
}

function drawSummary(examId, grade) {
  const subjects = DB.subjects[grade] || [];
  const records = DB.records.filter((r) => r.examId === examId && r.grade === grade);
  if (records.length === 0) {
    $("summary_result").innerHTML = `<div class="empty-state"><div class="es-icon">📭</div><div class="es-title">本考试暂无成绩数据</div><div class="es-tip">请等待班主任上传班级成绩</div></div>`;
    return;
  }
  const classGroups = {};
  records.forEach((r) => { if (!classGroups[r.classNo]) classGroups[r.classNo] = []; classGroups[r.classNo].push(r); });
  const stats = aggregateStats(records, subjects);

  const classes = Object.keys(classGroups).sort();
  let rows = classes.map((cls) => {
    const cs = aggregateStats(classGroups[cls], subjects);
    return `<tr><td><b>${cls}</b></td><td>${classGroups[cls].length}</td>${subjects.map((s) => `<td>${fmt(cs[s.name].avg)}</td>`).join("")}<td><b>${fmt(cs["总分"].avg)}</b></td></tr>`;
  }).join("");

  const summaryRow = `<tr class="summary-row"><td>全年级</td><td>${records.length}</td>${subjects.map((s) => `<td>${fmt(stats[s.name].avg)}</td>`).join("")}<td><b>${fmt(stats["总分"].avg)}</b></td></tr>`;

  const statRows = subjects.map((s) => {
    const st = stats[s.name];
    return `<tr>
      <td><b>${s.name}</b></td>
      <td>${st.total}</td>
      <td>${st.excellent}（${fmtPct(st.excellentPct)}）</td>
      <td>${st.good}（${fmtPct(st.goodPct)}）</td>
      <td>${st.passCount}（${fmtPct(st.passPct)}）</td>
      <td>${st.low}（${fmtPct(st.lowPct)}）</td>
      <td>${fmt(st.avg)} / ${s.fullScore}</td>
      <td>${st.max}（${st.maxCount}人）</td>
      <td>${st.min}（${st.minCount}人）</td>
    </tr>`;
  }).join("");

  $("summary_result").innerHTML = `
    <h3 style="margin:10px 0 14px">① 各班级学科均分</h3>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>班级</th><th>人数</th>${subjects.map((s) => `<th>${s.name}均分</th>`).join("")}<th>班级总分均分</th></tr></thead>
      <tbody>${rows}${summaryRow}</tbody>
    </table></div>

    <h3 style="margin:24px 0 14px">② 全年级成绩统计详情</h3>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>学科</th><th>参考人数</th><th>优秀（人数/率）</th><th>良好（人数/率）</th><th>及格（人数/率）</th><th>低分（人数/率）</th><th>平均分 / 满分</th><th>最高分（人数）</th><th>最低分（人数）</th></tr></thead>
      <tbody>${statRows}</tbody>
    </table></div>

    <div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end">
      <button class="btn btn-primary" id="btn_dl_summary">⬇ 下载Excel汇总表</button>
    </div>
  `;
  $("btn_dl_summary").onclick = () => exportSummaryExcel(examId, grade);
}

function exportSummaryExcel(examId, grade) {
  const exam = DB.exams.find((e) => e.id === examId);
  const subjects = DB.subjects[grade] || [];
  const records = DB.records.filter((r) => r.examId === examId && r.grade === grade);
  if (records.length === 0) { showToast("没有数据", "error"); return; }

  const classGroups = {};
  records.forEach((r) => { if (!classGroups[r.classNo]) classGroups[r.classNo] = []; classGroups[r.classNo].push(r); });
  const classes = Object.keys(classGroups).sort();
  const totalStats = aggregateStats(records, subjects);

  // 各班均分表
  const t1 = [["班级", "人数", ...subjects.map((s) => s.name + "均分"), "总分均分"]];
  classes.forEach((cls) => {
    const cs = aggregateStats(classGroups[cls], subjects);
    t1.push([cls, classGroups[cls].length, ...subjects.map((s) => +fmt(cs[s.name].avg)), +fmt(cs["总分"].avg)]);
  });
  t1.push(["全年级", records.length, ...subjects.map((s) => +fmt(totalStats[s.name].avg)), +fmt(totalStats["总分"].avg)]);

  // 学生明细
  const t2 = [["年级排名", "班级", "学号", "姓名", ...subjects.map((s) => s.name), "总分"]];
  records.slice().sort((a, b) => b.total - a.total).forEach((r, idx) => {
    t2.push([idx + 1, r.classNo, r.studentId, r.studentName, ...subjects.map((s) => r.scores[s.name] ?? ""), r.total]);
  });

  // 统计详情
  const t3 = [["学科", "参考人数", "优秀人数", "优秀率", "良好人数", "良好率", "及格人数", "及格率", "低分人数", "低分率", "平均分", "最高分", "最高分人数", "最低分", "最低分人数"]];
  subjects.forEach((s) => {
    const st = totalStats[s.name];
    t3.push([s.name, st.total, st.excellent, fmt(st.excellentPct * 100, 2) + "%", st.good, fmt(st.goodPct * 100, 2) + "%", st.passCount, fmt(st.passPct * 100, 2) + "%", st.low, fmt(st.lowPct * 100, 2) + "%", +fmt(st.avg), st.max, st.maxCount, st.min, st.minCount]);
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(t1), "各班均分");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(t2), "学生明细");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(t3), "统计详情");
  XLSX.writeFile(wb, `${grade}_${exam.name}_成绩汇总.xlsx`);
  showToast("已下载 Excel", "success");
}

// ========== 排名 ==========
function renderClassRanking() {
  const isHeadteacher = currentUser.role === "headteacher";
  const grade = currentUser.grade;
  const exams = DB.exams.filter((e) => e.grade === grade).sort((a, b) => b.createdAt - a.createdAt);

  const hasClassFilter = !isHeadteacher;
  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">🏆 ${isHeadteacher ? "本班成绩排名" : "全年级成绩排名"} - ${grade}</div>
      <div class="form-row">
        <div class="form-group"><label>选择考试</label><select id="r_exam">${exams.map((e) => `<option value="${e.id}">${e.name}</option>`).join("")}${exams.length === 0 ? `<option>暂无考试</option>` : ""}</select></div>
        ${hasClassFilter ? `<div class="form-group"><label>筛选班级</label><select id="r_class"><option value="">全部班级</option></select></div>` : ""}
      </div>
      <div id="rank_result"></div>
    </div>
  `;
  const classSel = $("r_class");
  if (classSel && exams.length) {
    const classList = [...new Set(DB.records.filter((r) => r.examId === exams[0].id).map((r) => r.classNo))].sort();
    classList.forEach((c) => { const o = document.createElement("option"); o.value = c; o.textContent = c; classSel.appendChild(o); });
    classSel.onchange = () => drawRanking($("r_exam").value, grade, classSel.value);
  }
  const examSel = $("r_exam");
  if (examSel) examSel.onchange = () => drawRanking(examSel.value, grade, isHeadteacher ? currentUser.classNo : (classSel ? classSel.value : ""));
  if (exams.length) drawRanking(exams[0].id, grade, isHeadteacher ? currentUser.classNo : "");
}

function drawRanking(examId, grade, classFilter = "") {
  const subjects = DB.subjects[grade] || [];
  let records = DB.records.filter((r) => r.examId === examId && r.grade === grade);
  if (classFilter) records = records.filter((r) => r.classNo === classFilter);
  if (records.length === 0) {
    $("rank_result").innerHTML = `<div class="empty-state"><div class="es-icon">📭</div><div class="es-title">暂无成绩数据</div></div>`;
    return;
  }
  records.sort((a, b) => b.total - a.total);
  const stats = aggregateStats(records, subjects);

  const rows = records.map((r, idx) => {
    const rank = idx + 1;
    const badge = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank;
    return `<tr class="${rank <= 3 ? "rank-top" : ""}">
      <td><b>${badge}</b></td>
      <td>${r.classNo}</td>
      <td>${r.studentId}</td>
      <td>${r.studentName}</td>
      ${subjects.map((s) => `<td>${r.scores[s.name] != null ? r.scores[s.name] : "-"}</td>`).join("")}
      <td><b>${r.total}</b></td>
    </tr>`;
  }).join("");

  const summaryRows = subjects.map((s) => {
    const st = stats[s.name];
    return `<tr class="summary-row">
      <td colspan="4" style="text-align:right"><b>${s.name} 统计</b></td>
      <td colspan="${subjects.length + 1}">
        优秀 ${st.excellent}人（${fmtPct(st.excellentPct)}） ·
        良好 ${st.good}人（${fmtPct(st.goodPct)}） ·
        及格 ${st.passCount}人（${fmtPct(st.passPct)}） ·
        低分 ${st.low}人（${fmtPct(st.lowPct)}） ·
        平均 ${fmt(st.avg)} · 最高 ${st.max}（${st.maxCount}人） · 最低 ${st.min}（${st.minCount}人）
      </td>
    </tr>`;
  }).join("");

  $("rank_result").innerHTML = `
    <h3 style="margin:10px 0 14px">按总分排名（共 ${records.length} 名学生）</h3>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>排名</th><th>班级</th><th>学号</th><th>姓名</th>${subjects.map((s) => `<th>${s.name}</th>`).join("")}<th>总分</th></tr></thead>
      <tbody>${rows}${summaryRows}</tbody>
    </table></div>
    <div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end">
      <button class="btn btn-primary" onclick="downloadRankingExcel('${examId}', '${grade}', '${classFilter}')">⬇ 下载Excel排名</button>
    </div>
  `;
}

window.downloadRankingExcel = function (examId, grade, classFilter) {
  const exam = DB.exams.find((e) => e.id === examId);
  const subjects = DB.subjects[grade] || [];
  let records = DB.records.filter((r) => r.examId === examId && r.grade === grade);
  if (classFilter) records = records.filter((r) => r.classNo === classFilter);
  if (records.length === 0) { showToast("无数据", "error"); return; }
  records.sort((a, b) => b.total - a.total);
  const stats = aggregateStats(records, subjects);

  const t1 = [["排名", "班级", "学号", "姓名", ...subjects.map((s) => s.name), "总分"]];
  records.forEach((r, idx) => {
    t1.push([idx + 1, r.classNo, r.studentId, r.studentName, ...subjects.map((s) => r.scores[s.name] ?? ""), r.total]);
  });

  const t2 = [["学科", "参考人数", "优秀人数", "优秀率", "良好人数", "良好率", "及格人数", "及格率", "低分人数", "低分率", "平均分", "最高分", "最高分人数", "最低分", "最低分人数"]];
  subjects.forEach((s) => {
    const st = stats[s.name];
    t2.push([s.name, st.total, st.excellent, fmt(st.excellentPct * 100, 2) + "%", st.good, fmt(st.goodPct * 100, 2) + "%", st.passCount, fmt(st.passPct * 100, 2) + "%", st.low, fmt(st.lowPct * 100, 2) + "%", +fmt(st.avg), st.max, st.maxCount, st.min, st.minCount]);
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(t1), "学生排名");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(t2), "统计详情");
  XLSX.writeFile(wb, `${grade}${classFilter ? "_" + classFilter : ""}_${exam.name}_排名.xlsx`);
  showToast("已下载 Excel", "success");
};

// ========== 班主任：本班成绩查看 ==========
function renderMyClassScores() {
  if (currentUser.role !== "headteacher") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const classNo = currentUser.classNo;
  const exams = DB.exams.filter((e) => e.grade === grade).sort((a, b) => b.createdAt - a.createdAt);

  if (exams.length === 0) {
    $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-icon">📭</div><div class="es-title">暂无考试</div></div></div>`;
    return;
  }

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">
        <span>📖 ${classNo} 考试成绩</span>
        <span class="ct-actions"><button class="btn btn-primary" onclick="navigate('download_scores')">⬇ 下载 Excel</button></span>
      </div>
      <div class="form-row">
        <div class="form-group"><label>选择考试</label><select id="mc_exam">${exams.map((e) => `<option value="${e.id}">${e.name}</option>`).join("")}</select></div>
      </div>
      <div id="mc_result"></div>
    </div>
  `;
  const sel = $("mc_exam");
  sel.onchange = () => drawClassScores(sel.value, grade, classNo);
  drawClassScores(exams[0].id, grade, classNo);
}

function drawClassScores(examId, grade, classNo) {
  const subjects = DB.subjects[grade] || [];
  let records = DB.records.filter((r) => r.examId === examId && r.classNo === classNo);
  if (records.length === 0) {
    $("mc_result").innerHTML = `<div class="empty-state"><div class="es-icon">📭</div><div class="es-title">本考试暂无数据</div></div>`;
    return;
  }
  records.sort((a, b) => b.total - a.total);
  const stats = aggregateStats(records, subjects);

  const rows = records.map((r, idx) => `<tr>
    <td>${idx + 1}</td><td>${r.studentId}</td><td>${r.studentName}</td>
    ${subjects.map((s) => `<td>${r.scores[s.name] != null ? r.scores[s.name] : "-"}</td>`).join("")}
    <td><b>${r.total}</b></td>
  </tr>`).join("");

  const summaryRows = subjects.map((s) => {
    const st = stats[s.name];
    return `<tr class="summary-row"><td colspan="3" style="text-align:right"><b>${s.name}</b></td>
      <td colspan="${subjects.length + 1}">优秀 ${st.excellent}人/${fmtPct(st.excellentPct)} · 良好 ${st.good}人/${fmtPct(st.goodPct)} · 及格 ${st.passCount}人/${fmtPct(st.passPct)} · 低分 ${st.low}人/${fmtPct(st.lowPct)} · 平均 ${fmt(st.avg)} · 最高 ${st.max}(${st.maxCount}人) · 最低 ${st.min}(${st.minCount}人)</td></tr>`;
  }).join("");

  $("mc_result").innerHTML = `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>排名</th><th>学号</th><th>姓名</th>${subjects.map((s) => `<th>${s.name}</th>`).join("")}<th>总分</th></tr></thead>
      <tbody>${rows}${summaryRows}</tbody>
    </table></div>
  `;
}

// ========== 班主任：下载成绩 ==========
function renderDownloadScores() {
  if (currentUser.role !== "headteacher") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const classNo = currentUser.classNo;
  const exams = DB.exams.filter((e) => e.grade === grade).sort((a, b) => b.createdAt - a.createdAt);

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">📤 ${classNo} 考试成绩下载</div>
      <p style="color:var(--text-light); margin-bottom:16px;">选择考试以下载完整的 Excel 文件，包含学生排名和统计信息。</p>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>考试名称</th><th>日期</th><th>学生数</th><th>操作</th></tr></thead>
        <tbody>${exams.map((e) => {
          const cnt = DB.records.filter((r) => r.examId === e.id && r.classNo === classNo).length;
          return `<tr><td>${e.name}</td><td>${e.date}</td><td>${cnt}</td>
            <td><button class="btn btn-sm btn-primary" onclick="downloadRankingExcel('${e.id}','${grade}','${classNo}')">⬇ 下载</button></td></tr>`;
        }).join("") || `<tr><td colspan="4"><div class="empty-state"><div class="es-tip">暂无考试</div></div></td></tr>`}</tbody>
      </table></div>
    </div>
  `;
}

// ========== 教务：教师排行榜 ==========
function computeTeacherRanking(examId, grade) {
  const subjects = DB.subjects[grade] || [];
  const allRecords = DB.records.filter((r) => r.examId === examId && r.grade === grade);
  if (allRecords.length === 0) return { subjects: [], rows: [] };
  const byClass = {};
  allRecords.forEach((r) => { if (!byClass[r.classNo]) byClass[r.classNo] = []; byClass[r.classNo].push(r); });
  const gradeStats = aggregateStats(allRecords, subjects);
  const rows = [];
  subjects.forEach((subject) => {
    const classes = Object.keys(byClass).sort();
    const subjectRows = [];
    classes.forEach((classNo) => {
      const classRecs = byClass[classNo];
      const cs = aggregateStats(classRecs, [subject])[subject.name];
      if (!cs || cs.total === 0) return;
      const ht = DB.users.find((u) => u.role === "headteacher" && u.grade === grade && u.classNo === classNo);
      const teacherName = ht ? ht.name : `${classNo} 教师`;
      const normalizedAvg = cs.avg / subject.fullScore;
      const compositeScore = cs.excellentPct * 0.3 + cs.passPct * 0.3 + normalizedAvg * 0.4;
      subjectRows.push({
        subject: subject.name, teacherName, classNo, total: cs.total, avg: cs.avg,
        excellent: cs.excellent, excellentPct: cs.excellentPct,
        passCount: cs.passCount, passPct: cs.passPct,
        good: cs.good, goodPct: cs.goodPct,
        low: cs.low, lowPct: cs.lowPct,
        normalizedAvg, compositeScore, gradeAvg: gradeStats[subject.name].avg
      });
    });
    subjectRows.sort((a, b) => b.compositeScore - a.compositeScore);
    subjectRows.forEach((r, idx) => { r.rank = idx + 1; });
    subjectRows.forEach((r) => rows.push(r));
  });
  return { subjects, rows };
}

function renderTeacherRanking() {
  if (currentUser.role !== "academic") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const exams = DB.exams.filter((e) => e.grade === grade).sort((a, b) => b.createdAt - a.createdAt);
  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">🎖️ 教师排行榜 - ${grade}</div>
      <div class="form-row">
        <div class="form-group"><label>选择考试</label><select id="tr_exam">${exams.map((e) => `<option value="${e.id}">${e.name}</option>`).join("")}${exams.length === 0 ? `<option>暂无考试</option>` : ""}</select></div>
        <div class="form-group"><label>筛选学科</label><select id="tr_subject"><option value="">全部学科</option></select></div>
      </div>
      <div id="tr_result"></div>
    </div>
  `;
  const tr_exam = $("tr_exam"); const tr_subject = $("tr_subject");
  const subjectList = DB.subjects[grade] || [];
  subjectList.forEach((s) => { const o = document.createElement("option"); o.value = s.name; o.textContent = s.name; tr_subject.appendChild(o); });
  const refresh = () => drawTeacherRanking(tr_exam.value, grade, tr_subject.value);
  tr_exam.onchange = refresh; tr_subject.onchange = refresh;
  if (exams.length) refresh();
}

function drawTeacherRanking(examId, grade, subjectFilter) {
  const { rows } = computeTeacherRanking(examId, grade);
  if (rows.length === 0) { $("tr_result").innerHTML = `<div class="empty-state"><div class="es-title">暂无数据</div></div>`; return; }
  const filtered = subjectFilter ? rows.filter((r) => r.subject === subjectFilter) : rows;
  const trs = filtered.map((r) => `<tr class="${r.rank === 1 ? "rank-top" : ""}">
    <td>${r.rank}</td><td><b>${r.subject}</b></td><td>${r.teacherName}</td><td>${r.classNo}</td>
    <td>${r.total}</td><td>${fmt(r.avg)}</td><td>${r.excellent}/${fmtPct(r.excellentPct)}</td>
    <td>${r.passCount}/${fmtPct(r.passPct)}</td><td>${r.good}/${fmtPct(r.goodPct)}</td>
    <td>${r.low}/${fmtPct(r.lowPct)}</td><td><b>${fmt(r.compositeScore * 100, 2)}</b></td>
  </tr>`).join("");
  $("tr_result").innerHTML = `
    <p style="color:var(--text-light); margin-bottom:10px;">📘 综合分数 = 优秀率 × 0.3 + 及格率 × 0.3 + 标准化均分 × 0.4（同学科内排名）</p>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>名次</th><th>学科</th><th>任课教师</th><th>班级</th><th>人数</th><th>均分</th><th>优秀</th><th>及格</th><th>良好</th><th>低分</th><th>综合分数</th></tr></thead>
      <tbody>${trs}</tbody>
    </table></div>
    <div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end">
      <button class="btn btn-primary" onclick="downloadTeacherRanking('${examId}','${grade}')">⬇ 下载教师排行</button>
    </div>
  `;
}

window.downloadTeacherRanking = function (examId, grade) {
  const exam = DB.exams.find((e) => e.id === examId);
  const { rows } = computeTeacherRanking(examId, grade);
  if (rows.length === 0) { showToast("无数据", "error"); return; }
  const t = [["学科内名次", "学科", "任课教师", "班级", "班级人数", "班级均分", "优秀人数", "优秀率", "及格人数", "及格率", "良好人数", "良好率", "低分人数", "低分率", "综合分数"]];
  rows.forEach((r) => t.push([r.rank, r.subject, r.teacherName, r.classNo, r.total, +fmt(r.avg), r.excellent, fmt(r.excellentPct * 100, 2) + "%", r.passCount, fmt(r.passPct * 100, 2) + "%", r.good, fmt(r.goodPct * 100, 2) + "%", r.low, fmt(r.lowPct * 100, 2) + "%", +fmt(r.compositeScore * 100, 2)]));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(t), "教师排行榜");
  XLSX.writeFile(wb, `${grade}_${exam.name}_教师排行榜.xlsx`);
  showToast("已下载 Excel", "success");
};

// ========== 教务：发送班级成绩 ==========
function renderSendScores() {
  if (currentUser.role !== "academic") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const exams = DB.exams.filter((e) => e.grade === grade).sort((a, b) => b.createdAt - a.createdAt);
  const classes = [...new Set(DB.records.filter((r) => r.grade === grade).map((r) => r.classNo))].sort();
  const headteachers = DB.users.filter((u) => u.role === "headteacher" && u.grade === grade);
  const subjectTeachers = DB.users.filter((u) => u.role === "teacher" && u.grade === grade);

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">📨 发送班级成绩通知</div>
      <p style="color:var(--text-light); margin-bottom:16px;">选择一次考试和要通知的对象（班主任 / 任课教师），系统将以平台消息形式发送成绩摘要。</p>
      <div class="form-row">
        <div class="form-group"><label>选择考试</label><select id="ss_exam">${exams.map((e) => `<option value="${e.id}">${e.name}</option>`).join("")}${exams.length === 0 ? `<option>暂无考试</option>` : ""}</select></div>
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:1; min-width:300px;"><label>发送给班主任</label>
          <div class="checkbox-group">${classes.map((c) => `<label><input type="checkbox" class="ss_ht" value="${c}" checked> ${c}</label>`).join("") || `<span style="color:var(--text-light)">（暂无）</span>`}</div>
        </div>
        <div class="form-group" style="flex:1; min-width:300px;"><label>发送给任课教师</label>
          <div class="checkbox-group">${subjectTeachers.map((t) => `<label><input type="checkbox" class="ss_tc" value="${t.id}"> ${t.name}（${(t.subjects||[]).join("、")}）</label>`).join("") || `<span style="color:var(--text-light)">（暂无）</span>`}</div>
        </div>
      </div>
      <div style="text-align:right; margin-top:16px;">
        <button class="btn btn-success" id="ss_send">📤 发送</button>
      </div>
    </div>
    <div class="card"><div class="card-title">📜 发送历史</div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>时间</th><th>考试</th><th>发送内容</th></tr></thead>
        <tbody>${DB.sends.slice().reverse().slice(0, 20).map((s) => `<tr><td>${new Date(s.createdAt).toLocaleString()}</td><td>${s.examName}</td><td>${s.content}</td></tr>`).join("") || `<tr><td colspan="3"><div class="empty-state"><div class="es-tip">暂无记录</div></div></td></tr>`}</tbody>
      </table></div>
    </div>
  `;
  $("ss_send").onclick = () => {
    const examId = $("ss_exam").value;
    const exam = DB.exams.find((e) => e.id === examId);
    if (!exam) { showToast("请先选择考试", "error"); return; }
    const hts = [...document.querySelectorAll(".ss_ht:checked")].map((e) => e.value);
    const tcs = [...document.querySelectorAll(".ss_tc:checked")].map((e) => e.value);
    if (hts.length === 0 && tcs.length === 0) { showToast("请至少选择一位接收者", "error"); return; }
    DB.sends.push({ id: uid(), examId, examName: exam.name, targets: { classes: hts, teachers: tcs }, content: `已向 ${hts.length} 位班主任和 ${tcs.length} 位任课教师推送 ${exam.name} 的成绩`, sentBy: currentUser.name, createdAt: Date.now() });
    saveDB(DB);
    showToast(`已发送给 ${hts.length + tcs.length} 位教师`, "success");
    renderSendScores();
  };
}

// ========== 教务：发送教师排行 ==========
function renderSendRank() {
  if (currentUser.role !== "academic") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const exams = DB.exams.filter((e) => e.grade === grade).sort((a, b) => b.createdAt - a.createdAt);

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">📤 推送教师排行榜给相关教师</div>
      <p style="color:var(--text-light); margin-bottom:16px;">选择考试后一键推送，所有参与的任课教师（含班主任）将在"我的排行信息"中查看到对应排行。</p>
      <div class="form-row">
        <div class="form-group"><label>选择考试</label><select id="sr_exam">${exams.map((e) => `<option value="${e.id}">${e.name}</option>`).join("")}${exams.length === 0 ? `<option>暂无考试</option>` : ""}</select></div>
      </div>
      <div style="text-align:right; margin-top:16px;"><button class="btn btn-success" id="sr_send">📤 推送教师排行</button></div>
    </div>
    <div class="card"><div class="card-title">📜 推送历史</div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>时间</th><th>考试</th><th>操作</th></tr></thead>
        <tbody>${DB.rankSends.slice().reverse().slice(0, 20).map((s) => `<tr><td>${new Date(s.createdAt).toLocaleString()}</td><td>${s.examName}</td><td>推送成功</td></tr>`).join("") || `<tr><td colspan="3"><div class="empty-state"><div class="es-tip">暂无记录</div></div></td></tr>`}</tbody>
      </table></div>
    </div>
  `;
  $("sr_send").onclick = () => {
    const examId = $("sr_exam").value;
    const exam = DB.exams.find((e) => e.id === examId);
    if (!exam) { showToast("请先选择考试", "error"); return; }
    DB.rankSends.push({ id: uid(), examId, examName: exam.name, sentBy: currentUser.name, createdAt: Date.now() });
    saveDB(DB);
    showToast("已推送，教师可在『我的排行信息』中查看", "success");
  };
}

// ========== 公告 / 消息播报 ==========
function renderAnnouncementMgr() {
  const canPost = currentUser.role === "academic" || currentUser.role === "admin";
  $("pageContent").innerHTML = `
    ${canPost ? `
    <div class="card">
      <div class="card-title">📢 发布消息播报</div>
      <p style="color:var(--text-light); margin-bottom:12px;">公告将出现在全平台顶栏，所有用户均能看到。</p>
      <div class="form-row">
        <div class="form-group" style="flex:1;"><label>标题</label><input id="an_title" placeholder="如：期末考试通知" /></div>
      </div>
      <div class="form-group"><label>内容</label><input id="an_content" placeholder="请输入详细内容..." /></div>
      <div style="text-align:right;"><button class="btn btn-success" id="an_post">📣 发布播报</button></div>
    </div>` : ""}
    <div class="card">
      <div class="card-title">📋 已发布公告（共 ${DB.announcements.length} 条）</div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>标题</th><th>内容</th><th>发布人</th><th>时间</th>${canPost ? "<th>操作</th>" : ""}</th></tr></thead>
        <tbody>${DB.announcements.slice().reverse().map((a) => `<tr>
          <td><b>${a.title}</b></td><td>${a.content}</td><td>${a.createdBy}</td><td>${new Date(a.createdAt).toLocaleString()}</td>
          ${canPost ? `<td><button class="btn btn-sm btn-danger" onclick="delAnnouncement('${a.id}')">删除</button></td>` : ""}
        </tr>`).join("") || `<tr><td colspan="${canPost ? 5 : 4}"><div class="empty-state"><div class="es-tip">暂无公告</div></div></td></tr>`}</tbody>
      </table></div>
    </div>
  `;
  if (canPost) {
    $("an_post").onclick = () => {
      const title = $("an_title").value.trim();
      const content = $("an_content").value.trim();
      if (!title || !content) { showToast("请填写标题和内容", "error"); return; }
      DB.announcements.push({ id: uid(), title, content, createdBy: currentUser.name, createdAt: Date.now() });
      saveDB(DB);
      showToast("播报已发布", "success");
      renderAnnouncement();
      renderAnnouncementMgr();
    };
  }
}

window.delAnnouncement = function (id) {
  if (!confirm("确认删除此公告？")) return;
  DB.announcements = DB.announcements.filter((a) => a.id !== id);
  saveDB(DB); showToast("已删除", "success");
  renderAnnouncement();
  renderAnnouncementMgr();
};

// ========== 智能对比分析 ==========
// 获取所有考试列表（按时间排序）
function getSortedExams(grade) {
  return DB.exams.filter((e) => !grade || e.grade === grade).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

// 绘制 Chart.js 图表
function drawChart(canvasId, type, labels, datasets) {
  const c = document.getElementById(canvasId);
  if (!c) return;
  if (c._chart) c._chart.destroy();
  const colors = ["#3b7ddd", "#28a745", "#ffc107", "#dc3545", "#17a2b8", "#6f42c1", "#fd7e14", "#20c997"];
  const ds = datasets.map((d, i) => ({
    label: d.label,
    data: d.data,
    backgroundColor: d.fill || type === "bar" ? colors[i % colors.length] + "55" : "transparent",
    borderColor: colors[i % colors.length],
    borderWidth: 2,
    tension: 0.3,
    fill: !!d.fill
  }));
  c._chart = new Chart(c, { type, data: { labels, datasets: ds }, options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: "top" } },
    scales: { y: { beginAtZero: false } }
  }});
}

// 教务端：全年级智能分析
function renderAcademicAnalysis() {
  if (currentUser.role !== "academic") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const exams = getSortedExams(grade);
  if (exams.length === 0) { $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-tip">暂无考试数据</div></div></div>`; return; }

  const subjects = DB.subjects[grade] || [];

  // 每个考试的各学科均分
  const examLabels = exams.map((e) => e.name);
  const datasets = subjects.map((s) => ({
    label: s.name,
    data: exams.map((e) => {
      const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade);
      if (recs.length === 0) return null;
      const st = aggregateStats(recs, [s])[s.name];
      return +fmt(st.avg, 2);
    })
  }));

  // 优秀率趋势
  const excellentDS = subjects.map((s) => ({
    label: s.name + " 优秀率",
    data: exams.map((e) => {
      const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade);
      if (recs.length === 0) return null;
      const st = aggregateStats(recs, [s])[s.name];
      return +fmt(st.excellentPct * 100, 2);
    })
  }));

  // 班级对比最新一次考试
  const latestExam = exams[exams.length - 1];
  const latestRecs = DB.records.filter((r) => r.examId === latestExam.id && r.grade === grade);
  const classTotals = {};
  latestRecs.forEach((r) => {
    if (!classTotals[r.classNo]) classTotals[r.classNo] = [];
    classTotals[r.classNo].push(r.total);
  });
  const classLabels = Object.keys(classTotals).sort();
  const classAvg = classLabels.map((c) => +fmt(classTotals[c].reduce((a, b) => a + b, 0) / classTotals[c].length, 2));

  // 生成智能分析文字
  let insights = [];
  subjects.forEach((s) => {
    const trend = datasets.find((d) => d.label === s.name).data.filter((v) => v != null);
    if (trend.length >= 2) {
      const diff = trend[trend.length - 1] - trend[trend.length - 2];
      if (Math.abs(diff) > 0.5) {
        insights.push(`【${s.name}】最近一次考试均分较上次${diff > 0 ? "上升" : "下降"} ${fmt(Math.abs(diff), 2)} 分`);
      }
    }
  });
  // 最高/最低班级
  if (classLabels.length > 0) {
    const maxIdx = classAvg.indexOf(Math.max(...classAvg));
    const minIdx = classAvg.indexOf(Math.min(...classAvg));
    insights.push(`【${latestExam.name}】${classLabels[maxIdx]} 总分均分最高（${classAvg[maxIdx]}），${classLabels[minIdx]} 最低（${classAvg[minIdx]}），差值 ${fmt(classAvg[maxIdx] - classAvg[minIdx], 2)}`);
  }

  $("pageContent").innerHTML = `
    <div class="card"><div class="card-title">🔍 全年级智能对比分析</div>
      <div class="analysis-text"><h4>💡 AI 洞察</h4>${insights.map((i) => `<p>• ${i}</p>`).join("") || "<p>暂无足够数据生成洞察</p>"}</div>
    </div>
    <div class="card"><div class="card-title">📈 各学科均分趋势（全部考试）</div>
      <div class="chart-box"><canvas id="chart1"></canvas></div>
    </div>
    <div class="card"><div class="card-title">📊 各学科优秀率趋势</div>
      <div class="chart-box"><canvas id="chart2"></canvas></div>
    </div>
    <div class="card"><div class="card-title">🏫 ${latestExam.name} 班级总分均分对比</div>
      <div class="chart-box"><canvas id="chart3"></canvas></div>
    </div>
  `;
  setTimeout(() => {
    drawChart("chart1", "line", examLabels, datasets);
    drawChart("chart2", "line", examLabels, excellentDS);
    drawChart("chart3", "bar", classLabels, [{ label: "班级总分均分", data: classAvg, fill: true }]);
  }, 50);
}

// 班主任端：本班学生本次 vs 历史对比
function renderHeadteacherAnalysis() {
  if (currentUser.role !== "headteacher") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const classNo = currentUser.classNo;
  const exams = getSortedExams(grade);
  if (exams.length === 0) { $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-tip">暂无考试</div></div></div>`; return; }

  const subjects = DB.subjects[grade] || [];

  // 本班各学科均分趋势
  const examLabels = exams.map((e) => e.name);
  const subjectTrend = subjects.map((s) => ({
    label: s.name,
    data: exams.map((e) => {
      const recs = DB.records.filter((r) => r.examId === e.id && r.classNo === classNo);
      if (recs.length === 0) return null;
      const st = aggregateStats(recs, [s])[s.name];
      return +fmt(st.avg, 2);
    })
  }));

  // 总分均分趋势 vs 年级均分
  const totalTrend = exams.map((e) => {
    const recs = DB.records.filter((r) => r.examId === e.id && r.classNo === classNo);
    if (recs.length === 0) return null;
    return +fmt(recs.reduce((a, b) => a + b.total, 0) / recs.length, 2);
  });
  const gradeTotalTrend = exams.map((e) => {
    const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade);
    if (recs.length === 0) return null;
    return +fmt(recs.reduce((a, b) => a + b.total, 0) / recs.length, 2);
  });

  // 学生个人进步/退步
  const last2 = exams.slice(-2);
  let studentTable = "";
  if (last2.length >= 2) {
    const [prevExam, currExam] = last2;
    const prevMap = {};
    DB.records.filter((r) => r.examId === prevExam.id && r.classNo === classNo).forEach((r) => { prevMap[r.studentId] = r.total; });
    const currRows = DB.records.filter((r) => r.examId === currExam.id && r.classNo === classNo);
    const studentRows = currRows.map((r) => {
      const prev = prevMap[r.studentId];
      const diff = prev != null ? r.total - prev : null;
      return { name: r.studentName, id: r.studentId, curr: r.total, prev, diff };
    }).sort((a, b) => (b.diff || 0) - (a.diff || 0));

    studentTable = `
      <div class="card"><div class="card-title">👨‍🎓 本班学生本次 vs 上次考试总分对比（${prevExam.name} → ${currExam.name}）</div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>学号</th><th>姓名</th><th>上次</th><th>本次</th><th>变化</th></tr></thead>
          <tbody>${studentRows.map((r) => `<tr><td>${r.id}</td><td><b>${r.name}</b></td><td>${r.prev != null ? r.prev : "-"}</td><td><b>${r.curr}</b></td>
            <td style="color:${r.diff == null ? "#999" : r.diff > 0 ? "green" : r.diff < 0 ? "red" : "#333"}"><b>${r.diff == null ? "-" : (r.diff > 0 ? "+" : "") + r.diff}</b></td></tr>`).join("")}</tbody>
        </table></div>
      </div>
    `;
  }

  $("pageContent").innerHTML = `
    <div class="card"><div class="card-title">🔍 ${classNo} 智能对比分析</div>
      <div class="analysis-text"><h4>💡 本班学情观察</h4>
        <p>• 已参与考试：${exams.length} 次</p>
        <p>• 覆盖学科：${subjects.map((s) => s.name).join("、") || "无"}</p>
        ${subjects.map((s) => {
          const data = subjectTrend.find((d) => d.label === s.name).data.filter((v) => v != null);
          if (data.length >= 2) {
            const diff = data[data.length - 1] - data[0];
            return `<p>• ${s.name}：首次均分 ${fmt(data[0], 2)} → 最近均分 ${fmt(data[data.length - 1], 2)}（${diff >= 0 ? "上升" : "下降"} ${fmt(Math.abs(diff), 2)}）</p>`;
          }
          return "";
        }).join("")}
      </div>
    </div>
    <div class="card"><div class="card-title">📈 本班各学科均分趋势</div>
      <div class="chart-box"><canvas id="chart1"></canvas></div>
    </div>
    <div class="card"><div class="card-title">📊 本班总分均分 vs 年级均分</div>
      <div class="chart-box"><canvas id="chart2"></canvas></div>
    </div>
    ${studentTable}
  `;
  setTimeout(() => {
    drawChart("chart1", "line", examLabels, subjectTrend);
    drawChart("chart2", "line", examLabels, [
      { label: classNo + " 总分均分", data: totalTrend, fill: true },
      { label: "年级总分均分", data: gradeTotalTrend, fill: true }
    ]);
  }, 50);
}

// 任课教师端：我的成绩 & 排行 & 分析
function renderMyScores() {
  if (currentUser.role !== "teacher") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const subjects = currentUser.subjects || [];
  const exams = getSortedExams(grade);

  // 我任教的学科：展示考试成绩（所有班级的均分对比）
  if (exams.length === 0 || subjects.length === 0) {
    $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-tip">暂无任教考试数据</div></div></div>`; return;
  }

  const sections = subjects.map((subjectName) => {
    const subject = (DB.subjects[grade] || []).find((s) => s.name === subjectName);
    if (!subject) return "";
    const examLabels = exams.map((e) => e.name);
    const classGroups = {};
    exams.forEach((e) => {
      const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade);
      recs.forEach((r) => {
        if (!classGroups[r.classNo]) classGroups[r.classNo] = [];
        const scores = r.scores; if (scores[subjectName] != null) classGroups[r.classNo].push({ exam: e.id, score: scores[subjectName] });
      });
    });
    const classes = Object.keys(classGroups).sort();
    const ds = classes.map((c) => ({
      label: c + " " + subjectName + "均分",
      data: exams.map((e) => {
        const recs = DB.records.filter((r) => r.examId === e.id && r.classNo === c);
        const vals = recs.map((r) => r.scores[subjectName]).filter((v) => v != null);
        if (vals.length === 0) return null;
        return +fmt(vals.reduce((a, b) => a + b, 0) / vals.length, 2);
      })
    }));
    return `<div class="card"><div class="card-title">📘 ${subjectName} - 各班级均分趋势</div>
      <div class="chart-box"><canvas id="chart_${subjectName}"></canvas></div>
      <div style="margin-top:12px;display:flex;gap:10px;justify-content:flex-end">
        <button class="btn btn-primary" onclick='window._downloadMySubject(${JSON.stringify(subjectName)},${JSON.stringify(grade)})'>⬇ 下载 ${subjectName} 明细</button>
      </div>
    </div>`;
  }).join("");

  $("pageContent").innerHTML = `
    <div class="card"><div class="card-title">📖 我的班级成绩</div>
      <p style="color:var(--text-light); margin-bottom:14px;">任教科目：<b>${subjects.join("、") || "（尚未分配）"}</b> · 年级：${grade}</p>
    </div>
    ${sections}
  `;
  setTimeout(() => {
    subjects.forEach((sn) => {
      const subject = (DB.subjects[grade] || []).find((s) => s.name === sn);
      if (!subject) return;
      const classes = [...new Set(DB.records.filter((r) => r.grade === grade).map((r) => r.classNo))].sort();
      const ds = classes.map((c) => ({
        label: c,
        data: exams.map((e) => {
          const recs = DB.records.filter((r) => r.examId === e.id && r.classNo === c);
          const vals = recs.map((r) => r.scores[sn]).filter((v) => v != null);
          if (vals.length === 0) return null;
          return +fmt(vals.reduce((a, b) => a + b, 0) / vals.length, 2);
        })
      }));
      drawChart("chart_" + sn, "line", exams.map((e) => e.name), ds);
    });
  }, 50);
}

window._downloadMySubject = function (subjectName, grade) {
  const rows = [["考试", "班级", "学号", "姓名", subjectName]];
  const recs = DB.records.filter((r) => r.grade === grade && r.scores[subjectName] != null);
  recs.forEach((r) => {
    const exam = DB.exams.find((e) => e.id === r.examId);
    rows.push([exam ? exam.name : "-", r.classNo, r.studentId, r.studentName, r.scores[subjectName]]);
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), subjectName);
  XLSX.writeFile(wb, `${subjectName}_任教成绩明细.xlsx`);
  showToast("已下载", "success");
};

function renderMyRanking() {
  if (currentUser.role !== "teacher") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const subjects = currentUser.subjects || [];
  const exams = getSortedExams(grade);

  if (exams.length === 0 || subjects.length === 0) {
    $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-tip">暂无排行数据</div></div></div>`; return;
  }

  let allRows = [];
  exams.forEach((e) => {
    const { rows } = computeTeacherRanking(e.id, grade);
    rows.forEach((r) => { r.examName = e.name; allRows.push(r); });
  });
  const myRows = allRows.filter((r) => subjects.indexOf(r.subject) >= 0 && r.teacherName === currentUser.name);

  $("pageContent").innerHTML = `
    <div class="card"><div class="card-title">🏅 我的排行信息 - ${currentUser.name}</div>
      <p style="color:var(--text-light); margin-bottom:14px;">任教科目：${subjects.join("、") || "暂无"}</p>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>考试</th><th>学科</th><th>班级</th><th>人数</th><th>均分</th><th>优秀率</th><th>及格率</th><th>综合分数</th><th>学科内名次</th></tr></thead>
        <tbody>${myRows.map((r) => `<tr class="${r.rank === 1 ? "rank-top" : ""}">
          <td>${r.examName}</td><td><b>${r.subject}</b></td><td>${r.classNo}</td>
          <td>${r.total}</td><td>${fmt(r.avg)}</td>
          <td>${fmtPct(r.excellentPct)}</td><td>${fmtPct(r.passPct)}</td>
          <td><b>${fmt(r.compositeScore * 100, 2)}</b></td><td><b>${r.rank}</b></td>
        </tr>`).join("") || `<tr><td colspan="9"><div class="empty-state"><div class="es-tip">暂无我的排行数据，等待教务老师推送</div></div></td></tr>`}</tbody>
      </table></div>
    </div>
  `;
}

function renderTeacherAnalysis() {
  if (currentUser.role !== "teacher") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const subjects = currentUser.subjects || [];
  const exams = getSortedExams(grade);
  if (exams.length === 0 || subjects.length === 0) {
    $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-tip">暂无数据</div></div></div>`; return;
  }

  // 对我任教的每个学科，计算其参与班级的历次均分
  const sections = subjects.map((subjectName) => {
    const classes = [...new Set(DB.records.filter((r) => r.grade === grade).map((r) => r.classNo))].sort();
    if (classes.length === 0) return "";
    const examLabels = exams.map((e) => e.name);
    // 该学科各班级均分趋势
    const ds = classes.map((c) => ({
      label: c,
      data: exams.map((e) => {
        const recs = DB.records.filter((r) => r.examId === e.id && r.classNo === c);
        const vals = recs.map((r) => r.scores[subjectName]).filter((v) => v != null);
        if (vals.length === 0) return null;
        return +fmt(vals.reduce((a, b) => a + b, 0) / vals.length, 2);
      })
    }));
    return `<div class="card"><div class="card-title">📊 ${subjectName} - 多班级均分对比</div>
      <div class="chart-box"><canvas id="tchart_${subjectName}"></canvas></div>
    </div>`;
  }).join("");

  $("pageContent").innerHTML = `
    <div class="card"><div class="card-title">🔍 学科对比分析</div>
      <div class="analysis-text"><h4>💡 教学提示</h4>
        <p>• 任教科目：${subjects.join("、") || "（尚未分配）"}</p>
        <p>• 您可通过下方图表横向对比各班级的学科成绩走势，及早发现异常班级并调整教学策略。</p>
      </div>
    </div>
    ${sections}
  `;
  setTimeout(() => {
    subjects.forEach((subjectName) => {
      const classes = [...new Set(DB.records.filter((r) => r.grade === grade).map((r) => r.classNo))].sort();
      const ds = classes.map((c) => ({
        label: c,
        data: exams.map((e) => {
          const recs = DB.records.filter((r) => r.examId === e.id && r.classNo === c);
          const vals = recs.map((r) => r.scores[subjectName]).filter((v) => v != null);
          if (vals.length === 0) return null;
          return +fmt(vals.reduce((a, b) => a + b, 0) / vals.length, 2);
        })
      }));
      drawChart("tchart_" + subjectName, "line", exams.map((e) => e.name), ds);
    });
  }, 50);
}

