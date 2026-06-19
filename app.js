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
  // 1. 优先从双 Gist 加载（主 Gist 配置 + 业务 Gist 成绩）
  if (GitHubService.isConfigured()) {
    const remote = await GitHubService.loadRemoteDB();
    if (remote) {
      localStorage.setItem(DB_KEY, JSON.stringify(remote));
      return remote;
    }
  }
  // 2. 回退到本地浏览器缓存
  let db = localStorage.getItem(DB_KEY);
  if (!db) {
    db = initDefaultDB();
    // 若 Gist 已配置，则同步默认数据上去
    if (GitHubService.isConfigured()) {
      _skipGitHubSync = true;
      await GitHubService.saveRemoteDB(db);
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
  // 异步同步到双 Gist：主 Gist 存配置，业务 Gist 存成绩
  if (GitHubService.isConfigured() && !_skipGitHubSync) {
    GitHubService.saveRemoteDB(db).catch(err => console.log("Gist sync error:", err));
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
    rankSends: [],
    groups: {}
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
    {
      group: "概览", icon: "🏠", items: [
        { id: "dashboard", icon: "📊", text: "平台概览" }
      ]
    },
    {
      group: "人员管理", icon: "👥", items: [
        { id: "users", icon: "👤", text: "教师名单管理" },
        { id: "permissions", icon: "🔐", text: "权限管理" }
      ]
    },
    {
      group: "教学设置", icon: "🎓", items: [
        { id: "grades", icon: "🏫", text: "年级设置" },
        { id: "exams", icon: "📝", text: "考试管理" }
      ]
    },
    {
      group: "公告消息", icon: "📢", items: [
        { id: "announcements_all", icon: "📢", text: "公告管理" }
      ]
    }
  ],
  academic: [
    {
      group: "概览", icon: "🏠", items: [
        { id: "dashboard", icon: "📊", text: "工作首页" }
      ]
    },
    {
      group: "基础设置", icon: "⚙️", items: [
        { id: "subjects", icon: "📚", text: "学科/分值设置" },
        { id: "exams", icon: "📝", text: "考试管理" }
      ]
    },
    {
      group: "成绩汇总", icon: "📈", items: [
        { id: "grade_summary", icon: "📈", text: "年级成绩汇总" },
        { id: "class_ranking", icon: "🏆", text: "全年级排名" },
        { id: "teacher_ranking", icon: "🎖️", text: "教师排行榜" }
      ]
    },
    {
      group: "成绩分析", icon: "🔍", items: [
        { id: "academic_analysis", icon: "🔍", text: "全平台智能分析" },
        { id: "exam_compare", icon: "🔄", text: "多次考试对比分析" }
      ]
    },
    {
      group: "消息发送", icon: "📨", items: [
        { id: "send_scores", icon: "📨", text: "发送班级成绩" },
        { id: "send_rank", icon: "📤", text: "发送教师排行" },
        { id: "announcement", icon: "📢", text: "消息播报" }
      ]
    }
  ],
  teacher: [
    {
      group: "概览", icon: "🏠", items: [
        { id: "dashboard", icon: "📊", text: "工作首页" }
      ]
    },
    {
      group: "我的成绩", icon: "📖", items: [
        { id: "my_scores", icon: "📖", text: "我的班级成绩" },
        { id: "my_ranking", icon: "🏅", text: "我的排行信息" }
      ]
    },
    {
      group: "数据分析", icon: "📊", items: [
        { id: "teacher_analysis", icon: "🔍", text: "学科对比分析" },
        { id: "exam_compare", icon: "🔄", text: "多次考试对比分析" },
        { id: "group_scores", icon: "👥", text: "小组成绩分析" },
        { id: "custom_analysis", icon: "⚙️", text: "自定义分析" }
      ]
    }
  ],
  headteacher: [
    {
      group: "概览", icon: "🏠", items: [
        { id: "dashboard", icon: "📊", text: "工作首页" }
      ]
    },
    {
      group: "班级成绩", icon: "📖", items: [
        { id: "upload_scores", icon: "📥", text: "上传班级成绩" },
        { id: "my_class_scores", icon: "📖", text: "本班考试成绩" },
        { id: "class_ranking", icon: "🏆", text: "本班排名统计" },
        { id: "download_scores", icon: "📤", text: "下载Excel成绩" }
      ]
    },
    {
      group: "数据分析", icon: "📊", items: [
        { id: "headteacher_analysis", icon: "🔍", text: "本班智能对比分析" },
        { id: "exam_compare", icon: "🔄", text: "多次考试对比分析" }
      ]
    },
    {
      group: "小组管理", icon: "👥", items: [
        { id: "group_manage", icon: "👥", text: "学习小组管理" }
      ]
    }
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

// 翻转卡片：Gist 配置面板
if ($("btnGistSetup")) {
  $("btnGistSetup").onclick = () => GitHubService.showLoginSetup();
}
if ($("gistSaveBtn")) {
  $("gistSaveBtn").onclick = () => GitHubService.applyLoginSetup();
}
if ($("gistBackBtn")) {
  $("gistBackBtn").onclick = () => GitHubService.flipBackToLogin();
}

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
      <div class="card-title">🔗 Gist 数据存储配置</div>
      <div class="form-row">
        <div class="form-group"><label>GitHub Token</label><input type="password" id="gd_token" value="${cfg.token || ""}" placeholder="ghp_xxxxx" /></div>
        <div class="form-group"><label>Gist ID</label><input id="gd_gist_id" value="${cfg.gistId || ""}" placeholder="a1b2c3d4e5f6...（留空则保存时自动创建）" /></div>
      </div>
      <div style="font-size:13px;color:var(--text-light);margin:4px 0 12px 0">
        💡 在 Gist URL https://gist.github.com/username/<b>最后一段</b> 就是 Gist ID。
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-success" id="gd_save">💾 保存配置</button>
        <button class="btn btn-primary" id="gd_sync_now">🔄 立即同步到 Gist</button>
        <button class="btn btn-info" id="gd_load">📥 从 Gist 拉取数据</button>
        <button class="btn btn-secondary" id="gd_test">🧪 测试连接</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">📊 同步状态</div>
      <div id="gd_sync_info" style="padding:12px;background:#f8f9fc;border-radius:8px;font-size:13px;color:var(--text-light)">
        <p>• 当前状态：${gs.isConfigured() ? `<b style="color:var(--success)">✅ 已配置</b>` : `<b style="color:var(--danger)">⚠️ 未配置</b>`}</p>
        <p>• Token：${cfg.token ? "✅ 已设置" : "❌ 未设置"}</p>
        <p>• Gist ID：<code>${cfg.gistId || "未设置（保存时自动创建）"}</code></p>
      </div>
    </div>

    <div class="card">
      <div class="card-title">📋 同步日志（最近 30 条）</div>
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
        <p>• 建议 Token 权限设置为 <b>最小权限</b>（仅勾选 gist 权限即可，禁用其他所有权限）。</p>
        <p>• 建议尽快在 GitHub 设置中 <b>撤销此 Token</b>，并定期更换。</p>
        <p>• 生产环境推荐通过后端服务器持有 Token，前端仅调用接口。</p>
      </div>
    </div>
  `;

  $("gd_save").onclick = () => {
    const token = $("gd_token").value.trim();
    const gistId = $("gd_gist_id").value.trim();
    gs.saveGistConfig(token, gistId);
    showToast("配置已保存", "success");
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
    if (!tempToken) { showToast("请先填写 Token", "error"); return; }
    try {
      const res = await fetch(`https://api.github.com/gists?per_page=1`, {
        headers: { Authorization: `Bearer ${tempToken}`, Accept: "application/vnd.github+json" }
      });
      if (res.ok) {
        const data = await res.json();
        const count = Array.isArray(data) ? data.length : 0;
        showToast(`✅ Token 有效！可访问 ${count > 0 ? "Gist" : "账号"}`, "success");
      } else {
        showToast(`❌ 连接失败：HTTP ${res.status}（请确认 Token 勾选了 gist 权限）`, "error");
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
  const groups = NAV_MENUS[currentUser.role] || [];
  // 平铺所有 items，便于 navigate 查找
  const allItems = groups.flatMap((g) => g.items);

  let html = `<div class="nav-group-title">功能导航</div>`;
  groups.forEach((g, gi) => {
    const firstGroup = gi === 0;
    html += `
      <div class="nav-group ${firstGroup ? "open" : ""}">
        <div class="nav-group-header" data-group="${gi}">
          <span class="ng-icon">${esc(g.icon || "")}</span>
          <span class="ng-name">${esc(g.group)}</span>
          <span class="ng-arrow">▸</span>
        </div>
        <div class="nav-group-items">
          ${g.items.map((m) => `<div class="nav-item" data-id="${m.id}"><span class="nav-icon">${esc(m.icon)}</span><span class="nav-text">${esc(m.text)}</span></div>`).join("")}
        </div>
      </div>
    `;
  });
  $("navMenu").innerHTML = html;

  // 展开/折叠分组
  $("navMenu").querySelectorAll(".nav-group-header").forEach((el) => {
    el.onclick = () => el.parentElement.classList.toggle("open");
  });
  // 点击菜单项
  $("navMenu").querySelectorAll(".nav-item").forEach((el) => {
    el.onclick = () => navigate(el.dataset.id);
  });
  // 高亮当前页
  if (currentPage) {
    const active = $("navMenu").querySelector(`.nav-item[data-id="${currentPage}"]`);
    if (active) {
      active.classList.add("active");
      const group = active.closest(".nav-group");
      if (group) group.classList.add("open");
    }
  }
}

async function navigate(pageId) {
  currentPage = pageId;
  $("navMenu").querySelectorAll(".nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.id === pageId);
  });
  const groups = NAV_MENUS[currentUser.role] || [];
  const allItems = groups.flatMap((g) => g.items);
  const menu = allItems.find((m) => m.id === pageId);
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
  // 用无缝滚动容器：内容重复一份，形成循环
  const textContent = list.map((a) => `📢 【${a.title}】${a.content}`).join("　　·　　");
  $("announcementContent").innerHTML = `
    <div class="marquee-track">
      <span class="marquee-text">${esc(textContent)}　　　　</span>
      <span class="marquee-text" aria-hidden="true">${esc(textContent)}　　　　</span>
    </div>
  `;
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
  exam_compare: renderExamCompare,
  group_manage: renderGroupManage,
  group_scores: renderGroupScores,
  custom_analysis: renderCustomAnalysis
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
        <span class="ct-actions">
          <button class="btn btn-primary" onclick="downloadTeacherTemplate()">📥 下载模板</button>
          <button class="btn btn-warning" onclick="showBatchUploadModal()">📤 批量上传</button>
          <button class="btn btn-success" onclick="editUser(null)">+ 添加教师</button>
        </span>
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>账号</th><th>姓名</th><th>角色</th><th>所属年级</th><th>班级</th><th>任教学科</th><th>加入时间</th><th>操作</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8"><div class="empty-state"><div class="es-tip">暂无教师，点击右上角添加</div></div></td></tr>`}</tbody>
      </table></div>
    </div>
  `;
}

// 下载教师批量上传模板
window.downloadTeacherTemplate = function () {
  const data = [
    ["账号", "姓名", "角色", "所属年级", "班级", "任教学科"],
    ["zhangsan", "张三", "班主任", "高一年级", "1班", ""],
    ["lisi", "李四", "任课教师", "高一年级", "", "数学,物理"],
    ["wangwu", "王五", "教务老师", "高一年级", "", ""]
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  // 设置列宽
  ws["!cols"] = [{ wch: 15 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws, "教师名单");
  XLSX.writeFile(wb, "教师批量上传模板.xlsx");
  showToast("模板已下载", "success");
};

// 批量上传教师弹窗
window.showBatchUploadModal = function () {
  showModal("📤 批量上传教师", `
    <div style="margin-bottom:16px;padding:16px;background:#f0f7ff;border-radius:8px;font-size:13px">
      <p style="margin-bottom:8px"><b>📋 Excel 格式要求：</b></p>
      <p style="color:#666">• 第一行为表头：账号、姓名、角色、所属年级、班级、任教学科</p>
      <p style="color:#666">• 角色可选：<b>班主任</b>、<b>任课教师</b>、<b>教务老师</b></p>
      <p style="color:#666">• 班级：仅班主任需要填写，如 1班、2班</p>
      <p style="color:#666">• 任教学科：仅任课教师需要填写，多个用逗号分隔，如 数学,物理</p>
      <p style="color:#666">• 默认密码：<b>123456</b></p>
    </div>
    <div class="form-group">
      <label>选择 Excel 文件</label>
      <input type="file" id="batch_teacher_file" accept=".xlsx,.xls,.csv" style="padding:8px" />
    </div>
  `, "开始上传", () => {
    const fileInput = $("batch_teacher_file");
    if (!fileInput.files[0]) { showToast("请选择文件", "error"); return false; }
    const file = fileInput.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        // 解析数据
        if (json.length < 2) { showToast("文件内容为空或格式不正确", "error"); return false; }
        const headers = json[0].map((h) => String(h || "").trim());
        const requiredCols = ["账号", "姓名", "角色"];
        const missing = requiredCols.filter((c) => !headers.includes(c));
        if (missing.length > 0) { showToast(`缺少必填列：${missing.join("、")}`, "error"); return false; }
        const idx = (name) => headers.indexOf(name);
        const roleMap = { "班主任": "headteacher", "任课教师": "teacher", "教务老师": "academic" };
        const grades = Object.keys(DB.subjects);
        let added = 0, skipped = 0, errors = [];
        for (let i = 1; i < json.length; i++) {
          const row = json[i];
          if (!row[idx("账号")] || !row[idx("姓名")] || !row[idx("角色")]) { skipped++; continue; }
          const username = String(row[idx("账号")] || "").trim();
          const name = String(row[idx("姓名")] || "").trim();
          const roleKey = String(row[idx("角色")] || "").trim();
          const role = roleMap[roleKey];
          if (!role) { errors.push(`第${i + 1}行：角色"${roleKey}"不正确`); skipped++; continue; }
          const grade = String(row[idx("所属年级")] || "").trim();
          const classNo = String(row[idx("班级")] || "").trim();
          const subjectsStr = String(row[idx("任教学科")] || "").trim();
          const subjects = subjectsStr ? subjectsStr.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [];
          if (DB.users.some((u) => u.username === username)) { errors.push(`第${i + 1}行：账号"${username}"已存在`); skipped++; continue; }
          DB.users.push({ id: uid(), username, password: "123456", name, role, grade: grade || null, classNo: classNo || null, subjects, createdAt: Date.now() });
          added++;
        }
        saveDB(DB);
        showToast(`成功添加 ${added} 人${skipped > 0 ? `，跳过 ${skipped} 行` : ""}`, added > 0 ? "success" : "warning");
        if (errors.length > 0) { showToast(errors.slice(0, 3).join("；"), "warning", 4000); }
        renderUsers();
      } catch (err) {
        showToast("文件解析失败：" + err.message, "error");
      }
    };
    reader.readAsArrayBuffer(file);
    return true;
  });
};

window.editUser = function (id) {
  const u = id ? DB.users.find((x) => x.id === id) : null;
  const grades = Object.keys(DB.subjects);
  const html = `
    <div class="edit-user-form">
      <div class="user-form-row">
        <div class="form-group"><label>账号（登录用户名）</label>
          <input id="m_username" value="${esc(u?.username || "")}" ${u ? "readonly" : ""} placeholder="例如：zhangsan" />
        </div>
        <div class="form-group"><label>姓名</label>
          <input id="m_name" value="${esc(u?.name || "")}" placeholder="教师姓名" />
        </div>
      </div>

      <div class="user-form-row">
        <div class="form-group"><label>角色</label>
          <select id="m_role">
            <option value="academic" ${u?.role === "academic" ? "selected" : ""}>教务老师</option>
            <option value="teacher" ${u?.role === "teacher" ? "selected" : ""}>任课教师</option>
            <option value="headteacher" ${u?.role === "headteacher" ? "selected" : ""}>班主任</option>
          </select>
        </div>
        <div class="form-group"><label>${u ? "新密码（留空则不修改）" : "初始密码"}</label>
          <input id="m_password" type="text" placeholder="${u ? "留空保持原密码" : "默认 123456"}" value="${u ? "" : "123456"}" />
        </div>
      </div>

      <div class="user-form-row">
        <div class="form-group"><label>所属年级</label>
          <select id="m_grade">${grades.map((g) => `<option ${u?.grade === g ? "selected" : ""}>${esc(g)}</option>`).join("")}${grades.length === 0 ? `<option>请先添加年级</option>` : ""}</select>
        </div>
        <div class="form-group"><label>班级（班主任必填）</label>
          <input id="m_class" value="${esc(u?.classNo || "")}" placeholder="如 1班 / 2班" />
        </div>
      </div>

      <div class="form-group"><label>任教学科（逗号分隔，任课教师必填）</label>
        <input id="m_subjects" value="${esc((u?.subjects || []).join(","))}" placeholder="如 语文,数学,英语" />
      </div>

      <div class="user-form-tip">
        <span>💡</span>
        <span>新教师登录账号为上方"账号"，初始密码可自定义，默认 <b>123456</b>。</span>
      </div>
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
// ========== 教务：全平台智能分析（独立页面） ==========
function renderAcademicAnalysis() {
  if (currentUser.role !== "academic") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const exams = getSortedExams(grade);
  if (exams.length === 0) { $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-icon">📊</div><div class="es-title">暂无考试数据</div><div class="es-tip">请先创建考试并上传成绩</div></div></div>`; return; }

  const subjects = DB.subjects[grade] || [];

  // 考试选择器
  const examOptions = exams.map((e, i) => `<option value="${e.id}" ${i === exams.length - 1 ? "selected" : ""}>${esc(e.name)}</option>`).join("");

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">
        <span>🔍 全年级智能对比分析</span>
        <span class="ct-actions">
          <select id="aa_exam_select" style="padding:6px 12px;border:1px solid #ddd;border-radius:6px;margin-right:10px">${examOptions}</select>
          <button class="btn btn-primary" onclick="downloadAcademicAnalysis()">📥 下载完整分析报告</button>
        </span>
      </div>
    </div>
    <div class="card"><div class="card-title">💡 AI 智能洞察</div>
      <div id="aa_insights" class="analysis-text"></div>
    </div>
    <div class="card"><div class="card-title">📈 各学科均分趋势</div><div class="chart-box"><canvas id="aa_chart1"></canvas></div></div>
    <div class="card"><div class="card-title">📊 各学科及格率趋势</div><div class="chart-box"><canvas id="aa_chart2"></canvas></div></div>
    <div class="card"><div class="card-title">🏆 各学科优秀率趋势</div><div class="chart-box"><canvas id="aa_chart3"></canvas></div></div>
    <div id="aa_class_compare_card"></div>
    <div id="aa_subject_detail_card"></div>
  `;

  $("aa_exam_select").addEventListener("change", () => refreshAcademicAnalysis());

  // 初始加载
  setTimeout(() => refreshAcademicAnalysis(), 50);
}

function refreshAcademicAnalysis() {
  const grade = currentUser.grade;
  const examId = $("aa_exam_select").value;
  const exams = getSortedExams(grade);
  const selectedExam = exams.find((e) => e.id === examId) || exams[exams.length - 1];
  const subjects = DB.subjects[grade] || [];

  // 各学科均分趋势
  const examLabels = exams.map((e) => e.name);
  const avgDatasets = subjects.map((s) => ({
    label: s.name,
    data: exams.map((e) => {
      const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade);
      if (!recs.length) return null;
      const st = aggregateStats(recs, [s])[s.name];
      return +fmt(st.avg, 2);
    })
  }));

  // 及格率趋势
  const passDatasets = subjects.map((s) => ({
    label: s.name,
    data: exams.map((e) => {
      const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade);
      if (!recs.length) return null;
      const st = aggregateStats(recs, [s])[s.name];
      return +fmt(st.passPct * 100, 2);
    })
  }));

  // 优秀率趋势
  const excDatasets = subjects.map((s) => ({
    label: s.name,
    data: exams.map((e) => {
      const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade);
      if (!recs.length) return null;
      const st = aggregateStats(recs, [s])[s.name];
      return +fmt(st.excellentPct * 100, 2);
    })
  }));

  // 班级对比
  const latestRecs = DB.records.filter((r) => r.examId === selectedExam.id && r.grade === grade);
  const allRecs = DB.records.filter((r) => r.examId === selectedExam.id && r.grade === grade);
  const classTotals = {};
  allRecs.forEach((r) => {
    if (!classTotals[r.classNo]) classTotals[r.classNo] = [];
    classTotals[r.classNo].push(r.total);
  });
  const classLabels = Object.keys(classTotals).sort();
  const classAvg = classLabels.map((c) => +fmt(classTotals[c].reduce((a, b) => a + b, 0) / classTotals[c].length, 2));

  // AI 洞察
  let insights = [];
  subjects.forEach((s) => {
    const trend = avgDatasets.find((d) => d.label === s.name).data.filter((v) => v != null);
    if (trend.length >= 2) {
      const diff = +fmt(trend[trend.length - 1] - trend[trend.length - 2], 2);
      if (Math.abs(diff) > 0.5) insights.push(`【${s.name}】均分较上次${diff > 0 ? "📈上升" : "📉下降"} ${fmt(Math.abs(diff), 2)} 分`);
    }
    const passTrend = passDatasets.find((d) => d.label === s.name).data.filter((v) => v != null);
    if (passTrend.length >= 2) {
      const pdiff = +fmt(passTrend[passTrend.length - 1] - passTrend[passTrend.length - 2], 2);
      if (Math.abs(pdiff) > 2) insights.push(`【${s.name}】及格率${pdiff > 0 ? "📈提升" : "📉下降"} ${fmt(Math.abs(pdiff), 1)}%`);
    }
  });
  if (classLabels.length > 0) {
    const maxIdx = classAvg.indexOf(Math.max(...classAvg));
    const minIdx = classAvg.indexOf(Math.min(...classAvg));
    insights.push(`🏫 ${classLabels[maxIdx]} 总分均分最高（${classAvg[maxIdx]}），${classLabels[minIdx]} 最低（${classAvg[minIdx]}），差距 ${fmt(classAvg[maxIdx] - classAvg[minIdx], 2)} 分`);
  }
  $("aa_insights").innerHTML = insights.length ? insights.map((i) => `<p>• ${i}</p>`).join("") : "<p>暂无足够数据生成洞察</p>";

  // 渲染图表
  drawChart("aa_chart1", "line", examLabels, avgDatasets);
  drawChart("aa_chart2", "line", examLabels, passDatasets);
  drawChart("aa_chart3", "line", examLabels, excDatasets);

  // 班级对比卡片
  const classCompareHTML = `<div class="card"><div class="card-title">📊 ${esc(selectedExam.name)} 班级总分均分对比</div><div class="chart-box"><canvas id="aa_chart4"></canvas></div></div>`;
  $("aa_class_compare_card").innerHTML = classCompareHTML;
  setTimeout(() => {
    drawChart("aa_chart4", "bar", classLabels, [{ label: "班级总分均分", data: classAvg, backgroundColor: "rgba(59,130,246,0.7)" }]);
  }, 100);

  // 学科详情表
  const subjectDetailRows = subjects.map((s) => {
    const recs = DB.records.filter((r) => r.examId === selectedExam.id && r.grade === grade);
    if (!recs.length) return null;
    const st = aggregateStats(recs, [s])[s.name];
    return `<tr>
      <td><b>${esc(s.name)}</b></td>
      <td>${fmt(st.avg, 2)}</td><td>${fmt(st.max, 2)}</td><td>${fmt(st.min, 2)}</td>
      <td>${fmt(st.passPct * 100, 1)}%</td><td>${st.passCount}</td>
      <td>${fmt(st.excellentPct * 100, 1)}%</td><td>${st.excellent}</td>
      <td>${fmt(st.goodPct * 100, 1)}%</td><td>${st.good}</td>
      <td>${fmt(st.lowPct * 100, 1)}%</td><td>${st.low}</td>
      <td>${st.total}</td>
    </tr>`;
  }).filter(Boolean).join("");

  $("aa_subject_detail_card").innerHTML = `<div class="card">
    <div class="card-title">📋 ${esc(selectedExam.name)} 各学科详细统计</div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>学科</th><th>平均分</th><th>最高分</th><th>最低分</th><th>及格率</th><th>及格人数</th><th>优秀率</th><th>优秀人数</th><th>良好率</th><th>良好人数</th><th>低分率</th><th>低分人数</th><th>考试人数</th></tr></thead>
      <tbody>${subjectDetailRows || `<tr><td colspan="12"><div class="empty-state"><div class="es-tip">暂无数据</div></div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}

// 下载教务分析报告
window.downloadAcademicAnalysis = function () {
  const grade = currentUser.grade;
  const exams = getSortedExams(grade);
  if (!exams.length) { showToast("暂无考试数据", "warning"); return; }
  const subjects = DB.subjects[grade] || [];
  const selectedExamId = $("aa_exam_select")?.value || exams[exams.length - 1].id;
  const selectedExam = exams.find((e) => e.id === selectedExamId) || exams[exams.length - 1];

  const wb = XLSX.utils.book_new();

  // Sheet 1: 各学科各考试均分
  const avgHeader = ["学科", ...exams.map((e) => e.name)];
  const avgData = subjects.map((s) => {
    const row = [s.name];
    exams.forEach((e) => {
      const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade);
      const st = aggregateStats(recs, [s])[s.name];
      row.push(recs.length ? fmt(st.avg, 2) : "-");
    });
    return row;
  });
  const ws1 = XLSX.utils.aoa_to_sheet([avgHeader, ...avgData]);
  XLSX.utils.book_append_sheet(wb, ws1, "学科均分趋势");

  // Sheet 2: 各考试各率统计
  const rateHeader = ["考试名称", "科目", "平均分", "最高分", "最低分", "及格率", "及格人数", "优秀率", "优秀人数", "良好率", "良好人数", "低分率", "低分人数", "考试人数"];
  const rateData = [];
  exams.forEach((e) => {
    subjects.forEach((s) => {
      const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade);
      if (!recs.length) return;
      const st = aggregateStats(recs, [s])[s.name];
      rateData.push([e.name, s.name, fmt(st.avg, 2), fmt(st.max, 2), fmt(st.min, 2), fmt(st.passPct * 100, 1) + "%", st.passCount, fmt(st.excellentPct * 100, 1) + "%", st.excellent, fmt(st.goodPct * 100, 1) + "%", st.good, fmt(st.lowPct * 100, 1) + "%", st.low, st.total]);
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([rateHeader, ...rateData]), "各科详细统计");

  // Sheet 3: 班级对比
  const classRecs = DB.records.filter((r) => r.examId === selectedExam.id && r.grade === grade);
  const classTotals = {};
  classRecs.forEach((r) => { if (!classTotals[r.classNo]) classTotals[r.classNo] = []; classTotals[r.classNo].push(r.total); });
  const classHeader = ["班级", "考试人数", "总分均分", "总分最高", "总分最低", "语文均分", "数学均分", "英语均分", "综合均分"];
  const classData = Object.keys(classTotals).sort().map((c) => {
    const recs = classRecs.filter((r) => r.classNo === c);
    const avg = classTotals[c].reduce((a, b) => a + b, 0) / classTotals[c].length;
    const subjs = subjects.map((s) => { const st = aggregateStats(recs, [s])[s.name]; return fmt(st.avg, 2); });
    return [c, recs.length, fmt(avg, 2), fmt(Math.max(...classTotals[c]), 2), fmt(Math.min(...classTotals[c]), 2), ...subjs];
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([classHeader, ...classData]), "班级对比");

  XLSX.writeFile(wb, `${grade}_成绩分析报告_${selectedExam.name}.xlsx`);
  showToast("分析报告已下载", "success");
};

// ========== 班主任：班级智能分析（独立页面） ==========
function renderHeadteacherAnalysis() {
  if (currentUser.role !== "headteacher") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const classNo = currentUser.classNo;
  const exams = getSortedExams(grade);
  if (exams.length === 0) { $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-icon">📊</div><div class="es-title">暂无考试</div><div class="es-tip">请先上传成绩</div></div></div>`; return; }

  const subjects = DB.subjects[grade] || [];
  const examOptions = exams.map((e, i) => `<option value="${e.id}" ${i === exams.length - 1 ? "selected" : ""}>${esc(e.name)}</option>`).join("");

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">
        <span>🔍 ${esc(classNo)} 智能对比分析</span>
        <span class="ct-actions">
          <select id="ht_exam_select" style="padding:6px 12px;border:1px solid #ddd;border-radius:6px;margin-right:10px">${examOptions}</select>
          <button class="btn btn-primary" onclick="downloadHeadteacherAnalysis()">📥 下载班级分析报告</button>
        </span>
      </div>
    </div>
    <div class="card"><div class="card-title">💡 本班学情观察</div><div id="ht_insights" class="analysis-text"></div></div>
    <div class="card"><div class="card-title">📈 本班各学科均分趋势</div><div class="chart-box"><canvas id="ht_chart1"></canvas></div></div>
    <div class="card"><div class="card-title">📊 本班总分均分 vs 年级均分</div><div class="chart-box"><canvas id="ht_chart2"></canvas></div></div>
    <div id="ht_student_card"></div>
    <div id="ht_detail_card"></div>
  `;

  $("ht_exam_select").addEventListener("change", () => refreshHeadteacherAnalysis());
  setTimeout(() => refreshHeadteacherAnalysis(), 50);
}

function refreshHeadteacherAnalysis() {
  const grade = currentUser.grade;
  const classNo = currentUser.classNo;
  const examId = $("ht_exam_select").value;
  const exams = getSortedExams(grade);
  const selectedExam = exams.find((e) => e.id === examId) || exams[exams.length - 1];
  const subjects = DB.subjects[grade] || [];

  const examLabels = exams.map((e) => e.name);
  const subjectTrend = subjects.map((s) => ({
    label: s.name,
    data: exams.map((e) => {
      const recs = DB.records.filter((r) => r.examId === e.id && r.classNo === classNo);
      if (!recs.length) return null;
      return +fmt(aggregateStats(recs, [s])[s.name].avg, 2);
    })
  }));

  const totalTrend = exams.map((e) => {
    const recs = DB.records.filter((r) => r.examId === e.id && r.classNo === classNo);
    if (!recs.length) return null;
    return +fmt(recs.reduce((a, b) => a + b.total, 0) / recs.length, 2);
  });
  const gradeTotalTrend = exams.map((e) => {
    const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade);
    if (!recs.length) return null;
    return +fmt(recs.reduce((a, b) => a + b.total, 0) / recs.length, 2);
  });

  // AI 洞察
  let insights = [`• 已参与考试：${exams.length} 次`, `• 覆盖学科：${subjects.map((s) => s.name).join("、") || "无"}`];
  subjects.forEach((s) => {
    const data = subjectTrend.find((d) => d.label === s.name).data.filter((v) => v != null);
    if (data.length >= 2) {
      const diff = +fmt(data[data.length - 1] - data[0], 2);
      insights.push(`• ${s.name}：首次均分 ${fmt(data[0], 2)} → 最近均分 ${fmt(data[data.length - 1], 2)}（${diff >= 0 ? "📈上升" : "📉下降"} ${fmt(Math.abs(diff), 2)}）`);
    }
  });
  const latestClassAvg = totalTrend.filter((v) => v != null).slice(-1)[0];
  const latestGradeAvg = gradeTotalTrend.filter((v) => v != null).slice(-1)[0];
  if (latestClassAvg && latestGradeAvg) {
    const gap = +fmt(latestClassAvg - latestGradeAvg, 2);
    insights.push(`• 班级 vs 年级：本次班级均分 ${latestClassAvg}，年级均分 ${latestGradeAvg}，${gap >= 0 ? "📈高出年级" : "📉低于年级"} ${fmt(Math.abs(gap), 2)} 分`);
  }
  $("ht_insights").innerHTML = insights.map((i) => `<p>${i}</p>`).join("");

  drawChart("ht_chart1", "line", examLabels, subjectTrend);
  drawChart("ht_chart2", "line", examLabels, [
    { label: `${classNo} 总分均分`, data: totalTrend, backgroundColor: "rgba(59,130,246,0.7)" },
    { label: "年级总分均分", data: gradeTotalTrend, backgroundColor: "rgba(16,185,129,0.5)" }
  ]);

  // 学生个人进步/退步
  const last2 = exams.slice(-2);
  let studentCard = "";
  if (last2.length >= 2) {
    const [prevExam, currExam] = last2;
    const prevMap = {};
    DB.records.filter((r) => r.examId === prevExam.id && r.classNo === classNo).forEach((r) => { prevMap[r.studentId] = r; });
    const currRows = DB.records.filter((r) => r.examId === currExam.id && r.classNo === classNo);
    const studentRows = currRows.map((r) => {
      const prev = prevMap[r.studentId];
      const diff = prev ? r.total - prev.total : null;
      return { ...r, prevTotal: prev?.total, diff };
    }).sort((a, b) => (b.diff || 0) - (a.diff || 0));

    const top3 = studentRows.slice(0, 3).map((r) => `${r.studentName}(${r.total})`).join("、");
    const bottom3 = studentRows.slice(-3).map((r) => `${r.studentName}(${r.total})`).join("、");
    insights.push(`• 本次考试：最高分 ${studentRows[0]?.total}，最低分 ${studentRows[studentRows.length - 1]?.total}`);
    insights.push(`• 进步最快：${top3}`);
    insights.push(`• 需关注学生：${bottom3}`);
    $("ht_insights").innerHTML = insights.map((i) => `<p>${i}</p>`).join("");

    studentCard = `<div class="card"><div class="card-title">👨‍🎓 本班学生进步/退步分析（${esc(prevExam.name)} → ${esc(currExam.name)}）</div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>排名</th><th>学号</th><th>姓名</th><th>上次总分</th><th>本次总分</th><th>变化</th></tr></thead>
        <tbody>${studentRows.map((r, idx) => `<tr>
          <td>${idx + 1}</td><td>${esc(r.studentId)}</td><td><b>${esc(r.studentName)}</b></td>
          <td>${r.prevTotal != null ? r.prevTotal : "-"}</td><td><b>${r.total}</b></td>
          <td style="color:${r.diff == null ? '#999' : r.diff > 0 ? 'green' : r.diff < 0 ? 'red' : '#333'}">
            <b>${r.diff == null ? '-' : (r.diff > 0 ? '▲+' : '▼') + r.diff}</b>
          </td>
        </tr>`).join("")}</tbody>
      </table></div></div>`;
  }
  $("ht_student_card").innerHTML = studentCard;

  // 班级详细统计
  const recs = DB.records.filter((r) => r.examId === selectedExam.id && r.classNo === classNo);
  const detailRows = subjects.map((s) => {
    const st = aggregateStats(recs, [s])[s.name];
    return `<tr><td><b>${esc(s.name)}</b></td><td>${fmt(st.avg, 2)}</td><td>${st.total}</td>
      <td>${fmt(st.max, 2)}</td><td>${fmt(st.min, 2)}</td>
      <td>${fmt(st.passPct * 100, 1)}%</td><td>${st.passCount}</td>
      <td>${fmt(st.excellentPct * 100, 1)}%</td><td>${st.excellent}</td>
      <td>${fmt(st.goodPct * 100, 1)}%</td><td>${st.good}</td>
      <td>${fmt(st.lowPct * 100, 1)}%</td><td>${st.low}</td></tr>`;
  }).join("");

  $("ht_detail_card").innerHTML = `<div class="card">
    <div class="card-title">📋 ${esc(selectedExam.name)} 班级详细统计</div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>学科</th><th>均分</th><th>人数</th><th>最高</th><th>最低</th><th>及格率</th><th>及格人数</th><th>优秀率</th><th>优秀人数</th><th>良好率</th><th>良好人数</th><th>低分率</th><th>低分人数</th></tr></thead>
      <tbody>${detailRows || `<tr><td colspan="13"><div class="empty-state"><div class="es-tip">暂无数据</div></div></td></tr>`}</tbody>
    </table></div>
  </div>`;
}

// 下载班主任分析报告
window.downloadHeadteacherAnalysis = function () {
  const grade = currentUser.grade;
  const classNo = currentUser.classNo;
  const exams = getSortedExams(grade);
  if (!exams.length) { showToast("暂无考试数据", "warning"); return; }
  const subjects = DB.subjects[grade] || [];
  const selectedExamId = $("ht_exam_select")?.value || exams[exams.length - 1].id;
  const selectedExam = exams.find((e) => e.id === selectedExamId) || exams[exams.length - 1];

  const wb = XLSX.utils.book_new();

  // Sheet 1: 各学科趋势
  const trendHeader = ["学科", ...exams.map((e) => e.name)];
  const trendData = subjects.map((s) => {
    const row = [s.name];
    exams.forEach((e) => {
      const recs = DB.records.filter((r) => r.examId === e.id && r.classNo === classNo);
      const st = aggregateStats(recs, [s])[s.name];
      row.push(recs.length ? fmt(st.avg, 2) : "-");
    });
    return row;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([trendHeader, ...trendData]), "学科均分趋势");

  // Sheet 2: 学生明细
  const studentRecs = DB.records.filter((r) => r.examId === selectedExam.id && r.classNo === classNo);
  const studentHeader = ["学号", "姓名", "班级", ...subjects.map((s) => s.name), "总分", "年级排名"];
  const studentRows = studentRecs.map((r) => {
    const allRecs = DB.records.filter((x) => x.examId === selectedExam.id && x.grade === grade);
    const rank = allRecs.sort((a, b) => b.total - a.total).findIndex((x) => x.studentId === r.studentId) + 1;
    return [r.studentId, r.studentName, r.classNo, ...subjects.map((s) => r.scores[s.name] ?? "-"), r.total, rank];
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([studentHeader, ...studentRows.sort((a, b) => a[a.length - 1] - b[b.length - 1])], { header: 1 }), "学生明细");

  // Sheet 3: 详细统计
  const statsHeader = ["学科", "均分", "最高", "最低", "及格率", "及格人数", "优秀率", "优秀人数", "良好率", "良好人数", "低分率", "低分人数", "人数"];
  const statsData = subjects.map((s) => {
    const st = aggregateStats(studentRecs, [s])[s.name];
    return [s.name, fmt(st.avg, 2), fmt(st.max, 2), fmt(st.min, 2), fmt(st.passPct * 100, 1) + "%", st.passCount, fmt(st.excellentPct * 100, 1) + "%", st.excellent, fmt(st.goodPct * 100, 1) + "%", st.good, fmt(st.lowPct * 100, 1) + "%", st.low, st.total];
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([statsHeader, ...statsData]), "学科统计");

  XLSX.writeFile(wb, `${grade}_${classNo}_分析报告_${selectedExam.name}.xlsx`);
  showToast("分析报告已下载", "success");
};

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

// ========== 任课教师：学科对比分析（独立页面） ==========
function renderTeacherAnalysis() {
  if (currentUser.role !== "teacher") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const subjects = currentUser.subjects || [];
  const exams = getSortedExams(grade);
  if (exams.length === 0 || subjects.length === 0) {
    $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-icon">📊</div><div class="es-title">暂无任教数据</div><div class="es-tip">请确认已分配任教科目并上传成绩</div></div></div>`; return;
  }

  const examOptions = exams.map((e, i) => `<option value="${e.id}" ${i === exams.length - 1 ? "selected" : ""}>${esc(e.name)}</option>`).join("");

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">
        <span>🔍 学科对比分析 - ${esc(currentUser.name)}</span>
        <span class="ct-actions">
          <select id="ta_exam_select" style="padding:6px 12px;border:1px solid #ddd;border-radius:6px;margin-right:10px">${examOptions}</select>
          <button class="btn btn-primary" onclick="downloadTeacherAnalysis()">📥 下载学科分析报告</button>
        </span>
      </div>
    </div>
    <div class="card"><div class="card-title">💡 教学洞察</div><div id="ta_insights" class="analysis-text"></div></div>
    <div id="ta_chart_section"></div>
    <div id="ta_ranking_section"></div>
  `;

  $("ta_exam_select").addEventListener("change", () => refreshTeacherAnalysis());
  setTimeout(() => refreshTeacherAnalysis(), 50);
}

function refreshTeacherAnalysis() {
  const grade = currentUser.grade;
  const examId = $("ta_exam_select").value;
  const exams = getSortedExams(grade);
  const selectedExam = exams.find((e) => e.id === examId) || exams[exams.length - 1];
  const subjects = currentUser.subjects || [];
  const classes = [...new Set(DB.records.filter((r) => r.grade === grade).map((r) => r.classNo))].sort();

  let insights = [`• 任教科目：${subjects.join("、") || "暂无"}`];

  // 绘制各学科多班级对比图
  let chartSection = "";
  subjects.forEach((subjectName) => {
    const ds = classes.map((c) => ({
      label: c,
      data: exams.map((e) => {
        const recs = DB.records.filter((r) => r.examId === e.id && r.classNo === c);
        const vals = recs.map((r) => r.scores[subjectName]).filter((v) => v != null);
        if (!vals.length) return null;
        return +fmt(vals.reduce((a, b) => a + b, 0) / vals.length, 2);
      })
    }));
    chartSection += `<div class="card"><div class="card-title">📊 ${esc(subjectName)} - 各班级均分趋势</div><div class="chart-box"><canvas id="ta_chart_${esc(subjectName)}"></canvas></div></div>`;
  });
  $("ta_chart_section").innerHTML = chartSection;

  setTimeout(() => {
    subjects.forEach((subjectName) => {
      const ds = classes.map((c) => ({
        label: c,
        data: exams.map((e) => {
          const recs = DB.records.filter((r) => r.examId === e.id && r.classNo === c);
          const vals = recs.map((r) => r.scores[subjectName]).filter((v) => v != null);
          if (!vals.length) return null;
          return +fmt(vals.reduce((a, b) => a + b, 0) / vals.length, 2);
        })
      }));
      drawChart("ta_chart_" + subjectName, "line", exams.map((e) => e.name), ds);
    });
  }, 100);

  // 教师排行榜
  const { rows } = computeTeacherRanking(selectedExam.id, grade);
  const myRows = rows.filter((r) => subjects.indexOf(r.subject) >= 0);

  if (myRows.length > 0) {
    myRows.forEach((r) => {
      const sameSubject = rows.filter((x) => x.subject === r.subject);
      const maxAvg = Math.max(...sameSubject.map((x) => x.avg));
      const minAvg = Math.min(...sameSubject.map((x) => x.avg));
      if (r.avg === maxAvg) insights.push(`🏆 ${r.subject} ${r.classNo} 均分最高（${fmt(r.avg)}）`);
      if (r.avg === minAvg) insights.push(`⚠️ ${r.subject} ${r.classNo} 均分最低（${fmt(r.avg)}），需关注`);
    });
  }

  $("ta_insights").innerHTML = insights.map((i) => `<p>${i}</p>`).join("");

  const rankingHTML = `<div class="card">
    <div class="card-title">🏅 ${esc(selectedExam.name)} 任教科目教师排行榜</div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>名次</th><th>学科</th><th>班级</th><th>任课教师</th><th>班级人数</th><th>均分</th><th>优秀率</th><th>优秀人数</th><th>及格率</th><th>及格人数</th><th>良好率</th><th>良好人数</th><th>低分率</th><th>低分人数</th><th>综合分数</th></tr></thead>
      <tbody>${rows.map((r) => {
        const isMe = r.teacherName === currentUser.name;
        const isTop = r.rank === 1;
        return `<tr style="${isMe ? "background:#e8f4fd;font-weight:bold" : ""}">
          <td>${isTop ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : r.rank}</td>
          <td><b>${esc(r.subject)}</b>${isMe ? " ★" : ""}</td>
          <td>${esc(r.classNo)}</td><td>${esc(r.teacherName)}</td><td>${r.total}</td>
          <td><b>${fmt(r.avg)}</b></td>
          <td>${fmtPct(r.excellentPct)}</td><td>${r.excellentCount}</td>
          <td>${fmtPct(r.passPct)}</td><td>${r.passCount}</td>
          <td>${fmtPct(r.goodPct)}</td><td>${r.goodCount}</td>
          <td>${fmtPct(r.lowPct)}</td><td>${r.lowCount}</td>
          <td><b>${fmt(r.compositeScore * 100, 2)}</b></td>
        </tr>`;
      }).join("") || `<tr><td colspan="15"><div class="empty-state"><div class="es-tip">暂无排行数据</div></div></td></tr>`}</tbody>
    </table></div>
  </div>`;
  $("ta_ranking_section").innerHTML = rankingHTML;
}

// 下载教师学科分析报告
window.downloadTeacherAnalysis = function () {
  const grade = currentUser.grade;
  const subjects = currentUser.subjects || [];
  const exams = getSortedExams(grade);
  if (!exams.length) { showToast("暂无考试数据", "warning"); return; }
  const selectedExamId = $("ta_exam_select")?.value || exams[exams.length - 1].id;
  const selectedExam = exams.find((e) => e.id === selectedExamId) || exams[exams.length - 1];
  const classes = [...new Set(DB.records.filter((r) => r.grade === grade).map((r) => r.classNo))].sort();

  const wb = XLSX.utils.book_new();

  // Sheet 1: 学科趋势
  const trendHeader = ["学科", "班级", ...exams.map((e) => e.name)];
  const trendData = [];
  subjects.forEach((s) => {
    classes.forEach((c) => {
      const row = [s, c];
      exams.forEach((e) => {
        const recs = DB.records.filter((r) => r.examId === e.id && r.classNo === c);
        const vals = recs.map((r) => r.scores[s]).filter((v) => v != null);
        row.push(vals.length ? fmt(vals.reduce((a, b) => a + b, 0) / vals.length, 2) : "-");
      });
      trendData.push(row);
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([trendHeader, ...trendData]), "学科均分趋势");

  // Sheet 2: 教师排行榜
  const { rows } = computeTeacherRanking(selectedExam.id, grade);
  const rankHeader = ["名次", "学科", "班级", "任课教师", "班级人数", "均分", "优秀率", "优秀人数", "及格率", "及格人数", "良好率", "良好人数", "低分率", "低分人数", "综合分数"];
  const rankData = rows.map((r) => [r.rank, r.subject, r.classNo, r.teacherName, r.total, fmt(r.avg), fmtPct(r.excellentPct), r.excellentCount, fmtPct(r.passPct), r.passCount, fmtPct(r.goodPct), r.goodCount, fmtPct(r.lowPct), r.lowCount, fmt(r.compositeScore * 100, 2)]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([rankHeader, ...rankData]), "教师排行");

  XLSX.writeFile(wb, `${currentUser.name}_学科分析报告_${selectedExam.name}.xlsx`);
  showToast("分析报告已下载", "success");
};

// ========== 多次考试对比分析（重新设计） ==========
function renderExamCompare() {
  const grade = currentUser.grade;
  const exams = getSortedExams(grade);
  if (exams.length < 2) {
    $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-icon">📊</div><div class="es-title">至少需要 2 次考试才能对比</div><div class="es-tip">请先创建多次考试并上传成绩</div></div></div>`;
    return;
  }

  const subjects = DB.subjects[grade] || [];
  const role = currentUser.role;

  // 考试选择（支持多选）
  const examCheckboxes = exams.map((e, i) => `
    <label class="exam-chip ${i >= exams.length - 3 ? "active" : ""}">
      <input type="checkbox" name="exam_cb" value="${e.id}" ${i >= exams.length - 3 ? "checked" : ""}/>
      <span>${esc(e.name)}</span>
    </label>
  `).join("");

  // Tab 配置
  const tabs = [
    { id: "tab_class", icon: "🏫", text: "班级综合对比" },
    { id: "tab_student", icon: "👨‍🎓", text: "学生个人对比" },
    { id: "tab_subject", icon: "📚", text: "学科详细分析" },
    { id: "tab_trend", icon: "📈", text: "趋势图表" }
  ];

  $("pageContent").innerHTML = `
    <div class="compare-container">
      <!-- 顶部工具栏 -->
      <div class="compare-toolbar">
        <div class="compare-exams">
          <div class="toolbar-label">📋 选择考试（至少选2次）：</div>
          <div class="exam-chips">${examCheckboxes}</div>
          <button class="btn btn-sm btn-outline" onclick="cmpSelectRecent()">选最近3次</button>
        </div>
        <div class="compare-actions">
          <button class="btn btn-success" onclick="downloadExamCompare()">📥 导出分析报告</button>
        </div>
      </div>

      <!-- 标签页 -->
      <div class="compare-tabs">
        ${tabs.map((t) => `<button class="tab-btn active" data-tab="${t.id}" onclick="cmpSwitchTab('${t.id}')">${t.icon} ${t.text}</button>`).join("")}
      </div>

      <!-- 内容区域 -->
      <div id="compare_content" class="compare-content"></div>
    </div>
  `;

  // 绑定考试选择事件
  $("compare_content").parentElement.addEventListener("change", (e) => {
    if (e.target.name === "exam_cb") cmpRefreshContent();
  });

  // 样式
  addCompareStyles();

  setTimeout(() => cmpRefreshContent(), 50);
}

function cmpSelectRecent() {
  const checks = document.querySelectorAll('input[name="exam_cb"]');
  checks.forEach((c, i) => { c.checked = i >= checks.length - 3; });
  cmpRefreshContent();
}

function cmpSwitchTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabId));
  cmpRefreshContent();
}

function cmpRefreshContent() {
  const grade = currentUser.grade;
  const subjects = DB.subjects[grade] || [];
  const role = currentUser.role;
  const selectedExamIds = Array.from(document.querySelectorAll('input[name="exam_cb"]:checked')).map((c) => c.value);

  if (selectedExamIds.length < 2) {
    $("compare_content").innerHTML = `<div class="cmp-empty"><div class="es-icon">⚠️</div><div class="es-title">请至少选择 2 次考试</div></div>`;
    return;
  }

  const selectedExams = DB.exams.filter((e) => selectedExamIds.includes(e.id)).sort((a, b) => a.createdAt - b.createdAt);
  const examLabels = selectedExams.map((e) => e.name);
  const activeTab = document.querySelector(".tab-btn.active")?.dataset.tab || "tab_class";

  let html = "";
  switch (activeTab) {
    case "tab_class":
      html = cmpRenderClassTab(grade, subjects, selectedExams, examLabels, role);
      break;
    case "tab_student":
      html = cmpRenderStudentTab(grade, subjects, selectedExams, examLabels, role);
      break;
    case "tab_subject":
      html = cmpRenderSubjectTab(grade, subjects, selectedExams, examLabels, role);
      break;
    case "tab_trend":
      html = cmpRenderTrendTab(grade, subjects, selectedExams, examLabels, role);
      break;
  }

  $("compare_content").innerHTML = html;
  setTimeout(() => cmpDrawCharts(grade, subjects, selectedExams, examLabels, role, activeTab), 100);
}

// ========== Tab 1: 班级综合对比 ==========
function cmpRenderClassTab(grade, subjects, selectedExams, examLabels, role) {
  const classNo = role === "headteacher" ? currentUser.classNo : null;
  const classes = classNo ? [classNo] : [...new Set(DB.records.filter((r) => r.grade === grade).map((r) => r.classNo))].sort();

  // 计算各班各次考试数据
  const classData = classes.map((c) => {
    const data = { classNo: c, exams: [], stats: [] };
    selectedExams.forEach((e) => {
      const recs = DB.records.filter((r) => r.examId === e.id && r.classNo === c);
      if (recs.length) {
        const totals = recs.map((r) => r.total);
        const avg = +fmt(totals.reduce((a, b) => a + b, 0) / totals.length, 2);
        const max = Math.max(...totals);
        const min = Math.min(...totals);
        const std = +fmt(mathStdDev(totals), 2);
        const st = aggregateStats(recs, subjects.filter((s) => s));
        const passRate = totals.filter((t) => t >= (subjects[0]?.pass || 60)).length / totals.length;
        data.exams.push({ exam: e, count: recs.length, avg, max, min, std, passRate, passCount: Math.round(passRate * totals.length) });
      } else {
        data.exams.push(null);
      }
    });
    return data;
  }).filter((d) => d.exams.some((e) => e != null));

  // 生成表格
  let tableHTML = `<div class="cmp-table-wrap"><table class="cmp-table">
    <thead><tr><th rowspan="2">班级</th><th rowspan="2">考试人数</th>${examLabels.map((e) => `<th colspan="5">${esc(e)}</th>`).join("")}</tr>
    <tr>${examLabels.map(() => `<th>均分</th><th>最高</th><th>最低</th><th>标准差</th><th>及格率</th>`).join("")}</tr></thead>
    <tbody>`;

  classData.forEach((d) => {
    tableHTML += `<tr><td class="class-name"><b>${esc(d.classNo)}</b></td>`;
    let firstCount = d.exams.find((e) => e)?.count || "-";
    tableHTML += `<td>${firstCount}</td>`;
    d.exams.forEach((e) => {
      if (e) {
        tableHTML += `<td><b>${e.avg}</b></td><td>${e.max}</td><td>${e.min}</td><td>${e.std}</td><td>${fmtPct(e.passRate)}</td>`;
      } else {
        tableHTML += `<td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>`;
      }
    });
    tableHTML += `</tr>`;
  });
  tableHTML += `</tbody></table></div>`;

  // 涨幅排名
  let rankHTML = `<div class="cmp-section-title">📊 各班成绩涨幅排名（首次 → 最近）</div><div class="cmp-table-wrap"><table class="cmp-table">
    <thead><tr><th>班级</th><th>首次均分</th><th>最近均分</th><th>涨幅</th><th>趋势</th></tr></thead><tbody>`;

  classData.forEach((d) => {
    const validExams = d.exams.filter((e) => e != null);
    if (validExams.length >= 2) {
      const first = validExams[0].avg;
      const last = validExams[validExams.length - 1].avg;
      const diff = +fmt(last - first, 2);
      const trend = diff > 0 ? "📈" : diff < 0 ? "📉" : "➡️";
      const color = diff > 0 ? "var(--success)" : diff < 0 ? "var(--danger)" : "var(--text-light)";
      rankHTML += `<tr><td><b>${esc(d.classNo)}</b></td><td>${first}</td><td>${last}</td><td style="color:${color};font-weight:bold">${diff > 0 ? "+" : ""}${diff}</td><td>${trend}</td></tr>`;
    }
  });
  rankHTML += `</tbody></table></div>`;

  return `<div class="cmp-panel">${tableHTML}${rankHTML}</div>`;
}

// ========== Tab 2: 学生个人对比 ==========
function cmpRenderStudentTab(grade, subjects, selectedExams, examLabels, role) {
  const classNo = role === "headteacher" ? currentUser.classNo : null;
  const firstExam = selectedExams[0];
  const lastExam = selectedExams[selectedExams.length - 1];

  // 获取学生数据
  const firstMap = {};
  DB.records.filter((r) => r.examId === firstExam.id && r.grade === grade).forEach((r) => { firstMap[r.studentId] = r; });

  const lastRecs = DB.records.filter((r) => r.examId === lastExam.id && (!classNo || r.classNo === classNo));
  const students = lastRecs.map((r) => {
    const first = firstMap[r.studentId];
    const firstTotal = first && typeof first.total === 'number' ? first.total : null;
    const diff = firstTotal !== null ? r.total - firstTotal : null;
    return { ...r, firstTotal, diff };
  }).sort((a, b) => (b.diff || 0) - (a.diff || 0));

  // 计算班级/年级排名
  const allFirst = DB.records.filter((r) => r.examId === firstExam.id && r.grade === grade).sort((a, b) => b.total - a.total);
  const allLast = DB.records.filter((r) => r.examId === lastExam.id && r.grade === grade).sort((a, b) => b.total - a.total);

  students.forEach((s) => {
    const firstIdx = allFirst.findIndex((x) => x.studentId === s.studentId);
    const lastIdx = allLast.findIndex((x) => x.studentId === s.studentId);
    s.firstRank = firstIdx >= 0 ? firstIdx + 1 : null;
    s.lastRank = lastIdx >= 0 ? lastIdx + 1 : null;
    s.rankChange = s.firstRank && s.lastRank ? s.firstRank - s.lastRank : null;
  });

  // 进步榜
  let html = `<div class="cmp-section-title">🏆 进步最快 TOP 10（${esc(firstExam.name)} → ${esc(lastExam.name)}）</div>`;
  html += `<div class="cmp-table-wrap"><table class="cmp-table">
    <thead><tr><th>排名</th><th>学号</th><th>姓名</th><th>首次</th><th>最近</th><th>涨幅</th><th>首次排名</th><th>最近排名</th><th>排名变化</th></tr></thead><tbody>`;
  students.slice(0, 10).forEach((s, idx) => {
    const color = s.diff > 0 ? "var(--success)" : s.diff < 0 ? "var(--danger)" : "var(--text-light)";
    const rankColor = s.rankChange > 0 ? "var(--success)" : s.rankChange < 0 ? "var(--danger)" : "var(--text-light)";
    html += `<tr>
      <td>${idx + 1}</td><td>${esc(s.studentId)}</td><td><b>${esc(s.studentName)}</b></td>
      <td>${s.firstTotal || "-"}</td><td><b>${s.total}</b></td>
      <td style="color:${color};font-weight:bold">${s.diff != null ? (s.diff > 0 ? "+" : "") + s.diff : "-"}</td>
      <td>${s.firstRank || "-"}</td><td>${s.lastRank || "-"}</td>
      <td style="color:${rankColor};font-weight:bold">${s.rankChange != null ? (s.rankChange > 0 ? "↑" + s.rankChange : s.rankChange < 0 ? "↓" + Math.abs(s.rankChange) : "—") : "-"}</td>
    </tr>`;
  });
  html += `</tbody></table></div>`;

  // 退步榜
  html += `<div class="cmp-section-title" style="margin-top:24px">⚠️ 需关注学生 TOP 10（退步较大）</div>`;
  html += `<div class="cmp-table-wrap"><table class="cmp-table">
    <thead><tr><th>排名</th><th>学号</th><th>姓名</th><th>首次</th><th>最近</th><th>跌幅</th><th>首次排名</th><th>最近排名</th><th>排名变化</th></tr></thead><tbody>`;
  students.slice(-10).reverse().forEach((s, idx) => {
    const color = "var(--danger)";
    const rankColor = s.rankChange > 0 ? "var(--success)" : s.rankChange < 0 ? "var(--danger)" : "var(--text-light)";
    html += `<tr>
      <td>${idx + 1}</td><td>${esc(s.studentId)}</td><td><b>${esc(s.studentName)}</b></td>
      <td>${s.firstTotal || "-"}</td><td><b>${s.total}</b></td>
      <td style="color:${color};font-weight:bold">${s.diff != null ? s.diff : "-"}</td>
      <td>${s.firstRank || "-"}</td><td>${s.lastRank || "-"}</td>
      <td style="color:${rankColor};font-weight:bold">${s.rankChange != null ? (s.rankChange > 0 ? "↑" + s.rankChange : s.rankChange < 0 ? "↓" + Math.abs(s.rankChange) : "—") : "-"}</td>
    </tr>`;
  });
  html += `</tbody></table></div>`;

  // 稳定榜（波动小）
  const stableStudents = students.filter((s) => s.diff != null && Math.abs(s.diff) <= 5).sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff));
  html += `<div class="cmp-section-title" style="margin-top:24px">🎯 成绩稳定学生（波动 ≤5分）</div>`;
  html += `<div class="cmp-table-wrap"><table class="cmp-table">
    <thead><tr><th>学号</th><th>姓名</th><th>首次</th><th>最近</th><th>波动</th><th>趋势</th></tr></thead><tbody>`;
  stableStudents.slice(0, 10).forEach((s) => {
    html += `<tr><td>${esc(s.studentId)}</td><td><b>${esc(s.studentName)}</b></td><td>${s.firstTotal || "-"}</td><td>${s.total}</td><td>${Math.abs(s.diff)}</td><td>➡️</td></tr>`;
  });
  html += `</tbody></table></div>`;

  return `<div class="cmp-panel">${html}</div>`;
}

// ========== Tab 3: 学科详细分析 ==========
function cmpRenderSubjectTab(grade, subjects, selectedExams, examLabels, role) {
  const classNo = role === "headteacher" ? currentUser.classNo : null;

  let html = "";
  subjects.forEach((s) => {
    html += `<div class="cmp-subject-card">
      <div class="cmp-section-title">📚 ${esc(s.name)} 各考试详细分析</div>
      <div class="cmp-table-wrap"><table class="cmp-table">
        <thead><tr><th>考试</th><th>均分</th><th>最高</th><th>最低</th><th>标准差</th><th>及格率</th><th>及格人数</th><th>优秀率</th><th>优秀人数</th><th>良好率</th><th>良好人数</th><th>低分率</th><th>低分人数</th><th>考试人数</th></tr></thead>
        <tbody>`;

    selectedExams.forEach((e) => {
      const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || r.classNo === classNo));
      if (recs.length) {
        const vals = recs.map((r) => r.scores[s.name]).filter((v) => typeof v === "number" && !isNaN(v));
        const avg = vals.length ? +fmt(vals.reduce((a, b) => a + b, 0) / vals.length, 2) : "-";
        const max = vals.length ? Math.max(...vals) : "-";
        const min = vals.length ? Math.min(...vals) : "-";
        const std = vals.length ? +fmt(mathStdDev(vals), 2) : "-";
        const st = aggregateStats(recs, [s])[s.name];
        html += `<tr><td><b>${esc(e.name)}</b></td><td><b>${avg}</b></td><td>${max}</td><td>${min}</td><td>${std}</td>
          <td>${fmtPct(st.passPct)}</td><td>${st.passCount}</td>
          <td>${fmtPct(st.excellentPct)}</td><td>${st.excellent}</td>
          <td>${fmtPct(st.goodPct)}</td><td>${st.good}</td>
          <td>${fmtPct(st.lowPct)}</td><td>${st.low}</td><td>${vals.length}</td></tr>`;
      } else {
        html += `<tr><td><b>${esc(e.name)}</b></td>${Array(13).fill("<td>-</td>").join("")}</tr>`;
      }
    });
    html += `</tbody></table></div></div>`;
  });

  return `<div class="cmp-panel">${html}</div>`;
}

// ========== Tab 4: 趋势图表 ==========
function cmpRenderTrendTab(grade, subjects, selectedExams, examLabels, role) {
  const classNo = role === "headteacher" ? currentUser.classNo : null;

  // 图表1: 总分趋势
  let html = `<div class="cmp-chart-grid">
    <div class="cmp-chart-card"><div class="cmp-chart-title">📈 总分均分趋势</div><div class="cmp-chart-box"><canvas id="cmp_trend_total"></canvas></div></div>
    <div class="cmp-chart-card"><div class="cmp-chart-title">📊 及格率趋势</div><div class="cmp-chart-box"><canvas id="cmp_trend_pass"></canvas></div></div>
    <div class="cmp-chart-card"><div class="cmp-chart-title">🏆 优秀率趋势</div><div class="cmp-chart-box"><canvas id="cmp_trend_excellent"></canvas></div></div>
    <div class="cmp-chart-card"><div class="cmp-chart-title">📉 标准差趋势（稳定性）</div><div class="cmp-chart-box"><canvas id="cmp_trend_std"></canvas></div></div>
  </div>`;

  // 学科趋势
  if (subjects.length > 0) {
    html += `<div class="cmp-section-title" style="margin-top:24px">📚 各学科均分趋势对比</div>`;
    html += `<div class="cmp-chart-card" style="max-width:100%"><div class="cmp-chart-box" style="height:350px"><canvas id="cmp_trend_subjects"></canvas></div></div>`;
  }

  return `<div class="cmp-panel">${html}</div>`;
}

function cmpDrawCharts(grade, subjects, selectedExams, examLabels, role, activeTab) {
  if (activeTab !== "tab_trend") return;

  const classNo = role === "headteacher" ? currentUser.classNo : null;

  // 总分趋势
  const totalDatasets = [{
    label: classNo || "全年级",
    data: selectedExams.map((e) => {
      const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || r.classNo === classNo));
      if (!recs.length) return null;
      return +fmt(recs.reduce((a, b) => a + b.total, 0) / recs.length, 2);
    })
  }];
  drawChart("cmp_trend_total", "line", examLabels, totalDatasets);

  // 及格率趋势
  const passDatasets = [{
    label: classNo || "全年级",
    data: selectedExams.map((e) => {
      const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || r.classNo === classNo));
      if (!recs.length) return null;
      const passLine = subjects[0]?.pass || 60;
      const passCount = recs.filter((r) => r.total >= passLine).length;
      return +fmt(passCount / recs.length * 100, 1);
    })
  }];
  drawChart("cmp_trend_pass", "line", examLabels, passDatasets);

  // 优秀率趋势
  const excDatasets = [{
    label: classNo || "全年级",
    data: selectedExams.map((e) => {
      const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || r.classNo === classNo));
      if (!recs.length) return null;
      const excLine = subjects[0]?.excellent || 90;
      const excCount = recs.filter((r) => r.total >= excLine).length;
      return +fmt(excCount / recs.length * 100, 1);
    })
  }];
  drawChart("cmp_trend_excellent", "line", examLabels, excDatasets);

  // 标准差趋势
  const stdDatasets = [{
    label: classNo || "全年级",
    data: selectedExams.map((e) => {
      const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || r.classNo === classNo));
      if (!recs.length) return null;
      return +fmt(mathStdDev(recs.map((r) => r.total)), 2);
    })
  }];
  drawChart("cmp_trend_std", "line", examLabels, stdDatasets);

  // 学科趋势
  if (subjects.length > 0) {
    const subjDatasets = subjects.map((s) => ({
      label: s.name,
      data: selectedExams.map((e) => {
        const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || r.classNo === classNo));
        if (!recs.length) return null;
        const vals = recs.map((r) => r.scores[s.name]).filter((v) => typeof v === "number" && !isNaN(v));
        return vals.length ? +fmt(vals.reduce((a, b) => a + b, 0) / vals.length, 2) : null;
      })
    }));
    drawChart("cmp_trend_subjects", "line", examLabels, subjDatasets);
  }
}

// 标准差计算
function mathStdDev(arr) {
  if (arr.length < 2) return 0;
  const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

// 添加对比分析专用样式
function addCompareStyles() {
  if (document.getElementById("cmp_styles")) return;
  const style = document.createElement("style");
  style.id = "cmp_styles";
  style.textContent = `
    .compare-container { display: flex; flex-direction: column; gap: 16px; }
    .compare-toolbar { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px; padding: 16px; background: var(--card-bg); border-radius: 12px; }
    .compare-exams { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .toolbar-label { font-size: 13px; color: var(--text-light); white-space: nowrap; }
    .exam-chips { display: flex; gap: 8px; flex-wrap: wrap; }
    .exam-chip { display: flex; align-items: center; gap: 6px; padding: 6px 14px; border: 1.5px solid #e5e7eb; border-radius: 20px; font-size: 13px; cursor: pointer; transition: all 0.2s; background: #fff; }
    .exam-chip input { display: none; }
    .exam-chip.active { background: var(--primary); color: #fff; border-color: var(--primary); }
    .compare-tabs { display: flex; gap: 4px; background: var(--card-bg); padding: 6px; border-radius: 10px; }
    .tab-btn { padding: 10px 20px; border: none; background: transparent; border-radius: 8px; font-size: 14px; cursor: pointer; color: var(--text-light); transition: all 0.2s; }
    .tab-btn:hover { background: rgba(59,125,221,0.1); }
    .tab-btn.active { background: var(--primary); color: #fff; font-weight: 600; }
    .compare-content { min-height: 400px; }
    .cmp-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 80px; color: var(--text-light); }
    .cmp-panel { display: flex; flex-direction: column; gap: 20px; }
    .cmp-section-title { font-size: 15px; font-weight: 600; color: var(--text-dark); margin-bottom: 12px; }
    .cmp-table-wrap { overflow-x: auto; border-radius: 10px; background: var(--card-bg); }
    .cmp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .cmp-table th { background: #f8f9fc; padding: 12px 10px; text-align: center; font-weight: 600; color: var(--text-dark); border-bottom: 2px solid #e5e7eb; white-space: nowrap; }
    .cmp-table td { padding: 10px; text-align: center; border-bottom: 1px solid #f0f0f0; }
    .cmp-table tr:hover td { background: #f8f9fc; }
    .cmp-table .class-name { background: #f0f7ff; }
    .cmp-subject-card { background: var(--card-bg); padding: 16px; border-radius: 10px; }
    .cmp-chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .cmp-chart-card { background: var(--card-bg); padding: 16px; border-radius: 10px; }
    .cmp-chart-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; color: var(--text-dark); }
    .cmp-chart-box { height: 220px; position: relative; }
    @media (max-width: 900px) { .cmp-chart-grid { grid-template-columns: 1fr; } .compare-toolbar { flex-direction: column; } }
  `;
  document.head.appendChild(style);
}

// 下载完整对比报告
window.downloadExamCompare = function () {
  const grade = currentUser.grade;
  const subjects = DB.subjects[grade] || [];
  const role = currentUser.role;
  const selectedExamIds = Array.from(document.querySelectorAll('input[name="exam_cb"]:checked')).map((c) => c.value);
  if (selectedExamIds.length < 2) { showToast("请至少选择 2 次考试", "warning"); return; }

  const selectedExams = DB.exams.filter((e) => selectedExamIds.includes(e.id)).sort((a, b) => a.createdAt - b.createdAt);
  const examLabels = selectedExams.map((e) => e.name);
  const classNo = role === "headteacher" ? currentUser.classNo : null;
  const wb = XLSX.utils.book_new();

  // Sheet 1: 班级综合对比
  const classes = classNo ? [classNo] : [...new Set(DB.records.filter((r) => r.grade === grade).map((r) => r.classNo))].sort();
  const classHeader1 = ["班级", "考试人数", ...examLabels.flatMap((e) => [e + "-均分", e + "-最高", e + "-最低", e + "-标准差", e + "-及格率"])];
  const classData1 = [];
  classes.forEach((c) => {
    const row = [c];
    let firstCount = 0;
    selectedExams.forEach((e) => {
      const recs = DB.records.filter((r) => r.examId === e.id && r.classNo === c);
      if (recs.length) {
        if (!firstCount) firstCount = recs.length;
        const totals = recs.map((r) => r.total);
        const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
        const passLine = subjects[0]?.pass || 60;
        const passCount = totals.filter((t) => t >= passLine).length;
        row.push(fmt(avg, 2), Math.max(...totals), Math.min(...totals), fmt(mathStdDev(totals), 2), fmt(passCount / totals.length * 100, 1) + "%");
      } else {
        row.push("-", "-", "-", "-", "-");
      }
    });
    row[1] = firstCount;
    classData1.push(row);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([classHeader1, ...classData1]), "班级综合对比");

  // Sheet 2: 学生个人对比
  const firstExam = selectedExams[0];
  const lastExam = selectedExams[selectedExams.length - 1];
  const firstMap = {};
  DB.records.filter((r) => r.examId === firstExam.id && r.grade === grade).forEach((r) => { firstMap[r.studentId] = r; });
  const lastRecs = DB.records.filter((r) => r.examId === lastExam.id && (!classNo || r.classNo === classNo));
  const studentHeader = ["学号", "姓名", `${firstExam.name}总分`, `${lastExam.name}总分`, "涨幅", "首次排名", "最近排名", "排名变化"];
  const allFirst = DB.records.filter((x) => x.examId === firstExam.id && x.grade === grade).sort((a, b) => b.total - a.total);
  const allLast = DB.records.filter((x) => x.examId === lastExam.id && x.grade === grade).sort((a, b) => b.total - a.total);
  const studentData = lastRecs.map((r) => {
    const first = firstMap[r.studentId];
    const firstTotal = first && typeof first.total === 'number' ? first.total : null;
    const diff = firstTotal !== null ? r.total - firstTotal : null;
    const firstIdx = allFirst.findIndex((x) => x.studentId === r.studentId);
    const lastIdx = allLast.findIndex((x) => x.studentId === r.studentId);
    const firstRank = firstIdx >= 0 ? firstIdx + 1 : null;
    const lastRank = lastIdx >= 0 ? lastIdx + 1 : null;
    return [r.studentId, r.studentName, firstTotal !== null ? firstTotal : "-", r.total, diff !== null ? diff : "-", firstRank !== null ? firstRank : "-", lastRank !== null ? lastRank : "-", firstRank !== null && lastRank !== null ? firstRank - lastRank : "-"];
  }).sort((a, b) => (b[4] === "-" ? -999 : b[4]) - (a[4] === "-" ? -999 : a[4]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([studentHeader, ...studentData]), "学生个人对比");

  // Sheet 3: 学科详细统计
  const subjHeader = ["学科", ...selectedExams.flatMap((e) => [e.name + "-均分", e.name + "-及格率", e.name + "-优秀率", e.name + "-良好率", e.name + "-低分率", e.name + "-人数"])];
  const subjData = subjects.map((s) => {
    const row = [s.name];
    selectedExams.forEach((e) => {
      const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || r.classNo === classNo));
      if (recs.length) {
        const st = aggregateStats(recs, [s])[s.name];
        row.push(fmt(st.avg, 2), fmtPct(st.passPct), fmtPct(st.excellentPct), fmtPct(st.goodPct), fmtPct(st.lowPct), st.total);
      } else {
        row.push("-", "-", "-", "-", "-", "0");
      }
    });
    return row;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([subjHeader, ...subjData]), "学科详细统计");

  // Sheet 4: 趋势数据
  const trendHeader = ["指标", ...examLabels];
  const trendData = [
    ["总分均分", ...selectedExams.map((e) => { const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || r.classNo === classNo)); return recs.length ? fmt(recs.reduce((a, b) => a + b.total, 0) / recs.length, 2) : "-"; })],
    ["总分标准差", ...selectedExams.map((e) => { const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || r.classNo === classNo)); return recs.length ? fmt(mathStdDev(recs.map((r) => r.total)), 2) : "-"; })],
    ...subjects.map((s) => [s.name + "均分", ...selectedExams.map((e) => { const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || r.classNo === classNo)); const vals = recs.map((r) => r.scores[s.name]).filter((v) => typeof v === "number"); return vals.length ? fmt(vals.reduce((a, b) => a + b, 0) / vals.length, 2) : "-"; })])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([trendHeader, ...trendData]), "趋势数据");

  const prefix = role === "academic" ? grade : role === "headteacher" ? `${grade}_${classNo}` : currentUser.name;
  XLSX.writeFile(wb, `${prefix}_多次考试对比分析_${selectedExams.length}次.xlsx`);
  showToast("分析报告已下载", "success");
};

// ========== 班主任：学习小组管理 ==========
function renderGroupManage() {
  const grade = currentUser.grade;
  const classNo = currentUser.classNo;
  const exams = getSortedExams(grade);
  const subjects = DB.subjects[grade] || [];

  // 获取本班小组数据
  if (!DB.groups) DB.groups = {};
  if (!DB.groups[grade]) DB.groups[grade] = {};
  if (!DB.groups[grade][classNo]) DB.groups[grade][classNo] = [];

  const groups = DB.groups[grade][classNo] || [];

  // 下载模板按钮
  const downloadTemplate = () => {
    const data = [["学号", "姓名", "小组名称"], ["001", "张三", "第一组"], ["002", "李四", "第一组"], ["003", "王五", "第二组"]];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), "小组名单");
    XLSX.writeFile(wb, "小组名单模板.xlsx");
    showToast("模板已下载", "success");
  };

  // 上传小组名单
  const handleUpload = (input) => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        if (rows.length < 2) { showToast("文件内容为空", "error"); return; }
        const header = rows[0].map((h) => String(h).trim());
        const idxId = header.findIndex((h) => h.includes("学号"));
        const idxName = header.findIndex((h) => h.includes("姓名"));
        const idxGroup = header.findIndex((h) => h.includes("小组"));
        if (idxId < 0 || idxName < 0 || idxGroup < 0) { showToast("表头必须包含：学号、姓名、小组名称", "error"); return; }

        const newGroups = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row[idxId] || !row[idxName] || !row[idxGroup]) continue;
          newGroups.push({ studentId: String(row[idxId]).trim(), studentName: String(row[idxName]).trim(), groupName: String(row[idxGroup]).trim() });
        }

        if (newGroups.length === 0) { showToast("没有有效数据", "error"); return; }
        DB.groups[grade][classNo] = newGroups;
        saveDB();
        showToast(`成功导入 ${newGroups.length} 名学生`, "success");
        renderGroupManage();
      } catch (err) { showToast("文件解析失败", "error"); }
    };
    reader.readAsArrayBuffer(file);
  };

  // 考试选择
  const examOptions = exams.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("");

  // 渲染小组列表
  const groupListHTML = groups.length > 0 ? `
    <div class="card"><div class="card-title"><span>📋 小组名单（${groups.length}人）</span>
      <button class="btn btn-sm btn-danger" onclick="clearAllGroups()">清空全部</button>
    </div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>学号</th><th>姓名</th><th>小组</th><th>操作</th></tr></thead>
      <tbody>${groups.map((g, i) => `<tr>
        <td>${esc(g.studentId)}</td><td><b>${esc(g.studentName)}</b></td><td><span class="tag tag-blue">${esc(g.groupName)}</span></td>
        <td><button class="btn btn-sm btn-danger" onclick="deleteGroupMember(${i})">删除</button></td>
      </tr>`).join("")}</tbody>
    </table></div></div>
    <div class="card"><div class="card-title">📊 小组统计</div>
    ${renderGroupStats(groups)}
    </div>` : "";

  // 小组成绩分析区域
  const scoreHTML = exams.length > 0 && groups.length > 0 ? `
    <div class="card"><div class="card-title">📈 小组成绩分析</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
        <label>选择考试：</label>
        <select id="htg_exam" class="form-control" style="width:200px">${examOptions}</select>
        <button class="btn btn-primary" onclick="refreshHeadteacherGroupScores()">🔍 分析</button>
        <button class="btn btn-success" onclick="downloadHeadteacherGroupAnalysis()">📥 导出报告</button>
      </div>
      <div id="htg_result"></div>
    </div>` : "";

  $("pageContent").innerHTML = `
    <div class="card"><div class="card-title">👥 学习小组管理</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
        <button class="btn btn-primary" onclick="downloadGroupTemplate()">📥 下载模板</button>
        <label class="btn btn-success" style="cursor:pointer">📤 上传小组名单 <input type="file" accept=".xlsx,.xls" style="display:none" onchange="handleGroupUpload(this)"/></label>
      </div>
    </div>
    ${groups.length > 0 ? groupListHTML : `<div class="card"><div class="empty-state"><div class="es-icon">👥</div><div class="es-title">暂无小组数据</div><div class="es-tip">请下载模板填写后上传</div></div></div>`}
    ${scoreHTML}
  `;

  // 绑定函数到全局
  window.downloadGroupTemplate = downloadTemplate;
  window.handleGroupUpload = handleUpload;
  window.deleteGroupMember = (idx) => {
    DB.groups[grade][classNo].splice(idx, 1);
    saveDB();
    showToast("已删除", "success");
    renderGroupManage();
  };
  window.clearAllGroups = () => {
    if (confirm("确定清空所有小组数据？")) {
      DB.groups[grade][classNo] = [];
      saveDB();
      showToast("已清空", "success");
      renderGroupManage();
    }
  };

  // 刷新小组成绩
  window.refreshHeadteacherGroupScores = () => {
    const examId = $("htg_exam").value;
    const exam = DB.exams.find((e) => e.id === examId);
    if (!exam) return;

    // 按小组名分组
    const groupMap = {};
    groups.forEach((g) => {
      if (!groupMap[g.groupName]) groupMap[g.groupName] = [];
      groupMap[g.groupName].push(g);
    });
    const groupNames = Object.keys(groupMap).sort();

    let html = `<div class="cmp-panel">`;

    // 小组总分均分对比图表
    const chartCanvas = `htg_chart_${Date.now()}`;
    html += `<div class="cmp-section-title">📊 ${esc(exam.name)} - 小组总分均分对比</div>
      <div class="cmp-chart-box" style="height:280px"><canvas id="${chartCanvas}"></canvas></div>`;

    // 详细数据表
    html += `<div class="cmp-section-title">📋 小组详细成绩</div>
      <div class="cmp-table-wrap"><table class="cmp-table">
      <thead><tr><th>小组</th><th>人数</th><th>总分均分</th><th>最高分</th><th>最低分</th><th>标准差</th>`;
    subjects.forEach((s) => html += `<th>${esc(s.name)}均分</th>`);
    html += `<th>及格率</th><th>优秀率</th></tr></thead><tbody>`;

    groupNames.forEach((gn) => {
      const members = groupMap[gn];
      const memberIds = members.map((m) => m.studentId);
      const recs = DB.records.filter((r) => r.examId === examId && r.classNo === classNo && memberIds.includes(r.studentId));
      if (recs.length > 0) {
        const totals = recs.map((r) => r.total);
        const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
        const passLine = subjects[0]?.pass || 60;
        const passCount = totals.filter((t) => t >= passLine).length;
        const excLine = subjects[0]?.excellent || 90;
        const excCount = totals.filter((t) => t >= excLine).length;
        html += `<tr><td><b>${esc(gn)}</b></td><td>${recs.length}</td><td><b>${fmt(avg, 2)}</b></td><td>${Math.max(...totals)}</td><td>${Math.min(...totals)}</td><td>${fmt(mathStdDev(totals), 2)}</td>`;
        subjects.forEach((s) => {
          const subjVals = recs.map((r) => r.scores[s.name]).filter((v) => typeof v === "number");
          html += `<td>${subjVals.length ? fmt(subjVals.reduce((a, b) => a + b, 0) / subjVals.length, 2) : "-"}</td>`;
        });
        html += `<td>${fmtPct(passCount / recs.length)}</td><td>${fmtPct(excCount / recs.length)}</td></tr>`;
      } else {
        html += `<tr><td><b>${esc(gn)}</b></td><td>${members.length}</td><td colspan="${6 + subjects.length}"><span style="color:#999">暂无成绩数据</span></td></tr>`;
      }
    });
    html += `</tbody></table></div>`;

    // 小组成员详情
    html += `<div class="cmp-section-title">👨‍🎓 小组成员成绩明细</div>
      <div class="cmp-table-wrap"><table class="cmp-table">
      <thead><tr><th>学号</th><th>姓名</th><th>小组</th><th>总分</th>`;
    subjects.forEach((s) => html += `<th>${esc(s.name)}</th>`);
    html += `</tr></thead><tbody>`;

    groups.forEach((g) => {
      const rec = DB.records.find((r) => r.examId === examId && r.classNo === classNo && r.studentId === g.studentId);
      html += `<tr><td>${esc(g.studentId)}</td><td><b>${esc(g.studentName)}</b></td><td><span class="tag tag-blue">${esc(g.groupName)}</span></td><td><b>${rec?.total || "-"}</b></td>`;
      subjects.forEach((s) => {
        const score = rec?.scores[s.name];
        html += `<td>${typeof score === "number" ? score : "-"}</td>`;
      });
      html += `</tr>`;
    });
    html += `</tbody></table></div></div>`;

    $("htg_result").innerHTML = html;

    // 绘制图表
    setTimeout(() => {
      const datasets = [{
        label: "小组总分均分",
        data: groupNames.map((gn) => {
          const members = groupMap[gn];
          const memberIds = members.map((m) => m.studentId);
          const recs = DB.records.filter((r) => r.examId === examId && r.classNo === classNo && memberIds.includes(r.studentId));
          if (recs.length > 0) return +fmt(recs.reduce((a, b) => a + b.total, 0) / recs.length, 2);
          return null;
        })
      }];
      drawChart(chartCanvas, "bar", groupNames, datasets);
    }, 200);
  };

  // 导出小组分析报告
  window.downloadHeadteacherGroupAnalysis = () => {
    const examId = $("htg_exam")?.value;
    if (!examId) { showToast("请先选择考试", "warning"); return; }
    const exam = DB.exams.find((e) => e.id === examId);

    const groupMap = {};
    groups.forEach((g) => { if (!groupMap[g.groupName]) groupMap[g.groupName] = []; groupMap[g.groupName].push(g); });
    const groupNames = Object.keys(groupMap).sort();

    const wb = XLSX.utils.book_new();

    // Sheet 1: 小组统计
    const statHeader = ["小组", "人数", "总分均分", "最高分", "最低分", "标准差", ...subjects.map((s) => s.name + "均分"), "及格率", "优秀率"];
    const statData = [];
    groupNames.forEach((gn) => {
      const members = groupMap[gn];
      const memberIds = members.map((m) => m.studentId);
      const recs = DB.records.filter((r) => r.examId === examId && r.classNo === classNo && memberIds.includes(r.studentId));
      if (recs.length > 0) {
        const totals = recs.map((r) => r.total);
        const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
        const passLine = subjects[0]?.pass || 60;
        const passCount = totals.filter((t) => t >= passLine).length;
        const excLine = subjects[0]?.excellent || 90;
        const excCount = totals.filter((t) => t >= excLine).length;
        const subjAvgs = subjects.map((s) => {
          const vals = recs.map((r) => r.scores[s.name]).filter((v) => typeof v === "number");
          return vals.length ? fmt(vals.reduce((a, b) => a + b, 0) / vals.length, 2) : "-";
        });
        statData.push([gn, recs.length, fmt(avg, 2), Math.max(...totals), Math.min(...totals), fmt(mathStdDev(totals), 2), ...subjAvgs, fmt(passCount / recs.length * 100, 1) + "%", fmt(excCount / recs.length * 100, 1) + "%"]);
      } else {
        statData.push([gn, members.length, "-", "-", "-", "-", ...subjects.map(() => "-"), "-", "-"]);
      }
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([statHeader, ...statData]), "小组统计");

    // Sheet 2: 成员明细
    const memberHeader = ["学号", "姓名", "小组", "总分", ...subjects.map((s) => s.name)];
    const memberData = groups.map((g) => {
      const rec = DB.records.find((r) => r.examId === examId && r.classNo === classNo && r.studentId === g.studentId);
      const scores = subjects.map((s) => rec?.scores[s.name] != null ? rec.scores[s.name] : "-");
      return [g.studentId, g.studentName, g.groupName, rec?.total || "-", ...scores];
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([memberHeader, ...memberData]), "成员明细");

    XLSX.writeFile(wb, `${grade}_${classNo}_${exam.name}_小组分析.xlsx`);
    showToast("分析报告已下载", "success");
  };

  // 初始加载成绩分析
  if (exams.length > 0 && groups.length > 0) {
    setTimeout(() => refreshHeadteacherGroupScores(), 100);
  }
}

function renderGroupStats(groups) {
  const groupMap = {};
  groups.forEach((g) => {
    if (!groupMap[g.groupName]) groupMap[g.groupName] = [];
    groupMap[g.groupName].push(g);
  });
  const groupNames = Object.keys(groupMap).sort();
  return `<div class="table-wrap"><table class="data-table">
    <thead><tr><th>小组名称</th><th>人数</th></tr></thead>
    <tbody>${groupNames.map((n) => `<tr><td><b>${esc(n)}</b></td><td>${groupMap[n].length} 人</td></tr>`).join("")}</tbody>
  </table></div>`;
}

// ========== 任课教师：小组成绩分析 ==========
function renderGroupScores() {
  const grade = currentUser.grade;
  const mySubjects = currentUser.subjects || [];
  const exams = getSortedExams(grade);

  if (exams.length === 0) {
    $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-icon">📝</div><div class="es-title">暂无考试数据</div></div></div>`;
    return;
  }

  // 获取任教班级的所有小组数据
  const myClasses = [...new Set(DB.records.filter((r) => r.grade === grade && mySubjects.some((s) => r.scores && r.scores[s] != null)).map((r) => r.classNo))].sort();
  if (!DB.groups) DB.groups = {};
  if (!DB.groups[grade]) DB.groups[grade] = {};
  const allGroups = DB.groups[grade] || {};
  const myGroups = {};
  myClasses.forEach((c) => {
    if (allGroups[c]) myGroups[c] = allGroups[c];
  });

  // 考试选择
  const examOptions = exams.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("");

  $("pageContent").innerHTML = `
    <div class="card"><div class="card-title">👥 小组成绩分析</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
        <label>选择考试：</label>
        <select id="gs_exam" class="form-control" style="width:200px">${examOptions}</select>
        <button class="btn btn-primary" onclick="refreshGroupScores()">🔍 分析</button>
        <button class="btn btn-success" onclick="downloadGroupAnalysis()">📥 导出分析报告</button>
      </div>
    </div>
    <div id="gs_result"></div>
  `;

  $("gs_exam").addEventListener("change", () => refreshGroupScores());
  setTimeout(() => refreshGroupScores(), 100);
}

function refreshGroupScores() {
  const grade = currentUser.grade;
  const mySubjects = currentUser.subjects || [];
  const examId = $("gs_exam").value;
  const exam = DB.exams.find((e) => e.id === examId);
  if (!exam) return;

  const myClasses = [...new Set(DB.records.filter((r) => r.grade === grade && mySubjects.some((s) => r.scores && r.scores[s] != null)).map((r) => r.classNo))].sort();
  if (!DB.groups) DB.groups = {};
  if (!DB.groups[grade]) DB.groups[grade] = {};
  const allGroups = DB.groups[grade];
  const subjects = DB.subjects[grade] || [];

  let html = "";

  myClasses.forEach((classNo) => {
    const groups = allGroups[classNo] || [];
    if (groups.length === 0) return;

    // 按小组名分组
    const groupMap = {};
    groups.forEach((g) => {
      if (!groupMap[g.groupName]) groupMap[g.groupName] = [];
      groupMap[g.groupName].push(g);
    });

    const groupNames = Object.keys(groupMap).sort();

    html += `<div class="card"><div class="card-title">🏫 ${esc(classNo)} - ${mySubjects.join("、")}小组成绩分析</div>`;

    // 遍历每门任教科目
    mySubjects.forEach((subjectName) => {
      const subject = subjects.find((s) => s.name === subjectName);
      if (!subject) return;

      // 小组学科成绩对比图表
      const chartCanvas = `gs_chart_${esc(classNo)}_${esc(subjectName)}`;
      html += `<div class="cmp-section-title">📊 ${esc(subjectName)} - 小组均分对比</div>
        <div class="cmp-chart-box" style="height:250px"><canvas id="${chartCanvas}"></canvas></div>`;

      // 详细数据表
      html += `<div class="cmp-section-title">📋 ${esc(subjectName)}详细数据</div>
        <div class="cmp-table-wrap"><table class="cmp-table">
        <thead><tr><th>小组</th><th>人数</th><th>均分</th><th>最高分</th><th>最低分</th><th>标准差</th><th>及格率</th><th>优秀率</th></tr></thead>
        <tbody>`;

      groupNames.forEach((gn) => {
        const members = groupMap[gn];
        const memberIds = members.map((m) => m.studentId);
        const recs = DB.records.filter((r) => r.examId === examId && r.classNo === classNo && memberIds.includes(r.studentId));
        if (recs.length > 0) {
          const scores = recs.map((r) => r.scores[subjectName]).filter((v) => typeof v === "number" && !isNaN(v));
          if (scores.length > 0) {
            const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
            const max = Math.max(...scores);
            const min = Math.min(...scores);
            const passCount = scores.filter((s) => s >= subject.pass).length;
            const excCount = scores.filter((s) => s >= subject.excellent).length;
            html += `<tr><td><b>${esc(gn)}</b></td><td>${scores.length}</td><td><b>${fmt(avg, 2)}</b></td><td>${max}</td><td>${min}</td><td>${fmt(mathStdDev(scores), 2)}</td><td>${fmtPct(passCount / scores.length)}</td><td>${fmtPct(excCount / scores.length)}</td></tr>`;
          } else {
            html += `<tr><td><b>${esc(gn)}</b></td><td>${members.length}</td><td colspan="6"><span style="color:#999">暂无${esc(subjectName)}成绩</span></td></tr>`;
          }
        } else {
          html += `<tr><td><b>${esc(gn)}</b></td><td>${members.length}</td><td colspan="6"><span style="color:#999">暂无成绩数据</span></td></tr>`;
        }
      });
      html += `</tbody></table></div>`;
    });

    html += `</div>`;
  });

  if (!html) {
    $("gs_result").innerHTML = `<div class="card"><div class="empty-state"><div class="es-icon">👥</div><div class="es-title">暂无小组数据</div><div class="es-tip">请联系班主任设置学习小组</div></div></div>`;
    return;
  }

  $("gs_result").innerHTML = `<div class="cmp-panel">${html}</div>`;

  // 绘制图表
  setTimeout(() => {
    myClasses.forEach((classNo) => {
      const groups = allGroups[classNo] || [];
      if (groups.length === 0) return;
      const groupMap = {};
      groups.forEach((g) => { if (!groupMap[g.groupName]) groupMap[g.groupName] = []; groupMap[g.groupName].push(g); });
      const groupNames = Object.keys(groupMap).sort();

      mySubjects.forEach((subjectName) => {
        const datasets = [{
          label: `${subjectName}均分`,
          data: groupNames.map((gn) => {
            const members = groupMap[gn];
            const memberIds = members.map((m) => m.studentId);
            const recs = DB.records.filter((r) => r.examId === examId && r.classNo === classNo && memberIds.includes(r.studentId));
            const scores = recs.map((r) => r.scores[subjectName]).filter((v) => typeof v === "number" && !isNaN(v));
            if (scores.length > 0) return +fmt(scores.reduce((a, b) => a + b, 0) / scores.length, 2);
            return null;
          })
        }];
        drawChart(`gs_chart_${esc(classNo)}_${esc(subjectName)}`, "bar", groupNames, datasets);
      });
    });
  }, 200);
}

window.downloadGroupAnalysis = function () {
  const grade = currentUser.grade;
  const mySubjects = currentUser.subjects || [];
  const examId = $("gs_exam")?.value;
  if (!examId) { showToast("请先选择考试", "warning"); return; }
  const exam = DB.exams.find((e) => e.id === examId);
  const subjects = DB.subjects[grade] || [];
  const myClasses = [...new Set(DB.records.filter((r) => r.grade === grade && mySubjects.some((s) => r.scores && r.scores[s] != null)).map((r) => r.classNo))].sort();
  if (!DB.groups) DB.groups = {};
  if (!DB.groups[grade]) DB.groups[grade] = {};
  const allGroups = DB.groups[grade];

  const wb = XLSX.utils.book_new();

  myClasses.forEach((classNo) => {
    const groups = allGroups[classNo] || [];
    if (groups.length === 0) return;
    const groupMap = {};
    groups.forEach((g) => { if (!groupMap[g.groupName]) groupMap[g.groupName] = []; groupMap[g.groupName].push(g); });
    const groupNames = Object.keys(groupMap).sort();

    // 每个学科单独一个Sheet
    mySubjects.forEach((subjectName) => {
      const subject = subjects.find((s) => s.name === subjectName);
      if (!subject) return;

      const header = ["小组", "人数", `${subjectName}均分`, `${subjectName}最高分`, `${subjectName}最低分`, "标准差", "及格人数", "及格率", "优秀人数", "优秀率"];
      const data = [];
      groupNames.forEach((gn) => {
        const members = groupMap[gn];
        const memberIds = members.map((m) => m.studentId);
        const recs = DB.records.filter((r) => r.examId === examId && r.classNo === classNo && memberIds.includes(r.studentId));
        if (recs.length > 0) {
          const scores = recs.map((r) => r.scores[subjectName]).filter((v) => typeof v === "number" && !isNaN(v));
          if (scores.length > 0) {
            const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
            const passCount = scores.filter((s) => s >= subject.pass).length;
            const excCount = scores.filter((s) => s >= subject.excellent).length;
            data.push([gn, scores.length, fmt(avg, 2), Math.max(...scores), Math.min(...scores), fmt(mathStdDev(scores), 2), passCount, fmt(passCount / scores.length * 100, 1) + "%", excCount, fmt(excCount / scores.length * 100, 1) + "%"]);
          } else {
            data.push([gn, members.length, "-", "-", "-", "-", "-", "-", "-", "-"]);
          }
        } else {
          data.push([gn, members.length, "-", "-", "-", "-", "-", "-", "-", "-"]);
        }
      });

      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...data]), `${classNo}_${subjectName}`);
    });
  });

  if (wb.SheetNames.length > 0) {
    XLSX.writeFile(wb, `${grade}_${currentUser.name}_小组成绩分析.xlsx`);
    showToast("分析报告已下载", "success");
  } else {
    showToast("暂无小组数据", "warning");
  }
};

// ========== 任课教师：自定义分析 ==========
function renderCustomAnalysis() {
  const grade = currentUser.grade;
  const mySubjects = currentUser.subjects || [];
  const exams = getSortedExams(grade);
  const myClasses = [...new Set(DB.records.filter((r) => r.grade === grade && mySubjects.some((s) => r.scores && r.scores[s] != null)).map((r) => r.classNo))].sort();
  const subjects = DB.subjects[grade] || [];

  if (exams.length === 0) {
    $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-icon">📝</div><div class="es-title">暂无考试数据</div></div></div>`;
    return;
  }

  const examOptions = exams.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("");
  const classOptions = myClasses.map((c) => `<option value="${c}">${esc(c)}</option>`).join("");
  const subjectOptions = mySubjects.map((s) => `<option value="${s}">${esc(s)}</option>`).join("");

  $("pageContent").innerHTML = `
    <div class="card"><div class="card-title">⚙️ 自定义分析</div>
      <div class="custom-analysis">
        <div class="ca-row">
          <div class="ca-field"><label>考试：</label><select id="ca_exam" class="form-control">${examOptions}</select></div>
          <div class="ca-field"><label>班级：</label><select id="ca_class" class="form-control"><option value="">全年级</option>${classOptions}</select></div>
          <div class="ca-field"><label>学科：</label><select id="ca_subject" class="form-control"><option value="">总分</option>${subjectOptions}</select></div>
        </div>
        <div class="ca-actions">
          <button class="btn btn-primary" onclick="runCustomAnalysis()">🔍 开始分析</button>
          <button class="btn btn-success" onclick="downloadCustomAnalysis()">📥 导出报告</button>
        </div>
      </div>
    </div>
    <div id="ca_result"></div>
  `;
}

function runCustomAnalysis() {
  const grade = currentUser.grade;
  const examId = $("ca_exam").value;
  const classNo = $("ca_class").value;
  const subject = $("ca_subject").value;
  const subjects = DB.subjects[grade] || [];

  const exam = DB.exams.find((e) => e.id === examId);
  if (!exam) return;

  let recs = DB.records.filter((r) => r.examId === examId && r.grade === grade);
  if (classNo) recs = recs.filter((r) => r.classNo === classNo);

  if (recs.length === 0) {
    $("ca_result").innerHTML = `<div class="card"><div class="empty-state"><div class="es-title">暂无成绩数据</div></div></div>`;
    return;
  }

  // 基础统计
  let values, label;
  if (subject) {
    values = recs.map((r) => r.scores[subject]).filter((v) => typeof v === "number" && !isNaN(v));
    label = subject;
  } else {
    values = recs.map((r) => r.total);
    label = "总分";
  }

  const n = values.length;
  const sum = values.reduce((a, b) => a + b, 0);
  const avg = sum / n;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const std = mathStdDev(values);

  // 分数段分析
  const fullScore = subject ? (subjects.find((s) => s.name === subject)?.score || 100) : (subjects.reduce((a, s) => a + s.score, 0));
  const segments = [
    { name: "满分", min: fullScore, max: fullScore + 1 },
    { name: `90%以上 (${fmt(fullScore * 0.9, 0)}+)`, min: fullScore * 0.9, max: fullScore + 1 },
    { name: `80%-90% (${fmt(fullScore * 0.8, 0)}-${fmt(fullScore * 0.9, 0)})`, min: fullScore * 0.8, max: fullScore * 0.9 },
    { name: `70%-80% (${fmt(fullScore * 0.7, 0)}-${fmt(fullScore * 0.8, 0)})`, min: fullScore * 0.7, max: fullScore * 0.8 },
    { name: `60%-70% (${fmt(fullScore * 0.6, 0)}-${fmt(fullScore * 0.7, 0)})`, min: fullScore * 0.6, max: fullScore * 0.7 },
    { name: `60%以下 (<${fmt(fullScore * 0.6, 0)})`, min: 0, max: fullScore * 0.6 }
  ];

  const segData = segments.map((s) => {
    const cnt = values.filter((v) => v >= s.min && v < s.max).length;
    return { ...s, count: cnt, rate: cnt / n };
  });

  // 图表
  const chartCanvas = `ca_chart_${Date.now()}`;
  let html = `
    <div class="card"><div class="card-title">📊 ${esc(label)}统计分析（${esc(exam.name)}${classNo ? " - " + esc(classNo) : " - 全年级"})</div>
      <div class="ca-stats-grid">
        <div class="ca-stat"><div class="ca-stat-label">考试人数</div><div class="ca-stat-value">${n}</div></div>
        <div class="ca-stat"><div class="ca-stat-label">平均分</div><div class="ca-stat-value">${fmt(avg, 2)}</div></div>
        <div class="ca-stat"><div class="ca-stat-label">最高分</div><div class="ca-stat-value">${max}</div></div>
        <div class="ca-stat"><div class="ca-stat-label">最低分</div><div class="ca-stat-value">${min}</div></div>
        <div class="ca-stat"><div class="ca-stat-label">标准差</div><div class="ca-stat-value">${fmt(std, 2)}</div></div>
        <div class="ca-stat"><div class="ca-stat-label">满分线</div><div class="ca-stat-value">${fullScore}</div></div>
      </div>
    </div>
    <div class="card"><div class="card-title">📈 分数段分布</div>
      <div class="ca-chart-container"><canvas id="${chartCanvas}"></canvas></div>
      <div class="cmp-table-wrap" style="margin-top:16px"><table class="cmp-table">
        <thead><tr><th>分数段</th><th>人数</th><th>占比</th><th>分布条</th></tr></thead>
        <tbody>${segData.map((s) => `<tr>
          <td><b>${esc(s.name)}</b></td><td>${s.count}</td><td>${fmtPct(s.rate)}</td>
          <td><div style="background:var(--primary);height:16px;border-radius:4px;width:${Math.max(s.rate * 200, 4)}px"></div></td>
        </tr>`).join("")}</tbody>
      </table></div>
    </div>`;

  $("ca_result").innerHTML = html;

  setTimeout(() => {
    drawChart(chartCanvas, "bar", segData.map((s) => s.name), [{
      label: "人数",
      data: segData.map((s) => s.count)
    }]);
  }, 100);
}

window.downloadCustomAnalysis = function () {
  const grade = currentUser.grade;
  const examId = $("ca_exam")?.value;
  const classNo = $("ca_class")?.value;
  const subject = $("ca_subject")?.value;
  const exam = DB.exams.find((e) => e.id === examId);
  if (!exam) { showToast("请先进行分析", "warning"); return; }

  const subjects = DB.subjects[grade] || [];
  let recs = DB.records.filter((r) => r.examId === examId && r.grade === grade);
  if (classNo) recs = recs.filter((r) => r.classNo === classNo);
  if (recs.length === 0) { showToast("暂无数据", "warning"); return; }

  let values, label;
  if (subject) {
    values = recs.map((r) => r.scores[subject]).filter((v) => typeof v === "number" && !isNaN(v));
    label = subject;
  } else {
    values = recs.map((r) => r.total);
    label = "总分";
  }

  const n = values.length;
  const avg = values.reduce((a, b) => a + b, 0) / n;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const fullScore = subject ? (subjects.find((s) => s.name === subject)?.score || 100) : (subjects.reduce((a, s) => a + s.score, 0));

  const segments = [
    { name: `90%以上 (${fmt(fullScore * 0.9, 0)}+)`, min: fullScore * 0.9, max: fullScore + 1 },
    { name: `80%-90%`, min: fullScore * 0.8, max: fullScore * 0.9 },
    { name: `70%-80%`, min: fullScore * 0.7, max: fullScore * 0.8 },
    { name: `60%-70%`, min: fullScore * 0.6, max: fullScore * 0.7 },
    { name: `60%以下`, min: 0, max: fullScore * 0.6 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["项目", "数值"],
    ["考试", exam.name],
    ["班级", classNo || "全年级"],
    ["学科", label],
    ["考试人数", n],
    ["平均分", fmt(avg, 2)],
    ["最高分", max],
    ["最低分", min],
    ["标准差", fmt(mathStdDev(values), 2)],
    ["满分线", fullScore],
    ...segments.map((s) => {
      const cnt = values.filter((v) => v >= s.min && v < s.max).length;
      return [s.name, cnt, fmt(cnt / n * 100, 1) + "%"];
    })
  ]), "自定义分析");

  XLSX.writeFile(wb, `${grade}_${currentUser.name}_自定义分析_${label}.xlsx`);
  showToast("报告已下载", "success");
};

// 添加自定义分析样式
const caStyle = document.createElement("style");
caStyle.textContent = `
  .custom-analysis { padding: 16px 0; }
  .ca-row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
  .ca-field { display: flex; align-items: center; gap: 8px; }
  .ca-field label { font-weight: 600; color: var(--text-dark); white-space: nowrap; }
  .ca-field .form-control { width: 160px; }
  .ca-actions { display: flex; gap: 12px; }
  .ca-stats-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin-top: 16px; }
  .ca-stat { background: var(--card-bg); border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; text-align: center; }
  .ca-stat-label { font-size: 12px; color: var(--text-light); margin-bottom: 8px; }
  .ca-stat-value { font-size: 22px; font-weight: 700; color: var(--primary); }
  .ca-chart-container { height: 280px; margin-top: 16px; }
  @media (max-width: 900px) { .ca-stats-grid { grid-template-columns: repeat(3, 1fr); } }
`;
document.head.appendChild(caStyle);

