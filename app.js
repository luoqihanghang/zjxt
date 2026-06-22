// ========== 网络智慧教务平台 - 主应用 ==========
// 所有数据存储在 localStorage 中，便于本地演示和持久化

// ========== 工具函数 ==========
const $ = (id) => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
const fmt = (n, d = 2) => (isFinite(n) ? Number(n).toFixed(d) : "-");
const fmtPct = (n) => (isFinite(n) ? (n * 100).toFixed(2) + "%" : "-");

// HTML 转义，防止特殊字符破坏页面结构
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// 根据用户角色过滤记录：学术用户可见所有记录，教师/班主任仅可见已确认记录
const getVisibleRecords = (records) => {
  if (!currentUser || currentUser.role === "academic") return records;
  // 非学术用户（班主任、任课教师）只能看到已确认的记录
  return records.filter((r) => r.status === "confirmed");
};

// 学号辅助函数：学号以学生名单为准，无名单时不显示
const hasRoster = (grade) => {
  return !!(DB.studentRoster && DB.studentRoster[grade] && Object.keys(DB.studentRoster[grade]).length > 0);
};

const getStudentIdFromRoster = (grade, classNo, studentName) => {
  if (!hasRoster(grade)) return "";
  const roster = DB.studentRoster[grade];
  const classRoster = roster[classNo];
  if (!classRoster) return "";
  const found = classRoster.find((s) => s.studentName === studentName);
  return found ? found.studentId : "";
};

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
      { id: "u_ht",    username: "headteacher", password: "123456", name: "王班主任", role: "headteacher", grade: "高一年级", classNo: "1班", subjects: ["语文"], createdAt: Date.now() }
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
    groups: {},
    studentRoster: {},  // 学生名单 { grade: { classNo: [{studentId, studentName, classNo}] } }
    scoreReviews: [],   // 成绩审核记录
    gradeNotifications: [],  // 全年组通知弹窗 [{id, grade, title, content, level, createdBy, createdAt, readBy: {userId: true}}]
    dismissedNotifications: {}   // 用户已关闭的通知 {userId: {notifId: true}}
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
    },
    {
      group: "个人中心", icon: "👤", items: [
        { id: "account_profile", icon: "🔐", text: "修改我的密码" }
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
      group: "人员管理", icon: "👥", items: [
        { id: "users", icon: "👩‍🏫", text: "教师名单管理" },
        { id: "permissions", icon: "🔐", text: "权限管理" }
      ]
    },
    {
      group: "学生名单", icon: "🎓", items: [
        { id: "student_roster", icon: "📋", text: "学生名单管理" }
      ]
    },
    {
      group: "成绩汇总", icon: "📈", items: [
        { id: "academic_upload_scores", icon: "📥", text: "上传全年级成绩（教务）" },
        { id: "score_review", icon: "✅", text: "成绩审核（复审一键确认）" },
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
      group: "全年组通知", icon: "🔔", items: [
        { id: "grade_notifications", icon: "📣", text: "发布/管理通知" }
      ]
    },
    {
      group: "个人中心", icon: "👤", items: [
        { id: "account_profile", icon: "🔐", text: "修改我的密码" }
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
        { id: "exam_compare", icon: "🔄", text: "多次考试对比分析" }
      ]
    },
    {
      group: "小组与分析", icon: "👥", items: [
        { id: "group_scores", icon: "👥", text: "小组成绩分析" },
        { id: "custom_analysis", icon: "⚙️", text: "自定义分析" }
      ]
    },
    {
      group: "年级通知", icon: "🔔", items: [
        { id: "grade_notifications", icon: "📣", text: "全年组通知" }
      ]
    },
    {
      group: "个人中心", icon: "👤", items: [
        { id: "account_profile", icon: "🔐", text: "修改我的密码" }
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
      group: "班级成绩（班主任）", icon: "📖", items: [
        { id: "upload_scores", icon: "📥", text: "上传班级成绩" },
        { id: "my_class_scores", icon: "📖", text: "本班考试成绩" },
        { id: "class_ranking", icon: "🏆", text: "本班排名统计" },
        { id: "download_scores", icon: "📤", text: "下载Excel成绩" }
      ]
    },
    {
      group: "任教科目（作为任课教师）", icon: "📘", items: [
        { id: "my_scores", icon: "📖", text: "我的班级成绩" },
        { id: "my_ranking", icon: "🏅", text: "我的排行信息" },
        { id: "teacher_analysis", icon: "🔍", text: "学科对比分析" },
        { id: "group_scores", icon: "👥", text: "小组成绩分析" }
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
    },
    {
      group: "年级通知", icon: "🔔", items: [
        { id: "grade_notifications", icon: "📣", text: "全年组通知" }
      ]
    },
    {
      group: "个人中心", icon: "👤", items: [
        { id: "account_profile", icon: "🔐", text: "修改我的密码" }
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
  // 顶部栏右侧：若已存在则仅刷新状态，不存在则新建
  if ($("sync-status")) { updateSyncBadge(); return; }
  const statusDiv = document.createElement("div");
  statusDiv.id = "sync-status";
  statusDiv.style.cssText = "display:flex;align-items:center;gap:10px";
  statusDiv.innerHTML = `
    <span id="sync-badge" style="font-size:12px;padding:4px 10px;background:#f0f4ff;border-radius:12px;color:#3b7ddd">🔗 未连接</span>
  `;
  const rightBar = document.querySelector(".topbar-right");
  if (rightBar) rightBar.insertBefore(statusDiv, rightBar.firstChild);
  updateSyncBadge();
}

function updateSyncBadge() {
  const badge = $("sync-badge");
  if (!badge) return;
  const gs = window.GitHubService;
  if (!gs) return;
  const cfg = gs.config;
  if (gs.isConfigured()) {
    badge.innerHTML = `🔗 已连接（主 Gist：${(cfg.configGistId || "").substring(0, 8)}…）`;
    badge.style.background = "#e8f7ec";
    badge.style.color = "#2b8a3e";
  } else {
    badge.innerHTML = "🔗 未配置";
    badge.style.background = "#fff4e6";
    badge.style.color = "#d9480f";
  }
}

window.openGithubSetup = function () {
  GitHubService.showLoginSetup();
};

// ========== GitHub 数据管理页面 ==========
function renderGithubData() {
  if (currentUser.role !== "admin") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const gs = window.GitHubService;
  const cfg = gs.config;

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">🔗 Gist 数据存储配置</div>
      <div class="form-row">
        <div class="form-group"><label>GitHub Token</label><input type="password" id="gd_token" value="${cfg.token || ""}" placeholder="ghp_xxxxx" /></div>
        <div class="form-group"><label>主 Gist ID（配置存储，永久不变）</label><input id="gd_config_id" value="${cfg.configGistId || ""}" placeholder="a1b2c3d4e5f6…" /></div>
      </div>
      <div class="form-row">
        ${[1, 2, 3, 4, 5].map(i => `
          <div class="form-group">
            <label>业务 Gist ID #${i}${i === 1 ? "（当前活跃）" : "（归档）"}</label>
            <input class="gd_data_id_${i}" value="${cfg.dataGistIds[i - 1] || ""}" placeholder="留空则首次上传时自动创建" />
          </div>
        `).join("")}
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
        <p>• 当前状态：${gs.isConfigured() ? `<b style="color:#2b8a3e">✅ 已配置</b>` : `<b style="color:#d9480f">⚠️ 未配置</b>`}</p>
        <p>• Token：${cfg.token ? "✅ 已设置" : "❌ 未设置"}</p>
        <p>• 主 Gist ID：<code>${cfg.configGistId || "未设置"}</code></p>
        <p>• 业务 Gist：<code>${cfg.dataGistIds.length ? cfg.dataGistIds.join("、") : "未设置（首次上传时自动创建）"}</code></p>
      </div>
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
    const configGistId = $("gd_config_id").value.trim();
    gs.saveGistConfig(token, configGistId, null);
    // 收集所有业务 Gist ID
    const dataGistIds = [];
    for (let i = 1; i <= 5; i++) {
      const el = document.querySelector(".gd_data_id_" + i);
      if (el && el.value.trim()) dataGistIds.push(el.value.trim());
    }
    gs.config.dataGistIds = dataGistIds;
    localStorage.setItem("gh_data_gist_ids", JSON.stringify(dataGistIds));
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

  // 每次导航后检查并弹出全年组通知
  setTimeout(() => { checkGradeNotifications(); }, 400);
}

// ========== 个人中心：修改密码 ==========
function renderAccountProfile() {
  const u = currentUser;
  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">👤 我的账号信息</div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th style="width:35%">项目</th><th>内容</th></tr></thead>
        <tbody>
          <tr><td><b>账号（登录用户名）</b></td><td>${esc(u.username)}</td></tr>
          <tr><td><b>姓名</b></td><td>${esc(u.name)}</td></tr>
          <tr><td><b>角色</b></td><td>${esc(ROLE_NAMES[u.role])}</td></tr>
          <tr><td><b>所属年级</b></td><td>${esc(u.grade || "-")}</td></tr>
          <tr><td><b>班级</b></td><td>${esc(u.classNo || "-")}</td></tr>
          ${u.subjects && u.subjects.length ? `<tr><td><b>任教学科</b></td><td>${esc(u.subjects.join("、"))}</td></tr>` : ""}
          <tr><td><b>账号创建时间</b></td><td>${u.createdAt ? new Date(u.createdAt).toLocaleString() : "-"}</td></tr>
        </tbody>
      </table></div>
    </div>

    <div class="card">
      <div class="card-title">🔐 修改我的密码</div>
      <div class="form-row">
        <div class="form-group"><label>当前密码</label>
          <input id="ap_old" type="password" placeholder="输入当前密码" />
        </div>
        <div class="form-group"><label>新密码</label>
          <input id="ap_new1" type="password" placeholder="至少 4 位" />
        </div>
        <div class="form-group"><label>确认新密码</label>
          <input id="ap_new2" type="password" placeholder="再次输入新密码" />
        </div>
      </div>
      <div style="margin-top:16px; display:flex; gap:10px;">
        <button class="btn btn-primary btn-lg" id="ap_save">💾 保存新密码</button>
        <button class="btn btn-secondary btn-lg" id="ap_clear">🗑 清空</button>
      </div>
      <div style="margin-top:14px; padding:10px 12px; background:#fff8e1; border-left:3px solid #f59e0b; border-radius:4px; font-size:12px; color:#78350f;">
        💡 修改成功后，新密码将自动同步至系统（通过 Gist 持久化存储），其他端再次登录时即可使用新密码。
      </div>
    </div>
  `;

  $("ap_save").onclick = () => {
    const oldPwd = $("ap_old").value.trim();
    const new1 = $("ap_new1").value.trim();
    const new2 = $("ap_new2").value.trim();

    if (!oldPwd) { showToast("请输入当前密码", "error"); return; }
    if (oldPwd !== u.password) { showToast("当前密码不正确", "error"); return; }
    if (!new1 || !new2) { showToast("请输入新密码并确认", "error"); return; }
    if (new1.length < 4) { showToast("新密码至少 4 位", "error"); return; }
    if (new1 !== new2) { showToast("两次输入的新密码不一致", "error"); return; }
    if (new1 === oldPwd) { showToast("新密码不能与当前密码相同", "warning"); return; }

    // 更新本地 DB 对象
    const uInDB = DB.users.find((x) => x.id === u.id);
    if (uInDB) uInDB.password = new1;

    // 更新 currentUser（同步当前会话）
    currentUser.password = new1;

    saveDB(DB);
    showToast("✅ 密码已修改，已同步保存", "success");

    // 清空输入框
    $("ap_old").value = "";
    $("ap_new1").value = "";
    $("ap_new2").value = "";

    // 如果浏览器记住了密码，也更新本地缓存
    const saved = localStorage.getItem("saved_user");
    if (saved) {
      try {
        const obj = JSON.parse(saved);
        if (obj.username === u.username) {
          obj.password = new1;
          localStorage.setItem("saved_user", JSON.stringify(obj));
        }
      } catch (e) {}
    }
  };

  $("ap_clear").onclick = () => {
    $("ap_old").value = "";
    $("ap_new1").value = "";
    $("ap_new2").value = "";
    showToast("已清空", "info");
  };
}

// ========== 公告 ==========
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
  academic_upload_scores: renderAcademicUploadScores,
  grade_summary: renderGradeSummary,
  class_ranking: renderClassRanking,
  teacher_ranking: renderTeacherRanking,
  grade_notifications: renderGradeNotifications,
  announcement: renderAnnouncementMgr,
  announcements_all: renderAnnouncementMgr,
  academic_analysis: renderAcademicAnalysis,
  score_review: renderScoreReview,
  student_roster: renderStudentRoster,
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
  custom_analysis: renderCustomAnalysis,
  account_profile: renderAccountProfile
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
    // ===== 管理员：全学校视角 =====
    const grades = Object.keys(DB.subjects);
    // 计算每个年级的核心数据
    const gradeRows = grades.map((g) => {
      const userCount = DB.users.filter((u) => u.grade === g).length;
      const examCount = DB.exams.filter((e) => e.grade === g).length;
      const recCount = DB.records.filter((r) => r.grade === g).length;
      // 最近一次考试的年级总均分
      const recentExam = DB.exams.filter((e) => e.grade === g).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
      let recentAvg = "-";
      if (recentExam) {
        const recs = DB.records.filter((r) => r.examId === recentExam.id);
        if (recs.length > 0) {
          const totalAvg = recs.map((r) => {
            const vs = Object.values(r.scores || {}).filter((v) => v != null);
            if (vs.length === 0) return null;
            return vs.reduce((a, b) => a + b, 0) / vs.length;
          }).filter(v => v != null);
          if (totalAvg.length > 0) {
            recentAvg = fmt(totalAvg.reduce((a, b) => a + b, 0) / totalAvg.length);
          }
        }
      }
      // 班主任人数
      const htCount = DB.users.filter((u) => u.grade === g && u.role === "headteacher").length;
      const subjectCount = (DB.subjects[g] || []).length;
      return { grade: g, users: userCount, exams: examCount, recs: recCount, avg: recentAvg, ht: htCount, subjects: subjectCount };
    });

    // 各年级考试数量的图表数据
    const gradeChartLabels = gradeRows.map((r) => r.grade);
    const examCounts = gradeRows.map((r) => r.exams);
    const recCounts = gradeRows.map((r) => r.recs);

    roleSection = `
      <div class="card">
        <div class="card-title">🏫 校园总览 - 各年级概况</div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>年级</th><th>学科数</th><th>教师数</th><th>班主任数</th><th>考试数</th><th>成绩记录</th><th>最近一次考试年级均分</th></tr></thead>
          <tbody>
            ${gradeRows.length === 0 ? `<tr><td colspan="7"><div class="empty-state"><div class="es-tip">暂无年级数据，请先添加年级</div></div></td></tr>` : gradeRows.map((r) => `<tr>
              <td><b>${r.grade}</b></td>
              <td>${r.subjects}</td>
              <td>${r.users}</td>
              <td>${r.ht}</td>
              <td>${r.exams}</td>
              <td>${r.recs}</td>
              <td><b style="color:#0b6bcb">${r.avg}</b></td>
            </tr>`).join("")}
          </tbody>
        </table></div>
      </div>

      <div class="card">
        <div class="card-title">📊 各年级考试与成绩记录对比</div>
        <div class="chart-box"><canvas id="adminGradeChart"></canvas></div>
      </div>

      <div class="card">
        <div class="card-title">📌 管理员工作台</div>
        <div class="form-row">
          <button class="btn btn-primary btn-lg" onclick="navigate('users')">➜ 教师名单管理</button>
          <button class="btn btn-info btn-lg" onclick="navigate('grades')">➜ 年级设置</button>
          <button class="btn btn-success btn-lg" onclick="navigate('exams')">➜ 考试管理</button>
          <button class="btn btn-warning btn-lg" onclick="navigate('announcements_all')">➜ 公告管理</button>
          <button class="btn btn-secondary btn-lg" onclick="navigate('account_profile')">🔐 修改密码</button>
        </div>
      </div>
    `;

    setTimeout(() => {
      if (gradeChartLabels.length === 0) return;
      drawChart("adminGradeChart", "bar", gradeChartLabels, [
        { label: "考试数", data: examCounts, color: "#3b82f6" },
        { label: "成绩记录", data: recCounts, color: "#f59e0b" }
      ]);
    }, 50);
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
        <div style="color:var(--text-light); font-size:13px; margin-bottom:12px;">
          身份：班主任 · 任教学科：<b>${(currentUser.subjects || []).join("、") || "（尚未设置）"}</b>
        </div>
        <div class="form-row">
          <button class="btn btn-primary btn-lg" onclick="navigate('upload_scores')">➜ 上传班级成绩</button>
          <button class="btn btn-info btn-lg" onclick="navigate('my_class_scores')">➜ 查看本班成绩</button>
          <button class="btn btn-success btn-lg" onclick="navigate('download_scores')">➜ 下载Excel</button>
          <button class="btn btn-warning btn-lg" onclick="navigate('headteacher_analysis')">➜ 智能对比分析</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title">📘 我的任教科目分析</div>
        <div class="form-row">
          <button class="btn btn-primary btn-lg" onclick="navigate('my_scores')">📖 我的班级成绩</button>
          <button class="btn btn-info btn-lg" onclick="navigate('my_ranking')">🏅 我的排行信息</button>
          <button class="btn btn-success btn-lg" onclick="navigate('teacher_analysis')">🔍 学科对比分析</button>
          <button class="btn btn-secondary btn-lg" onclick="navigate('group_scores')">👥 小组成绩分析</button>
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

// ========== 管理员/教务：教师名单 ==========
function renderUsers() {
  if (currentUser.role !== "admin" && currentUser.role !== "academic") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }

  // 教务只能管理自己年级的教师
  const myGrade = currentUser.role === "academic" ? currentUser.grade : null;
  const allUsers = myGrade
    ? DB.users.filter((u) => u.role !== "admin" && u.grade === myGrade)
    : DB.users.filter((u) => u.role !== "admin");
  const teachers = allUsers.filter((u) => u.role === "teacher");
  const headteachers = allUsers.filter((u) => u.role === "headteacher");
  const academics = allUsers.filter((u) => u.role === "academic");

  const rows = allUsers.map((u) => `
    <tr>
      <td>${esc(u.username)}</td>
      <td>${esc(u.name)}</td>
      <td><span class="badge badge-primary">${esc(ROLE_NAMES[u.role])}</span></td>
      <td>${esc(u.grade || "-")}</td>
      <td>${esc(u.classNo || "-")}</td>
      <td>${(u.subjects && u.subjects.length) ? esc(u.subjects.join("、")) : "-"}</td>
      <td>${new Date(u.createdAt).toLocaleDateString()}</td>
      <td style="display:flex;gap:6px">
        <button class="btn btn-sm btn-info" onclick="editUser('${esc(u.id)}')">编辑</button>
        <button class="btn btn-sm btn-warning" onclick="resetPwd('${esc(u.id)}')">重置密码</button>
        <button class="btn btn-sm btn-danger" onclick="delUser('${esc(u.id)}')">删除</button>
      </td>
    </tr>
  `).join("");

  const summaryHtml = myGrade
    ? `<div style="margin-bottom:12px;font-size:13px;color:var(--text-light)">
        当前年级：<b>${myGrade}</b> ·
        班主任 ${headteachers.length} 人 · 任课教师 ${teachers.length} 人 · 教务老师 ${academics.length} 人
      </div>`
    : "";

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">
        <span>👥 教师名单管理（共 ${allUsers.length} 人）${myGrade ? `— ${myGrade}` : ""}</span>
        <span class="ct-actions">
          <button class="btn btn-primary" onclick="downloadTeacherTemplate()">📥 下载模板</button>
          <button class="btn btn-warning" onclick="showBatchUploadModal()">📤 批量上传</button>
          <button class="btn btn-success" onclick="editUser(null)">+ 添加教师</button>
        </span>
      </div>
      ${summaryHtml}
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
        <div class="form-group"><label>班级（班主任必填；任课教师可填，多班用逗号分隔，如 1班,2班）</label>
          <input id="m_class" value="${esc(u?.classNo || "")}" placeholder="如 1班 / 1班,2班" />
        </div>
      </div>

      <div class="form-group"><label>任教学科（任课教师/班主任必填，逗号分隔）</label>
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
    const isAcademic = currentUser.role === "academic";

    if (!username || !name) { showToast("账号和姓名不能为空", "error"); return false; }
    if (!u && DB.users.some((x) => x.username === username)) { showToast("账号已存在", "error"); return false; }
    if (isAcademic && grade !== currentUser.grade) { showToast("教务只能管理本年级教师", "error"); return false; }

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
  const isAcademic = currentUser.role === "academic";
  if (isAcademic && u.grade !== currentUser.grade) { showToast("无权限操作此教师", "error"); return; }
  if (!confirm(`确认将 ${u.name} 的密码重置为 123456？`)) return;
  u.password = "123456"; saveDB(DB); showToast("密码已重置为 123456", "success");
};

window.delUser = function (id) {
  const u = DB.users.find((x) => x.id === id);
  if (!u) return;
  const isAcademic = currentUser.role === "academic";
  if (isAcademic && (u.grade !== currentUser.grade || u.role === "academic")) { showToast("无权限删除此教师", "error"); return; }
  if (!confirm(`确认删除教师「${u.name}」？此操作不可恢复。`)) return;
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
  const showStudentId = hasRoster(grade);

  // 各考试的审核状态（只看本班级）
  const examStatus = exams.map((e) => {
    const recs = DB.records.filter((r) => r.examId === e.id && r.classNo === classNo);
    const total = recs.length;
    const confirmed = recs.filter((r) => r.status === "confirmed").length;
    return { id: e.id, name: e.name, total, confirmed, pending: total - confirmed, allConfirmed: total > 0 && total === confirmed };
  });

  if (subjects.length === 0) {
    $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-icon">⚠️</div><div class="es-title">${grade} 尚未配置学科</div><div class="es-tip">请联系教务老师先进行学科设置</div></div></div>`;
    return;
  }

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">📥 上传 ${grade} ${classNo} 班级成绩</div>
      <p style="color:var(--text-light);margin-bottom:12px">上传后成绩进入「待审核」状态，教务老师确认后，数据即汇总到全年级。</p>

      <!-- 考试上传状态概览 -->
      <div class="review-status-box">
        <div style="font-weight:600;margin-bottom:8px">📊 本次考试状态（${classNo}）</div>
        <div class="table-wrap" style="margin-top:8px"><table class="data-table">
          <thead><tr><th>考试</th><th>学生数</th><th>已确认</th><th>待审核</th><th>状态</th></tr></thead>
          <tbody>${examStatus.map((s) => {
            if (s.total === 0) {
              return `<tr><td>${esc(s.name)}</td><td>0</td><td>0</td><td>0</td><td><span class="tag">未上传</span></td></tr>`;
            } else if (s.allConfirmed) {
              return `<tr><td>${esc(s.name)}</td><td>${s.total}</td><td style="color:#1a7f37">${s.confirmed}</td><td style="color:#ccc">0</td><td><span class="tag tag-success">✓ 教务已确认</span></td></tr>`;
            } else {
              return `<tr><td>${esc(s.name)}</td><td>${s.total}</td><td style="color:#1a7f37">${s.confirmed}</td><td style="color:#d35400">${s.pending}</td><td><span class="tag tag-warning">⏳ 待教务审核</span></td></tr>`;
            }
          }).join("")}</tbody>
        </table></div>
      </div>

      <div class="form-row">
        <div class="form-group" style="flex:1"><label>选择考试</label>
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
        • Excel 首行为表头：<b>学号（可留空）、姓名、${subjects.map((s) => s.name).join("、")}</b><br/>
        • <b>学号列为可选</b>：留空时系统自动分配格式「班级-序号」（如 1-001），下次上传同名学生自动沿用，<b>班主任无需手打学号</b><br/>
        • 同班同名学生必须手动补充学号区分（如「张三1」「张三2」或填入学号），系统会检测并提示<br/>
        • 学生姓名是唯一识别方式，请确保姓名填写准确<br/>
        • 留空的分数视为缺考，不计入统计<br/>
        • <b>提交后，成绩将进入「待审核」状态，教务老师确认后会汇总到全年级排名。</b>
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
  const classNo = currentUser.classNo;
  const subjects = DB.subjects[grade] || [];
  const headers = ["学号（可留空）", "姓名", ...subjects.map((s) => s.name)];
  const rows = [headers];
  for (let i = 1; i <= 3; i++) {
    rows.push([
      "",  // 学号留空，系统自动生成
      `${classNo}学生${i}`,
      ...subjects.map((s) => Math.floor(Math.random() * s.fullScore))
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "成绩模板");
  XLSX.writeFile(wb, `${grade}_${classNo}_成绩模板.xlsx`);
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
      const classNo = displayClassNo(currentUser.classNo) || currentUser.classNo;
      const subjects = DB.subjects[grade] || [];
      const subjectNames = subjects.map((s) => s.name);

      // 从已有成绩数据中，构建"姓名 → 已有学号"映射，自动重用
      const existingNameToId = {};
      DB.records.filter((r) => r.grade === grade && classNoEquals(r.classNo, classNo)).forEach((r) => {
        if (!existingNameToId[r.studentName]) existingNameToId[r.studentName] = r.studentId;
      });
      // 还要从即将解析的数据中构建学号冲突检查
      const parsedRowIds = new Set();

      const parsed = [];
      const autoGenNotes = [];  // 记录哪些学生自动分配了学号
      const conflictWarnings = [];

      for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx];
        let studentId = String(row["学号"] || row["学号（可留空）"] || row["id"] || "").trim();
        const studentName = String(row["姓名"] || row["name"] || "").trim();
        if (!studentName) continue;

        // 学号留空 → 自动分配
        if (!studentId) {
          if (existingNameToId[studentName]) {
            // 历史已有该姓名，直接沿用历史学号
            studentId = existingNameToId[studentName];
          } else {
            // 新学生：自动分配格式 "班级-序号"
            const classPrefix = classNo.replace(/[^0-9A-Za-z]/g, '') || classNo;
            const countSoFar = parsed.filter((p) => p.studentName === studentName).length;
            if (countSoFar === 0) {
              studentId = `${classPrefix}-${String(parsed.length + 1).padStart(3, "0")}`;
              autoGenNotes.push(studentName);
            } else {
              // 同班同名 → 提示用户手动处理
              conflictWarnings.push(`第 ${rowIdx + 2} 行：同班同名「${studentName}」，请手动补充学号区分`);
              continue;
            }
          }
        } else {
          // 用户自己填了学号
          if (parsedRowIds.has(studentId)) {
            conflictWarnings.push(`学号「${studentId}」重复出现：${studentName}，请核查`);
            continue;
          }
          parsedRowIds.add(studentId);
        }

        const scores = {};
        subjectNames.forEach((sn) => {
          const v = row[sn];
          if (v !== "" && v != null && !isNaN(Number(v))) scores[sn] = Number(v);
        });
        let total = 0;
        subjectNames.forEach((sn) => { if (scores[sn] != null) total += scores[sn]; });
        parsed.push({
          id: uid(), examId: $("u_exam").value, grade, classNo,
          studentId, studentName, scores, total,
          uploadedBy: currentUser.id, uploadedAt: Date.now(),
          status: "pending", confirmedAt: null, confirmedBy: null
        });
      }

      if (parsed.length === 0) {
        showToast(conflictWarnings.length ? `未能解析有效学生：${conflictWarnings[0]}` : "未能解析任何有效学生", "error");
        return;
      }

      const subjectNames2 = subjects.map((s) => s.name);
      const autoNote = autoGenNotes.length > 0
        ? `<div style="padding:10px 12px;background:#e6f7ea;border-left:3px solid #1a7f37;border-radius:4px;font-size:12px;margin-bottom:10px">💡 系统已为 ${autoGenNotes.length} 位学生自动分配学号：${autoGenNotes.slice(0, 6).join("、")}${autoGenNotes.length > 6 ? "……" : ""}</div>`
        : "";
      const conflictNote = conflictWarnings.length > 0
        ? `<div style="padding:10px 12px;background:#fff0f0;border-left:3px solid #c0392b;border-radius:4px;font-size:12px;margin-bottom:10px">⚠️ ${conflictWarnings.join("；")}</div>`
        : "";

      const preview = `
        <div class="card-title" style="border:none;padding:0;margin-bottom:12px">
          📋 已解析 ${parsed.length} 名学生 - ${grade} ${classNo}
        </div>
        ${autoNote}
        ${conflictNote}
        <div class="review-tip" style="background:#fff3cd;color:#856404;margin:12px 0">
          ℹ️ 提交后，本班级成绩将进入 <b>「待审核」</b> 状态，教务老师确认后会汇总到全年级并通知相关教师。
        </div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr>${showStudentId ? "<th>学号</th>" : ""}<th>姓名</th>${subjectNames2.map((n) => `<th>${n}</th>`).join("")}<th>总分</th><th>上传状态</th></tr></thead>
          <tbody>${parsed.slice(0, 30).map((r) => {
            const rosterId = showStudentId ? getStudentIdFromRoster(grade, classNo, r.studentName) : "";
            return `<tr>${showStudentId ? `<td>${esc(rosterId)}</td>` : ""}<td>${esc(r.studentName)}</td>${subjectNames2.map((n) => `<td>${r.scores[n] != null ? r.scores[n] : "<span style='color:#ccc'>缺考</span>"}</td>`).join("")}<td><b>${r.total}</b></td><td><span class="tag tag-warning">待审核</span></td></tr>`;
          }).join("")}</tbody>
        </table></div>
        ${parsed.length > 30 ? `<p style="text-align:center;color:var(--text-light);margin-top:10px">仅显示前 30 行，共 ${parsed.length} 行</p>` : ""}
        <div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn btn-secondary" onclick="renderUploadScores()">取消</button>
          <button class="btn btn-danger" id="u_cancel">一键退回（不提交，重新上报）</button>
          <button class="btn btn-success" id="confirm_upload">✓ 确认提交（进入待审核）</button>
        </div>
      `;
      $("u_preview").innerHTML = preview;

      $("confirm_upload").onclick = () => {
        const examId = $("u_exam").value;
        // 统计当前考试中已确认的记录数（用于提示）
        const existingConfirmed = DB.records.filter((r) => r.examId === examId && r.grade === grade && classNoEquals(r.classNo, classNo) && r.status === "confirmed").length;
        const examName = $("u_exam").selectedOptions[0].text;
        showModal("确认上传", `<div>
          <p>将把 <b>${parsed.length}</b> 名学生成绩上传到 <b>${esc(examName)}</b>。</p>
          <p style="color:#856404;margin-top:8px">ℹ️ 提交后数据为<b>「待审核」</b>状态，由教务老师确认后才会汇总到全年级。</p>
          ${existingConfirmed > 0 ? `<p style="color:#28a745;margin-top:8px">✅ 当前班级已有 <b>${existingConfirmed}</b> 条成绩已确认，将予以保留，不会被覆盖。仅会替换/新增本班级的待审核记录。</p>` : ""}
        </div>`, "✓ 确认上传", () => {
          // 仅删除本考试+本班级中 status="pending" 且与解析记录匹配的记录，保留已确认的记录
          const pendingToRemove = new Set(parsed.map((p) => p.studentId));
          DB.records = DB.records.filter((r) => !(
            r.examId === examId && r.grade === grade && classNoEquals(r.classNo, classNo) &&
            r.status === "pending" && pendingToRemove.has(r.studentId)
          ));
          parsed.forEach((p) => DB.records.push(p));
          saveDB(DB);
          showToast(`成功上传 ${parsed.length} 条成绩，已进入待审核状态${existingConfirmed > 0 ? `（保留 ${existingConfirmed} 条已确认记录）` : ""}`, "success");
          renderUploadScores();
        });
      };

      $("u_cancel").onclick = () => {
        showModal("取消上传", `<div>
          <p>将取消本次上传，不会保存任何数据。</p>
          <p style="color:#856404;margin-top:8px">你可以重新编辑 Excel 文件后再次上传。</p>
        </div>`, "✓ 取消并返回", () => {
          $("u_preview").innerHTML = "";
          showToast("已取消，可重新上传", "info");
        });
      };
    } catch (err) {
      showToast("文件解析失败：" + err.message, "error");
    }
  };
  reader.readAsArrayBuffer(file);
}

// ========== 教务：上传全年级成绩（所有班级） ==========
function renderAcademicUploadScores() {
  if (currentUser.role !== "academic") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const exams = DB.exams.filter((e) => e.grade === grade);
  const subjects = DB.subjects[grade] || [];
  const showStudentId = hasRoster(grade);

  if (subjects.length === 0) {
    $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-icon">⚠️</div><div class="es-title">${grade} 尚未配置学科</div><div class="es-tip">请先进行学科设置</div></div></div>`;
    return;
  }

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">📥 上传 ${grade} 全年级成绩（所有班级一次导入）</div>
      <div class="form-row">
        <div class="form-group"><label>选择考试</label>
          <select id="a_exam">
            ${exams.map((e) => `<option value="${e.id}">${e.name}</option>`).join("")}
            ${exams.length === 0 ? `<option>暂无考试</option>` : ""}
          </select>
        </div>
        <div class="form-group" style="display:flex;align-items:flex-end">
          <button class="btn btn-info" onclick="window.downloadAcademicTemplate()">⬇ 下载全年级Excel模板</button>
        </div>
      </div>

      <div id="a_uploadArea" class="upload-area">
        <div class="ua-icon">📂</div>
        <div class="ua-title">点击选择多个 Excel 文件（每班一个，可一次框选 .xlsx / .xls）</div>
        <div class="ua-tip">或直接拖拽多个文件到此区域。系统按「班级」列合并，一次提交全部班级</div>
        <input type="file" id="a_file" accept=".xlsx,.xls" multiple style="display:none" />
      </div>

      <div id="a_preview" style="margin-top:20px"></div>
    </div>
    <div class="card">
      <div class="card-title">📋 Excel 模板说明（教务端）</div>
      <p style="color:var(--text-light); line-height:1.9;">
        • Excel 首行为表头：<b>学号（可留空）、姓名、班级、${subjects.map((s) => s.name).join("、")}</b><br/>
        • <b>「班级」列必填</b>：系统据此按班级拆分并写入成绩<br/>
        • <b>学号列为可选</b>：留空时系统自动分配「班级-序号」（如 1-001、2-003），下次上传同班级同名学生自动沿用<br/>
        • 支持同一文件中混合多个班级（如：1班、2班、3班……）<br/>
        • 同班同名学生必须手动补充学号区分（如「张三1」「张三2」），系统会检测并提示<br/>
        • 留空的分数视为缺考，不计入统计
      </p>
    </div>
  `;

  const ua = $("a_uploadArea");
  ua.onclick = () => $("a_file").click();
  ua.addEventListener("dragover", (e) => { e.preventDefault(); ua.classList.add("dragover"); });
  ua.addEventListener("dragleave", () => ua.classList.remove("dragover"));
  ua.addEventListener("drop", (e) => {
    e.preventDefault(); ua.classList.remove("dragover");
    if (e.dataTransfer.files.length) handleAcademicExcelFile(e.dataTransfer.files);
  });
  $("a_file").addEventListener("change", (e) => {
    if (e.target.files.length) handleAcademicExcelFile(e.target.files);
  });
}

window.downloadAcademicTemplate = function () {
  const grade = currentUser.grade;
  const subjects = DB.subjects[grade] || [];
  const headers = ["学号（可留空）", "姓名", "班级", ...subjects.map((s) => s.name)];
  const rows = [headers];
  const sampleClasses = ["1班", "2班", "3班"];
  sampleClasses.forEach((c) => {
    for (let i = 1; i <= 3; i++) {
      rows.push([
        "",  // 学号留空，系统自动分配
        `${c}学生${i}`,
        c,
        ...subjects.map((s) => Math.floor(Math.random() * s.fullScore))
      ]);
    }
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "全年级成绩");
  XLSX.writeFile(wb, `${grade}_全年级成绩模板.xlsx`);
  showToast("模板已下载", "success");
};

function handleAcademicExcelFile(fileList) {
  const files = Array.from(fileList);
  if (files.length === 0) return;

  const grade = currentUser.grade;
  const subjects = DB.subjects[grade] || [];
  const subjectNames = subjects.map((s) => s.name);

  // 从已有成绩数据中，构建"班级+姓名 → 学号"映射
  const existingKeyToId = {};
  DB.records.filter((r) => r.grade === grade).forEach((r) => {
    const key = `${r.classNo}|${r.studentName}`;
    if (!existingKeyToId[key]) existingKeyToId[key] = r.studentId;
  });

  const allParsed = [];
  const conflictWarnings = [];
  const autoGenNotes = [];
  const classStat = {};
  const classCounter = {};      // 各班级内部计数器（用于自增学号）
  const globalRowIds = new Set(); // 跨文件检查学号冲突

  // 逐个文件异步解析
  let processed = 0;
  const totalFiles = files.length;

  function parseSingleFile(file, fileIdx) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = function (e) {
        try {
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

          for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
            const row = rows[rowIdx];
            let studentId = String(row["学号"] || row["学号（可留空）"] || row["id"] || "").trim();
            const studentName = String(row["姓名"] || row["name"] || "").trim();
            // 归一化班级号："7班" / "7" / "七班" 全部变为 "7班"
            let classNoRaw = String(row["班级"] || row["class"] || row["classNo"] || "").trim();
            const classNo = displayClassNo(classNoRaw) || classNoRaw;
            if (!studentName) continue;
            if (!classNo || classNo === "") {
              conflictWarnings.push(`文件「${file.name}」学生「${studentName}」缺少班级信息，已跳过`);
              continue;
            }

            const key = `${classNo}|${studentName}`;

            if (!studentId) {
              if (existingKeyToId[key]) {
                // 同班同姓名已有历史学号 → 复用
                studentId = existingKeyToId[key];
              } else {
                // 本次解析内已出现该班级+姓名 → 冲突
                const localCount = allParsed.filter((p) => p.classNo === classNo && p.studentName === studentName).length;
                if (localCount === 0) {
                  // 新学生 → 自动分配
                  const classPrefix = classNo.replace(/[^0-9A-Za-z]/g, '') || classNo;
                  classCounter[classPrefix] = (classCounter[classPrefix] || 0) + 1;
                  studentId = `${classPrefix}-${String(classCounter[classPrefix]).padStart(3, "0")}`;
                  autoGenNotes.push(`${classNo} ${studentName}`);
                } else {
                  conflictWarnings.push(`文件「${file.name}」第 ${rowIdx + 2} 行：${classNo} 同班同名「${studentName}」，请手动补充学号区分`);
                  continue;
                }
              }
            } else {
              // 用户自己填了学号，跨文件检查冲突
              if (globalRowIds.has(studentId)) {
                conflictWarnings.push(`文件「${file.name}」中学号「${studentId}」与其他文件重复：${studentName}`);
                continue;
              }
              globalRowIds.add(studentId);
            }

            const scores = {};
            subjectNames.forEach((sn) => {
              const v = row[sn];
              if (v !== "" && v != null && !isNaN(Number(v))) scores[sn] = Number(v);
            });
            let total = 0;
            subjectNames.forEach((sn) => { if (scores[sn] != null) total += scores[sn]; });
            allParsed.push({
              id: uid(), examId: $("a_exam").value, grade, classNo,
              studentId, studentName, scores, total,
              uploadedBy: currentUser.id, uploadedAt: Date.now(),
              status: "confirmed", confirmedAt: Date.now(), confirmedBy: currentUser.id
            });
            classStat[classNo] = (classStat[classNo] || 0) + 1;
          }
          resolve(true);
        } catch (err) {
          conflictWarnings.push(`文件「${file.name}」解析失败：${err.message}`);
          resolve(false);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  // 按顺序解析所有文件；完成后统一渲染
  (async function () {
    for (let i = 0; i < files.length; i++) {
      await parseSingleFile(files[i], i);
    }

    if (allParsed.length === 0) {
      showToast(conflictWarnings.length ? `未能解析有效学生：${conflictWarnings[0]}` : "未能解析任何有效学生，请检查列名", "error");
      return;
    }

    const classList = Object.keys(classStat).sort();
    const classInfo = classList.map((c) => `${c}（${classStat[c]}人）`).join("、");

    const autoNote = autoGenNotes.length > 0
      ? `<div style="padding:10px 12px;background:#e6f7ea;border-left:3px solid #1a7f37;border-radius:4px;font-size:12px;margin-bottom:10px">💡 已为 ${autoGenNotes.length} 位学生自动分配学号：${autoGenNotes.slice(0, 6).join("、")}${autoGenNotes.length > 6 ? "……" : ""}</div>`
      : "";
    const conflictNote = conflictWarnings.length > 0
      ? `<div style="padding:10px 12px;background:#fff0f0;border-left:3px solid #c0392b;border-radius:4px;font-size:12px;margin-bottom:10px">⚠️ ${conflictWarnings.slice(0, 8).join("；")}${conflictWarnings.length > 8 ? `（共${conflictWarnings.length}条）` : ""}</div>`
      : "";

    $("a_preview").innerHTML = `
      <div class="card-title" style="border:none;padding:0;margin-bottom:12px">
        📋 已解析 ${totalFiles} 个文件 · ${allParsed.length} 名学生 · 共 ${classList.length} 个班级：${esc(classInfo)}
      </div>
      ${autoNote}
      ${conflictNote}
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>班级</th>${showStudentId ? "<th>学号</th>" : ""}<th>姓名</th>${subjectNames.map((n) => `<th>${n}</th>`).join("")}<th>总分</th></tr></thead>
        <tbody>${allParsed.slice(0, 40).map((r) => {
          const rosterId = showStudentId ? getStudentIdFromRoster(grade, r.classNo, r.studentName) : "";
          return `<tr><td><b>${esc(r.classNo)}</b></td>${showStudentId ? `<td>${esc(rosterId)}</td>` : ""}<td>${esc(r.studentName)}</td>${subjectNames.map((n) => `<td>${r.scores[n] != null ? r.scores[n] : "<span style='color:#ccc'>缺考</span>"}</td>`).join("")}<td><b>${r.total}</b></td></tr>`;
        }).join("")}</tbody>
      </table></div>
      ${allParsed.length > 40 ? `<p style="text-align:center;color:var(--text-light);margin-top:10px">仅显示前 40 行，共 ${allParsed.length} 行</p>` : ""}
      <div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end">
        <button class="btn btn-secondary" onclick="renderAcademicUploadScores()">取消</button>
        <button class="btn btn-success" id="a_confirm_upload">✓ 确认导入 ${allParsed.length} 条成绩（${classList.length} 个班级）</button>
      </div>
    `;

    $("a_confirm_upload").onclick = () => {
      const examId = $("a_exam").value;
      DB.records = DB.records.filter((r) => {
        if (r.examId !== examId || r.grade !== grade) return true;
        if (!classList.includes(r.classNo)) return true;
        const match = allParsed.find((p) => p.classNo === r.classNo && p.studentId === r.studentId);
        return !match;
      });
      allParsed.forEach((p) => DB.records.push(p));
      saveDB(DB);
      showToast(`成功导入 ${allParsed.length} 条学生成绩（${classList.length} 个班级）`, "success");
      $("a_preview").innerHTML = "";
    };
  })();
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

  const showStudentId = hasRoster(grade);
  const thId = showStudentId ? ["学号"] : [];

  // 学生明细
  const t2 = [["年级排名", "班级", ...thId, "姓名", ...subjects.map((s) => s.name), "总分"]];
  records.slice().sort((a, b) => b.total - a.total).forEach((r, idx) => {
    const rosterId = showStudentId ? getStudentIdFromRoster(grade, r.classNo, r.studentName) : "";
    t2.push([idx + 1, r.classNo, ...(showStudentId ? [rosterId] : []), r.studentName, ...subjects.map((s) => r.scores[s.name] ?? ""), r.total]);
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
  const isAcademic = currentUser.role === "academic";
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
  const isAcademic = currentUser.role === "academic";
  let records = getVisibleRecords(DB.records.filter((r) => r.examId === examId && r.grade === grade));
  if (classFilter) records = records.filter((r) => r.classNo === classFilter);
  if (records.length === 0) {
    $("rank_result").innerHTML = `<div class="empty-state"><div class="es-icon">📭</div><div class="es-title">暂无成绩数据</div></div>`;
    return;
  }
  records.sort((a, b) => b.total - a.total);
  const stats = aggregateStats(records, subjects);
  const showStudentId = hasRoster(grade);

  // 获取所有班级（用于批量下载）
  const allClasses = [...new Set(DB.records.filter((r) => r.examId === examId && r.grade === grade).map((r) => r.classNo))].sort();

  const rows = records.map((r, idx) => {
    const rank = idx + 1;
    const badge = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank;
    const rosterId = showStudentId ? getStudentIdFromRoster(grade, r.classNo, r.studentName) : "";
    return `<tr class="${rank <= 3 ? "rank-top" : ""}">
      <td><b>${badge}</b></td>
      <td>${r.classNo}</td>
      ${showStudentId ? `<td>${esc(rosterId)}</td>` : ""}
      <td>${r.studentName}</td>
      ${subjects.map((s) => `<td>${r.scores[s.name] != null ? r.scores[s.name] : "-"}</td>`).join("")}
      <td><b>${r.total}</b></td>
    </tr>`;
  }).join("");

  const summaryRows = subjects.map((s) => {
    const st = stats[s.name];
    const colspan = showStudentId ? 4 : 3;
    return `<tr class="summary-row">
      <td colspan="${colspan}" style="text-align:right"><b>${s.name} 统计</b></td>
      <td colspan="${subjects.length + 1}">
        优秀 ${st.excellent}人（${fmtPct(st.excellentPct)}） ·
        良好 ${st.good}人（${fmtPct(st.goodPct)}） ·
        及格 ${st.passCount}人（${fmtPct(st.passPct)}） ·
        低分 ${st.low}人（${fmtPct(st.lowPct)}） ·
        平均 ${fmt(st.avg)} · 最高 ${st.max}（${st.maxCount}人） · 最低 ${st.min}（${st.minCount}人）
      </td>
    </tr>`;
  }).join("");

  // 批量下载按钮（仅教务端显示）
  let downloadBtns = `<button class="btn btn-primary" onclick="downloadRankingExcel('${examId}', '${grade}', '${classFilter}')">⬇ 下载当前排名</button>`;

  if (isAcademic && allClasses.length > 1) {
    downloadBtns = `
      <button class="btn btn-success" onclick="downloadAllRankingExcel('${examId}', '${grade}')">⬇ 一键下载全年组成绩</button>
      <button class="btn btn-info" onclick="downloadEachClassRankingExcel('${examId}', '${grade}')">⬇ 一键下载各班成绩</button>
      <button class="btn btn-primary" onclick="downloadRankingExcel('${examId}', '${grade}', '${classFilter}')">⬇ 下载当前排名</button>
    `;
  }

  const thStudentId = showStudentId ? "<th>学号</th>" : "";
  const tbodyRows = rows + summaryRows;

  $("rank_result").innerHTML = `
    <h3 style="margin:10px 0 14px">按总分排名（共 ${records.length} 名学生）</h3>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>排名</th><th>班级</th>${thStudentId}<th>姓名</th>${subjects.map((s) => `<th>${s.name}</th>`).join("")}<th>总分</th></tr></thead>
      <tbody>${tbodyRows}</tbody>
    </table></div>
    <div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
      ${downloadBtns}
    </div>
  `;
}

// 一键下载全年组成绩（所有班级合并到一个Excel）
window.downloadAllRankingExcel = function (examId, grade) {
  const exam = DB.exams.find((e) => e.id === examId);
  if (!exam) { showToast("考试不存在", "error"); return; }
  const subjects = DB.subjects[grade] || [];
  let records = getVisibleRecords(DB.records.filter((r) => r.examId === examId && r.grade === grade));
  if (records.length === 0) { showToast("无数据", "error"); return; }

  records.sort((a, b) => b.total - a.total);
  const wb = XLSX.utils.book_new();
  const showStudentId = hasRoster(grade);
  const thId = showStudentId ? ["学号"] : [];

  // Sheet 1: 全年级排名
  const t1 = [["年级排名", "班级", ...thId, "姓名", ...subjects.map((s) => s.name), "总分"]];
  records.forEach((r, idx) => {
    const rosterId = showStudentId ? getStudentIdFromRoster(grade, r.classNo, r.studentName) : "";
    t1.push([idx + 1, r.classNo, ...(showStudentId ? [rosterId] : []), r.studentName, ...subjects.map((s) => r.scores[s.name] ?? ""), r.total]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(t1), "全年级排名");

  // Sheet 2: 各班均分对比（无学号，无改动
  const classGroups = {};
  records.forEach((r) => { if (!classGroups[r.classNo]) classGroups[r.classNo] = []; classGroups[r.classNo].push(r); });
  const classes = Object.keys(classGroups).sort();
  const t2 = [["班级", "人数", ...subjects.map((s) => s.name + "均分"), "总分均分"]];
  classes.forEach((c) => {
    const cs = aggregateStats(classGroups[c], subjects);
    t2.push([c, classGroups[c].length, ...subjects.map((s) => +fmt(cs[s.name].avg)), +fmt(cs["总分"].avg)]);
  });
  const totalStats = aggregateStats(records, subjects);
  t2.push(["全年级", records.length, ...subjects.map((s) => +fmt(totalStats[s.name].avg)), +fmt(totalStats["总分"].avg)]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(t2), "各班均分");

  // Sheet 3: 统计详情
  const t3 = [["学科", "参考人数", "优秀人数", "优秀率", "良好人数", "良好率", "及格人数", "及格率", "低分人数", "低分率", "平均分", "最高分", "最高分人数", "最低分", "最低分人数"]];
  subjects.forEach((s) => {
    const st = totalStats[s.name];
    t3.push([s.name, st.total, st.excellent, fmt(st.excellentPct * 100, 2) + "%", st.good, fmt(st.goodPct * 100, 2) + "%", st.passCount, fmt(st.passPct * 100, 2) + "%", st.low, fmt(st.lowPct * 100, 2) + "%", +fmt(st.avg), st.max, st.maxCount, st.min, st.minCount]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(t3), "统计详情");

  XLSX.writeFile(wb, `${grade}_全年级_排名汇总_${exam.name}.xlsx`);
  showToast("已下载全年组成绩", "success");
};

// 一键下载各班成绩（每个班级单独一个Sheet）
window.downloadEachClassRankingExcel = function (examId, grade) {
  const exam = DB.exams.find((e) => e.id === examId);
  if (!exam) { showToast("考试不存在", "error"); return; }
  const subjects = DB.subjects[grade] || [];
  let records = getVisibleRecords(DB.records.filter((r) => r.examId === examId && r.grade === grade));
  if (records.length === 0) { showToast("无数据", "error"); return; }

  const classGroups = {};
  records.forEach((r) => { if (!classGroups[r.classNo]) classGroups[r.classNo] = []; classGroups[r.classNo].push(r); });
  const classes = Object.keys(classGroups).sort();
  const showStudentId = hasRoster(grade);
  const thId = showStudentId ? ["学号"] : [];

  const wb = XLSX.utils.book_new();

  classes.forEach((c) => {
    const classRecords = classGroups[c];
    classRecords.sort((a, b) => b.total - a.total);
    const cs = aggregateStats(classRecords, subjects);

    const sheetName = `${c}_排名`;
    const t1 = [["排名", ...thId, "姓名", ...subjects.map((s) => s.name), "总分"]];
    classRecords.forEach((r, idx) => {
      const rosterId = showStudentId ? getStudentIdFromRoster(grade, c, r.studentName) : "";
      t1.push([idx + 1, ...(showStudentId ? [rosterId] : []), r.studentName, ...subjects.map((s) => r.scores[s.name] ?? ""), r.total]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(t1), sheetName);

    const statName = `${c}_统计`;
    const t2 = [["学科", "均分", "最高分", "最低分", "优秀人数", "良好人数", "及格人数", "低分人数"]];
    subjects.forEach((s) => {
      const st = cs[s.name];
      t2.push([s.name, +fmt(st.avg), st.max, st.min, st.excellent, st.good, st.passCount, st.low]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(t2), statName);
  });

  XLSX.writeFile(wb, `${grade}_各班成绩_${exam.name}.xlsx`);
  showToast(`已下载 ${classes.length} 个班的成绩`, "success");
};

window.downloadRankingExcel = function (examId, grade, classFilter) {
  const exam = DB.exams.find((e) => e.id === examId);
  const subjects = DB.subjects[grade] || [];
  let records = getVisibleRecords(DB.records.filter((r) => r.examId === examId && r.grade === grade));
  if (classFilter) records = records.filter((r) => r.classNo === classFilter);
  if (records.length === 0) { showToast("无数据", "error"); return; }
  records.sort((a, b) => b.total - a.total);
  const stats = aggregateStats(records, subjects);
  const showStudentId = hasRoster(grade);
  const thId = showStudentId ? ["学号"] : [];

  const t1 = [["排名", "班级", ...thId, "姓名", ...subjects.map((s) => s.name), "总分"]];
  records.forEach((r, idx) => {
    const rosterId = showStudentId ? getStudentIdFromRoster(grade, r.classNo, r.studentName) : "";
    t1.push([idx + 1, r.classNo, ...(showStudentId ? [rosterId] : []), r.studentName, ...subjects.map((s) => r.scores[s.name] ?? ""), r.total]);
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
  let records = getVisibleRecords(DB.records.filter((r) => r.examId === examId && r.classNo === classNo));
  if (records.length === 0) {
    $("mc_result").innerHTML = `<div class="empty-state"><div class="es-icon">📭</div><div class="es-title">本考试暂无数据</div><div class="es-tip">请等待教务端审核通过后再查看</div></div>`;
    return;
  }
  records.sort((a, b) => b.total - a.total);
  const stats = aggregateStats(records, subjects);
  const showStudentId = hasRoster(grade);

  const thStudentId = showStudentId ? "<th>学号</th>" : "";
  const rows = records.map((r, idx) => {
    const rosterId = showStudentId ? getStudentIdFromRoster(grade, classNo, r.studentName) : "";
    return `<tr>
      <td>${idx + 1}</td>${showStudentId ? `<td>${esc(rosterId)}</td>` : ""}<td>${r.studentName}</td>
      ${subjects.map((s) => `<td>${r.scores[s.name] != null ? r.scores[s.name] : "-"}</td>`).join("")}
      <td><b>${r.total}</b></td>
    </tr>`;
  }).join("");

  const summaryRows = subjects.map((s) => {
    const st = stats[s.name];
    const colCount = showStudentId ? 3 : 2;
    return `<tr class="summary-row"><td colspan="${colCount}" style="text-align:right"><b>${s.name}</b></td>
      <td colspan="${subjects.length + 1}">优秀 ${st.excellent}人/${fmtPct(st.excellentPct)} · 良好 ${st.good}人/${fmtPct(st.goodPct)} · 及格 ${st.passCount}人/${fmtPct(st.passPct)} · 低分 ${st.low}人/${fmtPct(st.lowPct)} · 平均 ${fmt(st.avg)} · 最高 ${st.max}(${st.maxCount}人) · 最低 ${st.min}(${st.minCount}人)</td></tr>`;
  }).join("");

  $("mc_result").innerHTML = `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>排名</th>${thStudentId}<th>姓名</th>${subjects.map((s) => `<th>${s.name}</th>`).join("")}<th>总分</th></tr></thead>
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
          const cnt = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && r.classNo === classNo)).length;
          return `<tr><td>${e.name}</td><td>${e.date}</td><td>${cnt}</td>
            <td><button class="btn btn-sm btn-primary" onclick="downloadRankingExcel('${e.id}','${grade}','${classNo}')" ${cnt === 0 ? "disabled" : ""}>⬇ 下载</button></td></tr>`;
        }).join("") || `<tr><td colspan="4"><div class="empty-state"><div class="es-tip">暂无考试</div></div></td></tr>`}</tbody>
      </table></div>
    </div>
  `;
}

// ========== 教师排行榜计算核心：返回 { subjects, rows }
// 统一：判断 user 是否教 grade 的 classNo 的 subjectName
//   - 班主任：subjects 包含该学科 AND u.classNo === classNo
//   - 任课教师：subjects 包含该学科 AND (classNo 为空 → 全年级；否则按逗号分隔匹配)

// 中文数字 → 阿拉伯数字（支持 一 到 九十九）
function cn2num(s) {
  if (!s) return "";
  const map = { "零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
  // "十" / "十X" / "X十" / "X十Y"
  if (/^[一二三四五六七八九]?十[一二三四五六七八九]?$/.test(s)) {
    const parts = s.split("十");
    const tens = parts[0] ? map[parts[0]] : 1;
    const ones = parts[1] ? map[parts[1]] : 0;
    return String(tens * 10 + ones);
  }
  if (/^十$/.test(s)) return "10";
  // 单个中文数字
  const single = s.match(/^[零〇一二两三四五六七八九]$/);
  if (single) return String(map[s]);
  return "";
}

// 班级号标准化：提取班级序号（同时兼容阿拉伯数字和中文数字）
// "1班" → "1" | "7" → "7" | "七班" → "7" | "高一7班" → "7" | "十二班" → "12"
function normalizeClassNo(c) {
  if (!c) return "";
  const s = String(c).trim();
  // 1) 优先找阿拉伯数字
  const m = s.match(/\d+/);
  if (m) return m[0];
  // 2) 没有阿拉伯数字 → 提取中文数字部分
  const cn = s.match(/[零〇一二两三四五六七八九十]+/);
  if (cn) return cn2num(cn[0]);
  return "";
}

// 班级号归一化后显示（统一为 "X班" 格式）
function displayClassNo(c) {
  const n = normalizeClassNo(c);
  return n ? `${n}班` : c;
}

// 精确匹配两个班级号
function classNoEquals(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return normalizeClassNo(a) === normalizeClassNo(b);
}

function teacherTeaches(user, grade, classNo, subjectName) {
  if (!user || user.grade !== grade) return false;
  const subjects = user.subjects || [];
  if (subjects.indexOf(subjectName) < 0) return false;
  // 班主任：classNo 字段视为"所教班级列表"，支持多个（如 "1班,2班,3班"）
  // 第一个通常是班主任班级，其余是其他任教班级——全部视为"任课"
  if (user.role === "headteacher") {
    if (!user.classNo) return false;
    const classes = String(user.classNo).split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    return classes.some((c) => classNoEquals(c, classNo));
  }
  if (user.role === "teacher") {
    if (!user.classNo) return true;
    const classes = String(user.classNo).split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    return classes.some((c) => classNoEquals(c, classNo));
  }
  return false;
}

// 返回当前教师教的 classNo 集合（归一化形式）
function getTeacherClassNos(user, grade) {
  const subjects = user.subjects || [];
  const classNos = [...new Set(
    DB.records.filter((r) => r.grade === grade).map((r) => displayClassNo(r.classNo) || r.classNo)
  )];
  return classNos.filter((c) => subjects.some((sn) => teacherTeaches(user, grade, c, sn)));
}

function computeTeacherRanking(examId, grade) {
  const subjects = DB.subjects[grade] || [];
  const allRecords = getVisibleRecords(DB.records.filter((r) => r.examId === examId && r.grade === grade));
  if (allRecords.length === 0) return { subjects: [], rows: [] };
  // 按归一化后的班级号分组（"7班"/"7"/"七班" 全部归并为 "7班"）
  const byClass = {};
  allRecords.forEach((r) => {
    const key = displayClassNo(r.classNo);
    if (!byClass[key]) byClass[key] = [];
    byClass[key].push(r);
  });
  const gradeStats = aggregateStats(allRecords, subjects);

  // 辅助：找某班级某学科的任课教师
  function getClassSubjectTeachers(classNoKey, subjectName) {
    const teachers = [];
    DB.users.filter((u) => u.grade === grade).forEach((u) => {
      if (teacherTeaches(u, grade, classNoKey, subjectName)) teachers.push(u);
    });
    return teachers;
  }

  const rows = [];
  subjects.forEach((subject) => {
    const classes = Object.keys(byClass).sort();
    const subjectRows = [];
    classes.forEach((classNo) => {
      const classRecs = byClass[classNo];
      const cs = aggregateStats(classRecs, [subject])[subject.name];
      if (!cs || cs.total === 0) return;
      const teachers = getClassSubjectTeachers(classNo, subject.name);
      if (teachers.length === 0) {
        // 没找到匹配教师 → 保留成绩统计，但标记"未分配教师"
        subjectRows.push({
          subject: subject.name,
          teacherId: null, teacherName: `${classNo} ${subject.name}（未分配教师）`,
          classNo, total: cs.total, avg: cs.avg,
          excellent: cs.excellent, excellentPct: cs.excellentPct, excellentCount: cs.excellent,
          passCount: cs.passCount, passPct: cs.passPct,
          good: cs.good, goodPct: cs.goodPct, goodCount: cs.good,
          low: cs.low, lowPct: cs.lowPct, lowCount: cs.low,
          compositeScore: cs.excellentPct * 0.3 + cs.passPct * 0.3 + (cs.avg / subject.fullScore) * 0.4,
          gradeAvg: gradeStats[subject.name].avg
        });
      } else {
        teachers.forEach((teacher) => {
          const normalizedAvg = cs.avg / subject.fullScore;
          const compositeScore = cs.excellentPct * 0.3 + cs.passPct * 0.3 + normalizedAvg * 0.4;
          subjectRows.push({
            subject: subject.name, teacherId: teacher.id, teacherName: teacher.name,
            classNo, total: cs.total, avg: cs.avg,
            excellent: cs.excellent, excellentPct: cs.excellentPct, excellentCount: cs.excellent,
            passCount: cs.passCount, passPct: cs.passPct,
            good: cs.good, goodPct: cs.goodPct, goodCount: cs.good,
            low: cs.low, lowPct: cs.lowPct, lowCount: cs.low,
            normalizedAvg, compositeScore,
            gradeAvg: gradeStats[subject.name].avg
          });
        });
      }
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
      <div class="card-title">
        <span>🎖️ 教师排行榜 - ${grade}</span>
        <span class="ct-actions">
          <button class="btn btn-primary" onclick="showDiagnosisReport()">🔍 诊断</button>
          <button class="btn btn-info" onclick="refreshTeacherRankingPage()">🔄 刷新</button>
        </span>
      </div>
      <div class="form-row">
        <div class="form-group"><label>选择考试</label><select id="tr_exam">${exams.map((e) => `<option value="${e.id}">${e.name}</option>`).join("")}${exams.length === 0 ? `<option>暂无考试</option>` : ""}</select></div>
        <div class="form-group"><label>筛选学科</label><select id="tr_subject"><option value="">全部学科</option></select></div>
      </div>
      <div id="tr_result"></div>
    </div>
    <div id="diagnosis_area" style="margin-top:16px"></div>
  `;
  const tr_exam = $("tr_exam"); const tr_subject = $("tr_subject");
  const subjectList = DB.subjects[grade] || [];
  subjectList.forEach((s) => { const o = document.createElement("option"); o.value = s.name; o.textContent = s.name; tr_subject.appendChild(o); });
  const refresh = () => drawTeacherRanking(tr_exam.value, grade, tr_subject.value);
  tr_exam.onchange = refresh; tr_subject.onchange = refresh;
  if (exams.length) refresh();
}

// 诊断报告：逐个班级×学科显示实际匹配到的教师
window.showDiagnosisReport = function () {
  const grade = currentUser.grade;
  const classNosFromRecords = [...new Set(DB.records.filter((r) => r.grade === grade).map((r) => displayClassNo(r.classNo) || r.classNo))];
  const teachers = DB.users.filter((u) => u.grade === grade && (u.role === "headteacher" || u.role === "teacher"));
  const subjects = DB.subjects[grade] || [];

  // 逐班级逐学科的匹配结果
  let rows = [];
  classNosFromRecords.forEach((cls) => {
    subjects.forEach((subj) => {
      const matched = teachers.filter((u) => teacherTeaches(u, grade, cls, subj.name));
      rows.push({
        classNo: cls,
        subject: subj.name,
        match: matched.length,
        names: matched.map((u) => `${u.name}(${u.role === "headteacher" ? "班主任" : "任课教师"})`).join("、") || "❌ 未找到"
      });
    });
  });

  const teacherTable = teachers.map((u) => `<tr>
    <td>${esc(u.name)}</td>
    <td>${u.role === "headteacher" ? "班主任" : "任课教师"}</td>
    <td>${esc(u.classNo || "（不填）")}</td>
    <td>${esc((u.subjects || []).join("、") || "（不填）")}</td>
  </tr>`).join("") || "<tr><td colspan='4'><i>本年级暂无教师</i></td></tr>";

  const classHtml = classNosFromRecords.length
    ? classNosFromRecords.join("、")
    : "<i>暂无成绩数据</i>";

  const rowHtml = rows.length
    ? rows.map((r) => `<tr class="${r.match === 0 ? "diag-missing" : ""}">
        <td>${esc(r.classNo)}</td>
        <td>${esc(r.subject)}</td>
        <td>${r.match}</td>
        <td>${esc(r.names)}</td>
      </tr>`).join("")
    : `<tr><td colspan="4"><i>无数据可诊断</i></td></tr>`;

  $("diagnosis_area").innerHTML = `
    <div class="card">
      <div class="card-title">🔍 教师排行榜诊断报告</div>
      <div style="margin-bottom:16px;line-height:1.9">
        <b>当前年级</b>：${esc(grade)}<br/>
        <b>成绩记录涉及的班级</b>（共 ${classNosFromRecords.length} 个）：${classHtml}<br/>
        <b>学科配置</b>（共 ${subjects.length} 个）：${subjects.map((s) => s.name).join("、") || "（无）"}
      </div>
      <div class="card-title" style="padding-top:0;border-top:none;font-size:14px">📋 本年级教师（共 ${teachers.length} 人）</div>
      <div class="table-wrap" style="margin-bottom:16px"><table class="data-table">
        <thead><tr><th>教师</th><th>角色</th><th>班级字段</th><th>任教学科</th></tr></thead>
        <tbody>${teacherTable}</tbody>
      </table></div>
      <div class="card-title" style="padding-top:0;border-top:none;font-size:14px">🔬 每个班级×学科的匹配结果</div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>班级</th><th>学科</th><th>匹配教师数</th><th>匹配到的教师</th></tr></thead>
        <tbody>${rowHtml}</tbody>
      </table></div>
      <p style="color:#888;margin-top:12px;font-size:12px">
        说明：班主任若没填任教学科则不会出现在该学科的教师排行里；任课教师的「班级字段」不填代表教全年级所有班级，填写则只教对应班级。
      </p>
    </div>
  `;
  $("diagnosis_area").scrollIntoView({ behavior: "smooth" });
};

// 刷新按钮：从 localStorage 重新加载 DB，再重新渲染排行榜
window.refreshTeacherRankingPage = async function () {
  try {
    const raw = localStorage.getItem("smart_edu_db");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.users) DB.users = parsed.users;
      if (parsed.records) DB.records = parsed.records;
    }
  } catch (_) {}
  renderTeacherRanking();
  showToast("已刷新排行榜数据", "success");
};

function drawTeacherRanking(examId, grade, subjectFilter) {
  const { rows } = computeTeacherRanking(examId, grade);
  if (rows.length === 0) {
    $("tr_result").innerHTML = `<div class="empty-state">
      <div class="es-title">暂无数据</div>
      <div class="es-tip">请先上传成绩，或在「教师名单管理」中确认教师任教学科和班级已正确设置</div>
    </div>`;
    return;
  }

  const filtered = subjectFilter ? rows.filter((r) => r.subject === subjectFilter) : rows;
  const noTeacherRows = filtered.filter((r) => !r.teacherId);
  const validRows = filtered.filter((r) => r.teacherId);

  const noTeacherWarning = noTeacherRows.length > 0
    ? `<div style="padding:10px 12px;background:#fff8e6;border-left:3px solid #e6a000;border-radius:4px;font-size:12px;margin-bottom:12px">
        ⚠️ 有 <b>${noTeacherRows.length}</b> 个班级未分配任课教师（系统显示为灰色行），请在「教师名单管理」中为相关教师设置任教班级和学科
      </div>`
    : "";

  const trs = validRows.map((r) => `<tr class="${r.rank === 1 ? "rank-top" : ""}">
    <td>${r.rank}</td><td><b>${r.subject}</b></td><td>${r.teacherName}</td><td>${r.classNo}</td>
    <td>${r.total}</td><td>${fmt(r.avg)}</td><td>${r.excellent}/${fmtPct(r.excellentPct)}</td>
    <td>${r.passCount}/${fmtPct(r.passPct)}</td><td>${r.good}/${fmtPct(r.goodPct)}</td>
    <td>${r.low}/${fmtPct(r.lowPct)}</td><td><b>${fmt(r.compositeScore * 100, 2)}</b></td>
  </tr>`).join("");

  const noTeacherTrs = noTeacherRows.map((r) => `<tr style="background:#f5f5f5;color:#999">
    <td>—</td><td><b>${r.subject}</b></td><td>—</td><td>${r.classNo}</td>
    <td>${r.total}</td><td>${fmt(r.avg)}</td>
    <td colspan="5"><i>未分配教师，请在「教师名单管理」中添加任课教师并设置任教班级</i></td>
  </tr>`).join("");

  $("tr_result").innerHTML = `
    <p style="color:var(--text-light); margin-bottom:10px;">📘 综合分数 = 优秀率 × 0.3 + 及格率 × 0.3 + 标准化均分 × 0.4（同学科内排名）</p>
    ${noTeacherWarning}
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>名次</th><th>学科</th><th>任课教师</th><th>班级</th><th>人数</th><th>均分</th><th>优秀</th><th>及格</th><th>良好</th><th>低分</th><th>综合分数</th></tr></thead>
      <tbody>${trs}${noTeacherTrs}</tbody>
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
// ========== 教务：成绩审核（发送通知改为直接审核） ==========
function renderSendScores() {
  if (currentUser.role !== "academic") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const exams = DB.exams.filter((e) => e.grade === grade).sort((a, b) => b.createdAt - a.createdAt);

  // 各考试审核状态
  const examReviewStatus = exams.map((e) => {
    const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade);
    const total = recs.length;
    const confirmed = recs.filter((r) => r.status === "confirmed").length;
    const byClass = {};
    recs.forEach((r) => {
      if (!byClass[r.classNo]) byClass[r.classNo] = { total: 0, confirmed: 0 };
      byClass[r.classNo].total++;
      if (r.status === "confirmed") byClass[r.classNo].confirmed++;
    });
    return {
      id: e.id, name: e.name, total, confirmed,
      pending: total - confirmed,
      allConfirmed: total > 0 && total === confirmed,
      byClass
    };
  });

  // 全部考试的汇总
  const totalRecords = examReviewStatus.reduce((s, e) => s + e.total, 0);
  const totalPending = examReviewStatus.reduce((s, e) => s + e.pending, 0);
  const totalConfirmed = examReviewStatus.reduce((s, e) => s + e.confirmed, 0);

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">✅ 成绩审核与发布</div>
      <p style="color:var(--text-light); margin-bottom:12px;">
        班主任上传成绩后，在此页面<b>一键审核</b>。审核通过后，数据将<b style="color:#1a7f37">自动显示</b>在班主任和任课教师的成绩查询页面，无需手动发送。
      </p>

      <!-- 全部考试总览 -->
      <div class="stats-grid">
        <div class="stat-card ${totalPending > 0 ? "warning" : "success"}">
          <div class="sc-label">全部考试记录</div>
          <div class="sc-value">${totalRecords}</div>
          <div style="font-size:12px;color:var(--text-light)">待审: <b style="color:${totalPending > 0 ? "#d35400" : "#ccc"}">${totalPending}</b> | 已确认: <b style="color:#1a7f37">${totalConfirmed}</b></div>
        </div>
        <div class="stat-card ${totalPending > 0 ? "warning" : "success"}" style="grid-column:span 2">
          <div class="sc-label">一键审核全部</div>
          <button class="btn btn-lg btn-success" id="ss_batch_confirm_all" ${totalPending === 0 ? "disabled" : ""} onclick="ssConfirmAllPending()">
            ✅ 一键审核通过全部待审成绩（${totalPending > 0 ? totalPending + " 条" : "已全部审核"})
          </button>
          <div style="font-size:12px;color:var(--text-light);margin-top:6px">⚠️ 点击后所有待审记录转为"已确认"，班主任和任课教师即可查看</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-title">📋 各考试审核状态</div>
      <div class="form-row" style="margin-top:12px">
        <div class="form-group"><label>选择考试</label>
          <select id="ss_exam">${exams.map((e) => `<option value="${e.id}">${e.name}</option>`).join("")}${exams.length === 0 ? `<option>暂无考试</option>` : ""}</select>
        </div>
      </div>
      <div id="ss_review_table"></div>
      <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-warning" id="ss_batch_confirm" ${totalPending === 0 ? "disabled" : ""} onclick="ssConfirmCurrentExam()">
          ✅ 一键审核通过当前考试全部成绩
        </button>
      </div>
    </div>
  `;

  function updateReviewStatus() {
    const examId = $("ss_exam").value;
    const status = examReviewStatus.find((s) => s.id === examId);
    const tableEl = $("ss_review_table");
    const batchBtn = $("ss_batch_confirm");

    if (!status || status.total === 0) {
      tableEl.innerHTML = `<div class="review-tip warning">⚠️ 暂无成绩数据，请先让班主任上传</div>`;
      batchBtn.disabled = true;
      return;
    }

    const classNames = Object.keys(status.byClass).sort();
    let tableHTML = `<div style="margin-bottom:8px"><b>${esc(status.name)}</b>：共 <b>${status.total}</b> 条，已确认 <b style="color:#1a7f37">${status.confirmed}</b> 条，待审核 <b style="color:#d35400">${status.pending}</b> 条</div>`;
    tableHTML += `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>班级</th><th>学生数</th><th>已确认</th><th>待审核</th><th>状态</th></tr></thead>
      <tbody>`;
    classNames.forEach((c) => {
      const cs = status.byClass[c];
      const done = cs.confirmed === cs.total;
      tableHTML += `<tr class="${!done ? "row-pending" : ""}">
        <td>${esc(c)}</td>
        <td>${cs.total}</td>
        <td style="color:#1a7f37">${cs.confirmed}</td>
        <td style="color:${done ? "#ccc" : "#d35400"}">${cs.total - cs.confirmed}</td>
        <td><span class="tag ${done ? "tag-success" : "tag-warning"}">${done ? "✓ 全部已确认" : "⏳ 待审核"}</span></td>
      </tr>`;
    });
    tableHTML += `</tbody></table></div>`;
    tableEl.innerHTML = tableHTML;
    batchBtn.disabled = status.pending === 0;
    batchBtn.innerHTML = status.pending === 0 ? "✓ 当前考试已全部审核" : `✅ 一键审核通过当前考试全部成绩（${status.pending} 条待审）`;
  }

  $("ss_exam").onchange = updateReviewStatus;
  updateReviewStatus();
}

// 一键审核当前选中考试的所有待审记录
window.ssConfirmCurrentExam = function () {
  const examId = $("ss_exam").value;
  const exam = DB.exams.find((e) => e.id === examId);
  if (!exam) return;
  const grade = currentUser.grade;
  const targets = DB.records.filter((r) => r.examId === examId && r.grade === grade && r.status === "pending");
  if (targets.length === 0) { showToast("没有待审核的记录", "info"); return; }

  showModal("确认一键审核", `<div>
    <p>将把 <b>${esc(exam.name)}</b> 的 <b style="color:#d35400">${targets.length}</b> 条待审核成绩<b style="color:#1a7f37">全部确认为已审核</b>。</p>
    <p style="color:#1a7f37;margin-top:8px">✅ 确认后，班主任和任课教师将在各自页面自动看到这些数据。</p>
  </div>`, "✅ 确认审核通过", () => {
    const now = Date.now();
    targets.forEach((r) => { r.status = "confirmed"; r.confirmedAt = now; r.confirmedBy = currentUser.id; });
    saveDB(DB);
    showToast(`已审核通过 ${targets.length} 条成绩，班主任和任课教师端已可查看`, "success");
    renderSendScores();
  });
};

// 一键审核全部考试的所有待审记录
window.ssConfirmAllPending = function () {
  const grade = currentUser.grade;
  const targets = DB.records.filter((r) => r.grade === grade && r.status === "pending");
  if (targets.length === 0) { showToast("没有待审核的记录", "info"); return; }

  showModal("确认一键审核全部", `<div>
    <p>将把 <b style="color:#d35400">${targets.length}</b> 条待审核成绩（涉及全部考试）<b style="color:#1a7f37">全部确认为已审核</b>。</p>
    <p style="color:#1a7f37;margin-top:8px">✅ 确认后，所有班主任和任课教师将在各自页面自动看到这些数据。</p>
  </div>`, "✅ 确认审核全部", () => {
    const now = Date.now();
    targets.forEach((r) => { r.status = "confirmed"; r.confirmedAt = now; r.confirmedBy = currentUser.id; });
    saveDB(DB);
    showToast(`已审核通过 ${targets.length} 条成绩，全员可见`, "success");
    renderSendScores();
  });
};

// 添加审核状态样式
const reviewStatusStyle = document.createElement("style");
reviewStatusStyle.textContent = `
  .review-status-box { margin: 12px 0; padding: 12px; border-radius: 8px; background: #f8f9fc; }
  .review-tip { padding: 10px 14px; border-radius: 6px; font-size: 13px; }
  .review-tip.warning { background: #fff3cd; color: #856404; }
  .review-tip.success { background: #d4edda; color: #155724; }
`;
document.head.appendChild(reviewStatusStyle);

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

// ========== 全年组通知弹窗（教务端可发布，全年级自动弹窗 ==========
function renderGradeNotifications() {
  // 只有教务和同年级教师可见
  const isAcademic = currentUser.role === "academic";
  const grade = currentUser.grade;

  // 所有通知（同年级）
  const notifs = (DB.gradeNotifications || []).filter((n) => n.grade === grade).sort((a, b) => b.createdAt - a.createdAt);
  const pendingCount = notifs.length;

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">🔔 全年组通知弹窗</div>
      <p style="color:var(--text-light);margin-bottom:12px;">
        ${isAcademic
          ? `在这里发布同年级通知。发布后，该年级所有教师（班主任、任课教师）登录或刷新页面时将自动<b style="color:#dc3545">弹窗提醒</b>，直到手动关闭。`
          : `以下是教务为${esc(grade)}发布的重要通知。您可在此查看所有历史通知，未关闭的通知将在登录/刷新时自动弹窗提醒。`
        }
      </p>
    </div>

    ${isAcademic ? `
    <div class="card" style="margin-top:16px">
      <div class="card-title">📣 发布新通知</div>
      <div class="form-row" style="margin-top:12px">
        <div class="form-group" style="flex:1"><label>通知级别</label>
          <select id="gn_level">
            <option value="normal">普通通知（蓝色）</option>
            <option value="important">重要通知（橙色）</option>
            <option value="urgent">紧急通知（红色）</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:1"><label>通知标题</label>
          <input id="gn_title" placeholder="如：关于期中考试成绩审核的通知" style="width:100%" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:1"><label>通知内容</label>
          <textarea id="gn_content" rows="4" placeholder="请输入详细内容..." style="width:100%"></textarea>
        </div>
      </div>
      <div style="text-align:right;margin-top:12px">
        <button class="btn btn-success btn-lg" id="gn_post">📣 发布通知（全年级弹窗）</button>
      </div>
    </div>
    ` : ""}

    <div class="card" style="margin-top:16px">
      <div class="card-title">📋 通知列表（共 ${notifs.length} 条）</div>
      ${notifs.length === 0 ? `
        <div class="empty-state"><div class="es-icon">🔕</div><div class="es-title">暂无通知</div></div>
      ` : `
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>级别</th><th>标题</th><th>内容</th><th>发布人</th><th>发布时间</th>${isAcademic ? "<th>操作</th>" : ""}</th></tr></thead>
          <tbody>${notifs.map((n) => {
            const levelMap = { normal: { text: "普通", color: "#3b7ddd" }, important: { text: "重要", color: "#fd7e14" }, urgent: { text: "紧急", color: "#dc3545" } };
            const lm = levelMap[n.level] || levelMap.normal;
            return `<tr>
              <td><span class="tag" style="background:${lm.color}22;color:${lm.color};border:1px solid ${lm.color}44">${lm.text}</span></td>
              <td><b>${esc(n.title)}</b></td>
              <td style="max-width:400px">${esc(n.content)}</td>
              <td>${esc(n.createdBy)}</td>
              <td>${new Date(n.createdAt).toLocaleString()}</td>
              ${isAcademic ? `<td><button class="btn btn-sm btn-danger" onclick="delGradeNotif('${n.id}')">删除</button></td>` : ""}
            </tr>`;
          }).join("")}</tbody>
        </table></div>
      `}
    </div>
  `;

  if (isAcademic) {
    $("gn_post").onclick = () => {
      const title = $("gn_title").value.trim();
      const content = $("gn_content").value.trim();
      const level = $("gn_level").value;
      if (!title || !content) { showToast("请填写标题和内容", "error"); return; }

      DB.gradeNotifications.push({
        id: "gn_" + Date.now(),
        grade: grade,
        title, content, level,
        createdBy: currentUser.name,
        createdAt: Date.now()
      });
      // 清除所有用户对该年级的 dismissed 记录，确保所有人都能看到新通知
      DB.dismissedNotifications = DB.dismissedNotifications || {};
      saveDB(DB);
      showToast("✅ 通知已发布！全年级教师将收到弹窗提醒", "success");
      $("gn_title").value = "";
      $("gn_content").value = "";
      renderGradeNotifications();
    };
  }
}

window.delGradeNotif = function (id) {
  showModal("确认删除", `<p>删除此通知后，所有用户都将不再弹窗显示此条通知。确认删除？</p>`, "🗑️ 删除", () => {
    DB.gradeNotifications = DB.gradeNotifications.filter((n) => n.id !== id);
    saveDB(DB);
    showToast("已删除", "success");
    renderGradeNotifications();
  });
};

// 检查并弹出全年组通知（在页面加载/每次导航后调用
function checkGradeNotifications() {
  if (!currentUser) return;
  const grade = currentUser.grade;
  DB.dismissedNotifications = DB.dismissedNotifications || {};
  if (!DB.dismissedNotifications[currentUser.id]) {
    DB.dismissedNotifications[currentUser.id] = {};
  }

  // 找出当前年级未被当前用户关闭的通知（按重要性排序：urgent > important > normal
  const notifs = (DB.gradeNotifications || [])
    .filter((n) => n.grade === grade && !DB.dismissedNotifications[currentUser.id][n.id])
    .sort((a, b) => {
      const order = { urgent: 0, important: 1, normal: 2 };
      return (order[a.level] ?? 2) - (order[b.level] ?? 2) || b.createdAt - a.createdAt;
    });

  if (notifs.length === 0) return;

  // 弹出通知
  showGradeNotificationPopup(notifs, 0);
}

// 逐个弹出通知（一个接一个
function showGradeNotificationPopup(notifs, idx) {
  if (idx >= notifs.length) {
    saveDB(DB);
    return;
  }
  const n = notifs[idx];
  const levelMap = {
    normal: { icon: "📢", color: "#3b7ddd", text: "普通通知" },
    important: { icon: "⚠️", color: "#fd7e14", text: "重要通知" },
    urgent: { icon: "🚨", color: "#dc3545", text: "紧急通知" }
  };
  const lm = levelMap[n.level] || levelMap.normal;

  // 创建自定义弹窗（用 showModal 不可控，这里用自定义）
  const modalId = "gradeNotifModal";
  const existing = document.getElementById(modalId);
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = modalId;
  modal.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:99999;
    display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);
  `;
  modal.innerHTML = `
    <div style="
      background:#fff;border-radius:14px;padding:28px 32px;width:90%;max-width:540px;
      box-shadow:0 20px 60px rgba(0,0,0,0.25);border:3px solid ${lm.color};
      animation:notifPop 0.3s ease;
    ">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <span style="font-size:38px">${lm.icon}</span>
        <div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:2px">
            <h3 style="margin:0;color:${lm.color};font-size:18px">${esc(n.title)}</h3>
            <span class="tag" style="background:${lm.color}22;color:${lm.color};border:1px solid ${lm.color}44;font-size:11px">${lm.text}</span>
          </div>
          <div style="color:#999;font-size:12px">发布人：${esc(n.createdBy)}　·　${new Date(n.createdAt).toLocaleString()}　·　第 ${idx + 1}/${notifs.length} 条</div>
        </div>
      </div>
      <div style="background:${lm.color}08;padding:16px;border-radius:8px;margin:12px 0;line-height:1.7;color:#333;font-size:14px">
        ${esc(n.content).replace(/\n/g, "<br/>")}
      </div>
      <div style="text-align:right;margin-top:16px">
        <button class="btn btn-primary" id="gnCloseBtn" style="background:${lm.color};border-color:${lm.color}">我已知晓，关闭通知</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // 添加动画样式（如果还没有
  if (!document.getElementById("gnAnimStyle")) {
    const s = document.createElement("style");
    s.id = "gnAnimStyle";
    s.textContent = `@keyframes notifPop { 0% { transform: scale(0.9); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }`;
    document.head.appendChild(s);
  }

  $("gnCloseBtn").onclick = () => {
    DB.dismissedNotifications[currentUser.id][n.id] = true;
    saveDB(DB);
    modal.remove();
    // 继续弹出下一条
    setTimeout(() => showGradeNotificationPopup(notifs, idx + 1), 200);
  };
}

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
  const showStudentId = hasRoster(grade);
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
      const recs = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && r.classNo === classNo));
      if (!recs.length) return null;
      return +fmt(aggregateStats(recs, [s])[s.name].avg, 2);
    })
  }));

  const totalTrend = exams.map((e) => {
    const recs = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && r.classNo === classNo));
    if (!recs.length) return null;
    return +fmt(recs.reduce((a, b) => a + b.total, 0) / recs.length, 2);
  });
  const gradeTotalTrend = exams.map((e) => {
    const recs = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && r.grade === grade));
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
    getVisibleRecords(DB.records.filter((r) => r.examId === prevExam.id && r.classNo === classNo)).forEach((r) => { prevMap[r.studentId] = r; });
    const currRows = getVisibleRecords(DB.records.filter((r) => r.examId === currExam.id && r.classNo === classNo));
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
        <thead><tr><th>排名</th>${showStudentId ? "<th>学号</th>" : ""}<th>姓名</th><th>上次总分</th><th>本次总分</th><th>变化</th></tr></thead>
        <tbody>${studentRows.map((r, idx) => {
          const rosterId = showStudentId ? getStudentIdFromRoster(grade, classNo, r.studentName) : "";
          return `<tr>
            <td>${idx + 1}</td>${showStudentId ? `<td>${esc(rosterId)}</td>` : ""}<td><b>${esc(r.studentName)}</b></td>
            <td>${r.prevTotal != null ? r.prevTotal : "-"}</td><td><b>${r.total}</b></td>
            <td style="color:${r.diff == null ? '#999' : r.diff > 0 ? 'green' : r.diff < 0 ? 'red' : '#333'}">
              <b>${r.diff == null ? '-' : (r.diff > 0 ? '▲+' : '▼') + r.diff}</b>
            </td>
          </tr>`;
        }).join("")}</tbody>
      </table></div></div>`;
  }
  $("ht_student_card").innerHTML = studentCard;

  // 班级详细统计
  const recs = getVisibleRecords(DB.records.filter((r) => r.examId === selectedExam.id && r.classNo === classNo));
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
      const recs = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && r.classNo === classNo));
      const st = aggregateStats(recs, [s])[s.name];
      row.push(recs.length ? fmt(st.avg, 2) : "-");
    });
    return row;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([trendHeader, ...trendData]), "学科均分趋势");

  // Sheet 2: 学生明细
  const studentRecs = getVisibleRecords(DB.records.filter((r) => r.examId === selectedExam.id && r.classNo === classNo));
  const studentHeader = ["学号", "姓名", "班级", ...subjects.map((s) => s.name), "总分", "年级排名"];
  const studentRows = studentRecs.map((r) => {
    const allRecs = getVisibleRecords(DB.records.filter((x) => x.examId === selectedExam.id && x.grade === grade));
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
  if (currentUser.role !== "teacher" && currentUser.role !== "headteacher") {
    $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return;
  }
  const grade = currentUser.grade;
  const subjects = currentUser.subjects || [];
  const exams = getSortedExams(grade);

  if (exams.length === 0 || subjects.length === 0) {
    $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-tip">暂无任教考试数据</div></div></div>`; return;
  }

  // 只保留我教的班级（基于 subjects 推导）
  const myClassNos = getTeacherClassNos(currentUser, grade);

  const sections = subjects.map((subjectName) => {
    const subject = (DB.subjects[grade] || []).find((s) => s.name === subjectName);
    if (!subject) return "";
    // 进一步筛选：只对这个学科我确实教的班级
    const myClassesForSubject = myClassNos.filter((c) => teacherTeaches(currentUser, grade, c, subjectName));
    if (myClassesForSubject.length === 0) return "";

    const chartData = myClassesForSubject.map((c) => ({
      label: c + " " + subjectName,
      data: exams.map((e) => {
        const recs = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && r.classNo === c));
        const vals = recs.map((r) => r.scores[subjectName]).filter((v) => v != null);
        if (!vals.length) return null;
        return +fmt(vals.reduce((a, b) => a + b, 0) / vals.length, 2);
      })
    }));
    return `<div class="card">
      <div class="card-title">📘 ${subjectName} — ${myClassesForSubject.join("、")}</div>
      <div class="chart-box"><canvas id="chart_${subjectName}"></canvas></div>
      <div style="margin-top:12px;display:flex;gap:10px;justify-content:flex-end">
        <button class="btn btn-primary" onclick='window._downloadMySubject(${JSON.stringify(subjectName)},${JSON.stringify(grade)},${JSON.stringify(currentUser.id)})'>⬇ 下载 ${subjectName} 明细</button>
      </div>
    </div>`;
  }).join("");

  $("pageContent").innerHTML = `
    <div class="card"><div class="card-title">📖 我的班级成绩</div>
      <p style="color:var(--text-light); margin-bottom:14px;">
        身份：${currentUser.role === "headteacher" ? "班主任" : "任课教师"} · 任教科目：<b>${subjects.join("、") || "（尚未分配）"}</b>
        <br/>任教班级：<b>${myClassNos.length ? myClassNos.join("、") : "暂无"}</b> · 年级：${grade}
      </p>
    </div>
    ${sections || '<div class="card"><div class="empty-state"><div class="es-tip">暂无任教数据，请先上传成绩或检查任教学科设置</div></div></div>'}
  `;
  setTimeout(() => {
    subjects.forEach((sn) => {
      const subject = (DB.subjects[grade] || []).find((s) => s.name === sn);
      if (!subject) return;
      const myClassesForSubject = myClassNos.filter((c) => teacherTeaches(currentUser, grade, c, sn));
      if (myClassesForSubject.length === 0) return;
      const ds = myClassesForSubject.map((c) => ({
        label: c,
        data: exams.map((e) => {
          const recs = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && r.classNo === c));
          const vals = recs.map((r) => r.scores[sn]).filter((v) => v != null);
          if (!vals.length) return null;
          return +fmt(vals.reduce((a, b) => a + b, 0) / vals.length, 2);
        })
      }));
      drawChart("chart_" + sn, "line", exams.map((e) => e.name), ds);
    });
  }, 50);
}

window._downloadMySubject = function (subjectName, grade, teacherId) {
  const teacher = DB.users.find((u) => u.id === teacherId) || currentUser;
  const subjectNames = [subjectName];
  const myClasses = [...new Set(DB.records.filter((r) => r.grade === grade).map((r) => r.classNo))]
    .filter((c) => teacherTeaches(teacher, grade, c, subjectName));
  const filtered = getVisibleRecords(DB.records.filter((r) => r.grade === grade && myClasses.indexOf(r.classNo) >= 0 && r.scores[subjectName] != null));
  const showStudentId = hasRoster(grade);
  const thId = showStudentId ? ["学号"] : [];
  const rows = [["考试", "班级", ...thId, "姓名", subjectName]];
  filtered.forEach((r) => {
    const exam = DB.exams.find((e) => e.id === r.examId);
    const rosterId = showStudentId ? getStudentIdFromRoster(grade, r.classNo, r.studentName) : "";
    rows.push([exam ? exam.name : "-", r.classNo, ...(showStudentId ? [rosterId] : []), r.studentName, r.scores[subjectName]]);
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), subjectName);
  XLSX.writeFile(wb, `${subjectName}_任教成绩明细.xlsx`);
  showToast("已下载", "success");
};

function renderMyRanking() {
  if (currentUser.role !== "teacher" && currentUser.role !== "headteacher") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
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
  const myRows = allRows.filter((r) => subjects.indexOf(r.subject) >= 0 && r.teacherId === currentUser.id);

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
  if (currentUser.role !== "teacher" && currentUser.role !== "headteacher") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
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
  const myClassNos = getTeacherClassNos(currentUser, grade);

  let insights = [
    `• 任教科目：${subjects.join("、") || "暂无"}`,
    `• 任教班级：${myClassNos.length ? myClassNos.join("、") : "暂无"}`
  ];

  // 绘制各学科多班级对比图（只显示我教的班级，每个学科独立）
  let chartSection = "";
  subjects.forEach((subjectName) => {
    const myClasses = myClassNos.filter((c) => teacherTeaches(currentUser, grade, c, subjectName));
    if (myClasses.length === 0) return;
    const ds = myClasses.map((c) => ({
      label: c,
      data: exams.map((e) => {
        const recs = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && r.classNo === c));
        const vals = recs.map((r) => r.scores[subjectName]).filter((v) => v != null);
        if (!vals.length) return null;
        return +fmt(vals.reduce((a, b) => a + b, 0) / vals.length, 2);
      })
    }));
    chartSection += `<div class="card"><div class="card-title">📊 ${esc(subjectName)} — ${myClasses.join("、")} 均分趋势</div><div class="chart-box"><canvas id="ta_chart_${esc(subjectName)}"></canvas></div></div>`;
  });
  $("ta_chart_section").innerHTML = chartSection;

  setTimeout(() => {
    subjects.forEach((subjectName) => {
      const myClasses = myClassNos.filter((c) => teacherTeaches(currentUser, grade, c, subjectName));
      if (myClasses.length === 0) return;
      const ds = myClasses.map((c) => ({
        label: c,
        data: exams.map((e) => {
          const recs = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && r.classNo === c));
          const vals = recs.map((r) => r.scores[subjectName]).filter((v) => v != null);
          if (!vals.length) return null;
          return +fmt(vals.reduce((a, b) => a + b, 0) / vals.length, 2);
        })
      }));
      drawChart("ta_chart_" + subjectName, "line", exams.map((e) => e.name), ds);
    });
  }, 100);

  // 教师排行榜（只看自己任教班级的记录）
  const { rows } = computeTeacherRanking(selectedExam.id, grade);
  const myRows = rows.filter((r) => subjects.indexOf(r.subject) >= 0 && r.teacherId === currentUser.id);

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

  const displayRows = rows.filter((r) => subjects.indexOf(r.subject) >= 0);
  const rankingHTML = `<div class="card">
    <div class="card-title">🏅 ${esc(selectedExam.name)} 学科内排行（${subjects.join("、")}）</div>
    <p style="color:var(--text-light); font-size:13px; margin-bottom:12px;">
      这里展示的是：在你任教的学科内，各班级成绩在全年级同学科内的排名。你的班级已高亮。
    </p>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>名次</th><th>学科</th><th>班级</th><th>任课教师</th><th>班级人数</th><th>均分</th><th>优秀率</th><th>优秀人数</th><th>及格率</th><th>及格人数</th><th>良好率</th><th>良好人数</th><th>低分率</th><th>低分人数</th><th>综合分数</th></tr></thead>
      <tbody>${displayRows.map((r) => {
        const isMe = r.teacherId === currentUser.id;
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
  const myClassNos = getTeacherClassNos(currentUser, grade);

  const wb = XLSX.utils.book_new();

  // Sheet 1: 学科趋势（只含我教的班级）
  const trendHeader = ["学科", "班级", ...exams.map((e) => e.name)];
  const trendData = [];
  subjects.forEach((s) => {
    const myClasses = myClassNos.filter((c) => teacherTeaches(currentUser, grade, c, s));
    myClasses.forEach((c) => {
      const row = [s, c];
      exams.forEach((e) => {
        const recs = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && r.classNo === c));
        const vals = recs.map((r) => r.scores[s]).filter((v) => v != null);
        row.push(vals.length ? fmt(vals.reduce((a, b) => a + b, 0) / vals.length, 2) : "-");
      });
      trendData.push(row);
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([trendHeader, ...trendData]), "学科均分趋势");

  // Sheet 2: 教师排行榜（只含我教的学科）
  const { rows } = computeTeacherRanking(selectedExam.id, grade);
  const myRows = rows.filter((r) => subjects.indexOf(r.subject) >= 0);
  const rankHeader = ["名次", "学科", "班级", "任课教师", "班级人数", "均分", "优秀率", "优秀人数", "及格率", "及格人数", "良好率", "良好人数", "低分率", "低分人数", "综合分数"];
  const rankData = myRows.map((r) => [r.rank, r.subject, r.classNo, r.teacherName, r.total, fmt(r.avg), fmtPct(r.excellentPct), r.excellentCount, fmtPct(r.passPct), r.passCount, fmtPct(r.goodPct), r.goodCount, fmtPct(r.lowPct), r.lowCount, fmt(r.compositeScore * 100, 2)]);
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
  const isAcademic = role === "academic";
  const isHeadteacher = role === "headteacher";
  const classNo = isHeadteacher ? currentUser.classNo : null;
  const showStudentId = hasRoster(grade);

  // 考试选择（支持拖拽排序）
  const examChips = exams.map((e, i) => `
    <label class="exam-chip ${i >= exams.length - 3 ? "active" : ""}" data-exam-id="${e.id}">
      <input type="checkbox" name="exam_cb" value="${e.id}" ${i >= exams.length - 3 ? "checked" : ""}/>
      <span class="exam-chip-text">${esc(e.name)}</span>
      <span class="drag-handle">⋮⋮</span>
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
          <div class="toolbar-label">📋 选择考试（拖拽调整顺序，至少选2次）：</div>
          <div class="exam-chips" id="exam_chips_container">${examChips}</div>
          <button class="btn btn-sm btn-outline" onclick="cmpSelectRecent()">选最近3次</button>
          <button class="btn btn-sm btn-outline" onclick="cmpToggleSort()">🔄 切换顺序</button>
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

  // 初始化拖拽排序
  initExamDragSort();

  setTimeout(() => cmpRefreshContent(), 50);
}

let examSortAscending = true; // 默认按时间顺序

function cmpToggleSort() {
  examSortAscending = !examSortAscending;
  cmpRefreshContent();
  showToast(`已切换为${examSortAscending ? "升序(首次→最近)" : "降序(最近→首次)"}`, "info");
}

function initExamDragSort() {
  const container = $("exam_chips_container");
  if (!container) return;

  let dragged = null;

  container.addEventListener("dragstart", (e) => {
    if (e.target.classList.contains("exam-chip")) {
      dragged = e.target;
      e.target.style.opacity = "0.5";
    }
  });

  container.addEventListener("dragend", (e) => {
    if (e.target.classList.contains("exam-chip")) {
      e.target.style.opacity = "1";
      dragged = null;
    }
  });

  container.addEventListener("dragover", (e) => {
    e.preventDefault();
    const afterElement = getDragAfterElement(container, e.clientY);
    if (dragged) {
      if (afterElement == null) {
        container.appendChild(dragged);
      } else {
        container.insertBefore(dragged, afterElement);
      }
    }
  });

  function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll(".exam-chip:not([style*='opacity'])")];
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }
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

  // 获取考试顺序（按DOM顺序）
  const examChips = document.querySelectorAll(".exam-chip input:checked");
  const orderedExamIds = Array.from(examChips).map((c) => c.value);

  // 根据选中顺序和排序方向获取考试
  let selectedExams = DB.exams.filter((e) => orderedExamIds.includes(e.id));
  if (examSortAscending) {
    selectedExams.sort((a, b) => a.createdAt - b.createdAt);
  } else {
    selectedExams.sort((a, b) => b.createdAt - a.createdAt);
  }

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
  const isAcademic = role === "academic";
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

  // 图表区域
  const chartHTML = `
    <div class="cmp-chart-grid" style="margin-top:20px">
      <div class="cmp-chart-card"><div class="cmp-chart-title">📊 各班均分对比</div><div class="cmp-chart-box"><canvas id="cmp_class_avg_chart"></canvas></div></div>
      <div class="cmp-chart-card"><div class="cmp-chart-title">📈 各班均分趋势</div><div class="cmp-chart-box"><canvas id="cmp_class_trend_chart"></canvas></div></div>
    </div>
  `;

  return `<div class="cmp-panel">${tableHTML}${rankHTML}${chartHTML}</div>`;
}

// ========== Tab 2: 学生个人对比 ==========
function cmpRenderStudentTab(grade, subjects, selectedExams, examLabels, role) {
  const classNo = role === "headteacher" ? currentUser.classNo : null;
  const isAcademic = role === "academic";
  const firstExam = selectedExams[0];
  const lastExam = selectedExams[selectedExams.length - 1];

  // 获取学生数据
  const firstMap = {};
  getVisibleRecords(DB.records.filter((r) => r.examId === firstExam.id && r.grade === grade)).forEach((r) => { firstMap[r.studentId] = r; });

  const lastRecs = getVisibleRecords(DB.records.filter((r) => r.examId === lastExam.id && (!classNo || r.classNo === classNo)));
  const students = lastRecs.map((r) => {
    const first = firstMap[r.studentId];
    const firstTotal = first && typeof first.total === 'number' ? first.total : null;
    const diff = firstTotal !== null ? r.total - firstTotal : null;
    return { ...r, firstTotal, diff };
  }).sort((a, b) => (b.diff || 0) - (a.diff || 0));

  // 计算班级/年级排名
  const allFirst = getVisibleRecords(DB.records.filter((r) => r.examId === firstExam.id && r.grade === grade)).sort((a, b) => b.total - a.total);
  const allLast = getVisibleRecords(DB.records.filter((r) => r.examId === lastExam.id && r.grade === grade)).sort((a, b) => b.total - a.total);

  students.forEach((s) => {
    const firstIdx = allFirst.findIndex((x) => x.studentId === s.studentId);
    const lastIdx = allLast.findIndex((x) => x.studentId === s.studentId);
    s.firstRank = firstIdx >= 0 ? firstIdx + 1 : null;
    s.lastRank = lastIdx >= 0 ? lastIdx + 1 : null;
    s.rankChange = s.firstRank && s.lastRank ? s.firstRank - s.lastRank : null;
  });

  // 进步榜
  const thId = showStudentId ? "<th>学号</th>" : "";
  let html = `<div class="cmp-section-title">🏆 进步最快 TOP 10（${esc(firstExam.name)} → ${esc(lastExam.name)}）</div>`;
  html += `<div class="cmp-table-wrap"><table class="cmp-table">
    <thead><tr><th>排名</th><th>班级</th>${thId}<th>姓名</th><th>首次</th><th>最近</th><th>涨幅</th><th>首次排名</th><th>最近排名</th><th>排名变化</th></tr></thead><tbody>`;
  students.slice(0, 10).forEach((s, idx) => {
    const color = s.diff > 0 ? "var(--success)" : s.diff < 0 ? "var(--danger)" : "var(--text-light)";
    const rankColor = s.rankChange > 0 ? "var(--success)" : s.rankChange < 0 ? "var(--danger)" : "var(--text-light)";
    const rosterId = showStudentId ? getStudentIdFromRoster(grade, s.classNo, s.studentName) : "";
    html += `<tr>
      <td>${idx + 1}</td><td>${esc(s.classNo)}</td>${showStudentId ? `<td>${esc(rosterId)}</td>` : ""}<td><b>${esc(s.studentName)}</b></td>
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
    <thead><tr><th>排名</th><th>班级</th>${thId}<th>姓名</th><th>首次</th><th>最近</th><th>跌幅</th><th>首次排名</th><th>最近排名</th><th>排名变化</th></tr></thead><tbody>`;
  students.slice(-10).reverse().forEach((s, idx) => {
    const color = "var(--danger)";
    const rankColor = s.rankChange > 0 ? "var(--success)" : s.rankChange < 0 ? "var(--danger)" : "var(--text-light)";
    const rosterId = showStudentId ? getStudentIdFromRoster(grade, s.classNo, s.studentName) : "";
    html += `<tr>
      <td>${idx + 1}</td><td>${esc(s.classNo)}</td>${showStudentId ? `<td>${esc(rosterId)}</td>` : ""}<td><b>${esc(s.studentName)}</b></td>
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
    <thead><tr><th>班级</th>${thId}<th>姓名</th><th>首次</th><th>最近</th><th>波动</th><th>趋势</th></tr></thead><tbody>`;
  stableStudents.slice(0, 10).forEach((s) => {
    const rosterId = showStudentId ? getStudentIdFromRoster(grade, s.classNo, s.studentName) : "";
    html += `<tr><td>${esc(s.classNo)}</td>${showStudentId ? `<td>${esc(rosterId)}</td>` : ""}<td><b>${esc(s.studentName)}</b></td><td>${s.firstTotal || "-"}</td><td>${s.total}</td><td>${Math.abs(s.diff)}</td><td>➡️</td></tr>`;
  });
  html += `</tbody></table></div>`;

  // 每班所有学生详细分析（仅教务和班主任显示）
  if (isAcademic && !classNo) {
    html += `<div class="cmp-section-title" style="margin-top:24px">👥 每班所有学生详细分析</div>`;

    const allClasses = [...new Set(getVisibleRecords(DB.records.filter((r) => r.grade === grade)).map((r) => r.classNo))].sort();
    const allStudentsByClass = {};

    // 获取所有学生在所有考试中的数据
    const studentExamData = {};
    selectedExams.forEach((exam) => {
      getVisibleRecords(DB.records.filter((r) => r.examId === exam.id && r.grade === grade)).forEach((r) => {
        if (!studentExamData[r.studentId]) {
          studentExamData[r.studentId] = { studentId: r.studentId, studentName: r.studentName, classNo: r.classNo, exams: {} };
        }
        studentExamData[r.studentId].exams[exam.id] = { total: r.total, scores: r.scores };
      });
    });

    allClasses.forEach((c) => {
      const classStudents = Object.values(studentExamData).filter((s) => s.classNo === c);
      if (classStudents.length === 0) return;

      // 按最后一次考试总分排序
      classStudents.sort((a, b) => {
        const aTotal = b.exams[lastExam.id]?.total ?? -999;
        const bTotal = a.exams[lastExam.id]?.total ?? -999;
        return bTotal - aTotal;
      });

      html += `<div class="cmp-subject-card">
        <div class="cmp-section-title">🏫 ${esc(c)}（${classStudents.length}人）</div>
        <div class="cmp-table-wrap" style="max-height:300px;overflow-y:auto"><table class="cmp-table">
          <thead><tr><th>排名</th>${thId}<th>姓名</th>${examLabels.map((e) => `<th>${esc(e)}</th>`).join("")}<th>总涨跌幅</th></tr></thead>
          <tbody>`;

      classStudents.forEach((s, idx) => {
        const firstTotal = s.exams[firstExam.id]?.total;
        const lastTotal = s.exams[lastExam.id]?.total;
        const diff = firstTotal != null && lastTotal != null ? lastTotal - firstTotal : null;
        const diffColor = diff > 0 ? "var(--success)" : diff < 0 ? "var(--danger)" : "var(--text-light)";
        const rosterId = showStudentId ? getStudentIdFromRoster(grade, c, s.studentName) : "";

        html += `<tr>
          <td>${idx + 1}</td>${showStudentId ? `<td>${esc(rosterId)}</td>` : ""}<td><b>${esc(s.studentName)}</b></td>
          ${selectedExams.map((e) => `<td>${s.exams[e.id]?.total ?? "-"}</td>`).join("")}
          <td style="color:${diffColor};font-weight:bold">${diff != null ? (diff > 0 ? "+" : "") + diff : "-"}</td>
        </tr>`;
      });

      html += `</tbody></table></div></div>`;
    });
  }

  // 图表：学生成绩分布
  const chartHTML = `
    <div class="cmp-section-title" style="margin-top:24px">📊 学生成绩分布对比</div>
    <div class="cmp-chart-grid">
      <div class="cmp-chart-card"><div class="cmp-chart-title">📊 成绩涨幅分布</div><div class="cmp-chart-box"><canvas id="cmp_student_diff_chart"></canvas></div></div>
      <div class="cmp-chart-card"><div class="cmp-chart-title">📈 排名变化分布</div><div class="cmp-chart-box"><canvas id="cmp_rank_change_chart"></canvas></div></div>
    </div>
  `;

  return `<div class="cmp-panel">${html}${chartHTML}</div>`;
}

// ========== Tab 3: 学科详细分析 ==========
function cmpRenderSubjectTab(grade, subjects, selectedExams, examLabels, role) {
  const classNo = role === "headteacher" ? currentUser.classNo : null;
  const isAcademic = role === "academic";

  let html = "";

  // 学科总体统计
  html += `<div class="cmp-section-title">📚 各学科综合对比</div>`;
  html += `<div class="cmp-table-wrap"><table class="cmp-table">
    <thead><tr><th>学科</th>${examLabels.map((e) => `<th>${esc(e)}均分</th>`).join("")}<th>均分涨幅</th><th>最高分考试</th><th>最低分考试</th></tr></thead>
    <tbody>`;

  subjects.forEach((s) => {
    const examAverages = selectedExams.map((e) => {
      const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || r.classNo === classNo));
      const vals = recs.map((r) => r.scores[s.name]).filter((v) => typeof v === "number" && !isNaN(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });

    const validAvgs = examAverages.filter((a) => a != null);
    const diff = validAvgs.length >= 2 ? validAvgs[validAvgs.length - 1] - validAvgs[0] : null;
    const maxAvgExam = examAverages.reduce((max, val, idx, arr) => (val != null && (max.val == null || val > max.val)) ? { val, idx } : max, { val: null, idx: -1 });
    const minAvgExam = examAverages.reduce((min, val, idx, arr) => (val != null && (min.val == null || val < min.val)) ? { val, idx } : min, { val: null, idx: -1 });

    html += `<tr><td><b>${esc(s.name)}</b></td>
      ${examAverages.map((a) => `<td>${a != null ? +fmt(a, 2) : "-"}</td>`).join("")}
      <td style="color:${diff > 0 ? "var(--success)" : diff < 0 ? "var(--danger)" : "var(--text-light)"}">${diff != null ? (diff > 0 ? "+" : "") + fmt(diff, 2) : "-"}</td>
      <td>${maxAvgExam.idx >= 0 ? esc(examLabels[maxAvgExam.idx]) : "-"}</td>
      <td>${minAvgExam.idx >= 0 ? esc(examLabels[minAvgExam.idx]) : "-"}</td>
    </tr>`;
  });
  html += `</tbody></table></div>`;

  // 各学科详细分析
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

  // 学科对比图表
  const chartHTML = `
    <div class="cmp-section-title" style="margin-top:24px">📊 学科均分趋势对比</div>
    <div class="cmp-chart-card" style="max-width:100%"><div class="cmp-chart-box" style="height:350px"><canvas id="cmp_subject_trend_chart"></canvas></div></div>
  `;

  return `<div class="cmp-panel">${html}${chartHTML}</div>`;
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
  const classNo = role === "headteacher" ? currentUser.classNo : null;
  const isAcademic = role === "academic";

  if (activeTab === "tab_trend") {
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

  // 班级综合对比图表
  if (activeTab === "tab_class") {
    const classes = classNo ? [classNo] : [...new Set(getVisibleRecords(DB.records.filter((r) => r.grade === grade)).map((r) => r.classNo))].sort();

    // 各班均分对比柱状图
    const classAvgDatasets = classes.map((c) => ({
      label: c,
      data: selectedExams.map((e) => {
        const recs = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && r.classNo === c));
        if (!recs.length) return null;
        const totals = recs.map((r) => r.total);
        return +fmt(totals.reduce((a, b) => a + b, 0) / totals.length, 2);
      })
    }));
    drawChart("cmp_class_avg_chart", "bar", examLabels, classAvgDatasets);

    // 各班均分趋势折线图
    drawChart("cmp_class_trend_chart", "line", examLabels, classAvgDatasets);
  }

  // 学生个人对比图表
  if (activeTab === "tab_student") {
    const firstExam = selectedExams[0];
    const lastExam = selectedExams[selectedExams.length - 1];

    // 获取所有学生数据
    const firstMap = {};
    getVisibleRecords(DB.records.filter((r) => r.examId === firstExam.id && r.grade === grade)).forEach((r) => { firstMap[r.studentId] = r; });

    const lastRecs = getVisibleRecords(DB.records.filter((r) => r.examId === lastExam.id && (!classNo || r.classNo === classNo)));
    const students = lastRecs.map((r) => {
      const first = firstMap[r.studentId];
      const firstTotal = first && typeof first.total === 'number' ? first.total : null;
      const diff = firstTotal !== null ? r.total - firstTotal : null;
      return { ...r, firstTotal, diff };
    });

    // 成绩涨幅分布直方图
    const diffs = students.filter((s) => s.diff != null).map((s) => s.diff);
    if (diffs.length > 0) {
      const bins = [-100, -50, -20, -10, 0, 10, 20, 50, 100];
      const binLabels = ["<-50", "-50~-20", "-20~-10", "-10~0", "0~10", "10~20", "20~50", ">50"];
      const binCounts = bins.map((b, i) => diffs.filter((d) => i === 0 ? d < bins[i] : i === bins.length - 1 ? d >= bins[i] : d >= bins[i] && d < bins[i + 1]).length);

      // 简化直方图：用柱状图显示
      const diffChartDatasets = [{
        label: "人数",
        data: binCounts.map((c, i) => ({ x: binLabels[i], y: c }))
      }];
      drawChart("cmp_student_diff_chart", "bar", binLabels, [{ label: "人数", data: binCounts }]);
    }

    // 排名变化分布
    const allFirst = getVisibleRecords(DB.records.filter((r) => r.examId === firstExam.id && r.grade === grade)).sort((a, b) => b.total - a.total);
    const allLast = getVisibleRecords(DB.records.filter((r) => r.examId === lastExam.id && r.grade === grade)).sort((a, b) => b.total - a.total);

    const rankChanges = [];
    students.forEach((s) => {
      const firstIdx = allFirst.findIndex((x) => x.studentId === s.studentId);
      const lastIdx = allLast.findIndex((x) => x.studentId === s.studentId);
      if (firstIdx >= 0 && lastIdx >= 0) {
        rankChanges.push(firstIdx - lastIdx);
      }
    });

    if (rankChanges.length > 0) {
      const rankBins = [-100, -20, -10, -5, 0, 5, 10, 20, 100];
      const rankBinLabels = ["<-20", "-20~-10", "-10~-5", "-5~0", "0~5", "5~10", "10~20", ">20"];
      const rankBinCounts = rankBins.map((b, i) => rankChanges.filter((d) => i === 0 ? d < rankBins[i] : i === rankBins.length - 1 ? d >= rankBins[i] : d >= rankBins[i] && d < rankBins[i + 1]).length);
      drawChart("cmp_rank_change_chart", "bar", rankBinLabels, [{ label: "人数", data: rankBinCounts }]);
    }
  }

  // 学科详细分析图表
  if (activeTab === "tab_subject") {
    if (subjects.length > 0) {
      const subjDatasets = subjects.map((s) => ({
        label: s.name,
        data: selectedExams.map((e) => {
          const recs = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || r.classNo === classNo)));
          if (!recs.length) return null;
          const vals = recs.map((r) => r.scores[s.name]).filter((v) => typeof v === "number" && !isNaN(v));
          return vals.length ? +fmt(vals.reduce((a, b) => a + b, 0) / vals.length, 2) : null;
        })
      }));
      drawChart("cmp_subject_trend_chart", "line", examLabels, subjDatasets);
    }
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
    .exam-chip { display: flex; align-items: center; gap: 6px; padding: 6px 14px; border: 1.5px solid #e5e7eb; border-radius: 20px; font-size: 13px; cursor: pointer; transition: all 0.2s; background: #fff; user-select: none; }
    .exam-chip input { display: none; }
    .exam-chip.active { background: var(--primary); color: #fff; border-color: var(--primary); }
    .exam-chip .drag-handle { cursor: grab; opacity: 0.5; font-size: 12px; }
    .exam-chip:hover .drag-handle { opacity: 1; }
    .exam-chip[draggable="true"] { cursor: grab; }
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
  const classes = classNo ? [classNo] : [...new Set(getVisibleRecords(DB.records.filter((r) => r.grade === grade)).map((r) => r.classNo))].sort();
  const classHeader1 = ["班级", "考试人数", ...examLabels.flatMap((e) => [e + "-均分", e + "-最高", e + "-最低", e + "-标准差", e + "-及格率"])];
  const classData1 = [];
  classes.forEach((c) => {
    const row = [c];
    let firstCount = 0;
    selectedExams.forEach((e) => {
      const recs = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && r.classNo === c));
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
  getVisibleRecords(DB.records.filter((r) => r.examId === firstExam.id && r.grade === grade)).forEach((r) => { firstMap[r.studentId] = r; });
  const lastRecs = getVisibleRecords(DB.records.filter((r) => r.examId === lastExam.id && (!classNo || r.classNo === classNo)));
  const studentHeader = ["学号", "姓名", `${firstExam.name}总分`, `${lastExam.name}总分`, "涨幅", "首次排名", "最近排名", "排名变化"];
  const allFirst = getVisibleRecords(DB.records.filter((x) => x.examId === firstExam.id && x.grade === grade)).sort((a, b) => b.total - a.total);
  const allLast = getVisibleRecords(DB.records.filter((x) => x.examId === lastExam.id && x.grade === grade)).sort((a, b) => b.total - a.total);
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
      const recs = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || r.classNo === classNo)));
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
    ["总分均分", ...selectedExams.map((e) => { const recs = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || r.classNo === classNo))); return recs.length ? fmt(recs.reduce((a, b) => a + b.total, 0) / recs.length, 2) : "-"; })],
    ["总分标准差", ...selectedExams.map((e) => { const recs = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || r.classNo === classNo))); return recs.length ? fmt(mathStdDev(recs.map((r) => r.total)), 2) : "-"; })],
    ...subjects.map((s) => [s.name + "均分", ...selectedExams.map((e) => { const recs = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || r.classNo === classNo))); const vals = recs.map((r) => r.scores[s.name]).filter((v) => typeof v === "number"); return vals.length ? fmt(vals.reduce((a, b) => a + b, 0) / vals.length, 2) : "-"; })])
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
      <thead><tr>${showStudentId ? "<th>学号</th>" : ""}<th>姓名</th><th>小组</th><th>操作</th></tr></thead>
      <tbody>${groups.map((g, i) => {
        const rosterId = showStudentId ? getStudentIdFromRoster(grade, classNo, g.studentName) : "";
        return `<tr>${showStudentId ? `<td>${esc(rosterId)}</td>` : ""}<td><b>${esc(g.studentName)}</b></td><td><span class="tag tag-blue">${esc(g.groupName)}</span></td>
        <td><button class="btn btn-sm btn-danger" onclick="deleteGroupMember(${i})">删除</button></td></tr>`;
      }).join("")}</tbody></table></div></div>
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
    const thId = showStudentId ? "<th>学号</th>" : "";
    html += `<div class="cmp-section-title">👨‍🎓 小组成员成绩明细</div>
      <div class="cmp-table-wrap"><table class="cmp-table">
      <thead><tr>${thId}<th>姓名</th><th>小组</th><th>总分</th>`;
    subjects.forEach((s) => html += `<th>${esc(s.name)}</th>`);
    html += `</tr></thead><tbody>`;

    groups.forEach((g) => {
      const rec = DB.records.find((r) => r.examId === examId && r.classNo === classNo && r.studentId === g.studentId);
      const rosterId = showStudentId ? getStudentIdFromRoster(grade, classNo, g.studentName) : "";
      html += `<tr>${showStudentId ? `<td>${esc(rosterId)}</td>` : ""}<td><b>${esc(g.studentName)}</b></td><td><span class="tag tag-blue">${esc(g.groupName)}</span></td><td><b>${rec?.total || "-"}</b></td>`;
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
  const showStudentId = hasRoster(grade);

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

// ========== 教务端：学生名单管理 ==========
function renderStudentRoster() {
  if (currentUser.role !== "academic") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  if (!DB.studentRoster) DB.studentRoster = {};
  if (!DB.studentRoster[grade]) DB.studentRoster[grade] = {};

  const classes = [...new Set(DB.users.filter((u) => u.role === "headteacher" && u.grade === grade).map((u) => u.classNo).filter(Boolean))].sort((a, b) => {
    const na = parseInt(a) || 0, nb = parseInt(b) || 0;
    return na - nb;
  });

  // 获取已上传学生名单的班级
  const rosterClasses = Object.keys(DB.studentRoster[grade] || {}).sort();
  const totalStudents = rosterClasses.reduce((sum, c) => sum + (DB.studentRoster[grade][c] || []).length, 0);

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">📋 ${grade} 学生名单管理</div>
      <div style="margin-bottom:16px;padding:12px;background:var(--bg-light);border-radius:6px">
        <div style="display:flex;gap:20px;flex-wrap:wrap">
          <div>✅ <b>批量上传</b>：Excel 包含 学号、姓名、班级 三列，自动识别多班级</div>
          <div>✅ <b>数据编辑</b>：上传后可直接修改学生信息、添加或删除</div>
          <div>✅ <b>双模式保存</b>：合并模式（保留原有）或 替换模式（完全覆盖）</div>
        </div>
        <div style="margin-top:10px;color:var(--text-light);font-size:13px">
          📊 已上传 ${rosterClasses.length} 个班级，共 ${totalStudents} 名学生。已上传的名单可在每次考试中直接提取使用。
        </div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="window.downloadRosterTemplate()">⬇ 下载 Excel 模板</button>
        <button class="btn btn-success" onclick="document.getElementById('sr_file').click()">📤 上传名单（支持多选）</button>
        <input type="file" id="sr_file" accept=".xlsx,.xls" multiple style="display:none" onchange="handleRosterUpload(this)" />
        ${rosterClasses.length > 0 ? `<button class="btn btn-info" onclick="downloadAllRoster()">📤 下载所有名单</button>` : ''}
      </div>
    </div>

    <div id="sr_preview" style="margin-top:20px"></div>

    <div class="card" style="margin-top:20px">
      <div class="card-title">📊 已上传学生名单（${rosterClasses.length} 个班级，共 ${totalStudents} 人）</div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>班级</th><th>人数</th><th>学生名单（前5名）</th><th>操作</th></tr></thead>
        <tbody>
          ${rosterClasses.length === 0 ? `<tr><td colspan="4"><div class="empty-state"><div class="es-tip">🗂️ 暂无已上传的名单，请先上传学生名单</div></div></td></tr>` : rosterClasses.map((c) => {
            const students = DB.studentRoster[grade][c] || [];
            const previewNames = students.slice(0, 5).map((s) => esc(s.studentName)).join("、");
            return `<tr>
              <td><b>${esc(c)}</b></td>
              <td>${students.length} 人</td>
              <td style="color:var(--text-light);font-size:12px">${esc(previewNames)}${students.length > 5 ? `等 ${students.length} 名学生` : ''}</td>
              <td>
                <button class="btn btn-sm btn-primary" onclick="extractRosterToExam('${esc(c)}')">📥 提取到考试</button>
                <button class="btn btn-sm btn-info" onclick="viewRosterClass('${esc(c)}')">👁️ 查看</button>
                <button class="btn btn-sm btn-warning" onclick="editRosterClass('${esc(c)}')">✏️ 编辑</button>
                <button class="btn btn-sm btn-danger" onclick="deleteRosterClass('${esc(c)}')">🗑️ 删除</button>
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table></div>
    </div>
  `;

  // 绑定班级切换事件
  if (classes.length > 0) viewRosterClass(classes[0]);
}

window.downloadAllRoster = function () {
  const grade = currentUser.grade;
  const rosterClasses = Object.keys(DB.studentRoster[grade] || {}).sort();
  if (rosterClasses.length === 0) {
    showToast("暂无已上传的名单", "warning");
    return;
  }

  const rows = [["学号", "姓名", "班级"]];
  rosterClasses.forEach((c) => {
    const students = DB.studentRoster[grade][c] || [];
    students.forEach((s) => {
      rows.push([s.studentId || "", s.studentName || "", c]);
    });
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "学生名单");
  XLSX.writeFile(wb, `${grade}_学生名单_${new Date().toISOString().slice(0, 10)}.xlsx`);
  showToast("下载成功", "success");
};

window.downloadRosterTemplate = function () {
  const grade = currentUser.grade;
  const headers = ["学号", "姓名", "班级"];
  const rows = [headers, ["001", "张三", "1班"], ["002", "李四", "1班"], ["003", "王五", "2班"]];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "学生名单");
  XLSX.writeFile(wb, `${grade}_学生名单模板.xlsx`);
  showToast("模板已下载", "success");
};

function handleRosterUpload(input) {
  const files = Array.from(input.files);
  if (files.length === 0) return;

  if (files.length > 1) {
    showToast(`正在处理 ${files.length} 个文件...`, "info");
  }

  const grade = currentUser.grade;
  if (!DB.studentRoster) DB.studentRoster = {};
  if (!DB.studentRoster[grade]) DB.studentRoster[grade] = {};

  // 解析单个文件的函数
  const parseFile = (file) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

          const classGroups = {};
          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const studentId = String(row["学号"] || row["id"] || row["学生学号"] || "").trim();
            const studentName = String(row["姓名"] || row["name"] || row["学生姓名"] || "").trim();
            let classNoRaw = String(row["班级"] || row["class"] || row["classNo"] || "").trim();
            const classNo = displayClassNo(classNoRaw) || classNoRaw;

            if (!studentName || !classNo) continue;
            if (!classGroups[classNo]) classGroups[classNo] = [];
            classGroups[classNo].push({
              studentId: studentId || `${classNo}-${classGroups[classNo].length + 1}`,
              studentName,
              classNo,
              _sourceFile: file.name // 记录来源文件
            });
          }
          resolve({ fileName: file.name, classGroups, totalRows: rows.length });
        } catch (err) {
          resolve({ fileName: file.name, classGroups: {}, totalRows: 0, error: err.message });
        }
      };
      reader.onerror = () => resolve({ fileName: file.name, classGroups: {}, totalRows: 0, error: "读取文件失败" });
      reader.readAsArrayBuffer(file);
    });
  };

  // 并行处理所有文件
  Promise.all(files.map(parseFile)).then((results) => {
    // 合并所有文件的数据
    const allClassGroups = {};
    let totalSkipped = 0;
    let totalValidRows = 0;

    results.forEach(({ fileName, classGroups, totalRows, error }) => {
      if (error) {
        showToast(`文件 "${fileName}" 解析失败：${error}`, "error");
        return;
      }
      const validRows = Object.values(classGroups).reduce((sum, arr) => sum + arr.length, 0);
      totalSkipped += totalRows - validRows;
      totalValidRows += validRows;

      Object.keys(classGroups).forEach((c) => {
        if (!allClassGroups[c]) allClassGroups[c] = [];
        allClassGroups[c].push(...classGroups[c]);
      });
    });

    if (totalValidRows === 0) {
      showToast("未解析到任何有效数据，请检查文件格式", "warning");
      return;
    }

    const classList = Object.keys(allClassGroups).sort();

    let html = `<div class="card">
      <div class="card-title">📋 上传预览与编辑（共 ${totalValidRows} 人，${classList.length} 个班级${totalSkipped > 0 ? "，跳过 " + totalSkipped + " 行无效数据" : ""}）</div>
      <div style="margin-bottom:12px;padding:12px;background:var(--bg-light);border-radius:6px">
        <b>💡 操作提示：</b>已选择 <b>${files.length}</b> 个文件。您可以直接编辑表格中的学号和姓名，或添加/删除学生。确认无误后选择保存模式进行保存。
      </div>
      <div id="roster_edit_accordion">`;

    classList.forEach((c, classIdx) => {
      const newStudents = allClassGroups[c];
      const existingStudents = DB.studentRoster[grade]?.[c] || [];
      const isUpdate = existingStudents.length > 0;

      html += `<div class="accordion-item" style="margin-bottom:10px;border:1px solid var(--border-color);border-radius:8px">
        <div class="accordion-header" onclick="toggleAccordion(${classIdx})" style="padding:12px;cursor:pointer;background:var(--bg-light);border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center">
          <div>
            <span class="badge ${isUpdate ? 'badge-info' : 'badge-success'}">${isUpdate ? '更新' : '新增'}</span>
            <b style="margin-left:8px">${esc(c)}</b>
            <span style="color:var(--text-light);font-size:12px;margin-left:8px">${isUpdate ? `原有 ${existingStudents.length} 人，本次新增/更新 ${newStudents.length} 人` : `${newStudents.length} 名学生`}</span>
          </div>
          <span id="acc_arrow_${classIdx}" style="font-size:12px">▼</span>
        </div>
        <div id="acc_content_${classIdx}" class="accordion-content" style="padding:12px;display:${classIdx === 0 ? 'block' : 'none'}">
          <div style="margin-bottom:8px">
            <button class="btn btn-sm btn-primary" onclick="addPendingStudent('${esc(c)}')">➕ 添加学生</button>
          </div>
          <div class="table-wrap"><table class="data-table">
            <thead><tr><th style="width:40%">学号</th><th style="width:45%">姓名</th><th style="width:15%">操作</th></tr></thead>
            <tbody id="roster_pending_tbody_${esc(c)}">
              ${newStudents.map((s, i) => `
                <tr>
                  <td><input type="text" class="form-control" value="${esc(s.studentId)}" data-class="${esc(c)}" data-index="${i}" data-field="studentId" oninput="updatePendingStudent(this)" /></td>
                  <td><input type="text" class="form-control" value="${esc(s.studentName)}" data-class="${esc(c)}" data-index="${i}" data-field="studentName" oninput="updatePendingStudent(this)" /></td>
                  <td><button class="btn btn-sm btn-danger" onclick="deletePendingStudent('${esc(c)}', ${i})">🗑️ 删除</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table></div>
        </div>
      </div>`;
    });

    html += `</div>
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border-color);display:flex;gap:10px;justify-content:flex-end;align-items:center">
        <div style="margin-right:auto">
          <label style="margin-right:8px"><input type="radio" name="roster_save_mode" value="merge" checked /> 合并模式（保留原有学生，新增学号）</label>
          <label><input type="radio" name="roster_save_mode" value="replace" /> 替换模式（覆盖所有班级的现有名单）</label>
        </div>
        <button class="btn btn-secondary" onclick="renderStudentRoster()">取消</button>
        <button class="btn btn-success" onclick="confirmRosterUpload()">✓ 确认保存</button>
      </div>
    </div>`;

    $("sr_preview").innerHTML = html;
    window._pendingRosterData = allClassGroups;
    showToast(`成功解析 ${totalValidRows} 名学生数据（${files.length} 个文件）`, "success");
  });
}

function toggleAccordion(idx) {
  const content = $(`acc_content_${idx}`);
  const arrow = $(`acc_arrow_${idx}`);
  if (content) {
    content.style.display = content.style.display === "none" ? "block" : "none";
    if (arrow) arrow.innerHTML = content.style.display === "none" ? "▶" : "▼";
  }
}

function updatePendingStudent(input) {
  const classNo = input.dataset.class;
  const index = parseInt(input.dataset.index);
  const field = input.dataset.field;
  const value = input.value.trim();
  if (window._pendingRosterData && window._pendingRosterData[classNo] && window._pendingRosterData[classNo][index]) {
    window._pendingRosterData[classNo][index][field] = value || `${classNo}-${index + 1}`;
  }
}

function deletePendingStudent(classNo, index) {
  if (window._pendingRosterData && window._pendingRosterData[classNo]) {
    window._pendingRosterData[classNo].splice(index, 1);
    const tbody = $(`roster_pending_tbody_${classNo}`);
    if (tbody) {
      tbody.innerHTML = window._pendingRosterData[classNo].map((s, i) => `
        <tr>
          <td><input type="text" class="form-control" value="${esc(s.studentId)}" data-class="${esc(classNo)}" data-index="${i}" data-field="studentId" oninput="updatePendingStudent(this)" /></td>
          <td><input type="text" class="form-control" value="${esc(s.studentName)}" data-class="${esc(classNo)}" data-index="${i}" data-field="studentName" oninput="updatePendingStudent(this)" /></td>
          <td><button class="btn btn-sm btn-danger" onclick="deletePendingStudent('${esc(classNo)}', ${i})">🗑️ 删除</button></td>
        </tr>
      `).join("");
    }
    showToast("已删除", "success");
  }
}

function addPendingStudent(classNo) {
  if (!window._pendingRosterData) return;
  if (!window._pendingRosterData[classNo]) window._pendingRosterData[classNo] = [];
  const students = window._pendingRosterData[classNo];
  students.push({
    studentId: `${classNo}-${students.length + 1}`,
    studentName: "",
    classNo
  });
  const tbody = $(`roster_pending_tbody_${classNo}`);
  if (tbody) {
    tbody.innerHTML = students.map((s, i) => `
      <tr>
        <td><input type="text" class="form-control" value="${esc(s.studentId)}" data-class="${esc(classNo)}" data-index="${i}" data-field="studentId" oninput="updatePendingStudent(this)" /></td>
        <td><input type="text" class="form-control" value="${esc(s.studentName)}" data-class="${esc(classNo)}" data-index="${i}" data-field="studentName" oninput="updatePendingStudent(this)" /></td>
        <td><button class="btn btn-sm btn-danger" onclick="deletePendingStudent('${esc(classNo)}', ${i})">🗑️ 删除</button></td>
      </tr>
    `).join("");
  }
  showToast("已添加", "success");
}

// 合并学生名单：保留原有用学号匹配，新增的学号添加
function mergeRosterStudents(existing, newStudents) {
  const merged = [...existing];
  const existingIds = new Set(existing.map((s) => s.studentId));

  newStudents.forEach((s) => {
    if (!existingIds.has(s.studentId)) {
      merged.push(s);
    }
  });

  return merged;
}

function confirmRosterUpload() {
  const grade = currentUser.grade;
  const classGroups = window._pendingRosterData || {};

  // 获取用户选择的保存模式
  let saveMode = "merge";
  const modeInputs = document.querySelectorAll('input[name="roster_save_mode"]');
  modeInputs.forEach((input) => {
    if (input.checked) saveMode = input.value;
  });

  // 验证数据
  let totalStudents = 0;
  const validClasses = [];
  Object.keys(classGroups).forEach((c) => {
    const students = classGroups[c].filter((s) => s.studentName && s.studentName.trim());
    if (students.length > 0) {
      validClasses.push({ classNo: c, students });
      totalStudents += students.length;
    }
  });

  if (totalStudents === 0) {
    showToast("请至少填写一名学生的姓名", "warning");
    return;
  }

  const modeText = saveMode === "replace" ? "替换模式" : "合并模式";

  showModal("确认保存", `
    <p>即将以 <b style="color:${saveMode === 'replace' ? '#dc3545' : '#28a745'}">${modeText}</b> 保存 <b>${totalStudents}</b> 名学生（涉及 ${validClasses.length} 个班级）：</p>
    <div style="margin:12px 0;padding:10px;background:var(--bg-light);border-radius:6px">
      ${validClasses.map(({ classNo, students }) => `<div style="padding:4px 0"><b>${esc(classNo)}</b>：${students.length} 名学生</div>`).join("")}
    </div>
    ${saveMode === "replace" ? `<p style="color:#dc3545;font-size:12px">⚠️ 替换模式将覆盖这些班级的所有现有学生名单！</p>` : `<p style="color:var(--text-light);font-size:12px">💡 合并模式将保留原有学生，仅新增新学号的学生。</p>`}
  `, "✓ 确认保存", () => {
    validClasses.forEach(({ classNo, students }) => {
      const existingStudents = DB.studentRoster[grade]?.[classNo] || [];

      if (saveMode === "replace") {
        // 替换模式：直接覆盖
        DB.studentRoster[grade][classNo] = students;
      } else if (existingStudents.length > 0) {
        // 合并模式：保留原有，新增学号
        DB.studentRoster[grade][classNo] = mergeRosterStudents(existingStudents, students);
      } else {
        DB.studentRoster[grade][classNo] = students;
      }
    });

    saveDB(DB);
    window._pendingRosterData = null;
    showToast(`成功保存 ${totalStudents} 名学生（${modeText}）`, "success");
    renderStudentRoster();
  }, "取消");
}

function viewRosterClass(classNo) {
  const grade = currentUser.grade;
  const students = DB.studentRoster[grade]?.[classNo] || [];

  $("sr_preview").innerHTML = `
    <div class="card">
      <div class="card-title">👥 ${esc(classNo)} 学生名单（${students.length}人）
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-sm btn-info" onclick="downloadRosterClass('${esc(classNo)}')">⬇ 下载名单</button>
          <button class="btn btn-sm btn-warning" onclick="editRosterClass('${esc(classNo)}')">✏️ 编辑</button>
          <button class="btn btn-sm btn-primary" onclick="extractRosterToExam('${esc(classNo)}')">📥 提取到考试</button>
        </div>
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th style="width:10%">序号</th><th style="width:30%">学号</th><th style="width:40%">姓名</th><th style="width:20%">班级</th></tr></thead>
        <tbody>
          ${students.length === 0 ? `<tr><td colspan="4"><div class="empty-state"><div class="es-tip">暂无数据，请上传名单或编辑添加学生</div></div></td></tr>` : students.map((s, i) => `<tr>
            <td>${i + 1}</td><td>${esc(s.studentId)}</td><td><b>${esc(s.studentName)}</b></td><td>${esc(s.classNo)}</td>
          </tr>`).join("")}
        </tbody>
      </table></div>
    </div>
  `;
}

function downloadRosterClass(classNo) {
  const grade = currentUser.grade;
  const students = DB.studentRoster[grade]?.[classNo] || [];
  if (students.length === 0) {
    showToast("该班级暂无学生数据", "warning");
    return;
  }
  const rows = [["学号", "姓名", "班级"]];
  students.forEach((s) => rows.push([s.studentId || "", s.studentName || "", classNo]));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), classNo);
  XLSX.writeFile(wb, `${grade}_${classNo}_学生名单.xlsx`);
  showToast("已下载名单", "success");
}

function editRosterClass(classNo) {
  const grade = currentUser.grade;
  const students = DB.studentRoster[grade]?.[classNo] || [];

  $("sr_preview").innerHTML = `
    <div class="card">
      <div class="card-title">✏️ 编辑 ${esc(classNo)} 学生名单（共 ${students.length} 人）</div>
      <div style="margin-bottom:12px;padding:10px;background:var(--bg-light);border-radius:6px">
        <b>💡 操作提示：</b>直接修改学号和姓名，点击右侧按钮删除学生，或点击下方按钮添加新学生。
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th style="width:35%">学号</th><th style="width:40%">姓名</th><th style="width:25%">操作</th></tr></thead>
        <tbody id="roster_edit_tbody">
          ${students.map((s, i) => `<tr>
            <td><input type="text" class="form-control" value="${esc(s.studentId)}" placeholder="学号" /></td>
            <td><input type="text" class="form-control" value="${esc(s.studentName)}" placeholder="姓名" /></td>
            <td><button class="btn btn-sm btn-danger" onclick="deleteRosterStudentInline(this)">🗑️ 删除</button></td>
          </tr>`).join("")}
        </tbody>
      </table></div>
      <div style="margin-top:16px;display:flex;gap:10px">
        <button class="btn btn-secondary" onclick="addRosterStudentInline()">➕ 添加学生</button>
        <button class="btn btn-success" onclick="saveRosterEdit('${esc(classNo)}')">✓ 保存修改</button>
        <button class="btn btn-secondary" onclick="viewRosterClass('${esc(classNo)}')">取消</button>
      </div>
    </div>
  `;
}

function addRosterStudentInline() {
  const tbody = $("roster_edit_tbody");
  const tr = document.createElement("tr");
  tr.innerHTML = `<td><input type="text" class="form-control" value="" placeholder="学号" /></td>
    <td><input type="text" class="form-control" value="" placeholder="姓名" /></td>
    <td><button class="btn btn-sm btn-danger" onclick="deleteRosterStudentInline(this)">🗑️ 删除</button></td>`;
  tbody.appendChild(tr);
  showToast("已添加一行", "success");
}

function deleteRosterStudentInline(btn) {
  const row = btn.closest("tr");
  if (row) row.remove();
  showToast("已删除", "success");
}

function saveRosterEdit(classNo) {
  const grade = currentUser.grade;
  const tbody = $("roster_edit_tbody");
  const rows = tbody.querySelectorAll("tr");
  const newStudents = [];

  rows.forEach((row) => {
    const inputs = row.querySelectorAll("input");
    if (inputs.length < 2) return;
    const studentId = inputs[0].value.trim();
    const studentName = inputs[1].value.trim();
    if (studentName) {
      newStudents.push({
        studentId: studentId || `auto-${newStudents.length + 1}`,
        studentName,
        classNo
      });
    }
  });

  if (newStudents.length === 0) {
    showToast("名单不能为空，请至少添加一名学生", "warning");
    return;
  }

  DB.studentRoster[grade][classNo] = newStudents;
  saveDB(DB);
  showToast(`已保存 ${newStudents.length} 名学生`, "success");
  viewRosterClass(classNo);
}

function extractRosterToExam(classNo) {
  const grade = currentUser.grade;
  const exams = DB.exams.filter((e) => e.grade === grade);
  if (exams.length === 0) {
    showToast("请先创建考试", "warning");
    return;
  }

  showModal("提取名单到考试", `
    <p>选择要将 <b>${classNo}</b> 的学生名单提取到哪个考试：</p>
    <select id="extract_exam" class="form-control" style="margin-top:12px">
      ${exams.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("")}
    </select>
  `, "确认提取", () => {
    const examId = $("extract_exam").value;
    const students = DB.studentRoster[grade]?.[classNo] || [];
    const subjects = DB.subjects[grade] || [];
    const subjectNames = subjects.map((s) => s.name);

    // 获取该班级已有的学号映射
    const existingKeyToId = {};
    DB.records.filter((r) => r.grade === grade && r.classNo === classNo).forEach((r) => {
      existingKeyToId[r.studentName] = r.studentId;
    });

    // 检查该考试是否已有该班级的学生
    const existingIds = new Set(DB.records.filter((r) => r.examId === examId && r.classNo === classNo).map((r) => r.studentId));

    let added = 0;
    students.forEach((s) => {
      const studentId = existingIds.has(s.studentId) ? s.studentId : (existingKeyToId[s.studentName] || s.studentId);
      if (!existingIds.has(studentId)) {
        DB.records.push({
          id: uid(),
          examId,
          grade,
          classNo,
          studentId,
          studentName: s.studentName,
          scores: {},
          total: 0,
          uploadedBy: currentUser.id,
          uploadedAt: Date.now(),
          status: "pending",
          confirmedAt: null,
          confirmedBy: null
        });
        added++;
      }
    });

    saveDB(DB);
    showToast(`已提取 ${added} 名学生到「${exams.find((e) => e.id === examId)?.name}」`, "success");
  });
}

function deleteRosterClass(classNo) {
  showModal("确认删除", `<p>确定要删除 <b>${classNo}</b> 的学生名单吗？</p>`, "删除", () => {
    const grade = currentUser.grade;
    if (DB.studentRoster[grade]?.[classNo]) {
      delete DB.studentRoster[grade][classNo];
      saveDB(DB);
      showToast("已删除", "success");
      renderStudentRoster();
    }
  }, "取消");
}

// ========== 教务端：成绩审核 ==========
function renderScoreReview() {
  if (currentUser.role !== "academic") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const exams = DB.exams.filter((e) => e.grade === grade).sort((a, b) => b.createdAt - a.createdAt);

  // 各考试统计
  const examSummary = exams.map((e) => {
    const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade);
    const total = recs.length;
    const confirmed = recs.filter((r) => r.status === "confirmed").length;
    const pending = total - confirmed;
    const byClass = {};
    recs.forEach((r) => {
      if (!byClass[r.classNo]) byClass[r.classNo] = { total: 0, confirmed: 0 };
      byClass[r.classNo].total++;
      if (r.status === "confirmed") byClass[r.classNo].confirmed++;
    });
    return {
      id: e.id, name: e.name, total, confirmed, pending,
      allConfirmed: total > 0 && total === confirmed,
      classes: Object.keys(byClass).sort(), byClass
    };
  });

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">✅ ${grade} 成绩审核与总览（复审：一键确认）</div>
      <p style="color:var(--text-light);margin-bottom:16px">对班主任上传的成绩进行审核、修改、删除操作。支持<b>批量确认</b>和<b>一键退回</b>。</p>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-title">📊 数据总览（按考试 × 班级）</div>
      <div class="table-wrap" style="margin-top:12px"><table class="data-table">
        <thead><tr><th>考试</th><th>班级</th><th>总数</th><th>待审核</th><th>已确认</th><th>状态</th><th>批量操作</th></tr></thead>
        <tbody>${examSummary.length === 0 ? `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-light)">暂无考试数据</td></tr>` :
          examSummary.map((s) => {
            const classes = s.classes;
            if (classes.length === 0) {
              return `<tr>
                <td><b>${esc(s.name)}</b></td>
                <td>-</td><td>0</td><td>0</td><td>0</td>
                <td><span class="tag tag-default">未上传</span></td>
                <td>-</td>
              </tr>`;
            }
            let rows = "";
            classes.forEach((c, idx) => {
              const info = s.byClass[c];
              const pending = info.total - info.confirmed;
              let statusTag;
              if (pending === 0 && info.total > 0) statusTag = `<span class="tag tag-success">✓ 已确认</span>`;
              else if (pending > 0) statusTag = `<span class="tag tag-warning">⏳ 待审核</span>`;
              else statusTag = `<span class="tag tag-default">未上传</span>`;

              rows += `<tr class="${pending > 0 ? "row-pending" : ""}">
                ${idx === 0 ? `<td rowspan="${classes.length}" style="vertical-align:middle"><b>${esc(s.name)}</b></td>` : ""}
                <td>${esc(c)}</td>
                <td>${info.total}</td>
                <td style="color:${pending > 0 ? "#d35400" : "#ccc"}">${pending}</td>
                <td style="color:#1a7f37">${info.confirmed}</td>
                <td>${statusTag}</td>
                <td>
                  <button class="btn btn-sm btn-success" onclick="confirmClassScores('${s.id}','${esc(c)}')" ${pending === 0 ? "disabled" : ""}>✓ 批量确认</button>
                  <button class="btn btn-sm btn-danger" onclick="rejectClassScores('${s.id}','${esc(c)}')" ${info.total === 0 ? "disabled" : ""}>🗑️ 退回</button>
                </td>
              </tr>`;
            });
            // 合计行
            rows += `<tr style="background:rgba(52,152,219,0.08);font-weight:bold">
              <td colspan="2" style="text-align:right">🎯 ${esc(s.name)} 合计：</td>
              <td>${s.total}</td>
              <td style="color:#d35400">${s.pending}</td>
              <td style="color:#1a7f37">${s.confirmed}</td>
              <td>${s.total === 0 ? `<span class="tag tag-default">未上传</span>` : s.pending === 0 ? `<span class="tag tag-success">✓ 全部完成</span>` : `<span class="tag tag-warning">⏳ 待处理</span>`}</td>
              <td>
                <button class="btn btn-sm btn-success" onclick="batchConfirmExam('${s.id}')" ${s.pending === 0 ? "disabled" : ""}>✅ 一键确认本考试</button>
                <button class="btn btn-sm btn-danger" onclick="rejectExamScores('${s.id}')" ${s.total === 0 ? "disabled" : ""}>🗑️ 退回本考试</button>
              </td>
            </tr>`;
            return rows;
          }).join("")}
        </tbody>
      </table></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-title">🔍 按班级详细审核</div>
      <div class="form-row" style="margin-top:12px">
        <div class="form-group"><label>选择考试</label>
          <select id="rv_exam">${exams.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("")}</select>
        </div>
        <div class="form-group"><label>筛选状态</label>
          <select id="rv_status">
            <option value="pending">只看【待审核】</option>
            <option value="confirmed">只看【已确认】</option>
            <option value="all">全部</option>
          </select>
        </div>
      </div>
      <div id="rv_result" style="margin-top:16px"></div>
    </div>
  `;

  $("rv_exam").onchange = () => refreshScoreReview();
  $("rv_status").onchange = () => refreshScoreReview();
  refreshScoreReview();
}

// 一键全确认某考试
window.batchConfirmExam = function (examId) {
  const exam = DB.exams.find((e) => e.id === examId);
  if (!exam) return;
  const grade = currentUser.grade;
  const target = DB.records.filter((r) => r.examId === examId && r.grade === grade && r.status === "pending");
  if (target.length === 0) { showToast("没有待审核的记录", "info"); return; }

  showModal("一键全确认", `<div>
    <p>将把 <b>${esc(exam.name)}</b> 中所有 <b style="color:#d35400">${target.length}</b> 条待审核的成绩转为<b style="color:#1a7f37">已确认</b>。</p>
    <p style="color:#1a7f37;margin-top:8px">✅ 确认后，班主任和任课教师将能看到这些数据。</p>
  </div>`, "✓ 全部确认", () => {
    const now = Date.now();
    target.forEach((r) => { r.status = "confirmed"; r.confirmedAt = now; r.confirmedBy = currentUser.id; });
    saveDB(DB);
    showToast(`已确认 ${target.length} 条成绩`, "success");
    renderScoreReview();
  });
};

// 一键退回某考试（删除所有本考试的成绩记录）
window.rejectExamScores = function (examId) {
  const exam = DB.exams.find((e) => e.id === examId);
  if (!exam) return;
  const grade = currentUser.grade;
  const target = DB.records.filter((r) => r.examId === examId && r.grade === grade);
  if (target.length === 0) { showToast("没有可退回的记录", "info"); return; }

  showModal("⚠️ 确认退回", `<div>
    <p>将<b style="color:#c0392b">删除</b> <b>${esc(exam.name)}</b> 中 <b>${target.length}</b> 条成绩记录。</p>
    <p style="color:#c0392b;margin-top:8px">⚠️ 删除后不可恢复，班主任需要重新上传。请谨慎操作。</p>
  </div>`, "🗑️ 确认退回全部", () => {
    DB.records = DB.records.filter((r) => !(r.examId === examId && r.grade === grade));
    saveDB(DB);
    showToast(`已退回 ${target.length} 条记录，请通知相关班主任重新上传`, "success");
    renderScoreReview();
  });
};

function refreshScoreReview() {
  const grade = currentUser.grade;
  const examId = $("rv_exam").value;
  const statusFilter = $("rv_status").value;

  let records = DB.records.filter((r) => r.examId === examId && r.grade === grade);
  if (statusFilter !== "all") {
    records = records.filter((r) => r.status === statusFilter);
  }

  if (records.length === 0) {
    const label = statusFilter === "pending" ? "待审核的" : statusFilter === "confirmed" ? "已确认的" : "";
    $("rv_result").innerHTML = `<div class="empty-state"><div class="es-icon">📭</div><div class="es-title">暂无${label}成绩数据</div></div>`;
    return;
  }

  // 按班级分组
  const classGroups = {};
  records.forEach((r) => {
    if (!classGroups[r.classNo]) classGroups[r.classNo] = [];
    classGroups[r.classNo].push(r);
  });

  const classes = Object.keys(classGroups).sort();
  const subjects = DB.subjects[grade] || [];
  const showStudentId = hasRoster(grade);

  let html = `<div class="card" style="background:rgba(52,152,219,0.06);border:1px solid rgba(52,152,219,0.2);padding:14px;margin-bottom:10px">
    <span style="font-size:13px;color:#2c3e50">
      💡 <b>提示：</b>勾选多个学生后点击「批量确认」按钮；或直接点击每个班级的「✓ 批量确认本班级」一键全通过。
      <button class="btn btn-sm btn-success" onclick="confirmAllSelectedReview('${examId}')" style="margin-left:12px">✅ 批量确认所有已勾选</button>
    </span>
  </div>`;
  classes.forEach((c) => {
    const recs = classGroups[c];
    const pendingCount = recs.filter((r) => r.status === "pending").length;

    html += `<div class="cmp-section-title">🏫 ${esc(c)}（${recs.length}人${pendingCount > 0 ? `，待审 ${pendingCount} 人` : ""}）
      <button class="btn btn-sm btn-success" onclick="confirmClassScores('${examId}','${esc(c)}')" ${pendingCount === 0 ? "disabled" : ""}>✓ 批量确认本班级</button>
      <button class="btn btn-sm btn-warning" onclick="confirmSelectedByClass('${examId}','${esc(c)}')" style="margin-left:6px">🎯 确认勾选</button>
      <button class="btn btn-sm btn-danger" onclick="rejectClassScores('${examId}','${esc(c)}')" style="margin-left:6px">🗑️ 一键退回本班级</button>
    </div>
    <div class="cmp-table-wrap"><table class="cmp-table">
      <thead><tr><th><input type="checkbox" onchange="toggleAllReview(this,'${esc(c)}')" /></th>${showStudentId ? "<th>学号</th>" : ""}<th>姓名</th>${subjects.map((s) => `<th>${esc(s.name)}</th>`).join("")}<th>总分</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>`;

    recs.forEach((r) => {
      const isPending = r.status === "pending";
      const rosterId = showStudentId ? getStudentIdFromRoster(grade, c, r.studentName) : "";
      html += `<tr class="${isPending ? "row-pending" : ""}">
        <td><input type="checkbox" class="review-cb" data-recordid="${r.id}" data-class="${esc(c)}" ${isPending ? "" : "disabled"} /></td>
        ${showStudentId ? `<td>${esc(rosterId)}</td>` : ""}
        <td><b>${esc(r.studentName)}</b></td>
        ${subjects.map((s) => `<td>
          <input type="number" class="score-input" value="${r.scores[s.name] ?? ""}"
            data-studentid="${esc(r.studentId)}" data-subject="${esc(s.name)}"
            style="width:60px" onchange="window.updateScoreInline('${r.id}','${esc(s.name)}',this)" />
        </td>`).join("")}
        <td class="total-cell"><b>${r.total}</b></td>
        <td><span class="tag tag-${isPending ? "warning" : "success"}">${isPending ? "⏳待审" : "✓已确认"}</span></td>
        <td>
          <button class="btn btn-sm btn-success" onclick="confirmOneScore('${r.id}')" ${!isPending ? "disabled" : ""}>✓确认</button>
          <button class="btn btn-sm btn-primary" onclick="editReviewScore('${r.id}')">✏️编辑</button>
          <button class="btn btn-sm btn-danger" onclick="deleteReviewScore('${r.id}')">🗑️删除</button>
        </td>
      </tr>`;
    });

    html += `</tbody></table></div>`;
  });

  $("rv_result").innerHTML = html;
}

// 行内修改后保存分数
window.updateScoreInline = function (recordId, subjectName, inputEl) {
  const record = DB.records.find((r) => r.id === recordId);
  if (!record) return;
  const val = parseFloat(inputEl.value);
  if (!isNaN(val) && val >= 0) {
    record.scores[subjectName] = val;
    // 重新计算总分
    let total = 0;
    Object.values(record.scores).forEach((v) => { if (typeof v === "number" && !isNaN(v)) total += v; });
    record.total = total;
    saveDB(DB);
    // 找到对应总分单元更新显示（通过 class 精确查找，避免列数变化导致位置错误）
    const row = inputEl.closest("tr");
    if (row) {
      const totalCell = row.querySelector(".total-cell");
      if (totalCell) totalCell.innerHTML = `<b>${total}</b>`;
    }
    showToast("已更新", "success");
  } else if (inputEl.value === "") {
    delete record.scores[subjectName];
    let total = 0;
    Object.values(record.scores).forEach((v) => { if (typeof v === "number" && !isNaN(v)) total += v; });
    record.total = total;
    saveDB(DB);
    const row = inputEl.closest("tr");
    if (row) {
      const totalCell = row.querySelector(".total-cell");
      if (totalCell) totalCell.innerHTML = `<b>${total}</b>`;
    }
  } else {
    showToast("分数无效", "warning");
  }
};

// 确认单个学生成绩
window.confirmOneScore = function (recordId) {
  const record = DB.records.find((r) => r.id === recordId);
  if (!record || record.status !== "pending") return;
  record.status = "confirmed";
  record.confirmedAt = Date.now();
  record.confirmedBy = currentUser.id;
  saveDB(DB);
  showToast("已确认", "success");
  refreshScoreReview();
};

// 一键退回某个班级的所有成绩
window.rejectClassScores = function (examId, classNo) {
  const exam = DB.exams.find((e) => e.id === examId);
  const grade = currentUser.grade;
  const target = DB.records.filter((r) => r.examId === examId && r.grade === grade && r.classNo === classNo);
  if (target.length === 0) { showToast("没有可退回的记录", "info"); return; }

  showModal("确认退回班级", `<div>
    <p>将<b style="color:#c0392b">删除</b> <b>${esc(exam.name)}</b> 中 <b>${esc(classNo)}</b> 的 <b>${target.length}</b> 条成绩记录。</p>
    <p style="color:#c0392b;margin-top:8px">⚠️ 该班级班主任需要重新上传。</p>
  </div>`, "🗑️ 确认退回", () => {
    DB.records = DB.records.filter((r) => !(r.examId === examId && r.grade === grade && r.classNo === classNo));
    saveDB(DB);
    showToast(`已退回 ${target.length} 条记录`, "success");
    renderScoreReview();
  });
};

window.toggleAllReview = function (checkbox, classNo) {
  const checkboxes = document.querySelectorAll(`.review-cb[data-class="${classNo}"]`);
  checkboxes.forEach((cb) => { if (!cb.disabled) cb.checked = checkbox.checked; });
};

// 批量确认一个班级的全部待审核记录（不依赖checkbox，直接批量）
window.confirmClassScores = function (examId, classNo) {
  const grade = currentUser.grade;
  const targets = DB.records.filter((r) =>
    r.examId === examId && r.grade === grade && r.classNo === classNo && r.status === "pending");
  if (targets.length === 0) { showToast("没有待审核的成绩", "info"); return; }

  showModal("确认批量通过", `<div>
    <p>您确认将 <b>${esc(classNo)}</b> 班级的 <b style="color:#d35400">${targets.length}</b> 条成绩<b style="color:#1a7f37">批量确认为已审核</b>吗？</p>
    <p style="color:var(--text-light);margin-top:8px">确认后，相关班主任与任课教师将能查看到这些数据。</p>
  </div>`, "✅ 确认批量通过", () => {
    const now = Date.now();
    targets.forEach((r) => { r.status = "confirmed"; r.confirmedAt = now; r.confirmedBy = currentUser.id; });
    saveDB(DB);
    showToast(`已确认 ${targets.length} 条成绩`, "success");
    renderScoreReview();
  });
};

// 按checkbox勾选批量确认所选学生（在详细表格区使用）
window.confirmSelectedByClass = function (examId, classNo) {
  const grade = currentUser.grade;
  const cbs = document.querySelectorAll(`.review-cb[data-class="${classNo}"]:checked`);
  if (cbs.length === 0) { showToast("请先勾选学生", "warning"); return; }
  const ids = Array.from(cbs).map((cb) => cb.dataset.recordid);
  const now = Date.now();
  let cnt = 0;
  ids.forEach((id) => {
    const r = DB.records.find((x) => x.id === id);
    if (r && r.status === "pending") { r.status = "confirmed"; r.confirmedAt = now; r.confirmedBy = currentUser.id; cnt++; }
  });
  saveDB(DB);
  showToast(`已确认 ${cnt} 条成绩`, "success");
  refreshScoreReview();
};

// 全局批量确认所有勾选的学生（跨班级）
window.confirmAllSelectedReview = function (examId) {
  const cbs = document.querySelectorAll(".review-cb:checked");
  if (cbs.length === 0) { showToast("请先勾选学生", "warning"); return; }
  const ids = Array.from(cbs).map((cb) => cb.dataset.recordid);
  showModal("确认批量通过", `<p>您确认将已勾选的 <b style="color:#1a7f37">${ids.length}</b> 条成绩确认为已审核吗？</p>`, "✅ 全部确认", () => {
    const now = Date.now();
    let cnt = 0;
    ids.forEach((id) => {
      const r = DB.records.find((x) => x.id === id);
      if (r && r.status === "pending") { r.status = "confirmed"; r.confirmedAt = now; r.confirmedBy = currentUser.id; cnt++; }
    });
    saveDB(DB);
    showToast(`已确认 ${cnt} 条成绩`, "success");
    refreshScoreReview();
  });
};

window.editReviewScore = function (recordId) {
  const record = DB.records.find((r) => r.id === recordId);
  if (!record) return;

  const grade = currentUser.grade;
  const subjects = DB.subjects[grade] || [];

  showModal("修改成绩", `
    <p>学号：${esc(record.studentId)}</p>
    <p>姓名：${esc(record.studentName)}</p>
    <div style="margin-top:12px">
      ${subjects.map((s) => `<div class="form-group">
        <label>${esc(s.name)}（满分 ${s.fullScore}）</label>
        <input type="number" id="edit_score_${esc(s.name)}" class="form-control" value="${record.scores[s.name] ?? ""}" min="0" max="${s.fullScore}" />
      </div>`).join("")}
    </div>
  `, "保存", () => {
    let total = 0;
    subjects.forEach((s) => {
      const val = parseFloat($(`edit_score_${esc(s.name)}`).value);
      if (!isNaN(val) && val >= 0) {
        record.scores[s.name] = val;
        total += val;
      }
    });
    record.total = total;
    saveDB(DB);
    showToast("成绩已修改", "success");
    refreshScoreReview();
  });
};

window.deleteReviewScore = function (recordId) {
  showModal("确认删除", "<p>确定要删除该学生的成绩记录吗？</p>", "删除", () => {
    DB.records = DB.records.filter((r) => r.id !== recordId);
    saveDB(DB);
    showToast("已删除", "success");
    refreshScoreReview();
  });
};

// 添加审核样式
const reviewStyle = document.createElement("style");
reviewStyle.textContent = `
  .row-pending td { background: #fffbf0; }
  .row-pending:hover td { background: #fff5e0; }
  .score-input { padding: 4px 8px; border: 1px solid #e5e7eb; border-radius: 4px; text-align: center; }
  .score-input:focus { border-color: var(--primary); outline: none; }
  .roster-preview { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-top: 12px; }
  .roster-class-item { background: #f8f9fc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; }
  .roster-class-item.update { border-color: #b8daff; background: #f0f7ff; }
  .roster-class-item.new { border-color: #c3e6cb; background: #f0fff0; }
  .roster-class-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .badge { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
  .badge-success { background: #d4edda; color: #155724; }
  .badge-info { background: #b8daff; color: #004085; }
  .roster-student-list { display: flex; flex-wrap: wrap; gap: 4px; }
  .student-chip { background: #fff; border: 1px solid #e5e7eb; padding: 2px 8px; border-radius: 12px; font-size: 12px; }
  .student-chip.more { background: #e5e7eb; color: #666; }
`;
document.head.appendChild(reviewStyle);

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

