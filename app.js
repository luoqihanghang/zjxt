// ========== 网络智慧教务平台 - 主应用 ==========
// 所有数据存储在 localStorage 中，便于本地演示和持久化
// 版本: 20260712 - 简化同步UI（自动拉取/退出整体上传+进度表）+ 导航栏自动隐藏 + 无障碍修复 + 网络优化
console.log("[智慧教务平台] v20260712 已加载");

// ========== 工具函数 ==========
const $ = (id) => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
const fmt = (n, d = 2) => (isFinite(n) ? Number(n).toFixed(d) : "-");
const fmtPct = (n) => (isFinite(n) ? (n * 100).toFixed(2) + "%" : "-");

// HTML 转义，防止特殊字符破坏页面结构
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// 生成分页HTML
function buildPagination(totalPages, currentPage, onchange, pageInfo = "") {
  if (totalPages <= 1) return pageInfo ? `<div class="page-info">${pageInfo}</div>` : "";
  let pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== "...") {
      pages.push("...");
    }
  }
  return `
    <div class="card-footer-pagination">
      <div class="page-info">${pageInfo}</div>
      <div class="pagination">
        <button class="page-btn" ${currentPage === 1 ? "disabled" : ""} onclick="${onchange}(${currentPage - 1})">‹ 上一页</button>
        ${pages.map((p) => p === "..."
          ? `<span class="page-ellipsis">...</span>`
          : `<button class="page-btn ${p === currentPage ? "active" : ""}" onclick="${onchange}(${p})">${p}</button>`
        ).join("")}
        <button class="page-btn" ${currentPage === totalPages ? "disabled" : ""} onclick="${onchange}(${currentPage + 1})">下一页 ›</button>
      </div>
    </div>
  `;
}

// 根据用户角色过滤记录，并排除草稿/无效状态记录
const getVisibleRecords = (records) => {
  // 先过滤掉草稿/无效记录（所有角色都适用）
  const validRecords = records.filter((r) => !r.status || r.status === "confirmed" || r.status === "pending");
  if (!currentUser || currentUser.role === "academic") return validRecords;
  // 班主任：可以看到自己班级的所有有效记录
  if (currentUser.role === "headteacher") {
    const filtered = validRecords.filter((r) => classNoEquals(r.classNo, currentUser.classNo));
    console.log("[getVisibleRecords] 班主任过滤", { role: currentUser.role, classNo: currentUser.classNo, inputRecords: validRecords.length, outputRecords: filtered.length });
    return filtered;
  }
  // 任课教师：返回已确认和待审核的有效记录
  return validRecords;
};

// 获取某场考试的科目配置（统一使用教务端设定的分数线）
// - 班级自建考试：使用考试自身的 subjects
// - 年级统一考试：优先使用考试自身的 subjects，回退到年级学科库
const getExamSubjects = (examId) => {
  if (!DB || !DB.exams) return [];
  const exam = DB.exams.find((e) => e.id === examId);
  if (!exam) return [];
  let subjects = [];
  if (Array.isArray(exam.subjects) && exam.subjects.length > 0) {
    subjects = exam.subjects;
  } else if (DB.subjects && DB.subjects[exam.grade]) {
    subjects = DB.subjects[exam.grade];
  }
  return subjects.map((s) => ({
    ...s,
    fullScore: s.fullScore != null ? s.fullScore : 100,
    excellent: s.excellent != null ? s.excellent : Math.round((s.fullScore || 100) * 0.85),
    good: s.good != null ? s.good : Math.round((s.fullScore || 100) * 0.7),
    pass: s.pass != null ? s.pass : Math.round((s.fullScore || 100) * 0.6),
    low: s.low != null ? s.low : Math.round((s.fullScore || 100) * 0.4)
  }));
};

// 获取班主任端可见的考试列表（年级统一考试 + 本班自建考试）
const getHeadteacherExams = (grade, classNo) => {
  if (!DB || !DB.exams) return [];
  return DB.exams.filter((e) => {
    if (e.grade !== grade) return false;
    if (!e.isClassExam) return true; // 年级统一考试，可见
    // 班级自建考试：仅本班可见
    return classNoEquals(e.classNo, classNo);
  });
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

// 学号格式解析：根据格式解析学号，如 20260110 -> {yearPrefix: 2026, classNo: "1班", index: 10}
const parseStudentId = (studentId) => {
  if (!studentId) return null;
  const id = String(studentId);
  
  // 格式：YYYYNN## (4位年份前缀 + 2位班级号 + 2位序号)
  // 例如：20260110 -> 年份前缀2026, 班级01, 序号10
  const match = id.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return null;
  
  const yearPrefix = match[1];
  const classNum = parseInt(match[2]);
  const index = parseInt(match[3]);
  const classNo = classNum + "班";
  
  return { yearPrefix, classNum, classNo, index };
};

// 学号格式验证：根据格式验证学号是否符合规则
const validateStudentIdFormat = (studentId, grade) => {
  if (!studentId) return true;
  
  const parsed = parseStudentId(studentId);
  if (!parsed) return { valid: false, reason: "学号格式不正确（应为8位数字：年份+班级+序号）" };
  
  // 验证年份前缀是否匹配设置
  const expectedYearPrefix = DB.studentIdFormat?.yearPrefix || "2026";
  if (parsed.yearPrefix !== expectedYearPrefix) {
    return { valid: false, reason: `年份前缀不匹配（应为${expectedYearPrefix}）` };
  }
  
  return { valid: true };
};

// 生成学号：根据格式生成学号
const generateStudentId = (grade, classNo, index) => {
  // 获取年份前缀（可自定义）
  const yearPrefix = DB.studentIdFormat?.yearPrefix || "2026";
  
  // 提取班级数字
  const classNum = parseInt(classNo.replace(/\D/g, '')) || 1;
  
  // 格式：YYYYNN## (年份前缀 + 两位班级号 + 两位序号)
  return `${yearPrefix}${String(classNum).padStart(2, '0')}${String(index).padStart(2, '0')}`;
};

// 显示学号翻译：根据学号格式显示可读信息
const displayStudentIdInfo = (studentId) => {
  const parsed = parseStudentId(studentId);
  if (!parsed) return "";
  return `${parsed.yearPrefix}级${parsed.classNo}第${parsed.index}号`;
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
  // 1. 先读取本地缓存
  let localDB = null;
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.users && parsed.users.length > 0) {
        localDB = parsed;
        console.log("[loadDB] 📤 本地缓存有效（", parsed.users.length, "个用户，", parsed.exams?.length || 0, "场考试，", parsed.records?.length || 0, "条记录）");
      }
    }
  } catch (e) {
    console.log("[loadDB] ⚠️ 本地缓存解析失败:", e.message);
  }

  // 2. 如果云端已配置，尝试加载云端数据
  if (GitHubService.isConfigured()) {
    try {
      const remote = await GitHubService.loadRemoteDB();
      if (remote && remote.users && remote.users.length > 0) {
        // 比较本地和云端数据，保留更更新的版本
        if (localDB) {
          const localExamCount = localDB.exams?.length || 0;
          const localRecordCount = localDB.records?.length || 0;
          const remoteExamCount = remote.exams?.length || 0;
          const remoteRecordCount = remote.records?.length || 0;
          const localTimestamp = localDB._lastModified || 0;
          const remoteTimestamp = remote._lastModified || 0;

          // 本地数据更丰富 或 本地时间戳更新 → 保留本地
          if (localExamCount > remoteExamCount || localRecordCount > remoteRecordCount || localTimestamp > remoteTimestamp) {
            console.log("[loadDB] ⏭️ 本地数据更新（本地:", localExamCount, "场考试/", localRecordCount, "条记录 vs 云端:", remoteExamCount, "场/", remoteRecordCount, "条），保留本地");
            return localDB;
          }
        }
        // 云端数据更新或本地无数据 → 使用云端
        localStorage.setItem(DB_KEY, JSON.stringify(remote));
        console.log("[loadDB] ✅ 使用云端数据（", remote.exams?.length || 0, "场考试，", remote.records?.length || 0, "条记录）");
        return remote;
      }
      console.log("[loadDB] ⚠️ 云端数据为空或无效");
    } catch (e) {
      console.log("[loadDB] ❌ Gist 加载失败:", e.message);
    }
  }

  // 3. 有本地数据则使用本地
  if (localDB) {
    console.log("[loadDB] 📤 使用本地缓存数据");
    return localDB;
  }

  // 4. 本地和云端都没有 → 创建默认数据
  const db = initDefaultDB();
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  console.log("[loadDB] 📦 创建默认数据");
  return db;
}

// ========== 本地优先存储 + 手动/自动同步 ==========
// 教务端：本地操作 + 手动上传/拉取；其他端：导航切换自动同步、退出等待上传
let _dirtyFlag = false;       // 本地是否有未上传的更改
let _dirtyExamIds = [];       // 【优化】记录哪些考试的成绩发生了变化（增量上传用）
let _syncInProgress = false;  // 是否正在传输（上传/拉取）
let _syncAction = "";         // 当前传输动作："upload" | "pull" | ""
let _lastSyncTime = null;     // 上次成功同步时间戳
let _lastSyncPartial = false; // 上次同步是否部分成功

// 本地保存：仅写入 localStorage 并标记为「有未上传更改」，不再自动推送云端
// 【优化】可选传入 changedExamId，记录增量变化的考试
function saveDB(db, changedExamId) {
  db._lastModified = Date.now();
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  _dirtyFlag = true;
  if (changedExamId && !_dirtyExamIds.includes(changedExamId)) {
    _dirtyExamIds.push(changedExamId);
  }
  updateSyncBadge();
  return Promise.resolve(true);
}

// 上传本地数据到云端（带传输时间提示）
// manual: 是否手动触发（显示 toast）
// onProgress: 可选进度回调
// forceFull: true 时强制全量上传（不使用增量）
async function pushToRemote(manual, onProgress, forceFull) {
  if (!GitHubService.isConfigured()) {
    if (manual) showToast("未配置云端同步，无法上传", "warning");
    return false;
  }
  if (_syncInProgress) {
    if (manual) showToast("正在传输中，请稍候…", "warning");
    return false;
  }
  const hasRealData = DB && DB.users && DB.users.length > 0;
  if (!hasRealData) {
    if (manual) showToast("无真实数据，无需上传", "info");
    else console.log("[pushToRemote] 无真实数据，跳过上传");
    return false;
  }
  _syncInProgress = true;
  _syncAction = "upload";
  updateSyncBadge();
  const start = performance.now();
  try {
    // 【优化】传入 dirtyExamIds 实现增量上传；forceFull 时强制全量
    const useIncremental = !forceFull && _dirtyExamIds && _dirtyExamIds.length > 0;
    const result = await GitHubService.saveRemoteDB(DB, useIncremental ? _dirtyExamIds : null, onProgress);
    const elapsed = ((performance.now() - start) / 1000).toFixed(2);
    if (result === true) {
      _dirtyFlag = false;
      _dirtyExamIds = []; // 清空增量标记
      _lastSyncPartial = false;
      _lastSyncTime = Date.now();
      updateSyncBadge();
      hideSyncErrorBanner();
      const modeText = useIncremental ? "（增量）" : "（全量）";
      if (manual) showToast(`✅ 上传完成${modeText}，用时 ${elapsed} 秒`, "success");
      else console.log(`[同步] 自动上传完成${modeText}，用时 ${elapsed} 秒`);
      return true;
    } else if (result === 'partial') {
      _dirtyFlag = false;
      _lastSyncPartial = true;
      _lastSyncTime = Date.now();
      updateSyncBadge();
      if (manual) showToast(`⚠️ 上传完成（部分数据），用时 ${elapsed} 秒`, "warning");
      return true;
    } else {
      updateSyncStatus("error");
      if (manual) showToast(`❌ 上传失败（${elapsed} 秒），请重试`, "error");
      return false;
    }
  } catch (err) {
    const elapsed = ((performance.now() - start) / 1000).toFixed(2);
    updateSyncStatus("error");
    if (manual) showToast(`❌ 上传失败：${err.message}（${elapsed} 秒）`, "error");
    return false;
  } finally {
    _syncInProgress = false;
    _syncAction = "";
    updateSyncBadge();
  }
}

// 从云端拉取数据到本地（带传输时间提示）。merge=true 时合并远程而非覆盖
async function pullFromRemote(manual) {
  if (!GitHubService.isConfigured()) {
    if (manual) showToast("未配置云端同步，无法拉取", "warning");
    return false;
  }
  if (_syncInProgress) {
    if (manual) showToast("正在传输中，请稍候…", "warning");
    return false;
  }
  _syncInProgress = true;
  _syncAction = "pull";
  updateSyncBadge();
  const start = performance.now();
  try {
    const remote = await GitHubService.loadRemoteDB();
    const elapsed = ((performance.now() - start) / 1000).toFixed(2);
    if (remote && remote.users && remote.users.length > 0) {
      // 【兼容】迁移旧的 pending 状态为 confirmed（审核功能已移除）
      let migratedCount = 0;
      if (remote.records && Array.isArray(remote.records)) {
        remote.records.forEach((r) => {
          if (r.status === "pending") {
            r.status = "confirmed";
            r.confirmedAt = r.confirmedAt || Date.now();
            r.confirmedBy = r.confirmedBy || "system_migration";
            migratedCount++;
          }
        });
      }
      DB = remote;
      localStorage.setItem(DB_KEY, JSON.stringify(DB));
      _dirtyFlag = false;
      _dirtyExamIds = [];
      _lastSyncPartial = false;
      _lastSyncTime = Date.now();
      if (currentUser) {
        const u = DB.users.find((x) => x.id === currentUser.id);
        if (u) currentUser = u;
      }
      updateSyncBadge();
      hideSyncErrorBanner();
      const migrateMsg = migratedCount > 0 ? `（已迁移 ${migratedCount} 条旧数据）` : "";
      if (manual) showToast(`✅ 拉取完成${migrateMsg}，用时 ${elapsed} 秒`, "success");
      else console.log(`[同步] 自动拉取完成${migrateMsg}，用时 ${elapsed} 秒`);
      return true;
    } else {
      updateSyncBadge();
      if (manual) showToast("云端暂无有效数据", "warning");
      return false;
    }
  } catch (err) {
    const elapsed = ((performance.now() - start) / 1000).toFixed(2);
    updateSyncStatus("error");
    if (manual) showToast(`❌ 拉取失败：${err.message}（${elapsed} 秒）`, "error");
    return false;
  } finally {
    _syncInProgress = false;
    _syncAction = "";
    updateSyncBadge();
  }
}

// 导航切换时自动同步：有本地更改先上传再拉取，没更改只拉取
// 使用右上角小进度条展示，区别于退出时的大弹窗
async function autoSyncOnNavigate() {
  if (!GitHubService.isConfigured()) return;
  if (_syncInProgress) return;

  const hasChanges = _dirtyFlag || (_dirtyExamIds && _dirtyExamIds.length > 0);
  const steps = hasChanges ? ["上传本地更改", "拉取云端最新数据"] : ["拉取云端最新数据"];
  showNavSyncProgress(steps);

  try {
    let step = 0;

    // 第1步：有更改时先上传（增量上传，不阻塞太长时间）
    if (hasChanges) {
      const badge = $("sync-badge");
      if (badge) { badge.innerHTML = "⬆️ 上传中…"; badge.style.background = "#e3f2fd"; badge.style.color = "#1976d2"; }
      _syncInProgress = true;
      _syncAction = "upload";
      updateSyncBadge();
      try {
        await pushToRemote(false, null, false);
      } catch(e) {
        console.log("[navigate] 自动上传失败:", e.message);
      } finally {
        _syncInProgress = false;
        _syncAction = "";
      }
      step++;
      updateNavSyncProgress(step);
    }

    // 第2步：拉取云端最新数据
    const badge = $("sync-badge");
    if (badge) { badge.innerHTML = "⬇️ 拉取中…"; badge.style.background = "#e3f2fd"; badge.style.color = "#1976d2"; }
    _syncInProgress = true;
    _syncAction = "pull";
    updateSyncBadge();
    try {
      await pullFromRemote(false);
    } catch(e) {
      console.log("[navigate] 自动拉取失败:", e.message);
    } finally {
      _syncInProgress = false;
      _syncAction = "";
    }
    step++;
    updateNavSyncProgress(step);

    finishNavSyncProgress(true);
    updateSyncBadge();

    // 拉取后刷新当前用户
    if (currentUser && DB && DB.users) {
      const u = DB.users.find(x => x.id === currentUser.id);
      if (u) currentUser = u;
    }
  } catch (e) {
    console.log("[navigate] 自动同步异常:", e.message);
    finishNavSyncProgress(false);
    updateSyncBadge();
  }
}

window.pushToRemote = pushToRemote;
window.pullFromRemote = pullFromRemote;

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
    studentIdFormat: { 
      enabled: true, 
      pattern: "YYYYNN##", 
      yearPrefix: "2026",  // 年份前缀（可自定义）
      description: "学号格式：YYYY（年份前缀）+ NN（两位班级号）+ ##（两位班级人数顺序）" 
    },  // 学号格式设置
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
        { id: "users", icon: "👤", text: "教师名单管理" }
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
      group: "考试与成绩", icon: "📊", items: [
        { id: "exams", icon: "📝", text: "考试管理" },
        { id: "academic_upload_scores", icon: "📥", text: "按班级名单上传全年级" },
        { id: "academic_upload_examroom", icon: "🏫", text: "按考场名单上传全年级" },
        { id: "class_ranking", icon: "🏆", text: "全年级排名" },
        { id: "teacher_ranking", icon: "🎖️", text: "教师排行榜" }
      ]
    },
    {
      group: "数据分析", icon: "🔍", items: [
        { id: "academic_analysis", icon: "🔍", text: "全平台智能分析" },
        { id: "exam_compare", icon: "🔄", text: "多次考试对比" }
      ]
    },
    {
      group: "教务管理", icon: "📋", items: [
        { id: "users", icon: "👩‍🏫", text: "教师名单" }
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
        { id: "group_scores", icon: "👥", text: "小组成绩分析" }
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
      group: "班级考试管理", icon: "📝", items: [
        { id: "class_exams", icon: "📝", text: "班级考试管理" },
        { id: "upload_scores", icon: "📥", text: "上传班级成绩" }
      ]
    },
    {
      group: "班级成绩", icon: "📖", items: [
        { id: "my_class_scores", icon: "📖", text: "本班考试成绩" },
        { id: "class_ranking", icon: "🏆", text: "本班排名统计" },
        { id: "download_scores", icon: "📤", text: "下载Excel成绩" }
      ]
    },
    {
      group: "任教科目", icon: "📘", items: [
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
      group: "个人中心", icon: "👤", items: [
        { id: "account_profile", icon: "🔐", text: "修改我的密码" }
      ]
    }
  ]
};

// ========== 登录 ==========
// 自动登录：优先从 sessionStorage 恢复登录状态，其次从 localStorage「记住我」自动登录
async function initAutoLogin() {
  // 加载数据（loadDB 已内置本地优先 + 云端比较逻辑）
  if (!DB) {
    DB = await loadDB();
  }

  // 1. 尝试从 sessionStorage 恢复登录状态
  const sessionUserId = sessionStorage.getItem("current_user_id");
  if (sessionUserId && DB && DB.users) {
    const user = DB.users.find((u) => u.id === sessionUserId);
    if (user) {
      currentUser = user;
      enterApp();
      return;
    }
  }

  // 4. 尝试从 localStorage「记住我」自动登录
  const savedUser = localStorage.getItem("saved_user");
  if (savedUser) {
    try {
      const { username, password, role } = JSON.parse(savedUser);
      if (username && password && role && DB && DB.users) {
        const user = DB.users.find((u) => u.username === username && u.password === password && u.role === role);
        if (user) {
          currentUser = user;
          sessionStorage.setItem("current_user_id", user.id);
          enterApp();
          return;
        }
      }
      // 填充表单
      $("loginUsername").value = username || "";
      $("loginPassword").value = password || "";
      $("loginRole").value = role || "admin";
      $("rememberMe").checked = true;
    } catch (e) {}
  }
}

// 页面加载完成后执行自动登录
document.addEventListener("DOMContentLoaded", () => {
  initAutoLogin();
});

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

  $("loginError").textContent = "正在加载数据...";
  $("loginBtn").disabled = true;
  $("loginBtn").textContent = "登录中...";

  try {
    if (!DB) {
      DB = await loadDB();
    }

    const user = DB.users.find((u) => u.username === username && u.password === password && u.role === role);
    if (!user) {
      $("loginError").textContent = "账号、密码或角色不正确";
      $("loginBtn").disabled = false;
      $("loginBtn").textContent = "登 录";
      return;
    }
    $("loginError").textContent = "";
    currentUser = user;
    sessionStorage.setItem("current_user_id", user.id);

    if ($("rememberMe").checked) {
      localStorage.setItem("saved_user", JSON.stringify({ username, password, role }));
    } else {
      localStorage.removeItem("saved_user");
    }

    $("loginBtn").disabled = false;
    $("loginBtn").textContent = "登 录";
    enterApp();
  } catch (e) {
    $("loginError").textContent = "数据加载失败：" + e.message;
    $("loginBtn").disabled = false;
    $("loginBtn").textContent = "登 录";
  }
}

async function doLogout() {
  // 关键修复：退出前先保存到 localStorage，确保数据不会丢失
  if (DB) {
    DB._lastModified = DB._lastModified || Date.now();
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
    console.log("[退出] ✅ 数据已保存到本地缓存");
  }

  // 退出前同步策略：若有未上传更改，整体全量上传后退出（不零散上传）
  if (currentUser && GitHubService.isConfigured() && _dirtyFlag && !_syncInProgress) {
    const ok = await showUploadProgressModal();
    if (!ok) {
      if (!confirm("⚠️ 数据上传未完成，退出后未上传的更改可能丢失。\n\n确定要直接退出吗？")) {
        return;
      }
    }
  }
  while (_syncInProgress) {
    await new Promise((r) => setTimeout(r, 200));
  }
  currentUser = null;
  sessionStorage.removeItem("current_user_id");
  $("mainApp").classList.add("hidden");
  $("loginPage").classList.remove("hidden");
  $("loginUsername").value = "";
  $("loginPassword").value = "";
  const btn = $("eduAssistantBtn");
  const panel = $("eduAssistant");
  if (btn) btn.style.display = "none";
  if (panel) panel.classList.add("hidden");
}

// 退出时的上传进度弹窗：全量上传，实时显示步骤进度表
function showUploadProgressModal() {
  return new Promise((resolve) => {
    // 创建遮罩
    const overlay = document.createElement("div");
    overlay.id = "upload-progress-overlay";
    overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;";
    // 弹窗内容
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:28px 32px;max-width:640px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.3);">
        <div style="text-align:center;margin-bottom:18px;">
          <div style="font-size:20px;font-weight:700;color:#1a1a1a;">⬆️ 正在上传数据到云端</div>
          <div style="font-size:13px;color:#666;margin-top:6px;">退出账号前自动整体上传，请勿关闭页面</div>
        </div>
        <div id="upload-progress-bar-wrap" style="background:#f0f0f0;border-radius:8px;height:8px;overflow:hidden;margin-bottom:18px;">
          <div id="upload-progress-bar" style="background:linear-gradient(90deg,#4f46e5,#6366f1);height:100%;width:0%;transition:width 0.3s;"></div>
        </div>
        <div style="max-height:320px;overflow-y:auto;border:1px solid #eee;border-radius:8px;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:#f8f9fa;position:sticky;top:0;">
                <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #eee;">步骤</th>
                <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #eee;width:80px;">状态</th>
                <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #eee;width:90px;">开始时间</th>
                <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #eee;width:70px;">用时</th>
              </tr>
            </thead>
            <tbody id="upload-progress-tbody"></tbody>
          </table>
        </div>
        <div id="upload-progress-summary" style="text-align:center;margin-top:14px;font-size:13px;color:#666;">正在准备…</div>
        <div style="text-align:center;margin-top:14px;">
          <button id="upload-progress-done-btn" style="display:none;background:#16a34a;color:#fff;border:none;padding:10px 32px;border-radius:8px;font-size:14px;cursor:pointer;font-weight:600;">✅ 上传完成，点击退出</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // 步骤记录：{ name, status, startTime, endTime }
    const stepRecords = {};
    const stepOrder = ["检查存储容量", "上传系统配置", "上传业务索引", "上传考试成绩", "清理已删除文件", "更新配置索引"];
    const fmtTime = (ts) => {
      const d = new Date(ts);
      const pad = (n) => String(n).padStart(2, "0");
      return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };
    const fmtDuration = (ms) => {
      if (ms < 1000) return ms + "ms";
      return (ms / 1000).toFixed(1) + "s";
    };
    const statusIcon = (status) => {
      if (status === "done") return "✅";
      if (status === "error") return "❌";
      if (status === "progress") return "⏳";
      return "⏳"; // start
    };

    const renderTable = () => {
      const tbody = document.getElementById("upload-progress-tbody");
      if (!tbody) return;
      let html = "";
      stepOrder.forEach((name) => {
        const rec = stepRecords[name];
        if (!rec) {
          html += `<tr style="border-bottom:1px solid #f0f0f0;opacity:0.4;">
            <td style="padding:7px 10px;">${name}</td>
            <td style="padding:7px 10px;text-align:center;color:#999;">—</td>
            <td style="padding:7px 10px;text-align:center;color:#999;">—</td>
            <td style="padding:7px 10px;text-align:center;color:#999;">—</td>
          </tr>`;
        } else {
          const dur = rec.endTime ? fmtDuration(rec.endTime - rec.startTime) : "进行中…";
          html += `<tr style="border-bottom:1px solid #f0f0f0;">
            <td style="padding:7px 10px;">${name}${rec.detail ? `<br><span style="font-size:11px;color:#999;">${esc(rec.detail)}</span>` : ""}</td>
            <td style="padding:7px 10px;text-align:center;">${statusIcon(rec.status)}</td>
            <td style="padding:7px 10px;text-align:center;font-family:monospace;">${fmtTime(rec.startTime)}</td>
            <td style="padding:7px 10px;text-align:center;font-family:monospace;">${dur}</td>
          </tr>`;
        }
      });
      tbody.innerHTML = html;
    };

    const updateBar = () => {
      const done = stepOrder.filter(n => stepRecords[n] && stepRecords[n].status === "done").length;
      const pct = Math.round((done / stepOrder.length) * 100);
      const bar = document.getElementById("upload-progress-bar");
      if (bar) bar.style.width = pct + "%";
      const summary = document.getElementById("upload-progress-summary");
      if (summary) summary.textContent = `进度：${done}/${stepOrder.length} 步完成（${pct}%）`;
    };

    renderTable();

    // 进度回调
    const onProgress = (info) => {
      const { step, status, timestamp, detail, current, total } = info;
      if (status === "start") {
        stepRecords[step] = { status: "start", startTime: timestamp, detail: detail || "" };
      } else if (status === "progress") {
        if (stepRecords[step]) {
          stepRecords[step].detail = detail || "";
        }
      } else if (status === "done" || status === "error") {
        if (stepRecords[step]) {
          stepRecords[step].status = status;
          stepRecords[step].endTime = timestamp;
          stepRecords[step].detail = detail || stepRecords[step].detail;
        }
      }
      renderTable();
      updateBar();
    };

    // 开始全量上传
    pushToRemote(false, onProgress, true).then((result) => {
      const summary = document.getElementById("upload-progress-summary");
      const doneBtn = document.getElementById("upload-progress-done-btn");
      const bar = document.getElementById("upload-progress-bar");
      if (result) {
        if (bar) bar.style.width = "100%";
        if (summary) summary.innerHTML = `✅ 上传完成！共 ${Object.keys(stepRecords).length} 个步骤已完成`;
        if (doneBtn) {
          doneBtn.style.display = "";
          doneBtn.onclick = () => { overlay.remove(); resolve(true); };
        }
      } else {
        if (summary) summary.innerHTML = `❌ 上传失败，请检查网络后重试`;
        if (doneBtn) {
          doneBtn.style.display = "";
          doneBtn.textContent = "关闭";
          doneBtn.style.background = "#dc2626";
          doneBtn.onclick = () => { overlay.remove(); resolve(false); };
        }
      }
    });
  });
}

function enterApp() {
  $("loginPage").classList.add("hidden");
  $("mainApp").classList.remove("hidden");
  renderUserInfo();
  renderNavMenu();
  renderAnnouncement();
  renderSyncStatus();
  initSidebarToggle();
  navigate("dashboard");

  startPeriodicSync();
  setupBeforeUnloadWarning();
}

let _periodicSyncTimer = null;

function startPeriodicSync() {
  if (_periodicSyncTimer) clearInterval(_periodicSyncTimer);
  _periodicSyncTimer = setInterval(() => {
    if (currentUser && GitHubService.isConfigured() && _dirtyFlag && !_syncInProgress) {
      console.log("[自动同步] 检测到未上传更改，触发定时同步...");
      pushToRemote(false);
    }
  }, 2 * 60 * 1000);
}

function setupBeforeUnloadWarning() {
  window.addEventListener("beforeunload", (e) => {
    if (currentUser && _dirtyFlag) {
      e.preventDefault();
      e.returnValue = "您有未上传的数据更改，关闭页面后可能丢失。确定要离开吗？";
      return e.returnValue;
    }
  });

  window.addEventListener("unload", () => {
    if (currentUser && GitHubService.isConfigured() && _dirtyFlag && !_syncInProgress) {
      try {
        const dbStr = localStorage.getItem(DB_KEY);
        if (dbStr && navigator.sendBeacon) {
          const blob = new Blob([dbStr], { type: "application/json" });
          console.log("[页面卸载] 有未上传更改，已保留在本地缓存中");
        }
      } catch (e) {}
    }
  });
}

// ========== 侧边栏自动隐藏/展开 ==========
// 鼠标在右侧操作时导航栏收起（仅图标），鼠标移到导航栏时自动展开
function initSidebarToggle() {
  const sidebar = $("sidebar");
  const mainApp = $("mainApp");
  if (!sidebar || !mainApp) return;

  // 启用自动隐藏模式：默认收起 70px，鼠标悬停展开 240px（覆盖内容区，不推移内容）
  sidebar.classList.add("auto-hide");
  mainApp.classList.add("auto-hide-sidebar");

  let hoverTimer = null;
  // 鼠标进入导航栏：展开
  sidebar.addEventListener("mouseenter", () => {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    sidebar.classList.add("sidebar-hover");
  });
  // 鼠标离开导航栏：延迟收起（避免经过间隙时闪烁）
  sidebar.addEventListener("mouseleave", () => {
    hoverTimer = setTimeout(() => {
      sidebar.classList.remove("sidebar-hover");
      hoverTimer = null;
    }, 150);
  });
}

// ========== GitHub 同步状态 ==========
function renderSyncStatus() {
  // 顶部栏右侧：仅显示简洁状态徽标（拉取/上传全自动，无需手动按钮）
  if ($("sync-status")) { updateSyncBadge(); return; }
  const statusDiv = document.createElement("div");
  statusDiv.id = "sync-status";
  statusDiv.style.cssText = "display:flex;flex-direction:column;align-items:flex-end;gap:3px;min-width:130px;";
  statusDiv.innerHTML = `
    <span id="sync-badge" style="font-size:12px;padding:4px 10px;background:#f0f4ff;border-radius:12px;color:#3b7ddd;white-space:nowrap">🔗 未连接</span>
    <div id="sync-nav-progress" style="display:none;width:120px;height:3px;background:#e5e7eb;border-radius:2px;overflow:hidden;">
      <div id="sync-nav-progress-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#4f46e5,#6366f1);transition:width 0.3s ease;"></div>
    </div>
  `;
  const rightBar = document.querySelector(".topbar-right");
  if (rightBar) rightBar.insertBefore(statusDiv, rightBar.firstChild);
  updateSyncBadge();
}

// 导航切换时的轻量同步进度条（小巧，区别于退出时的大弹窗）
let _navSyncSteps = [];
let _navSyncDone = 0;

function showNavSyncProgress(steps) {
  _navSyncSteps = steps || ["上传更改", "拉取最新数据"];
  _navSyncDone = 0;
  const bar = $("sync-nav-progress");
  const fill = $("sync-nav-progress-bar");
  if (bar) bar.style.display = "block";
  if (fill) fill.style.width = "0%";
}

function updateNavSyncProgress(stepIndex) {
  _navSyncDone = stepIndex;
  const fill = $("sync-nav-progress-bar");
  if (fill && _navSyncSteps.length > 0) {
    const pct = Math.round((stepIndex / _navSyncSteps.length) * 100);
    fill.style.width = pct + "%";
  }
}

function finishNavSyncProgress(success) {
  const fill = $("sync-nav-progress-bar");
  const bar = $("sync-nav-progress");
  if (fill) fill.style.width = "100%";
  if (fill) fill.style.background = success ? "linear-gradient(90deg,#16a34a,#22c55e)" : "linear-gradient(90deg,#dc2626,#ef4444)";
  setTimeout(() => {
    if (bar) bar.style.display = "none";
    if (fill) {
      fill.style.width = "0%";
      fill.style.background = "linear-gradient(90deg,#4f46e5,#6366f1)";
    }
  }, 800);
}

// 仅依据本地状态更新徽标，不再发起网络请求
function updateSyncBadge() {
  const badge = $("sync-badge");
  if (!badge) return;
  const gs = window.GitHubService;
  if (!gs || !gs.isConfigured()) {
    badge.innerHTML = "🔗 未配置";
    badge.style.background = "#fff4e6";
    badge.style.color = "#d9480f";
    return;
  }
  // 传输中
  if (_syncInProgress) {
    if (_syncAction === "upload") {
      badge.innerHTML = "⬆️ 正在上传…";
      badge.style.background = "#e3f2fd";
      badge.style.color = "#1976d2";
    } else {
      badge.innerHTML = "⬇️ 正在拉取…";
      badge.style.background = "#e3f2fd";
      badge.style.color = "#1976d2";
    }
    return;
  }
  // 上次同步失败
  if (_lastSyncPartial) {
    badge.innerHTML = "⚠️ 部分同步";
    badge.style.background = "#fff8e1";
    badge.style.color = "#d97706";
    return;
  }
  // 有未上传的本地更改
  if (_dirtyFlag) {
    const tip = _lastSyncTime ? `（上次同步 ${_fmtSyncTime(_lastSyncTime)}）` : "";
    badge.innerHTML = `⚠️ 有未上传更改${tip}`;
    badge.style.background = "#fff8e1";
    badge.style.color = "#d97706";
    return;
  }
  // 已同步
  if (_lastSyncTime) {
    badge.innerHTML = `✅ 已同步（${_fmtSyncTime(_lastSyncTime)}）`;
    badge.style.background = "#e8f7ec";
    badge.style.color = "#2b8a3e";
  } else {
    badge.innerHTML = "✅ 已连接";
    badge.style.background = "#e8f7ec";
    badge.style.color = "#2b8a3e";
  }
}

function _fmtSyncTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 实时同步状态：synced | error | partial
function updateSyncStatus(status) {
  if (status === "error") {
    showSyncErrorBanner();
  } else if (status === "synced") {
    hideSyncErrorBanner();
  }
  updateSyncBadge();
}

function showSyncErrorBanner() {
  if (document.getElementById("sync-error-banner")) return; // 已显示
  const banner = document.createElement("div");
  banner.id = "sync-error-banner";
  banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:99999;background:#fee;border-bottom:2px solid #c00;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;font-size:14px;color:#c00;box-shadow:0 2px 8px rgba(200,0,0,0.2)";
  banner.innerHTML = `<span>⚠️ <b>云端同步失败！</b>当前数据只保存在本地，换设备后将无法使用。请检查网络和 Gist 配置后重试。</span><button onclick="manualRetrySync()" style="background:#c00;color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:13px">🔄 重试上传</button>`;
  document.body.insertBefore(banner, document.body.firstChild);
  document.body.style.paddingTop = "50px";
}

function hideSyncErrorBanner() {
  const banner = document.getElementById("sync-error-banner");
  if (banner) { banner.remove(); document.body.style.paddingTop = "0"; }
}

window.manualRetrySync = async function () {
  if (!DB) return;
  hideSyncErrorBanner();
  const ok = await pushToRemote(true);
  if (ok) {
    hideSyncErrorBanner();
  } else {
    showSyncErrorBanner();
    showToast("❌ 上传仍然失败，请检查 Gist 配置", "error", 5000);
  }
};

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
        <div class="form-group"><label for="gd_token">GitHub Token</label><input type="password" id="gd_token" name="gd_token" value="${cfg.token || ""}" placeholder="在此粘贴 Token" /></div>
        <div class="form-group"><label for="gd_config_id">主 Gist ID（配置存储，永久不变）</label><input id="gd_config_id" name="gd_config_id" value="${cfg.configGistId || ""}" placeholder="a1b2c3d4e5f6…" /></div>
      </div>
      <div class="form-row">
        ${[1, 2, 3, 4, 5].map(i => `
          <div class="form-group">
            <label for="gd_data_id_${i}">业务 Gist ID #${i}${i === 1 ? "（当前活跃）" : "（归档）"}</label>
            <input id="gd_data_id_${i}" name="gd_data_id_${i}" class="gd_data_id_${i}" value="${cfg.dataGistIds[i - 1] || ""}" placeholder="留空则首次上传时自动创建" />
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
      <div class="card-title">📊 同步状态与诊断</div>
      <div id="gd_sync_info" style="padding:12px;background:#f8f9fc;border-radius:8px;font-size:13px;color:var(--text-light)">
        <p>• 当前状态：${gs.isConfigured() ? `<b style="color:#2b8a3e">✅ 已配置</b>` : `<b style="color:#d9480f">⚠️ 未配置</b>`}</p>
        <p>• Token：${cfg.token ? "✅ 已设置" : "❌ 未设置"}</p>
        <p>• 主 Gist ID：<code>${cfg.configGistId || "未设置"}</code></p>
        <p>• 业务 Gist：<code>${cfg.dataGistIds.length ? cfg.dataGistIds.join("、") : "未设置（首次上传时自动创建）"}</code></p>
        <p>• 本地缓存：<code>${DB ? `${DB.users?.length || 0}用户、${DB.exams?.length || 0}考试、${DB.records?.length || 0}成绩` : "无"}</code></p>
        <p style="margin-top:8px;color:#d97706">💡 提示：首次使用请按顺序操作：①保存配置 → ②立即同步到 Gist → ③在其他设备登录时点击"从 Gist 拉取数据"</p>
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

  $("gd_save").onclick = async () => {
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

    // 配置保存成功后自动拉取云端数据，这样其他端账号也能直接登录
    if (gs.isConfigured()) {
      const saveBtn = $("gd_save");
      const originalText = saveBtn.textContent;
      saveBtn.disabled = true;
      saveBtn.textContent = "正在拉取数据…";
      try {
        const ok = await pullFromRemote(false);
        if (ok) {
          showToast(`✅ 已自动拉取云端数据，共 ${DB.users.length} 个账号可用`, "success");
          // 如果当前在配置页面，刷新显示
          if (currentPage === "githubData") renderGithubData();
          // 若已有登录用户，刷新当前用户信息
          if (currentUser) {
            const u = DB.users.find((x) => x.id === currentUser.id);
            if (u) currentUser = u;
          }
        } else {
          showToast("云端暂无数据，这是首次配置，上传后其他端即可登录", "info");
        }
      } catch (e) {
        showToast(`拉取失败：${e.message}，可稍后手动重试`, "warning");
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
      }
    }
  };

  $("gd_sync_now").onclick = async () => {
    if (!DB) { showToast("请先登录", "error"); return; }
    $("gd_sync_now").disabled = true;
    $("gd_sync_now").textContent = "上传中…";
    const start = performance.now();
    try {
      const ok = await pushToRemote(true);
      if (ok) {
        const el = ((performance.now() - start) / 1000).toFixed(2);
        showToast(`✅ 上传成功！用时 ${el} 秒`, "success");
      }
    } finally {
      $("gd_sync_now").disabled = false;
      $("gd_sync_now").textContent = "🔄 立即同步到 Gist";
      renderGithubData();
    }
  };

  $("gd_load").onclick = async () => {
    $("gd_load").disabled = true;
    $("gd_load").textContent = "拉取中…";
    const start = performance.now();
    try {
      const ok = await pullFromRemote(true);
      if (ok) {
        const el = ((performance.now() - start) / 1000).toFixed(2);
        showToast(`✅ 拉取成功！已加载 ${DB.users.length} 个用户账号，用时 ${el} 秒`, "success");
        navigate("dashboard");
      }
    } finally {
      $("gd_load").disabled = false;
      $("gd_load").textContent = "📥 从 Gist 拉取数据";
      renderGithubData();
    }
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
  if (_syncInProgress) {
    showToast("正在同步数据，请稍候…", "warning");
    return;
  }

  currentPage = pageId;
  $("navMenu").querySelectorAll(".nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.id === pageId);
  });
  const groups = NAV_MENUS[currentUser.role] || [];
  const allItems = groups.flatMap((g) => g.items);
  const menu = allItems.find((m) => m.id === pageId);
  $("pageTitle").textContent = menu ? menu.text : "页面";

  // 切换功能时自动同步：有本地更改先上传再拉取，没更改只拉取
  // 右上角显示小进度条，区别于退出时的大弹窗
  if (GitHubService.isConfigured()) {
    await autoSyncOnNavigate();
  } else {
    // 未配置云端：从本地 localStorage 读取最新
    const savedDB = localStorage.getItem(DB_KEY);
    if (savedDB) {
      try {
        DB = JSON.parse(savedDB);
        if (currentUser) {
          const user = DB.users.find((u) => u.id === currentUser.id);
          if (user) currentUser = user;
        }
      } catch (e) { /* 保持现有 DB */ }
    }
  }

  const render = PAGE_RENDERERS[pageId];
  if (render) render();
  else $("pageContent").innerHTML = `<div class="empty-state"><div class="es-icon">🚧</div><div class="es-title">功能建设中</div></div>`;

  // 每次导航后检查并弹出全年组通知
  setTimeout(() => { checkGradeNotifications(); }, 400);

  // 智能助手仅在考试分析页面显示
  const analysisPages = ["academic_analysis", "headteacher_analysis", "teacher_analysis"];
  const eaBtn = $("eduAssistantBtn");
  const eaPanel = $("eduAssistant");
  if (eaBtn) {
    if (analysisPages.includes(pageId)) {
      eaBtn.style.display = "flex";
    } else {
      eaBtn.style.display = "none";
      if (eaPanel) eaPanel.classList.add("hidden");
    }
  }
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
        <div class="form-group"><label for="ap_old">当前密码</label>
          <input id="ap_old" name="ap_old" type="password" placeholder="输入当前密码" />
        </div>
        <div class="form-group"><label for="ap_new1">新密码</label>
          <input id="ap_new1" name="ap_new1" type="password" placeholder="至少 4 位" />
        </div>
        <div class="form-group"><label for="ap_new2">确认新密码</label>
          <input id="ap_new2" name="ap_new2" type="password" placeholder="再次输入新密码" />
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

// ========== 排考场系统（已移除） ==========
/* function renderExamArrangement() { ... } 已移除 */

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
  academic_upload_examroom: renderAcademicUploadExamroom,
  grade_summary: renderGradeSummary,
  class_ranking: renderClassRanking,
  teacher_ranking: renderTeacherRanking,
  grade_notifications: renderGradeNotifications,
  announcement: renderAnnouncementMgr,
  announcements_all: renderAnnouncementMgr,
  academic_analysis: renderAcademicAnalysis,
  score_review: renderScoreReview,
  class_exams: renderClassExams,
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

// ========== 各功能模块使用帮助 ==========
// 每个页面对应一段帮助文字，点击顶部栏「?」按钮查看
const PAGE_HELPS = {
  dashboard: {
    title: "平台概览 / 工作首页",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>平台概览是登录后的默认页面，集中展示当前平台的整体数据情况，包括教师总数、考试次数、成绩记录数、公告数量等核心指标，并展示近期活跃数据。</p>
        </div>
        <div class="help-section">
          <h4>🚀 快捷入口</h4>
          <p>页面提供常用功能的快捷卡片，包括「按班级名单上传全年级」和「按考场名单上传全年级」两种上传方式，点击即可快速进入对应功能模块。</p>
        </div>
        <div class="help-note">💡 提示：您可以通过左侧导航栏访问所有功能模块。</div>
      </div>`
  },
  users: {
    title: "教师名单",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>管理本年级所有教师的账号信息，包括添加、编辑、删除教师，以及为教师分配班级权限。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>点击「添加教师」按钮创建新教师账号。</li>
            <li>设置教师的姓名、账号、密码、任教班级等信息。</li>
            <li>教师登录后可查看自己所带班级的成绩数据。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：教师账号创建后，教师可以使用账号密码登录平台查看班级成绩。</div>
      </div>`
  },
  grades: {
    title: "班级管理",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>管理本年级的所有班级，包括添加新班级、编辑班级信息、删除班级等操作。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>点击「添加班级」按钮创建新班级。</li>
            <li>设置班级名称（如：高三(1)班）和班级代码。</li>
            <li>班级创建后可在教师名单中为教师分配该班级。</li>
          </ol>
        </div>
      </div>`
  },
  exams: {
    title: "考试管理",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>管理本年级的所有考试，包括创建考试、设置考试科目、上传成绩、查看成绩分析等。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>点击「添加考试」按钮创建新考试。</li>
            <li>设置考试名称、考试时间、考试科目等信息。</li>
            <li>在考试详情页可以上传成绩或查看成绩分析。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：创建考试后，教师可以在「成绩上传」模块上传该考试的成绩。</div>
      </div>`
  },
  academic_upload_scores: {
    title: "按班级名单上传全年级",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>教务端专用功能，通过 Excel 按班级名单批量上传全年级成绩。支持单科/多科上传、已上传成绩删除，上传后成绩直接生效。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>选择目标考试和年级。</li>
            <li>点击科目按钮选择要上传的科目（可多选），或不上传指定科目则导入全部科目。</li>
            <li>下载 Excel 模板，按模板格式填写班级、姓名、各科分数。</li>
            <li>上传 Excel 文件，系统自动解析并预览。</li>
            <li>确认无误后点击「提交」，成绩直接生效。</li>
            <li>如需修改，可在下方「已上传成绩管理」中删除单条、按班级删除或清空全部。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：Excel 表头需与学科名称一致（支持拼音首字母、英文缩写等自动识别）；分数留空视为0分；跨文件同学生会自动合并分数。</div>
      </div>`
  },
  academic_analysis: {
    title: "全平台智能分析",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>对全年级成绩数据进行多维度智能分析，包括年级总览、分数段分布、班级学科热力图、科目表现（优秀率、良好率、及格率、低分率）、学生进退步分析等。内置智能助手，支持自然语言问答。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>选择要分析的考试和年级。</li>
            <li>系统将自动生成分析报告。</li>
            <li>可以切换不同的分析维度查看详细数据。</li>
            <li>点击右下角智能助手图标，可用自然语言提问（如"数学低分率是多少"）。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：分析结果支持导出Excel，方便存档和分享。所有统计指标基于教务端自定义的分值线计算。</div>
      </div>`
  },
  account_profile: {
    title: "修改我的密码",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>修改当前登录账号的密码。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>输入当前密码进行验证。</li>
            <li>输入新密码并确认。</li>
            <li>点击「保存修改」完成密码更新。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：建议定期更换密码，不要使用过于简单的密码（如 123456）。</div>
      </div>`
  },
  users: {
    title: "教师名单",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p><b>管理员</b>：可添加、编辑、删除教师账号，设置角色、所属年级、班级、任教学科等。</p>
          <p><b>教务老师</b>：按学科分类查看本年级所有任课教师及班主任的任教信息。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法（管理员）</h4>
          <ol>
            <li>点击「添加教师」按钮，填写教师姓名、登录账号、密码、角色。</li>
            <li>为任课教师选择所属年级与任教学科；为班主任指定所带班级。</li>
            <li>支持批量导入导出，快速初始化教师名单。</li>
          </ol>
        </div>
        <div class="help-section">
          <h4>👀 查看说明（教务）</h4>
          <p>页面按学科分组展示，每组列出该学科的所有教师姓名和任教班级。班主任会额外标注「班主任」徽章。</p>
        </div>
      </div>`
  },
  grades: {
    title: "年级设置",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>管理员可在此新增、重命名或删除年级（如"高一年级"、"高二年级"），年级是学科、考试、学生名单的归属维度。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>点击「新增年级」输入年级名称即可添加。</li>
            <li>点击年级右侧的「重命名」可修改名称。</li>
            <li>点击「删除」可移除空年级（已有考试/学生数据的年级建议先清理再删除）。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：年级名称需保持唯一；删除年级前请确认该年级下没有正在使用的考试或学生名单。</div>
      </div>`
  },
  permissions: {
    title: "权限管理",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>查看系统四种角色（管理员、教务老师、任课教师、班主任）的权限范围说明，了解各角色可访问的功能模块。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ul>
            <li>页面以表格形式列出每个角色可使用的功能。</li>
            <li>管理员拥有全部权限；教务老师负责成绩汇总；任课教师可查看自己班级的已上传成绩；班主任可管理本班成绩。</li>
          </ul>
        </div>
        <div class="help-note">💡 提示：如需调整某教师的角色，请到「教师名单管理」页面修改。</div>
      </div>`
  },
  exams: {
    title: "考试管理",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>创建、编辑、删除考试信息。每场考试归属于某个年级，包含考试名称、考试日期等，是成绩录入与分析的基础。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>点击「新增考试」，选择年级、填写考试名称（如"2025学年第一学期期中考试"）和考试日期。</li>
            <li>在考试列表中可编辑或删除已有考试。</li>
            <li>考试创建后，班主任和教务即可在「上传成绩」中选择该考试录入分数。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：已录入成绩的考试删除后，对应成绩也会被清除，请谨慎操作。</div>
      </div>`
  },
  subjects: {
    title: "学科 / 分值设置",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>教务老师为每个年级设置学科列表，包括学科名称、满分、优秀线、良好线、及格线、低分线，用于成绩统计与分析。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>选择年级后，下方显示该年级的学科列表。</li>
            <li>点击「新增学科」填写学科名称（如"语文"）和分值线（如满分 150、优秀 120、及格 90）。</li>
            <li>点击学科行的「编辑」可调整分值线，「删除」可移除学科。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：分值线决定成绩分析中的优秀率、良好率、及格率、低分率等统计口径，请按学校标准准确设置。</div>
      </div>`
  },
  academic_upload_scores: {
    title: "按班级名单上传全年级",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>教务端通过 Excel 按班级名单批量上传全年级成绩。支持多科上传、已上传成绩删除，上传后成绩直接生效，无需审核。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>选择目标考试和年级。</li>
            <li>点击科目按钮选择要上传的科目（可多选），或不上传指定科目则导入全部科目。</li>
            <li>下载 Excel 模板，按模板格式填写班级、姓名、各科分数。</li>
            <li>上传 Excel 文件，系统自动解析并预览。</li>
            <li>确认无误后点击「提交」，成绩直接生效。</li>
            <li>如需修改，可在下方「已上传成绩管理」中删除单条、按班级删除或清空全部。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：Excel 表头需与学科名称一致（支持拼音首字母、英文缩写等自动识别）；分数留空视为0分；跨文件同学生会自动合并分数。</div>
      </div>`
  },
  academic_upload_examroom: {
    title: "按考场名单上传全年级",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>教务端通过 Excel 按考场名单批量上传全年级成绩。系统自动从考号中解析考场号、座位号、班级和序号，自动识别科目列，支持批量上传不同科目的文件。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>选择目标考试。</li>
            <li>点击科目按钮选择要上传的科目（可多选），绿色表示已上传。</li>
            <li>下载 Excel 模板，按模板格式填写考号、姓名、科目分数。</li>
            <li>上传 Excel 文件，系统自动识别科目并解析考号。</li>
            <li>可一次上传多个不同科目的文件，系统自动合并跨文件学生分数。</li>
            <li>确认预览无误后点击「提交」，成绩直接生效。</li>
          </ol>
        </div>
        <div class="help-section">
          <h4>🔢 考号格式</h4>
          <p>考号为纯数字，后6位固定为：座位(2位) + 班级(2位) + 序号(2位)，前面为考场号。</p>
          <ul>
            <li>7位：<b>1020307</b> = 1考场02座，3班07位</li>
            <li>8位：<b>10031003</b> = 10考场03座，10班03位</li>
          </ul>
        </div>
        <div class="help-note">💡 提示：科目列支持自动识别（拼音首字母、英文缩写、模糊匹配、文件名推断）；跨文件同学生会自动合并分数而非覆盖。</div>
      </div>`
  },
  grade_summary: {
    title: "成绩汇总",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>按考试、年级、班级、学科等维度汇总成绩，展示均分、最高分、最低分、优秀率、良好率、及格率、低分率等统计指标。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>在顶部筛选条件中选择考试、年级、班级、学科。</li>
            <li>系统自动计算并展示统计表格与图表。</li>
            <li>可切换不同维度对比查看。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：统计基于所有已上传的成绩。</div>
      </div>`
  },
  class_ranking: {
    title: "排名统计",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>按考试生成班级排名或全年级排名，包含总分排名、单科排名，并支持按班级筛选查看。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>选择考试和年级。</li>
            <li>选择查看范围：全年级或指定班级。</li>
            <li>系统按总分降序生成排名表，可切换查看单科排名。</li>
            <li>支持导出 Excel 排名表。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：班主任只能查看本班排名；教务可查看全年级排名。</div>
      </div>`
  },
  teacher_ranking: {
    title: "教师排行榜",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>按考试、学科统计各任课教师所带班级的成绩表现，生成教师教学效果排行榜，便于教学评估。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>选择考试和年级。</li>
            <li>系统自动按学科分组，展示每位教师所带班级的均分、及格率、优秀率等指标。</li>
            <li>按均分或综合指标排序，查看教师排名。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：排行榜仅供参考，教学效果评估应结合多方因素综合考量。</div>
      </div>`
  },
  grade_notifications: {
    title: "全年组通知",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>教务/管理员可向指定年级发布通知弹窗，所有该年级用户登录后会看到醒目通知；任课教师和班主任可查看历史通知。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>点击「发布通知」，选择年级、填写标题、内容、级别（普通/重要/紧急）。</li>
            <li>发布后，该年级用户登录时自动弹出通知。</li>
            <li>在通知列表中可查看历史通知、删除已过期通知。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：用户关闭通知后不再弹出，但可在「全年组通知」菜单中随时查看历史。</div>
      </div>`
  },
  announcement: {
    title: "公告管理",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>管理员/教务发布平台公告，所有用户登录后会在顶部看到滚动播报；可管理历史公告。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>点击「发布公告」，输入标题和内容。</li>
            <li>公告发布后，所有用户顶部栏会滚动显示最新公告。</li>
            <li>在公告列表中可编辑、删除公告。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：公告数量较多时，建议定期清理过期公告，保持顶部播报简洁。</div>
      </div>`
  },
  announcements_all: {
    title: "公告管理",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>管理员/教务发布平台公告，所有用户登录后会在顶部看到滚动播报；可管理历史公告。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>点击「发布公告」，输入标题和内容。</li>
            <li>公告发布后，所有用户顶部栏会滚动显示最新公告。</li>
            <li>在公告列表中可编辑、删除公告。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：公告数量较多时，建议定期清理过期公告，保持顶部播报简洁。</div>
      </div>`
  },
  academic_analysis: {
    title: "全平台智能分析",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>教务端的全平台智能分析，自动识别成绩异常、学科短板、班级差距，提供数据洞察与改进建议。科目表现包含优秀率、良好率、及格率、低分率等指标，均基于教务端自定义分值线计算。内置智能助手支持自然语言问答。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>选择考试和年级。</li>
            <li>系统自动生成多维分析报告：学科对比、班级对比、分数段分布、问题学生预警等。</li>
            <li>可点击各分析卡片查看详细数据。</li>
            <li>支持导出分析报告。</li>
            <li>点击右下角智能助手图标，可用自然语言提问。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：分析基于已上传的成绩，若数据不完整可能影响分析准确性。所有统计指标基于教务端自定义的分值线计算。</div>
      </div>`
  },
  score_review: {
    title: "成绩审核",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>成绩审核功能已移除，上传成绩后直接生效，无需复审。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>成绩上传后自动生效，其他端同步后即可查看。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：如需上传成绩，请前往「按班级名单上传全年级」或「按考场名单上传全年级」页面。</div>
      </div>`
  },
  upload_scores: {
    title: "上传班级成绩",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>班主任上传本班某场考试的各科成绩，上传后成绩直接生效，无需审核。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>选择考试和自己所带班级。</li>
            <li>下载 Excel 模板，填写学生姓名及各科分数。</li>
            <li>上传 Excel，系统自动解析预览。</li>
            <li>确认后提交，成绩直接生效。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：分数留空视为0分；上传前请核对班级和学生姓名是否与名单一致。</div>
      </div>`
  },
  my_class_scores: {
    title: "本班考试成绩",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>班主任查看本班历次考试的成绩明细、统计汇总，了解本班学生表现。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>选择考试，查看本班所有学生的各科成绩。</li>
            <li>可按学科筛选、按分数排序。</li>
            <li>查看班级均分、及格率、优秀率等统计。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：显示本班所有已上传的成绩。</div>
      </div>`
  },
  download_scores: {
    title: "下载 Excel 成绩",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>班主任将本班考试成绩导出为 Excel 文件，便于存档、打印或线下分析。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>选择考试和班级。</li>
            <li>点击「下载 Excel」，浏览器自动下载文件。</li>
            <li>文件包含学生姓名、各科分数、总分、班级排名等信息。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：导出数据与平台显示一致，包含所有已上传成绩。</div>
      </div>`
  },
  headteacher_analysis: {
    title: "本班智能对比分析",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>班主任专用的本班成绩深度分析，对比本班与年级均分、识别优势学科与短板学科、追踪学生进退步情况。科目表现包含优秀率、良好率、及格率、低分率等指标。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>选择考试和班级。</li>
            <li>系统生成本班 vs 年级对比、学科强弱分析、学生进退步榜。</li>
            <li>点击各分析项查看详细数据。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：分析结果可帮助班主任针对性辅导，关注预警学生。所有统计指标基于教务端自定义的分值线计算。</div>
      </div>`
  },
  my_scores: {
    title: "我的班级成绩",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>任课教师查看自己任教的班级、学科的历次考试成绩，了解教学效果。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>选择考试，查看所任教班级的该学科成绩。</li>
            <li>可查看分数分布、均分、及格率等统计。</li>
            <li>支持多次考试对比，观察成绩变化趋势。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：显示任教班级所有已上传成绩；任教班级由管理员在教师信息中设置。</div>
      </div>`
  },
  my_ranking: {
    title: "我的排行信息",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>任课教师查看自己所带班级在年级中的学科排名，了解教学相对位置。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>选择考试和学科。</li>
            <li>查看所带班级在年级所有班级中的均分排名、及格率排名等。</li>
            <li>对比同年级其他班级的表现。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：排名仅供参考，教学评估应综合多维度数据。</div>
      </div>`
  },
  teacher_analysis: {
    title: "学科对比分析",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>任课教师对自己所教学科进行多维度分析，对比不同班级、不同考试的学科表现，发现教学问题。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>选择考试、学科、班级。</li>
            <li>系统生成分数段分布、题型分析、班级对比图。</li>
            <li>可切换不同考试查看趋势变化。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：分析可帮助教师针对性调整教学重点。</div>
      </div>`
  },
  exam_compare: {
    title: "多次考试对比分析",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>选择两场或多场考试进行对比，观察班级、学科、学生的成绩变化趋势，识别进退步情况。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>选择 2 场或以上考试。</li>
            <li>选择对比维度：班级、学科、学生。</li>
            <li>系统生成对比图表，展示均分变化、排名变化、进退步学生名单。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：对比分析适合在期中、期末后使用，评估教学效果与学生成长。</div>
      </div>`
  },
  group_manage: {
    title: "学习小组管理",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>班主任为本班学生划分学习小组，便于按小组开展成绩分析与互助学习。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>选择班级。</li>
            <li>点击「新建小组」，输入小组名称。</li>
            <li>将学生拖拽或选择加入对应小组。</li>
            <li>可调整小组成员、删除小组。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：分组后可在「小组成绩分析」中按组对比成绩。</div>
      </div>`
  },
  group_scores: {
    title: "小组成绩分析",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>按学习小组维度分析成绩，对比各小组均分、及格率，识别小组间差距与优秀小组。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>选择考试和班级。</li>
            <li>系统按小组分组展示成绩统计。</li>
            <li>可查看小组内学生明细、小组间对比图表。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：使用前请先在「学习小组管理」中完成分组。</div>
      </div>`
  },
  custom_analysis: {
    title: "自定义分析",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>任课教师可自定义分析维度和筛选条件，按需生成个性化成绩分析报表。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>选择考试、年级、班级、学科。</li>
            <li>设置筛选条件（如分数段、班级、学生范围）。</li>
            <li>选择统计指标（均分、及格率、优秀率等）。</li>
            <li>点击「生成分析」查看结果。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：自定义分析适合回答特定教学问题，如"本班数学 90 分以下学生的语文表现"。</div>
      </div>`
  },
  account_profile: {
    title: "修改我的密码",
    html: `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📋 功能说明</h4>
          <p>查看个人账号信息并修改登录密码，修改后密码自动同步到 Gist 云端，其他设备登录时使用新密码。</p>
        </div>
        <div class="help-section">
          <h4>🚀 使用方法</h4>
          <ol>
            <li>输入当前密码进行验证。</li>
            <li>输入新密码（至少 4 位）并确认。</li>
            <li>点击「保存新密码」，密码立即生效。</li>
            <li>若浏览器记住密码，本地缓存也会同步更新。</li>
          </ol>
        </div>
        <div class="help-note">💡 提示：建议定期更换密码，不要使用过于简单的密码（如 123456）。</div>
      </div>`
  },
};

// 显示当前页面的帮助弹窗
function showPageHelp() {
  const help = PAGE_HELPS[currentPage];
  if (!help) {
    showModal("使用帮助", `
      <div class="help-modal-body">
        <div class="help-section">
          <h4>📭 暂无专属帮助</h4>
          <p>当前页面暂未配置详细帮助说明。如需协助，请联系管理员或参考其他功能页面的帮助。</p>
        </div>
        <div class="help-note">💡 提示：点击顶部栏的「?」按钮可随时查看当前功能页面的使用帮助。</div>
      </div>`, "知道了");
    return;
  }
  showModal(`❓ ${help.title} · 使用帮助`, help.html, "我知道了");
}

// 绑定顶部栏帮助按钮
if ($("pageHelpBtn")) {
  $("pageHelpBtn").onclick = showPageHelp;
}

// ========== 平台概览 ==========
function renderDashboard() {
  const totalUsers = DB.users.length;
  const totalExams = DB.exams.length;
  const totalRecords = DB.records.length;
  const totalAnnouncements = DB.announcements.length;

  // 计算活跃数据（30天内）- 仅统计年级统一考试
  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const recentExams = DB.exams.filter(e => !e.isClassExam && (e.createdAt || 0) > now - thirtyDays).length;
  const recentRecords = DB.records.filter(r => (r.createdAt || 0) > now - thirtyDays).length;

  let statsCards = `
    <div class="dashboard-stats">
      <div class="dash-stat-card primary">
        <div class="dsc-icon">👥</div>
        <div class="dsc-content">
          <div class="dsc-value">${totalUsers}</div>
          <div class="dsc-label">教师总数</div>
        </div>
      </div>
      <div class="dash-stat-card success">
        <div class="dsc-icon">📝</div>
        <div class="dsc-content">
          <div class="dsc-value">${totalExams}</div>
          <div class="dsc-label">考试次数</div>
        </div>
      </div>
      <div class="dash-stat-card info">
        <div class="dsc-icon">📢</div>
        <div class="dsc-content">
          <div class="dsc-value">${totalAnnouncements}</div>
          <div class="dsc-label">公告数量</div>
        </div>
      </div>
    </div>
  `;

  let roleSection = "";

  if (currentUser.role === "admin") {
    // ===== 管理员：快速入口 =====
    const grades = Object.keys(DB.subjects);
    const gradeCount = grades.length;
    const teacherCount = DB.users.filter(u => u.role !== "admin").length;
    const examCount = DB.exams.filter(e => !e.isClassExam).length;

    roleSection = `
      <div class="admin-quick-grid">
        <div class="aq-card" onclick="navigate('users')" style="--aq-color:#3b82f6;--aq-color2:#60a5fa">
          <div class="aq-icon">👥</div>
          <div class="aq-title">教师名单管理</div>
          <div class="aq-desc">管理年组、添加教师、批量导入导出</div>
          <div class="aq-stat">${teacherCount} 位教师 · ${gradeCount} 个年组</div>
          <div class="aq-go">进入 →</div>
        </div>
      </div>
    `;

  } else if (currentUser.role === "academic") {
    // ===== 教务老师 =====
    const grade = currentUser.grade;
    const gradeExams = DB.exams.filter(e => e.grade === grade && !e.isClassExam);
    const gradeRecords = DB.records.filter(r => r.grade === grade);
    const gradeSubjects = (DB.subjects[grade] || []).length;
    const teachers = DB.users.filter(u => u.grade === grade && u.role !== "admin").length;

    // 最近的考试数据
    const recentExam = gradeExams.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
    let examStats = { avg: "-", records: 0 };
    if (recentExam) {
      const recs = gradeRecords.filter(r => r.examId === recentExam.id);
      examStats.records = recs.length;
      if (recs.length > 0) {
        const avgs = recs.map(r => {
          const vs = Object.values(r.scores || {}).filter(v => v != null);
          return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
        }).filter(v => v != null);
        examStats.avg = avgs.length ? fmt(avgs.reduce((a, b) => a + b, 0) / avgs.length) : "-";
      }
    }

    roleSection = `
      <div class="admin-quick-grid">
        <div class="aq-card" onclick="navigate('exams')" style="--aq-color:#8b5cf6;--aq-color2:#a78bfa">
          <div class="aq-icon">📝</div>
          <div class="aq-title">考试管理</div>
          <div class="aq-desc">新建考试、设置科目分值</div>
          <div class="aq-go">进入 →</div>
        </div>
        <div class="aq-card" onclick="navigate('academic_upload_scores')" style="--aq-color:#f59e0b;--aq-color2:#fbbf24">
          <div class="aq-icon">📥</div>
          <div class="aq-title">按班级名单上传全年级</div>
          <div class="aq-desc">上传各班成绩Excel</div>
          <div class="aq-go">进入 →</div>
        </div>
        <div class="aq-card" onclick="navigate('academic_upload_examroom')" style="--aq-color:#ea580c;--aq-color2:#fb923c">
          <div class="aq-icon">📂</div>
          <div class="aq-title">按考场名单上传全年级</div>
          <div class="aq-desc">自动识别科目，支持批量上传</div>
          <div class="aq-go">进入 →</div>
        </div>
        <div class="aq-card" onclick="navigate('class_ranking')" style="--aq-color:#10b981;--aq-color2:#34d399">
          <div class="aq-icon">🏆</div>
          <div class="aq-title">全年级排名</div>
          <div class="aq-desc">查看各班排名统计</div>
          <div class="aq-go">进入 →</div>
        </div>
        <div class="aq-card" onclick="navigate('teacher_ranking')" style="--aq-color:#ec4899;--aq-color2:#f472b6">
          <div class="aq-icon">🎖️</div>
          <div class="aq-title">教师排行榜</div>
          <div class="aq-desc">各学科教师教学成绩排名</div>
          <div class="aq-go">进入 →</div>
        </div>
        <div class="aq-card" onclick="navigate('academic_analysis')" style="--aq-color:#3b82f6;--aq-color2:#60a5fa">
          <div class="aq-icon">🔍</div>
          <div class="aq-title">全平台智能分析</div>
          <div class="aq-desc">AI智能分析年级成绩</div>
          <div class="aq-go">进入 →</div>
        </div>
        <div class="aq-card" onclick="navigate('exam_compare')" style="--aq-color:#06b6d4;--aq-color2:#67e8f9">
          <div class="aq-icon">🔄</div>
          <div class="aq-title">多次考试对比</div>
          <div class="aq-desc">对比多次考试成绩趋势</div>
          <div class="aq-go">进入 →</div>
        </div>
        <div class="aq-card" onclick="navigate('users')" style="--aq-color:#d46b08;--aq-color2:#fa8c16">
          <div class="aq-icon">👩‍🏫</div>
          <div class="aq-title">教师名单</div>
          <div class="aq-desc">查看本年级教师信息</div>
          <div class="aq-go">进入 →</div>
        </div>
      </div>
    `;
  } else if (currentUser.role === "headteacher") {
    // ===== 班主任 =====
    const grade = currentUser.grade;
    const classNo = currentUser.classNo;
    const mySubjects = currentUser.subjects || [];

    roleSection = `
      <div class="admin-quick-grid">
        <div class="aq-card" onclick="navigate('class_exams')" style="--aq-color:#3b82f6;--aq-color2:#60a5fa">
          <div class="aq-icon">📝</div>
          <div class="aq-title">班级考试管理</div>
          <div class="aq-desc">创建考试、设置科目分值</div>
          <div class="aq-go">进入 →</div>
        </div>
        <div class="aq-card" onclick="navigate('upload_scores')" style="--aq-color:#10b981;--aq-color2:#34d399">
          <div class="aq-icon">📥</div>
          <div class="aq-title">上传班级成绩</div>
          <div class="aq-desc">上传本班学生成绩Excel</div>
          <div class="aq-go">进入 →</div>
        </div>
        <div class="aq-card" onclick="navigate('my_class_scores')" style="--aq-color:#8b5cf6;--aq-color2:#a78bfa">
          <div class="aq-icon">📖</div>
          <div class="aq-title">本班考试成绩</div>
          <div class="aq-desc">查看本班学生历次成绩</div>
          <div class="aq-go">进入 →</div>
        </div>
        <div class="aq-card" onclick="navigate('class_ranking')" style="--aq-color:#f59e0b;--aq-color2:#fbbf24">
          <div class="aq-icon">🏆</div>
          <div class="aq-title">本班排名统计</div>
          <div class="aq-desc">查看本班学生排名情况</div>
          <div class="aq-go">进入 →</div>
        </div>
        <div class="aq-card" onclick="navigate('download_scores')" style="--aq-color:#06b6d4;--aq-color2:#67e8f9">
          <div class="aq-icon">📤</div>
          <div class="aq-title">下载Excel成绩单</div>
          <div class="aq-desc">导出班级成绩到Excel</div>
          <div class="aq-go">进入 →</div>
        </div>
        <div class="aq-card" onclick="navigate('headteacher_analysis')" style="--aq-color:#ef4444;--aq-color2:#f87171">
          <div class="aq-icon">🔍</div>
          <div class="aq-title">智能对比分析</div>
          <div class="aq-desc">AI分析班级成绩、对比年级数据</div>
          <div class="aq-go">进入 →</div>
        </div>
        <div class="aq-card" onclick="navigate('teacher_analysis')" style="--aq-color:#ec4899;--aq-color2:#f472b6">
          <div class="aq-icon">📈</div>
          <div class="aq-title">学科对比分析</div>
          <div class="aq-desc">对比不同班级同一学科成绩</div>
          <div class="aq-go">进入 →</div>
        </div>
        <div class="aq-card" onclick="navigate('group_manage')" style="--aq-color:#6366f1;--aq-color2:#818cf8">
          <div class="aq-icon">👥</div>
          <div class="aq-title">学习小组管理</div>
          <div class="aq-desc">管理班级学习小组</div>
          <div class="aq-go">进入 →</div>
        </div>
      </div>
    `;
  } else {
    // ===== 任课教师 =====
    const grade = currentUser.grade;
    const mySubjects = currentUser.subjects || [];

    roleSection = `
      <div class="admin-quick-grid">
        <div class="aq-card" onclick="navigate('my_ranking')" style="--aq-color:#10b981;--aq-color2:#34d399">
          <div class="aq-icon">🏆</div>
          <div class="aq-title">我的任教排行</div>
          <div class="aq-desc">查看任教科目的班级排名</div>
          <div class="aq-go">进入 →</div>
        </div>
        <div class="aq-card" onclick="navigate('teacher_analysis')" style="--aq-color:#8b5cf6;--aq-color2:#a78bfa">
          <div class="aq-icon">🔍</div>
          <div class="aq-title">学科对比分析</div>
          <div class="aq-desc">AI分析任教科目成绩</div>
          <div class="aq-go">进入 →</div>
        </div>
        <div class="aq-card" onclick="navigate('exam_compare')" style="--aq-color:#06b6d4;--aq-color2:#67e8f9">
          <div class="aq-icon">🔄</div>
          <div class="aq-title">多次考试对比</div>
          <div class="aq-desc">对比多次考试成绩趋势</div>
          <div class="aq-go">进入 →</div>
        </div>
        <div class="aq-card" onclick="navigate('group_scores')" style="--aq-color:#6366f1;--aq-color2:#818cf8">
          <div class="aq-icon">👥</div>
          <div class="aq-title">小组成绩分析</div>
          <div class="aq-desc">查看学习小组成绩</div>
          <div class="aq-go">进入 →</div>
        </div>
      </div>
    `;
  }

  // 最近公告
  const recentAnn = DB.announcements.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const annHtml = recentAnn.length === 0
    ? `<div class="empty-state"><div class="es-icon">📭</div><div class="es-title">暂无公告</div></div>`
    : recentAnn.map((a) => `
      <div class="ann-item">
        <div class="ann-title">${a.title}</div>
        <div class="ann-content">${a.content}</div>
        <div class="ann-meta"><span>${a.createdBy}</span> · <span>${new Date(a.createdAt).toLocaleString()}</span></div>
      </div>
    `).join("");

  $("pageContent").innerHTML = `
    <div class="dashboard-welcome">
      <div class="dw-content">
        <h1 class="dw-title">欢迎回来，${currentUser.name}！</h1>
        <p class="dw-subtitle">${getRoleWelcome(currentUser.role)}${currentUser.grade ? " · " + currentUser.grade : ""}</p>
      </div>
      <div class="dw-icon">🎓</div>
    </div>

    ${roleSection}
  `;
}

function getRoleWelcome(role) {
  const welcomes = {
    admin: "系统管理员",
    academic: "教务老师",
    headteacher: "班主任",
    teacher: "任课教师"
  };
  return welcomes[role] || "用户";
}

// ========== 管理员/教务：教师名单 ==========
function renderUsers() {
  if (currentUser.role !== "admin" && currentUser.role !== "academic") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }

  // 教务端：按科目分类的只读视图
  if (currentUser.role === "academic") {
    renderUsersAcademicView();
    return;
  }

  // 管理员端：年组卡片 → 学科分组人员
  const allUsers = DB.users.filter((u) => u.role !== "admin");

  // 视图状态：未选年级时显示年组卡片，选了年级后显示该年级学科分组
  if (!window._adminTeacherGrade) {
    renderAdminGradeCards(allUsers);
  } else {
    renderAdminGradeDetail(allUsers, window._adminTeacherGrade);
  }
}

// 第一层：年组卡片展示
function renderAdminGradeCards(allUsers) {
  const teachers = allUsers.filter((u) => u.role === "teacher");
  const headteachers = allUsers.filter((u) => u.role === "headteacher");
  const academics = allUsers.filter((u) => u.role === "academic");

  // 按年级分组
  const gradeGroups = {};
  allUsers.forEach(u => {
    const g = u.grade || "未分年级";
    if (!gradeGroups[g]) gradeGroups[g] = [];
    gradeGroups[g].push(u);
  });
  const sortedGrades = Object.keys(gradeGroups).sort();

  // 每个年级不同主题色
  const themes = [
    { bg: "linear-gradient(135deg, #667eea, #764ba2)", chip: "rgba(255,255,255,0.25)", text: "#fff" },
    { bg: "linear-gradient(135deg, #f093fb, #f5576c)", chip: "rgba(255,255,255,0.25)", text: "#fff" },
    { bg: "linear-gradient(135deg, #4facfe, #00f2fe)", chip: "rgba(255,255,255,0.25)", text: "#fff" },
    { bg: "linear-gradient(135deg, #43e97b, #38f9d7)", chip: "rgba(255,255,255,0.25)", text: "#fff" },
    { bg: "linear-gradient(135deg, #fa709a, #fee140)", chip: "rgba(255,255,255,0.25)", text: "#fff" },
    { bg: "linear-gradient(135deg, #a18cd1, #fbc2eb)", chip: "rgba(255,255,255,0.25)", text: "#fff" },
    { bg: "linear-gradient(135deg, #ffecd2, #fcb69f)", chip: "rgba(255,255,255,0.3)", text: "#5a3a2a" },
  ];

  const gradeCards = sortedGrades.map((grade, i) => {
    const list = gradeGroups[grade];
    const theme = themes[i % themes.length];
    const gHeads = list.filter(u => u.role === "headteacher").length;
    const gTeachers = list.filter(u => u.role === "teacher").length;
    const gAcademics = list.filter(u => u.role === "academic").length;
    // 统计学科
    const subjSet = new Set();
    list.forEach(u => { (u.subjects || []).forEach(s => subjSet.add(s)); });

    return `
      <div class="grade-card" style="--card-bg:${theme.bg};--card-text:${theme.text};--chip-bg:${theme.chip}" onclick="enterAdminGrade('${esc(grade)}')">
        <div class="gc-header">
          <span class="gc-icon">🏫</span>
          <span class="gc-name">${esc(grade)}</span>
        </div>
        <div class="gc-total">
          <span class="gc-num">${list.length}</span>
          <span class="gc-unit">位教师</span>
        </div>
        <div class="gc-stats">
          ${gHeads > 0 ? `<span class="gc-chip">班主任 ${gHeads}</span>` : ""}
          ${gTeachers > 0 ? `<span class="gc-chip">任课 ${gTeachers}</span>` : ""}
          ${gAcademics > 0 ? `<span class="gc-chip">教务 ${gAcademics}</span>` : ""}
        </div>
        <div class="gc-subjects">${subjSet.size > 0 ? `${subjSet.size} 个学科` : ""}</div>
        <div class="gc-enter">点击查看详情 →</div>
      </div>
    `;
  }).join("");

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">
        <span>👥 教师名单管理（共 ${allUsers.length} 人）</span>
        <span class="ct-actions">
          <button class="btn btn-info" onclick="exportTeacherExcel()">📥 批量导出</button>
          <button class="btn btn-primary" onclick="downloadTeacherTemplate()">📥 下载模板</button>
          <button class="btn btn-warning" onclick="showBatchUploadModal()">📤 批量导入</button>
          <button class="btn btn-success" onclick="editUser(null)">+ 添加教师</button>
          <button class="btn btn-primary" onclick="addGradeFromUsers()">🏫 创建年组</button>
        </span>
      </div>
      <div style="margin-bottom:16px;font-size:13px;color:var(--text-light)">
        共 ${sortedGrades.length} 个年级 · 班主任 ${headteachers.length} 人 · 任课教师 ${teachers.length} 人 · 教务老师 ${academics.length} 人
      </div>
      <div class="grade-cards-grid">
        ${gradeCards || `<div class="empty-state"><div class="es-tip">暂无年组，请先点击右上角「🏫 创建年组」</div></div>`}
      </div>
    </div>
    <style>
      .grade-cards-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 18px;
      }
      .grade-card {
        background: var(--card-bg);
        color: var(--card-text);
        border-radius: 16px;
        padding: 22px 20px;
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;
        display: flex; flex-direction: column; gap: 12px;
        position: relative; overflow: hidden;
      }
      .grade-card::after {
        content: ""; position: absolute; right: -20px; top: -20px;
        width: 80px; height: 80px; border-radius: 50%;
        background: rgba(255,255,255,0.1);
      }
      .grade-card:hover {
        transform: translateY(-4px) scale(1.02);
        box-shadow: 0 8px 28px rgba(0,0,0,0.18);
      }
      .gc-header { display: flex; align-items: center; gap: 8px; }
      .gc-icon { font-size: 24px; }
      .gc-name { font-size: 18px; font-weight: 700; }
      .gc-total { display: flex; align-items: baseline; gap: 4px; }
      .gc-num { font-size: 36px; font-weight: 800; line-height: 1; }
      .gc-unit { font-size: 13px; opacity: 0.8; }
      .gc-stats { display: flex; flex-wrap: wrap; gap: 6px; }
      .gc-chip {
        font-size: 11px; padding: 3px 10px; border-radius: 12px;
        background: var(--chip-bg); font-weight: 500;
      }
      .gc-subjects { font-size: 12px; opacity: 0.7; }
      .gc-enter {
        font-size: 12px; opacity: 0.6;
        border-top: 1px solid rgba(255,255,255,0.2);
        padding-top: 10px; margin-top: 4px;
      }
    </style>
  `;
}

// 第二层：年级详情 — 按学科分组展示教师
function renderAdminGradeDetail(allUsers, gradeName) {
  const gradeUsers = allUsers.filter(u => (u.grade || "未分年级") === gradeName);

  // 按学科分组
  const subjectGroups = {};
  gradeUsers.forEach(u => {
    const subjects = (u.subjects && u.subjects.length) ? u.subjects : ["未设置学科"];
    subjects.forEach(subj => {
      if (!subjectGroups[subj]) subjectGroups[subj] = [];
      subjectGroups[subj].push(u);
    });
  });
  const sortedSubjects = Object.keys(subjectGroups).sort();

  const subjColors = [
    { bg: "#e8f4fd", border: "#bae0ff", head: "#1890ff" },
    { bg: "#f6ffed", border: "#d9f7be", head: "#52c41a" },
    { bg: "#fff7e6", border: "#ffe7ba", head: "#d46b08" },
    { bg: "#fff0f6", border: "#ffd6e7", head: "#c41d7f" },
    { bg: "#f9f0ff", border: "#efdbff", head: "#722ed1" },
    { bg: "#e6fffb", border: "#b5f5ec", head: "#13c2c2" },
    { bg: "#fcffe6", border: "#eaff8f", head: "#a0d911" },
  ];

  const subjSections = sortedSubjects.map((subj, i) => {
    const list = subjectGroups[subj];
    const sc = subjColors[i % subjColors.length];

    const cards = list.map(u => {
      const allClasses = u.classNo
        ? String(u.classNo).split(/[,，]/).map(s => s.trim()).filter(Boolean)
        : [];
      let classHtml = "";
      if (u.role === "headteacher") {
        const headClass = allClasses[0] || "-";
        const teachClasses = allClasses.length > 1 ? allClasses.slice(1) : [headClass];
        classHtml = `
          <div class="td-info"><span class="td-label td-label-head">班主任</span><span class="td-value td-value-head">${esc(headClass)}</span></div>
          <div class="td-info"><span class="td-label">任教</span><span class="td-value">${esc(teachClasses.join("、"))}</span></div>
        `;
      } else if (u.role === "teacher") {
        const classText = allClasses.length === 0 ? "全年级" : allClasses.join("、");
        classHtml = `<div class="td-info"><span class="td-label">任教</span><span class="td-value">${esc(classText)}</span></div>`;
      }

      const roleBadge = u.role === "headteacher"
        ? '<span class="td-badge td-badge-head">班主任</span>'
        : u.role === "teacher"
        ? '<span class="td-badge td-badge-teacher">任课</span>'
        : '<span class="td-badge td-badge-academic">教务</span>';

      return `
        <div class="td-card ${u.role === 'headteacher' ? 'td-card-head' : ''}">
          <div class="td-card-top">
            <span class="td-name">${esc(u.name)}</span>
            ${roleBadge}
          </div>
          <div class="td-card-mid">
            ${classHtml}
            <div class="td-info"><span class="td-label">账号</span><span class="td-value">@${esc(u.username)}</span></div>
          </div>
          <div class="td-card-btns">
            <button class="btn btn-sm btn-info" onclick="editUser('${esc(u.id)}')">✏️ 编辑</button>
            <button class="btn btn-sm btn-warning" onclick="resetPwd('${esc(u.id)}')">🔑 重置</button>
            <button class="btn btn-sm btn-danger" onclick="delUser('${esc(u.id)}')">🗑 删除</button>
          </div>
        </div>
      `;
    }).join("");

    return `
      <div class="subj-section" style="--sc-bg:${sc.bg};--sc-border:${sc.border};--sc-head:${sc.head}">
        <div class="subj-section-header">
          <span class="ssh-icon">📚</span>
          <span class="ssh-name">${esc(subj)}</span>
          <span class="ssh-count">${list.length} 人</span>
        </div>
        <div class="subj-section-cards">${cards}</div>
      </div>
    `;
  }).join("");

  const headCount = gradeUsers.filter(u => u.role === "headteacher").length;
  const teacherCount = gradeUsers.filter(u => u.role === "teacher").length;
  const academicCount = gradeUsers.filter(u => u.role === "academic").length;

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">
        <span>
          <button class="btn btn-sm btn-light" onclick="exitAdminGrade()" style="margin-right:10px">← 返回年组</button>
          🏫 ${esc(gradeName)}（共 ${gradeUsers.length} 人）
        </span>
        <span class="ct-actions">
          <button class="btn btn-success" onclick="editUser(null)">+ 添加教师</button>
        </span>
      </div>
      <div style="margin-bottom:16px;font-size:13px;color:var(--text-light)">
        共 ${sortedSubjects.length} 个学科 · 班主任 ${headCount} 人 · 任课教师 ${teacherCount} 人 · 教务老师 ${academicCount} 人
      </div>
      ${subjSections || `<div class="empty-state"><div class="es-tip">该年级暂无教师</div></div>`}
    </div>
    <style>
      .subj-section {
        background: var(--sc-bg);
        border: 1px solid var(--sc-border);
        border-radius: 14px;
        padding: 16px 18px;
        margin-bottom: 18px;
      }
      .subj-section-header {
        display: flex; align-items: center; gap: 8px;
        padding-bottom: 12px; margin-bottom: 14px;
        border-bottom: 2px solid var(--sc-border);
      }
      .ssh-icon { font-size: 20px; }
      .ssh-name { font-size: 17px; font-weight: 700; color: var(--sc-head); }
      .ssh-count {
        font-size: 12px; font-weight: 600; color: var(--sc-head);
        background: #fff; padding: 3px 12px; border-radius: 10px;
      }
      .subj-section-cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 12px;
      }
      .td-card {
        background: #fff; border: 1px solid #e8ecf5; border-radius: 10px;
        padding: 12px 14px; display: flex; flex-direction: column; gap: 8px;
        transition: box-shadow 0.2s, transform 0.15s;
      }
      .td-card:hover { box-shadow: 0 4px 14px rgba(0,0,0,0.1); transform: translateY(-2px); }
      .td-card.td-card-head { background: #fffbf2; border-color: #ffe7ba; }
      .td-card-top { display: flex; justify-content: space-between; align-items: center; }
      .td-name { font-size: 15px; font-weight: 600; color: #1a1a2e; }
      .td-badge { font-size: 10px; padding: 2px 8px; border-radius: 8px; font-weight: 500; }
      .td-badge-head { background: #fff7e6; color: #d46b08; }
      .td-badge-teacher { background: #e6f7ff; color: #1890ff; }
      .td-badge-academic { background: #f6ffed; color: #52c41a; }
      .td-card-mid { display: flex; flex-direction: column; gap: 4px; }
      .td-info { display: flex; align-items: center; gap: 8px; font-size: 12px; }
      .td-label { color: #888; min-width: 38px; }
      .td-label-head { color: #d46b08; font-weight: 500; }
      .td-value { color: #333; flex: 1; }
      .td-value-head { color: #d46b08; font-weight: 500; }
      .td-card-btns {
        display: flex; gap: 5px; padding-top: 8px; border-top: 1px solid #f0f2f7;
      }
      .td-card-btns .btn-sm { font-size: 11px; padding: 3px 8px; }
    </style>
  `;
}

// 进入年级详情
window.enterAdminGrade = function(grade) {
  window._adminTeacherGrade = grade;
  renderUsers();
};

// 返回年组卡片
window.exitAdminGrade = function() {
  window._adminTeacherGrade = null;
  renderUsers();
};

// 从教师名单页面创建年组
window.addGradeFromUsers = function () {
  const existingGrades = Object.keys(DB.subjects);
  showModal("🏫 创建年组", `
    <div class="form-group">
      <label>年组名称</label>
      <input id="m_new_grade" placeholder="如 高一年级、高二年级" />
    </div>
    ${existingGrades.length > 0 ? `
    <div style="margin-top:12px;padding:12px;background:#f5f7fa;border-radius:8px;font-size:13px;color:#666">
      <b>已有年组：</b>${existingGrades.map(g => `<span style="display:inline-block;margin:2px 4px;padding:2px 10px;background:#eef2ff;border-radius:8px;color:#5b6ee1">${esc(g)}</span>`).join("")}
    </div>` : ""}
    <div style="margin-top:12px;font-size:13px;color:#999">
      💡 创建年组后，即可在该年组下添加教师、设置学科和考试。
    </div>
  `, "创建", async () => {
    const g = $("m_new_grade").value.trim();
    if (!g) { showToast("请输入年组名称", "error"); return false; }
    if (DB.subjects[g]) { showToast("该年组已存在", "error"); return false; }
    DB.subjects[g] = [];
    const syncResult = await saveDB(DB);
    if (syncResult === true) {
      showToast(`✅ 年组「${g}」已创建`, "success");
    } else {
      showToast(`✅ 年组「${g}」已创建（云端同步失败）`, "warning");
    }
    renderUsers();
  });
};

// 教务端教师名单视图：按科目分类，只读
function renderUsersAcademicView() {
  const myGrade = currentUser.grade;
  if (!myGrade) {
    $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">未设置所属年级</div></div>`;
    return;
  }

  // 获取本年级所有教师（任课教师+班主任，因为班主任也有任教学科）
  const gradeTeachers = DB.users.filter(u => u.grade === myGrade && (u.role === "teacher" || u.role === "headteacher"));

  // 按学科分组
  const subjectGroups = {};
  gradeTeachers.forEach(u => {
    const subjects = u.subjects && u.subjects.length ? u.subjects : ["未设置学科"];
    subjects.forEach(subj => {
      if (!subjectGroups[subj]) subjectGroups[subj] = [];
      subjectGroups[subj].push(u);
    });
  });

  // 按学科名称排序
  const sortedSubjects = Object.keys(subjectGroups).sort();
  const totalTeachers = gradeTeachers.length;

  let subjectHtml = sortedSubjects.map(subj => {
    const teachers = subjectGroups[subj];
    const teacherList = teachers.map(u => {
      const isHead = u.role === "headteacher";
      const allClasses = u.classNo
        ? String(u.classNo).split(/[,，]/).map(s => s.trim()).filter(Boolean)
        : [];
      
      let classHtml = "";
      if (isHead) {
        const headClass = allClasses[0] || "-";
        const teachClasses = allClasses.length > 1 ? allClasses.slice(1) : [headClass];
        classHtml = `
          <div class="teacher-class-row">
            <span class="class-label head-label">班主任</span>
            <span class="class-value head-value">${esc(headClass)}</span>
          </div>
          <div class="teacher-class-row">
            <span class="class-label">任教</span>
            <span class="class-value">${esc(teachClasses.join("、"))}</span>
          </div>
        `;
      } else {
        const classText = allClasses.length === 0 ? "全年级" : allClasses.join("、");
        classHtml = `
          <div class="teacher-class-row">
            <span class="class-label">任教</span>
            <span class="class-value">${esc(classText)}</span>
          </div>
        `;
      }
      
      const headBadge = isHead ? '<span class="badge head-badge">班主任</span>' : '';
      return `
        <div class="teacher-item ${isHead ? 'teacher-item-head' : ''}">
          <div class="teacher-name-row">
            <span class="teacher-name">${esc(u.name)}</span>
            ${headBadge}
          </div>
          <div class="teacher-classes">${classHtml}</div>
        </div>
      `;
    }).join("");
    return `
      <div class="subject-group">
        <div class="subject-header">
          <span class="subject-icon">📚</span>
          <span class="subject-name">${esc(subj)}</span>
          <span class="subject-count">${teachers.length} 位教师</span>
        </div>
        <div class="teacher-list">${teacherList}</div>
      </div>
    `;
  }).join("");

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">
        <span>👩‍🏫 ${myGrade} 教师名单（共 ${totalTeachers} 人）</span>
        <span class="ct-actions">
          <span style="font-size:13px;color:var(--text-light);">共 ${sortedSubjects.length} 个学科</span>
        </span>
      </div>
      <div class="subjects-grid">
        ${subjectHtml || `<div class="empty-state"><div class="es-tip">暂无教师数据</div></div>`}
      </div>
    </div>
    <style>
      .subjects-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
        gap: 16px;
        margin-top: 8px;
      }
      .subject-group {
        background: #fafbff;
        border: 1px solid #e8ecf5;
        border-radius: 10px;
        padding: 16px 18px;
      }
      .subject-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-bottom: 12px;
        border-bottom: 1px solid #eaeef7;
        margin-bottom: 12px;
      }
      .subject-icon { font-size: 20px; }
      .subject-name {
        font-size: 16px;
        font-weight: 600;
        color: #1a1a2e;
        flex: 1;
      }
      .subject-count {
        font-size: 12px;
        color: #667;
        background: #eef2ff;
        padding: 3px 10px;
        border-radius: 10px;
      }
      .teacher-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .teacher-item {
        padding: 10px 14px;
        background: #fff;
        border-radius: 8px;
        border: 1px solid #f0f2f7;
      }
      .teacher-item.teacher-item-head {
        background: #fffbf2;
        border-color: #ffe7ba;
      }
      .teacher-name-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
      }
      .teacher-name {
        font-size: 14px;
        font-weight: 600;
        color: #1a1a2e;
      }
      .head-badge {
        background: #fff7e6;
        color: #d46b08;
        font-size: 11px;
        padding: 1px 8px;
        border-radius: 10px;
        font-weight: 500;
      }
      .teacher-classes {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .teacher-class-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
      }
      .class-label {
        color: #888;
        min-width: 42px;
      }
      .class-label.head-label {
        color: #d46b08;
        font-weight: 500;
      }
      .class-value {
        color: #333;
        flex: 1;
      }
      .class-value.head-value {
        color: #d46b08;
        font-weight: 500;
      }
    </style>
  `;
}

// 下载教师批量上传模板
window.downloadTeacherTemplate = function () {
  const data = [
    ["账号", "姓名", "角色", "所属年级", "班主任班级", "任教班级", "任教学科"],
    ["zhangsan", "张三", "班主任", "高一年级", "1班", "2班,3班", "语文"],
    ["lisi", "李四", "任课教师", "高一年级", "", "1班,2班,3班", "数学,物理"],
    ["wangwu", "王五", "教务老师", "高一年级", "", "", ""]
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [{ wch: 15 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws, "教师名单");
  XLSX.writeFile(wb, "教师批量上传模板.xlsx");
  showToast("模板已下载", "success");
};

// 批量导出教师名单
window.exportTeacherExcel = function () {
  const myGrade = currentUser.role === "academic" ? currentUser.grade : null;
  const allUsers = myGrade
    ? DB.users.filter((u) => u.role !== "admin" && u.grade === myGrade)
    : DB.users.filter((u) => u.role !== "admin");
  const roleNameMap = { "headteacher": "班主任", "teacher": "任课教师", "academic": "教务老师" };
  const data = [
    ["账号", "姓名", "角色", "所属年级", "班主任班级", "任教班级", "任教学科", "加入时间"],
    ...allUsers.map((u) => {
      let headClass = "";
      let teachClasses = "";
      if (u.classNo) {
        const classes = String(u.classNo).split(/[,，]/).map(s => s.trim()).filter(Boolean);
        if (u.role === "headteacher") {
          headClass = classes[0] || "";
          teachClasses = classes.slice(1).join(",");
        } else if (u.role === "teacher") {
          teachClasses = classes.join(",");
        }
      }
      return [
        u.username,
        u.name,
        roleNameMap[u.role] || u.role,
        u.grade || "",
        headClass,
        teachClasses,
        (u.subjects && u.subjects.length) ? u.subjects.join(",") : "",
        new Date(u.createdAt).toLocaleDateString()
      ];
    })
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [{ wch: 15 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 20 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws, "教师名单");
  const dateStr = new Date().toLocaleDateString().replace(/\//g, "-");
  XLSX.writeFile(wb, `教师名单_${dateStr}.xlsx`);
  showToast(`已导出 ${allUsers.length} 名教师`, "success");
};

// 批量上传教师弹窗
window.showBatchUploadModal = function () {
  showModal("📤 批量上传教师", `
    <div style="margin-bottom:16px;padding:16px;background:#f0f7ff;border-radius:8px;font-size:13px">
      <p style="margin-bottom:8px"><b>📋 Excel 格式要求：</b></p>
      <p style="color:#666">• 第一行为表头：账号、姓名、角色、所属年级、班主任班级、任教班级、任教学科</p>
      <p style="color:#666">• 角色可选：<b>班主任</b>、<b>任课教师</b>、<b>教务老师</b></p>
      <p style="color:#666">• 班主任班级：仅班主任需要填写，如 1班</p>
      <p style="color:#666">• 任教班级：多班用逗号分隔，如 1班,2班,3班；不填则教全年级</p>
      <p style="color:#666">• 任教学科：多个用逗号分隔，如 数学,物理</p>
      <p style="color:#666">• 默认密码：<b>123456</b></p>
    </div>
    <div class="form-group">
      <label>选择 Excel 文件</label>
      <input type="file" id="batch_teacher_file" accept=".xlsx,.xls,.csv" style="padding:8px" />
    </div>
  `, "开始上传", async () => {
    const fileInput = $("batch_teacher_file");
    if (!fileInput.files[0]) { showToast("请选择文件", "error"); return false; }
    const file = fileInput.files[0];
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        if (json.length < 2) { showToast("文件内容为空或格式不正确", "error"); return false; }
        const headers = json[0].map((h) => String(h || "").trim());
        const requiredCols = ["账号", "姓名", "角色"];
        const missing = requiredCols.filter((c) => !headers.includes(c));
        if (missing.length > 0) { showToast(`缺少必填列：${missing.join("、")}`, "error"); return false; }
        const idx = (name) => headers.indexOf(name);
        const roleMap = { "班主任": "headteacher", "任课教师": "teacher", "教务老师": "academic" };
        const grades = Object.keys(DB.subjects);
        let added = 0, skipped = 0, errors = [];
        const hasHeadClassCol = headers.includes("班主任班级");
        const hasTeachClassCol = headers.includes("任教班级");
        const hasOldClassCol = headers.includes("班级");

        for (let i = 1; i < json.length; i++) {
          const row = json[i];
          if (!row[idx("账号")] || !row[idx("姓名")] || !row[idx("角色")]) { skipped++; continue; }
          const username = String(row[idx("账号")] || "").trim();
          const name = String(row[idx("姓名")] || "").trim();
          const roleKey = String(row[idx("角色")] || "").trim();
          const role = roleMap[roleKey];
          if (!role) { errors.push(`第${i + 1}行：角色"${roleKey}"不正确`); skipped++; continue; }
          const grade = String(row[idx("所属年级")] || "").trim();
          const subjectsStr = String(row[idx("任教学科")] || "").trim();
          const subjects = subjectsStr ? subjectsStr.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [];

          let classNo = "";
          if (hasHeadClassCol || hasTeachClassCol) {
            const headClass = hasHeadClassCol ? String(row[idx("班主任班级")] || "").trim() : "";
            const teachClasses = hasTeachClassCol ? String(row[idx("任教班级")] || "").trim() : "";
            if (role === "headteacher") {
              if (!headClass) { errors.push(`第${i + 1}行：班主任需要填写班主任班级`); skipped++; continue; }
              const allClasses = [headClass];
              if (teachClasses) {
                teachClasses.split(/[,，]/).forEach(c => {
                  const trimmed = c.trim();
                  if (trimmed && !allClasses.includes(trimmed)) allClasses.push(trimmed);
                });
              }
              classNo = allClasses.join(",");
            } else if (role === "teacher") {
              classNo = teachClasses;
            }
          } else if (hasOldClassCol) {
            classNo = String(row[idx("班级")] || "").trim();
          }

          if (DB.users.some((u) => u.username === username)) { errors.push(`第${i + 1}行：账号"${username}"已存在`); skipped++; continue; }
          DB.users.push({ id: uid(), username, password: "123456", name, role, grade: grade || null, classNo: classNo || null, subjects, createdAt: Date.now() });
          added++;
        }
        if (added === 0) {
          showToast("没有可添加的用户", "warning");
          return;
        }
        const syncResult = await saveDB(DB);
        if (syncResult === true) {
          showToast(`✅ 成功添加 ${added} 人${skipped > 0 ? `，跳过 ${skipped} 行` : ""}，已同步到云端`, "success");
        } else if (syncResult === 'partial') {
          showToast(`⚠️ 成功添加 ${added} 人，已部分同步（学生名单已存至独立文件）`, "info");
        } else {
          showToast(`⚠️ 成功添加 ${added} 人，但云端同步失败，其他设备可能无法使用新账号`, "warning", 5000);
        }
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
  
  // 解析班级：班主任的第一个是班主任班级，其余是任教班级
  let headClass = "";
  let teachClasses = "";
  if (u && u.classNo) {
    const classes = String(u.classNo).split(/[,，]/).map(s => s.trim()).filter(Boolean);
    if (u.role === "headteacher") {
      headClass = classes[0] || "";
      teachClasses = classes.slice(1).join(",");
    } else {
      teachClasses = classes.join(",");
    }
  }
  
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
          <select id="m_role" onchange="toggleUserFormClassFields()">
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
          ${grades.length === 0
            ? `<div style="display:flex;gap:8px;align-items:center"><span style="color:#999;font-size:13px">暂无年组</span><button type="button" class="btn btn-sm btn-primary" onclick="addGradeFromUsers(); closeModal();">🏫 创建年组</button></div>`
            : `<select id="m_grade">${grades.map((g) => `<option ${u?.grade === g ? "selected" : ""}>${esc(g)}</option>`).join("")}</select>`
          }
        </div>
        <div id="m_class_field_teacher" class="form-group" style="display:none;">
          <label>任教班级（多班用逗号分隔，不填则全年级）</label>
          <input id="m_teach_classes" value="${esc(teachClasses)}" placeholder="如 1班,2班,3班（不填则教全年级）" />
        </div>
        <div id="m_class_field_head" class="form-group" style="display:none;">
          <label>班主任班级（必填）</label>
          <input id="m_head_class" value="${esc(headClass)}" placeholder="如 1班" />
        </div>
      </div>
      <div id="m_head_teach_row" class="user-form-row" style="display:none;">
        <div class="form-group" style="width:100%;">
          <label>同时任教的其他班级（多班用逗号分隔，可留空）</label>
          <input id="m_head_teach_classes" value="${esc(teachClasses)}" placeholder="如 2班,3班（仅填除班主任班级外的任教班级）" />
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
  showModal(u ? "编辑教师信息" : "添加新教师", html, "保存", async () => {
    const username = $("m_username").value.trim();
    const name = $("m_name").value.trim();
    const password = $("m_password").value.trim();
    const role = $("m_role").value;
    const gradeEl = $("m_grade");
    const grade = gradeEl ? gradeEl.value.trim() : "";
    if (!grade) { showToast("请先创建年组", "error"); return false; }
    const subjects = $("m_subjects").value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    const isAcademic = currentUser.role === "academic";

    // 根据角色组装 classNo
    let classNo = "";
    if (role === "headteacher") {
      const headClass = $("m_head_class").value.trim();
      const teachClasses = $("m_head_teach_classes").value.trim();
      if (!headClass) { showToast("请填写班主任班级", "error"); return false; }
      const allClasses = [headClass];
      if (teachClasses) {
        teachClasses.split(/[,，]/).forEach(c => {
          const trimmed = c.trim();
          if (trimmed && !allClasses.includes(trimmed)) allClasses.push(trimmed);
        });
      }
      classNo = allClasses.join(",");
    } else if (role === "teacher") {
      classNo = $("m_teach_classes").value.trim();
    }

    if (!username || !name) { showToast("账号和姓名不能为空", "error"); return false; }
    if (!u && DB.users.some((x) => x.username === username)) { showToast("账号已存在", "error"); return false; }
    if (isAcademic && grade !== currentUser.grade) { showToast("教务只能管理本年级教师", "error"); return false; }

    if (u) {
      u.name = name; u.role = role; u.grade = grade; u.classNo = classNo; u.subjects = subjects;
      if (password) u.password = password;
    } else {
      DB.users.push({ id: uid(), username, password: password || "123456", name, role, grade, classNo, subjects, createdAt: Date.now() });
    }
    const syncResult = await saveDB(DB);
    if (syncResult === true) {
      showToast(u ? "✅ 保存成功" : `✅ 添加成功，账号 ${username} / 密码 ${password || "123456"}，已同步到云端`, u ? "success" : "success");
    } else if (syncResult === 'partial') {
      showToast(u ? "✅ 保存成功（已部分同步）" : `✅ 添加成功，已部分同步`, "info");
    } else {
      showToast(u ? "✅ 保存成功（云端同步失败）" : `⚠️ 添加成功但云端同步失败，新账号在其他设备可能无法登录`, "warning", 5000);
    }
    renderUsers();
  });
  // 初始化班级字段显示
  setTimeout(() => toggleUserFormClassFields(u?.role || "teacher"), 50);
};

// 根据角色切换教师编辑表单中的班级字段显示
window.toggleUserFormClassFields = function(role) {
  const r = role || $("m_role")?.value;
  const teacherField = $("m_class_field_teacher");
  const headField = $("m_class_field_head");
  const headTeachRow = $("m_head_teach_row");
  if (!teacherField || !headField) return;
  
  if (r === "headteacher") {
    teacherField.style.display = "none";
    headField.style.display = "block";
    headTeachRow.style.display = "flex";
  } else if (r === "teacher") {
    teacherField.style.display = "block";
    headField.style.display = "none";
    headTeachRow.style.display = "none";
  } else {
    // 教务老师不需要班级字段
    teacherField.style.display = "none";
    headField.style.display = "none";
    headTeachRow.style.display = "none";
  }
};

window.resetPwd = async function (id) {
  const u = DB.users.find((x) => x.id === id);
  if (!u) return;
  const isAcademic = currentUser.role === "academic";
  if (isAcademic && u.grade !== currentUser.grade) { showToast("无权限操作此教师", "error"); return; }
  if (!confirm(`确认将 ${u.name} 的密码重置为 123456？`)) return;
  u.password = "123456";
  const syncResult = await saveDB(DB);
  if (syncResult) {
    showToast(`✅ ${u.name} 的密码已重置为 123456`, "success");
  } else {
    showToast(`⚠️ 密码已重置（云端同步失败）`, "warning", 4000);
  }
};

window.delUser = async function (id) {
  const u = DB.users.find((x) => x.id === id);
  if (!u) return;
  const isAcademic = currentUser.role === "academic";
  if (isAcademic && (u.grade !== currentUser.grade || u.role === "academic")) { showToast("无权限删除此教师", "error"); return; }
  if (!confirm(`确认删除教师「${u.name}」？此操作不可恢复。`)) return;
  DB.users = DB.users.filter((x) => x.id !== id);
  const syncResult = await saveDB(DB);
  if (syncResult) {
    showToast(`✅ 已删除「${u.name}」`, "success");
  } else {
    showToast(`⚠️ 已删除（云端同步失败）`, "warning", 4000);
  }
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
            <td>${DB.exams.filter((e) => e.grade === g && !e.isClassExam).length}</td>
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
  // 仅显示年级统一考试，排除各班自建考试
  const exams = currentUser.grade
    ? DB.exams.filter((e) => e.grade === currentUser.grade && !e.isClassExam)
    : DB.exams.filter((e) => !e.isClassExam);
  const rows = exams.slice().sort((a, b) => b.createdAt - a.createdAt).map((e) => {
    const n = DB.records.filter((r) => r.examId === e.id).length;
    const subjects = e.subjects ? e.subjects.map((s) => s.name).join(", ") : "未设置";
    return `<tr>
      <td>${e.name}</td><td>${e.grade}</td><td>${e.date}</td><td>${subjects}</td><td>${n}</td>
      <td style="display:flex;gap:6px">
        ${canEdit ? `<button class="btn btn-sm btn-primary" onclick="editExamSubjects('${e.id}')">设置科目</button>` : ""}
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
      <p style="color:var(--text-light); margin-bottom:14px;">💡 创建考试后，请设置考试科目及分值。</p>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>考试名称</th><th>所属年级</th><th>考试日期</th><th>考试科目</th><th>已上传学生数</th><th>操作</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6"><div class="empty-state"><div class="es-tip">暂无考试</div></div></td></tr>`}</tbody>
      </table></div>
    </div>
  `;
}

window.addExam = function () {
  const grades = currentUser.role === "admin" ? Object.keys(DB.subjects) : (currentUser.grade ? [currentUser.grade] : []);
  // 查找上一次（同年级最近一次）考试的科目分值，用于默认沿用
  const findLastSubjects = (grade) => {
    const sameGrade = DB.exams.filter((e) => e.grade === grade && Array.isArray(e.subjects) && e.subjects.length > 0);
    if (sameGrade.length === 0) return [];
    sameGrade.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return JSON.parse(JSON.stringify(sameGrade[0].subjects));
  };
  const defaultGrade = currentUser.grade || grades[0];
  const willUseLast = findLastSubjects(defaultGrade);
  const defaultNote = willUseLast.length > 0
    ? `<p style="color:#1976d2;margin-top:6px;font-size:13px">📌 将默认沿用上一次「${defaultGrade}」考试的 ${willUseLast.length} 个科目及分值，创建后可在「设置科目」中修改/删除/批量导入导出。</p>`
    : `<p style="color:#666;margin-top:6px;font-size:13px">尚无历史考试，创建后请在「设置科目」中添加科目及分值。</p>`;
  showModal("新建考试", `
    <div class="form-group"><label>考试名称</label><input id="m_exam" placeholder="如 2024学年第一学期期末考试" /></div>
    <div class="form-row">
      <div class="form-group"><label>所属年级</label>
        <select id="m_exam_grade" onchange="window._refreshExamDefaultNote()">${grades.map((g) => `<option ${g === defaultGrade ? "selected" : ""}>${g}</option>`).join("")}</select>
      </div>
      <div class="form-group"><label>考试日期</label><input id="m_exam_date" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div>
    </div>
    <div id="m_exam_default_note">${defaultNote}</div>
  `, "创建", () => {
    const name = $("m_exam").value.trim();
    const grade = $("m_exam_grade").value.trim();
    const date = $("m_exam_date").value;
    if (!name || !grade || !date) { showToast("请完整填写信息", "error"); return false; }
    // 默认沿用上一次同年级考试的科目分值
    const initSubjects = findLastSubjects(grade);
    DB.exams.push({ id: uid(), name, grade, date, createdAt: Date.now(), subjects: initSubjects }); saveDB(DB);
    showToast(initSubjects.length > 0 ? `考试创建成功，已沿用 ${initSubjects.length} 个科目（可在「设置科目」修改）` : "考试创建成功，请设置考试科目", "success"); renderExams();
  });
  // 切换年级时刷新默认沿用提示
  window._refreshExamDefaultNote = function () {
    const g = $("m_exam_grade").value.trim();
    const last = findLastSubjects(g);
    const note = $("m_exam_default_note");
    if (!note) return;
    note.innerHTML = last.length > 0
      ? `<p style="color:#1976d2;margin-top:6px;font-size:13px">📌 将默认沿用上一次「${g}」考试的 ${last.length} 个科目及分值，创建后可在「设置科目」中修改/删除/批量导入导出。</p>`
      : `<p style="color:#666;margin-top:6px;font-size:13px">尚无历史考试，创建后请在「设置科目」中添加科目及分值。</p>`;
  };
};

window.editExamSubjects = function (examId) {
  const exam = DB.exams.find((e) => e.id === examId);
  if (!exam) return;
  const gradeSubjects = DB.subjects[exam.grade] || [];
  if (!exam.subjects) exam.subjects = [];

  const renderExamSubjectTable = () => {
    const list = exam.subjects;
    const rows = list.map((s, idx) => `
      <tr>
        <td><input value="${esc(s.name)}" onchange="window._updateExamSubject('${examId}', ${idx}, 'name', this.value)" style="width:90px;padding:6px;border:1px solid var(--border);border-radius:4px" /></td>
        <td><input type="number" value="${s.fullScore}" onchange="window._updateExamSubject('${examId}', ${idx}, 'fullScore', +this.value)" style="width:80px;padding:6px;border:1px solid var(--border);border-radius:4px" /></td>
        <td><input type="number" value="${s.excellent}" onchange="window._updateExamSubject('${examId}', ${idx}, 'excellent', +this.value)" style="width:80px;padding:6px;border:1px solid var(--border);border-radius:4px" /></td>
        <td><input type="number" value="${s.good}" onchange="window._updateExamSubject('${examId}', ${idx}, 'good', +this.value)" style="width:80px;padding:6px;border:1px solid var(--border);border-radius:4px" /></td>
        <td><input type="number" value="${s.pass}" onchange="window._updateExamSubject('${examId}', ${idx}, 'pass', +this.value)" style="width:80px;padding:6px;border:1px solid var(--border);border-radius:4px" /></td>
        <td><input type="number" value="${s.low}" onchange="window._updateExamSubject('${examId}', ${idx}, 'low', +this.value)" style="width:80px;padding:6px;border:1px solid var(--border);border-radius:4px" /></td>
        <td><button class="btn btn-sm btn-danger" onclick="window._delExamSubject('${examId}', ${idx})">删除</button></td>
      </tr>
    `).join("");
    return `
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>学科</th><th>满分</th><th>优秀线</th><th>良好线</th><th>及格线</th><th>低分线</th><th>操作</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7"><div class="empty-state"><div class="es-tip">暂无科目，点击「+ 添加学科」或「批量导入」</div></div></td></tr>`}</tbody>
      </table></div>
      <p style="color:var(--text-light);margin-top:8px;font-size:12px">💡 直接在表格中修改数值即自动保存；支持批量导入/导出 Excel。</p>
    `;
  };

  const btns = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button class="btn btn-success" onclick="window._addExamSubject('${examId}')">+ 添加学科</button>
      <button class="btn btn-warning" onclick="window._batchUploadExamSubject('${examId}')">📤 批量导入</button>
      <button class="btn btn-info" onclick="window._exportExamSubject('${examId}')">📥 批量导出</button>
      <button class="btn btn-primary" onclick="window._downloadExamSubjectTemplate('${examId}')">📥 下载模板</button>
      <button class="btn btn-secondary" onclick="window._copyFromGradeExamSubject('${examId}')">📋 从年级学科库复制</button>
    </div>
  `;

  showModal(`设置考试科目 - ${exam.name}（${exam.grade}${exam.isClassExam ? " · " + exam.classNo + " 班级考试" : ""}）`, btns + `<div id="_examSubjectTable">${renderExamSubjectTable()}</div>`, "关闭", () => {
    saveDB(DB);
    showToast("科目设置已保存", "success");
    if (currentPage === "class_exams") renderClassExams();
    else renderExams();
  });
  // 隐藏确定按钮（改为「关闭」语义，保存是即时进行的）
  const ok = $("modalOk");
  if (ok) { ok.textContent = "关闭"; }

  // 表格刷新
  const refreshTable = () => {
    const box = $("_examSubjectTable");
    if (box) box.innerHTML = renderExamSubjectTable();
  };

  // 内联更新
  window._updateExamSubject = function (eid, idx, field, val) {
    const ex = DB.exams.find((e) => e.id === eid);
    if (!ex || !ex.subjects || !ex.subjects[idx]) return;
    ex.subjects[idx][field] = val;
    saveDB(DB);
  };

  // 添加学科
  window._addExamSubject = function (eid) {
    const ex = DB.exams.find((e) => e.id === eid);
    if (!ex) return;
    if (!ex.subjects) ex.subjects = [];
    const existing = new Set(ex.subjects.map((s) => s.name));
    const candidates = (DB.subjects[ex.grade] || []).filter((s) => !existing.has(s.name));
    showModal("添加学科", `
      <div class="form-group"><label>学科名称</label><input id="m_esn" placeholder="如 生物" list="_grade_subj_list" />
        <datalist id="_grade_subj_list">${candidates.map((s) => `<option value="${esc(s.name)}">`).join("")}</datalist>
      </div>
      <div class="form-row">
        <div class="form-group"><label>满分</label><input type="number" id="m_efs" value="100" /></div>
        <div class="form-group"><label>优秀线</label><input type="number" id="m_eex" value="85" /></div>
        <div class="form-group"><label>良好线</label><input type="number" id="m_egd" value="75" /></div>
        <div class="form-group"><label>及格线</label><input type="number" id="m_eps" value="60" /></div>
        <div class="form-group"><label>低分线</label><input type="number" id="m_elw" value="40" /></div>
      </div>
    `, "添加", () => {
      const name = $("m_esn").value.trim();
      if (!name) { showToast("请填写学科名称", "error"); return false; }
      if (existing.has(name)) { showToast("该学科已存在", "error"); return false; }
      ex.subjects.push({
        name,
        fullScore: +$("m_efs").value || 100,
        excellent: +$("m_eex").value || 85,
        good: +$("m_egd").value || 75,
        pass: +$("m_eps").value || 60,
        low: +$("m_elw").value || 40
      });
      saveDB(DB);
      showToast("已添加", "success");
      // 关闭子弹窗后刷新父表格
      setTimeout(() => { hideModal(); refreshTable(); }, 50);
      return true;
    });
  };

  // 删除学科
  window._delExamSubject = function (eid, idx) {
    const ex = DB.exams.find((e) => e.id === eid);
    if (!ex || !ex.subjects) return;
    if (!confirm("确认删除此学科？")) return;
    ex.subjects.splice(idx, 1);
    saveDB(DB);
    showToast("已删除", "success");
    refreshTable();
  };

  // 批量导出
  window._exportExamSubject = function (eid) {
    const ex = DB.exams.find((e) => e.id === eid);
    if (!ex || !ex.subjects || ex.subjects.length === 0) { showToast("暂无科目可导出", "warning"); return; }
    const data = [
      ["学科", "满分", "优秀线", "良好线", "及格线", "低分线"],
      ...ex.subjects.map((s) => [s.name, s.fullScore, s.excellent, s.good, s.pass, s.low])
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws, "科目分值");
    const dateStr = new Date().toLocaleDateString().replace(/\//g, "-");
    XLSX.writeFile(wb, `${ex.grade}_${ex.name}_科目分值_${dateStr}.xlsx`);
    showToast(`已导出 ${ex.subjects.length} 个科目`, "success");
  };

  // 下载模板
  window._downloadExamSubjectTemplate = function (eid) {
    const ex = DB.exams.find((e) => e.id === eid);
    const data = [
      ["学科", "满分", "优秀线", "良好线", "及格线", "低分线"],
      ["语文", "150", "135", "120", "90", "60"],
      ["数学", "150", "135", "120", "90", "60"],
      ["英语", "150", "135", "120", "90", "60"],
      ["物理", "100", "90", "80", "60", "40"],
      ["化学", "100", "90", "80", "60", "40"]
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws, "科目分值");
    XLSX.writeFile(wb, `${ex ? ex.grade : ""}_科目分值模板.xlsx`);
    showToast("模板已下载", "success");
  };

  // 批量导入
  window._batchUploadExamSubject = function (eid) {
    const ex = DB.exams.find((e) => e.id === eid);
    if (!ex) return;
    if (!ex.subjects) ex.subjects = [];
    showModal("📤 批量导入科目", `
      <div style="margin-bottom:16px;padding:16px;background:#f0f7ff;border-radius:8px;font-size:13px">
        <p style="margin-bottom:8px"><b>📋 Excel 格式要求：</b></p>
        <p style="color:#666">• 第一行为表头：学科、满分、优秀线、良好线、及格线、低分线</p>
        <p style="color:#666">• 同名学科将<b>覆盖更新</b>，新学科会被追加</p>
      </div>
      <div class="form-group"><label>选择 Excel 文件</label><input type="file" id="_exam_subj_file" accept=".xlsx,.xls,.csv" style="padding:8px" /></div>
    `, "开始导入", () => {
      const fileInput = $("_exam_subj_file");
      if (!fileInput.files[0]) { showToast("请选择文件", "error"); return false; }
      const file = fileInput.files[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
          if (json.length < 2) { showToast("文件内容为空或格式不正确", "error"); return; }
          const headers = json[0].map((h) => String(h || "").trim());
          if (!headers.includes("学科") || !headers.includes("满分")) { showToast("缺少必填列：学科、满分", "error"); return; }
          const idxOf = (n) => headers.indexOf(n);
          let added = 0, updated = 0, skipped = 0, errors = [];
          for (let i = 1; i < json.length; i++) {
            const row = json[i];
            const name = String(row[idxOf("学科")] || "").trim();
            if (!name) { skipped++; continue; }
            const fullScore = +row[idxOf("满分")] || 100;
            const obj = {
              name,
              fullScore,
              excellent: headers.includes("优秀线") ? (+row[idxOf("优秀线")] || Math.round(fullScore * 0.85)) : Math.round(fullScore * 0.85),
              good: headers.includes("良好线") ? (+row[idxOf("良好线")] || Math.round(fullScore * 0.7)) : Math.round(fullScore * 0.7),
              pass: headers.includes("及格线") ? (+row[idxOf("及格线")] || Math.round(fullScore * 0.6)) : Math.round(fullScore * 0.6),
              low: headers.includes("低分线") ? (+row[idxOf("低分线")] || Math.round(fullScore * 0.4)) : Math.round(fullScore * 0.4)
            };
            const existIdx = ex.subjects.findIndex((s) => s.name === name);
            if (existIdx >= 0) { ex.subjects[existIdx] = obj; updated++; }
            else { ex.subjects.push(obj); added++; }
          }
          saveDB(DB);
          showToast(`成功：新增 ${added}、更新 ${updated}${skipped > 0 ? `，跳过 ${skipped} 行` : ""}`, added + updated > 0 ? "success" : "warning");
          if (errors.length > 0) showToast(errors.slice(0, 3).join("；"), "warning", 4000);
          hideModal();
          refreshTable();
        } catch (err) {
          showToast("文件解析失败：" + err.message, "error");
        }
      };
      reader.readAsArrayBuffer(file);
      return true;
    });
  };

  // 从年级学科库一键复制
  window._copyFromGradeExamSubject = function (eid) {
    const ex = DB.exams.find((e) => e.id === eid);
    if (!ex) return;
    const gradeList = DB.subjects[ex.grade] || [];
    if (gradeList.length === 0) { showToast("该年级学科库为空", "warning"); return; }
    if (!confirm(`将从年级学科库复制 ${gradeList.length} 个学科到本场考试，同名学科将被覆盖，确定？`)) return;
    const existing = new Set(ex.subjects.map((s) => s.name));
    let added = 0, updated = 0;
    gradeList.forEach((s) => {
      const idx = ex.subjects.findIndex((x) => x.name === s.name);
      if (idx >= 0) { ex.subjects[idx] = { ...s }; updated++; }
      else { ex.subjects.push({ ...s }); added++; }
    });
    saveDB(DB);
    showToast(`从学科库复制：新增 ${added}、更新 ${updated}`, "success");
    refreshTable();
  };
};

window.delExam = function (id) {
  if (!confirm("确认删除此考试及其所有成绩数据？")) return;
  DB.exams = DB.exams.filter((e) => e.id !== id);
  DB.records = DB.records.filter((r) => r.examId !== id);
  saveDB(DB, id); showToast("已删除", "success"); renderExams();
};

// ========== 学科库说明 ==========
// 「学科/分值设置」独立菜单已移除，改为在「考试管理」每场考试的「设置科目」中配置。
// DB.subjects[grade] 仍作为「年级学科库」保留，供上传成绩模糊匹配科目列名、
// 以及新建考试时从年级学科库一键复制到本场考试使用。
// 若旧路由被访问，自动跳转到考试管理页。
function renderSubjects() {
  if (currentUser && (currentUser.role === "academic" || currentUser.role === "admin")) {
    showToast("学科分值设置已合并到「考试管理 - 设置科目」", "info", 3000);
    navigate("exams");
  } else {
    $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`;
  }
}

// 注：旧的 updateSubjectField / addSubject / delSubject / downloadSubjectTemplate /
// showSubjectBatchUpload / exportSubjectExcel 已随「学科/分值设置」菜单一并移除。
// 科目分值的增删改与 Excel 批量导入导出，现统一在「考试管理 - 设置科目」弹窗中完成（见 editExamSubjects）。


// ========== 班主任：班级考试管理（教务端缩版，仅本班自建考试） ==========
// 班级自建考试数据结构：
//   { id, name, grade, classNo, date, createdAt, subjects, isClassExam: true, createdBy: userId }
// 与年级考试共享同一 DB.exams 数组，通过 isClassExam + classNo 区分。
// 教务/管理员端的考试管理仅显示年级考试（isClassExam !== true）。
// 班主任端可以看到并选择：年级考试 + 本班自建考试。

function renderClassExams() {
  if (currentUser.role !== "headteacher") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const classNo = currentUser.classNo;
  // 本班自建考试（不包含年级考试）
  const myExams = DB.exams.filter((e) => e.grade === grade && e.isClassExam === true && classNoEquals(e.classNo, classNo));
  const rows = myExams.slice().sort((a, b) => b.createdAt - a.createdAt).map((e) => {
    const n = DB.records.filter((r) => r.examId === e.id).length;
    const subjects = e.subjects ? e.subjects.map((s) => s.name).join(", ") : "未设置";
    return `<tr>
      <td>${esc(e.name)}</td><td>${esc(e.date)}</td><td>${subjects}</td><td>${n}</td>
      <td style="display:flex;gap:6px">
        <button class="btn btn-sm btn-primary" onclick="editExamSubjects('${e.id}')">设置科目</button>
        <button class="btn btn-sm btn-danger" onclick="delClassExam('${e.id}')">删除</button>
      </td>
    </tr>`;
  }).join("");

  // 年级考试列表（仅供查看，不能编辑）
  const gradeExams = DB.exams.filter((e) => e.grade === grade && !e.isClassExam);
  const gradeRows = gradeExams.slice().sort((a, b) => b.createdAt - a.createdAt).map((e) => {
    const n = DB.records.filter((r) => r.examId === e.id && classNoEquals(r.classNo, classNo)).length;
    const subjects = e.subjects ? e.subjects.map((s) => s.name).join(", ") : "未设置";
    return `<tr><td>${esc(e.name)}</td><td>${esc(e.date)}</td><td>${subjects}</td><td>${n}</td><td><span class="tag tag-info">年级考试</span></td></tr>`;
  }).join("");

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">
        <span>📝 班级考试管理（${classNo}）</span>
        <span class="ct-actions"><button class="btn btn-success" onclick="addClassExam()">+ 新建班级考试</button></span>
      </div>
      <p style="color:var(--text-light); margin-bottom:14px;">
        💡 您可以自建班级内部考试并设置科目及分值，相当于教务端考试管理的缩版，仅在本班内使用。
        上传成绩时可以选择「年级考试」或「本班自建考试」。
      </p>
      <div style="margin-bottom:8px;font-weight:600;font-size:14px;color:var(--primary)">🏫 本班自建考试（${myExams.length} 次）</div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>考试名称</th><th>考试日期</th><th>考试科目</th><th>已上传学生数</th><th>操作</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5"><div class="empty-state"><div class="es-tip">暂无自建考试，点击上方「+ 新建班级考试」创建</div></div></td></tr>`}</tbody>
      </table></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-title">
        <span>📚 年级统一考试（${gradeExams.length} 次，仅查看）</span>
      </div>
      <p style="color:var(--text-light); margin-bottom:14px;">以下为教务老师创建的全年级统一考试，本班可上传成绩但不能编辑科目。</p>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>考试名称</th><th>考试日期</th><th>考试科目</th><th>本班已上传</th><th>类型</th></tr></thead>
        <tbody>${gradeRows || `<tr><td colspan="5"><div class="empty-state"><div class="es-tip">暂无年级考试</div></div></td></tr>`}</tbody>
      </table></div>
    </div>
  `;
}

window.addClassExam = function () {
  if (currentUser.role !== "headteacher") return;
  const grade = currentUser.grade;
  const classNo = currentUser.classNo;
  // 查找上一次本班自建考试的科目，默认沿用
  const findLastSubjects = () => {
    const myExams = DB.exams.filter((e) => e.grade === grade && e.isClassExam === true && classNoEquals(e.classNo, classNo) && Array.isArray(e.subjects) && e.subjects.length > 0);
    if (myExams.length === 0) {
      // 回退：沿用上一次年级考试的科目
      const gradeExams = DB.exams.filter((e) => e.grade === grade && !e.isClassExam && Array.isArray(e.subjects) && e.subjects.length > 0);
      if (gradeExams.length === 0) return [];
      gradeExams.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      return JSON.parse(JSON.stringify(gradeExams[0].subjects));
    }
    myExams.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return JSON.parse(JSON.stringify(myExams[0].subjects));
  };
  const willUseLast = findLastSubjects();
  const defaultNote = willUseLast.length > 0
    ? `<p style="color:#1976d2;margin-top:6px;font-size:13px">📌 将默认沿用最近一次考试的 ${willUseLast.length} 个科目及分值，创建后可在「设置科目」中修改/删除/批量导入导出。</p>`
    : `<p style="color:#666;margin-top:6px;font-size:13px">尚无历史考试，创建后请在「设置科目」中添加科目及分值。</p>`;

  showModal("新建班级考试", `
    <div class="form-group"><label>考试名称</label><input id="m_cexam" placeholder="如 高一(1)班第一次月考" /></div>
    <div class="form-row">
      <div class="form-group"><label>所属年级</label><input value="${grade}" disabled style="background:#f1f5f9" /></div>
      <div class="form-group"><label>班级</label><input value="${classNo}" disabled style="background:#f1f5f9" /></div>
      <div class="form-group"><label>考试日期</label><input id="m_cexam_date" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div>
    </div>
    <div id="m_cexam_note">${defaultNote}</div>
  `, "创建", () => {
    const name = $("m_cexam").value.trim();
    const date = $("m_cexam_date").value;
    if (!name || !date) { showToast("请完整填写信息", "error"); return false; }
    const initSubjects = findLastSubjects();
    DB.exams.push({
      id: uid(), name, grade, classNo, date,
      createdAt: Date.now(), subjects: initSubjects,
      isClassExam: true, createdBy: currentUser.id
    });
    saveDB(DB);
    showToast(initSubjects.length > 0 ? `班级考试创建成功，已沿用 ${initSubjects.length} 个科目` : "班级考试创建成功，请设置考试科目", "success");
    renderClassExams();
  });
};

window.delClassExam = function (id) {
  const exam = DB.exams.find((e) => e.id === id);
  if (!exam || !exam.isClassExam) { showToast("只能删除本班自建考试", "error"); return; }
  if (!confirm("确认删除此班级考试及其所有成绩数据？此操作不可撤销。")) return;
  DB.exams = DB.exams.filter((e) => e.id !== id);
  DB.records = DB.records.filter((r) => r.examId !== id);
  saveDB(DB, id);
  showToast("已删除", "success");
  renderClassExams();
};


// ========== 班主任：上传成绩 ==========
function renderUploadScores() {
  if (currentUser.role !== "headteacher") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const classNo = currentUser.classNo;
  // 班主任可选择：年级统一考试 + 本班自建考试
  const exams = getHeadteacherExams(grade, classNo);
  const showStudentId = hasRoster(grade);
  // 获取默认选中考试的科目（优先用考试自身的 subjects）
  const defaultExam = exams[0];
  const defaultSubjects = defaultExam ? getExamSubjects(defaultExam.id) : (DB.subjects[grade] || []);

  // 各考试的上传状态（只看本班级）
  const examStatus = exams.map((e) => {
    const recs = DB.records.filter((r) => r.examId === e.id && classNoEquals(r.classNo, classNo));
    const total = recs.length;
    // 统计各科目上传情况
    const subjectProgress = {};
    defaultSubjects.forEach((s) => {
      const subjectRecs = recs.filter((r) => r.scores[s.name] != null && r.scores[s.name] !== "");
      subjectProgress[s.name] = subjectRecs.length;
    });
    return { id: e.id, name: e.name, total, subjectProgress };
  });

  if (defaultSubjects.length === 0) {
    $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-icon">⚠️</div><div class="es-title">暂无可用考试科目</div><div class="es-tip">请先在「班级考试管理」中创建考试并设置科目</div></div></div>`;
    return;
  }

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">📥 上传 ${grade} ${classNo} 班级成绩</div>
      <p style="color:var(--text-light);margin-bottom:12px">成绩上传后直接生效（成绩审核已移除）。可选择年级统一考试或本班自建考试。</p>

      <!-- 考试上传状态概览 -->
      <div class="review-status-box">
        <div style="font-weight:600;margin-bottom:8px">📊 考试上传状态（${classNo}）</div>
        <div class="table-wrap" style="margin-top:8px"><table class="data-table">
          <thead><tr><th>考试</th><th>类型</th><th>学生数</th><th>状态</th></tr></thead>
          <tbody>${examStatus.map((s) => {
            const exam = exams.find((e) => e.id === s.id);
            const typeTag = exam?.isClassExam
              ? `<span class="tag tag-info">班级考试</span>`
              : `<span class="tag tag-success">年级考试</span>`;
            if (s.total === 0) {
              return `<tr><td>${esc(s.name)}</td><td>${typeTag}</td><td>0</td><td><span class="tag">未上传</span></td></tr>`;
            } else {
              return `<tr><td>${esc(s.name)}</td><td>${typeTag}</td><td>${s.total}</td><td><span class="tag tag-success">✓ 已上传</span></td></tr>`;
            }
          }).join("")}</tbody>
        </table></div>
      </div>

      <div class="form-row">
        <div class="form-group" style="flex:1"><label>选择考试</label>
          <select id="u_exam" onchange="onExamChange()">
            ${exams.map((e) => `<option value="${e.id}">${e.isClassExam ? "【班级】" : "【年级】"}${e.name}</option>`).join("")}
            ${exams.length === 0 ? `<option>暂无考试</option>` : ""}
          </select>
        </div>
      </div>

      <!-- 上传模式选择 -->
      <div class="form-row" style="margin-bottom:16px">
        <div class="form-group" style="flex:1">
          <label>上传模式</label>
          <div style="display:flex;gap:16px;margin-top:6px">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
              <input type="radio" name="u_mode" value="full" checked onchange="onUploadModeChange()" /> 全科上传（一次上传所有科目）
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
              <input type="radio" name="u_mode" value="single" onchange="onUploadModeChange()" /> 单科上传（分科目上传，最终汇总）
            </label>
          </div>
        </div>
      </div>

      <!-- 单科上传时的科目选择 -->
      <div id="single_subject_select" style="display:none;margin-bottom:16px">
        <div class="form-group">
          <label>选择要上传的科目</label>
          <div id="subject_buttons" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px"></div>
        </div>
      </div>

      <!-- 科目上传进度 -->
      <div id="subject_progress" style="margin-bottom:16px"></div>

      <div class="form-group" style="display:flex;align-items:flex-end;gap:10px">
        <button class="btn btn-info" onclick="downloadTemplate()">⬇ 下载Excel模板</button>
        <button class="btn btn-secondary" onclick="downloadSingleSubjectTemplate()" id="dl_single_template" style="display:none">⬇ 下载单科模板</button>
      </div>

      <div id="uploadArea" class="upload-area">
        <div class="ua-icon">📄</div>
        <div class="ua-title">点击选择 Excel 文件（.xlsx / .xls）</div>
        <div class="ua-tip" id="upload_tip">或直接拖拽文件到此区域。系统将自动识别${grade} ${classNo}</div>
        <input type="file" id="u_file" accept=".xlsx,.xls" style="display:none" />
      </div>

      <div id="u_preview" style="margin-top:20px"></div>
    </div>
    <div class="card">
      <div class="card-title">📋 Excel 模板说明</div>
      <p style="color:var(--text-light); line-height:1.9;">
        • Excel 首行为表头：<b>学号（可留空）、姓名、各科成绩列</b>（各科列名需与所选考试的科目名称对应）<br/>
        • <b>学号列为可选</b>：留空时系统自动分配格式「年份+班级+序号」（如 20260101），下次上传同名学生自动沿用，<b>班主任无需手打学号</b><br/>
        • 学号格式：<b>YYYYNN##</b>（年份前缀${DB.studentIdFormat?.yearPrefix || "2026"} + 两位班级号 + 两位班级人数顺序）<br/>
        • 同班同名学生必须手动补充学号区分（如「张三1」「张三2」或填入学号），系统会检测并提示<br/>
        • 学生姓名是唯一识别方式，请确保姓名填写准确<br/>
        • 留空的分数视为0分<br/>
        • 点击「下载Excel模板」可获得包含所选考试所有科目的完整模板<br/>
        • <b>成绩上传后直接生效（成绩审核已移除）。</b>
      </p>
    </div>
  `;

  // 初始化
  window._selectedSubject = null;
  renderSubjectProgress();
  renderSubjectButtons();

  const ua = $("uploadArea");
  ua.onclick = () => {
    const mode = document.querySelector('input[name="u_mode"]:checked').value;
    if (mode === "single" && !window._selectedSubject) {
      showToast("请先选择要上传的科目", "warning");
      return;
    }
    $("u_file").click();
  };
  ua.addEventListener("dragover", (e) => { e.preventDefault(); ua.classList.add("dragover"); });
  ua.addEventListener("dragleave", () => ua.classList.remove("dragover"));
  ua.addEventListener("drop", (e) => {
    e.preventDefault(); ua.classList.remove("dragover");
    const mode = document.querySelector('input[name="u_mode"]:checked').value;
    if (mode === "single" && !window._selectedSubject) {
      showToast("请先选择要上传的科目", "warning");
      return;
    }
    if (e.dataTransfer.files.length) handleExcelFile(e.dataTransfer.files[0]);
  });
  $("u_file").addEventListener("change", (e) => {
    if (e.target.files.length) handleExcelFile(e.target.files[0]);
  });
}

// 考试切换时刷新进度
window.onExamChange = function () {
  renderSubjectProgress();
  renderSubjectButtons();
};

// 上传模式切换
window.onUploadModeChange = function () {
  const mode = document.querySelector('input[name="u_mode"]:checked').value;
  $("single_subject_select").style.display = mode === "single" ? "block" : "none";
  $("dl_single_template").style.display = mode === "single" ? "inline-block" : "none";
  $("upload_tip").textContent = mode === "single"
    ? `单科上传模式：请先选择科目，再上传该科目的Excel文件`
    : `或直接拖拽文件到此区域。系统将自动识别${currentUser.grade} ${currentUser.classNo}`;
  window._selectedSubject = null;
  renderSubjectButtons();
  $("u_preview").innerHTML = "";
};

// 渲染科目按钮
function renderSubjectButtons() {
  const grade = currentUser.grade;
  const classNo = currentUser.classNo;
  const examId = $("u_exam").value;
  const subjects = getExamSubjects(examId);

  // 获取当前考试中各科目的上传情况
  const recs = DB.records.filter((r) => r.examId === examId && classNoEquals(r.classNo, classNo));
  const uploadedSubjects = new Set();
  subjects.forEach((s) => {
    const hasScore = recs.some((r) => r.scores[s.name] != null && r.scores[s.name] !== "");
    if (hasScore) uploadedSubjects.add(s.name);
  });

  const container = $("subject_buttons");
  container.innerHTML = subjects.map((s) => {
    const isUploaded = uploadedSubjects.has(s.name);
    const isSelected = window._selectedSubject === s.name;
    const cls = isSelected ? "btn btn-primary" : (isUploaded ? "btn btn-success" : "btn btn-secondary");
    const icon = isSelected ? "✓" : (isUploaded ? "✓" : "○");
    return `<button class="${cls}" onclick="selectSubject('${esc(s.name)}')" style="min-width:80px">${icon} ${s.name}${isUploaded ? " ✓" : ""}</button>`;
  }).join("");
}

// 选择科目
window.selectSubject = function (subjectName) {
  window._selectedSubject = subjectName;
  renderSubjectButtons();
  $("u_preview").innerHTML = "";
};

// 渲染科目上传进度
function renderSubjectProgress() {
  const grade = currentUser.grade;
  const classNo = currentUser.classNo;
  const examId = $("u_exam").value;
  const subjects = getExamSubjects(examId);
  const exams = getHeadteacherExams(grade, classNo);

  if (!examId || exams.length === 0) return;

  // 获取学生名单中本班级的人数
  const rosterStudents = DB.studentRoster?.[grade]?.[classNo] || [];
  const studentCount = rosterStudents.length;

  if (studentCount === 0) {
    $("subject_progress").innerHTML = `<div style="padding:12px;background:var(--bg-light);border-radius:6px;text-align:center;color:var(--text-light)">学生名单为空，请先上传学生名单</div>`;
    return;
  }

  // 获取当前考试中本班级的学生成绩记录
  const allRecs = DB.records.filter((r) => r.examId === examId && classNoEquals(r.classNo, classNo));

  // 各科目进度
  const progress = subjects.map((s) => {
    // 已上传分数的学生数量（从名单中过滤）
    const uploaded = rosterStudents.filter((stu) => {
      const rec = allRecs.find((r) => r.studentName === stu.studentName);
      return rec && rec.scores[s.name] != null && rec.scores[s.name] !== "";
    }).length;
    const pct = Math.round((uploaded / studentCount) * 100);
    return `<div style="flex:1;min-width:120px">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span>${s.name}</span><span>${uploaded}/${studentCount}</span>
      </div>
      <div style="height:6px;background:var(--border-color);border-radius:3px">
        <div style="height:100%;width:${pct}%;background:${pct === 100 ? '#1a7f37' : '#d35400'};border-radius:3px;transition:width 0.3s"></div>
      </div>
    </div>`;
  }).join("");

  $("subject_progress").innerHTML = `
    <div style="padding:12px;background:var(--bg-light);border-radius:6px">
      <div style="font-weight:600;margin-bottom:10px">📊 科目上传进度（${studentCount} 名学生）</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap">${progress}</div>
    </div>
  `;
}

// 下载单科模板
window.downloadSingleSubjectTemplate = function () {
  if (!window._selectedSubject) {
    showToast("请先选择要下载模板的科目", "warning");
    return;
  }
  const grade = currentUser.grade;
  const classNo = currentUser.classNo;
  const examId = $("u_exam").value;
  const subjectName = window._selectedSubject;
  const subjects = getExamSubjects(examId);
  const subject = subjects.find((s) => s.name === subjectName);
  const maxScore = subject ? subject.fullScore : 100;
  const exam = DB.exams.find((e) => e.id === examId);
  const examName = exam ? exam.name : "";

  const headers = ["学号（可留空）", "姓名", subjectName];
  const rows = [headers];
  for (let i = 1; i <= 5; i++) {
    rows.push([
      "",
      `${classNo}学生${i}`,
      Math.floor(Math.random() * maxScore * 0.5) + Math.floor(maxScore * 0.3)
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${subjectName}成绩`);
  XLSX.writeFile(wb, `${examName || grade}_${classNo}_${subjectName}_成绩.xlsx`);
  showToast(`「${subjectName}」模板已下载`, "success");
};

window.downloadTemplate = function () {
  const grade = currentUser.grade;
  const classNo = currentUser.classNo;
  const examId = $("u_exam").value;
  const subjects = getExamSubjects(examId);
  const exam = DB.exams.find((e) => e.id === examId);
  const examName = exam ? exam.name : "";
  const headers = ["学号（可留空）", "姓名", ...subjects.map((s) => s.name)];
  const rows = [headers];
  for (let i = 1; i <= 3; i++) {
    rows.push([
      "",  // 学号留空，系统自动生成
      `${classNo}学生${i}`,
      ...subjects.map((s) => Math.floor(Math.random() * (s.fullScore || 100)))
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "成绩模板");
  XLSX.writeFile(wb, `${examName || grade}_${classNo}_成绩模板.xlsx`);
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
      console.log("[上传成绩] Excel解析结果", {
        sheetNames: wb.SheetNames,
        firstSheetName: wb.SheetNames[0],
        rowCount: rows.length,
        firstRow: rows[0]
      });
      if (rows.length === 0) { showToast("Excel 为空", "error"); return; }

      const grade = currentUser.grade;
      const classNo = displayClassNo(currentUser.classNo) || currentUser.classNo;
      const examId = $("u_exam").value;
      // 使用考试自身的科目配置（班级考试用自建科目，年级考试用年级科目库）
      const subjects = getExamSubjects(examId);
      const showStudentId = hasRoster(grade);
      const mode = document.querySelector('input[name="u_mode"]:checked').value;
      const selectedSubject = window._selectedSubject || null;

      if (!examId) {
        showToast("请先选择考试", "warning");
        return;
      }

      // 建立列名到科目的映射（支持模糊匹配）
      const firstRow = rows[0] || {};
      const colToSubject = {};
      Object.keys(firstRow).forEach((col) => {
        const colTrim = col.trim();
        // 直接匹配
        const direct = subjects.find((s) => s.name === colTrim);
        if (direct) { colToSubject[col] = direct.name; return; }
        // 模糊匹配：列名包含科目名，或科目名在列名开头
        const fuzzy = subjects.find((s) => colTrim.includes(s.name) || s.name.includes(colTrim));
        if (fuzzy) { colToSubject[col] = fuzzy.name; return; }
        // 去掉括号内容后匹配，如"语文(150)" -> "语文"
        const withoutBracket = colTrim.replace(/\([^)]*\)/g, "").trim();
        if (withoutBracket !== colTrim) {
          const bracketMatch = subjects.find((s) => s.name === withoutBracket);
          if (bracketMatch) { colToSubject[col] = bracketMatch.name; return; }
        }
      });
      console.log("[上传成绩] 列名映射", colToSubject);

      const isSingleMode = mode === "single" && selectedSubject;
      const targetSubjects = isSingleMode ? [selectedSubject] : subjects.map((s) => s.name);

      const existingRecords = {};
      DB.records.filter((r) => r.examId === examId && r.grade === grade && classNoEquals(r.classNo, classNo)).forEach((r) => {
        if (!existingRecords[r.studentName]) existingRecords[r.studentName] = r;
      });
      const existingNameToId = {};
      Object.values(existingRecords).forEach((r) => {
        if (!existingNameToId[r.studentName]) existingNameToId[r.studentName] = r.studentId;
      });

      // 辅助函数：从行数据中提取学生ID和姓名（支持多种列名格式）
      const extractStudent = (row) => {
        const allKeys = Object.keys(row);
        // 找学号列
        let studentId = "";
        const idPatterns = ["学号", "编号", "号码", "id", "ID", "student_id", "StudentID"];
        for (const k of allKeys) {
          if (idPatterns.some((p) => k.includes(p))) {
            studentId = String(row[k] || "").trim();
            if (studentId) break;
          }
        }
        // 找姓名列
        let studentName = "";
        const namePatterns = ["姓名", "名字", "name", "Name", "student_name", "StudentName", "学生"];
        for (const k of allKeys) {
          if (namePatterns.some((p) => k.includes(p))) {
            studentName = String(row[k] || "").trim();
            if (studentName) break;
          }
        }
        return { studentId, studentName };
      };

      const parsedRowIds = new Set();
      const parsed = [];
      const autoGenNotes = [];
      const conflictWarnings = [];

      for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx];
        const { studentId: rawStudentId, studentName: rawStudentName } = extractStudent(row);
        let studentId = String(rawStudentId || "").trim();
        let studentName = String(rawStudentName || "").trim();
        if (!studentName) continue;

        const existingRecord = existingRecords[studentName];

        if (!studentId) {
          if (existingNameToId[studentName]) {
            studentId = existingNameToId[studentName];
          } else {
            // 使用新的学号生成格式：YYYYNN##
            const countSoFar = parsed.filter((p) => !existingNameToId[p.studentName]).length + 1;
            if (parsed.filter((p) => p.studentName === studentName).length === 0) {
              studentId = generateStudentId(grade, classNo, countSoFar);
              autoGenNotes.push(`${studentName}(${studentId})`);
            } else {
              conflictWarnings.push(`第 ${rowIdx + 2} 行：同班同名「${studentName}」，请手动补充学号区分`);
              continue;
            }
          }
        } else {
          if (parsedRowIds.has(studentId)) {
            conflictWarnings.push(`学号「${studentId}」重复出现：${studentName}，请核查`);
            continue;
          }
          parsedRowIds.add(studentId);
        }

        const scores = {};
        targetSubjects.forEach((sn) => {
          // 使用列名映射找到对应的列
          const colName = Object.keys(colToSubject).find((c) => colToSubject[c] === sn);
          if (colName) {
            const v = row[colName];
            if (v !== "" && v != null && !isNaN(Number(v))) scores[sn] = Number(v);
            else scores[sn] = 0; // 空分数视为0分
          } else {
            scores[sn] = 0; // 没有找到对应列，视为0分
          }
        });

        const oldScores = existingRecord ? { ...existingRecord.scores } : {};

        parsed.push({
          studentId,
          studentName,
          scores,
          oldScores,
          isNew: !existingRecord,
          hasExistingData: !!existingRecord
        });
      }

      if (parsed.length === 0) {
        showToast(conflictWarnings.length ? `未能解析有效学生：${conflictWarnings[0]}` : "未能解析任何有效学生", "error");
        return;
      }

      const subjectNames2 = targetSubjects;
      const autoNote = autoGenNotes.length > 0
        ? `<div style="padding:10px 12px;background:#e6f7ea;border-left:3px solid #1a7f37;border-radius:4px;font-size:12px;margin-bottom:10px">💡 系统已为 ${autoGenNotes.length} 位学生自动分配学号：${autoGenNotes.slice(0, 6).join("、")}${autoGenNotes.length > 6 ? "……" : ""}</div>`
        : "";
      const conflictNote = conflictWarnings.length > 0
        ? `<div style="padding:10px 12px;background:#fff0f0;border-left:3px solid #c0392b;border-radius:4px;font-size:12px;margin-bottom:10px">⚠️ ${conflictWarnings.join("；")}</div>`
        : "";

      const modeNote = isSingleMode
        ? `<div style="padding:10px 12px;background:#e3f2fd;border-left:3px solid #1976d2;border-radius:4px;font-size:12px;margin-bottom:10px">📝 单科上传模式：将更新 <b>${selectedSubject}</b> 科目，已有数据不会被覆盖</div>`
        : "";

      const previewRows = parsed.slice(0, 30).map((r) => {
        const rosterId = showStudentId ? getStudentIdFromRoster(grade, classNo, r.studentName) : "";
        const scoreCells = subjectNames2.map((n) => {
          const newScore = r.scores[n];
          const oldScore = r.oldScores[n];
          if (newScore != null) {
            if (oldScore != null && oldScore !== newScore) {
              return `<td style="color:#d35400"><b>${newScore}</b> <span style="font-size:11px;color:#888">（原${oldScore}）</span></td>`;
            }
            return `<td><b>${newScore}</b></td>`;
          }
          if (oldScore != null) {
            return `<td style="color:#888">${oldScore} <span style="font-size:11px;color:#aaa">（保留）</span></td>`;
          }
          return `<td><span style='color:#ccc'>-</span></td>`;
        }).join("");
        const total = isSingleMode ? "" : `<td><b>${calculateTotal(r.scores, subjects)}</b></td>`;
        return `<tr>${showStudentId ? `<td>${esc(rosterId)}</td>` : ""}<td>${esc(r.studentName)}</td>${scoreCells}${total}<td>${r.isNew ? "<span class='tag tag-info'>新增</span>" : "<span class='tag tag-success'>更新</span>"}</td></tr>`;
      }).join("");

      const preview = `
        <div class="card-title" style="border:none;padding:0;margin-bottom:12px">📋 已解析 ${parsed.length} 名学生 - ${grade} ${classNo}${isSingleMode ? `（${selectedSubject}）` : ""}</div>
        ${modeNote}
        ${autoNote}
        ${conflictNote}
        <div class="review-tip" style="background:#e6f7ea;color:#1a7f37;margin:12px 0">
          ℹ️ 提交后，本班级成绩将<b>直接生效</b>（成绩审核已移除），其他端同步后即可查看。
        </div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr>${showStudentId ? "<th>学号</th>" : ""}<th>姓名</th>${subjectNames2.map((n) => `<th>${n}</th>`).join("")}${isSingleMode ? "" : "<th>总分</th>"}<th>状态</th></tr></thead>
          <tbody>${previewRows}</tbody>
        </table></div>
        ${parsed.length > 30 ? `<p style="text-align:center;color:var(--text-light);margin-top:10px">仅显示前 30 行，共 ${parsed.length} 行</p>` : ""}
        <div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn btn-secondary" onclick="renderUploadScores()">取消</button>
          <button class="btn btn-success" id="confirm_upload">✓ 确认提交（直接生效）</button>
        </div>
      `;
      $("u_preview").innerHTML = preview;

      $("confirm_upload").onclick = () => {
        const examName = $("u_exam").selectedOptions[0].text;
        const existingConfirmed = DB.records.filter((r) => r.examId === examId && r.grade === grade && classNoEquals(r.classNo, classNo) && r.status === "confirmed").length;

        showModal("确认上传", `<div>
          <p>将把 <b>${parsed.length}</b> 名学生${isSingleMode ? `的 <b>${selectedSubject}</b> 成绩` : "成绩"}上传到 <b>${esc(examName)}</b>。</p>
          ${isSingleMode ? `<p style="color:#1976d2;margin-top:8px">📝 单科模式：仅更新 <b>${selectedSubject}</b> 科目，其他科目数据保留不变。</p>` : ""}
          <p style="color:#1a7f37;margin-top:8px">ℹ️ 成绩审核已移除，提交后数据<b>直接生效</b>，其他端同步后即可查看。</p>
          ${existingConfirmed > 0 ? `<p style="color:#28a745;margin-top:8px">✅ 当前班级已有 <b>${existingConfirmed}</b> 条成绩，本次上传将覆盖更新。</p>` : ""}
        </div>`, "✓ 确认上传", () => {
          let newRecords = [];
          let updatedCount = 0;
          let newCount = 0;

          parsed.forEach((p) => {
            const existing = existingRecords[p.studentName];
            if (existing) {
              if (isSingleMode) {
                Object.assign(existing.scores, p.scores);
              } else {
                const allSubjects = subjects.map((s) => s.name);
                allSubjects.forEach((sn) => delete existing.scores[sn]);
                Object.assign(existing.scores, p.scores);
              }
              existing.total = calculateTotal(existing.scores, subjects);
              existing.uploadedBy = currentUser.id;
              existing.uploadedAt = Date.now();
              // 成绩审核已移除：上传即生效，直接设为已确认
              existing.status = "confirmed";
              existing.confirmedAt = Date.now();
              existing.confirmedBy = currentUser.id;
              updatedCount++;
            } else {
              const scores = {};
              targetSubjects.forEach((sn) => { if (p.scores[sn] != null) scores[sn] = p.scores[sn]; });
              const total = calculateTotal(scores, subjects);
              newRecords.push({
                id: uid(), examId, grade, classNo,
                studentId: p.studentId, studentName: p.studentName, scores, total,
                uploadedBy: currentUser.id, uploadedAt: Date.now(),
                // 成绩审核已移除：上传即生效，直接设为已确认
                status: "confirmed",
                confirmedAt: Date.now(),
                confirmedBy: currentUser.id
              });
              newCount++;
            }
          });

          // 移除该班级本次上传学生的旧记录（无论 pending/confirmed，以本次为准）
          const namesToUpdate = new Set(parsed.map((p) => p.studentName));
          DB.records = DB.records.filter((r) => !(
            r.examId === examId && r.grade === grade && classNoEquals(r.classNo, classNo) &&
            namesToUpdate.has(r.studentName)
          ));

          DB.records.push(...newRecords);
          saveDB(DB, examId);

          const msg = `成功更新 ${updatedCount} 条、新增 ${newCount} 条${isSingleMode ? `「${selectedSubject}」科目` : ""}成绩`;
          showToast(msg, "success");
          renderUploadScores();
        });
      };
    } catch (err) {
      showToast("文件解析失败：" + err.message, "error");
      console.error("上传错误:", err);
    }
  };
  reader.onerror = function(err) {
    showToast("文件读取失败：" + err.message, "error");
  };
  reader.readAsArrayBuffer(file);
}

function calculateTotal(scores, subjects) {
  let total = 0;
  subjects.forEach((s) => {
    if (scores[s.name] != null && typeof scores[s.name] === "number") {
      total += scores[s.name];
    }
  });
  return total;
}

// ========== 教务：按班级名单上传全年级成绩 ==========
function renderAcademicUploadScores() {
  if (currentUser.role !== "academic") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  // 教务端仅显示年级统一考试
  const exams = DB.exams.filter((e) => e.grade === grade && !e.isClassExam);
  const subjects = DB.subjects[grade] || [];

  if (subjects.length === 0) {
    $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-icon">⚠️</div><div class="es-title">${grade} 尚未配置学科</div><div class="es-tip">请先进行学科设置</div></div></div>`;
    return;
  }

  if (exams.length === 0) {
    $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-icon">📝</div><div class="es-title">暂无考试</div><div class="es-tip">请先在考试管理中创建考试</div></div></div>`;
    return;
  }

  // 获取当前选中考试的科目配置
  const selectedExam = exams[0];
  const examSubjects = selectedExam.subjects && selectedExam.subjects.length > 0 
    ? selectedExam.subjects 
    : subjects.map((s) => ({ name: s.name, fullScore: s.fullScore }));

  // 渲染科目上传进度（接受 examId 参数，避免依赖未插入的 DOM 元素）
  const renderSubjectProgress = (progressExamId) => {
    const eid = progressExamId || (exams[0] ? exams[0].id : null);
    if (!eid) return `<div style="padding:12px;background:var(--bg-light);border-radius:6px;text-align:center;color:var(--text-light)">暂无考试</div>`;
    
    // 获取学生名单中全年级的学生总数
    const rosterByClass = DB.studentRoster?.[grade] || {};
    const rosterClasses = Object.keys(rosterByClass).sort();
    const allRosterStudents = [];
    rosterClasses.forEach((c) => {
      (rosterByClass[c] || []).forEach((stu) => allRosterStudents.push({ ...stu, classNo: c }));
    });
    const studentCount = allRosterStudents.length;

    if (studentCount === 0) {
      return `<div style="padding:12px;background:var(--bg-light);border-radius:6px;text-align:center;color:var(--text-light)">学生名单为空，请先上传学生名单</div>`;
    }

    // 获取当前考试的成绩记录
    const recs = DB.records.filter((r) => r.examId === eid && r.grade === grade);

    const progressHtml = examSubjects.map((s) => {
      // 已上传分数的学生数量（从名单中过滤）
      const uploaded = allRosterStudents.filter((stu) => {
        const rec = recs.find((r) => r.classNo === stu.classNo && r.studentName === stu.studentName);
        return rec && rec.scores[s.name] != null && rec.scores[s.name] !== "";
      }).length;
      const pct = Math.round((uploaded / studentCount) * 100);
      const color = pct === 100 ? '#1a7f37' : '#1976d2';
      return `<div style="flex:1;min-width:100px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:12px">
          <span>${s.name}</span><span>${uploaded}/${studentCount}</span>
        </div>
        <div style="height:6px;background:var(--border-color);border-radius:3px">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:3px;transition:width 0.3s"></div>
        </div>
      </div>`;
    }).join("");

    return `<div style="padding:12px;background:var(--bg-light);border-radius:6px">
      <div style="font-weight:600;margin-bottom:10px">📊 各科目上传进度（${studentCount} 名学生）</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap">${progressHtml}</div>
    </div>`;
  };

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">📥 按班级名单上传 ${grade} 全年级成绩</div>
      <div class="form-row">
        <div class="form-group" style="flex:1"><label>选择考试</label>
          <select id="a_exam" onchange="window.onAcademicExamChange()">
            ${exams.map((e) => `<option value="${e.id}">${e.name}</option>`).join("")}
          </select>
        </div>
      </div>

      <!-- 科目上传进度 -->
      <div id="a_subject_progress" style="margin-bottom:16px">${renderSubjectProgress()}</div>

      <!-- 上传模式 -->
      <div style="margin-bottom:16px">
        <div style="display:flex;gap:16px;margin-bottom:12px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="radio" name="a_mode" value="full" checked onchange="window.onAcademicModeChange()" /> 全科上传
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="radio" name="a_mode" value="single" onchange="window.onAcademicModeChange()" /> 单科上传
          </label>
        </div>
        <div id="a_subject_select" style="display:none">
          <div style="margin-bottom:8px;font-size:13px;color:var(--text-light)">选择要上传的科目：</div>
          <div id="a_subject_buttons" style="display:flex;flex-wrap:wrap;gap:8px"></div>
        </div>
      </div>

      <div class="form-group" style="display:flex;align-items:flex-end;gap:10px">
        <button class="btn btn-info" onclick="window.downloadAcademicTemplate()">⬇ 下载Excel模板</button>
        <button class="btn btn-secondary" onclick="window.downloadAcademicSingleTemplate()" id="a_dl_single" style="display:none">⬇ 下载单科模板</button>
      </div>

      <div id="a_uploadArea" class="upload-area">
        <div class="ua-icon">📂</div>
        <div class="ua-title" id="a_upload_title">点击选择 Excel 文件（可多选，支持批量上传不同科目文件）</div>
        <div class="ua-tip" id="a_upload_tip">系统自动识别科目列，跨文件同学生自动合并分数</div>
        <input type="file" id="a_file" accept=".xlsx,.xls" multiple style="display:none" />
      </div>

      <div id="a_preview" style="margin-top:20px"></div>

      <div id="a_uploaded_list" style="margin-top:20px"></div>
    </div>
    <div class="card">
      <div class="card-title">📋 Excel 模板说明（按班级名单上传）</div>
      <p style="color:var(--text-light); line-height:1.9;">
        • Excel 首行为表头：<b>学号（可留空）、姓名、班级、${examSubjects.map((s) => s.name).join("、")}</b><br/>
        • <b>「班级」列必填</b>：系统据此按班级拆分并写入成绩<br/>
        • 学号格式：<b>YYYYNN##</b>（年份前缀${DB.studentIdFormat?.yearPrefix || "2026"} + 两位班级号 + 两位班级人数顺序）<br/>
        • <b>学号列为可选</b>：留空时系统自动分配学号（如 20260101）<br/>
        • 支持同一文件中混合多个班级<br/>
        • 科目列名支持自动识别（拼音首字母、英文缩写、模糊匹配等）<br/>
        • 可批量上传多个不同科目的文件，系统自动合并跨文件学生分数<br/>
        • 留空的分数视为0分<br/>
        • 上传后成绩直接生效，如需修改可在下方「已上传成绩管理」中删除
      </p>
    </div>
  `;

  // 渲染科目按钮
  window.renderAcademicSubjectButtons = function () {
    const examId = $("a_exam").value;
    const recs = DB.records.filter((r) => r.examId === examId && r.grade === grade);
    const uploadedSubjects = new Set();
    examSubjects.forEach((s) => {
      const hasScore = recs.some((r) => r.scores[s.name] != null && r.scores[s.name] !== "");
      if (hasScore) uploadedSubjects.add(s.name);
    });

    const container = $("a_subject_buttons");
    container.innerHTML = examSubjects.map((s) => {
      const isUploaded = uploadedSubjects.has(s.name);
      const isSelected = window._aSelectedSubject === s.name;
      const cls = isSelected ? "btn btn-primary" : (isUploaded ? "btn btn-success" : "btn btn-secondary");
      return `<button class="${cls}" onclick="window.selectAcademicSubject('${s.name}')" style="min-width:80px">
        ${isSelected ? "✓" : (isUploaded ? "✓" : "○")} ${s.name}
      </button>`;
    }).join("");
  };

  // 初始化
  window._aSelectedSubject = null;
  renderAcademicSubjectButtons();

  // 考试切换
  window.onAcademicExamChange = function () {
    renderAcademicSubjectProgress();
    renderAcademicSubjectButtons();
  };

  // 模式切换
  window.onAcademicModeChange = function () {
    const mode = document.querySelector('input[name="a_mode"]:checked').value;
    $("a_subject_select").style.display = mode === "single" ? "block" : "none";
    $("a_dl_single").style.display = mode === "single" ? "inline-block" : "none";
    $("a_upload_title").textContent = mode === "single" 
      ? "选择要上传科目的 Excel 文件" 
      : "点击选择多个 Excel 文件（每班一个，可一次框选）";
    window._aSelectedSubject = null;
    renderAcademicSubjectButtons();
  };

  // 选择科目
  window.selectAcademicSubject = function (subjectName) {
    window._aSelectedSubject = subjectName;
    renderAcademicSubjectButtons();
    $("a_preview").innerHTML = "";
  };

  // 渲染进度
  function renderAcademicSubjectProgress() {
    const examId = $("a_exam").value;
    const recs = DB.records.filter((r) => r.examId === examId && r.grade === grade);
    const studentCount = new Set(recs.map((r) => `${r.classNo}|${r.studentName}`)).size;

    if (studentCount === 0) {
      $("a_subject_progress").innerHTML = `<div style="padding:12px;background:var(--bg-light);border-radius:6px;text-align:center;color:var(--text-light)">暂无上传数据</div>`;
      return;
    }

    const progressHtml = examSubjects.map((s) => {
      const uploaded = recs.filter((r) => r.scores[s.name] != null && r.scores[s.name] !== "").length;
      const pct = Math.round((uploaded / studentCount) * 100);
      const color = pct === 100 ? '#1a7f37' : '#1976d2';
      return `<div style="flex:1;min-width:100px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:12px">
          <span>${s.name}</span><span>${uploaded}/${studentCount}</span>
        </div>
        <div style="height:6px;background:var(--border-color);border-radius:3px">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:3px;transition:width 0.3s"></div>
        </div>
      </div>`;
    }).join("");

    $("a_subject_progress").innerHTML = `<div style="padding:12px;background:var(--bg-light);border-radius:6px">
      <div style="font-weight:600;margin-bottom:10px">📊 各科目上传进度（${studentCount} 名学生）</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap">${progressHtml}</div>
    </div>`;
  }

  const ua = $("a_uploadArea");
  ua.onclick = () => {
    const mode = document.querySelector('input[name="a_mode"]:checked').value;
    if (mode === "single" && !window._aSelectedSubject) {
      showToast("请先选择要上传的科目", "warning");
      return;
    }
    $("a_file").click();
  };
  ua.addEventListener("dragover", (e) => { e.preventDefault(); ua.classList.add("dragover"); });
  ua.addEventListener("dragleave", () => ua.classList.remove("dragover"));
  ua.addEventListener("drop", (e) => {
    e.preventDefault(); ua.classList.remove("dragover");
    const mode = document.querySelector('input[name="a_mode"]:checked').value;
    if (mode === "single" && !window._aSelectedSubject) {
      showToast("请先选择要上传的科目", "warning");
      return;
    }
    if (e.dataTransfer.files.length) handleAcademicExcelFile(e.dataTransfer.files);
  });
  $("a_file").addEventListener("change", (e) => {
    if (e.target.files.length) handleAcademicExcelFile(e.target.files);
  });

  window.renderAcademicUploadedList = function () {
    const examId = $("a_exam").value;
    const recs = DB.records.filter((r) => r.examId === examId && r.grade === grade);
    
    if (recs.length === 0) {
      $("a_uploaded_list").innerHTML = "";
      return;
    }

    const classGroups = {};
    recs.forEach((r) => {
      if (!classGroups[r.classNo]) classGroups[r.classNo] = [];
      classGroups[r.classNo].push(r);
    });

    let html = `<div class="card" style="margin-top:0">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
        🗑️ 已上传成绩管理（${recs.length} 条记录）
        <button class="btn btn-danger btn-sm" onclick="window.clearAllAcademicScores()">清空全部成绩</button>
      </div>
      <div style="max-height:400px;overflow-y:auto">`;

    Object.keys(classGroups).sort().forEach((cls) => {
      const classRecs = classGroups[cls];
      html += `<div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border-color)">
        <div style="font-weight:600;margin-bottom:8px">${cls}（${classRecs.length}人）</div>
        <div class="table-wrap"><table class="data-table" style="font-size:12px">
          <thead><tr>
            <th style="width:20px">序号</th>
            <th>学号</th>
            <th>姓名</th>
            ${examSubjects.map((s) => `<th>${s.name}</th>`).join("")}
            <th style="width:80px">操作</th>
          </tr></thead>
          <tbody>`;

      classRecs.forEach((r, idx) => {
        const scoreCells = examSubjects.map((s) => {
          const val = r.scores[s.name];
          return `<td>${val != null ? val : "-"}</td>`;
        }).join("");
        html += `<tr>
          <td>${idx + 1}</td>
          <td>${r.studentId || "-"}</td>
          <td>${r.studentName}</td>
          ${scoreCells}
          <td><button class="btn btn-danger btn-xs" onclick="window.deleteAcademicScore('${r.id}')">删除</button></td>
        </tr>`;
      });

      html += `</tbody></table></div>
        <button class="btn btn-danger btn-sm" onclick="window.deleteClassAcademicScores('${cls}')" style="margin-top:8px">删除${cls}全部成绩</button>
      </div>`;
    });

    html += `</div></div>`;
    $("a_uploaded_list").innerHTML = html;
  };

  window.deleteAcademicScore = function (recordId) {
    if (!confirm("确定要删除这条成绩记录吗？")) return;
    const idx = DB.records.findIndex((r) => r.id === recordId);
    if (idx > -1) {
      DB.records.splice(idx, 1);
      saveDB(DB);
      showToast("已删除", "success");
      renderAcademicUploadedList();
      renderAcademicSubjectProgress();
      renderAcademicSubjectButtons();
    }
  };

  window.deleteClassAcademicScores = function (classNo) {
    if (!confirm(`确定要删除${classNo}的全部成绩吗？`)) return;
    const examId = $("a_exam").value;
    DB.records = DB.records.filter((r) => !(r.examId === examId && r.grade === grade && r.classNo === classNo));
    saveDB(DB);
    showToast(`${classNo}成绩已删除`, "success");
    renderAcademicUploadedList();
    renderAcademicSubjectProgress();
    renderAcademicSubjectButtons();
  };

  window.clearAllAcademicScores = function () {
    if (!confirm("确定要清空本次考试的全部成绩吗？此操作不可撤销！")) return;
    const examId = $("a_exam").value;
    DB.records = DB.records.filter((r) => !(r.examId === examId && r.grade === grade));
    saveDB(DB);
    showToast("全部成绩已清空", "success");
    renderAcademicUploadedList();
    renderAcademicSubjectProgress();
    renderAcademicSubjectButtons();
  };

  renderAcademicUploadedList();
}

window.downloadAcademicTemplate = function () {
  const grade = currentUser.grade;
  const examId = $("a_exam")?.value;
  const exam = examId ? DB.exams.find((e) => e.id === examId) : null;
  const subjects = exam && exam.subjects && exam.subjects.length > 0 
    ? exam.subjects 
    : (DB.subjects[grade] || []);
  
  const headers = ["学号（可留空）", "姓名", "班级", ...subjects.map((s) => s.name)];
  const rows = [headers];
  const sampleClasses = ["1班", "2班", "3班"];
  sampleClasses.forEach((c) => {
    for (let i = 1; i <= 3; i++) {
      rows.push([
        "",
        `${c}学生${i}`,
        c,
        ...subjects.map((s) => Math.floor(Math.random() * (s.fullScore || 100)))
      ]);
    }
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "全年级成绩");
  XLSX.writeFile(wb, `${grade}_全年级成绩模板.xlsx`);
  showToast("模板已下载", "success");
};

window.downloadAcademicSingleTemplate = function () {
  if (!window._aSelectedSubject) {
    showToast("请先选择科目", "warning");
    return;
  }
  const grade = currentUser.grade;
  const subject = window._aSelectedSubject;
  const headers = ["学号（可留空）", "姓名", "班级", subject];
  const rows = [headers];
  const sampleClasses = ["1班", "2班", "3班"];
  sampleClasses.forEach((c) => {
    for (let i = 1; i <= 3; i++) {
      rows.push(["", `${c}学生${i}`, c, Math.floor(Math.random() * 80 + 20)]);
    }
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${subject}成绩`);
  XLSX.writeFile(wb, `${grade}_${subject}_成绩模板.xlsx`);
  showToast(`「${subject}」模板已下载`, "success");
};

function handleAcademicExcelFile(fileList) {
  const files = Array.from(fileList);
  if (files.length === 0) return;

  const grade = currentUser.grade;
  const examId = $("a_exam").value;
  const exam = DB.exams.find((e) => e.id === examId);
  const gradeSubjects = DB.subjects[grade] || [];
  const examSubjects = exam && exam.subjects && exam.subjects.length > 0 
    ? exam.subjects 
    : gradeSubjects.map((s) => ({ name: s.name, fullScore: s.fullScore }));
  const showStudentId = hasRoster(grade);
  const mode = document.querySelector('input[name="a_mode"]:checked')?.value || "full";
  const selectedSubject = window._aSelectedSubject || null;
  const isSingleMode = mode === "single" && selectedSubject;

  // 确定要解析的科目
  const targetSubjects = isSingleMode ? [selectedSubject] : examSubjects.map((s) => s.name);

  // 获取学生名单，构建"班级+姓名 → 学号"映射
  const rosterByClass = DB.studentRoster?.[grade] || {};
  const rosterStudentMap = {}; // key: "班级|姓名" -> {studentId, studentName, classNo}
  Object.keys(rosterByClass).forEach((c) => {
    (rosterByClass[c] || []).forEach((stu) => {
      const key = `${c}|${stu.studentName}`;
      rosterStudentMap[key] = stu;
    });
  });
  const hasStudentRoster = Object.keys(rosterStudentMap).length > 0;

  // 从已有成绩数据中，构建"班级+姓名 → 记录"映射
  const existingRecords = {};
  DB.records.filter((r) => r.examId === examId && r.grade === grade).forEach((r) => {
    const key = `${r.classNo}|${r.studentName}`;
    if (!existingRecords[key]) existingRecords[key] = r;
  });

  const allParsed = [];
  const conflictWarnings = [];
  const autoGenNotes = [];
  const notInRosterWarnings = [];
  const dataErrors = [];   // 详细数据错误报告：{file, row, student, subject, problem, severity}
  const classStat = {};
  const classCounter = {};
  const globalRowIds = new Set();
  const totalFiles = files.length;

  // 科目满分查询：优先用本场考试的科目配置，回退年级学科库
  const subjectFullScore = (sn) => {
    const es = examSubjects.find((s) => s.name === sn);
    if (es && es.fullScore) return es.fullScore;
    const gs = gradeSubjects.find((s) => s.name === sn);
    return gs && gs.fullScore ? gs.fullScore : 100;
  };
  const seenKeys = new Set(); // 用于检测同一学生跨文件重复

  function parseSingleFile(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = function (e) {
        try {
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

          if (rows.length === 0) { resolve(true); return; }

          // 建立列名到科目的映射（支持模糊匹配，与班主任端一致）
          const firstRow = rows[0] || {};
          const colToSubject = {};
          Object.keys(firstRow).forEach((col) => {
            const colTrim = col.trim();
            const direct = targetSubjects.find((s) => s === colTrim);
            if (direct) { colToSubject[col] = direct; return; }
            const fuzzy = targetSubjects.find((s) => colTrim.includes(s) || s.includes(colTrim));
            if (fuzzy) { colToSubject[col] = fuzzy; return; }
            const withoutBracket = colTrim.replace(/\（[^）]*\）/g, "").replace(/\([^)]*\)/g, "").trim();
            if (withoutBracket !== colTrim) {
              const bracketMatch = targetSubjects.find((s) => s === withoutBracket);
              if (bracketMatch) { colToSubject[col] = bracketMatch; return; }
            }
          });
          console.log("[教务上传] 列名映射:", colToSubject);
          console.log("[教务上传] targetSubjects:", targetSubjects);

          // 智能识别学号、姓名、班级列（带回退）
          const allKeys = Object.keys(firstRow);
          console.log("[教务上传] Excel第一行列名:", allKeys);
          let studentIdCol = null, studentNameCol = null, classCol = null;
          const idPatterns = ["学号", "编号", "号码", "id", "ID", "student_id", "StudentID"];
          const namePatterns = ["姓名", "名字", "name", "Name", "student_name", "StudentName", "学生"];
          const classPatterns = ["班级", "班别", "class", "Class", "classNo", "class_name"];
          for (const k of allKeys) {
            if (!studentIdCol && idPatterns.some((p) => k.includes(p))) studentIdCol = k;
            if (!studentNameCol && namePatterns.some((p) => k.includes(p))) studentNameCol = k;
            if (!classCol && classPatterns.some((p) => k.includes(p))) classCol = k;
          }
          // 回退：如果智能识别不到，用原来的硬编码列名
          if (!studentIdCol && allKeys.includes("学号")) studentIdCol = "学号";
          if (!studentIdCol && allKeys.includes("学号（可留空）")) studentIdCol = "学号（可留空）";
          if (!studentNameCol && allKeys.includes("姓名")) studentNameCol = "姓名";
          if (!classCol && allKeys.includes("班级")) classCol = "班级";

          for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
            const row = rows[rowIdx];
            let studentId = String((studentIdCol ? row[studentIdCol] : "") || "").trim();
            const studentName = String((studentNameCol ? row[studentNameCol] : "") || "").trim();
            let classNoRaw = String((classCol ? row[classCol] : "") || "").trim();
            const classNo = displayClassNo(classNoRaw) || classNoRaw;
            if (!studentName) continue;
            if (!classNo || classNo === "") {
              conflictWarnings.push(`文件「${file.name}」第${rowIdx + 2}行学生「${studentName}」缺少班级信息`);
              continue;
            }

            const key = `${classNo}|${studentName}`;
            const rosterInfo = rosterStudentMap[key];
            
            // 如果有学生名单，检查是否在名单中
            if (hasStudentRoster && !rosterInfo) {
              notInRosterWarnings.push(`「${studentName}」（${classNo}）不在名单中，已忽略`);
              continue;
            }

            const existing = existingRecords[key];

            if (!studentId) {
              if (rosterInfo && rosterInfo.studentId) {
                studentId = rosterInfo.studentId;
              } else if (existing && existing.studentId) {
                studentId = existing.studentId;
              } else {
                // 使用新的学号生成格式：YYYYNN##
                const classPrefix = classNo.replace(/\D/g, '') || "1";
                classCounter[classPrefix] = (classCounter[classPrefix] || 0) + 1;
                studentId = generateStudentId(grade, classNo, classCounter[classPrefix]);
                autoGenNotes.push(`${classNo} ${studentName}(${studentId})`);
              }
            } else {
              if (globalRowIds.has(studentId)) {
                conflictWarnings.push(`学号「${studentId}」重复：${studentName}`);
                continue;
              }
              globalRowIds.add(studentId);
            }

            const scores = {};
            // 调试：打印第一行的分数读取过程
            if (rowIdx === 1) {
              console.log("[教务上传] 第一行原始数据:", row);
              console.log("[教务上传] colToSubject:", colToSubject);
            }
            targetSubjects.forEach((sn) => {
              // 先通过列名映射找
              const colName = Object.keys(colToSubject).find((c) => colToSubject[c] === sn);
              let rawValue = null;
              let hasColumn = false;
              if (colName) {
                hasColumn = true;
                rawValue = row[colName];
                if (rowIdx === 1) console.log(`[教务上传] 科目[${sn}] <- 列[${colName}] = ${JSON.stringify(rawValue)}`);
              } else if (row[sn] !== undefined) {
                // 回退：直接用科目名作为列名（原逻辑）
                hasColumn = true;
                rawValue = row[sn];
                if (rowIdx === 1) console.log(`[教务上传] 科目[${sn}] <- 回退列[${sn}] = ${JSON.stringify(rawValue)}`);
              }
              if (!hasColumn) {
                scores[sn] = 0;
                // 列缺失（仅第一行记录一次，避免重复刷屏）
                if (rowIdx === 0) {
                  dataErrors.push({ file: file.name, row: rowIdx + 2, student: "（表头）", subject: sn, problem: `Excel 中找不到「${sn}」科目列（已按 0 分处理）`, severity: "warning" });
                }
                return;
              }
              // 校验分数值
              if (rawValue === "" || rawValue == null) {
                scores[sn] = 0;
                dataErrors.push({ file: file.name, row: rowIdx + 2, student: studentName, subject: sn, problem: `分数为空（已按 0 分处理）`, severity: "warning" });
              } else if (isNaN(Number(rawValue))) {
                scores[sn] = 0;
                dataErrors.push({ file: file.name, row: rowIdx + 2, student: studentName, subject: sn, problem: `分数不是数字（值：${String(rawValue).slice(0, 20)}，已按 0 分处理）`, severity: "error" });
              } else {
                const num = Number(rawValue);
                scores[sn] = num;
                if (num < 0) {
                  dataErrors.push({ file: file.name, row: rowIdx + 2, student: studentName, subject: sn, problem: `分数为负数（${num}，已照常导入）`, severity: "error" });
                }
                const fs = subjectFullScore(sn);
                if (num > fs) {
                  dataErrors.push({ file: file.name, row: rowIdx + 2, student: studentName, subject: sn, problem: `分数超过满分（${num}/${fs}，已照常导入）`, severity: "error" });
                }
              }
            });
            if (rowIdx === 1) console.log("[教务上传] 第一行解析结果:", scores);

            // 检查同一学生跨文件重复
            const dupKey = `${classNo}|${studentName}`;
            if (seenKeys.has(dupKey)) {
              dataErrors.push({ file: file.name, row: rowIdx + 2, student: studentName, subject: "—", problem: `该学生在其他文件中已出现（${classNo}），本次将覆盖之前的数据`, severity: "warning" });
            } else {
              seenKeys.add(dupKey);
            }

            allParsed.push({
              classNo, studentId, studentName, scores,
              existingScores: existing ? { ...existing.scores } : {},
              isUpdate: !!existing
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

  (async function () {
    for (let i = 0; i < files.length; i++) {
      await parseSingleFile(files[i]);
    }

    allParsed.push(...Object.values(parsedMap || {}));

    if (allParsed.length === 0) {
      showToast(conflictWarnings.length ? `未能解析：${conflictWarnings[0]}` : "未能解析有效学生", "error");
      return;
    }

    const classList = Object.keys(classStat).sort();
    const classInfo = classList.map((c) => `${c}（${classStat[c]}人）`).join("、");

    const autoNote = autoGenNotes.length > 0
      ? `<div style="padding:10px 12px;background:#e6f7ea;border-left:3px solid #1a7f37;border-radius:4px;font-size:12px;margin-bottom:10px">💡 已为 ${autoGenNotes.length} 位学生自动分配学号</div>`
      : "";
    const conflictNote = conflictWarnings.length > 0
      ? `<div style="padding:10px 12px;background:#fff0f0;border-left:3px solid #c0392b;border-radius:4px;font-size:12px;margin-bottom:10px">⚠️ ${conflictWarnings.slice(0, 5).join("；")}${conflictWarnings.length > 5 ? "……" : ""}</div>`
      : "";
    const notInRosterNote = notInRosterWarnings.length > 0
      ? `<div style="padding:10px 12px;background:#fff8e1;border-left:3px solid #f9a825;border-radius:4px;font-size:12px;margin-bottom:10px">🚫 已过滤 ${notInRosterWarnings.length} 位名单外学生：${notInRosterWarnings.slice(0, 3).join("；")}${notInRosterWarnings.length > 3 ? "……" : ""}</div>`
      : "";
    const modeNote = isSingleMode
      ? `<div style="padding:10px 12px;background:#e3f2fd;border-left:3px solid #1976d2;border-radius:4px;font-size:12px;margin-bottom:10px">📝 单科上传模式：仅更新「${selectedSubject}」科目数据</div>`
      : "";

    const previewRows = allParsed.slice(0, 40).map((r) => {
      const rosterId = showStudentId ? getStudentIdFromRoster(grade, r.classNo, r.studentName) : "";
      const scoreCells = targetSubjects.map((sn) => {
        const newScore = r.scores[sn];
        const oldScore = r.existingScores[sn];
        if (newScore != null) {
          if (oldScore != null && oldScore !== newScore) {
            return `<td style="color:#d35400"><b>${newScore}</b> <span style="font-size:11px">（原${oldScore}）</span></td>`;
          }
          return `<td><b>${newScore}</b></td>`;
        }
        if (oldScore != null) {
          return `<td style="color:#888">${oldScore} <span style="font-size:11px">（保留）</span></td>`;
        }
        return `<td><span style='color:#ccc'>-</span></td>`;
      }).join("");
      return `<tr>${showStudentId ? `<td>${esc(rosterId)}</td>` : ""}<td>${esc(r.studentName)}</td>${scoreCells}<td>${r.isUpdate ? "<span class='tag tag-success'>更新</span>" : "<span class='tag tag-info'>新增</span>"}</td></tr>`;
    }).join("");

    // ===== 数据错误详细解读报告（需求3）=====
    const errCount = dataErrors.length;
    const errErrorCount = dataErrors.filter((e) => e.severity === "error").length;
    const errWarnCount = dataErrors.filter((e) => e.severity === "warning").length;
    let errorReport = "";
    if (errCount > 0) {
      // 按文件分组统计
      const fileGroup = {};
      dataErrors.forEach((e) => {
        const k = e.file || "（未知文件）";
        if (!fileGroup[k]) fileGroup[k] = [];
        fileGroup[k].push(e);
      });
      const fileSummary = Object.keys(fileGroup).map((f) => {
        const arr = fileGroup[f];
        const ec = arr.filter((x) => x.severity === "error").length;
        const wc = arr.filter((x) => x.severity === "warning").length;
        return `<span style="display:inline-block;margin:2px 6px 2px 0;padding:2px 8px;background:#f1f3f5;border-radius:10px;font-size:12px">${esc(f)}：共 ${arr.length} 条${ec ? `（❌${ec}）` : ""}${wc ? `（⚠️${wc}）` : ""}</span>`;
      }).join("");
      const errorRowsHtml = dataErrors.map((e) => {
        const sevClass = e.severity === "error" ? "err-err" : "err-warn";
        const sevBadge = e.severity === "error"
          ? `<span class="err-badge err-badge-error">❌ 错误</span>`
          : `<span class="err-badge err-badge-warn">⚠️ 警告</span>`;
        return `<tr class="${sevClass}">
          <td>${esc(e.file || "—")}</td>
          <td style="text-align:center">${e.row || "—"}</td>
          <td>${esc(e.student || "—")}</td>
          <td>${esc(e.subject || "—")}</td>
          <td>${esc(e.problem || "—")}</td>
          <td style="text-align:center">${sevBadge}</td>
        </tr>`;
      }).join("");
      errorReport = `
        <div class="err-report-box">
          <div class="err-report-head">
            <span class="err-report-title">📋 数据错误详细解读</span>
            <span class="err-report-stat">共 ${errCount} 条 · <span class="err-c-error">❌ 错误 ${errErrorCount}</span> · <span class="err-c-warn">⚠️ 警告 ${errWarnCount}</span></span>
          </div>
          <div class="err-report-tip">
            <b>说明：</b>行号 = Excel 中实际行号（含表头，第 1 行为表头，第 2 行起为数据）。
            <b style="color:#e74c3c">错误</b>类问题表示数据本身不合法（非数字/负数/超满分），已强制按 0 分或照常导入，<u>请核对源文件后重新上传</u>；
            <b style="color:#f39c12">警告</b>类问题表示数据缺失或重复（空值/列缺失/跨文件重复），系统已自动处理，但建议复核。
          </div>
          <div class="err-file-summary">${fileSummary}</div>
          <div class="table-wrap"><table class="data-table err-table">
            <thead><tr>
              <th>文件</th><th style="width:60px">行</th><th>学生</th><th>科目</th><th>问题说明</th><th style="width:80px">级别</th>
            </tr></thead>
            <tbody>${errorRowsHtml}</tbody>
          </table></div>
        </div>`;
    } else {
      errorReport = `<div class="err-report-ok">✅ 数据校验通过，未发现错误（共解析 ${allParsed.length} 名学生，${totalFiles} 个文件）</div>`;
    }

    $("a_preview").innerHTML = `
      <div class="card-title" style="border:none;padding:0;margin-bottom:12px">
        📋 已解析 ${totalFiles} 个文件 · ${allParsed.length} 名学生 · ${isSingleMode ? `（${selectedSubject}）` : ""}
      </div>
      ${modeNote}
      ${autoNote}
      ${notInRosterNote}
      ${conflictNote}
      ${errorReport}
      <div class="table-wrap"><table class="data-table">
        <thead><tr>${showStudentId ? "<th>学号</th>" : ""}<th>姓名</th>${targetSubjects.map((n) => `<th>${n}</th>`).join("")}<th>状态</th></tr></thead>
        <tbody>${previewRows}</tbody>
      </table></div>
      ${allParsed.length > 40 ? `<p style="text-align:center;color:var(--text-light);margin-top:10px">仅显示前 40 行，共 ${allParsed.length} 行</p>` : ""}
      <div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end">
        <button class="btn btn-secondary" onclick="renderAcademicUploadScores()">取消</button>
        <button class="btn btn-success" id="a_confirm_upload">✓ 确认导入</button>
      </div>
    `;

    $("a_confirm_upload").onclick = () => {
      let newCount = 0, updateCount = 0, zeroCount = 0;

      allParsed.forEach((p) => {
        const key = `${p.classNo}|${p.studentName}`;
        const existing = existingRecords[key];

        if (existing) {
          // 更新现有记录
          if (isSingleMode) {
            Object.assign(existing.scores, p.scores);
          } else {
            gradeSubjects.forEach((s) => delete existing.scores[s.name]);
            Object.assign(existing.scores, p.scores);
          }
          existing.total = 0;
          gradeSubjects.forEach((s) => {
            if (existing.scores[s.name] != null) existing.total += existing.scores[s.name];
          });
          existing.uploadedBy = currentUser.id;
          existing.uploadedAt = Date.now();
          // 成绩审核已移除：上传即生效，直接设为已确认
          existing.status = "confirmed";
          existing.confirmedAt = Date.now();
          existing.confirmedBy = currentUser.id;
          updateCount++;
        } else {
          // 新建记录
          const scores = {};
          targetSubjects.forEach((sn) => { if (p.scores[sn] != null) scores[sn] = p.scores[sn]; });
          let total = 0;
          gradeSubjects.forEach((s) => {
            if (scores[s.name] != null) total += scores[s.name];
          });
          DB.records.push({
            id: uid(), examId, grade, classNo: p.classNo,
            studentId: p.studentId, studentName: p.studentName, scores, total,
            uploadedBy: currentUser.id, uploadedAt: Date.now(),
            // 成绩审核已移除：上传即生效，直接设为已确认
            status: "confirmed",
            confirmedAt: Date.now(),
            confirmedBy: currentUser.id
          });
          newCount++;
        }
      });

      // 为名单内但未上传的学生补零分
      if (hasStudentRoster) {
        Object.keys(rosterStudentMap).forEach((key) => {
          const rosterStu = rosterStudentMap[key];
          // 如果已有该学生的成绩记录，跳过
          if (existingRecords[key]) return;
          // 如果本次导入中已有该学生（可能在名单检查之前就添加了），跳过
          const imported = allParsed.find((p) => `${p.classNo}|${p.studentName}` === key);
          if (imported) return;

          // 检查是否已有该学生的零分记录
          const existingZeroRec = DB.records.find((r) => 
            r.examId === examId && r.grade === grade && 
            r.classNo === rosterStu.classNo && r.studentName === rosterStu.studentName
          );
          if (existingZeroRec) return; // 已有记录，跳过

          // 为该学生创建零分记录
          const scores = {};
          let total = 0;
          gradeSubjects.forEach((s) => {
            scores[s.name] = 0;
          });
          DB.records.push({
            id: uid(), examId, grade, classNo: rosterStu.classNo,
            studentId: rosterStu.studentId || `${rosterStu.classNo}-000`,
            studentName: rosterStu.studentName, scores, total,
            uploadedBy: currentUser.id, uploadedAt: Date.now(),
            // 成绩审核已移除：上传即生效，直接设为已确认
            status: "confirmed",
            confirmedAt: Date.now(),
            confirmedBy: currentUser.id,
            isZeroFill: true  // 标记为零分补录
          });
          zeroCount++;
        });
      }

      saveDB(DB, examId);
      let msg = `成功新增 ${newCount} 条、更新 ${updateCount} 条`;
      if (zeroCount > 0) msg += `、补零分 ${zeroCount} 条`;
      msg += isSingleMode ? `「${selectedSubject}」科目` : "";
      showToast(msg, "success");
      $("a_preview").innerHTML = "";
      if (window.onAcademicExamChange) window.onAcademicExamChange();
      if (window.renderAcademicUploadedList) window.renderAcademicUploadedList();
    };
  })();
}

// ========== 教务：按考场名单上传全年级成绩 ==========
function renderAcademicUploadExamroom() {
  if (currentUser.role !== "academic") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const exams = DB.exams.filter((e) => e.grade === grade && !e.isClassExam);
  const subjects = DB.subjects[grade] || [];

  if (subjects.length === 0) {
    $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-icon">⚠️</div><div class="es-title">${grade} 尚未配置学科</div><div class="es-tip">请先进行学科设置</div></div></div>`;
    return;
  }

  if (exams.length === 0) {
    $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-icon">📝</div><div class="es-title">暂无考试</div><div class="es-tip">请先在考试管理中创建考试</div></div></div>`;
    return;
  }

  const selectedExam = exams[0];
  const examSubjects = selectedExam.subjects && selectedExam.subjects.length > 0 
    ? selectedExam.subjects 
    : subjects.map((s) => ({ name: s.name, fullScore: s.fullScore }));

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">🏫 按考场名单上传 ${grade} 全年级成绩</div>
      <div class="form-row">
        <div class="form-group" style="flex:1"><label>选择考试</label>
          <select id="er_exam" onchange="window.onExamroomExamChange()">
            ${exams.map((e) => `<option value="${e.id}">${e.name}</option>`).join("")}
          </select>
        </div>
      </div>

      <div style="margin-bottom:16px">
        <div id="er_subject_select">
          <div style="margin-bottom:8px;font-size:13px;color:var(--text-light)">各科目上传进度（绿色=已上传，点击可多选指定科目）：</div>
          <div id="er_subject_buttons" style="display:flex;flex-wrap:wrap;gap:8px"></div>
        </div>
      </div>

      <div class="form-group" style="display:flex;align-items:flex-end;gap:10px">
        <button class="btn btn-info" onclick="window.downloadExamroomTemplate()">⬇ 下载Excel模板</button>
      </div>

      <div id="er_uploadArea" class="upload-area">
        <div class="ua-icon">📂</div>
        <div class="ua-title" id="er_upload_title">选择 Excel 文件上传（系统自动识别科目，支持批量上传不同科目）</div>
        <div class="ua-tip" id="er_upload_tip">系统自动从表头识别科目，可一次上传多个不同科目的文件</div>
        <input type="file" id="er_file" accept=".xlsx,.xls" multiple style="display:none" />
      </div>

      <div id="er_preview" style="margin-top:20px"></div>
    </div>
    <div class="card">
      <div class="card-title">📋 Excel 模板说明（按考场名单上传）</div>
      <p style="color:var(--text-light); line-height:1.9;">
        • Excel 首行为表头：<b>考号、姓名、科目名</b>（可包含一个或多个科目列）<br/>
        • <b>「考号」列必填</b>：纯数字，后6位固定为座位(2位)+班级(2位)+序号(2位)，前面为考场号<br/>
        • <b>7位考号</b>：考场号(1位) + 座位(2位) + 班级(2位) + 序号(2位)<br/>
        &nbsp;&nbsp;示例：<b>1020307</b> = 1考场02座，3班07位<br/>
        • <b>8位考号</b>：考场号(2位) + 座位(2位) + 班级(2位) + 序号(2位)<br/>
        &nbsp;&nbsp;示例：<b>10031003</b> = 10考场03座，10班03位<br/>
        &nbsp;&nbsp;示例：<b>11151023</b> = 11考场15座，10班23位<br/>
        • <b>「姓名」列必填</b>：用于匹配学生名单<br/>
        • 科目列名支持自动识别（拼音首字母、英文缩写、模糊匹配、文件名推断等）<br/>
        • 支持批量上传多个不同科目的文件，系统自动合并跨文件学生分数<br/>
        • 留空的分数视为0分<br/>
        • 上传后成绩直接生效
      </p>
    </div>
  `;

  window.renderExamroomSubjectButtons = function () {
    const examId = $("er_exam").value;
    const exam = DB.exams.find((e) => e.id === examId);
    const grade = currentUser.grade;
    const gradeSubjects = DB.subjects[grade] || [];
    const examSubjects = exam && exam.subjects && exam.subjects.length > 0 
      ? exam.subjects 
      : gradeSubjects.map((s) => ({ name: s.name, fullScore: s.fullScore }));
    
    const recs = DB.records.filter((r) => r.examId === examId && r.grade === grade);
    const uploadedSubjects = new Set();
    examSubjects.forEach((s) => {
      const hasScore = recs.some((r) => r.scores[s.name] != null && r.scores[s.name] !== "");
      if (hasScore) uploadedSubjects.add(s.name);
    });

    const container = $("er_subject_buttons");
    container.innerHTML = examSubjects.map((s) => {
      const isUploaded = uploadedSubjects.has(s.name);
      const isSelected = window._erSelectedSubjects.includes(s.name);
      const cls = isSelected ? "btn btn-primary" : (isUploaded ? "btn btn-success" : "btn btn-secondary");
      return `<button class="${cls}" onclick="window.toggleExamroomSubject('${s.name}')" style="min-width:80px">
        ${isSelected ? "✓" : (isUploaded ? "✓" : "○")} ${s.name}
      </button>`;
    }).join("");
  };

  window._erSelectedSubjects = [];
  renderExamroomSubjectButtons();

  window.onExamroomExamChange = function () {
    window._erSelectedSubjects = [];
    renderExamroomSubjectButtons();
  };

  window.toggleExamroomSubject = function (subjectName) {
    const idx = window._erSelectedSubjects.indexOf(subjectName);
    if (idx > -1) {
      window._erSelectedSubjects.splice(idx, 1);
    } else {
      window._erSelectedSubjects.push(subjectName);
    }
    renderExamroomSubjectButtons();
    $("er_preview").innerHTML = "";
  };

  const ua = $("er_uploadArea");
  ua.onclick = () => {
    $("er_file").click();
  };
  ua.addEventListener("dragover", (e) => { e.preventDefault(); ua.classList.add("dragover"); });
  ua.addEventListener("dragleave", () => ua.classList.remove("dragover"));
  ua.addEventListener("drop", (e) => {
    e.preventDefault(); ua.classList.remove("dragover");
    if (e.dataTransfer.files.length) handleExamroomExcelFile(e.dataTransfer.files);
  });
  $("er_file").addEventListener("change", (e) => {
    if (e.target.files.length) handleExamroomExcelFile(e.target.files);
  });
}

window.downloadExamroomTemplate = function () {
  const grade = currentUser.grade;
  const examId = $("er_exam")?.value;
  const exam = examId ? DB.exams.find((e) => e.id === examId) : null;
  const subjects = exam && exam.subjects && exam.subjects.length > 0 
    ? exam.subjects 
    : (DB.subjects[grade] || []);
  
  const headers = ["考号", "姓名", ...subjects.map((s) => s.name)];
  const rows = [headers];
  // 生成7位考号示例：考场号(1位) + 座位号(2位) + 班级号(2位) + 学生序号(2位)
  const sampleRooms = [1, 2];
  sampleRooms.forEach((room) => {
    for (let seat = 1; seat <= 3; seat++) {
      const classNo = room;
      const seq = seat;
      // 7位考号：考场号(1位) + 座位号(2位) + 班级号(2位) + 学生序号(2位)
      const examNo = `${room}${String(seat).padStart(2, '0')}${String(classNo).padStart(2, '0')}${String(seq).padStart(2, '0')}`;
      rows.push([
        examNo,
        `${classNo}班学生${seq}`,
        ...subjects.map((s) => Math.floor(Math.random() * (s.fullScore || 100)))
      ]);
    }
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "考场成绩");
  XLSX.writeFile(wb, `${grade}_考场成绩模板.xlsx`);
  showToast("模板已下载", "success");
};

function parseExamNo(examNo) {
  const str = String(examNo).trim();
  const len = str.length;
  
  // 考号格式：考场号(1~2位) + 座位号(2位) + 班级号(2位) + 学生序号(2位)
  // 后6位固定为 座位(2) + 班级(2) + 序号(2)，剩余前缀为考场号
  // 示例：
  //   1020307   → 1考场02座，03班07位
  //   10031003  → 10考场03座，10班03位
  //   11151023  → 11考场15座，10班23位
  if (len < 7 || !/^\d+$/.test(str)) return null;
  
  const seat = parseInt(str.substring(len - 6, len - 4));
  const classNum = parseInt(str.substring(len - 4, len - 2));
  const seq = parseInt(str.substring(len - 2));
  const room = parseInt(str.substring(0, len - 6));
  
  if (isNaN(room) || isNaN(seat) || isNaN(classNum) || isNaN(seq)) return null;
  
  return {
    room, seat, classNum, seq,
    classNo: classNum + "班",
    desc: `${room}考场${seat}座，${classNum}班第${seq}位`
  };
}

function handleExamroomExcelFile(fileList) {
  const files = Array.from(fileList);
  if (files.length === 0) return;

  const grade = currentUser.grade;
  const examId = $("er_exam").value;
  const exam = DB.exams.find((e) => e.id === examId);
  const gradeSubjects = DB.subjects[grade] || [];
  const examSubjects = exam && exam.subjects && exam.subjects.length > 0 
    ? exam.subjects 
    : gradeSubjects.map((s) => ({ name: s.name, fullScore: s.fullScore }));
  const mode = "single";
  const selectedSubjects = window._erSelectedSubjects || [];
  const isSingleMode = true;
  // 如果用户选择了特定科目，则只处理这些科目；否则自动识别所有科目
  const targetSubjects = selectedSubjects.length > 0
    ? selectedSubjects
    : examSubjects.map((s) => s.name);

  const rosterByClass = DB.studentRoster?.[grade] || {};
  const rosterStudentMap = {};
  Object.keys(rosterByClass).forEach((c) => {
    (rosterByClass[c] || []).forEach((stu) => {
      const key = `${c}|${stu.studentName}`;
      rosterStudentMap[key] = stu;
    });
  });
  const hasStudentRoster = Object.keys(rosterStudentMap).length > 0;

  const existingRecords = {};
  DB.records.filter((r) => r.examId === examId && r.grade === grade).forEach((r) => {
    const key = `${r.classNo}|${r.studentName}`;
    if (!existingRecords[key]) existingRecords[key] = r;
  });

  const allParsed = [];
  const parsedMap = {};
  const allDetectedSubjects = new Set();
  const conflictWarnings = [];
  const autoGenNotes = [];
  const notInRosterWarnings = [];
  const dataErrors = [];
  const classStat = {};
  const classCounter = {};
  const globalRowIds = new Set();
  const seenFileKeys = new Set();
  const totalFiles = files.length;

  const subjectFullScore = (sn) => {
    const es = examSubjects.find((s) => s.name === sn);
    if (es && es.fullScore) return es.fullScore;
    const gs = gradeSubjects.find((s) => s.name === sn);
    return gs && gs.fullScore ? gs.fullScore : 100;
  };
  const seenKeys = new Set();

  function parseSingleFile(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = function (e) {
        try {
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

          if (rows.length === 0) { resolve(true); return; }

          const firstRow = rows[0] || {};
          const colToSubject = {};
          
          const subjectAliases = {};
          targetSubjects.forEach((s) => {
            subjectAliases[s] = s;
            const pinyinMap = {
              '语文': ['yw', 'yuwen', 'chinese', 'ch'],
              '数学': ['sx', 'shuxue', 'math', 'ma', 'm'],
              '英语': ['yy', 'yingyu', 'english', 'en', 'e'],
              '物理': ['wl', 'wuli', 'physics', 'ph'],
              '化学': ['hx', 'huaxue', 'chemistry'],
              '生物': ['sw', 'shengwu', 'biology', 'bio'],
              '历史': ['ls', 'lishi', 'history'],
              '地理': ['dl', 'dili', 'geography', 'geo'],
              '道法': ['df', 'daofa', 'politics', 'pol', 'moral', '道法与法治'],
              '政治': ['zz', 'zhengzhi', 'politics'],
              '体育': ['ty', 'tiyu', 'pe', 'sport'],
              '音乐': ['yy', 'yinyue', 'music'],
              '美术': ['ms', 'meishu', 'art'],
              '信息技术': ['xx', 'xinxi', 'it', 'computer']
            };
            const aliases = pinyinMap[s] || [];
            aliases.forEach((a) => {
              subjectAliases[a.toLowerCase()] = s;
              subjectAliases[a] = s;
            });
          });

          Object.keys(firstRow).forEach((col) => {
            const colTrim = col.trim();
            const colLower = colTrim.toLowerCase();
            
            if (targetSubjects.includes(colTrim)) {
              colToSubject[col] = colTrim;
              return;
            }
            
            if (subjectAliases[colTrim]) {
              colToSubject[col] = subjectAliases[colTrim];
              return;
            }
            if (subjectAliases[colLower]) {
              colToSubject[col] = subjectAliases[colLower];
              return;
            }
            
            const fuzzy = targetSubjects.find((s) => colTrim.includes(s) || s.includes(colTrim));
            if (fuzzy) {
              colToSubject[col] = fuzzy;
              return;
            }
            
            const withoutBracket = colTrim.replace(/\（[^）]*\）/g, "").replace(/\([^)]*\)/g, "").trim();
            if (withoutBracket !== colTrim) {
              if (targetSubjects.includes(withoutBracket)) {
                colToSubject[col] = withoutBracket;
                return;
              }
              const bracketMatch = targetSubjects.find((s) => s === withoutBracket || withoutBracket.includes(s) || s.includes(withoutBracket));
              if (bracketMatch) {
                colToSubject[col] = bracketMatch;
                return;
              }
            }
            
            const withoutSuffix = colTrim.replace(/(成绩|分数|得分|分值)$/g, "").trim();
            if (withoutSuffix !== colTrim && targetSubjects.includes(withoutSuffix)) {
              colToSubject[col] = withoutSuffix;
              return;
            }
          });

          const matchedSubjects = new Set(Object.values(colToSubject));
          if (matchedSubjects.size === 0) {
            const fileName = file.name.toLowerCase().replace(/\.(xlsx|xls|csv)$/, '');
            for (const [alias, subject] of Object.entries(subjectAliases)) {
              if (fileName.includes(alias) || fileName.includes(subject.toLowerCase())) {
                colToSubject[subject] = subject;
                matchedSubjects.add(subject);
                break;
              }
            }
          }

          // 记录本文件自动识别到的科目
          const fileDetectedSubjects = [...matchedSubjects];
          fileDetectedSubjects.forEach((s) => allDetectedSubjects.add(s));

          const allKeys = Object.keys(firstRow);
          let examNoCol = null, studentNameCol = null;
          const examNoPatterns = ["考号", "考场号", "座位号", "准考证号", "exam_no", "examNo"];
          const namePatterns = ["姓名", "名字", "name", "Name", "student_name", "StudentName", "学生"];
          for (const k of allKeys) {
            if (!examNoCol && examNoPatterns.some((p) => k.includes(p))) examNoCol = k;
            if (!studentNameCol && namePatterns.some((p) => k.includes(p))) studentNameCol = k;
          }
          if (!examNoCol && allKeys.includes("考号")) examNoCol = "考号";
          if (!studentNameCol && allKeys.includes("姓名")) studentNameCol = "姓名";

          for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
            const row = rows[rowIdx];
            const examNo = String((examNoCol ? row[examNoCol] : "") || "").trim();
            const studentName = String((studentNameCol ? row[studentNameCol] : "") || "").trim();
            
            if (!examNo) {
              conflictWarnings.push(`文件「${file.name}」第${rowIdx + 2}行缺少考号`);
              continue;
            }
            if (!studentName) {
              conflictWarnings.push(`文件「${file.name}」第${rowIdx + 2}行学生缺少姓名`);
              continue;
            }

            const parsed = parseExamNo(examNo);
            if (!parsed) {
              conflictWarnings.push(`文件「${file.name}」第${rowIdx + 2}行考号「${examNo}」格式不正确`);
              continue;
            }

            const classNo = parsed.classNo;
            const key = `${classNo}|${studentName}`;
            const rosterInfo = rosterStudentMap[key];
            
            if (hasStudentRoster && !rosterInfo) {
              notInRosterWarnings.push(`「${studentName}」（${classNo}，考号${examNo}）不在名单中，已忽略`);
              continue;
            }

            const existing = existingRecords[key];
            let studentId = "";

            if (rosterInfo && rosterInfo.studentId) {
              studentId = rosterInfo.studentId;
            } else if (existing && existing.studentId) {
              studentId = existing.studentId;
            } else {
              const classPrefix = classNo.replace(/\D/g, '') || "1";
              classCounter[classPrefix] = (classCounter[classPrefix] || 0) + 1;
              studentId = generateStudentId(grade, classNo, classCounter[classPrefix]);
              autoGenNotes.push(`${classNo} ${studentName}(${studentId})`);
            }

            if (globalRowIds.has(studentId)) {
              conflictWarnings.push(`学号「${studentId}」重复：${studentName}`);
              continue;
            }
            globalRowIds.add(studentId);

            const scores = {};
            targetSubjects.forEach((sn) => {
              const colName = Object.keys(colToSubject).find((c) => colToSubject[c] === sn);
              let rawValue = null;
              let hasColumn = false;
              if (colName) {
                hasColumn = true;
                rawValue = row[colName];
              } else if (row[sn] !== undefined) {
                hasColumn = true;
                rawValue = row[sn];
              }
              if (!hasColumn) {
                if (isSingleMode) {
                  return;
                }
                scores[sn] = 0;
                if (rowIdx === 0) {
                  dataErrors.push({ file: file.name, row: rowIdx + 2, student: "（表头）", subject: sn, problem: `Excel 中找不到「${sn}」科目列（已按 0 分处理）`, severity: "warning" });
                }
                return;
              }
              if (rawValue === "" || rawValue == null) {
                scores[sn] = 0;
                dataErrors.push({ file: file.name, row: rowIdx + 2, student: studentName, subject: sn, problem: `分数为空（已按 0 分处理）`, severity: "warning" });
              } else if (isNaN(Number(rawValue))) {
                scores[sn] = 0;
                dataErrors.push({ file: file.name, row: rowIdx + 2, student: studentName, subject: sn, problem: `分数不是数字（值：${String(rawValue).slice(0, 20)}，已按 0 分处理）`, severity: "error" });
              } else {
                const num = Number(rawValue);
                scores[sn] = num;
                if (num < 0) {
                  dataErrors.push({ file: file.name, row: rowIdx + 2, student: studentName, subject: sn, problem: `分数为负数（${num}，已照常导入）`, severity: "error" });
                }
                const fs = subjectFullScore(sn);
                if (num > fs) {
                  dataErrors.push({ file: file.name, row: rowIdx + 2, student: studentName, subject: sn, problem: `分数超过满分（${num}/${fs}，已照常导入）`, severity: "error" });
                }
              }
            });

            const dupKey = `${classNo}|${studentName}`;
            const fileDupKey = `${file.name}|${classNo}|${studentName}`;
            if (seenFileKeys.has(fileDupKey)) {
              dataErrors.push({ file: file.name, row: rowIdx + 2, student: studentName, subject: "—", problem: `该学生在本文件中重复出现（${classNo}），本次将覆盖之前的数据`, severity: "warning" });
            }
            seenFileKeys.add(fileDupKey);

            const existingParsed = parsedMap[dupKey];
            if (existingParsed) {
              Object.assign(existingParsed.scores, scores);
            } else {
              parsedMap[dupKey] = {
                classNo, studentId, studentName, examNo,
                scores: { ...scores },
                existingScores: existing ? { ...existing.scores } : {},
                isUpdate: !!existing,
                files: [file.name]
              };
            }
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

  (async function () {
    for (let i = 0; i < files.length; i++) {
      await parseSingleFile(files[i]);
    }

    allParsed.push(...Object.values(parsedMap || {}));

    if (allParsed.length === 0) {
      showToast(conflictWarnings.length ? `未能解析：${conflictWarnings[0]}` : "未能解析有效学生", "error");
      return;
    }

    const classList = Object.keys(classStat).sort();
    const classInfo = classList.map((c) => `${c}（${classStat[c]}人）`).join("、");

    const autoNote = autoGenNotes.length > 0
      ? `<div style="padding:10px 12px;background:#e6f7ea;border-left:3px solid #1a7f37;border-radius:4px;font-size:12px;margin-bottom:10px">💡 已为 ${autoGenNotes.length} 位学生自动分配学号</div>`
      : "";
    const conflictNote = conflictWarnings.length > 0
      ? `<div style="padding:10px 12px;background:#fff0f0;border-left:3px solid #c0392b;border-radius:4px;font-size:12px;margin-bottom:10px">⚠️ ${conflictWarnings.slice(0, 5).join("；")}${conflictWarnings.length > 5 ? "……" : ""}</div>`
      : "";
    const notInRosterNote = notInRosterWarnings.length > 0
      ? `<div style="padding:10px 12px;background:#fff8e1;border-left:3px solid #f9a825;border-radius:4px;font-size:12px;margin-bottom:10px">🚫 已过滤 ${notInRosterWarnings.length} 位名单外学生：${notInRosterWarnings.slice(0, 3).join("；")}${notInRosterWarnings.length > 3 ? "……" : ""}</div>`
      : "";
    const modeNote = isSingleMode
      ? `<div style="padding:10px 12px;background:#e3f2fd;border-left:3px solid #1976d2;border-radius:4px;font-size:12px;margin-bottom:10px">📝 单科上传模式：${selectedSubjects.length > 0 ? `指定科目（${selectedSubjects.join("、")}）` : `系统自动识别科目${allDetectedSubjects.size > 0 ? `（已识别：${[...allDetectedSubjects].join("、")}）` : ""}`}，仅更新对应科目数据，其他科目不受影响</div>`
      : "";

    const previewRows = allParsed.slice(0, 40).map((r) => {
      const scoreCells = targetSubjects.map((sn) => {
        const newScore = r.scores[sn];
        const oldScore = r.existingScores[sn];
        if (newScore != null) {
          if (oldScore != null && oldScore !== newScore) {
            return `<td style="color:#d35400"><b>${newScore}</b> <span style="font-size:11px">（原${oldScore}）</span></td>`;
          }
          return `<td><b>${newScore}</b></td>`;
        }
        if (oldScore != null) {
          return `<td style="color:#888">${oldScore} <span style="font-size:11px">（保留）</span></td>`;
        }
        return `<td><span style='color:#ccc'>-</span></td>`;
      }).join("");
      return `<tr><td>${esc(r.examNo)}</td><td>${esc(r.studentName)}</td><td>${esc(r.classNo)}</td>${scoreCells}<td>${r.isUpdate ? "<span class='tag tag-success'>更新</span>" : "<span class='tag tag-info'>新增</span>"}</td></tr>`;
    }).join("");

    const errCount = dataErrors.length;
    const errErrorCount = dataErrors.filter((e) => e.severity === "error").length;
    const errWarnCount = dataErrors.filter((e) => e.severity === "warning").length;
    let errorReport = "";
    if (errCount > 0) {
      const fileGroup = {};
      dataErrors.forEach((e) => {
        const k = e.file || "（未知文件）";
        if (!fileGroup[k]) fileGroup[k] = [];
        fileGroup[k].push(e);
      });
      const fileSummary = Object.keys(fileGroup).map((f) => {
        const arr = fileGroup[f];
        const ec = arr.filter((x) => x.severity === "error").length;
        const wc = arr.filter((x) => x.severity === "warning").length;
        return `<span style="display:inline-block;margin:2px 6px 2px 0;padding:2px 8px;background:#f1f3f5;border-radius:10px;font-size:12px">${esc(f)}：共 ${arr.length} 条${ec ? `（❌${ec}）` : ""}${wc ? `（⚠️${wc}）` : ""}</span>`;
      }).join("");
      const errorRowsHtml = dataErrors.map((e) => {
        const sevClass = e.severity === "error" ? "err-err" : "err-warn";
        const sevBadge = e.severity === "error"
          ? `<span class="err-badge err-badge-error">❌ 错误</span>`
          : `<span class="err-badge err-badge-warn">⚠️ 警告</span>`;
        return `<tr class="${sevClass}">
          <td>${esc(e.file || "—")}</td>
          <td style="text-align:center">${e.row || "—"}</td>
          <td>${esc(e.student || "—")}</td>
          <td>${esc(e.subject || "—")}</td>
          <td>${esc(e.problem || "—")}</td>
          <td style="text-align:center">${sevBadge}</td>
        </tr>`;
      }).join("");
      errorReport = `
        <div class="err-report-box">
          <div class="err-report-head">
            <span class="err-report-title">📋 数据错误详细解读</span>
            <span class="err-report-stat">共 ${errCount} 条 · <span class="err-c-error">❌ 错误 ${errErrorCount}</span> · <span class="err-c-warn">⚠️ 警告 ${errWarnCount}</span></span>
          </div>
          <div class="err-report-tip">
            <b>说明：</b>行号 = Excel 中实际行号（含表头，第 1 行为表头，第 2 行起为数据）。
            <b style="color:#e74c3c">错误</b>类问题表示数据本身不合法（非数字/负数/超满分），已强制按 0 分或照常导入，<u>请核对源文件后重新上传</u>；
            <b style="color:#f39c12">警告</b>类问题表示数据缺失或重复（空值/列缺失/跨文件重复），系统已自动处理，但建议复核。
          </div>
          <div class="err-file-summary">${fileSummary}</div>
          <div class="table-wrap"><table class="data-table err-table">
            <thead><tr>
              <th>文件</th><th style="width:60px">行</th><th>学生</th><th>科目</th><th>问题说明</th><th style="width:80px">级别</th>
            </tr></thead>
            <tbody>${errorRowsHtml}</tbody>
          </table></div>
        </div>`;
    } else {
      errorReport = `<div class="err-report-ok">✅ 数据校验通过，未发现错误（共解析 ${allParsed.length} 名学生，${totalFiles} 个文件）</div>`;
    }

    $("er_preview").innerHTML = `
      <div class="card-title" style="border:none;padding:0;margin-bottom:12px">
        📋 已解析 ${totalFiles} 个文件 · ${allParsed.length} 名学生 · ${isSingleMode ? `${selectedSubjects.length > 0 ? `指定科目：${selectedSubjects.join("、")}` : `自动识别科目：${[...allDetectedSubjects].join("、") || "未识别到"}`}` : ""}
      </div>
      ${modeNote}
      ${autoNote}
      ${notInRosterNote}
      ${conflictNote}
      ${errorReport}
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>考号</th><th>姓名</th><th>班级</th>${targetSubjects.map((n) => `<th>${n}</th>`).join("")}<th>状态</th></tr></thead>
        <tbody>${previewRows}</tbody>
      </table></div>
      ${allParsed.length > 40 ? `<p style="text-align:center;color:var(--text-light);margin-top:10px">仅显示前 40 行，共 ${allParsed.length} 行</p>` : ""}
      <div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end">
        <button class="btn btn-secondary" onclick="renderAcademicUploadExamroom()">取消</button>
        <button class="btn btn-success" id="er_confirm_upload">✓ 确认导入</button>
      </div>
    `;

    $("er_confirm_upload").onclick = () => {
      let newCount = 0, updateCount = 0, zeroCount = 0;

      allParsed.forEach((p) => {
        const key = `${p.classNo}|${p.studentName}`;
        const existing = existingRecords[key];

        if (existing) {
          if (isSingleMode) {
            // 单科模式：只更新检测到的科目分数，不影响其他科目
            Object.keys(p.scores).forEach((sn) => {
              if (p.scores[sn] != null) {
                existing.scores[sn] = p.scores[sn];
              }
            });
          } else {
            gradeSubjects.forEach((s) => delete existing.scores[s.name]);
            Object.assign(existing.scores, p.scores);
          }
          existing.total = 0;
          gradeSubjects.forEach((s) => {
            if (existing.scores[s.name] != null) existing.total += existing.scores[s.name];
          });
          existing.uploadedBy = currentUser.id;
          existing.uploadedAt = Date.now();
          existing.status = "confirmed";
          existing.confirmedAt = Date.now();
          existing.confirmedBy = currentUser.id;
          updateCount++;
        } else {
          const scores = {};
          targetSubjects.forEach((sn) => { if (p.scores[sn] != null) scores[sn] = p.scores[sn]; });
          let total = 0;
          gradeSubjects.forEach((s) => {
            if (scores[s.name] != null) total += scores[s.name];
          });
          DB.records.push({
            id: uid(), examId, grade, classNo: p.classNo,
            studentId: p.studentId, studentName: p.studentName, scores, total,
            uploadedBy: currentUser.id, uploadedAt: Date.now(),
            status: "confirmed",
            confirmedAt: Date.now(),
            confirmedBy: currentUser.id
          });
          newCount++;
        }
      });

      if (hasStudentRoster) {
        Object.keys(rosterStudentMap).forEach((key) => {
          const rosterStu = rosterStudentMap[key];
          if (existingRecords[key]) return;
          const imported = allParsed.find((p) => `${p.classNo}|${p.studentName}` === key);
          if (imported) return;

          const existingZeroRec = DB.records.find((r) => 
            r.examId === examId && r.grade === grade && 
            r.classNo === rosterStu.classNo && r.studentName === rosterStu.studentName
          );
          if (existingZeroRec) return;

          const scores = {};
          let total = 0;
          gradeSubjects.forEach((s) => {
            scores[s.name] = 0;
          });
          DB.records.push({
            id: uid(), examId, grade, classNo: rosterStu.classNo,
            studentId: rosterStu.studentId || `${rosterStu.classNo}-000`,
            studentName: rosterStu.studentName, scores, total,
            uploadedBy: currentUser.id, uploadedAt: Date.now(),
            status: "confirmed",
            confirmedAt: Date.now(),
            confirmedBy: currentUser.id,
            isZeroFill: true
          });
          zeroCount++;
        });
      }

      saveDB(DB, examId);
      let msg = `成功新增 ${newCount} 条、更新 ${updateCount} 条`;
      if (zeroCount > 0) msg += `、补零分 ${zeroCount} 条`;
      if (isSingleMode) {
        if (selectedSubjects.length > 0) {
          msg += `（指定科目：${selectedSubjects.join("、")}）`;
        } else if (allDetectedSubjects.size > 0) {
          msg += `（自动识别科目：${[...allDetectedSubjects].join("、")}）`;
        }
      }
      showToast(msg, "success");
      $("er_preview").innerHTML = "";
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
    const low = validScores.filter((v) => v <= s.low).length;
    const maxCount = validScores.filter((v) => v === max).length;
    const minCount = validScores.filter((v) => v === min).length;
    const variance = n > 0 ? validScores.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / n : 0;
    const stdDev = Math.sqrt(variance);
    stats[s.name] = {
      total: n, sum, avg, max, min,
      excellent, good, low, passCount,
      excellentPct: n > 0 ? excellent / n : 0,
      goodPct: n > 0 ? good / n : 0,
      passPct: n > 0 ? passCount / n : 0,
      lowPct: n > 0 ? low / n : 0,
      maxCount, minCount, fullScore: s.fullScore, stdDev
    };
  });
  const totals = records.map((r) => r.total).filter((v) => typeof v === "number" && !isNaN(v));
  const n = totals.length;
  const totalFullScore = subjects.reduce((s, x) => s + x.fullScore, 0);
  const totalExcellentLine = subjects.reduce((s, x) => s + x.excellent, 0);
  const totalGoodLine = subjects.reduce((s, x) => s + x.good, 0);
  const totalPassLine = subjects.reduce((s, x) => s + x.pass, 0);
  const totalLowLine = subjects.reduce((s, x) => s + x.low, 0);
  const totalAvg = n > 0 ? totals.reduce((a, b) => a + b, 0) / n : 0;
  const totalVariance = n > 0 ? totals.reduce((a, b) => a + Math.pow(b - totalAvg, 2), 0) / n : 0;
  const excellent = totals.filter((v) => v >= totalExcellentLine).length;
  const good = totals.filter((v) => v >= totalGoodLine && v < totalExcellentLine).length;
  const passCount = totals.filter((v) => v >= totalPassLine).length;
  const low = totals.filter((v) => v <= totalLowLine).length;
  const max = n > 0 ? Math.max(...totals) : 0;
  const min = n > 0 ? Math.min(...totals) : 0;
  stats["总分"] = {
    total: n,
    sum: totals.reduce((a, b) => a + b, 0),
    avg: totalAvg,
    max, min,
    excellent, good, low, passCount,
    excellentPct: n > 0 ? excellent / n : 0,
    goodPct: n > 0 ? good / n : 0,
    passPct: n > 0 ? passCount / n : 0,
    lowPct: n > 0 ? low / n : 0,
    maxCount: n > 0 ? totals.filter((v) => v === max).length : 0,
    minCount: n > 0 ? totals.filter((v) => v === min).length : 0,
    fullScore: totalFullScore,
    stdDev: Math.sqrt(totalVariance)
  };
  return stats;
}

// ========== 教务：年级成绩汇总 ==========
function renderGradeSummary() {
  if (currentUser.role !== "academic") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  // 仅显示年级统一考试
  const exams = DB.exams.filter((e) => e.grade === grade && !e.isClassExam).sort((a, b) => b.createdAt - a.createdAt);

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
  const subjects = getExamSubjects(examId);
  const records = DB.records.filter((r) => r.examId === examId && r.grade === grade && (!r.status || r.status === "confirmed" || r.status === "pending"));
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
  const subjects = getExamSubjects(examId);
  const records = DB.records.filter((r) => r.examId === examId && r.grade === grade && (!r.status || r.status === "confirmed" || r.status === "pending"));
  if (records.length === 0) { showToast("没有数据", "error"); return; }

  const totalStats = aggregateStats(records, subjects);

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
  // 班主任：显示年级统一考试 + 本班自建考试；教务：仅显示年级统一考试
  const exams = isHeadteacher
    ? getHeadteacherExams(grade, currentUser.classNo).sort((a, b) => b.createdAt - a.createdAt)
    : DB.exams.filter((e) => e.grade === grade && !e.isClassExam).sort((a, b) => b.createdAt - a.createdAt);

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
  const subjects = getExamSubjects(examId);
  const isAcademic = currentUser.role === "academic";
  let allRecords = getVisibleRecords(DB.records.filter((r) => r.examId === examId && r.grade === grade));
  let records = allRecords;
  if (classFilter) records = records.filter((r) => classNoEquals(r.classNo, classFilter));
  if (records.length === 0) {
    $("rank_result").innerHTML = `<div class="empty-state"><div class="es-icon">📭</div><div class="es-title">暂无成绩数据</div></div>`;
    return;
  }

  // 计算全校排名映射
  const sortedAll = [...allRecords].sort((a, b) => b.total - a.total);
  const schoolRankMap = new Map();
  sortedAll.forEach((r, idx) => {
    const key = `${r.studentId}_${r.studentName}`;
    if (!schoolRankMap.has(key)) schoolRankMap.set(key, idx + 1);
  });

  // 计算班级排名映射
  const classRecordsMap = {};
  allRecords.forEach((r) => {
    if (!classRecordsMap[r.classNo]) classRecordsMap[r.classNo] = [];
    classRecordsMap[r.classNo].push(r);
  });
  const classRankMap = new Map();
  Object.keys(classRecordsMap).forEach((cls) => {
    const classRecords = [...classRecordsMap[cls]].sort((a, b) => b.total - a.total);
    classRecords.forEach((r, idx) => {
      const key = `${r.studentId}_${r.studentName}`;
      if (!classRankMap.has(key)) classRankMap.set(key, idx + 1);
    });
  });

  records.sort((a, b) => b.total - a.total);
  const stats = aggregateStats(records, subjects);
  const showStudentId = hasRoster(grade);
  const isClassView = classFilter !== "";

  // 获取所有班级（用于批量下载）
  const allClasses = [...new Set(DB.records.filter((r) => r.examId === examId && r.grade === grade).map((r) => r.classNo))].sort();

  const rows = records.map((r, idx) => {
    const key = `${r.studentId}_${r.studentName}`;
    const schoolRank = schoolRankMap.get(key) || "";
    const classRank = classRankMap.get(key) || "";
    const schoolBadge = schoolRank === 1 ? "🥇" : schoolRank === 2 ? "🥈" : schoolRank === 3 ? "🥉" : schoolRank;
    const rosterId = showStudentId ? getStudentIdFromRoster(grade, r.classNo, r.studentName) : "";
    return `<tr class="${schoolRank <= 3 ? "rank-top" : ""}">
      <td><b>${schoolBadge}</b></td>
      <td>${classRank}</td>
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
      <thead><tr><th>全校排名</th><th>班级排名</th><th>班级</th>${thStudentId}<th>姓名</th>${subjects.map((s) => `<th>${s.name}</th>`).join("")}<th>总分</th></tr></thead>
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
  const subjects = getExamSubjects(examId);
  let records = getVisibleRecords(DB.records.filter((r) => r.examId === examId && r.grade === grade));
  if (records.length === 0) { showToast("无数据", "error"); return; }

  records.sort((a, b) => b.total - a.total);
  const wb = XLSX.utils.book_new();
  const showStudentId = hasRoster(grade);
  const thId = showStudentId ? ["学号"] : [];

  // 计算班级排名映射
  const classRecordsMap = {};
  records.forEach((r) => {
    if (!classRecordsMap[r.classNo]) classRecordsMap[r.classNo] = [];
    classRecordsMap[r.classNo].push(r);
  });
  const classRankMap = new Map();
  Object.keys(classRecordsMap).forEach((cls) => {
    const classRecords = [...classRecordsMap[cls]].sort((a, b) => b.total - a.total);
    classRecords.forEach((r, idx) => {
      const key = `${r.studentId}_${r.studentName}`;
      if (!classRankMap.has(key)) classRankMap.set(key, idx + 1);
    });
  });

  // Sheet 1: 全年级排名
  const t1 = [["全校排名", "班级排名", "班级", ...thId, "姓名", ...subjects.map((s) => s.name), "总分"]];
  records.forEach((r, idx) => {
    const key = `${r.studentId}_${r.studentName}`;
    const classRank = classRankMap.get(key) || "";
    const rosterId = showStudentId ? getStudentIdFromRoster(grade, r.classNo, r.studentName) : "";
    t1.push([idx + 1, classRank, r.classNo, ...(showStudentId ? [rosterId] : []), r.studentName, ...subjects.map((s) => r.scores[s.name] ?? ""), r.total]);
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
  const subjects = getExamSubjects(examId);
  let records = getVisibleRecords(DB.records.filter((r) => r.examId === examId && r.grade === grade));
  if (records.length === 0) { showToast("无数据", "error"); return; }

  // 计算全校排名映射
  const allRecords = [...records].sort((a, b) => b.total - a.total);
  const schoolRankMap = new Map();
  allRecords.forEach((r, idx) => {
    const key = `${r.studentId}_${r.studentName}`;
    if (!schoolRankMap.has(key)) {
      schoolRankMap.set(key, idx + 1);
    }
  });

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
    const t1 = [["全校排名", "班级排名", ...thId, "姓名", ...subjects.map((s) => s.name), "总分"]];
    classRecords.forEach((r, idx) => {
      const key = `${r.studentId}_${r.studentName}`;
      const schoolRank = schoolRankMap.get(key) || "";
      const rosterId = showStudentId ? getStudentIdFromRoster(grade, c, r.studentName) : "";
      t1.push([schoolRank, idx + 1, ...(showStudentId ? [rosterId] : []), r.studentName, ...subjects.map((s) => r.scores[s.name] ?? ""), r.total]);
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
  const subjects = getExamSubjects(examId);
  let allRecords = getVisibleRecords(DB.records.filter((r) => r.examId === examId && r.grade === grade));
  let records = allRecords;
  if (classFilter) records = records.filter((r) => classNoEquals(r.classNo, classFilter));
  if (records.length === 0) { showToast("无数据", "error"); return; }

  // 计算全校排名
  const sortedAll = [...allRecords].sort((a, b) => b.total - a.total);
  const schoolRankMap = new Map();
  sortedAll.forEach((r, idx) => {
    const key = `${r.studentId}_${r.studentName}`;
    if (!schoolRankMap.has(key)) schoolRankMap.set(key, idx + 1);
  });

  // 计算班级排名
  const classRecordsMap = {};
  allRecords.forEach((r) => {
    if (!classRecordsMap[r.classNo]) classRecordsMap[r.classNo] = [];
    classRecordsMap[r.classNo].push(r);
  });
  const classRankMap = new Map();
  Object.keys(classRecordsMap).forEach((cls) => {
    const classRecords = [...classRecordsMap[cls]].sort((a, b) => b.total - a.total);
    classRecords.forEach((r, idx) => {
      const key = `${r.studentId}_${r.studentName}`;
      if (!classRankMap.has(key)) classRankMap.set(key, idx + 1);
    });
  });

  records.sort((a, b) => b.total - a.total);
  const stats = aggregateStats(records, subjects);
  const showStudentId = hasRoster(grade);
  const thId = showStudentId ? ["学号"] : [];

  const t1 = [["全校排名", "班级排名", "班级", ...thId, "姓名", ...subjects.map((s) => s.name), "总分"]];
  records.forEach((r, idx) => {
    const key = `${r.studentId}_${r.studentName}`;
    const schoolRank = schoolRankMap.get(key) || "";
    const classRank = classRankMap.get(key) || "";
    const rosterId = showStudentId ? getStudentIdFromRoster(grade, r.classNo, r.studentName) : "";
    t1.push([schoolRank, classRank, r.classNo, ...(showStudentId ? [rosterId] : []), r.studentName, ...subjects.map((s) => r.scores[s.name] ?? ""), r.total]);
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
  const classNo = displayClassNo(currentUser.classNo) || currentUser.classNo;
  // 显示年级统一考试 + 本班自建考试
  const exams = getHeadteacherExams(grade, currentUser.classNo).sort((a, b) => b.createdAt - a.createdAt);

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
  console.log("[drawClassScores] 开始渲染成绩", { examId, grade, classNo, currentUser: currentUser?.classNo, recordsCount: DB.records.length });
  const subjects = getExamSubjects(examId);
  let allRecords = getVisibleRecords(DB.records.filter((r) => r.examId === examId && r.grade === grade));
  console.log("[drawClassScores] 过滤后记录数", allRecords.length, "班级过滤:", classNo);
  let records = allRecords.filter((r) => classNoEquals(r.classNo, classNo));
  console.log("[drawClassScores] 最终记录数", records.length);
  if (records.length === 0) {
    $("mc_result").innerHTML = `<div class="empty-state"><div class="es-icon">📭</div><div class="es-title">本考试暂无数据</div><div class="es-tip">请先上传成绩</div></div>`;
    return;
  }

  // 计算全校排名
  const sortedAll = [...allRecords].sort((a, b) => b.total - a.total);
  const schoolRankMap = new Map();
  sortedAll.forEach((r, idx) => {
    const key = `${r.studentId}_${r.studentName}`;
    if (!schoolRankMap.has(key)) schoolRankMap.set(key, idx + 1);
  });

  records.sort((a, b) => b.total - a.total);
  const stats = aggregateStats(records, subjects);
  const showStudentId = hasRoster(grade);

  const thStudentId = showStudentId ? "<th>学号</th>" : "";
  const rows = records.map((r, idx) => {
    const key = `${r.studentId}_${r.studentName}`;
    const schoolRank = schoolRankMap.get(key) || "";
    const rosterId = showStudentId ? getStudentIdFromRoster(grade, classNo, r.studentName) : "";
    return `<tr>
      <td>${idx + 1}</td><td>${schoolRank}</td>${showStudentId ? `<td>${esc(rosterId)}</td>` : ""}<td>${r.studentName}</td>
      ${subjects.map((s) => `<td>${r.scores[s.name] != null ? r.scores[s.name] : "-"}</td>`).join("")}
      <td><b>${r.total}</b></td>
      <td><span class="tag tag-success">✓已生效</span></td>
    </tr>`;
  }).join("");

  const summaryRows = subjects.map((s) => {
    const st = stats[s.name];
    const colCount = showStudentId ? 5 : 4;
    return `<tr class="summary-row"><td colspan="${colCount}" style="text-align:right"><b>${s.name}</b></td>
      <td colspan="${subjects.length}">优秀 ${st.excellent}人/${fmtPct(st.excellentPct)} · 良好 ${st.good}人/${fmtPct(st.goodPct)} · 及格 ${st.passCount}人/${fmtPct(st.passPct)} · 低分 ${st.low}人/${fmtPct(st.lowPct)} · 平均 ${fmt(st.avg)} · 最高 ${st.max}(${st.maxCount}人) · 最低 ${st.min}(${st.minCount}人)</td></tr>`;
  }).join("");

  $("mc_result").innerHTML = `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>班级排名</th><th>全校排名</th>${thStudentId}<th>姓名</th>${subjects.map((s) => `<th>${s.name}</th>`).join("")}<th>总分</th><th>状态</th></tr></thead>
      <tbody>${rows}${summaryRows}</tbody>
    </table></div>
  `;
}

// ========== 班主任：下载成绩 ==========
function renderDownloadScores() {
  if (currentUser.role !== "headteacher") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const classNo = currentUser.classNo;
  // 显示年级统一考试 + 本班自建考试
  const exams = getHeadteacherExams(grade, classNo).sort((a, b) => b.createdAt - a.createdAt);

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">📤 ${classNo} 考试成绩下载</div>
      <p style="color:var(--text-light); margin-bottom:16px;">选择考试以下载完整的 Excel 文件，包含学生排名和统计信息。</p>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>考试名称</th><th>日期</th><th>学生数</th><th>操作</th></tr></thead>
        <tbody>${exams.map((e) => {
          const cnt = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && classNoEquals(r.classNo, classNo))).length;
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
  const subjects = getExamSubjects(examId);
  const allRecords = DB.records.filter((r) => r.examId === examId && r.grade === grade && (r.status === "confirmed" || r.status === "pending"));
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
  // 仅显示年级统一考试
  const exams = DB.exams.filter((e) => e.grade === grade && !e.isClassExam).sort((a, b) => b.createdAt - a.createdAt);
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
      <div class="es-tip">请先上传成绩，或确认教师任教学科和班级已在「教师名单」中正确设置</div>
    </div>`;
    return;
  }

  const filtered = subjectFilter ? rows.filter((r) => r.subject === subjectFilter) : rows;
  const noTeacherRows = filtered.filter((r) => !r.teacherId);
  const validRows = filtered.filter((r) => r.teacherId);

  const noTeacherWarning = noTeacherRows.length > 0
    ? `<div style="padding:10px 12px;background:#fff8e6;border-left:3px solid #e6a000;border-radius:4px;font-size:12px;margin-bottom:12px">
        ⚠️ 有 <b>${noTeacherRows.length}</b> 个班级未分配任课教师（系统显示为灰色行），请联系管理员在「教师名单」中为相关教师设置任教班级和学科
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
    <td colspan="5"><i>未分配教师，请联系管理员在「教师名单」中添加任课教师并设置任教班级</i></td>
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
  // 仅显示年级统一考试
  const exams = DB.exams.filter((e) => e.grade === grade && !e.isClassExam).sort((a, b) => b.createdAt - a.createdAt);

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
  // 仅显示年级统一考试
  const exams = DB.exams.filter((e) => e.grade === grade && !e.isClassExam).sort((a, b) => b.createdAt - a.createdAt);

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
let _aaActiveStudentTab = "partial";

function renderAcademicAnalysis() {
  if (currentUser.role !== "academic") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const exams = getSortedExams(grade).filter((e) => !e.isClassExam);
  if (exams.length === 0) { $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-icon">📊</div><div class="es-title">暂无考试数据</div><div class="es-tip">请先创建考试并上传成绩</div></div></div>`; return; }

  const subjects = DB.subjects[grade] || [];
  const examOptions = exams.map((e, i) => `<option value="${e.id}" ${i === exams.length - 1 ? "selected" : ""}>${esc(e.name)}</option>`).join("");

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">
        <span>🔍 全年级智能成绩分析</span>
        <span class="ct-actions">
          <select id="aa_exam_select" style="padding:6px 12px;border:1px solid #ddd;border-radius:6px;margin-right:10px">${examOptions}</select>
          <button class="btn btn-primary" onclick="downloadAcademicAnalysis()">📥 下载完整分析报告</button>
        </span>
      </div>
    </div>

    <!-- ① 年级总览 -->
    <div class="card analysis-section" id="aa_section1">
      <div class="section-title"><span class="st-icon">📊</span>一、年级总览</div>
      <div id="aa_overview"></div>
    </div>

    <!-- ② 本次最值得做的事 -->
    <div class="card analysis-section" id="aa_section2">
      <div class="section-title"><span class="st-icon">🎯</span>二、本次最值得做的事（按重要性排序）</div>
      <div id="aa_actions"></div>
    </div>

    <!-- ③ 总分分布直方图 -->
    <div class="card analysis-section" id="aa_section3">
      <div class="section-title"><span class="st-icon">📈</span>三、总分分布直方图</div>
      <div class="chart-box" style="height:380px"><canvas id="aa_histogram"></canvas></div>
      <div id="aa_histogram_anno" class="section-annotation"></div>
    </div>

    <!-- ④ 总分分数段分布 -->
    <div class="card analysis-section" id="aa_section4">
      <div class="section-title"><span class="st-icon">📉</span>四、总分分数段分布（按得分率）</div>
      <div id="aa_segments"></div>
      <div id="aa_segments_anno" class="section-annotation"></div>
    </div>

    <!-- ⑤ 班级学科热力图 -->
    <div class="card analysis-section" id="aa_section5">
      <div class="section-title"><span class="st-icon">🗺️</span>五、班级学科热力图</div>
      <div id="aa_heatmap"></div>
      <div class="heatmap-legend">
        <div class="heatmap-legend-item"><div class="heatmap-legend-color" style="background:#28a745"></div><span>高于年级均分 ≥5分</span></div>
        <div class="heatmap-legend-item"><div class="heatmap-legend-color" style="background:#d4edda"></div><span>高于年级均分 0~5分</span></div>
        <div class="heatmap-legend-item"><div class="heatmap-legend-color" style="background:#fff3cd"></div><span>持平（±1分以内）</span></div>
        <div class="heatmap-legend-item"><div class="heatmap-legend-color" style="background:#f8d7da"></div><span>低于年级均分 0~5分</span></div>
        <div class="heatmap-legend-item"><div class="heatmap-legend-color" style="background:#dc3545"></div><span>低于年级均分 ≥5分</span></div>
      </div>
    </div>

    <!-- ⑥ 进退步分布图 -->
    <div class="card analysis-section" id="aa_section6">
      <div class="section-title"><span class="st-icon">🔄</span>六、进退步分布图（年级）</div>
      <div id="aa_progress_wrap"></div>
      <div id="aa_progress_anno" class="section-annotation"></div>
    </div>

    <!-- ⑦ 科目表现 -->
    <div class="card analysis-section" id="aa_section7">
      <div class="section-title"><span class="st-icon">📚</span>七、科目表现</div>
      <div class="table-wrap" id="aa_subject_perf"></div>
    </div>

    <!-- ⑧ 需要关注的学生 -->
    <div class="card analysis-section" id="aa_section8">
      <div class="section-title">
        <span class="st-icon">👨‍🎓</span>八、需要关注的学生
        <span class="st-actions">
          <select id="aa_stu_class_filter" style="padding:4px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;margin-right:8px">
            <option value="all">全部班级</option>
          </select>
          <span style="font-size:13px;color:var(--text-light);margin-right:4px">显示</span>
          <input type="number" id="aa_stu_limit" value="50" min="1" max="500" style="width:60px;padding:4px 8px;border:1px solid #ddd;border-radius:6px;font-size:13px;margin-right:4px">
          <span style="font-size:13px;color:var(--text-light);margin-right:10px">人</span>
          <button class="btn btn-sm btn-primary" onclick="downloadWatchStudents('grade')">📥 年级下载</button>
          <button class="btn btn-sm btn-success" onclick="downloadWatchStudents('class')">📥 班级下载</button>
        </span>
      </div>
      <div class="student-tabs" id="aa_student_tabs"></div>
      <div id="aa_students_grid"></div>
    </div>

    <!-- ⑨ 学科教学建议 -->
    <div class="card analysis-section" id="aa_section9">
      <div class="section-title"><span class="st-icon">💡</span>九、学科教学建议</div>
      <div id="aa_subject_suggestions"></div>
    </div>
  `;

  $("aa_exam_select").addEventListener("change", () => refreshAcademicAnalysis());
  setTimeout(() => refreshAcademicAnalysis(), 50);
}

function refreshAcademicAnalysis() {
  const grade = currentUser.grade;
  const examId = $("aa_exam_select").value;
  window._eaCurrentExamId = examId;
  const exams = getSortedExams(grade).filter((e) => !e.isClassExam);
  const selectedExam = exams.find((e) => e.id === examId) || exams[exams.length - 1];
  const subjects = getExamSubjects(selectedExam.id);
  const allRecs = DB.records.filter((r) => r.examId === selectedExam.id && r.grade === grade && (!r.status || r.status === "confirmed" || r.status === "pending"));

  if (allRecs.length === 0 || subjects.length === 0) {
    const msg = allRecs.length === 0 ? "本次考试暂无成绩数据" : "请先在「学科/分值设置」中配置学科";
    $("aa_overview").innerHTML = `<div class="empty-state"><div class="es-icon">📊</div><div class="es-title">${msg}</div><div class="es-tip">${allRecs.length === 0 ? "请先上传成绩" : "无学科配置无法进行分析"}</div></div>`;
    $("aa_actions").innerHTML = "";
    $("aa_histogram_anno").innerHTML = "";
    $("aa_segments").innerHTML = "";
    $("aa_segments_anno").innerHTML = "";
    $("aa_heatmap").innerHTML = "";
    $("aa_progress_wrap").innerHTML = "";
    $("aa_progress_anno").innerHTML = "";
    $("aa_subject_perf").innerHTML = "";
    $("aa_subject_suggestions").innerHTML = "";
    $("aa_students_grid").innerHTML = "";
    $("aa_student_tabs").innerHTML = "";
    return;
  }

  const stats = aggregateStats(allRecs, subjects);
  const totalStats = stats["总分"];
  const totalFullScore = subjects.reduce((s, x) => s + x.fullScore, 0);

  // ===== ① 年级总览 =====
  renderOverview(allRecs, stats, subjects, totalFullScore);

  // ===== ② 本次最值得做的事 =====
  renderActions(allRecs, stats, subjects, exams, selectedExam, grade, totalFullScore);

  // ===== ③ 总分分布直方图 =====
  renderHistogram(allRecs, subjects, totalFullScore);

  // ===== ④ 总分分数段分布 =====
  renderScoreSegments(allRecs, subjects, totalFullScore);

  // ===== ⑤ 班级学科热力图 =====
  renderHeatmap(allRecs, subjects, stats);

  // ===== ⑥ 进退步分布图 =====
  renderProgressDistribution(exams, selectedExam, grade, allRecs);

  // ===== ⑦ 科目表现 =====
  renderSubjectPerformance(stats, subjects);

  // ===== ⑨ 学科教学建议 =====
  renderSubjectSuggestions(stats, subjects);

  // ===== ⑧ 需要关注的学生 =====
  // 初始化班级筛选下拉框
  const classList = [...new Set(allRecs.map((r) => r.classNo))].sort();
  const classFilterSel = $("aa_stu_class_filter");
  if (classFilterSel) {
    const currentVal = classFilterSel.value;
    classFilterSel.innerHTML = `<option value="all">全部班级</option>` + classList.map((c) => `<option value="${c}">${c}</option>`).join("");
    classFilterSel.value = currentVal || "all";
    if (!classFilterSel._bound) {
      classFilterSel.addEventListener("change", () => renderStudentsToWatch(allRecs, exams, selectedExam, grade, subjects));
      classFilterSel._bound = true;
    }
  }
  const limitInput = $("aa_stu_limit");
  if (limitInput && !limitInput._bound) {
    limitInput.addEventListener("change", () => renderStudentsToWatch(allRecs, exams, selectedExam, grade, subjects));
    limitInput._bound = true;
  }
  renderStudentsToWatch(allRecs, exams, selectedExam, grade, subjects);
}

// ---------- ① 年级总览 ----------
function renderOverview(records, stats, subjects, totalFullScore) {
  if (!records.length || !subjects.length) {
    $("aa_overview").innerHTML = `<div class="empty-state"><div class="es-tip">暂无数据</div></div>`;
    return;
  }
  const totalAvg = stats["总分"].avg || 0;
  const avgRate = totalFullScore > 0 ? (totalAvg / totalFullScore * 100).toFixed(1) : "0.0";
  const validCount = stats["总分"].total || records.length;

  let bestSubject = null, bestRate = 0;
  let worstSubject = null, worstRate = 100;
  subjects.forEach((s) => {
    if (s.fullScore > 0 && stats[s.name] && stats[s.name].total > 0) {
      const rate = stats[s.name].avg / s.fullScore * 100;
      if (rate > bestRate) { bestRate = rate; bestSubject = s.name; }
      if (rate < worstRate) { worstRate = rate; worstSubject = s.name; }
    }
  });

  const classCounts = {};
  records.forEach((r) => { classCounts[r.classNo] = (classCounts[r.classNo] || 0) + 1; });
  const classCount = Object.keys(classCounts).length;

  const allPassCount = records.filter((r) => {
    return subjects.every((s) => {
      const score = r.scores[s.name];
      return typeof score === "number" && !isNaN(score) && score >= s.pass;
    });
  }).length;

  $("aa_overview").innerHTML = `
    <div class="overview-grid">
      <div class="overview-card">
        <div class="oc-label">参考人数</div>
        <div class="oc-value">${validCount}<span class="oc-unit">人</span></div>
        <div class="oc-sub">${classCount} 个班级</div>
      </div>
      <div class="overview-card info">
        <div class="oc-label">总分均分</div>
        <div class="oc-value">${fmt(totalAvg, 1)}<span class="oc-unit">分</span></div>
        <div class="oc-sub">得分率 ${avgRate}%</div>
      </div>
      <div class="overview-card success">
        <div class="oc-label">总分最高</div>
        <div class="oc-value">${fmt(stats["总分"]?.max || 0, 1)}<span class="oc-unit">分</span></div>
        <div class="oc-sub">${stats["总分"]?.maxCount || 0} 人并列</div>
      </div>
      <div class="overview-card danger">
        <div class="oc-label">总分最低</div>
        <div class="oc-value">${fmt(stats["总分"]?.min || 0, 1)}<span class="oc-unit">分</span></div>
        <div class="oc-sub">${stats["总分"]?.minCount || 0} 人并列</div>
      </div>
      <div class="overview-card success">
        <div class="oc-label">全部及格人数</div>
        <div class="oc-value">${allPassCount}<span class="oc-unit">人</span></div>
        <div class="oc-sub">占比 ${(validCount > 0 ? (allPassCount / validCount * 100) : 0).toFixed(1)}%</div>
      </div>
      <div class="overview-card warning">
        <div class="oc-label">优势学科</div>
        <div class="oc-value" style="font-size:20px">${bestSubject || "-"}</div>
        <div class="oc-sub">得分率 ${bestRate.toFixed(1)}%</div>
      </div>
      <div class="overview-card danger">
        <div class="oc-label">薄弱学科</div>
        <div class="oc-value" style="font-size:20px">${worstSubject || "-"}</div>
        <div class="oc-sub">得分率 ${worstRate.toFixed(1)}%</div>
      </div>
      <div class="overview-card info">
        <div class="oc-label">满分</div>
        <div class="oc-value">${totalFullScore}<span class="oc-unit">分</span></div>
        <div class="oc-sub">${subjects.length} 个学科</div>
      </div>
    </div>
  `;
}

// ---------- ② 本次最值得做的事 ----------
function renderActions(records, stats, subjects, exams, selectedExam, grade, totalFullScore) {
  if (!records.length || !subjects.length) {
    $("aa_actions").innerHTML = `<div class="empty-state"><div class="es-tip">暂无建议数据</div></div>`;
    return;
  }
  const actions = [];

  const subjectRates = subjects.map((s) => ({
    name: s.name,
    rate: s.fullScore > 0 ? ((stats[s.name]?.avg || 0) / s.fullScore * 100) : 0,
    avg: stats[s.name]?.avg || 0,
    fullScore: s.fullScore,
    passPct: stats[s.name]?.passPct || 0,
    excellentPct: stats[s.name]?.excellentPct || 0,
    failCount: (stats[s.name]?.total || 0) - (stats[s.name]?.passCount || 0),
    total: stats[s.name]?.total || 0,
    stdDev: stats[s.name]?.stdDev || 0
  })).sort((a, b) => a.rate - b.rate);

  const weakest = subjectRates[0];
  if (weakest && weakest.rate < 70 && weakest.total > 0) {
    const failRate = weakest.total > 0 ? (weakest.failCount / weakest.total * 100).toFixed(1) : "0.0";
    actions.push({
      priority: 1,
      level: "p1",
      title: `📉 重点提升 ${weakest.name} 学科成绩（最薄弱学科）`,
      desc: `${weakest.name} 均分 ${fmt(weakest.avg, 1)} 分（满分 ${weakest.fullScore}），得分率仅 ${weakest.rate.toFixed(1)}%，居全年级末位。不及格人数 ${weakest.failCount} 人，不及格率 ${failRate}%，显著高于其他学科。该学科已成为制约年级整体提升的最大短板，根据木桶效应，其提升空间最大、投入产出比最高。`,
      suggestion: `【数据诊断】① 知识点归因分析：将失分按知识模块拆解，定位3-5个高频失分知识点（建议占失分总量的60%以上）；② 标准差分析：若标准差>15分说明两极分化严重，需分层教学；③ 难度系数评估：对比年级均分与满分的比值，判断是题目难度问题还是教学问题。

【干预策略】① 实施"基础过关+能力提升"双轨训练：基础题正确率目标从当前提升至85%以上；② 组织学科教研共同体：每周1次集体备课，重点研究薄弱知识点的突破路径；③ 建立"日清周结"机制：当天知识当天清，每周进行针对性过关检测；④ 分层作业设计：A层（基础夯实）、B层（能力提升）、C层（拓展挑战），确保各层次学生都有适配的训练量；⑤ 预期目标：2次考试内将及格率提升10-15个百分点，均分提升5-8分。`
    });
  }

  const mostFail = subjectRates.slice().sort((a, b) => b.failCount - a.failCount)[0];
  if (mostFail && mostFail.failCount > 0 && mostFail.name !== weakest?.name) {
    const failRate = mostFail.total > 0 ? (mostFail.failCount / mostFail.total * 100).toFixed(1) : "0.0";
    actions.push({
      priority: 2,
      level: "p2",
      title: `⚠️ ${mostFail.name} 不及格人数最多（${mostFail.failCount}人，不及格率 ${failRate}%）`,
      desc: `${mostFail.name} 有 ${mostFail.failCount} 名学生未达及格线，是全年级不及格人数最多的学科。从教育统计学角度看，不及格学生的存在会拉低班级整体分布的下限，且具有"累积效应"——基础不牢会导致后续学习更加困难。`,
      suggestion: `【精准识别】① 运用Rasch模型或经典测量理论，对不及格学生进行能力层级划分（临界生60-55分、学困生55-40分、特困生<40分）；② 临界生是提分效率最高的群体，应作为优先干预对象。

【分层干预】③ 临界生（60分上下）：实施"四清"策略——堂堂清、日日清、周周清、月月清，聚焦高频考点和中档题，目标是突破及格线；④ 学困生（40-55分）：从最基础的概念和公式入手，采用"小步子、快反馈、多鼓励"策略，降低学习坡度；⑤ 特困生（<40分）：需从学习动机和学习习惯入手，建立学习自信，优先保证最基础的得分点。

【保障机制】⑥ 建立学困生成长档案，记录每次小测、作业、辅导的进步轨迹；⑦ 实行"导师制"，每位学困生匹配1名学科导师，每周至少1次个性化辅导；⑧ 与班主任联动，形成"学科老师+班主任+家长"三方协同的帮扶体系。`
    });
  }

  const classStats = {};
  records.forEach((r) => {
    if (!classStats[r.classNo]) classStats[r.classNo] = { total: 0, count: 0, totals: [] };
    classStats[r.classNo].total += r.total;
    classStats[r.classNo].count++;
    classStats[r.classNo].totals.push(r.total);
  });
  const classAverages = Object.keys(classStats).map((c) => ({
    class: c,
    avg: classStats[c].total / classStats[c].count,
    count: classStats[c].count,
    stdDev: Math.sqrt(classStats[c].totals.reduce((a, b) => a + Math.pow(b - classStats[c].total / classStats[c].count, 2), 0) / classStats[c].count)
  })).sort((a, b) => b.avg - a.avg);

  if (classAverages.length >= 2) {
    const gap = classAverages[0].avg - classAverages[classAverages.length - 1].avg;
    const gapRate = (gap / totalFullScore * 100).toFixed(1);
    if (gap > 30) {
      actions.push({
        priority: 3,
        level: "p2",
        title: `🏫 班级差距过大（${fmt(gap, 1)} 分，占满分 ${gapRate}%）`,
        desc: `${classAverages[0].class} 均分最高（${fmt(classAverages[0].avg, 1)} 分），${classAverages[classAverages.length - 1].class} 最低（${fmt(classAverages[classAverages.length - 1].avg, 1)} 分），两极分化系数达到 ${gapRate}%。根据教育公平理论，班级间差异过大不仅影响整体教学质量评价，也会导致教育资源配置失衡。`,
        suggestion: `【差距诊断】① 变异系数（CV）分析：计算各班均分的标准差/均值，判断差距是否在合理范围（通常CV<10%为均衡）；② 学科拆解分析：找出导致班级差距最大的2-3门学科，是差距的主要来源；③ 学生分布对比：对比各班在各分数段的人数分布，判断是头部差距还是尾部差距。

【均衡策略】④ 建立"强弱结对"教研机制：优秀班级与薄弱班级结对，共享教案、课件、作业设计等教学资源；⑤ 实施"走动式"听课诊断：组织教研员和骨干教师深入薄弱班级听课，从课堂教学效率角度找原因；⑥ 学生层面：探索"分层走班"或"弹性分组"模式，让不同层次的学生都能获得最适合的教育；⑦ 教师专业发展：对薄弱班级任课教师开展针对性培训，提升课堂教学设计和课堂管理能力；⑧ 动态监测：每学期跟踪班级差距变化，将均衡度纳入教学质量评价指标体系。`
      });
    }
  }

  let partialCount = 0;
  records.forEach((r) => {
    const hasExcellent = subjects.some((s) => (r.scores[s.name] ?? 0) >= s.excellent);
    const hasFail = subjects.some((s) => (r.scores[s.name] ?? 0) < s.pass);
    if (hasExcellent && hasFail) partialCount++;
  });
  if (partialCount > 0) {
    const partialRate = (partialCount / records.length * 100).toFixed(1);
    actions.push({
      priority: 4,
      level: "p3",
      title: `🎯 偏科学生精准干预（${partialCount} 人，占比 ${partialRate}%）`,
      desc: `全年级有 ${partialCount} 名学生存在"优势学科优秀但薄弱学科不及格"的偏科现象，占比 ${partialRate}%。这些学生学习能力强、有成功经验，是成绩提升的"潜力股"。根据多元智能理论，偏科本质上是智能结构差异的体现，但在应试体系中会成为总分提升的瓶颈。`,
      suggestion: `【偏科类型诊断】① 能力型偏科：优势学科属于逻辑/语言智能，薄弱学科属于空间/运动智能等——这类学生可以通过学习策略迁移来改善；② 态度型偏科：因不喜欢老师或对学科有畏难情绪而偏科——这类学生需要从学习动机和情感入手；③ 基础型偏科：前期知识断层导致后续跟不上——这类学生需要系统补基础。

【干预路径】④ 优势迁移法：引导学生总结优势学科的成功学习经验（如错题本整理法、知识树构建法），尝试将其迁移到薄弱学科；⑤ 学科关联法：找到优势学科与薄弱学科的交叉点（如数学→物理、语文→历史），建立学科间的知识联结；⑥ "1+1"导师制：为每位偏科生配备1名薄弱学科导师 + 1名优势学科学习伙伴，形成互助学习共同体；⑦ 梯度突破：制定薄弱学科的"阶梯式提升计划"——第一个月先抓基础题（正确率目标70%），第二个月冲中档题（正确率目标60%），循序渐进建立信心；⑧ 预期效果：偏科生的薄弱学科平均提升空间在15-25分，是全年级总分提升的重要增长点。`
    });
  }

  const highScoreThreshold = totalFullScore * 0.85;
  const highCount = records.filter((r) => r.total >= highScoreThreshold).length;
  const highRate = (highCount / records.length * 100).toFixed(1);
  actions.push({
    priority: 5,
    level: "p4",
    title: `🏆 培优工程：高分段学生核心素养提升（${highCount} 人，占比 ${highRate}%）`,
    desc: `总分 ${Math.round(highScoreThreshold)} 分以上（得分率≥85%）共 ${highCount} 人，占比 ${highRate}%。高分段学生是学校的"名片"，也是冲击优质高中/大学的主力。但高分不等于高能，需要从"分数导向"转向"素养导向"，培养可持续发展的学习能力。`,
    suggestion: `【培优三层次模型】① 知识层：打破教材边界，进行学科知识的深度拓展和跨学科整合——比如数学延伸竞赛内容、语文增加思辨性阅读、英语引入原版读物；② 能力层：重点培养批判性思维、创造性解决问题、自主学习规划等高阶思维能力；③ 心理层：强化抗挫折能力、压力管理、时间管理等非智力因素，避免"高分低能"或"考场失常"。

【实施路径】④ 建立"荣誉课程"体系：为尖子生开设选修课、专题研究课、项目式学习（PBL），以问题驱动深度学习；⑤ "导师制+小课题"：每位高分学生配1名学术导师，指导完成1个学科小课题研究，培养科研思维；⑥ 同伴学习共同体：组建学科兴趣小组，开展"学生讲堂"，让学生在"教"中"学"，输出式学习记忆留存率可达90%；⑦ 名校学长帮扶：链接往届优秀毕业生，分享学习经验和成长故事，树立长远目标；⑧ 数据追踪：建立高分学生成长档案，跟踪各科均衡度、名次稳定性、能力维度分布，预防偏科和瓶颈期。`
  });

  const lowScoreThreshold = totalFullScore * 0.5;
  const lowCount = records.filter((r) => r.total < lowScoreThreshold).length;
  if (lowCount > 0) {
    const lowRate = (lowCount / records.length * 100).toFixed(1);
    actions.push({
      priority: 6,
      level: "p1",
      title: `🚨 低分段学生紧急干预（${lowCount} 人，占比 ${lowRate}%）`,
      desc: `总分低于 ${Math.round(lowScoreThreshold)} 分（得分率<50%）共 ${lowCount} 人，占比 ${lowRate}%。这些学生处于"学业风险区"，不仅学习成绩落后，往往伴随学习习惯差、自信心不足、家庭支持不足等多重问题。若不及时干预，可能进入"厌学→辍学"的负向循环。`,
      suggestion: `【多维度诊断】① 学习基础诊断：通过基础知识检测，定位知识断层的具体年级和章节，搞清楚"从哪里开始掉队的"；② 学习习惯诊断：从预习、听课、作业、复习、考试5个维度评估，找出影响成绩的关键行为因素；③ 学习动机诊断：区分是"不想学"（动机问题）还是"学不会"（能力问题）还是"不会学"（方法问题）；④ 家庭支持诊断：了解家庭学习环境、家长教育方式、经济状况等外部因素。

【综合干预方案】⑤ 学业帮扶：实施"双基工程"——基础知识 + 基本技能，用60%的精力抓基础题，目标是先把得分率从<50%提升到60%以上；⑥ 习惯养成：制定"学习习惯21天养成计划"，从最容易改的1-2个习惯入手（如按时交作业、整理错题），小步快跑建立正反馈；⑦ 心理支持：每周1次谈心谈话，运用"积极心理学"方法，发现并放大闪光点，重建学习自信心；⑧ 家校协同：每2周与家长沟通1次，教给家长科学的家庭教育方法，形成家校合力；⑨ 同伴互助：安排"1+1"学习搭档，让中等生帮助学困生，在"教"与"学"中共同进步；⑩ 动态评估：每2周进行1次小检测，用数据说话，让学生看到自己的进步轨迹，形成自我驱动的内循环。`
    });
  }

  actions.sort((a, b) => a.priority - b.priority);

  $("aa_actions").innerHTML = `
    <div class="action-list">
      ${actions.map((a) => `
        <div class="action-item ${a.level}">
          <div class="action-priority">${a.priority}</div>
          <div class="action-content">
            <div class="action-title">${a.title}</div>
            <div class="action-desc">${a.desc}</div>
            <div class="action-suggestion">💡 ${a.suggestion}</div>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

// ---------- ③ 总分分布直方图 ----------
function renderHistogram(records, subjects, totalFullScore) {
  if (!records.length || totalFullScore <= 0) {
    $("aa_histogram_anno").innerHTML = `<div class="empty-state"><div class="es-tip">暂无分布数据</div></div>`;
    return;
  }
  const totalPassLine = subjects.reduce((s, x) => s + x.pass, 0);
  const totalExcellentLine = subjects.reduce((s, x) => s + x.excellent, 0);
  const totals = records.map((r) => r.total).sort((a, b) => a - b);
  const min = Math.floor(Math.min(...totals) / 10) * 10;
  const max = Math.ceil(Math.max(...totals) / 10) * 10;
  const binSize = Math.ceil((max - min) / 10);
  const bins = [];
  const labels = [];
  for (let i = min; i < max; i += binSize) {
    const lower = i, upper = i + binSize;
    bins.push(totals.filter((t) => t >= lower && t < upper).length);
    labels.push(`${lower}~${upper}`);
  }

  const canvas = $("aa_histogram");
  if (canvas._chart) canvas._chart.destroy();
  canvas._chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "人数",
        data: bins,
        backgroundColor: "rgba(59,130,246,0.7)",
        borderColor: "#3b7ddd",
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.parsed.y} 人`
          }
        }
      },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: "人数" } },
        x: { title: { display: true, text: "总分区间（分）" } }
      }
    }
  });

  // 注解
  const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
  const median = totals.length % 2 === 0
    ? (totals[totals.length / 2 - 1] + totals[totals.length / 2]) / 2
    : totals[Math.floor(totals.length / 2)];

  let skew = "对称";
  const lowerHalf = totals.filter((t) => t < avg).length;
  const upperHalf = totals.filter((t) => t > avg).length;
  if (lowerHalf > upperHalf * 1.2) skew = "负偏态（低分人数偏多）";
  else if (upperHalf > lowerHalf * 1.2) skew = "正偏态（高分人数偏多）";

  $("aa_histogram_anno").innerHTML = `
    <h5>📝 分布注解</h5>
    <p>• <b>平均分</b>：${fmt(avg, 1)} 分　<b>中位数</b>：${fmt(median, 1)} 分　<b>极差</b>：${fmt(max - min, 0)} 分</p>
    <p>• <b>分布形态</b>：${skew}</p>
    <p>• <b>众数区间</b>：${labels[bins.indexOf(Math.max(...bins))]} 分（${Math.max(...bins)} 人最集中）</p>
    <p>• <b>分数段占比</b>：优秀线以上 ${totals.filter(t => t >= totalExcellentLine).length} 人（${(totals.filter(t => t >= totalExcellentLine).length / totals.length * 100).toFixed(1)}%）；及格线以下 ${totals.filter(t => t < totalPassLine).length} 人（${(totals.filter(t => t < totalPassLine).length / totals.length * 100).toFixed(1)}%）</p>
  `;
}

// ---------- ④ 总分分数段分布 ----------
function renderScoreSegments(records, subjects, totalFullScore) {
  if (!records.length || !subjects.length || totalFullScore <= 0) {
    $("aa_segments").innerHTML = `<div class="empty-state"><div class="es-tip">暂无分数段数据</div></div>`;
    $("aa_segments_anno").innerHTML = "";
    return;
  }
  const totalPassLine = subjects.reduce((s, x) => s + x.pass, 0);
  const totalExcellentLine = subjects.reduce((s, x) => s + x.excellent, 0);
  const totalGoodLine = subjects.reduce((s, x) => s + x.good, 0);
  const totalLowLine = subjects.reduce((s, x) => s + x.low, 0);
  const segments = [
    { name: `优秀（≥${totalExcellentLine}分）`, minLine: totalExcellentLine, color: "#28a745" },
    { name: `良好（${totalGoodLine}~${totalExcellentLine}分）`, minLine: totalGoodLine, maxLine: totalExcellentLine, color: "#17a2b8" },
    { name: `中等（${totalPassLine}~${totalGoodLine}分）`, minLine: totalPassLine, maxLine: totalGoodLine, color: "#ffc107" },
    { name: `及格（${totalLowLine}~${totalPassLine}分）`, minLine: totalLowLine, maxLine: totalPassLine, color: "#fd7e14" },
    { name: `不及格（<${totalLowLine}分）`, maxLine: totalLowLine, color: "#dc3545" }
  ];

  const classList = [...new Set(records.map((r) => r.classNo))].sort();

  const segData = segments.map((seg) => {
    const countAll = records.filter((r) => {
      if (seg.minLine != null && seg.maxLine != null) return r.total >= seg.minLine && r.total < seg.maxLine;
      if (seg.minLine != null) return r.total >= seg.minLine;
      if (seg.maxLine != null) return r.total < seg.maxLine;
      return false;
    }).length;
    const byClass = {};
    classList.forEach((c) => {
      const classRecs = records.filter((r) => r.classNo === c);
      byClass[c] = classRecs.filter((r) => {
        if (seg.minLine != null && seg.maxLine != null) return r.total >= seg.minLine && r.total < seg.maxLine;
        if (seg.minLine != null) return r.total >= seg.minLine;
        if (seg.maxLine != null) return r.total < seg.maxLine;
        return false;
      }).length;
    });
    return { ...seg, count: countAll, byClass };
  });

  let html = `
    <div class="table-wrap">
      <table class="score-segment-table">
        <thead>
          <tr>
            <th>分数段</th>
            <th>全年级人数</th>
            <th>全年级占比</th>
            ${classList.map((c) => `<th>${c}人数</th>`).join("")}
          </tr>
        </thead>
        <tbody>
  `;
  segData.forEach((seg, idx) => {
    const isHigh = idx === 0;
    const isLow = idx === segData.length - 1;
    html += `<tr>
      <td style="font-weight:600;color:${seg.color}">${seg.name}</td>
      <td class="${isHigh ? 'segment-high' : isLow ? 'segment-low' : ''}">${seg.count} 人</td>
      <td>
        <div class="segment-bar-wrap">
          <div class="segment-bar"><div class="segment-bar-fill" style="width:${(seg.count / records.length * 100).toFixed(1)}%;background:${seg.color}"></div></div>
          <span>${(seg.count / records.length * 100).toFixed(1)}%</span>
        </div>
      </td>
      ${classList.map((c) => `<td>${seg.byClass[c] || 0}</td>`).join("")}
    </tr>`;
  });
  html += `</tbody></table></div>`;

  // 高分段和不及格各班对比
  const highSeg = segData[0];
  const lowSeg = segData[segData.length - 1];

  let highList = classList.map((c) => ({
    class: c,
    count: highSeg.byClass[c] || 0,
    total: records.filter(r => r.classNo === c).length
  })).sort((a, b) => b.count / (b.total || 1) - a.count / (a.total || 1));

  let lowList = classList.map((c) => ({
    class: c,
    count: lowSeg.byClass[c] || 0,
    total: records.filter(r => r.classNo === c).length
  })).sort((a, b) => b.count / (b.total || 1) - a.count / (a.total || 1));

  $("aa_segments").innerHTML = html;

  $("aa_segments_anno").innerHTML = `
    <h5>📝 分数段注解（按得分率划分）</h5>
    <p>• <b>高分段对比</b>：${highList[0]?.class} 高分段占比最高（${highList[0] ? (highList[0].count / (highList[0].total || 1) * 100).toFixed(1) : 0}%，${highList[0]?.count || 0}人）；${highList[highList.length - 1]?.class} 高分段占比最低（${highList[highList.length - 1] ? (highList[highList.length - 1].count / (highList[highList.length - 1].total || 1) * 100).toFixed(1) : 0}%，${highList[highList.length - 1]?.count || 0}人）</p>
    <p>• <b>低分段对比</b>：${lowList[lowList.length - 1]?.class} 低分段占比最低（${lowList[lowList.length - 1] ? (lowList[lowList.length - 1].count / (lowList[lowList.length - 1].total || 1) * 100).toFixed(1) : 0}%，${lowList[lowList.length - 1]?.count || 0}人）；${lowList[0]?.class} 低分段占比最高（${lowList[0] ? (lowList[0].count / (lowList[0].total || 1) * 100).toFixed(1) : 0}%，${lowList[0]?.count || 0}人）</p>
    <p>• <b>整体判断</b>：${highSeg.count + segData[1].count} 人达到中高段以上（得分率≥80%，${((highSeg.count + segData[1].count) / records.length * 100).toFixed(1)}%），${lowSeg.count} 人在低分段（得分率<60%，${(lowSeg.count / records.length * 100).toFixed(1)}%），呈${segData[2].count > records.length * 0.3 ? "橄榄型（中间大两头小）" : "偏态分布"}。</p>
  `;
}

// ---------- ⑤ 班级学科热力图 ----------
function renderHeatmap(records, subjects, gradeStats) {
  if (!records.length || !subjects.length) {
    $("aa_heatmap").innerHTML = `<div class="empty-state"><div class="es-tip">暂无热力图数据</div></div>`;
    return;
  }
  const classList = [...new Set(records.map((r) => r.classNo))].sort();
  const classStats = {};
  classList.forEach((c) => {
    classStats[c] = aggregateStats(records.filter((r) => r.classNo === c), subjects);
  });

  let html = `<table class="heatmap-table"><thead><tr><th>班级</th>${subjects.map(s => `<th>${s.name}</th>`).join("")}<th>总分</th></tr></thead><tbody>`;

  classList.forEach((c) => {
    html += `<tr><td style="font-weight:600;background:#f8f9fc">${c}</td>`;
    subjects.forEach((s) => {
      const classAvg = classStats[c][s.name].avg;
      const gradeAvg = gradeStats[s.name].avg;
      const diff = classAvg - gradeAvg;
      let cls = "heatmap-cell ";
      if (diff >= 5) cls += "above-strong";
      else if (diff > 1) cls += "above";
      else if (diff < -5) cls += "below-strong";
      else if (diff < -1) cls += "below";
      else cls += "equal";
      html += `<td class="${cls}" title="${c} ${s.name}均分：${fmt(classAvg, 1)}，年级均分：${fmt(gradeAvg, 1)}，差值：${diff >= 0 ? '+' : ''}${fmt(diff, 1)}">${fmt(classAvg, 1)}<br><span style="font-size:10px;font-weight:400">${diff >= 0 ? '+' : ''}${fmt(diff, 1)}</span></td>`;
    });
    const totalClassAvg = classStats[c]["总分"].avg;
    const totalGradeAvg = gradeStats["总分"].avg;
    const totalDiff = totalClassAvg - totalGradeAvg;
    let tcls = "heatmap-cell ";
    if (totalDiff >= 10) tcls += "above-strong";
    else if (totalDiff > 2) tcls += "above";
    else if (totalDiff < -10) tcls += "below-strong";
    else if (totalDiff < -2) tcls += "below";
    else tcls += "equal";
    html += `<td class="${tcls}" style="font-weight:700">${fmt(totalClassAvg, 1)}<br><span style="font-size:10px;font-weight:400">${totalDiff >= 0 ? '+' : ''}${fmt(totalDiff, 1)}</span></td>`;
    html += `</tr>`;
  });

  // 年级均分行
  html += `<tr style="background:#f8f9fc;font-weight:600">
    <td>年级均分</td>
    ${subjects.map(s => `<td>${fmt(gradeStats[s.name].avg, 1)}</td>`).join("")}
    <td>${fmt(gradeStats["总分"].avg, 1)}</td>
  </tr>`;

  html += `</tbody></table>`;
  $("aa_heatmap").innerHTML = html;
}

// ---------- ⑥ 进退步分布图 ----------
function renderProgressDistribution(exams, selectedExam, grade, currentRecs) {
  const examIdx = exams.findIndex((e) => e.id === selectedExam.id);
  const wrap = $("aa_progress_wrap");

  if (examIdx <= 0) {
    wrap.innerHTML = `<div class="empty-state"><div class="es-icon">🔄</div><div class="es-title">暂无进退步数据</div><div class="es-tip">进退步分析需要至少两次考试数据。请选择后面的考试以查看与上一次的对比。</div></div>`;
    $("aa_progress_anno").innerHTML = `
      <h5>📝 说明</h5>
      <p>• 进退步分布图需要至少两次考试数据才能生成。</p>
      <p>• 当前所选考试为最早的一次，没有上一次考试可供对比。</p>
      <p>• 请在顶部选择一次较新的考试，系统将自动与前一次考试对比生成进退步分析。</p>
    `;
    return;
  }

  const prevExam = exams[examIdx - 1];
  const prevRecs = DB.records.filter((r) => r.examId === prevExam.id && r.grade === grade && (!r.status || r.status === "confirmed" || r.status === "pending"));

  if (prevRecs.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><div class="es-tip">上一次考试暂无成绩数据</div></div>`;
    return;
  }

  // 计算每个学生的进退步
  const prevMap = {};
  prevRecs.forEach((r) => { prevMap[r.studentId] = r.total; });

  const changes = [];
  currentRecs.forEach((r) => {
    if (prevMap[r.studentId] != null) {
      changes.push({
        studentId: r.studentId,
        studentName: r.studentName,
        classNo: r.classNo,
        prev: prevMap[r.studentId],
        curr: r.total,
        diff: r.total - prevMap[r.studentId]
      });
    }
  });

  if (changes.length < 5) {
    wrap.innerHTML = `<div class="empty-state"><div class="es-tip">有效对比数据不足（${changes.length} 人）</div></div>`;
    return;
  }

  // 按进退步幅度分段
  const segDefs = [
    { name: "进步 ≥30分", min: 30, color: "#28a745" },
    { name: "进步 15~30分", min: 15, max: 30, color: "#20c997" },
    { name: "进步 5~15分", min: 5, max: 15, color: "#8fd19e" },
    { name: "波动 ±5分", min: -5, max: 5, color: "#ffc107" },
    { name: "退步 5~15分", min: -15, max: -5, color: "#fd7e14" },
    { name: "退步 15~30分", min: -30, max: -15, color: "#e74c3c" },
    { name: "退步 ≥30分", max: -30, color: "#922b21" }
  ];

  const segCounts = segDefs.map((seg) => {
    return changes.filter((c) => {
      if (seg.min != null && seg.max != null) return c.diff >= seg.min && c.diff < seg.max;
      if (seg.min != null) return c.diff >= seg.min;
      if (seg.max != null) return c.diff < seg.max;
      return false;
    }).length;
  });

  wrap.innerHTML = `<div class="chart-box" style="height:350px"><canvas id="aa_progress_chart"></canvas></div>`;

  setTimeout(() => {
    const canvas = $("aa_progress_chart");
    if (canvas._chart) canvas._chart.destroy();
    canvas._chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: segDefs.map((s) => s.name),
        datasets: [{
          label: "人数",
          data: segCounts,
          backgroundColor: segDefs.map((s) => s.color),
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.x} 人` } }
        },
        scales: {
          x: { beginAtZero: true, title: { display: true, text: "人数" } }
        }
      }
    });
  }, 50);

  const progressCount = changes.filter(c => c.diff > 5).length;
  const regressCount = changes.filter(c => c.diff < -5).length;
  const avgDiff = changes.reduce((s, c) => s + c.diff, 0) / changes.length;

  $("aa_progress_anno").innerHTML = `
    <h5>📝 进退步分析注解（对比 ${esc(prevExam.name)}）</h5>
    <p>• <b>有效对比人数</b>：${changes.length} 人（两次考试均有成绩）</p>
    <p>• <b>整体趋势</b>：${avgDiff >= 0 ? '📈 整体进步' : '📉 整体退步'}，平均变化 <b style="color:${avgDiff >= 0 ? '#28a745' : '#dc3545'}">${avgDiff >= 0 ? '+' : ''}${fmt(avgDiff, 1)} 分</b></p>
    <p>• <b>进步人数</b>（提高>5分）：${progressCount} 人，占比 ${(progressCount / changes.length * 100).toFixed(1)}%</p>
    <p>• <b>退步人数</b>（下降>5分）：${regressCount} 人，占比 ${(regressCount / changes.length * 100).toFixed(1)}%</p>
    <p>• <b>稳定人数</b>（波动±5分）：${changes.filter(c => Math.abs(c.diff) <= 5).length} 人，占比 ${(changes.filter(c => Math.abs(c.diff) <= 5).length / changes.length * 100).toFixed(1)}%</p>
  `;
}

// ---------- 学科教学建议生成器（基于数据指标的科学建议） ----------
function generateSubjectSuggestion(s, st) {
  const scoreRate = s.fullScore > 0 ? (st.avg / s.fullScore * 100) : 0;
  const failCount = st.total - st.passCount;
  const failPct = st.total > 0 ? (failCount / st.total * 100) : 0;
  const excellentPct = st.total > 0 ? (st.excellent / st.total * 100) : 0;
  const passPct = st.total > 0 ? (st.passCount / st.total * 100) : 0;
  const lowPct = st.total > 0 ? (st.low / st.total * 100) : 0;
  const goodPct = st.total > 0 ? (st.good / st.total * 100) : 0;

  const suggestions = [];
  let level = "success", levelLabel = "优秀", levelIcon = "🟢";

  // ===== 1. 整体水平评估（基于得分率）=====
  if (scoreRate < 50) {
    suggestions.push(`【得分率${scoreRate.toFixed(1)}%·整体偏低】均分${fmt(st.avg,1)}分（满分${s.fullScore}分），不足五成。建议：①分析试卷结构，统计各题得分率，找出得分率最低的题型/知识板块；②对得分率低于30%的题目重点讲评，明确失分原因；③课堂增加基础训练比重，确保简单题不失分；④下次考试目标：得分率提升至55%以上。`);
    level = "danger"; levelLabel = "紧急"; levelIcon = "🔴";
  } else if (scoreRate < 60) {
    suggestions.push(`【得分率${scoreRate.toFixed(1)}%·有待提升】均分${fmt(st.avg,1)}分，处于及格线附近。建议：①统计各分数段人数分布，分析低分段学生集中在哪些题型；②对高频失分题目进行专项讲评和变式训练；③增加课堂互动，确保学生跟上教学进度；④下次考试目标：得分率提升至65%以上。`);
    level = "danger"; levelLabel = "紧急"; levelIcon = "🔴";
  } else if (scoreRate < 70) {
    suggestions.push(`【得分率${scoreRate.toFixed(1)}%·中等水平】均分${fmt(st.avg,1)}分，有提升空间。建议：①分析中等难度题目的得分情况，这是提分性价比最高的部分；②课堂增加变式训练，提升学生灵活应用能力；③建立错题本制度，每周回顾典型错题；④下次考试目标：得分率提升至72%以上。`);
    level = "warning"; levelLabel = "关注"; levelIcon = "🟠";
  } else if (scoreRate < 80) {
    suggestions.push(`【得分率${scoreRate.toFixed(1)}%·良好】均分${fmt(st.avg,1)}分，整体基础扎实。建议：①分析高难度题目的失分原因，寻找提分突破口；②对优秀线边缘学生重点关注，帮助其突破瓶颈；③可适当增加拓展内容，培养学科素养。`);
    if (level === "success") { level = "info"; levelLabel = "良好"; levelIcon = "🔵"; }
  } else if (scoreRate < 90) {
    suggestions.push(`【得分率${scoreRate.toFixed(1)}%·优秀】均分${fmt(st.avg,1)}分，整体表现优秀。建议：①分析少数失分点，进行精准讲评；②可引入拓展性学习资源，满足学有余力学生需求；③关注个别未达优秀的学生，帮助其查漏补缺。`);
  } else {
    suggestions.push(`【得分率${scoreRate.toFixed(1)}%·卓越】均分${fmt(st.avg,1)}分，教学成效显著。建议：继续保持现有教学策略，同时关注满分突破。`);
  }

  // ===== 2. 及格情况分析 =====
  if (passPct < 50) {
    suggestions.push(`【及格率${passPct.toFixed(1)}%·严重不足】${failCount}人不及格（占${failPct.toFixed(1)}%），超半数未达标。建议：①将不及格学生按分数段分类管理（及格线差5分内为临界生，差5分以上为学困生）；②临界生：每周2次15分钟针对性辅导；③学困生：从基础入手，降低学习起点；④课堂确保30%以上时间用于基础训练。`);
    level = "danger"; levelLabel = "紧急"; levelIcon = "🔴";
  } else if (passPct < 70) {
    suggestions.push(`【及格率${passPct.toFixed(1)}%·有待提升】${failCount}人不及格。建议：①分析不及格学生的失分类型（知识性失分vs非知识性失分）；②对知识性失分学生安排基础过关测试；③对非知识性失分学生训练答题规范和时间管理。`);
    if (level !== "danger") { level = "warning"; levelLabel = "关注"; levelIcon = "🟠"; }
  } else if (passPct < 85) {
    suggestions.push(`【及格率${passPct.toFixed(1)}%·良好】${failCount}人不及格。建议：①对不及格学生进行个别诊断，分析学习困难原因；②安排优秀学生结对帮扶；③关注及格线附近学生，防止下次掉队。`);
  } else {
    suggestions.push(`【及格率${passPct.toFixed(1)}%·优秀】仅${failCount}人不及格，基础教学成效显著。建议：继续保持，将精力转向培优。`);
  }

  // ===== 3. 尖子生培养分析 =====
  if (excellentPct < 5) {
    suggestions.push(`【优秀率${excellentPct.toFixed(1)}%·尖子生稀缺】仅${st.excellent}人达到优秀线。建议：①分析良好段学生的失分情况，找到冲优突破口；②对有冲优潜力的学生制定个性化提升方案；③课堂上设置思考题，给学有余力学生更多挑战。`);
    if (level === "success") { level = "warning"; levelLabel = "关注"; levelIcon = "🟠"; }
  } else if (excellentPct < 15) {
    suggestions.push(`【优秀率${excellentPct.toFixed(1)}%】${st.excellent}人优秀。建议：①对优秀学生进行分层指导，稳定优秀生+波动优秀生；②分析优秀学生离满分的差距，进行精准训练。`);
  } else if (excellentPct >= 30) {
    suggestions.push(`【优秀率${excellentPct.toFixed(1)}%·突出】${st.excellent}人优秀，尖子生群体强大。建议：发挥优秀群体的辐射效应，带动全班学习氛围。`);
  }

  // ===== 4. 成绩分化程度分析 =====
  if (st.stdDev > 18) {
    suggestions.push(`【标准差${fmt(st.stdDev,1)}分·两极分化严重】最高${fmt(st.max,1)}分，最低${fmt(st.min,1)}分，差距达${fmt(st.max - st.min,1)}分。建议：①实施分层教学，A层（优秀）自主探究，B层（中等）精讲精练，C层（学困）夯实基础；②作业分层设计，让每个层次学生都有收获。`);
    if (level !== "danger") { level = "warning"; levelLabel = "关注"; levelIcon = "🟠"; }
  } else if (st.stdDev > 12) {
    suggestions.push(`【标准差${fmt(st.stdDev,1)}分·分化明显】建议：课堂提问分层，让不同层次学生都有参与感；关注中等偏下学生，他们是提升均分的主力军。`);
  }

  // ===== 5. 低分情况分析 =====
  if (lowPct > 20) {
    suggestions.push(`【低分率${lowPct.toFixed(1)}%·严重】${st.low}人处于低分段。建议：①对低分学生逐一谈话，了解学习困难原因；②排查是否存在知识断层，必要时安排跨年级补基础；③降低作业难度和量，先建立学习信心。`);
    level = "danger"; levelLabel = "紧急"; levelIcon = "🔴";
  } else if (lowPct > 10) {
    suggestions.push(`【低分率${lowPct.toFixed(1)}%】${st.low}人低分。建议：安排课后基础补习，对低分学生进行学习诊断。`);
    if (level === "success") { level = "warning"; levelLabel = "关注"; levelIcon = "🟠"; }
  }

  // ===== 6. 中等生群体分析 =====
  if (goodPct > 30) {
    suggestions.push(`【良好率${goodPct.toFixed(1)}%】${st.good}人处于良好段，是提优的"蓄水池"。建议：分析良好段学生与优秀线的差距（通常3-8分），针对性突破。`);
  }

  return { level, levelLabel, levelIcon, suggestions };
}

// ---------- ⑦ 科目表现 ----------
function renderSubjectPerformance(stats, subjects) {
  if (!subjects.length) {
    $("aa_subject_perf").innerHTML = `<div class="empty-state"><div class="es-tip">暂无科目数据</div></div>`;
    return;
  }
  const rows = subjects.map((s) => {
    const st = stats[s.name];
    const failCount = st.total - st.passCount;
    const failPct = st.total > 0 ? (failCount / st.total) : 0;
    const scoreRate = s.fullScore > 0 ? (st.avg / s.fullScore * 100).toFixed(1) : "0.0";
    return `
      <tr>
        <td><b>${esc(s.name)}</b></td>
        <td>${st.total}</td>
        <td>${fmt(st.avg, 1)} / ${s.fullScore}</td>
        <td>${scoreRate}%</td>
        <td class="segment-high">${st.excellent}</td>
        <td class="segment-high">${fmt(st.excellentPct * 100, 1)}%</td>
        <td style="color:#17a2b8;font-weight:600">${st.good}</td>
        <td style="color:#17a2b8;font-weight:600">${fmt(st.goodPct * 100, 1)}%</td>
        <td>${st.passCount}</td>
        <td>${fmt(st.passPct * 100, 1)}%</td>
        <td class="segment-low">${failCount}</td>
        <td class="segment-low">${fmt(failPct * 100, 1)}%</td>
        <td style="color:#dc3545;font-weight:600">${st.low}</td>
        <td style="color:#dc3545;font-weight:600">${fmt(st.lowPct * 100, 1)}%</td>
        <td>${fmt(st.stdDev, 1)}</td>
      </tr>
    `;
  }).join("");

  $("aa_subject_perf").innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>学科</th>
          <th>人数</th>
          <th>平均分 / 满分</th>
          <th>得分率</th>
          <th>优秀人数</th>
          <th>优秀率</th>
          <th>良好人数</th>
          <th>良好率</th>
          <th>及格人数</th>
          <th>及格率</th>
          <th>不及格人数</th>
          <th>不及格率</th>
          <th>低分人数</th>
          <th>低分率</th>
          <th>标准差</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ---------- ⑨ 学科教学建议 ----------
function renderSubjectSuggestions(stats, subjects) {
  if (!subjects.length) {
    $("aa_subject_suggestions").innerHTML = `<div class="empty-state"><div class="es-tip">暂无科目数据</div></div>`;
    return;
  }

  const sortedSubjects = [...subjects].sort((a, b) => {
    const sa = generateSubjectSuggestion(a, stats[a.name]);
    const sb = generateSubjectSuggestion(b, stats[b.name]);
    const priority = { danger: 0, warning: 1, info: 2, success: 3 };
    return priority[sa.level] - priority[sb.level];
  });

  $("aa_subject_suggestions").innerHTML = `
    <div style="padding:4px 0;">
      ${sortedSubjects.map((s) => {
        const st = stats[s.name];
        const sug = generateSubjectSuggestion(s, st);
        const borderColor = sug.level === 'danger' ? '#dc3545' : sug.level === 'warning' ? '#ffc107' : sug.level === 'success' ? '#28a745' : '#17a2b8';
        const bgColor = sug.level === 'danger' ? '#fff5f5' : sug.level === 'warning' ? '#fff8e6' : sug.level === 'success' ? '#f0fff4' : '#f0f8ff';
        const textColor = sug.level === 'danger' ? '#dc3545' : sug.level === 'warning' ? '#ff8c00' : sug.level === 'success' ? '#28a745' : '#17a2b8';
        return `
          <div style="margin-bottom:16px;padding:16px;border-radius:12px;border-left:5px solid ${borderColor};background:${bgColor};">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <div>
                <span style="font-weight:700;font-size:16px;color:${textColor};">${sug.levelIcon} ${esc(s.name)}</span>
                <span style="margin-left:8px;font-size:13px;color:#666;">· ${sug.levelLabel}</span>
              </div>
              <div style="font-size:12px;color:#666;">
                均分 ${fmt(st.avg,1)}/${s.fullScore} | 及格率 ${fmt(st.passPct * 100,1)}% | 标准差 ${fmt(st.stdDev,1)}
              </div>
            </div>
            <div style="margin-top:8px;">
              ${sug.suggestions.map((sg, idx) => `
                <div style="font-size:14px;line-height:1.8;margin-bottom:10px;color:#333;position:relative;padding-left:22px;">
                  <span style="position:absolute;left:0;font-weight:700;color:${textColor};">${idx + 1}.</span>
                  ${esc(sg)}
                </div>
              `).join("")}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

// ---------- ⑧ 需要关注的学生 ----------
function renderStudentsToWatch(records, exams, selectedExam, grade, subjects) {
  if (!records.length || !selectedExam || !subjects.length) {
    $("aa_students_grid").innerHTML = `<div class="empty-state"><div class="es-tip">暂无学生数据</div></div>`;
    return;
  }

  // 获取筛选条件
  const classFilter = $("aa_stu_class_filter")?.value || "all";
  const displayLimit = parseInt($("aa_stu_limit")?.value) || 50;

  // 根据班级筛选记录
  const filteredRecords = classFilter === "all" ? records : records.filter(r => r.classNo === classFilter);

  const examIdx = exams.findIndex((e) => e.id === selectedExam.id);
  const prevExam = examIdx > 0 ? exams[examIdx - 1] : null;
  const prevRecs = prevExam ? DB.records.filter((r) => r.examId === prevExam.id && r.grade === grade && (!r.status || r.status === "confirmed" || r.status === "pending")) : [];
  const prevMap = {};
  prevRecs.forEach((r) => { prevMap[r.studentId] = r; });

  // 计算总分满分和及格线
  const totalFullScore = subjects.reduce((s, x) => s + x.fullScore, 0);
  const totalPassLine = subjects.reduce((s, x) => s + x.pass, 0);

  // 1) 偏科生：有学科优秀且有学科不及格
  const allPartialStudents = filteredRecords.map((r) => {
    const excellentSubjects = subjects.filter((s) => (r.scores[s.name] ?? 0) >= s.excellent);
    const failSubjects = subjects.filter((s) => (r.scores[s.name] ?? 0) < s.pass);
    const score = excellentSubjects.length * 10 + failSubjects.length * 10;
    return { ...r, excellentSubjects, failSubjects, partialScore: score };
  }).filter((r) => r.excellentSubjects.length > 0 && r.failSubjects.length > 0)
    .sort((a, b) => b.partialScore - a.partialScore);
  const partialStudents = allPartialStudents.slice(0, displayLimit);

  // 2) 未达线（总分未达及格线）
  const allBelowStudents = filteredRecords
    .filter((r) => r.total < totalPassLine)
    .sort((a, b) => a.total - b.total);
  const belowStudents = allBelowStudents.slice(0, displayLimit);

  // 3) 进步明显
  let allProgressStudents = [];
  let progressStudents = [];
  if (prevExam) {
    allProgressStudents = filteredRecords.map((r) => {
      const prev = prevMap[r.studentId];
      if (!prev) return null;
      return { ...r, prevTotal: prev.total, diff: r.total - prev.total };
    }).filter(Boolean)
      .filter((r) => r.diff >= 20)
      .sort((a, b) => b.diff - a.diff);
    progressStudents = allProgressStudents.slice(0, displayLimit);
  }

  // 4) 退步明显
  let allRegressStudents = [];
  let regressStudents = [];
  if (prevExam) {
    allRegressStudents = filteredRecords.map((r) => {
      const prev = prevMap[r.studentId];
      if (!prev) return null;
      return { ...r, prevTotal: prev.total, diff: r.total - prev.total };
    }).filter(Boolean)
      .filter((r) => r.diff <= -20)
      .sort((a, b) => a.diff - b.diff);
    regressStudents = allRegressStudents.slice(0, displayLimit);
  }

  // 存储全部数据供下载使用
  window._aaWatchStudentsData = {
    partial: allPartialStudents,
    below: allBelowStudents,
    progress: allProgressStudents,
    regress: allRegressStudents
  };
  window._aaWatchStudentsInfo = {
    grade,
    examName: selectedExam.name,
    subjects,
    totalFullScore,
    totalPassLine,
    classFilter
  };

  const tabs = [
    { id: "partial", name: "偏科生", count: allPartialStudents.length, data: partialStudents, badge: "badge-partial" },
    { id: "below", name: "未达线", count: allBelowStudents.length, data: belowStudents, badge: "badge-below" },
    { id: "progress", name: "进步明显", count: allProgressStudents.length, data: progressStudents, badge: "badge-progress" },
    { id: "regress", name: "退步明显", count: allRegressStudents.length, data: regressStudents, badge: "badge-regress" }
  ];

  $("aa_student_tabs").innerHTML = tabs.map((t) => `
    <div class="student-tab ${_aaActiveStudentTab === t.id ? 'active' : ''}" data-tab="${t.id}">
      ${t.name}<span class="tab-count">${t.count}</span>
    </div>
  `).join("");

  $("aa_student_tabs").querySelectorAll(".student-tab").forEach((el) => {
    el.onclick = () => {
      _aaActiveStudentTab = el.dataset.tab;
      renderStudentsToWatch(records, exams, selectedExam, grade, subjects);
    };
  });

  const activeTab = tabs.find((t) => t.id === _aaActiveStudentTab) || tabs[0];
  const students = activeTab.data;

  if (students.length === 0) {
    $("aa_students_grid").innerHTML = `<div class="empty-state"><div class="es-tip">暂无${activeTab.name}学生</div></div>`;
    return;
  }

  const colors = ["#3b7ddd", "#28a745", "#ffc107", "#dc3545", "#17a2b8", "#6f42c1", "#fd7e14", "#20c997"];

  $("aa_students_grid").innerHTML = `
    <div class="student-grid">
      ${students.map((r, idx) => {
        const color = colors[idx % colors.length];
        const initial = r.studentName ? r.studentName.charAt(0) : "?";
        let extraInfo = "";
        let subjectBars = "";

        if (_aaActiveStudentTab === "partial") {
          extraInfo = `
            <div class="sc-row"><span class="sc-label">优势学科</span><span class="sc-value" style="color:#28a745">${r.excellentSubjects.map(s => s.name).join("、")}</span></div>
            <div class="sc-row"><span class="sc-label">薄弱学科</span><span class="sc-value" style="color:#dc3545">${r.failSubjects.map(s => s.name).join("、")}</span></div>
          `;
        } else if (_aaActiveStudentTab === "below") {
          const failSubs = subjects.filter((s) => (r.scores[s.name] ?? 0) < s.pass);
          extraInfo = `
            <div class="sc-row"><span class="sc-label">总分</span><span class="sc-value">${r.total} 分</span></div>
            <div class="sc-row"><span class="sc-label">得分率</span><span class="sc-value" style="color:#dc3545">${(r.total / totalFullScore * 100).toFixed(1)}%</span></div>
            <div class="sc-row"><span class="sc-label">不及格科目</span><span class="sc-value" style="color:#dc3545">${failSubs.length} 门</span></div>
          `;
        } else if (_aaActiveStudentTab === "progress") {
          extraInfo = `
            <div class="sc-row"><span class="sc-label">上次总分</span><span class="sc-value">${r.prevTotal} 分</span></div>
            <div class="sc-row"><span class="sc-label">本次总分</span><span class="sc-value">${r.total} 分</span></div>
            <div class="sc-row"><span class="sc-label">进步幅度</span><span class="sc-value" style="color:#28a745">+${r.diff} 分</span></div>
          `;
        } else if (_aaActiveStudentTab === "regress") {
          extraInfo = `
            <div class="sc-row"><span class="sc-label">上次总分</span><span class="sc-value">${r.prevTotal} 分</span></div>
            <div class="sc-row"><span class="sc-label">本次总分</span><span class="sc-value">${r.total} 分</span></div>
            <div class="sc-row"><span class="sc-label">退步幅度</span><span class="sc-value" style="color:#dc3545">${r.diff} 分</span></div>
          `;
        }

        // 各科分数条
        subjectBars = `<div class="subject-bar-row">
          ${subjects.slice(0, 5).map((s) => {
            const score = r.scores[s.name] ?? 0;
            const pct = Math.min(100, score / s.fullScore * 100);
            const barColor = score >= s.excellent ? "#28a745" : score >= s.good ? "#17a2b8" : score >= s.pass ? "#ffc107" : "#dc3545";
            return `
              <div class="subject-bar-item">
                <span class="sb-name">${s.name}</span>
                <div class="sb-bar"><div class="sb-fill" style="width:${pct}%;background:${barColor}"></div></div>
                <span class="sb-val">${score}</span>
              </div>
            `;
          }).join("")}
        </div>`;

        return `
          <div class="student-card">
            <div class="student-card-header">
              <div class="student-avatar" style="background:linear-gradient(135deg, ${color}, ${color}aa)">${initial}</div>
              <div class="student-info">
                <div class="student-name">${esc(r.studentName)}</div>
                <div class="student-class">${r.classNo} · ${r.studentId}</div>
              </div>
              <span class="student-card-badge ${activeTab.badge}">${activeTab.name}</span>
            </div>
            <div class="student-card-body">
              ${extraInfo}
              ${subjectBars}
            </div>
          </div>
        `;
      }).join("")}
    </div>
    <div style="text-align:center;color:var(--text-light);font-size:12px;margin-top:12px">
      显示前 ${students.length} 名学生 / 共 ${activeTab.count} 人${classFilter !== 'all' ? `（${classFilter}）` : ''}
    </div>
  `;
}

// 关注学生批量下载功能
window.downloadWatchStudents = function (type) {
  const data = window._aaWatchStudentsData;
  const info = window._aaWatchStudentsInfo;

  if (!data || !info) {
    showToast("请先选择考试并加载数据", "warning");
    return;
  }

  const { grade, examName, subjects, totalFullScore, totalPassLine, classFilter } = info;
  const activeTabId = _aaActiveStudentTab || "partial";

  let students = data[activeTabId] || [];
  const tabNames = { partial: "偏科生", below: "未达线", progress: "进步明显", regress: "退步明显" };
  const tabName = tabNames[activeTabId] || "关注学生";

  // 如果是班级下载，需要按班级分组
  if (type === "class") {
    const classGroups = {};
    const classList = [...new Set(students.map(r => r.classNo))].sort();

    classList.forEach(c => {
      const classStudents = students.filter(r => r.classNo === c);
      if (classStudents.length > 0) {
        classGroups[c] = classStudents;
      }
    });

    const wb = XLSX.utils.book_new();
    const sheetNames = [];
    const classFilterSel = $("aa_stu_class_filter");
    const currentClass = classFilterSel?.value || "all";

    // 如果当前显示的是某个班级，只下载该班级
    if (currentClass !== "all") {
      const classStudents = classGroups[currentClass] || [];
      if (classStudents.length === 0) {
        showToast("该班级暂无" + tabName, "warning");
        return;
      }
      const sheetData = buildStudentSheetData(classStudents, subjects, totalFullScore, totalPassLine, activeTabId, examName, currentClass);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetData), currentClass + " " + tabName);
      sheetNames.push(currentClass);
    } else {
      // 下载所有班级，每个班级一个sheet
      Object.keys(classGroups).forEach((c, idx) => {
        const classStudents = classGroups[c];
        const sheetData = buildStudentSheetData(classStudents, subjects, totalFullScore, totalPassLine, activeTabId, examName, c);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetData), c + " " + tabName);
        sheetNames.push(c);
      });
    }

    if (sheetNames.length === 0) {
      showToast("暂无数据可下载", "warning");
      return;
    }

    XLSX.writeFile(wb, `${grade}_${examName}_${tabName}_班级下载.xlsx`);
    showToast(`已下载 ${sheetNames.length} 个班级数据`, "success");
  } else {
    // 年级下载，所有学生一个sheet
    if (students.length === 0) {
      showToast("暂无" + tabName, "warning");
      return;
    }

    const sheetData = buildStudentSheetData(students, subjects, totalFullScore, totalPassLine, activeTabId, examName, "全年级");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetData), tabName);
    XLSX.writeFile(wb, `${grade}_${examName}_${tabName}_年级下载.xlsx`);
    showToast(`已下载 ${students.length} 名学生数据`, "success");
  }
};

// 构建学生表格数据
function buildStudentSheetData(students, subjects, totalFullScore, totalPassLine, tabType, examName, className) {
  // 根据类型构建动态表头
  let header = ["班级", "学号", "姓名", "总分", "得分率", "及格线", "距及格线", ...subjects.map(s => s.name)];
  let extraHeaders = [];
  let extraValues = [];

  if (tabType === "partial") {
    extraHeaders = ["优势学科", "薄弱学科"];
  } else if (tabType === "progress") {
    extraHeaders = ["上次总分", "进步幅度"];
  } else if (tabType === "regress") {
    extraHeaders = ["上次总分", "退步幅度"];
  } else {
    extraHeaders = ["不及格科目"];
  }

  header = [...header, ...extraHeaders];

  const rows = students.map(r => {
    const failSubs = subjects.filter(s => (r.scores[s.name] ?? 0) < s.pass);
    const diff = r.total - totalPassLine;

    if (tabType === "partial") {
      const excSubs = subjects.filter(s => (r.scores[s.name] ?? 0) >= s.excellent);
      extraValues = [excSubs.map(s => s.name).join("、"), failSubs.map(s => s.name).join("、")];
    } else if (tabType === "progress") {
      extraValues = [r.prevTotal, "+" + r.diff + "分"];
    } else if (tabType === "regress") {
      extraValues = [r.prevTotal, r.diff + "分"];
    } else {
      extraValues = [failSubs.length + "门"];
    }

    return [
      r.classNo,
      r.studentId,
      r.studentName,
      r.total,
      (r.total / totalFullScore * 100).toFixed(1) + "%",
      totalPassLine,
      (diff >= 0 ? "+" : "") + diff,
      ...subjects.map(s => r.scores[s.name] ?? "-"),
      ...extraValues
    ];
  });

  // 添加表头说明行
  const typeNames = { partial: "偏科生", below: "未达线", progress: "进步明显", regress: "退步明显" };
  const titleRow = [`${className} ${examName} 关注学生列表`];
  const noteRow = [`类型：${typeNames[tabType] || "关注学生"}，共 ${students.length} 人`];

  return [titleRow, noteRow, header, ...rows];
}

// 下载教务分析报告
window.downloadAcademicAnalysis = function () {
  const grade = currentUser.grade;
  const exams = getSortedExams(grade).filter((e) => !e.isClassExam);
  if (!exams.length) { showToast("暂无考试数据", "warning"); return; }
  const selectedExamId = $("aa_exam_select")?.value || exams[exams.length - 1].id;
  const selectedExam = exams.find((e) => e.id === selectedExamId) || exams[exams.length - 1];
  const subjects = getExamSubjects(selectedExam.id);
  const allRecs = getVisibleRecords(DB.records.filter((r) => r.examId === selectedExam.id && r.grade === grade));

  const wb = XLSX.utils.book_new();

  // Sheet 1: 年级总览
  const totalFullScore = subjects.reduce((s, x) => s + x.fullScore, 0);
  const stats = aggregateStats(allRecs, subjects);
  const overviewData = [
    ["项目", "数值", "备注"],
    ["参考人数", allRecs.length, "人"],
    ["总分均分", fmt(stats["总分"].avg, 2), `满分 ${totalFullScore} 分`],
    ["总分最高分", fmt(stats["总分"].max, 2), `${stats["总分"].maxCount} 人并列`],
    ["总分最低分", fmt(stats["总分"].min, 2), `${stats["总分"].minCount} 人并列`],
    ["得分率", fmt(stats["总分"].avg / totalFullScore * 100, 2) + "%", "总分均分 / 满分"],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(overviewData), "年级总览");

  // Sheet 2: 科目表现
  const subjHeader = ["学科", "人数", "平均分", "满分", "得分率", "优秀人数", "优秀率", "良好人数", "良好率", "及格人数", "及格率", "不及格人数", "不及格率", "低分人数", "低分率"];
  const subjData = subjects.map((s) => {
    const st = stats[s.name];
    const failCount = st.total - st.passCount;
    return [s.name, st.total, fmt(st.avg, 2), s.fullScore, fmt(st.avg / s.fullScore * 100, 2) + "%",
      st.excellent, fmt(st.excellentPct * 100, 2) + "%",
      st.good, fmt(st.goodPct * 100, 2) + "%",
      st.passCount, fmt(st.passPct * 100, 2) + "%",
      failCount, fmt(failCount / st.total * 100, 2) + "%",
      st.low, fmt(st.lowPct * 100, 2) + "%"];
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([subjHeader, ...subjData]), "科目表现");

  // Sheet 3: 班级学科均分对比
  const classList = [...new Set(allRecs.map((r) => r.classNo))].sort();
  const classHeader = ["班级", "人数", ...subjects.map(s => s.name + "均分"), "总分均分"];
  const classData = classList.map((c) => {
    const crecs = allRecs.filter((r) => r.classNo === c);
    const cstats = aggregateStats(crecs, subjects);
    return [c, crecs.length, ...subjects.map(s => fmt(cstats[s.name].avg, 2)), fmt(cstats["总分"].avg, 2)];
  });
  const gradeRow = ["全年级", allRecs.length, ...subjects.map(s => fmt(stats[s.name].avg, 2)), fmt(stats["总分"].avg, 2)];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([classHeader, ...classData, gradeRow]), "班级学科对比");

  // Sheet 4: 分数段分布（使用学科配置的分数线）
  const totalPassLine = subjects.reduce((s, x) => s + x.pass, 0);
  const totalExcellentLine = subjects.reduce((s, x) => s + x.excellent, 0);
  const totalGoodLine = subjects.reduce((s, x) => s + x.good, 0);
  const totalLowLine = subjects.reduce((s, x) => s + x.low, 0);
  const segDefs = [
    { name: `优秀（≥${totalExcellentLine}分）`, minLine: totalExcellentLine },
    { name: `良好（${totalGoodLine}~${totalExcellentLine}分）`, minLine: totalGoodLine, maxLine: totalExcellentLine },
    { name: `中等（${totalPassLine}~${totalGoodLine}分）`, minLine: totalPassLine, maxLine: totalGoodLine },
    { name: `及格（${totalLowLine}~${totalPassLine}分）`, minLine: totalLowLine, maxLine: totalPassLine },
    { name: `不及格（<${totalLowLine}分）`, maxLine: totalLowLine }
  ];
  const segHeader = ["分数段", "全年级人数", "占比", ...classList.map(c => c + "人数")];
  const segData = segDefs.map((seg) => {
    const count = allRecs.filter((r) => {
      if (seg.minLine != null && seg.maxLine != null) return r.total >= seg.minLine && r.total < seg.maxLine;
      if (seg.minLine != null) return r.total >= seg.minLine;
      if (seg.maxLine != null) return r.total < seg.maxLine;
      return false;
    }).length;
    const byClass = classList.map((c) => {
      return allRecs.filter((r) => r.classNo === c && (() => {
        if (seg.minLine != null && seg.maxLine != null) return r.total >= seg.minLine && r.total < seg.maxLine;
        if (seg.minLine != null) return r.total >= seg.minLine;
        if (seg.maxLine != null) return r.total < seg.maxLine;
        return false;
      })()).length;
    });
    return [seg.name, count, fmt(count / allRecs.length * 100, 2) + "%", ...byClass];
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([segHeader, ...segData]), "分数段分布");

  // Sheet 5: 学生明细
  const stuHeader = ["班级", "学号", "姓名", ...subjects.map(s => s.name), "总分", "年级排名"];
  const sortedRecs = allRecs.slice().sort((a, b) => b.total - a.total);
  const stuData = sortedRecs.map((r, i) => [r.classNo, r.studentId, r.studentName, ...subjects.map(s => r.scores[s.name] ?? "-"), r.total, i + 1]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([stuHeader, ...stuData]), "学生明细");

  XLSX.writeFile(wb, `${grade}_成绩分析报告_${selectedExam.name}.xlsx`);
  showToast("分析报告已下载", "success");
};

// ========== 班主任：班级智能分析（独立页面） ==========
let _htActiveStudentTab = "partial";

function renderHeadteacherAnalysis() {
  if (currentUser.role !== "headteacher") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const classNo = currentUser.classNo;
  // 班主任：显示年级统一考试 + 本班自建考试
  const exams = getHeadteacherExams(grade, classNo).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  if (exams.length === 0) { $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-icon">📊</div><div class="es-title">暂无考试数据</div><div class="es-tip">请先上传成绩</div></div></div>`; return; }

  const subjects = DB.subjects[grade] || [];
  const examOptions = exams.map((e, i) => `<option value="${e.id}" ${i === exams.length - 1 ? "selected" : ""}>${esc(e.name)}</option>`).join("");

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">
        <span>🔍 ${esc(classNo)} 智能成绩分析</span>
        <span class="ct-actions">
          <select id="ht_exam_select" style="padding:6px 12px;border:1px solid #ddd;border-radius:6px;margin-right:10px">${examOptions}</select>
          <button class="btn btn-primary" onclick="downloadHeadteacherAnalysis()">📥 下载班级分析报告</button>
        </span>
      </div>
    </div>

    <!-- ① 班级总览 -->
    <div class="card analysis-section" id="ht_section1">
      <div class="section-title"><span class="st-icon">📊</span>一、班级总览</div>
      <div id="ht_overview"></div>
    </div>

    <!-- ② 本次最值得做的事 -->
    <div class="card analysis-section" id="ht_section2">
      <div class="section-title"><span class="st-icon">🎯</span>二、本次最值得做的事（按重要性排序）</div>
      <div id="ht_actions"></div>
    </div>

    <!-- ③ 总分分布直方图 -->
    <div class="card analysis-section" id="ht_section3">
      <div class="section-title"><span class="st-icon">📈</span>三、本班总分分布直方图</div>
      <div class="chart-box" style="height:380px"><canvas id="ht_histogram"></canvas></div>
      <div id="ht_histogram_anno" class="section-annotation"></div>
    </div>

    <!-- ④ 总分分数段分布 -->
    <div class="card analysis-section" id="ht_section4">
      <div class="section-title"><span class="st-icon">📉</span>四、总分分数段分布（按得分率）</div>
      <div id="ht_segments"></div>
      <div id="ht_segments_anno" class="section-annotation"></div>
    </div>

    <!-- ⑤ 班级学科对比（热力图风格） -->
    <div class="card analysis-section" id="ht_section5">
      <div class="section-title"><span class="st-icon">🗺️</span>五、本班学科对比（vs 年级均分）</div>
      <div id="ht_heatmap"></div>
      <div class="heatmap-legend">
        <div class="heatmap-legend-item"><div class="heatmap-legend-color" style="background:#28a745"></div><span>高于年级均分 ≥5分</span></div>
        <div class="heatmap-legend-item"><div class="heatmap-legend-color" style="background:#d4edda"></div><span>高于年级均分 0~5分</span></div>
        <div class="heatmap-legend-item"><div class="heatmap-legend-color" style="background:#fff3cd"></div><span>持平（±1分以内）</span></div>
        <div class="heatmap-legend-item"><div class="heatmap-legend-color" style="background:#f8d7da"></div><span>低于年级均分 0~5分</span></div>
        <div class="heatmap-legend-item"><div class="heatmap-legend-color" style="background:#dc3545"></div><span>低于年级均分 ≥5分</span></div>
      </div>
    </div>

    <!-- ⑥ 进退步分布图 -->
    <div class="card analysis-section" id="ht_section6">
      <div class="section-title"><span class="st-icon">🔄</span>六、进退步分布图（本班）</div>
      <div id="ht_progress_wrap"></div>
      <div id="ht_progress_anno" class="section-annotation"></div>
    </div>

    <!-- ⑦ 科目表现 -->
    <div class="card analysis-section" id="ht_section7">
      <div class="section-title"><span class="st-icon">📚</span>七、科目表现</div>
      <div class="table-wrap" id="ht_subject_perf"></div>
    </div>

    <!-- ⑧ 需要关注的学生 -->
    <div class="card analysis-section" id="ht_section8">
      <div class="section-title"><span class="st-icon">👨‍🎓</span>八、需要关注的学生</div>
      <div class="student-tabs" id="ht_student_tabs"></div>
      <div id="ht_students_grid"></div>
    </div>
  `;

  $("ht_exam_select").addEventListener("change", () => refreshHeadteacherAnalysis());
  setTimeout(() => refreshHeadteacherAnalysis(), 50);
}

function refreshHeadteacherAnalysis() {
  const grade = currentUser.grade;
  const examId = $("ht_exam_select").value;
  window._eaCurrentExamId = examId;
  const classNo = currentUser.classNo;
  const exams = getHeadteacherExams(grade, classNo).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const selectedExam = exams.find((e) => e.id === examId) || exams[exams.length - 1];
  const subjects = DB.subjects[grade] || [];

  const classRecs = getVisibleRecords(DB.records.filter((r) => r.examId === selectedExam.id && classNoEquals(r.classNo, classNo)));
  const gradeRecs = getVisibleRecords(DB.records.filter((r) => r.examId === selectedExam.id && r.grade === grade));
  const totalFullScore = subjects.reduce((a, s) => a + (s.fullScore || 100), 0);

  const classStats = aggregateStats(classRecs, subjects);
  const gradeStats = aggregateStats(gradeRecs, subjects);

  // ① 班级总览
  renderHeadteacherOverview(classRecs, gradeRecs, classStats, gradeStats, subjects, totalFullScore, classNo);

  // ② 最值得做的事
  renderHeadteacherActions(classRecs, gradeRecs, classStats, gradeStats, subjects, exams, selectedExam, grade, classNo, totalFullScore);

  // ③ 总分分布直方图
  renderHeadteacherHistogram(classRecs, totalFullScore, subjects);

  // ④ 分数段分布
  renderHeadteacherScoreSegments(classRecs, gradeRecs, subjects, totalFullScore, classNo);

  // ⑤ 学科对比热力图
  renderHeadteacherHeatmap(classStats, gradeStats, subjects);

  // ⑥ 进退步分布
  renderHeadteacherProgress(exams, selectedExam, grade, classNo, classRecs);

  // ⑦ 科目表现
  renderHeadteacherSubjectPerf(classStats, gradeStats, subjects, classNo);

  // ⑧ 需要关注的学生
  renderHeadteacherStudents(classRecs, exams, selectedExam, grade, classNo, subjects);
}

function renderHeadteacherOverview(classRecs, gradeRecs, classStats, gradeStats, subjects, totalFullScore, classNo) {
  const classAvg = classRecs.length ? classRecs.reduce((a, b) => a + b.total, 0) / classRecs.length : 0;
  const gradeAvg = gradeRecs.length ? gradeRecs.reduce((a, b) => a + b.total, 0) / gradeRecs.length : 0;
  const gap = +fmt(classAvg - gradeAvg, 2);
  const maxScore = classRecs.length ? Math.max(...classRecs.map((r) => r.total)) : 0;
  const minScore = classRecs.length ? Math.min(...classRecs.map((r) => r.total)) : 0;

  let bestSubject = "-", bestGap = -Infinity;
  let weakSubject = "-", weakGap = Infinity;
  subjects.forEach((s) => {
    const cAvg = classStats[s.name]?.avg || 0;
    const gAvg = gradeStats[s.name]?.avg || 0;
    const d = cAvg - gAvg;
    if (d > bestGap) { bestGap = d; bestSubject = s.name; }
    if (d < weakGap) { weakGap = d; weakSubject = s.name; }
  });

  const totalPassLine = subjects.reduce((s, x) => s + x.pass, 0);
  const totalExcellentLine = subjects.reduce((s, x) => s + x.excellent, 0);
  const failCount = classRecs.filter((r) => r.total < totalPassLine).length;
  const excellentCount = classRecs.filter((r) => r.total >= totalExcellentLine).length;
  const passCount = classRecs.filter((r) => r.total >= totalPassLine).length;

  $("ht_overview").innerHTML = `
    <div class="overview-grid">
      <div class="overview-card"><div class="ov-label">参考人数</div><div class="ov-value">${classRecs.length} 人</div><div class="ov-sub">全年级 ${gradeRecs.length} 人</div></div>
      <div class="overview-card"><div class="ov-label">总分均分</div><div class="ov-value ${gap >= 0 ? 'text-green' : 'text-red'}">${fmt(classAvg, 1)}</div><div class="ov-sub">年级均分 ${fmt(gradeAvg, 1)}（${gap >= 0 ? '▲' : '▼'} ${fmt(Math.abs(gap), 1)}）</div></div>
      <div class="overview-card"><div class="ov-label">最高分</div><div class="ov-value text-green">${maxScore}</div><div class="ov-sub">满分 ${totalFullScore}</div></div>
      <div class="overview-card"><div class="ov-label">最低分</div><div class="ov-value text-red">${minScore}</div><div class="ov-sub">极差 ${fmt(maxScore - minScore, 1)}</div></div>
      <div class="overview-card"><div class="ov-label">及格人数</div><div class="ov-value">${passCount} 人</div><div class="ov-sub">及格率 ${fmt(passCount / Math.max(classRecs.length, 1) * 100, 1)}%</div></div>
      <div class="overview-card"><div class="ov-label">优秀人数</div><div class="ov-value text-green">${excellentCount} 人</div><div class="ov-sub">优秀率 ${fmt(excellentCount / Math.max(classRecs.length, 1) * 100, 1)}%</div></div>
      <div class="overview-card"><div class="ov-label">优势学科</div><div class="ov-value text-green">${bestSubject}</div><div class="ov-sub">高于年级 ${fmt(bestGap, 1)} 分</div></div>
      <div class="overview-card"><div class="ov-label">薄弱学科</div><div class="ov-value text-red">${weakSubject}</div><div class="ov-sub">低于年级 ${fmt(Math.abs(weakGap), 1)} 分</div></div>
    </div>
  `;
}

function renderHeadteacherActions(classRecs, gradeRecs, classStats, gradeStats, subjects, exams, selectedExam, grade, classNo, totalFullScore) {
  const actions = [];
  const classAvg = classRecs.length ? classRecs.reduce((a, b) => a + b.total, 0) / classRecs.length : 0;
  const gradeAvg = gradeRecs.length ? gradeRecs.reduce((a, b) => a + b.total, 0) / gradeRecs.length : 0;

  const subjectGaps = subjects.map((s) => ({
    name: s.name,
    classAvg: classStats[s.name]?.avg || 0,
    gradeAvg: gradeStats[s.name]?.avg || 0,
    gap: (classStats[s.name]?.avg || 0) - (gradeStats[s.name]?.avg || 0),
    fullScore: s.fullScore || 100,
    passPct: classStats[s.name]?.passPct || 0,
    failCount: (classStats[s.name]?.total || 0) - (classStats[s.name]?.passCount || 0),
    total: classStats[s.name]?.total || 0
  })).sort((a, b) => a.gap - b.gap);

  const weakest = subjectGaps[0];
  if (weakest && weakest.gap < -3) {
    const failRate = fmt(weakest.failCount / Math.max(weakest.total, 1) * 100, 1);
    actions.push({ level: "danger", title: `【班主任重点关注】${weakest.name} 学科薄弱（低于年级均分 ${fmt(Math.abs(weakest.gap), 1)} 分）`, desc: `作为 ${classNo} 班主任，您需要关注：${weakest.name} 均分 ${fmt(weakest.classAvg, 1)}，年级均分 ${fmt(weakest.gradeAvg, 1)}，差距达 ${fmt(Math.abs(weakest.gap), 1)} 分。该学科是制约班级排名的最大短板，不及格 ${weakest.failCount} 人（${failRate}%）。根据"短板效应"，提升该学科对班级总分的边际贡献最大。`, suggestion: `【作为班主任，您可以这样行动】

① 学科联动：第一时间与 ${weakest.name} 任课老师沟通，了解课堂情况，共同分析学生失分原因；

② 组建攻坚小组：将 ${weakest.name} 薄弱学生编组，安排课代表或优秀学生担任组长，开展"每日一题、每周一测"互助学习；

③ 时间保障：协调自习课、课后服务时间，每周安排2-3次该学科的专项辅导时段；

④ 家校联动：给薄弱学生家长发送"学科提升建议书"，指导家长在家如何配合督促和检查；

⑤ 正向激励：设立"进步最快奖"，对 ${weakest.name} 进步最大的学生及时表彰，用成就感驱动学习动力；

⑥ 目标设定：与任课老师共同制定目标——下次考试该学科均分差距缩小至2分以内，及格率提升10个百分点。` });
  }

  const totalPassLine = subjects.reduce((s, x) => s + x.pass, 0);
  const failStudents = classRecs.filter((r) => r.total < totalPassLine);
  if (failStudents.length > 0) {
    const failRate = fmt(failStudents.length / classRecs.length * 100, 1);
    const names = failStudents.slice(0, 5).map((r) => r.studentName).join("、");
    actions.push({ level: "danger", title: `【班主任重点关注】不及格学生 ${failStudents.length} 人（不及格率 ${failRate}%）`, desc: `作为 ${classNo} 班主任请注意：总分未达及格线共 ${failStudents.length} 人：${names}${failStudents.length > 5 ? " 等" : ""}。从教育统计学看，总分不及格意味着多学科同时薄弱，学生处于"学业困境"状态，如不及时干预可能进入"成绩差→没信心→更差"的恶性循环。`, suggestion: `【班主任干预策略】

① 一人一档：为每位不及格学生建立"学业成长档案"，记录每次考试的各科成绩、排名变化、薄弱点分析；

② 一生一策：与各学科老师共同制定个性化提升方案，明确每科的突破重点和阶段目标；

③ 导师结对：每位不及格学生匹配1名"导师"（可以是优势学科老师或品学兼优的同学），每周至少1次谈心+辅导；

④ 家校协同：每2周与不及格学生家长沟通1次，做到"报进步也报问题、给方法也给信心"，避免家长焦虑传导给孩子；

⑤ 小步快跑：设置周目标（如本周数学基础题正确率提升5%），用微小进步积累自信；

⑥ 心理建设：不及格学生往往伴随自卑心理，班主任要善于发现闪光点，用"多元评价"代替"唯分数论"；

⑦ 重点突破：识别"临界生"（得分率55%-60%），这些学生提分性价比最高，是您帮扶的重点对象。` });
  }

  const failSubjects = subjectGaps.filter((s) => s.passPct < 0.7).sort((a, b) => a.passPct - b.passPct);
  if (failSubjects.length > 0) {
    const fs = failSubjects[0];
    const passPct = fmt(fs.passPct * 100, 1);
    actions.push({ level: "warning", title: `【班主任协调】${fs.name} 及格率偏低（仅 ${passPct}%）`, desc: `作为班主任您需要关注：${fs.name} 及格 ${classStats[fs.name]?.passCount || 0} 人，不及格 ${fs.failCount} 人。该学科及格率显著低于班级平均水平，是拉低班级整体合格率的主要学科。`, suggestion: `【班主任协调行动】

① 与任课老师深度沟通：了解 ${fs.name} 课堂上中下三层学生的参与度，分析"听不懂→跟不上→放弃"的链条在哪一环断裂；

② 作业诊断：协助任课老师检查学困生的作业完成质量和订正情况，判断是"不会做"还是"不认真做"；

③ 小组竞赛：将班级分成若干学习小组，以小组 ${fs.name} 平均分为指标开展竞赛，用集体荣誉感驱动每个人努力；

④ 小组互助：安排 ${fs.name} 优秀学生担任"小老师"，利用课间帮助学困生讲题，输出式学习让双方都受益；

⑤ 基础过关：协助任课老师建立"每日基础题"制度，每天5道基础题，当天批改订正；

⑥ 预期目标：与任课老师共同设定——1个月内及格率提升至75%以上，不及格人数减少1/3。` });
  }

  const partialStudents = classRecs.filter((r) => {
    const hasExcellent = subjects.some((s) => {
      const score = r.scores[s.name];
      return score != null && score >= (s.fullScore || 100) * 0.9;
    });
    const hasFail = subjects.some((s) => {
      const score = r.scores[s.name];
      return score != null && score < (s.fullScore || 100) * 0.6;
    });
    return hasExcellent && hasFail;
  });
  if (partialStudents.length > 0) {
    const names = partialStudents.slice(0, 3).map((r) => r.studentName).join("、");
    actions.push({ level: "warning", title: `【班主任关注】偏科学生 ${partialStudents.length} 人（总分提升的金矿）`, desc: `作为班主任请注意：您班上有 ${partialStudents.length} 名学生同时存在"优势学科优秀+薄弱学科不及格"的偏科现象，如：${names} 等。这些学生学习能力强、有成功经验，是班级总分提升最具潜力的群体——薄弱学科每提升10分，对总分排名的拉动效果远大于优势学科再提升。`, suggestion: `【班主任干预策略】

① 优势迁移对话：与偏科生一起复盘"你是怎么把优势学科学好的"，将成功经验（如整理错题、归纳总结、大量练习）提炼出来，引导其迁移到薄弱学科；

② 学科联结：帮学生找到优势学科与薄弱学科的关联点（如数学好→物理公式推导快、语文好→英语阅读理解强），建立"我能学好"的心理暗示；

③ "1+1"帮扶：让偏科生A（数学强英语弱）和偏科生B（英语强数学弱）结对，互相讲解优势学科，实现双赢；

④ 阶梯目标：协助偏科生设定"小目标"——第一个月从不及格到及格（60分），第二个月到70分，循序渐进；

⑤ 时间分配指导：帮助偏科生合理分配学习时间，建议薄弱学科多投入30%-50%的时间。` });
  }

  if (classAvg - gradeAvg > 3) {
    const rankInGrade = 0;
    actions.push({ level: "success", title: `【班级喜报】${classNo} 整体表现优秀（高于年级均分 ${fmt(classAvg - gradeAvg, 1)} 分）`, desc: `恭喜！${classNo} 全体师生：班级总分均分高出年级 ${fmt(classAvg - gradeAvg, 1)} 分，整体实力处于年级前列。这是班级学风优良的体现，也是您班级管理智慧的结晶。`, suggestion: `【作为优秀班级的班主任，您可以】

① 经验总结：组织班科老师联席会议，总结本次成绩领先的关键因素，形成可复制的班级管理经验；

② 高位均衡：关注高分段学生的学科均衡度，避免"偏科的尖子生"在关键时刻掉链子；

③ 学风升级：将班级优秀的学习方法（如错题本制度、小组讨论、时间管理）系统化，形成" ${classNo} 学习模式"；

④ 经验辐射：作为优秀班级，可考虑向年级分享班级管理经验，同时精进自我；

⑤ 设定新目标：在年级中设定更高的对标目标，争取年级排名更进一步。` });
  }

  const last2 = exams.slice(-2);
  if (last2.length >= 2) {
    const [prevExam, currExam] = last2;
    const prevRecs = getVisibleRecords(DB.records.filter((r) => r.examId === prevExam.id && classNoEquals(r.classNo, classNo)));
    const prevAvg = prevRecs.length ? prevRecs.reduce((a, b) => a + b.total, 0) / prevRecs.length : 0;
    const trend = classAvg - prevAvg;
    if (trend > 5) {
      actions.push({ level: "info", title: `【班级进步】${classNo} 整体进步明显（较上次提升 ${fmt(trend, 1)} 分）`, desc: `从 ${prevExam.name} 到 ${currExam.name}，${classNo} 均分从 ${fmt(prevAvg, 1)} 提升到 ${fmt(classAvg, 1)}，进步 ${fmt(trend, 1)} 分！这说明近期的班级管理措施有效，需要及时总结和固化。`, suggestion: `【班主任巩固成果行动】

① 归因分析：组织班科老师联席会议，分析是哪几科进步最大？是哪些学生群体带动的进步？找到"成功因子"；

② 正向强化：在班级公开表扬进步，尤其表扬进步幅度大的学生和进步显著的小组，用"进步文化"替代"名次文化"；

③ 经验分享：请进步最大的3-5名学生分享学习方法和心得，同伴的经验最有说服力；

④ 防骄戒躁：提醒同学们"打江山易守江山难"，进步后容易出现松懈，保持清醒，乘势而上；

⑤ 设新目标：和同学们一起制定下一次考试的"踮踮脚够得着"的目标，保持持续前进的动力。` });
    } else if (trend < -5) {
      actions.push({ level: "danger", title: `【班主任预警】${classNo} 整体有所下滑（较上次下降 ${fmt(Math.abs(trend), 1)} 分）`, desc: `从 ${prevExam.name} 到 ${currExam.name}，${classNo} 均分从 ${fmt(prevAvg, 1)} 下降到 ${fmt(classAvg, 1)}，退步 ${fmt(Math.abs(trend), 1)} 分，需要您高度重视。一次退步可能是偶然，但如果连续退步就是信号。`, suggestion: `【班主任紧急应对措施】

① 紧急班会：召开"分析问题、重拾信心"主题班会，客观分析退步原因，不指责、不抱怨；

② 学科拆解：分析是哪几科退步最严重？定位"责任学科"，与任课老师共同分析原因；

③ 人群分析：是头部学生掉下来了还是尾部学生更差了？不同人群的退步原因和对策完全不同；

④ 分层谈话：班主任分层找学生谈话——头部学生"稳心态"、中层学生"找方法"、尾部学生"树信心"；

⑤ 教师联动：召开班级教师协调会，协调作业量和辅导时间，形成"齐抓共管"的合力；

⑥ 家校沟通：给全体家长发一封信，说明情况、给出建议，争取家长的理解和支持；

⑦ 跟踪监测：接下来1-2周加强作业检查和课堂关注，及时发现问题及时纠正。` });
    }
  }

  const totalExcellentLine = subjects.reduce((s, x) => s + x.excellent, 0);
  const excellentStudents = classRecs.filter((r) => r.total >= totalExcellentLine);
  if (excellentStudents.length > 0) {
    const excellentRate = fmt(excellentStudents.length / classRecs.length * 100, 1);
    actions.push({ level: "info", title: `【班级培优】高分段学生 ${excellentStudents.length} 人（优秀率 ${excellentRate}%）`, desc: `${classNo} 总分优秀（得分率≥90%）共 ${excellentStudents.length} 人，优秀率 ${excellentRate}%。尖子生是班级的"领头羊"，他们的学习状态和方法对全班有示范效应。`, suggestion: `【班主任培优工作】

① 从"学会"到"会学"：引导尖子生从"被动刷题"转向"主动建构"，培养自主学习能力；

② 设立"荣誉任务"：让尖子生担任"学科助教"，负责出每周一题、讲解难题，培养责任感；

③ 目标引领：帮助尖子生树立更高远的目标（如年级前十），用"远方的灯塔"牵引持续努力；

④ 抗挫训练：适当布置有挑战性的任务，让尖子生体验"通过努力攻克难题"的过程。` });
  }

  if (actions.length === 0) {
    actions.push({ level: "info", title: `【班级状态】${classNo} 整体表现平稳`, desc: `各项指标均在正常范围内，${classNo} 处于稳定发展状态。作为班主任，您的职责是保持这个良好的势头。`, suggestion: `【班主任日常工作】

① 保持现有良好的班级学风和管理节奏，不折腾、不懈怠；

② 关注学生的细微变化，在问题萌芽阶段及时干预；

③ 寻找新的增长点——可以是某一门薄弱学科的突破，也可以是某个学生群体的进步；

④ 持续建设班级文化，让班级成为每个学生成长的温暖港湾。` });
  }

  const levelMap = { danger: { icon: "🔴", label: "紧急" }, warning: { icon: "🟠", label: "重要" }, success: { icon: "🟢", label: "优秀" }, info: { icon: "🔵", label: "关注" } };
  $("ht_actions").innerHTML = actions.map((a, i) => `
    <div class="action-item action-${a.level}">
      <div class="action-rank">${i + 1}</div>
      <div class="action-body">
        <div class="action-title">${levelMap[a.level].icon} ${a.level === 'danger' ? 'P1' : a.level === 'warning' ? 'P2' : a.level === 'success' ? 'P4' : 'P3'} · ${levelMap[a.level].label} · ${esc(a.title)}</div>
        <div class="action-desc">${esc(a.desc)}</div>
        <div class="action-suggest"><b>💡 建议动作：</b>${esc(a.suggestion)}</div>
      </div>
    </div>
  `).join("");
}

function renderHeadteacherHistogram(classRecs, totalFullScore, subjects) {
  if (!classRecs.length) { $("ht_histogram_anno").innerHTML = "暂无数据"; return; }
  const totals = classRecs.map((r) => r.total).sort((a, b) => a - b);
  const min = 0, max = totalFullScore;
  const binCount = 10;
  const binSize = (max - min) / binCount;
  const bins = new Array(binCount).fill(0);
  totals.forEach((t) => {
    let idx = Math.floor((t - min) / binSize);
    if (idx >= binCount) idx = binCount - 1;
    bins[idx]++;
  });
  const labels = bins.map((_, i) => `${Math.round(min + i * binSize)}-${Math.round(min + (i + 1) * binSize)}`);

  const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
  const median = totals.length % 2 === 0 ? (totals[totals.length / 2 - 1] + totals[totals.length / 2]) / 2 : totals[Math.floor(totals.length / 2)];
  const range = totals[totals.length - 1] - totals[0];
  const maxBinIdx = bins.indexOf(Math.max(...bins));

  drawChart("ht_histogram", "bar", labels, [{ label: "人数", data: bins, backgroundColor: "rgba(59,130,246,0.7)" }], { indexAxis: "x" });

  const totalPassLine = subjects.reduce((s, x) => s + x.pass, 0);
  const totalExcellentLine = subjects.reduce((s, x) => s + x.excellent, 0);
  const skew = avg > median ? "正偏态（低分人数相对较多）" : avg < median ? "负偏态（高分人数相对较多）" : "接近对称分布";
  const excellent = totals.filter((t) => t >= totalExcellentLine).length;
  const fail = totals.filter((t) => t < totalPassLine).length;

  $("ht_histogram_anno").innerHTML = `
    <b>📝 注解：</b>
    本班平均分为 <b>${fmt(avg, 1)}</b> 分，中位数为 <b>${fmt(median, 1)}</b> 分，极差为 <b>${fmt(range, 1)}</b> 分。
    分布呈<b>${skew}</b>。众数区间为 <b>${labels[maxBinIdx]} 分</b>（${bins[maxBinIdx]} 人）。
    优秀（≥90%）<b>${excellent}</b> 人（${fmt(excellent / totals.length * 100, 1)}%），
    不及格（<60%）<b>${fail}</b> 人（${fmt(fail / totals.length * 100, 1)}%）。
  `;
}

function renderHeadteacherScoreSegments(classRecs, gradeRecs, subjects, totalFullScore, classNo) {
  const totalPassLine = subjects.reduce((s, x) => s + x.pass, 0);
  const totalExcellentLine = subjects.reduce((s, x) => s + x.excellent, 0);
  const totalGoodLine = subjects.reduce((s, x) => s + x.good, 0);
  const totalLowLine = subjects.reduce((s, x) => s + x.low, 0);

  const segments = [
    { name: "优秀", min: totalExcellentLine, max: totalFullScore + 1, color: "#28a745" },
    { name: "良好", min: totalGoodLine, max: totalExcellentLine, color: "#17a2b8" },
    { name: "中等", min: totalPassLine, max: totalGoodLine, color: "#ffc107" },
    { name: "及格", min: totalLowLine, max: totalPassLine, color: "#fd7e14" },
    { name: "不及格", min: 0, max: totalLowLine, color: "#dc3545" }
  ];

  function count(recs) {
    return segments.map((seg) => recs.filter((r) => {
      return r.total >= seg.min && r.total < seg.max;
    }).length);
  }

  const classCounts = count(classRecs);
  const gradeCounts = count(gradeRecs);
  const classTotal = Math.max(classRecs.length, 1);
  const gradeTotal = Math.max(gradeRecs.length, 1);

  let rows = segments.map((seg, i) => {
    const cCnt = classCounts[i], gCnt = gradeCounts[i];
    const cPct = fmt(cCnt / classTotal * 100, 1);
    const gPct = fmt(gCnt / gradeTotal * 100, 1);
    const diff = +fmt(cPct - gPct, 1);
    const diffClass = diff > 0 ? "text-green" : diff < 0 ? "text-red" : "";
    return `<tr>
      <td><b style="color:${seg.color}">${seg.name}（${fmt(seg.min * 100, 0)}-${fmt(seg.max * 100, 0)}%）</b></td>
      <td>${cCnt} 人</td><td>${cPct}%</td>
      <td>${gCnt} 人</td><td>${gPct}%</td>
      <td class="${diffClass}"><b>${diff > 0 ? '▲' : diff < 0 ? '▼' : '='} ${fmt(Math.abs(diff), 1)}%</b></td>
    </tr>`;
  }).join("");

  $("ht_segments").innerHTML = `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>分数段</th><th>本班人数</th><th>本班占比</th><th>年级人数</th><th>年级占比</th><th>差值</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  `;

  const highClass = classCounts[0];
  const failClass = classCounts[4];
  const highGrade = gradeCounts[0];
  const failGrade = gradeCounts[4];

  $("ht_segments_anno").innerHTML = `
    <b>📝 注解：</b>
    本班优秀（≥90%）<b>${highClass}</b> 人（${fmt(highClass / classTotal * 100, 1)}%），
    年级优秀 <b>${highGrade}</b> 人（${fmt(highGrade / gradeTotal * 100, 1)}%）；
    本班不及格 <b>${failClass}</b> 人（${fmt(failClass / classTotal * 100, 1)}%），
    年级不及格 <b>${failGrade}</b> 人（${fmt(failGrade / gradeTotal * 100, 1)}%）。
    ${highClass / classTotal > highGrade / gradeTotal ? '本班优秀率高于年级平均，继续保持；' : '本班优秀率低于年级平均，需加强尖子生培养。'}
    ${failClass / classTotal > failGrade / gradeTotal ? '本班不及格率高于年级平均，需重点关注学困生。' : '本班不及格率低于年级平均，整体基础较好。'}
  `;
}

function renderHeadteacherHeatmap(classStats, gradeStats, subjects) {
  let bodyRows = "";
  subjects.forEach((s) => {
    const cAvg = classStats[s.name]?.avg || 0;
    const gAvg = gradeStats[s.name]?.avg || 0;
    const diff = +fmt(cAvg - gAvg, 1);
    let cellClass = "equal";
    if (diff >= 5) cellClass = "above-strong";
    else if (diff > 1) cellClass = "above";
    else if (diff <= -5) cellClass = "below-strong";
    else if (diff < -1) cellClass = "below";

    bodyRows += `<tr>
      <td><b>${esc(s.name)}</b></td>
      <td>${fmt(cAvg, 1)}</td>
      <td>${fmt(gAvg, 1)}</td>
      <td class="heatmap-cell ${cellClass}" title="差值：${diff > 0 ? '+' : ''}${diff} 分">${diff > 0 ? '+' : ''}${diff}</td>
    </tr>`;
  });

  $("ht_heatmap").innerHTML = `
    <table class="heatmap-table">
      <thead><tr><th>学科</th><th>本班均分</th><th>年级均分</th><th>差值</th></tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
}

function renderHeadteacherProgress(exams, selectedExam, grade, classNo, currentRecs) {
  const last2 = exams.slice(-2);
  if (last2.length < 2) {
    $("ht_progress_wrap").innerHTML = `
      <div class="empty-state">
        <div class="es-icon">📊</div>
        <div class="es-title">暂无进退步数据</div>
        <div class="es-tip">需要至少 2 次考试才能生成进退步分布图</div>
      </div>
    `;
    $("ht_progress_anno").innerHTML = `<b>📝 注解：</b>当前仅有 ${exams.length} 次考试数据。请添加下一次考试成绩后，系统将自动生成进退步分布图，帮助您了解班级整体进步/退步情况。`;
    return;
  }

  const [prevExam, currExam] = last2;
  const prevRecs = getVisibleRecords(DB.records.filter((r) => r.examId === prevExam.id && classNoEquals(r.classNo, classNo)));
  const currRecs = getVisibleRecords(DB.records.filter((r) => r.examId === currExam.id && classNoEquals(r.classNo, classNo)));
  const prevMap = {};
  prevRecs.forEach((r) => { prevMap[r.studentId] = r; });

  const diffs = currRecs.map((r) => {
    const prev = prevMap[r.studentId];
    return prev ? r.total - prev.total : null;
  }).filter((d) => d != null);

  if (!diffs.length) {
    $("ht_progress_wrap").innerHTML = `<div class="empty-state"><div class="es-tip">数据不足，无法生成进退步图</div></div>`;
    return;
  }

  const ranges = [
    { name: "进步≥30分", min: 30, max: Infinity, color: "#155724" },
    { name: "进步15-30分", min: 15, max: 30, color: "#28a745" },
    { name: "进步5-15分", min: 5, max: 15, color: "#8fd19e" },
    { name: "波动±5分", min: -5, max: 5, color: "#ffc107" },
    { name: "退步5-15分", min: -15, max: -5, color: "#f8d7da" },
    { name: "退步15-30分", min: -30, max: -15, color: "#dc3545" },
    { name: "退步≥30分", min: -Infinity, max: -30, color: "#721c24" }
  ];

  const counts = ranges.map((r) => diffs.filter((d) => d >= r.min && d < r.max).length);
  const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const progressCount = diffs.filter((d) => d > 5).length;
  const regressCount = diffs.filter((d) => d < -5).length;
  const stableCount = diffs.length - progressCount - regressCount;

  const labels = ranges.map((r) => r.name);
  drawChart("ht_progress_chart" + Date.now(), "bar", labels, [{
    label: "人数",
    data: counts,
    backgroundColor: ranges.map((r) => r.color)
  }], { indexAxis: "y", horizontal: true });

  const chartId = "ht_progress_chart_" + Date.now();
  $("ht_progress_wrap").innerHTML = `<div class="chart-box" style="height:360px"><canvas id="${chartId}"></canvas></div>`;
  setTimeout(() => {
    drawChart(chartId, "bar", labels.reverse(), [{
      label: "人数",
      data: counts.reverse(),
      backgroundColor: ranges.slice().reverse().map((r) => r.color)
    }], { indexAxis: "y" });
  }, 50);

  const trend = avgDiff > 0 ? "整体呈进步趋势" : avgDiff < 0 ? "整体呈退步趋势" : "整体持平";
  $("ht_progress_anno").innerHTML = `
    <b>📝 注解：</b>
    本次对比 <b>${esc(prevExam.name)}</b> → <b>${esc(currExam.name)}</b>，
    本班 <b>${diffs.length}</b> 名学生参与对比。
    平均变化 <b style="color:${avgDiff >= 0 ? 'green' : 'red'}">${avgDiff >= 0 ? '+' : ''}${fmt(avgDiff, 1)} 分</b>，${trend}。
    进步 <b>${progressCount}</b> 人（${fmt(progressCount / diffs.length * 100, 1)}%），
    稳定 <b>${stableCount}</b> 人（${fmt(stableCount / diffs.length * 100, 1)}%），
    退步 <b>${regressCount}</b> 人（${fmt(regressCount / diffs.length * 100, 1)}%）。
  `;
}

function renderHeadteacherSubjectPerf(classStats, gradeStats, subjects, classNo) {
  const rows = subjects.map((s) => {
    const st = classStats[s.name] || {};
    const gst = gradeStats[s.name] || {};
    const avgDiff = +fmt((st.avg || 0) - (gst.avg || 0), 1);
    return `<tr>
      <td><b>${esc(s.name)}</b></td>
      <td>${fmt(st.avg, 1)}</td>
      <td>${st.total || 0}</td>
      <td class="text-green">${st.excellent || 0} 人<br><small>${fmt((st.excellentPct || 0) * 100, 1)}%</small></td>
      <td>${st.good || 0} 人<br><small>${fmt((st.goodPct || 0) * 100, 1)}%</small></td>
      <td class="text-blue">${st.passCount || 0} 人<br><small>${fmt((st.passPct || 0) * 100, 1)}%</small></td>
      <td class="text-red">${(st.total || 0) - (st.passCount || 0)} 人<br><small>${fmt((1 - (st.passPct || 0)) * 100, 1)}%</small></td>
      <td style="color:#dc3545;font-weight:600">${st.low || 0} 人<br><small>${fmt((st.lowPct || 0) * 100, 1)}%</small></td>
      <td style="color:${avgDiff >= 0 ? '#28a745' : '#dc3545'}"><b>${avgDiff >= 0 ? '+' : ''}${avgDiff}</b></td>
    </tr>`;
  }).join("");

  $("ht_subject_perf").innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>学科</th><th>均分</th><th>人数</th>
        <th>优秀</th><th>良好</th>
        <th>及格</th><th>不及格</th>
        <th>低分</th><th>较年级</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="9"><div class="empty-state"><div class="es-tip">暂无数据</div></div></td></tr>`}</tbody>
    </table>
  `;
}

function renderHeadteacherStudents(classRecs, exams, selectedExam, grade, classNo, subjects) {
  const last2 = exams.slice(-2);
  const partialStudents = [];
  const belowStudents = [];
  const progressStudents = [];
  const regressStudents = [];

  const totalFullScore = subjects.reduce((a, s) => a + (s.fullScore || 100), 0);
  const showStudentId = hasRoster(grade);

  classRecs.forEach((r) => {
    let strong = [], weak = [];
    subjects.forEach((s) => {
      const score = r.scores[s.name];
      if (score == null) return;
      if (score >= s.excellent) strong.push(s.name);
      if (score < s.pass) weak.push(s.name);
    });
    if (strong.length > 0 && weak.length > 0) {
      partialStudents.push({ ...r, strong, weak, partialScore: strong.length + weak.length });
    }
    if (r.total < subjects.reduce((sum, x) => sum + x.pass, 0)) {
      belowStudents.push(r);
    }
  });

  if (last2.length >= 2) {
    const [prevExam, currExam] = last2;
    const prevRecs = getVisibleRecords(DB.records.filter((r) => r.examId === prevExam.id && classNoEquals(r.classNo, classNo)));
    const currRecs = getVisibleRecords(DB.records.filter((r) => r.examId === currExam.id && classNoEquals(r.classNo, classNo)));
    const prevMap = {};
    prevRecs.forEach((r) => { prevMap[r.studentId] = r; });
    currRecs.forEach((r) => {
      const prev = prevMap[r.studentId];
      if (prev) {
        const diff = r.total - prev.total;
        if (diff >= 20) progressStudents.push({ ...r, diff, prevTotal: prev.total });
        if (diff <= -20) regressStudents.push({ ...r, diff, prevTotal: prev.total });
      }
    });
    progressStudents.sort((a, b) => b.diff - a.diff);
    regressStudents.sort((a, b) => a.diff - b.diff);
  }

  partialStudents.sort((a, b) => b.partialScore - a.partialScore);
  belowStudents.sort((a, b) => a.total - b.total);

  const tabs = [
    { id: "partial", label: "偏科生", count: partialStudents.length, desc: "有学科优秀但有学科不及格" },
    { id: "below", label: "未达线", count: belowStudents.length, desc: "总分得分率低于60%" },
    { id: "progress", label: "进步明显", count: progressStudents.length, desc: "较上次进步≥20分" },
    { id: "regress", label: "退步明显", count: regressStudents.length, desc: "较上次退步≥20分" }
  ];

  $("ht_student_tabs").innerHTML = tabs.map((t) => `
    <div class="student-tab ${_htActiveStudentTab === t.id ? 'active' : ''}" data-tab="${t.id}">
      <span class="tab-label">${t.label}</span>
      <span class="tab-count">${t.count}</span>
    </div>
  `).join("");

  document.querySelectorAll("#ht_student_tabs .student-tab").forEach((el) => {
    el.addEventListener("click", () => {
      _htActiveStudentTab = el.dataset.tab;
      renderHeadteacherStudents(classRecs, exams, selectedExam, grade, classNo, subjects);
    });
  });

  const activeTab = tabs.find((t) => t.id === _htActiveStudentTab) || tabs[0];
  let studentList = [];
  if (_htActiveStudentTab === "partial") studentList = partialStudents;
  else if (_htActiveStudentTab === "below") studentList = belowStudents;
  else if (_htActiveStudentTab === "progress") studentList = progressStudents;
  else if (_htActiveStudentTab === "regress") studentList = regressStudents;

  const displayList = studentList.slice(0, 50);

  function renderStudentCard(r) {
    const rosterId = showStudentId ? getStudentIdFromRoster(grade, classNo, r.studentName) : "";
    const scoreBars = subjects.map((s) => {
      const score = r.scores[s.name];
      if (score == null) return `<div class="subject-score"><span class="sb-name">${s.name}</span><span class="sb-val">-</span></div>`;
      let color = "#28a745";
      if (score < s.pass) color = "#dc3545";
      else if (score < s.good) color = "#ffc107";
      return `<div class="subject-score"><span class="sb-name">${s.name}</span>
        <div class="sb-bar"><div class="sb-bar-fill" style="width:${Math.min(rate * 100, 100)}%;background:${color}"></div></div>
        <span class="sb-val">${score}</span></div>`;
    }).join("");

    let tags = "";
    if (r.strong?.length) tags += `<span class="st-tag tag-green">优势：${r.strong.join("、")}</span>`;
    if (r.weak?.length) tags += `<span class="st-tag tag-red">薄弱：${r.weak.join("、")}</span>`;
    if (r.diff != null) tags += `<span class="st-tag ${r.diff >= 0 ? 'tag-green' : 'tag-red'}">${r.diff >= 0 ? '▲' : '▼'} ${Math.abs(r.diff)}分</span>`;

    const totalRate = r.total / totalFullScore;
    return `<div class="student-card">
      <div class="sc-header">
        <div class="sc-avatar">${r.studentName.charAt(0)}</div>
        <div class="sc-info">
          <div class="sc-name">${esc(r.studentName)}${showStudentId ? `<span class="sc-id">${rosterId}</span>` : ""}</div>
          <div class="sc-total">总分：<b>${r.total}</b> <small>（${fmt(totalRate * 100, 1)}%）</small></div>
        </div>
      </div>
      ${tags ? `<div class="sc-tags">${tags}</div>` : ""}
      <div class="sc-scores">${scoreBars}</div>
    </div>`;
  }

  $("ht_students_grid").innerHTML = displayList.length
    ? `<div class="students-grid">${displayList.map(renderStudentCard).join("")}</div>
       <div style="text-align:center;color:#999;margin-top:12px;font-size:13px;">共 ${studentList.length} 人，显示前 ${Math.min(50, studentList.length)} 人 · ${activeTab.desc}</div>`
    : `<div class="empty-state"><div class="es-icon">✅</div><div class="es-title">暂无${activeTab.label}学生</div><div class="es-tip">${activeTab.desc}</div></div>`;
}

// 下载班主任分析报告
window.downloadHeadteacherAnalysis = function () {
  const grade = currentUser.grade;
  const classNo = currentUser.classNo;
  const exams = getHeadteacherExams(grade, classNo).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  if (!exams.length) { showToast("暂无考试数据", "warning"); return; }
  const subjects = DB.subjects[grade] || [];
  const selectedExamId = $("ht_exam_select")?.value || exams[exams.length - 1].id;
  const selectedExam = exams.find((e) => e.id === selectedExamId) || exams[exams.length - 1];
  const totalFullScore = subjects.reduce((a, s) => a + (s.fullScore || 100), 0);

  const classRecs = getVisibleRecords(DB.records.filter((r) => r.examId === selectedExam.id && classNoEquals(r.classNo, classNo)));
  const gradeRecs = getVisibleRecords(DB.records.filter((r) => r.examId === selectedExam.id && r.grade === grade));
  const classStats = aggregateStats(classRecs, subjects);
  const gradeStats = aggregateStats(gradeRecs, subjects);

  const wb = XLSX.utils.book_new();

  // Sheet 1: 班级总览
  const classAvg = classRecs.length ? classRecs.reduce((a, b) => a + b.total, 0) / classRecs.length : 0;
  const gradeAvg = gradeRecs.length ? gradeRecs.reduce((a, b) => a + b.total, 0) / gradeRecs.length : 0;
  const maxScore = classRecs.length ? Math.max(...classRecs.map((r) => r.total)) : 0;
  const minScore = classRecs.length ? Math.min(...classRecs.map((r) => r.total)) : 0;
  const totalPassLine = subjects.reduce((s, x) => s + x.pass, 0);
  const totalExcellentLine = subjects.reduce((s, x) => s + x.excellent, 0);
  const overviewData = [
    ["指标", "数值", "备注"],
    ["参考人数", classRecs.length, `全年级 ${gradeRecs.length} 人`],
    ["总分均分", fmt(classAvg, 1), `年级均分 ${fmt(gradeAvg, 1)}`],
    ["最高分", maxScore, `满分 ${totalFullScore}`],
    ["最低分", minScore, `极差 ${fmt(maxScore - minScore, 1)}`],
    ["及格人数", classRecs.filter((r) => r.total >= totalPassLine).length, `及格率 ${fmt(classRecs.filter((r) => r.total >= totalPassLine).length / Math.max(classRecs.length, 1) * 100, 1)}%`],
    ["优秀人数", classRecs.filter((r) => r.total >= totalExcellentLine).length, `优秀率 ${fmt(classRecs.filter((r) => r.total >= totalExcellentLine).length / Math.max(classRecs.length, 1) * 100, 1)}%`]
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(overviewData), "班级总览");

  // Sheet 2: 科目表现
  const perfHeader = ["学科", "均分", "人数", "优秀人数", "优秀率", "良好人数", "良好率", "及格人数", "及格率", "不及格人数", "不及格率", "低分人数", "低分率", "年级均分", "与年级差值"];
  const perfData = subjects.map((s) => {
    const st = classStats[s.name] || {};
    const gst = gradeStats[s.name] || {};
    const failCount = (st.total || 0) - (st.passCount || 0);
    return [s.name, fmt(st.avg, 1), st.total || 0,
      st.excellent || 0, fmt((st.excellentPct || 0) * 100, 1) + "%",
      st.good || 0, fmt((st.goodPct || 0) * 100, 1) + "%",
      st.passCount || 0, fmt((st.passPct || 0) * 100, 1) + "%",
      failCount, fmt(failCount / Math.max(st.total || 1, 1) * 100, 1) + "%",
      st.low || 0, fmt((st.lowPct || 0) * 100, 1) + "%",
      fmt(gst.avg, 1), fmt((st.avg || 0) - (gst.avg || 0), 1)];
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([perfHeader, ...perfData]), "科目表现");

  // Sheet 3: 分数段分布（使用学科配置的分数线）
  const totalGoodLine = subjects.reduce((s, x) => s + x.good, 0);
  const totalLowLine = subjects.reduce((s, x) => s + x.low, 0);
  const segments = [
    { name: `优秀（≥${totalExcellentLine}分）`, min: totalExcellentLine, max: totalFullScore + 1 },
    { name: `良好（${totalGoodLine}-${totalExcellentLine}分）`, min: totalGoodLine, max: totalExcellentLine },
    { name: `中等（${totalPassLine}-${totalGoodLine}分）`, min: totalPassLine, max: totalGoodLine },
    { name: `及格（${totalLowLine}-${totalPassLine}分）`, min: totalLowLine, max: totalPassLine },
    { name: `不及格（<${totalLowLine}分）`, max: totalLowLine }
  ];
  const segHeader = ["分数段", "本班人数", "本班占比", "年级人数", "年级占比"];
  const segData = segments.map((seg) => {
    const cCnt = classRecs.filter((r) => {
      if (seg.min != null && seg.max != null) return r.total >= seg.min && r.total < seg.max;
      if (seg.min != null) return r.total >= seg.min;
      if (seg.max != null) return r.total < seg.max;
      return false;
    }).length;
    const gCnt = gradeRecs.filter((r) => {
      if (seg.min != null && seg.max != null) return r.total >= seg.min && r.total < seg.max;
      if (seg.min != null) return r.total >= seg.min;
      if (seg.max != null) return r.total < seg.max;
      return false;
    }).length;
    return [seg.name, cCnt, fmt(cCnt / Math.max(classRecs.length, 1) * 100, 1) + "%", gCnt, fmt(gCnt / Math.max(gradeRecs.length, 1) * 100, 1) + "%"];
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([segHeader, ...segData]), "分数段分布");

  // Sheet 4: 学生明细
  const showStudentId = hasRoster(grade);
  const studentHeader = ["姓名", ...(showStudentId ? ["学号"] : []), ...subjects.map((s) => s.name), "总分", "得分率", "年级排名"];
  const allSorted = gradeRecs.slice().sort((a, b) => b.total - a.total);
  const studentRows = classRecs.slice().sort((a, b) => b.total - a.total).map((r) => {
    const rank = allSorted.findIndex((x) => x.studentId === r.studentId) + 1;
    const rosterId = showStudentId ? getStudentIdFromRoster(grade, classNo, r.studentName) : "";
    const row = [r.studentName];
    if (showStudentId) row.push(rosterId);
    subjects.forEach((s) => row.push(r.scores[s.name] ?? "-"));
    row.push(r.total, fmt(r.total / totalFullScore * 100, 1) + "%", rank);
    return row;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([studentHeader, ...studentRows]), "学生明细");

  XLSX.writeFile(wb, `${grade}_${classNo}_班级分析报告_${selectedExam.name}.xlsx`);
  showToast("班级分析报告已下载", "success");
};

// 任课教师端：我的成绩 & 排行 & 分析
function renderMyScores() {
  if (currentUser.role !== "teacher" && currentUser.role !== "headteacher") {
    $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return;
  }
  const grade = currentUser.grade;
  const subjects = currentUser.subjects || [];
  const myClassNos = getTeacherClassNos(currentUser, grade);
  // 任课教师：显示年级统一考试 + 所教班级的自建考试
  const exams = getSortedExams(grade).filter((e) => {
    if (!e.isClassExam) return true;
    return myClassNos.some((c) => classNoEquals(e.classNo, c));
  });

  if (exams.length === 0 || subjects.length === 0) {
    $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-tip">暂无任教考试数据</div></div></div>`; return;
  }

  const sections = subjects.map((subjectName) => {
    const subject = (DB.subjects[grade] || []).find((s) => s.name === subjectName);
    if (!subject) return "";
    // 进一步筛选：只对这个学科我确实教的班级
    const myClassesForSubject = myClassNos.filter((c) => teacherTeaches(currentUser, grade, c, subjectName));
    if (myClassesForSubject.length === 0) return "";

    const chartData = myClassesForSubject.map((c) => ({
      label: c + " " + subjectName,
      data: exams.map((e) => {
        const recs = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && classNoEquals(r.classNo, c)));
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
          const recs = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && classNoEquals(r.classNo, c)));
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
  const filtered = getVisibleRecords(DB.records.filter((r) => r.grade === grade && myClasses.some((c) => classNoEquals(c, r.classNo)) && r.scores[subjectName] != null));
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
  let myClassNos = getTeacherClassNos(currentUser, grade);
  // 任课教师：显示年级统一考试 + 所教班级的自建考试
  const exams = getSortedExams(grade).filter((e) => {
    if (!e.isClassExam) return true;
    return myClassNos.some((c) => classNoEquals(e.classNo, c));
  });

  if (exams.length === 0 || subjects.length === 0) {
    $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-tip">暂无排行数据</div></div></div>`; return;
  }

  // 收集所有考试的所有同学科数据，用于全局对比
  const allExamData = [];
  const subjectTeacherMap = {}; // 同学科所有教师成绩（用于标准化）

  exams.forEach((e) => {
    const { rows } = computeTeacherRanking(e.id, grade);
    rows.forEach((r) => { r.examName = e.name; r.examId = e.id; allExamData.push(r); });
  });

  // 我的数据
  const myRows = allExamData.filter((r) => subjects.indexOf(r.subject) >= 0 && r.teacherId === currentUser.id);

  // 我的执教汇总
  myClassNos = [...new Set(myRows.map((r) => r.classNo))];
  const mySubjectSet = [...new Set(myRows.map((r) => r.subject))];
  const totalStudents = myRows.reduce((a, b) => a + (b.total || 0), 0);
  const myAvg = myRows.length > 0 ? myRows.reduce((a, b) => a + b.avg, 0) / myRows.length : 0;
  const rank1Count = myRows.filter((r) => r.rank === 1).length;
  const top3Count = myRows.filter((r) => r.rank <= 3).length;

  // 顶部 Hero 区域
  const heroHTML = `
    <div class="tech-hero-section">
      <div class="tech-hero-bg"></div>
      <div class="tech-hero-content">
        <div class="tech-hero-title">
          <span class="tech-badge">🏅 我的教学专业排行</span>
          <h2>${esc(currentUser.name)} · 教学综合分析</h2>
          <button class="btn btn-info" style="margin-left:auto;" onclick="refreshMyRanking()" title="重新拉取最新数据">🔄 刷新数据</button>
        </div>
        <div class="tech-hero-stats">
          <div class="tech-stat-card">
            <div class="tech-stat-icon">📚</div>
            <div class="tech-stat-info">
              <div class="tech-stat-num">${mySubjectSet.length}</div>
              <div class="tech-stat-label">任教学科</div>
            </div>
          </div>
          <div class="tech-stat-card">
            <div class="tech-stat-icon">🏫</div>
            <div class="tech-stat-info">
              <div class="tech-stat-num">${myClassNos.length}</div>
              <div class="tech-stat-label">任教班级</div>
            </div>
          </div>
          <div class="tech-stat-card">
            <div class="tech-stat-icon">📈</div>
            <div class="tech-stat-info">
              <div class="tech-stat-num">${fmt(myAvg, 1)}</div>
              <div class="tech-stat-label">整体均分</div>
            </div>
          </div>
          <div class="tech-stat-card ${rank1Count > 0 ? 'highlight' : ''}">
            <div class="tech-stat-icon">🥇</div>
            <div class="tech-stat-info">
              <div class="tech-stat-num">${rank1Count} / ${top3Count}</div>
              <div class="tech-stat-label">第1名 / 前3名</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  if (myRows.length === 0) {
    $("pageContent").innerHTML = heroHTML + `<div class="card"><div class="empty-state"><div class="es-tip">暂无我的排行数据，等待教务老师推送</div></div></div>`;
    return;
  }

  // 获取本年级所有同科教师
  const allTeachers = DB.users.filter((u) => u.grade === grade && (u.role === "teacher" || u.role === "headteacher"));
  const subjectTeachers = {};
  mySubjectSet.forEach((subj) => {
    subjectTeachers[subj] = allTeachers.filter((u) => {
      const subjects = u.subjects || [];
      return subjects.indexOf(subj) >= 0;
    });
  });

  // 按考试+学科分组，每组做一次专业分析
  const groupKey = (r) => `${r.examId}_${r.subject}`;
  const groups = {};
  myRows.forEach((r) => {
    const k = groupKey(r);
    if (!groups[k]) groups[k] = { examId: r.examId, examName: r.examName, subject: r.subject, myRow: null, peers: [] };
    if (r.teacherId === currentUser.id) groups[k].myRow = r;
  });
  // 填充同学科的所有教师（包括没有成绩数据的教师）
  mySubjectSet.forEach((subj) => {
    exams.forEach((e) => {
      const k = `${e.id}_${subj}`;
      if (!groups[k]) return;
      const peerRows = allExamData.filter((r) => r.examId === e.id && r.subject === subj);
      const existingTeacherIds = new Set(peerRows.filter((p) => p.teacherId).map((p) => p.teacherId));
      const teachersWithSubject = subjectTeachers[subj] || [];
      teachersWithSubject.forEach((teacher) => {
        if (!existingTeacherIds.has(teacher.id)) {
          peerRows.push({
            subject: subj,
            teacherId: teacher.id,
            teacherName: teacher.name,
            classNo: teacher.classNo || "-",
            total: 0,
            avg: null,
            excellent: 0, excellentPct: 0, excellentCount: 0,
            passCount: 0, passPct: 0,
            good: 0, goodPct: 0, goodCount: 0,
            low: 0, lowPct: 0, lowCount: 0,
            compositeScore: 0,
            gradeAvg: 0,
            hasData: false
          });
        }
      });
      groups[k].peers = peerRows;
    });
  });

  // 计算每组的科学指标
  const groupStats = Object.values(groups).map((g) => {
    if (!g.myRow) return null;
    const peers = g.peers.filter((p) => p.teacherId && p.avg != null && p.hasData !== false); // 排除未分配教师和无数据的行
    const peerScores = peers.map((p) => p.avg);
    const peerAvg = peerScores.length > 0 ? peerScores.reduce((a, b) => a + b, 0) / peerScores.length : 0;
    const peerStd = peerScores.length > 1 ? mathStdDev(peerScores) : 0;
    // Z-Score 标准化得分
    const zScore = peerStd > 0 ? (g.myRow.avg - peerAvg) / peerStd : 0;
    // 百分位（PR值）：在同学科中的相对位置
    const betterCount = peers.filter((p) => p.avg < g.myRow.avg).length;
    const prValue = peers.length > 1 ? (betterCount / (peers.length - 1)) * 100 : 100;
    // 教学效益值（Effect Size）：与平均分差距的效应量
    const effectSize = peerStd > 0 ? (g.myRow.avg - peerAvg) / peerStd : 0;
    // 离散系数 CV = std/avg
    const cv = g.myRow.avg > 0 ? (g.myRow.std || 0) / g.myRow.avg : 0;

    return {
      ...g,
      peerAvg, peerStd, peerCount: peers.length,
      zScore, prValue, effectSize, cv
    };
  }).filter(Boolean);

  // 按考试倒序、学科顺序排列
  groupStats.sort((a, b) => {
    if (a.examId !== b.examId) return exams.findIndex((e) => e.id === b.examId) - exams.findIndex((e) => e.id === a.examId);
    return a.subject.localeCompare(b.subject);
  });

  let html = heroHTML;

  groupStats.forEach((g, idx) => {
    const zScore = g.zScore;
    const zColor = zScore >= 1 ? "#10b981" : zScore >= 0 ? "#06b6d4" : zScore >= -1 ? "#f59e0b" : "#ef4444";
    const zLabel = zScore >= 1 ? "🌟 显著领先" : zScore >= 0 ? "📊 略高于平均" : zScore >= -1 ? "📉 略低于平均" : "⚠️ 显著落后";
    const radarId = `my_radar_${g.examId}_${g.subject}_${idx}`;
    const compareId = `my_compare_${g.examId}_${g.subject}_${idx}`;
    const distId = `my_dist_${g.examId}_${g.subject}_${idx}`;

    // 同伴排名表
    const peerRowsHTML = g.peers
      .filter((p) => p.teacherId)
      .sort((a, b) => {
        if (a.avg == null) return 1;
        if (b.avg == null) return -1;
        return b.avg - a.avg;
      })
      .map((p, i) => {
        const isMine = p.teacherId === currentUser.id;
        const hasData = p.hasData !== false && p.avg != null;
        return `<tr class="${isMine ? 'my-row-highlight' : ''} ${!hasData ? 'no-data-row' : ''}">
          <td>${isMine ? '<span class="me-tag">我</span>' : (hasData ? i + 1 : '-')}</td>
          <td><b>${esc(p.teacherName)}</b>${isMine ? ' ✨' : ''}</td>
          <td>${esc(p.classNo)}</td>
          <td>${hasData ? p.total : '-'}</td>
          <td class="${isMine ? 'score-main' : ''}"><b>${hasData ? fmt(p.avg, 1) : '-'}</b></td>
          <td>${hasData ? fmtPct(p.excellentPct) : '-'}</td>
          <td>${hasData ? fmtPct(p.passPct) : '-'}</td>
          <td>${hasData ? fmtPct(p.lowPct) : '-'}</td>
          <td>${hasData ? fmt(p.compositeScore * 100, 1) : '-'}</td>
        </tr>`;
      }).join("");

    html += `
      <div class="tech-section">
        <div class="tech-section-header">
          <h3><span class="tech-dot"></span>📊 ${esc(g.examName)} · ${esc(g.subject)}</h3>
          <div class="tech-section-sub">
            同学科 ${g.peerCount} 位教师有数据（${g.peers.filter((p) => p.teacherId).length} 位同科教师） · 我的学科内排名：<b>第 ${g.myRow.rank} 名</b> · 班级：${esc(g.myRow.classNo)}
          </div>
        </div>

        <div class="tech-stats-mini">
          <div class="tsm-item" style="--accent:${zColor}">
            <div class="tsm-label">Z-Score 标准化分</div>
            <div class="tsm-value">${zScore >= 0 ? '+' : ''}${fmt(zScore, 2)} σ</div>
            <div class="tsm-tag">${zLabel}</div>
          </div>
          <div class="tsm-item" style="--accent:#6366f1">
            <div class="tsm-label">PR 百分位值</div>
            <div class="tsm-value">${fmt(g.prValue, 0)}%</div>
            <div class="tsm-tag">高于 ${fmt(g.prValue, 0)}% 同科教师</div>
          </div>
          <div class="tsm-item" style="--accent:#8b5cf6">
            <div class="tsm-label">同科均分对比</div>
            <div class="tsm-value">${fmt(g.myRow.avg - g.peerAvg, 1)}</div>
            <div class="tsm-tag">${g.myRow.avg >= g.peerAvg ? '↑ 高于' : '↓ 低于'} 同科均值 ${fmt(g.peerAvg, 1)}</div>
          </div>
          <div class="tsm-item" style="--accent:#06b6d4">
            <div class="tsm-label">综合得分</div>
            <div class="tsm-value">${fmt(g.myRow.compositeScore * 100, 1)}</div>
            <div class="tsm-tag">权重：均分40%+优秀30%+及格30%</div>
          </div>
        </div>

        <div class="tech-chart-row" style="margin-top:18px">
          <div class="tech-chart-box tech-chart-main">
            <div class="tech-sub-title">🎯 同学科教师能力对比</div>
            <canvas id="${compareId}" style="height:280px"></canvas>
          </div>
          <div class="tech-chart-side">
            <div class="tech-chart-box" style="height:320px">
              <div class="tech-sub-title">📡 我的多维能力雷达</div>
              <canvas id="${radarId}" style="height:240px"></canvas>
            </div>
          </div>
        </div>

        <div class="tech-sub-title" style="margin-top:18px;margin-bottom:8px">🏅 同学科教师详细排名</div>
        <div class="tech-table-wrap">
          <table class="tech-table">
            <thead><tr>
              <th>排名</th><th>教师</th><th>班级</th><th>人数</th>
              <th>均分</th><th>优秀率</th><th>及格率</th><th>低分率</th><th>综合分</th>
            </tr></thead>
            <tbody>${peerRowsHTML}</tbody>
          </table>
        </div>

        <div class="tech-suggestions-section" style="margin-top:18px">
          <div class="tech-suggest-title">💡 科学教学诊断</div>
          <div class="tech-suggestions-grid">
            ${generateMyRankingDiagnosis(g).map((s, i) => {
              const colors = ["#6366f1", "#10b981", "#f59e0b", "#06b6d4"];
              return `<div class="tech-suggest-card" style="--accent-color: ${colors[i % colors.length]}">
                <div class="suggest-card-header">
                  <div class="suggest-group-name">${s.title}</div>
                </div>
                <div class="suggest-card-body">
                  <div class="suggest-item"><div class="suggest-text">${s.text}</div></div>
                </div>
              </div>`;
            }).join("")}
          </div>
        </div>
      </div>
    `;

    // 渲染图表：同学科对比柱状图
    setTimeout(() => {
      // 只显示有数据的教师
      const peersWithData = g.peers.filter((p) => p.teacherId && p.avg != null && p.hasData !== false)
        .sort((a, b) => b.avg - a.avg);
      const peerLabels = peersWithData.map((p) => p.teacherId === currentUser.id ? `${p.teacherName} ⭐` : p.teacherName);
      const peerAvgs = peersWithData.map((p) => p.avg);
      const peerColors = peersWithData.map((p) => p.teacherId === currentUser.id ? "#ef4444" : "#6366f1");
      const compareCanvas = document.getElementById(compareId);
      if (compareCanvas) {
        if (compareCanvas._chart) compareCanvas._chart.destroy();
        compareCanvas._chart = new Chart(compareCanvas, {
          type: "bar",
          data: {
            labels: peerLabels,
            datasets: [{
              label: `${g.subject}平均分`,
              data: peerAvgs,
              backgroundColor: peerColors.map((c) => c + "88"),
              borderColor: peerColors,
              borderWidth: 2,
              borderRadius: 6
            }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  afterLabel: (ctx) => {
                    const p = peersWithData[ctx.dataIndex];
                    if (!p) return "";
                    return `班级：${p.classNo}\n综合分：${fmt(p.compositeScore * 100, 1)}\n优秀率：${fmtPct(p.excellentPct)}`;
                  }
                }
              }
            },
            scales: {
              y: {
                beginAtZero: false,
                title: { display: true, text: "平均分" }
              }
            }
          }
        });
      }

      // 雷达图：我的多维能力评估
      const radarCanvas = document.getElementById(radarId);
      if (radarCanvas) {
        if (radarCanvas._chart) radarCanvas._chart.destroy();
        const validPeers = g.peers.filter((p) => p.teacherId && p.avg != null && p.hasData !== false);
        const peerAvgOfPct = validPeers.length > 0 ? validPeers.reduce((a, b) => a + b.excellentPct, 0) / validPeers.length * 100 : 0;
        const peerPassPct = validPeers.length > 0 ? validPeers.reduce((a, b) => a + b.passPct, 0) / validPeers.length * 100 : 0;
        const peerLowPct = validPeers.length > 0 ? validPeers.reduce((a, b) => a + b.lowPct, 0) / validPeers.length * 100 : 0;
        const myExPct = g.myRow.excellentPct * 100;
        const myPassPct = g.myRow.passPct * 100;
        const myLowPct = g.myRow.lowPct * 100;
        const normMyAvg = (g.myRow.avg / 100) * 100;
        const normPeerAvg = g.peerAvg;

        radarCanvas._chart = new Chart(radarCanvas, {
          type: "radar",
          data: {
            labels: ["均分水平", "优秀率", "及格率", "低分率(越低越好)", "综合得分"],
            datasets: [
              {
                label: "我",
                data: [normMyAvg, myExPct, myPassPct, 100 - myLowPct, g.myRow.compositeScore * 100],
                backgroundColor: "rgba(99, 102, 241, 0.25)",
                borderColor: "#6366f1",
                borderWidth: 2.5,
                pointBackgroundColor: "#6366f1",
                pointBorderColor: "#fff",
                pointRadius: 4
              },
              {
                label: "同学科平均",
                data: [normPeerAvg, peerAvgOfPct, peerPassPct, 100 - peerLowPct, g.peerCount > 0 ? g.peers.filter((p) => p.teacherId).reduce((a, b) => a + b.compositeScore, 0) / g.peers.filter((p) => p.teacherId).length * 100 : 0],
                backgroundColor: "rgba(239, 68, 68, 0.1)",
                borderColor: "#ef4444",
                borderWidth: 2,
                borderDash: [5, 5],
                pointBackgroundColor: "#ef4444",
                pointRadius: 3
              }
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: "bottom", labels: { font: { size: 11 } } } },
            scales: {
              r: {
                beginAtZero: true,
                max: 100,
                ticks: { stepSize: 20, font: { size: 10 } },
                pointLabels: { font: { size: 11 } }
              }
            }
          }
        });
      }
    }, 50 * (idx + 1));
  });

  $("pageContent").innerHTML = html;
}

// 基于科学指标生成教学诊断建议
function generateMyRankingDiagnosis(g) {
  const suggestions = [];
  const z = g.zScore;
  const pr = g.prValue;

  // Z-Score 分析（科学定位）
  if (z >= 1.5) {
    suggestions.push({
      title: "🌟 显著领先分析",
      text: `Z-Score = ${fmt(z, 2)}σ（统计学中|Z|≥1.5属显著水平），${g.subject}教学效果在同学科中处于第一梯队。建议：①提炼教学方法论形成"教学范式"；②承担教研示范课、师徒结对；③将成功经验申报教学成果奖。`
    });
  } else if (z >= 0.5) {
    suggestions.push({
      title: "📈 中上水平分析",
      text: `Z-Score = ${fmt(z, 2)}σ，PR百分位 = ${fmt(pr, 0)}%，${g.subject}教学效果优于大多数同科教师。建议：①对标头部1-2名教师，深挖差距环节；②聚焦"中等生提升"策略，进一步提升整体水平；③开展分层教学实验。`
    });
  } else if (z >= -0.5) {
    suggestions.push({
      title: "📊 中等水平分析",
      text: `Z-Score = ${fmt(z, 2)}σ，教学效果处于同学科中等水平。建议：①全面诊断教与学薄弱点；②借鉴头部教师的"分层作业+错题本+课堂提问"等方法；③每周教研时重点研讨2-3个高频失分点。`
    });
  } else {
    suggestions.push({
      title: "⚠️ 待提升分析",
      text: `Z-Score = ${fmt(z, 2)}σ，${g.subject}教学效果与同学科平均水平有显著差距。建议：①主动向同科优秀教师请教，加入教学研讨小组；②全面分析班级学情，从基础抓起；③及时与班主任沟通学生状况，必要时调整教学节奏。`
    });
  }

  // 优秀率与及格率分析
  if (g.myRow.passPct < 0.85) {
    suggestions.push({
      title: "🚨 及格率分析",
      text: `本次${g.subject}及格率仅 ${fmtPct(g.myRow.passPct)}，低于年级基准 85%。建议：①识别"临界生"（50-59分）重点帮扶；②建立"每日一题"训练机制；③开展家校沟通督促学生课后学习。`
    });
  } else if (g.myRow.excellentPct < 0.2) {
    suggestions.push({
      title: "📉 拔尖不足分析",
      text: `本次${g.subject}优秀率 ${fmtPct(g.myRow.excellentPct)}，高分段学生偏少。建议：①增加学科思维拓展内容；②组织学科竞赛小组；③提供课外阅读与探究任务。`
    });
  } else {
    suggestions.push({
      title: "✅ 优势项分析",
      text: `${g.subject}及格率 ${fmtPct(g.myRow.passPct)}、优秀率 ${fmtPct(g.myRow.excellentPct)}，整体质量较好。建议：继续保持当前教学节奏，并适当引入拔高性内容，形成"保基础、促拔尖"的双轨教学。`
    });
  }

  // 学科间均衡度分析
  if (g.cv > 0.2) {
    suggestions.push({
      title: "📊 班级内部分化",
      text: `班级内成绩离散系数 CV=${fmt(g.cv, 2)}，${g.subject}班级内部分化明显。建议：①实施"组内异质、组间同质"分组合作学习；②对后进生进行一对一辅导；③设置分层作业（基础+提升+拓展）。`
    });
  } else {
    suggestions.push({
      title: "🎯 整体均衡",
      text: `班级内成绩离散系数 CV=${fmt(g.cv, 2)}，整体水平较为均衡。建议：①开展小组合作探究式学习；②引入项目式学习提升综合能力；③培养"小老师"带动共同进步。`
    });
  }

  return suggestions;
}

// 刷新按钮：优先从云端仓库拉取最新数据，再重新渲染我的排行
window.refreshMyRanking = async function () {
  let refreshed = false;
  // 1. 优先从云端仓库拉取
  if (GitHubService.isConfigured()) {
    try {
      const remote = await GitHubService.loadRemoteDB();
      if (remote && remote.users && remote.users.length > 0) {
        // 更新全局 DB 对象
        Object.assign(DB, remote);
        // 同时更新本地缓存
        localStorage.setItem(DB_KEY, JSON.stringify(remote));
        refreshed = true;
      }
    } catch (e) {
      console.log("[refreshMyRanking] 云端拉取失败:", e.message);
    }
  }
  // 2. 若云端未配置或拉取失败，回退到本地缓存
  if (!refreshed) {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.users) DB.users = parsed.users;
        if (parsed.records) DB.records = parsed.records;
        if (parsed.exams) DB.exams = parsed.exams;
        if (parsed.subjects) DB.subjects = parsed.subjects;
      }
    } catch (_) {}
  }
  renderMyRanking();
  showToast(refreshed ? "已从云端仓库刷新数据" : "已刷新排行数据", "success");
};

// ========== 任课教师：学科对比分析（独立页面） ==========
let _taActiveSubject = null;

function renderTeacherAnalysis() {
  if (currentUser.role !== "teacher" && currentUser.role !== "headteacher") { $("pageContent").innerHTML = `<div class="empty-state"><div class="es-tip">无权限</div></div>`; return; }
  const grade = currentUser.grade;
  const subjects = currentUser.subjects || [];
  const myClassNos = getTeacherClassNos(currentUser, grade);
  // 任课教师：显示年级统一考试 + 所教班级的自建考试
  const exams = getSortedExams(grade).filter((e) => {
    if (!e.isClassExam) return true;
    return myClassNos.some((c) => classNoEquals(e.classNo, c));
  });
  if (exams.length === 0 || subjects.length === 0) {
    $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-icon">📊</div><div class="es-title">暂无任教数据</div><div class="es-tip">请确认已分配任教科目并上传成绩</div></div></div>`; return;
  }

  if (!_taActiveSubject) _taActiveSubject = subjects[0];

  const examOptions = exams.map((e, i) => `<option value="${e.id}" ${i === exams.length - 1 ? "selected" : ""}>${esc(e.name)}</option>`).join("");
  const subjectTabs = subjects.map((s) => `
    <div class="student-tab ${_taActiveSubject === s ? 'active' : ''}" data-subject="${esc(s)}" style="cursor:pointer">
      <span class="tab-label">${esc(s)}</span>
    </div>
  `).join("");

  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">
        <span>🔍 学科智能分析 - ${esc(currentUser.name)}</span>
        <span class="ct-actions">
          <select id="ta_exam_select" style="padding:6px 12px;border:1px solid #ddd;border-radius:6px;margin-right:10px">${examOptions}</select>
          <button class="btn btn-primary" onclick="downloadTeacherAnalysis()">📥 下载学科分析报告</button>
        </span>
      </div>
    </div>

    <div class="card">
      <div class="student-tabs" id="ta_subject_tabs">${subjectTabs}</div>
    </div>

    <!-- 学科分析内容 -->
    <div id="ta_content"></div>
  `;

  document.querySelectorAll("#ta_subject_tabs .student-tab").forEach((el) => {
    el.addEventListener("click", () => {
      _taActiveSubject = el.dataset.subject;
      renderTeacherAnalysis();
    });
  });

  $("ta_exam_select").addEventListener("change", () => refreshTeacherAnalysis());
  setTimeout(() => refreshTeacherAnalysis(), 50);
}

function refreshTeacherAnalysis() {
  const grade = currentUser.grade;
  const examId = $("ta_exam_select").value;
  window._eaCurrentExamId = examId;
  let myClassNos = getTeacherClassNos(currentUser, grade);
  const exams = getSortedExams(grade).filter((e) => {
    if (!e.isClassExam) return true;
    return myClassNos.some((c) => classNoEquals(e.classNo, c));
  });
  const selectedExam = exams.find((e) => e.id === examId) || exams[exams.length - 1];
  const subjectName = _taActiveSubject;
  const examSubjects = getExamSubjects(selectedExam.id);
  const subject = examSubjects.find((s) => s.name === subjectName);
  if (!subject) return;
  const fullScore = subject.fullScore;
  const passLine = subject.pass;
  const excellentLine = subject.excellent;
  const goodLine = subject.good;
  const lowLine = subject.low;

  myClassNos = myClassNos.filter((c) => teacherTeaches(currentUser, grade, c, subjectName));
  const allExamRecs = DB.records.filter((r) => r.examId === selectedExam.id && r.grade === grade && (r.status === "confirmed" || r.status === "pending"));
  const gradeRecs = getVisibleRecords(allExamRecs);
  const myRecs = getVisibleRecords(allExamRecs.filter((r) => r.classNo && myClassNos.some((cn) => classNoEquals(cn, r.classNo)) && r.scores[subjectName] != null));

  // 年级学科统计
  const gradeVals = gradeRecs.map((r) => r.scores[subjectName]).filter((v) => v != null);
  const gradeAvg = gradeVals.length ? gradeVals.reduce((a, b) => a + b, 0) / gradeVals.length : 0;

  $("ta_content").innerHTML = `
    <!-- ① 学科总览 -->
    <div class="card analysis-section" id="ta_section1">
      <div class="section-title"><span class="st-icon">📊</span>一、${esc(subjectName)} 学科总览</div>
      <div id="ta_overview"></div>
    </div>

    <!-- ② 本次最值得做的事 -->
    <div class="card analysis-section" id="ta_section2">
      <div class="section-title"><span class="st-icon">🎯</span>二、本次最值得做的事（按重要性排序）</div>
      <div id="ta_actions"></div>
    </div>

    <!-- ③ 学科分数分布直方图 -->
    <div class="card analysis-section" id="ta_section3">
      <div class="section-title"><span class="st-icon">📈</span>三、${esc(subjectName)} 分数分布直方图（任教班级）</div>
      <div class="chart-box" style="height:380px"><canvas id="ta_histogram"></canvas></div>
      <div id="ta_histogram_anno" class="section-annotation"></div>
    </div>

    <!-- ④ 分数段分布（各班对比） -->
    <div class="card analysis-section" id="ta_section4">
      <div class="section-title"><span class="st-icon">📉</span>四、${esc(subjectName)} 分数段分布（按得分率）</div>
      <div id="ta_segments"></div>
      <div id="ta_segments_anno" class="section-annotation"></div>
    </div>

    <!-- ⑤ 班级学科热力图 -->
    <div class="card analysis-section" id="ta_section5">
      <div class="section-title"><span class="st-icon">🗺️</span>五、任教班级对比（vs 年级均分）</div>
      <div id="ta_heatmap"></div>
      <div class="heatmap-legend">
        <div class="heatmap-legend-item"><div class="heatmap-legend-color" style="background:#28a745"></div><span>高于年级均分 ≥5分</span></div>
        <div class="heatmap-legend-item"><div class="heatmap-legend-color" style="background:#d4edda"></div><span>高于年级均分 0~5分</span></div>
        <div class="heatmap-legend-item"><div class="heatmap-legend-color" style="background:#fff3cd"></div><span>持平（±1分以内）</span></div>
        <div class="heatmap-legend-item"><div class="heatmap-legend-color" style="background:#f8d7da"></div><span>低于年级均分 0~5分</span></div>
        <div class="heatmap-legend-item"><div class="heatmap-legend-color" style="background:#dc3545"></div><span>低于年级均分 ≥5分</span></div>
      </div>
    </div>

    <!-- ⑥ 进退步分布图 -->
    <div class="card analysis-section" id="ta_section6">
      <div class="section-title"><span class="st-icon">🔄</span>六、${esc(subjectName)} 进退步分布图（任教班级）</div>
      <div id="ta_progress_wrap"></div>
      <div id="ta_progress_anno" class="section-annotation"></div>
    </div>

    <!-- ⑦ 学科表现（各班） -->
    <div class="card analysis-section" id="ta_section7">
      <div class="section-title"><span class="st-icon">📚</span>七、各班${esc(subjectName)} 表现</div>
      <div class="table-wrap" id="ta_subject_perf"></div>
    </div>

    <!-- ⑧ 需要关注的学生 -->
    <div class="card analysis-section" id="ta_section8">
      <div class="section-title"><span class="st-icon">👨‍🎓</span>八、${esc(subjectName)} 需要关注的学生</div>
      <div class="student-tabs" id="ta_student_tabs"></div>
      <div id="ta_students_grid"></div>
    </div>
  `;

  renderTeacherOverview(myRecs, gradeVals, myClassNos, subjectName, fullScore, passLine, excellentLine);
  renderTeacherActions(myRecs, gradeRecs, myClassNos, subjectName, fullScore, passLine, excellentLine, exams, selectedExam, grade);
  renderTeacherHistogram(myRecs, subjectName, fullScore, passLine, excellentLine);
  renderTeacherScoreSegments(myRecs, myClassNos, subjectName, fullScore, gradeRecs, passLine, excellentLine, goodLine, lowLine);
  renderTeacherHeatmap(myRecs, myClassNos, subjectName, gradeAvg);
  renderTeacherProgress(exams, selectedExam, grade, myClassNos, subjectName, myRecs);
  renderTeacherSubjectPerf(myRecs, myClassNos, subjectName, fullScore, passLine, excellentLine, goodLine, gradeAvg);
  renderTeacherStudents(myRecs, exams, selectedExam, grade, myClassNos, subjectName, fullScore, passLine, excellentLine, goodLine);
}

function renderTeacherOverview(myRecs, gradeVals, myClassNos, subjectName, fullScore, passLine, excellentLine) {
  const myVals = myRecs.map((r) => r.scores[subjectName]).filter((v) => v != null);
  const myAvg = myVals.length ? myVals.reduce((a, b) => a + b, 0) / myVals.length : 0;
  const gradeAvg = gradeVals.length ? gradeVals.reduce((a, b) => a + b, 0) / gradeVals.length : 0;
  const gap = +fmt(myAvg - gradeAvg, 1);
  const maxScore = myVals.length ? Math.max(...myVals) : 0;
  const minScore = myVals.length ? Math.min(...myVals) : 0;
  const excellentCount = myVals.filter((v) => v >= excellentLine).length;
  const passCount = myVals.filter((v) => v >= passLine).length;
  const failCount = myVals.length - passCount;

  $("ta_overview").innerHTML = `
    <div class="overview-grid">
      <div class="overview-card"><div class="ov-label">任教班级</div><div class="ov-value">${myClassNos.length} 个</div><div class="ov-sub">${myClassNos.join("、")}</div></div>
      <div class="overview-card"><div class="ov-label">参考人数</div><div class="ov-value">${myVals.length} 人</div><div class="ov-sub">全年级 ${gradeVals.length} 人</div></div>
      <div class="overview-card"><div class="ov-label">学科均分</div><div class="ov-value ${gap >= 0 ? 'text-green' : 'text-red'}">${fmt(myAvg, 1)}</div><div class="ov-sub">年级均分 ${fmt(gradeAvg, 1)}（${gap >= 0 ? '▲' : '▼'} ${fmt(Math.abs(gap), 1)}）</div></div>
      <div class="overview-card"><div class="ov-label">最高分</div><div class="ov-value text-green">${maxScore}</div><div class="ov-sub">满分 ${fullScore}</div></div>
      <div class="overview-card"><div class="ov-label">最低分</div><div class="ov-value text-red">${minScore}</div><div class="ov-sub">极差 ${fmt(maxScore - minScore, 1)}</div></div>
      <div class="overview-card"><div class="ov-label">及格人数</div><div class="ov-value">${passCount} 人</div><div class="ov-sub">及格率 ${fmt(passCount / Math.max(myVals.length, 1) * 100, 1)}%</div></div>
      <div class="overview-card"><div class="ov-label">优秀人数</div><div class="ov-value text-green">${excellentCount} 人</div><div class="ov-sub">优秀率 ${fmt(excellentCount / Math.max(myVals.length, 1) * 100, 1)}%</div></div>
      <div class="overview-card"><div class="ov-label">不及格人数</div><div class="ov-value text-red">${failCount} 人</div><div class="ov-sub">不及格率 ${fmt(failCount / Math.max(myVals.length, 1) * 100, 1)}%</div></div>
    </div>
  `;
}

function renderTeacherActions(myRecs, gradeRecs, myClassNos, subjectName, fullScore, passLine, excellentLine, exams, selectedExam, grade) {
  const actions = [];
  const myVals = myRecs.map((r) => r.scores[subjectName]).filter((v) => v != null);
  const gradeVals = gradeRecs.map((r) => r.scores[subjectName]).filter((v) => v != null);
  const myAvg = myVals.length ? myVals.reduce((a, b) => a + b, 0) / myVals.length : 0;
  const gradeAvg = gradeVals.length ? gradeVals.reduce((a, b) => a + b, 0) / gradeVals.length : 0;

  const failStudents = myRecs.filter((r) => {
    const s = r.scores[subjectName];
    return s != null && s < passLine;
  }).sort((a, b) => (a.scores[subjectName] || 0) - (b.scores[subjectName] || 0));
  if (failStudents.length > 0) {
    const failRate = fmt(failStudents.length / myVals.length * 100, 1);
    const names = failStudents.slice(0, 5).map((r) => r.studentName).join("、");
    actions.push({ level: "danger", title: `【${subjectName}教师重点关注】不及格学生 ${failStudents.length} 人（不及格率 ${failRate}%）`, desc: `作为 ${subjectName} 任课教师请您关注：${names}${failStudents.length > 5 ? " 等" : ""} 共 ${failStudents.length} 人未达及格线。不及格学生的存在反映了教学目标达成度不足，需要从课堂教学和个别辅导两个层面精准施策。`, suggestion: `【作为 ${subjectName} 教师，您可以这样行动】

① 失分结构分析：将失分按"知识模块+题型+能力层次"三维度拆解，定位2-3个高频失分知识点（遵循帕累托法则）；

② 错因分类：区分是"知识性错误"、"方法性错误"、"计算性错误"还是"规范性错误"，不同错因对应不同干预策略；

③ 临界生攻坚（提分性价比最高）：聚焦"中档题+高频考点"，实施"堂堂清+日日清"，用最少精力突破及格线；

④ 基础薄弱生策略：回归课本，从基本概念、公式、定理入手，采用"低起点、小步子、快反馈"降低学习坡度；

⑤ 课堂分层设计：设计分层问题链，让学困生也能回答基础问题，用成功体验激发参与热情；

⑥ 分层作业：实施"自助餐式"作业——A层基础题（必做）、B层提升题（选做），让每个学生都有"够得着"的题目；

⑦ 错题闭环：建立"错题收集→原因分析→同类巩固→定期回顾"的错题管理闭环，确保"不二错"。` });
  }

  const gap = myAvg - gradeAvg;
  if (gap < -3) {
    actions.push({ level: "danger", title: `【${subjectName}教师预警】均分低于年级平均 ${fmt(Math.abs(gap), 1)} 分`, desc: `作为 ${subjectName} 任课教师请您注意：任教班级均分 ${fmt(myAvg, 1)}，年级均分 ${fmt(gradeAvg, 1)}，差距 ${fmt(Math.abs(gap), 1)} 分。整体水平落后于年级，需要从教学理念、教学方法、训练效率等多维度系统改进。`, suggestion: `【${subjectName} 教学改进路径】

① 三维对标分析：将任教班级与年级高水平班级从"均分、优秀率、及格率、低分率、标准差"五个指标对比，判断是整体落后还是某个维度特别差；

② 知识点对比：找到任教班级失分率显著高于年级平均的知识点，这就是您的教学薄弱点；

③ 课堂诊断：请同组老师或教研员听课，从"教学目标达成度、学生参与度、思维训练深度"三个维度找课堂效率问题；

④ 高效课堂：推行"精讲（≤20分钟）+多练（≥15分钟）+即时反馈"模式，向课堂要效率；

⑤ 精选习题：拒绝题海战术，每道题要有明确的训练目标，做到"做一题、会一类、通一片"；

⑥ "三清"制度：落实课堂清、作业清、单元清，不把问题留到考试才发现；

⑦ 预期目标：2次考试内均分差距缩小至2分以内，及格率提升10个百分点。` });
  }

  if (myClassNos.length > 1) {
    const classAvgs = myClassNos.map((c) => {
      const recs = myRecs.filter((r) => classNoEquals(r.classNo, c));
      const vals = recs.map((r) => r.scores[subjectName]).filter((v) => v != null);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      const stdDev = vals.length ? Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / vals.length) : 0;
      return { classNo: c, avg, count: vals.length, stdDev };
    }).sort((a, b) => b.avg - a.avg);
    const classGap = classAvgs[0].avg - classAvgs[classAvgs.length - 1].avg;
    if (classGap > 8) {
      actions.push({ level: "warning", title: `【${subjectName}教师注意】任教班级差距较大（${fmt(classGap, 1)} 分）`, desc: `作为 ${subjectName} 任课教师请注意：${classAvgs[0].classNo} 均分最高（${fmt(classAvgs[0].avg, 1)}），${classAvgs[classAvgs.length - 1].classNo} 均分最低（${fmt(classAvgs[classAvgs.length - 1].avg, 1)}），差距达 ${fmt(classGap, 1)} 分。同一位老师任教的班级出现显著差距，需要反思和改进。`, suggestion: `【${subjectName} 班级均衡策略】

① 起点分析：对比各班入学/期初成绩，判断差距是"先天"的还是"后天"造成的；

② 课堂反思：反思自己在不同班级的课堂纪律要求、教学节奏、互动方式是否有差异；

③ 资源统一：教案、课件、习题等教学资源在各班统一使用，避免"偏心"；

④ 精力分配：有意识地给薄弱班级多投入20%的精力（如多提前5分钟进班答疑、多面批几份作业）；

⑤ 分层策略：同样的教学内容，在不同班级采用不同策略——基础好的班侧重思维深度，基础弱的班侧重夯实基础；

⑥ 动态监测：每次考试后跟踪各班差距变化，及时调整教学策略。` });
    }
  }

  const excellentStudents = myRecs.filter((r) => {
    const s = r.scores[subjectName];
    return s != null && s >= excellentLine;
  });
  if (excellentStudents.length > 0) {
    const excellentRate = fmt(excellentStudents.length / myVals.length * 100, 1);
    actions.push({ level: "success", title: `【${subjectName}教师成果】优秀学生 ${excellentStudents.length} 人（优秀率 ${excellentRate}%）`, desc: `恭喜！${subjectName} 优秀率 ${excellentRate}%，这是您教学能力的体现。但优秀只是起点，教师的使命是让优秀学生变得更卓越。`, suggestion: `【${subjectName} 培优路径】

① 知识拓展：引入竞赛入门内容、大学先修知识、学科前沿进展，拓宽学生的学科视野；

② 能力提升：从"解题"到"解决问题"——设计开放性问题、探究性课题，培养批判性思维和自主探究能力；

③ "小先生制"：让优秀学生担任"学科小助教"，讲解难题，输出式学习让他们理解更深刻；

④ 竞赛启蒙：选拔学有余力的学生参加学科兴趣小组/竞赛队，冲击更高层次的荣誉；

⑤ 目标引领：帮助优秀学生树立更高远的目标，用大格局牵引大成长。` });
  }

  const last2 = exams.slice(-2);
  if (last2.length >= 2) {
    const [prevExam, currExam] = last2;
    const prevRecs = getVisibleRecords(DB.records.filter((r) => r.examId === prevExam.id && r.classNo && myClassNos.indexOf(r.classNo) >= 0 && r.scores[subjectName] != null));
    const prevVals = prevRecs.map((r) => r.scores[subjectName]).filter((v) => v != null);
    const prevAvg = prevVals.length ? prevVals.reduce((a, b) => a + b, 0) / prevVals.length : 0;
    const trend = myAvg - prevAvg;
    if (trend > 3) {
      actions.push({ level: "info", title: `【${subjectName}教师成果】整体进步明显（较上次提升 ${fmt(trend, 1)} 分）`, desc: `从 ${prevExam.name} 到 ${currExam.name}，${subjectName} 均分从 ${fmt(prevAvg, 1)} 提升到 ${fmt(myAvg, 1)}，进步 ${fmt(trend, 1)} 分！进步是您教学改进成效的直接体现。`, suggestion: `【${subjectName} 巩固成果行动】

① 归因分析：对比两次考试的知识点得分率变化，哪些知识点进步最大？这就是您近期教学最成功的地方；

② 正向强化：在课堂上公开表扬进步，用"进步文化"替代"名次文化"，让更多学生有成就感；

③ 经验固化：把证明有效的教学方法总结提炼出来，形成您的"教学绝活"；

④ 设定新目标：和学生一起制定下一次考试的新目标，保持持续改进的动力。` });
    } else if (trend < -3) {
      actions.push({ level: "warning", title: `【${subjectName}教师预警】整体有所下滑（较上次下降 ${fmt(Math.abs(trend), 1)} 分）`, desc: `从 ${prevExam.name} 到 ${currExam.name}，${subjectName} 均分从 ${fmt(prevAvg, 1)} 下降到 ${fmt(myAvg, 1)}，退步 ${fmt(Math.abs(trend), 1)} 分。一次退步可能有偶然因素，但连续退步就是警示信号。`, suggestion: `【${subjectName} 止跌回升策略】

① 内容分析：分析是哪些知识点/题型退步最严重？是不是这段时间教的内容本来就难？

② 人群分析：退步集中在哪个群体？是头部学生掉下来了还是尾部学生更差了？

③ 教学复盘：这段时间您的教学有什么变化？（如换了教学方法、讲得快了等）

④ 紧急补救：对失分率高的知识点安排专项讲评课，确保学生真正弄懂。` });
    }
  }

  if (gap >= 3) {
    actions.push({ level: "success", title: `【${subjectName}教师佳绩】表现优秀（高于年级均分 ${fmt(gap, 1)} 分）`, desc: `恭喜！任教班级 ${subjectName} 均分高出年级 ${fmt(gap, 1)} 分，这是您学科教学能力的体现。但优秀不只是"分数高"，更要追求"学生学得轻松、能力发展全面"。`, suggestion: `【${subjectName} 从优秀走向卓越】

① 教学特色化：总结提炼您的教学优势，形成独特的教学风格（如"逻辑严密型""激情互动型"），让学生因为喜欢您而更喜欢这门学科；

② 课程精品化：打磨几节"招牌课""示范课"，在校级甚至更高层面展示；

③ 研究引领：从"教书匠"向"研究者"转变——开展小课题研究，用研究反哺教学；

④ 经验辐射：主动分享您的教学经验，在帮助他人的过程中实现自我提升。` });
  }

  if (actions.length === 0) {
    actions.push({ level: "info", title: `【${subjectName}教师状态】整体表现平稳`, desc: `各项指标均在正常范围内，${subjectName} 教学处于稳定发展状态。`, suggestion: `【${subjectName} 稳中求进】

① 保持现有良好的教学节奏和训练体系，不折腾、不懈怠；

② 关注学生的细微变化，在问题萌芽阶段及时干预；

③ 寻找新的增长点——可以是某个薄弱知识点的突破、某种教学方法的创新；

④ 每节课后花5分钟写「教学后记」，积累教学智慧。` });
  }

  const levelMap = { danger: { icon: "🔴", label: "紧急" }, warning: { icon: "🟠", label: "重要" }, success: { icon: "🟢", label: "优秀" }, info: { icon: "🔵", label: "关注" } };
  $("ta_actions").innerHTML = actions.map((a, i) => `
    <div class="action-item action-${a.level}">
      <div class="action-rank">${i + 1}</div>
      <div class="action-body">
        <div class="action-title">${levelMap[a.level].icon} ${a.level === 'danger' ? 'P1' : a.level === 'warning' ? 'P2' : a.level === 'success' ? 'P4' : 'P3'} · ${levelMap[a.level].label} · ${esc(a.title)}</div>
        <div class="action-desc">${esc(a.desc)}</div>
        <div class="action-suggest"><b>💡 建议动作：</b>${esc(a.suggestion)}</div>
      </div>
    </div>
  `).join("");
}

function renderTeacherHistogram(myRecs, subjectName, fullScore, passLine, excellentLine) {
  const vals = myRecs.map((r) => r.scores[subjectName]).filter((v) => v != null).sort((a, b) => a - b);
  if (!vals.length) { $("ta_histogram_anno").innerHTML = "暂无数据"; return; }

  const min = 0, max = fullScore;
  const binCount = 10;
  const binSize = (max - min) / binCount;
  const bins = new Array(binCount).fill(0);
  vals.forEach((t) => {
    let idx = Math.floor((t - min) / binSize);
    if (idx >= binCount) idx = binCount - 1;
    bins[idx]++;
  });
  const labels = bins.map((_, i) => `${Math.round(min + i * binSize)}-${Math.round(min + (i + 1) * binSize)}`);

  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const median = vals.length % 2 === 0 ? (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2 : vals[Math.floor(vals.length / 2)];
  const range = vals[vals.length - 1] - vals[0];
  const maxBinIdx = bins.indexOf(Math.max(...bins));

  drawChart("ta_histogram", "bar", labels, [{ label: "人数", data: bins, backgroundColor: "rgba(102,126,234,0.7)" }], { indexAxis: "x" });

  const skew = avg > median ? "正偏态（低分人数相对较多）" : avg < median ? "负偏态（高分人数相对较多）" : "接近对称分布";
  const excellent = vals.filter((t) => t >= excellentLine).length;
  const fail = vals.filter((t) => t < passLine).length;

  $("ta_histogram_anno").innerHTML = `
    <b>📝 注解：</b>
    任教班级${subjectName}平均分为 <b>${fmt(avg, 1)}</b> 分，中位数为 <b>${fmt(median, 1)}</b> 分，极差为 <b>${fmt(range, 1)}</b> 分。
    分布呈<b>${skew}</b>。众数区间为 <b>${labels[maxBinIdx]} 分</b>（${bins[maxBinIdx]} 人）。
    优秀（≥90%）<b>${excellent}</b> 人（${fmt(excellent / vals.length * 100, 1)}%），
    不及格（<60%）<b>${fail}</b> 人（${fmt(fail / vals.length * 100, 1)}%）。
  `;
}

function renderTeacherScoreSegments(myRecs, myClassNos, subjectName, fullScore, gradeRecs, passLine, excellentLine, goodLine, lowLine) {
  const segments = [
    { name: "优秀", min: excellentLine, max: fullScore + 1, color: "#28a745" },
    { name: "良好", min: goodLine, max: excellentLine, color: "#17a2b8" },
    { name: "中等", min: passLine, max: goodLine, color: "#ffc107" },
    { name: "及格", min: lowLine, max: passLine, color: "#fd7e14" },
    { name: "不及格", min: 0, max: lowLine, color: "#dc3545" }
  ];

  function countByClass(recs, classNo) {
    const cRecs = recs.filter((r) => classNoEquals(r.classNo, classNo));
    const vals = cRecs.map((r) => r.scores[subjectName]).filter((v) => v != null);
    return segments.map((seg) => vals.filter((v) => v >= seg.min && v < seg.max).length);
  }

  const gradeVals = gradeRecs.map((r) => r.scores[subjectName]).filter((v) => v != null);
  const gradeCounts = segments.map((seg) => gradeVals.filter((v) => v >= seg.min && v < seg.max).length);
  const gradeTotal = Math.max(gradeVals.length, 1);

  let rows = "";
  myClassNos.forEach((c) => {
    const counts = countByClass(myRecs, c);
    const cTotal = Math.max(counts.reduce((a, b) => a + b, 0), 1);
    counts.forEach((cnt, i) => {
      const seg = segments[i];
      const cPct = fmt(cnt / cTotal * 100, 1);
      const gPct = fmt(gradeCounts[i] / gradeTotal * 100, 1);
      if (i === 0) {
        rows += `<tr><td rowspan="5"><b>${esc(c)}</b></td>
          <td style="color:${seg.color}"><b>${seg.name}</b></td>
          <td>${cnt} 人</td><td>${cPct}%</td>
          <td>${gradeCounts[i]} 人</td><td>${gPct}%</td></tr>`;
      } else {
        rows += `<tr>
          <td style="color:${seg.color}"><b>${seg.name}</b></td>
          <td>${cnt} 人</td><td>${cPct}%</td>
          <td>${gradeCounts[i]} 人</td><td>${gPct}%</td></tr>`;
      }
    });
  });

  $("ta_segments").innerHTML = `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>班级</th><th>分数段</th><th>本班人数</th><th>本班占比</th><th>年级人数</th><th>年级占比</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  `;

  // 找最高分和不及格最多的班
  let bestClass = "", bestHigh = -1;
  let worstClass = "", worstFail = -1;
  myClassNos.forEach((c) => {
    const counts = countByClass(myRecs, c);
    const total = Math.max(counts.reduce((a, b) => a + b, 0), 1);
    const highRate = counts[0] / total;
    const failRate = counts[4] / total;
    if (highRate > bestHigh) { bestHigh = highRate; bestClass = c; }
    if (failRate > worstFail) { worstFail = failRate; worstClass = c; }
  });

  $("ta_segments_anno").innerHTML = `
    <b>📝 注解：</b>
    任教班级中，<b>${bestClass}</b> 优秀率最高（${fmt(bestHigh * 100, 1)}%），
    <b>${worstClass}</b> 不及格率最高（${fmt(worstFail * 100, 1)}%）。
    建议重点关注不及格率较高班级的基础教学，同时保持优秀率高班级的优势。
  `;
}

function renderTeacherHeatmap(myRecs, myClassNos, subjectName, gradeAvg) {
  const classData = myClassNos.map((c) => {
    const recs = myRecs.filter((r) => classNoEquals(r.classNo, c));
    const vals = recs.map((r) => r.scores[subjectName]).filter((v) => v != null);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const diff = +fmt(avg - gradeAvg, 1);
    let cellClass = "equal";
    if (diff >= 5) cellClass = "above-strong";
    else if (diff > 1) cellClass = "above";
    else if (diff <= -5) cellClass = "below-strong";
    else if (diff < -1) cellClass = "below";
    return { classNo: c, avg, diff, cellClass, count: vals.length };
  }).sort((a, b) => b.avg - a.avg);

  const rows = classData.map((d, i) => `<tr>
    <td>${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
    <td><b>${esc(d.classNo)}</b></td>
    <td>${d.count} 人</td>
    <td>${fmt(d.avg, 1)}</td>
    <td>${fmt(gradeAvg, 1)}</td>
    <td class="heatmap-cell ${d.cellClass}" title="差值：${d.diff > 0 ? '+' : ''}${d.diff} 分">${d.diff > 0 ? '+' : ''}${d.diff}</td>
  </tr>`).join("");

  $("ta_heatmap").innerHTML = `
    <table class="heatmap-table">
      <thead><tr><th>名次</th><th>班级</th><th>人数</th><th>本班均分</th><th>年级均分</th><th>差值</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderTeacherProgress(exams, selectedExam, grade, myClassNos, subjectName, currentRecs) {
  const last2 = exams.slice(-2);
  if (last2.length < 2) {
    $("ta_progress_wrap").innerHTML = `
      <div class="empty-state">
        <div class="es-icon">📊</div>
        <div class="es-title">暂无进退步数据</div>
        <div class="es-tip">需要至少 2 次考试才能生成进退步分布图</div>
      </div>
    `;
    $("ta_progress_anno").innerHTML = `<b>📝 注解：</b>当前仅有 ${exams.length} 次考试数据。请添加下一次考试成绩后，系统将自动生成${subjectName}进退步分布图，帮助您了解任教班级学生的进步/退步情况。`;
    return;
  }

  const [prevExam, currExam] = last2;
  const prevRecs = getVisibleRecords(DB.records.filter((r) => r.examId === prevExam.id && r.classNo && myClassNos.indexOf(r.classNo) >= 0 && r.scores[subjectName] != null));
  const currRecs = getVisibleRecords(DB.records.filter((r) => r.examId === currExam.id && r.classNo && myClassNos.indexOf(r.classNo) >= 0 && r.scores[subjectName] != null));
  const prevMap = {};
  prevRecs.forEach((r) => { prevMap[r.studentId] = r; });

  const diffs = currRecs.map((r) => {
    const prev = prevMap[r.studentId];
    return prev ? r.scores[subjectName] - prev.scores[subjectName] : null;
  }).filter((d) => d != null);

  if (!diffs.length) {
    $("ta_progress_wrap").innerHTML = `<div class="empty-state"><div class="es-tip">数据不足，无法生成进退步图</div></div>`;
    return;
  }

  const ranges = [
    { name: "进步≥20分", min: 20, max: Infinity, color: "#155724" },
    { name: "进步10-20分", min: 10, max: 20, color: "#28a745" },
    { name: "进步5-10分", min: 5, max: 10, color: "#8fd19e" },
    { name: "波动±5分", min: -5, max: 5, color: "#ffc107" },
    { name: "退步5-10分", min: -10, max: -5, color: "#f8d7da" },
    { name: "退步10-20分", min: -20, max: -10, color: "#dc3545" },
    { name: "退步≥20分", min: -Infinity, max: -20, color: "#721c24" }
  ];

  const counts = ranges.map((r) => diffs.filter((d) => d >= r.min && d < r.max).length);
  const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const progressCount = diffs.filter((d) => d > 5).length;
  const regressCount = diffs.filter((d) => d < -5).length;
  const stableCount = diffs.length - progressCount - regressCount;

  const chartId = "ta_progress_chart_" + Date.now();
  $("ta_progress_wrap").innerHTML = `<div class="chart-box" style="height:360px"><canvas id="${chartId}"></canvas></div>`;
  const labels = ranges.map((r) => r.name);
  setTimeout(() => {
    drawChart(chartId, "bar", labels.slice().reverse(), [{
      label: "人数",
      data: counts.slice().reverse(),
      backgroundColor: ranges.slice().reverse().map((r) => r.color)
    }], { indexAxis: "y" });
  }, 50);

  const trend = avgDiff > 0 ? "整体呈进步趋势" : avgDiff < 0 ? "整体呈退步趋势" : "整体持平";
  $("ta_progress_anno").innerHTML = `
    <b>📝 注解：</b>
    本次对比 <b>${esc(prevExam.name)}</b> → <b>${esc(currExam.name)}</b>，
    任教班级 <b>${diffs.length}</b> 名学生参与对比。
    ${subjectName}平均变化 <b style="color:${avgDiff >= 0 ? 'green' : 'red'}">${avgDiff >= 0 ? '+' : ''}${fmt(avgDiff, 1)} 分</b>，${trend}。
    进步 <b>${progressCount}</b> 人（${fmt(progressCount / diffs.length * 100, 1)}%），
    稳定 <b>${stableCount}</b> 人（${fmt(stableCount / diffs.length * 100, 1)}%），
    退步 <b>${regressCount}</b> 人（${fmt(regressCount / diffs.length * 100, 1)}%）。
  `;
}

function renderTeacherSubjectPerf(myRecs, myClassNos, subjectName, fullScore, passLine, excellentLine, goodLine, gradeAvg) {
  const rows = myClassNos.map((c) => {
    const recs = myRecs.filter((r) => classNoEquals(r.classNo, c));
    const vals = recs.map((r) => r.scores[subjectName]).filter((v) => v != null);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const excellent = vals.filter((v) => v >= excellentLine).length;
    const good = vals.filter((v) => v >= goodLine && v < excellentLine).length;
    const pass = vals.filter((v) => v >= passLine).length;
    const fail = vals.length - pass;
    const diff = +fmt(avg - gradeAvg, 1);
    return { classNo: c, total: vals.length, avg, excellent, good, pass, fail, diff };
  }).sort((a, b) => b.avg - a.avg);

  const tableRows = rows.map((r) => `<tr>
    <td><b>${esc(r.classNo)}</b></td>
    <td>${fmt(r.avg, 1)}</td>
    <td>${r.total}</td>
    <td class="text-green">${r.excellent} 人<br><small>${fmt(r.excellent / Math.max(r.total, 1) * 100, 1)}%</small></td>
    <td>${r.good} 人<br><small>${fmt(r.good / Math.max(r.total, 1) * 100, 1)}%</small></td>
    <td class="text-blue">${r.pass} 人<br><small>${fmt(r.pass / Math.max(r.total, 1) * 100, 1)}%</small></td>
    <td class="text-red">${r.fail} 人<br><small>${fmt(r.fail / Math.max(r.total, 1) * 100, 1)}%</small></td>
    <td style="color:${r.diff >= 0 ? '#28a745' : '#dc3545'}"><b>${r.diff >= 0 ? '+' : ''}${r.diff}</b></td>
  </tr>`).join("");

  $("ta_subject_perf").innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>班级</th><th>均分</th><th>人数</th>
        <th>优秀（≥90%）</th><th>良好（80-90%）</th>
        <th>及格（≥60%）</th><th>不及格（<60%）</th>
        <th>较年级</th>
      </tr></thead>
      <tbody>${tableRows || `<tr><td colspan="8"><div class="empty-state"><div class="es-tip">暂无数据</div></div></td></tr>`}</tbody>
    </table>
  `;
}

let _taStudentTab = "fail";

function renderTeacherStudents(myRecs, exams, selectedExam, grade, myClassNos, subjectName, fullScore, passLine, excellentLine, goodLine) {
  const last2 = exams.slice(-2);
  const failStudents = [];
  const excellentStudents = [];
  const progressStudents = [];
  const regressStudents = [];
  const showStudentId = hasRoster(grade);

  myRecs.forEach((r) => {
    const s = r.scores[subjectName];
    if (s == null) return;
    if (s < passLine) failStudents.push(r);
    if (s >= excellentLine) excellentStudents.push(r);
  });
  failStudents.sort((a, b) => (a.scores[subjectName] || 0) - (b.scores[subjectName] || 0));
  excellentStudents.sort((a, b) => (b.scores[subjectName] || 0) - (a.scores[subjectName] || 0));

  if (last2.length >= 2) {
    const [prevExam, currExam] = last2;
    const prevRecs = getVisibleRecords(DB.records.filter((r) => r.examId === prevExam.id && r.classNo && myClassNos.indexOf(r.classNo) >= 0 && r.scores[subjectName] != null));
    const prevMap = {};
    prevRecs.forEach((r) => { prevMap[r.studentId] = r; });
    myRecs.forEach((r) => {
      const prev = prevMap[r.studentId];
      if (prev) {
        const diff = r.scores[subjectName] - prev.scores[subjectName];
        if (diff >= 15) progressStudents.push({ ...r, diff, prevScore: prev.scores[subjectName] });
        if (diff <= -15) regressStudents.push({ ...r, diff, prevScore: prev.scores[subjectName] });
      }
    });
    progressStudents.sort((a, b) => b.diff - a.diff);
    regressStudents.sort((a, b) => a.diff - b.diff);
  }

  const tabs = [
    { id: "fail", label: "不及格学生", count: failStudents.length, desc: `${subjectName}得分率低于60%` },
    { id: "excellent", label: "优秀学生", count: excellentStudents.length, desc: `${subjectName}得分率≥90%` },
    { id: "progress", label: "进步明显", count: progressStudents.length, desc: "较上次进步≥15分" },
    { id: "regress", label: "退步明显", count: regressStudents.length, desc: "较上次退步≥15分" }
  ];

  $("ta_student_tabs").innerHTML = tabs.map((t) => `
    <div class="student-tab ${_taStudentTab === t.id ? 'active' : ''}" data-tab="${t.id}">
      <span class="tab-label">${t.label}</span>
      <span class="tab-count">${t.count}</span>
    </div>
  `).join("");

  document.querySelectorAll("#ta_student_tabs .student-tab").forEach((el) => {
    el.addEventListener("click", () => {
      _taStudentTab = el.dataset.tab;
      renderTeacherStudents(myRecs, exams, selectedExam, grade, myClassNos, subjectName, fullScore, passLine, excellentLine, goodLine);
    });
  });

  const activeTab = tabs.find((t) => t.id === _taStudentTab) || tabs[0];
  let studentList = [];
  if (_taStudentTab === "fail") studentList = failStudents;
  else if (_taStudentTab === "excellent") studentList = excellentStudents;
  else if (_taStudentTab === "progress") studentList = progressStudents;
  else if (_taStudentTab === "regress") studentList = regressStudents;

  const displayList = studentList.slice(0, 50);

  function renderCard(r) {
    const rosterId = showStudentId ? getStudentIdFromRoster(grade, r.classNo, r.studentName) : "";
    const score = r.scores[subjectName] || 0;
    const rate = score / fullScore;
    let color = "#28a745";
    if (score < passLine) color = "#dc3545";
    else if (score < goodLine) color = "#ffc107";

    let tags = "";
    if (r.diff != null) tags += `<span class="st-tag ${r.diff >= 0 ? 'tag-green' : 'tag-red'}">${r.diff >= 0 ? '▲' : '▼'} ${Math.abs(r.diff)}分</span>`;
    tags += `<span class="st-tag tag-blue">${r.classNo}</span>`;

    return `<div class="student-card">
      <div class="sc-header">
        <div class="sc-avatar">${r.studentName.charAt(0)}</div>
        <div class="sc-info">
          <div class="sc-name">${esc(r.studentName)}${showStudentId ? `<span class="sc-id">${rosterId}</span>` : ""}</div>
          <div class="sc-total">${subjectName}：<b>${score}</b> <small>（${fmt(rate * 100, 1)}%）</small></div>
        </div>
      </div>
      ${tags ? `<div class="sc-tags">${tags}</div>` : ""}
      <div class="sc-scores">
        <div class="subject-score">
          <span class="sb-name">${subjectName}</span>
          <div class="sb-bar"><div class="sb-bar-fill" style="width:${Math.min(rate * 100, 100)}%;background:${color}"></div></div>
          <span class="sb-val">${score}</span>
        </div>
      </div>
    </div>`;
  }

  $("ta_students_grid").innerHTML = displayList.length
    ? `<div class="students-grid">${displayList.map(renderCard).join("")}</div>
       <div style="text-align:center;color:#999;margin-top:12px;font-size:13px;">共 ${studentList.length} 人，显示前 ${Math.min(50, studentList.length)} 人 · ${activeTab.desc}</div>`
    : `<div class="empty-state"><div class="es-icon">✅</div><div class="es-title">暂无${activeTab.label}</div><div class="es-tip">${activeTab.desc}</div></div>`;
}

// 下载教师学科分析报告
window.downloadTeacherAnalysis = function () {
  const grade = currentUser.grade;
  const subjects = currentUser.subjects || [];
  const myClassNos = getTeacherClassNos(currentUser, grade);
  const exams = getSortedExams(grade).filter((e) => {
    if (!e.isClassExam) return true;
    return myClassNos.some((c) => classNoEquals(e.classNo, c));
  });
  if (!exams.length) { showToast("暂无考试数据", "warning"); return; }
  const selectedExamId = $("ta_exam_select")?.value || exams[exams.length - 1].id;
  const selectedExam = exams.find((e) => e.id === selectedExamId) || exams[exams.length - 1];
  const subjectName = _taActiveSubject || subjects[0];
  const examSubjects = getExamSubjects(selectedExam.id);
  const subject = examSubjects.find((s) => s.name === subjectName);
  if (!subject) { showToast("学科配置不存在", "error"); return; }
  const fullScore = subject.fullScore;
  const passLine = subject.pass;
  const excellentLine = subject.excellent;
  const goodLine = subject.good;
  const lowLine = subject.low;

  const myClasses = myClassNos.filter((c) => teacherTeaches(currentUser, grade, c, subjectName));
  const myRecs = getVisibleRecords(DB.records.filter((r) => r.examId === selectedExam.id && r.classNo && myClasses.indexOf(r.classNo) >= 0 && r.scores[subjectName] != null));
  const gradeRecs = getVisibleRecords(DB.records.filter((r) => r.examId === selectedExam.id && r.grade === grade));

  const wb = XLSX.utils.book_new();

  // Sheet 1: 学科总览
  const myVals = myRecs.map((r) => r.scores[subjectName]).filter((v) => v != null);
  const gradeVals = gradeRecs.map((r) => r.scores[subjectName]).filter((v) => v != null);
  const myAvg = myVals.length ? myVals.reduce((a, b) => a + b, 0) / myVals.length : 0;
  const gradeAvg = gradeVals.length ? gradeVals.reduce((a, b) => a + b, 0) / gradeVals.length : 0;
  const overviewData = [
    ["指标", "数值", "备注"],
    ["任教班级", myClasses.length + " 个", myClasses.join("、")],
    ["参考人数", myVals.length, `全年级 ${gradeVals.length} 人`],
    [`${subjectName}均分`, fmt(myAvg, 1), `年级均分 ${fmt(gradeAvg, 1)}`],
    ["最高分", myVals.length ? Math.max(...myVals) : 0, `满分 ${fullScore}`],
    ["最低分", myVals.length ? Math.min(...myVals) : 0, ""],
    ["及格人数", myVals.filter((v) => v >= passLine).length, `及格率 ${fmt(myVals.filter((v) => v >= passLine).length / Math.max(myVals.length, 1) * 100, 1)}%`],
    ["优秀人数", myVals.filter((v) => v >= excellentLine).length, `优秀率 ${fmt(myVals.filter((v) => v >= excellentLine).length / Math.max(myVals.length, 1) * 100, 1)}%`]
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(overviewData), "学科总览");

  // Sheet 2: 各班表现
  const perfHeader = ["班级", "均分", "人数", "优秀人数", "优秀率", "良好人数", "良好率", "及格人数", "及格率", "不及格人数", "不及格率", "年级均分", "与年级差值"];
  const perfData = myClasses.map((c) => {
    const recs = myRecs.filter((r) => classNoEquals(r.classNo, c));
    const vals = recs.map((r) => r.scores[subjectName]).filter((v) => v != null);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const excellent = vals.filter((v) => v >= excellentLine).length;
    const good = vals.filter((v) => v >= goodLine && v < excellentLine).length;
    const pass = vals.filter((v) => v >= passLine).length;
    const fail = vals.length - pass;
    return [c, fmt(avg, 1), vals.length,
      excellent, fmt(excellent / Math.max(vals.length, 1) * 100, 1) + "%",
      good, fmt(good / Math.max(vals.length, 1) * 100, 1) + "%",
      pass, fmt(pass / Math.max(vals.length, 1) * 100, 1) + "%",
      fail, fmt(fail / Math.max(vals.length, 1) * 100, 1) + "%",
      fmt(gradeAvg, 1), fmt(avg - gradeAvg, 1)];
  }).sort((a, b) => b[1] - a[1]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([perfHeader, ...perfData]), "各班表现");

  // Sheet 3: 分数段分布（使用学科配置的分数线）
  const segments = [
    { name: `优秀（≥${excellentLine}分）`, min: excellentLine, max: fullScore + 1 },
    { name: `良好（${goodLine}-${excellentLine}分）`, min: goodLine, max: excellentLine },
    { name: `中等（${passLine}-${goodLine}分）`, min: passLine, max: goodLine },
    { name: `及格（${lowLine}-${passLine}分）`, min: lowLine, max: passLine },
    { name: `不及格（<${lowLine}分）`, max: lowLine }
  ];
  const segHeader = ["班级", ...segments.map((s) => s.name + " 人数"), ...segments.map((s) => s.name + " 占比")];
  const segData = myClasses.map((c) => {
    const recs = myRecs.filter((r) => classNoEquals(r.classNo, c));
    const vals = recs.map((r) => r.scores[subjectName]).filter((v) => v != null);
    const total = Math.max(vals.length, 1);
    const row = [c];
    segments.forEach((seg) => {
      const cnt = vals.filter((v) => {
        if (seg.min != null && seg.max != null) return v >= seg.min && v < seg.max;
        if (seg.min != null) return v >= seg.min;
        if (seg.max != null) return v < seg.max;
        return false;
      }).length;
      row.push(cnt);
    });
    segments.forEach((seg) => {
      const cnt = vals.filter((v) => {
        if (seg.min != null && seg.max != null) return v >= seg.min && v < seg.max;
        if (seg.min != null) return v >= seg.min;
        if (seg.max != null) return v < seg.max;
        return false;
      }).length;
      row.push(fmt(cnt / total * 100, 1) + "%");
    });
    return row;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([segHeader, ...segData]), "分数段分布");

  // Sheet 4: 学生明细
  const showStudentId = hasRoster(grade);
  const studentHeader = ["班级", "姓名", ...(showStudentId ? ["学号"] : []), `${subjectName}分数`, "得分率"];
  const studentRows = myRecs.slice().sort((a, b) => (b.scores[subjectName] || 0) - (a.scores[subjectName] || 0)).map((r) => {
    const rosterId = showStudentId ? getStudentIdFromRoster(grade, r.classNo, r.studentName) : "";
    const row = [r.classNo, r.studentName];
    if (showStudentId) row.push(rosterId);
    row.push(r.scores[subjectName] ?? "-", fmt((r.scores[subjectName] || 0) / fullScore * 100, 1) + "%");
    return row;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([studentHeader, ...studentRows]), "学生明细");

  XLSX.writeFile(wb, `${currentUser.name}_${subjectName}_学科分析报告_${selectedExam.name}.xlsx`);
  showToast("学科分析报告已下载", "success");
};

// ========== 多次考试对比分析（重新设计） ==========
function renderExamCompare() {
  const grade = currentUser.grade;
  const isHeadteacher = currentUser.role === "headteacher";
  // 班主任：显示年级统一考试 + 本班自建考试；教务：仅显示年级统一考试
  const exams = isHeadteacher
    ? getHeadteacherExams(grade, currentUser.classNo).sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    : getSortedExams(grade).filter((e) => !e.isClassExam);
  if (exams.length < 2) {
    $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-icon">📊</div><div class="es-title">至少需要 2 次考试才能对比</div><div class="es-tip">请先创建多次考试并上传成绩</div></div></div>`;
    return;
  }

  const subjects = DB.subjects[grade] || [];
  const role = currentUser.role;
  const isAcademic = role === "academic";
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

  const lastRecs = getVisibleRecords(DB.records.filter((r) => r.examId === lastExam.id && (!classNo || classNoEquals(r.classNo, classNo))));
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
      const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || classNoEquals(r.classNo, classNo)));
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
      const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || classNoEquals(r.classNo, classNo)));
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
        const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || classNoEquals(r.classNo, classNo)));
        if (!recs.length) return null;
        return +fmt(recs.reduce((a, b) => a + b.total, 0) / recs.length, 2);
      })
    }];
    drawChart("cmp_trend_total", "line", examLabels, totalDatasets);

    // 及格率趋势
    const totalPassLine = subjects.reduce((s, x) => s + x.pass, 0);
    const passDatasets = [{
      label: classNo || "全年级",
      data: selectedExams.map((e) => {
        const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || classNoEquals(r.classNo, classNo)));
        if (!recs.length) return null;
        const passCount = recs.filter((r) => r.total >= totalPassLine).length;
        return +fmt(passCount / recs.length * 100, 1);
      })
    }];
    drawChart("cmp_trend_pass", "line", examLabels, passDatasets);

    // 优秀率趋势
    const totalExcellentLine = subjects.reduce((s, x) => s + x.excellent, 0);
    const excDatasets = [{
      label: classNo || "全年级",
      data: selectedExams.map((e) => {
        const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || classNoEquals(r.classNo, classNo)));
        if (!recs.length) return null;
        const excCount = recs.filter((r) => r.total >= totalExcellentLine).length;
        return +fmt(excCount / recs.length * 100, 1);
      })
    }];
    drawChart("cmp_trend_excellent", "line", examLabels, excDatasets);

    // 标准差趋势
    const stdDatasets = [{
      label: classNo || "全年级",
      data: selectedExams.map((e) => {
        const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || classNoEquals(r.classNo, classNo)));
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
          const recs = DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || classNoEquals(r.classNo, classNo)));
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
        const recs = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && classNoEquals(r.classNo, c)));
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

    const lastRecs = getVisibleRecords(DB.records.filter((r) => r.examId === lastExam.id && (!classNo || classNoEquals(r.classNo, classNo))));
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
          const recs = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || classNoEquals(r.classNo, classNo))));
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
    .compare-tabs { display: flex; gap: 4px; background: var(--card-bg); padding: 6px; border-radius: var(--radius); border: 1px solid var(--border-light); }
    .tab-btn { padding: 10px 20px; border: none; background: transparent; border-radius: var(--radius-sm); font-size: 14px; cursor: pointer; color: var(--text-secondary); transition: all 0.2s; font-weight: 500; }
    .tab-btn:hover { background: var(--primary-light); color: var(--primary); }
    .tab-btn.active { background: var(--primary); color: #fff; font-weight: 600; box-shadow: 0 2px 8px rgba(67, 56, 202, 0.25); }
    .compare-content { min-height: 400px; }
    .cmp-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 80px; color: var(--text-secondary); }
    .cmp-panel { display: flex; flex-direction: column; gap: 20px; }
    .cmp-section-title { font-size: 16px; font-weight: 600; color: var(--text); margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid var(--border-light); position: relative; }
    .cmp-section-title::after { content: ""; position: absolute; bottom: -1px; left: 0; width: 36px; height: 2px; background: linear-gradient(90deg, var(--primary), var(--info)); border-radius: 1px; }
    .cmp-table-wrap { overflow-x: auto; border-radius: var(--radius); background: var(--card-bg); border: 1px solid var(--border-light); }
    .cmp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .cmp-table th { background: linear-gradient(180deg, #f8fafc, #f1f5f9); padding: 12px 14px; text-align: center; font-weight: 600; color: var(--text-secondary); border-bottom: 1px solid var(--border); white-space: nowrap; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .cmp-table td { padding: 12px 14px; text-align: center; border-bottom: 1px solid var(--border-light); }
    .cmp-table tr:last-child td { border-bottom: none; }
    .cmp-table tr:hover td { background: var(--primary-light); }
    .cmp-table .class-name { background: var(--primary-light); font-weight: 500; }
    .cmp-subject-card { background: var(--card-bg); padding: 20px; border-radius: var(--radius); border: 1px solid var(--border-light); box-shadow: var(--shadow-sm); }
    .cmp-chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .cmp-chart-card { background: var(--card-bg); padding: 20px; border-radius: var(--radius); border: 1px solid var(--border-light); box-shadow: var(--shadow-sm); transition: box-shadow 0.2s; }
    .cmp-chart-card:hover { box-shadow: var(--shadow-md); }
    .cmp-chart-title { font-size: 14px; font-weight: 600; margin-bottom: 14px; color: var(--text); padding-bottom: 10px; border-bottom: 1px solid var(--border-light); }
    .cmp-chart-box { height: 240px; position: relative; }
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
  const lastRecs = getVisibleRecords(DB.records.filter((r) => r.examId === lastExam.id && (!classNo || classNoEquals(r.classNo, classNo))));
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
      const recs = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || classNoEquals(r.classNo, classNo))));
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
    ["总分均分", ...selectedExams.map((e) => { const recs = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || classNoEquals(r.classNo, classNo)))); return recs.length ? fmt(recs.reduce((a, b) => a + b.total, 0) / recs.length, 2) : "-"; })],
    ["总分标准差", ...selectedExams.map((e) => { const recs = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || classNoEquals(r.classNo, classNo)))); return recs.length ? fmt(mathStdDev(recs.map((r) => r.total)), 2) : "-"; })],
    ...subjects.map((s) => [s.name + "均分", ...selectedExams.map((e) => { const recs = getVisibleRecords(DB.records.filter((r) => r.examId === e.id && r.grade === grade && (!classNo || classNoEquals(r.classNo, classNo)))); const vals = recs.map((r) => r.scores[s.name]).filter((v) => typeof v === "number"); return vals.length ? fmt(vals.reduce((a, b) => a + b, 0) / vals.length, 2) : "-"; })])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([trendHeader, ...trendData]), "趋势数据");

  const prefix = role === "academic" ? grade : role === "headteacher" ? `${grade}_${classNo}` : currentUser.name;
  XLSX.writeFile(wb, `${prefix}_多次考试对比分析_${selectedExams.length}次.xlsx`);
  showToast("分析报告已下载", "success");
};

// ========== 班主任：学习小组管理 ==========
function renderGroupManage() {
  const grade = currentUser.grade;
  const myClassNo = currentUser.classNo;
  // 班主任：显示年级统一考试 + 本班自建考试
  const exams = getHeadteacherExams(grade, myClassNo).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const subjects = DB.subjects[grade] || [];
  const showStudentId = hasRoster(grade);

  if (!DB.groups) DB.groups = {};
  if (!DB.groups[grade]) DB.groups[grade] = {};

  const allClassGroups = DB.groups[grade] || {};
  const classesFromRecords = [...new Set(DB.records.filter((r) => r.grade === grade).map((r) => r.classNo))];
  const allClasses = [...new Set([myClassNo, ...Object.keys(allClassGroups), ...classesFromRecords])].sort();
  const viewClassNo = window._htViewClass || myClassNo;
  const isMyClass = classNoEquals(viewClassNo, myClassNo);

  if (!DB.groups[grade][viewClassNo]) DB.groups[grade][viewClassNo] = [];

  const classNo = viewClassNo;
  const groups = DB.groups[grade][viewClassNo] || [];

  const groupMap = {};
  groups.forEach((g) => {
    if (!groupMap[g.groupName]) groupMap[g.groupName] = [];
    groupMap[g.groupName].push(g);
  });
  const groupNames = Object.keys(groupMap).sort();

  const getClassStudents = () => {
    const roster = DB.studentRoster && DB.studentRoster[grade] && DB.studentRoster[grade][classNo];
    if (roster && roster.length > 0) {
      return roster.map((s) => ({ studentId: s.studentId || "", studentName: s.studentName }));
    }
    const latestExam = exams[0];
    if (latestExam) {
      const recs = DB.records.filter((r) => r.examId === latestExam.id && classNoEquals(r.classNo, classNo));
      const seen = {};
      return recs.filter((r) => { if (seen[r.studentName]) return false; seen[r.studentName] = true; return true; })
        .map((r) => ({ studentId: r.studentId || "", studentName: r.studentName }));
    }
    return [];
  };

  const classStudents = getClassStudents();
  const assignedNames = new Set(groups.map((g) => g.studentName));
  const unassignedStudents = classStudents.filter((s) => !assignedNames.has(s.studentName));

  const downloadTemplate = () => {
    const data = [["姓名", "小组名称", "是否组长"], ["张三", "第一组", "是"], ["李四", "第一组", "否"], ["王五", "第二组", "是"]];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), "小组名单");
    XLSX.writeFile(wb, "小组名单模板.xlsx");
    showToast("模板已下载", "success");
  };

  const handleBatchUpload = (input) => {
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
        const idxName = header.findIndex((h) => h.includes("姓名"));
        const idxGroup = header.findIndex((h) => h.includes("小组"));
        const idxLeader = header.findIndex((h) => h.includes("组长"));
        if (idxName < 0 || idxGroup < 0) { showToast("表头必须包含：姓名、小组名称", "error"); return; }

        const newGroups = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row[idxName] || !row[idxGroup]) continue;
          const studentName = String(row[idxName]).trim();
          const groupName = String(row[idxGroup]).trim();
          const isLeader = idxLeader >= 0 && row[idxLeader] && String(row[idxLeader]).trim() === "是";
          const studentId = getStudentIdFromRoster(grade, classNo, studentName) || "";
          const existing = newGroups.find((g) => g.studentName === studentName);
          if (!existing) {
            newGroups.push({ studentId, studentName, groupName, isLeader: isLeader || false });
          }
        }

        if (newGroups.length === 0) { showToast("没有有效数据", "error"); return; }

        const mode = confirm("点击【确定】追加到现有小组，点击【取消】替换全部小组数据");
        if (mode) {
          const existingNames = new Set(groups.map((g) => g.studentName));
          const toAdd = newGroups.filter((g) => !existingNames.has(g.studentName));
          DB.groups[grade][classNo] = [...groups, ...toAdd];
          showToast(`成功追加 ${toAdd.length} 名学生`, "success");
        } else {
          DB.groups[grade][classNo] = newGroups;
          showToast(`成功导入 ${newGroups.length} 名学生`, "success");
        }
        saveDB();
        renderGroupManage();
      } catch (err) { showToast("文件解析失败", "error"); }
    };
    reader.readAsArrayBuffer(file);
    input.value = "";
  };

  const examOptions = exams.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("");

  const pageSize = 6;
  const totalPages = Math.max(1, Math.ceil(groupNames.length / pageSize));
  const currentPage = Math.min(Math.max(1, window._gmPage || 1), totalPages);
  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, groupNames.length);
  const pagedGroupNames = groupNames.slice(startIdx, endIdx);

  const buildPagination = (prefix, totalPages, currentPage, onchange) => {
    if (totalPages <= 1) return "";
    let pages = [];
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
        pages.push(i);
      } else if (pages[pages.length - 1] !== "...") {
        pages.push("...");
      }
    }
    return `
      <div class="pagination">
        <button class="page-btn" ${currentPage === 1 ? "disabled" : ""} onclick="${onchange}(${currentPage - 1})">‹ 上一页</button>
        ${pages.map((p) => p === "..."
          ? `<span class="page-ellipsis">...</span>`
          : `<button class="page-btn ${p === currentPage ? "active" : ""}" onclick="${onchange}(${p})">${p}</button>`
        ).join("")}
        <button class="page-btn" ${currentPage === totalPages ? "disabled" : ""} onclick="${onchange}(${currentPage + 1})">下一页 ›</button>
      </div>
    `;
  };

  const cardActions = isMyClass ? `
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm btn-primary" onclick="openCreateGroupModal()">➕ 新建小组</button>
        <button class="btn btn-sm btn-danger" onclick="clearAllGroups()">清空全部</button>
      </div>
  ` : "";

  const memberActions = (gn, mi) => isMyClass
    ? `<button class="member-remove" onclick="removeMemberFromGroup('${esc(gn)}', ${mi})" title="移除">×</button>`
    : "";

  const addChip = (gn) => isMyClass
    ? `<div class="group-member-chip add-chip" onclick="openAddMemberModal('${esc(gn)}')">
        <span class="member-avatar">+</span>
        <span class="member-name">添加</span>
      </div>`
    : "";

  const groupHeaderActions = (gn) => isMyClass ? `
              <div class="group-card-actions">
                <button class="btn-icon" onclick="openAddMemberModal('${esc(gn)}')" title="添加组员">➕</button>
                <button class="btn-icon" onclick="renameGroup('${esc(gn)}')" title="重命名">✏️</button>
                <button class="btn-icon btn-icon-danger" onclick="deleteGroup('${esc(gn)}')" title="删除小组">🗑️</button>
              </div>
  ` : "";

  const footerActions = (gn) => isMyClass
    ? `<button class="btn btn-sm btn-outline" onclick="openSetLeaderModal('${esc(gn)}')">设置组长</button>`
    : "";

  const groupCardsHTML = groupNames.length > 0 ? `
    <div class="card group-manage-card">
      <div class="card-title">
        <span>👥 小组列表（${groupNames.length}个小组 · ${groups.length}人）</span>
        ${cardActions}
      </div>
      <div class="card-scroll-body">
        <div class="group-cards-grid">
          ${pagedGroupNames.map((gn, idx) => {
            const realIdx = startIdx + idx;
            const members = groupMap[gn];
            const leader = members.find((m) => m.isLeader);
            const colorIdx = realIdx % 8;
            return `
              <div class="group-card" style="--group-color: var(--group-color-${colorIdx + 1})">
                <div class="group-card-header">
                  <div class="group-card-title">${esc(gn)}</div>
                  ${groupHeaderActions(gn)}
                </div>
                <div class="group-card-body">
                  <div class="group-card-stat">
                    <span class="stat-num">${members.length}</span>
                    <span class="stat-label">组员</span>
                  </div>
                  <div class="group-card-stat">
                    <span class="stat-num">${leader ? "1" : "0"}</span>
                    <span class="stat-label">组长</span>
                  </div>
                </div>
                <div class="group-card-members">
                  ${members.map((m, mi) => `
                    <div class="group-member-chip ${m.isLeader ? 'is-leader' : ''}" title="${m.isLeader ? '组长' : '组员'}">
                      <span class="member-avatar">${esc(m.studentName.charAt(0))}</span>
                      <span class="member-name">${esc(m.studentName)}</span>
                      ${m.isLeader ? '<span class="leader-badge">组长</span>' : ''}
                      ${memberActions(gn, mi)}
                    </div>
                  `).join("")}
                  ${addChip(gn)}
                </div>
                ${!leader ? `<div class="group-card-footer"><span style="color:#d97706;font-size:12px">⚠️ 未设置组长</span>
                  ${footerActions(gn)}
                </div>` : ''}
              </div>
            `;
          }).join("")}
        </div>
      </div>
      <div class="card-footer-pagination">
        <div class="page-info">第 ${startIdx + 1}-${endIdx} 个 / 共 ${groupNames.length} 个小组</div>
        ${buildPagination("gm", totalPages, currentPage, "changeGroupPage")}
      </div>
    </div>
  ` : "";

  window.changeGroupPage = (page) => {
    window._gmPage = page;
    renderGroupManage();
  };

  const unassignedHTML = unassignedStudents.length > 0 ? `
    <div class="card"><div class="card-title">📋 未分组学生（${unassignedStudents.length}人）</div>
      <div class="unassigned-list">
        ${unassignedStudents.map((s, i) => `
          <div class="unassigned-item">
            <span class="member-avatar">${esc(s.studentName.charAt(0))}</span>
            <span>${esc(s.studentName)}</span>
            <button class="btn btn-sm btn-primary" onclick="openQuickAssignModal('${esc(s.studentName)}')">分配小组</button>
          </div>
        `).join("")}
      </div>
    </div>
  ` : "";

  const scoreHTML = exams.length > 0 && groups.length > 0 ? `
    <div class="card tech-card"><div class="card-title">📈 小组成绩分析</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
        <label>选择考试：</label>
        <select id="htg_exam" class="form-control" style="width:200px">${examOptions}</select>
        <button class="btn btn-primary" onclick="refreshHeadteacherGroupScores()">🔍 分析</button>
        <button class="btn btn-success" onclick="downloadHeadteacherGroupAnalysis()">📥 导出报告</button>
      </div>
      <div id="htg_result"></div>
    </div>` : "";

  const classOptions = allClasses.map((c) => `
    <option value="${esc(c)}" ${classNoEquals(c, viewClassNo) ? "selected" : ""}>${esc(c)}${classNoEquals(c, myClassNo) ? "（我的班级）" : ""}</option>
  `).join("");

  const manageButtons = isMyClass ? `
        <div class="gm-action-group">
          <button class="btn btn-primary" onclick="downloadGroupTemplate()">📥 下载模板</button>
          <label class="btn btn-success" style="cursor:pointer">📤 批量导入
            <input type="file" accept=".xlsx,.xls" style="display:none" onchange="handleGroupBatchUpload(this)"/>
          </label>
        </div>
        <div class="gm-action-group">
          <button class="btn btn-info" onclick="openCreateGroupModal()">➕ 新建小组</button>
          <button class="btn btn-secondary" onclick="openQuickAddModal()">👤 单个添加学生</button>
        </div>
  ` : `
        <div class="gm-action-group">
          <span style="color:var(--text-muted);font-size:13px">
            <span class="badge badge-warning">只读模式</span> 查看其他班级小组数据，不可编辑
          </span>
        </div>
  `;

  const emptyTip = isMyClass
    ? '可通过"批量导入"或"单个添加"创建学习小组'
    : "该班级暂无学习小组数据";

  $("pageContent").innerHTML = `
    <div class="card"><div class="card-title">
      <span>👥 学习小组管理</span>
      <div style="display:flex;gap:12px;align-items:center">
        <label style="font-size:13px;color:var(--text-secondary);font-weight:normal">查看班级：</label>
        <select id="ht_view_class" class="form-control" style="width:180px">${classOptions}</select>
      </div>
    </div>
      <div class="gm-actions">
        ${manageButtons}
      </div>
      <div class="gm-stats">
        <div class="gm-stat-item"><div class="gm-stat-num">${groupNames.length}</div><div class="gm-stat-label">小组数量</div></div>
        <div class="gm-stat-item"><div class="gm-stat-num">${groups.length}</div><div class="gm-stat-label">已分组人数</div></div>
        <div class="gm-stat-item"><div class="gm-stat-num">${unassignedStudents.length}</div><div class="gm-stat-label">未分组人数</div></div>
        <div class="gm-stat-item"><div class="gm-stat-num">${groups.filter(g => g.isLeader).length}</div><div class="gm-stat-label">组长数量</div></div>
      </div>
    </div>
    ${groupCardsHTML}
    ${isMyClass ? unassignedHTML : ""}
    ${groups.length === 0 ? `<div class="card"><div class="empty-state"><div class="es-icon">👥</div><div class="es-title">暂无小组数据</div><div class="es-tip">${emptyTip}</div></div></div>` : ""}
    ${scoreHTML}
  `;

  const classSel = $("ht_view_class");
  if (classSel) {
    classSel.addEventListener("change", (e) => {
      window._htViewClass = e.target.value;
      renderGroupManage();
    });
  }

  window.downloadGroupTemplate = downloadTemplate;
  window.handleGroupBatchUpload = handleBatchUpload;

  window.openCreateGroupModal = () => {
    showModal("➕ 新建小组", `
      <div class="form-group">
        <label>小组名称</label>
        <input type="text" id="new_group_name" placeholder="如：第一组、奋进组" />
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="auto_assign_leader" checked /> 自动选择一名组长
        </label>
      </div>
    `, "创建", () => {
      const name = $("new_group_name").value.trim();
      if (!name) { showToast("请输入小组名称", "warning"); return false; }
      if (groupMap[name]) { showToast("小组名称已存在", "warning"); return false; }
      if (!DB.groups[grade][classNo]) DB.groups[grade][classNo] = [];
      saveDB();
      showToast(`小组「${name}」创建成功`, "success");
      renderGroupManage();
    });
  };

  window.renameGroup = (oldName) => {
    showModal("✏️ 重命名小组", `
      <div class="form-group">
        <label>原小组名称</label>
        <input type="text" value="${esc(oldName)}" disabled />
      </div>
      <div class="form-group">
        <label>新小组名称</label>
        <input type="text" id="rename_group_name" value="${esc(oldName)}" />
      </div>
    `, "保存", () => {
      const newName = $("rename_group_name").value.trim();
      if (!newName) { showToast("请输入新名称", "warning"); return false; }
      if (newName !== oldName && groupMap[newName]) { showToast("名称已存在", "warning"); return false; }
      DB.groups[grade][classNo].forEach((g) => { if (g.groupName === oldName) g.groupName = newName; });
      saveDB();
      showToast("重命名成功", "success");
      renderGroupManage();
    });
  };

  window.deleteGroup = (gn) => {
    if (!confirm(`确定删除小组「${gn}」？该小组所有学生将被移出。`)) return;
    DB.groups[grade][classNo] = DB.groups[grade][classNo].filter((g) => g.groupName !== gn);
    saveDB();
    showToast("小组已删除", "success");
    renderGroupManage();
  };

  window.clearAllGroups = () => {
    if (confirm("确定清空所有小组数据？此操作不可恢复！")) {
      DB.groups[grade][classNo] = [];
      saveDB();
      showToast("已清空所有小组", "success");
      renderGroupManage();
    }
  };

  window.openAddMemberModal = (gn) => {
    const unassigned = classStudents.filter((s) => !assignedNames.has(s.studentName));
    const options = unassigned.length > 0
      ? unassigned.map((s) => `<label class="checkbox-item"><input type="checkbox" class="add_member_cb" value="${esc(s.studentName)}" /> ${esc(s.studentName)}</label>`).join("")
      : `<div style="color:#999;padding:12px;text-align:center">暂无可添加的学生</div>`;

    showModal(`➕ 添加组员到「${gn}」`, `
      <div class="form-group">
        <label>选择要添加的学生（可多选）</label>
        <div class="checkbox-group" style="max-height:300px;overflow-y:auto">
          ${options}
        </div>
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="add_as_leader" /> 设为组长（仅第一个选中的有效）
        </label>
      </div>
    `, "添加", () => {
      const checked = Array.from(document.querySelectorAll(".add_member_cb:checked")).map((el) => el.value);
      if (checked.length === 0) { showToast("请选择学生", "warning"); return false; }
      const isLeader = $("add_as_leader").checked;
      checked.forEach((name, i) => {
        const studentId = getStudentIdFromRoster(grade, classNo, name) || "";
        DB.groups[grade][classNo].push({
          studentId, studentName: name, groupName: gn, isLeader: isLeader && i === 0
        });
      });
      saveDB();
      showToast(`成功添加 ${checked.length} 名学生`, "success");
      renderGroupManage();
    });
  };

  window.removeMemberFromGroup = (gn, idx) => {
    const members = groupMap[gn];
    const member = members[idx];
    if (!member) return;
    if (!confirm(`确定将「${member.studentName}」移出「${gn}」？`)) return;
    const allIdx = DB.groups[grade][classNo].findIndex((g) => g.studentName === member.studentName && g.groupName === gn);
    if (allIdx >= 0) DB.groups[grade][classNo].splice(allIdx, 1);
    saveDB();
    showToast("已移出", "success");
    renderGroupManage();
  };

  window.openSetLeaderModal = (gn) => {
    const members = groupMap[gn] || [];
    if (members.length === 0) { showToast("小组暂无成员", "warning"); return; }
    const options = members.map((m, i) => `
      <label class="radio-item">
        <input type="radio" name="set_leader_radio" value="${esc(m.studentName)}" ${m.isLeader ? "checked" : ""} />
        ${esc(m.studentName)}
      </label>
    `).join("");
    showModal(`👑 设置「${gn}」组长`, `
      <div class="form-group">
        <label>选择组长</label>
        <div class="radio-group">${options}</div>
      </div>
    `, "确定", () => {
      const selected = document.querySelector("input[name=set_leader_radio]:checked")?.value;
      if (!selected) { showToast("请选择组长", "warning"); return false; }
      DB.groups[grade][classNo].forEach((g) => {
        if (g.groupName === gn) g.isLeader = g.studentName === selected;
      });
      saveDB();
      showToast("组长设置成功", "success");
      renderGroupManage();
    });
  };

  window.openQuickAddModal = () => {
    const groupOptions = groupNames.map((gn) => `<option value="${esc(gn)}">${esc(gn)}</option>`).join("");
    showModal("👤 单个添加学生", `
      <div class="form-group">
        <label>学生姓名</label>
        <input type="text" id="qa_student_name" placeholder="输入学生姓名" />
      </div>
      <div class="form-group">
        <label>选择小组</label>
        <select id="qa_group_name">
          <option value="">-- 请选择 --</option>
          ${groupOptions}
          <option value="__new__">➕ 创建新小组</option>
        </select>
      </div>
      <div class="form-group" id="qa_new_group_div" style="display:none">
        <label>新小组名称</label>
        <input type="text" id="qa_new_group_name" placeholder="输入新小组名称" />
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="qa_is_leader" /> 设为组长
        </label>
      </div>
    `, "添加", () => {
      const name = $("qa_student_name").value.trim();
      if (!name) { showToast("请输入学生姓名", "warning"); return false; }
      let gn = $("qa_group_name").value;
      if (gn === "__new__") {
        gn = $("qa_new_group_name").value.trim();
        if (!gn) { showToast("请输入新小组名称", "warning"); return false; }
      }
      if (!gn) { showToast("请选择小组", "warning"); return false; }
      const isLeader = $("qa_is_leader").checked;
      const studentId = getStudentIdFromRoster(grade, classNo, name) || "";
      if (DB.groups[grade][classNo].find((g) => g.studentName === name)) {
        showToast("该学生已在小组中", "warning"); return false;
      }
      if (isLeader) {
        DB.groups[grade][classNo].forEach((g) => { if (g.groupName === gn) g.isLeader = false; });
      }
      DB.groups[grade][classNo].push({ studentId, studentName: name, groupName: gn, isLeader });
      saveDB();
      showToast("添加成功", "success");
      renderGroupManage();
    });
    setTimeout(() => {
      $("qa_group_name").onchange = () => {
        $("qa_new_group_div").style.display = $("qa_group_name").value === "__new__" ? "block" : "none";
      };
    }, 50);
  };

  window.openQuickAssignModal = (studentName) => {
    const groupOptions = groupNames.map((gn) => `<option value="${esc(gn)}">${esc(gn)}</option>`).join("");
    showModal(`分配「${studentName}」到小组`, `
      <div class="form-group">
        <label>选择小组</label>
        <select id="qa_assign_group">
          <option value="">-- 请选择 --</option>
          ${groupOptions}
          <option value="__new__">➕ 创建新小组</option>
        </select>
      </div>
      <div class="form-group" id="qa_assign_new_div" style="display:none">
        <label>新小组名称</label>
        <input type="text" id="qa_assign_new_name" placeholder="输入新小组名称" />
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="qa_assign_leader" /> 设为组长
        </label>
      </div>
    `, "分配", () => {
      let gn = $("qa_assign_group").value;
      if (gn === "__new__") {
        gn = $("qa_assign_new_name").value.trim();
        if (!gn) { showToast("请输入新小组名称", "warning"); return false; }
      }
      if (!gn) { showToast("请选择小组", "warning"); return false; }
      const isLeader = $("qa_assign_leader").checked;
      const studentId = getStudentIdFromRoster(grade, classNo, studentName) || "";
      if (isLeader) {
        DB.groups[grade][classNo].forEach((g) => { if (g.groupName === gn) g.isLeader = false; });
      }
      DB.groups[grade][classNo].push({ studentId, studentName, groupName: gn, isLeader });
      saveDB();
      showToast("分配成功", "success");
      renderGroupManage();
    });
    setTimeout(() => {
      $("qa_assign_group").onchange = () => {
        $("qa_assign_new_div").style.display = $("qa_assign_group").value === "__new__" ? "block" : "none";
      };
    }, 50);
  };

  // 计算小组综合指标
  const calcGroupMetrics = (groupRecs, groupMembers) => {
    if (groupRecs.length === 0) return null;
    const totals = groupRecs.map((r) => r.total);
    const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
    const max = Math.max(...totals);
    const min = Math.min(...totals);
    const std = mathStdDev(totals);
    const fullScore = subjects.reduce((sum, s) => sum + (s.fullScore || s.score || 100), 0);
    const passLine = subjects.reduce((sum, s) => sum + (s.pass || 60), 0);
    const excLine = subjects.reduce((sum, s) => sum + (s.excellent || 90), 0);
    const passCount = totals.filter((t) => t >= passLine).length;
    const excCount = totals.filter((t) => t >= excLine).length;

    const subjAvgs = {};
    subjects.forEach((s) => {
      const vals = groupRecs.map((r) => r.scores[s.name]).filter((v) => typeof v === "number" && !isNaN(v));
      subjAvgs[s.name] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });

    const weakSubjs = subjects.filter((s) => subjAvgs[s.name] != null && subjAvgs[s.name] < (s.pass || 60))
      .sort((a, b) => (subjAvgs[a.name] || 0) - (subjAvgs[b.name] || 0));

    const strongSubjs = subjects.filter((s) => subjAvgs[s.name] != null && subjAvgs[s.name] >= (s.excellent || 90))
      .sort((a, b) => (subjAvgs[b.name] || 0) - (subjAvgs[a.name] || 0));

    return {
      avg, max, min, std, fullScore, passLine, excLine,
      passRate: passCount / groupRecs.length,
      excRate: excCount / groupRecs.length,
      subjAvgs, weakSubjs, strongSubjs,
      count: groupRecs.length,
      memberCount: groupMembers.length
    };
  };

  // 生成小组专业建议
  const generateGroupSuggestions = (gn, metrics, allMetrics, groupMembersWithScores) => {
    const suggestions = [];
    if (!metrics) return ["暂无成绩数据，建议先导入考试成绩后再分析。"];

    const sortedGroups = Object.entries(allMetrics)
      .filter(([, m]) => m)
      .sort((a, b) => b[1].avg - a[1].avg);
    const rank = sortedGroups.findIndex(([name]) => name === gn) + 1;
    const totalGroups = sortedGroups.length;

    if (rank === 1) {
      suggestions.push(`🏆 综合表现：该小组总分均分排名第 ${rank}/${totalGroups}，整体表现优秀，是班级的标杆小组。建议：①继续保持良好的学习氛围；②组长可分享高效学习方法带动其他小组；③适当增加挑战性任务，进一步提升上限。`);
    } else if (rank <= Math.ceil(totalGroups / 2)) {
      suggestions.push(`📈 综合表现：该小组总分均分排名第 ${rank}/${totalGroups}，处于中上游水平。建议：①对标第1名小组，找出差距最大的学科重点突破；②加强小组内部互助机制，优带中、中带潜；③每次考试后召开小组复盘会，总结得失。`);
    } else {
      suggestions.push(`⚠️ 综合表现：该小组总分均分排名第 ${rank}/${totalGroups}，有较大提升空间。建议：①班主任重点关注，与组长沟通了解困难；②分析薄弱学科原因（基础差/方法不对/学习态度），制定针对性提升计划；③建立师徒结对，由优秀小组与该小组结对帮扶；④设置短期可达成目标，逐步提升信心。`);
    }

    if (metrics.weakSubjs.length > 0) {
      const weakNames = metrics.weakSubjs.map((s) => s.name).join("、");
      const weakest = metrics.weakSubjs[0];
      suggestions.push(`📉 薄弱学科：${weakNames}均分未达及格线（${weakest.name}最低）。建议：①${weakest.name}学科安排小组内专题辅导，由该科成绩好的同学担任学科组长；②每天安排15-20分钟小组互助背诵/练习；③与对应学科老师沟通，争取课堂上多关注该组学生；④建立错题共享本，小组共同攻克典型错题。`);
    }

    if (metrics.strongSubjs.length > 0) {
      const strongNames = metrics.strongSubjs.map((s) => s.name).join("、");
      suggestions.push(`💪 优势学科：${strongNames}表现优秀。建议：①继续巩固优势，争取满分突破；②发挥优势学科的辐射作用，帮助其他小组提升；③鼓励组内学生参加学科竞赛或拓展性学习；④总结优势学科的学习方法，迁移到薄弱学科。`);
    }

    if (metrics.std > (metrics.fullScore * 0.15)) {
      suggestions.push(`📊 组内差异：该小组标准差较大（${fmt(metrics.std, 1)}分），组员成绩分化明显。建议：①实行"一对一"帮扶配对，优生带学困生；②小组任务分层设计，让不同层次学生都有收获；③关注后进生心理状态，避免掉队；④组长要均衡关注每个成员，不能只抓尖子生。`);
    } else {
      suggestions.push(`🎯 组内均衡：该小组标准差较小（${fmt(metrics.std, 1)}分），组员水平相对均衡。建议：①整体推进，共同进步；②设置小组集体目标，强化团队意识；③开展小组合作学习项目，培养协作能力；④鼓励良性竞争，激发每个人的潜力。`);
    }

    const lowScorers = groupMembersWithScores.filter((m) => m.score != null && m.score < metrics.passLine);
    if (lowScorers.length > 0) {
      suggestions.push(`🚨 关注学生：${lowScorers.slice(0, 3).map((s) => s.name).join("、")}${lowScorers.length > 3 ? "等" : ""}总分未达及格线。建议：①分别与学生谈心，了解学习困难和原因；②联系家长沟通，争取家庭支持配合；③制定个性化辅导计划，设定阶梯式进步目标；④安排小老师结对，课上课下双重帮扶。`);
    }

    const highScorers = groupMembersWithScores.filter((m) => m.score != null && m.score >= metrics.excLine);
    if (highScorers.length > 0) {
      suggestions.push(`🌟 拔尖学生：${highScorers.slice(0, 3).map((s) => s.name).join("、")}${highScorers.length > 3 ? "等" : ""}总分优秀。建议：①提供拓展性学习资源，满足更高层次需求；②鼓励担任学科小老师，在帮助他人中巩固提升；③引导参与学科竞赛或研究性学习；④树立为榜样，带动全班学习积极性。`);
    }

    const leader = groupMembersWithScores.find((m) => m.isLeader);
    if (leader) {
      suggestions.push(`👑 组长作用：组长${leader.name}${leader.score != null ? `本次总分${leader.score}分（${leader.score >= metrics.avg ? "高于" : "低于"}组均分）` : ""}。建议：①定期召开小组会议（每周1-2次），明确学习任务和目标；②建立小组奖惩机制，调动组员积极性；③加强小组长培训，提升组织管理能力；④关注组内动态，及时化解矛盾，营造和谐氛围。`);
    }

    return suggestions;
  };

  // 刷新小组成绩（科技感版本）
  window.refreshHeadteacherGroupScores = () => {
    const examId = $("htg_exam").value;
    const exam = DB.exams.find((e) => e.id === examId);
    if (!exam) return;

    const groupMap = {};
    groups.forEach((g) => {
      if (!groupMap[g.groupName]) groupMap[g.groupName] = [];
      groupMap[g.groupName].push(g);
    });
    const groupNames = Object.keys(groupMap).sort();

    const classRecs = DB.records.filter((r) => r.examId === examId && classNoEquals(r.classNo, classNo));
    const nameToRec = {};
    classRecs.forEach((r) => { if (r.studentName) nameToRec[r.studentName] = r; });

    const allMetrics = {};
    const groupMembersWithScoresMap = {};
    groupNames.forEach((gn) => {
      const members = groupMap[gn];
      const memberNames = members.map((m) => m.studentName);
      const recs = classRecs.filter((r) => memberNames.includes(r.studentName));
      allMetrics[gn] = calcGroupMetrics(recs, members);

      groupMembersWithScoresMap[gn] = members.map((m) => {
        const rec = nameToRec[m.studentName];
        return { name: m.studentName, score: rec?.total, isLeader: m.isLeader };
      });
    });

    const sortedByAvg = [...groupNames].filter((g) => allMetrics[g]).sort((a, b) => (allMetrics[b]?.avg || 0) - (allMetrics[a]?.avg || 0));
    const topGroup = sortedByAvg[0];
    const bottomGroup = sortedByAvg[sortedByAvg.length - 1];
    const classAvg = classRecs.length > 0 ? classRecs.reduce((a, b) => a + b.total, 0) / classRecs.length : 0;

    const chartBar = `htg_chart_bar_${Date.now()}`;
    const chartRadar = `htg_chart_radar_${Date.now()}`;
    const chartDist = `htg_chart_dist_${Date.now()}`;

    let html = `<div class="tech-analysis-panel">`;

    html += `<div class="tech-hero-section">
      <div class="tech-hero-bg"></div>
      <div class="tech-hero-content">
        <div class="tech-hero-title">
          <span class="tech-badge">AI驱动</span>
          <h2>${esc(exam.name)} · 学习小组智能分析报告</h2>
        </div>
        <div class="tech-hero-stats">
          <div class="tech-stat-card">
            <div class="tech-stat-icon">👥</div>
            <div class="tech-stat-info">
              <div class="tech-stat-num">${groupNames.length}</div>
              <div class="tech-stat-label">学习小组</div>
            </div>
          </div>
          <div class="tech-stat-card">
            <div class="tech-stat-icon">🎓</div>
            <div class="tech-stat-info">
              <div class="tech-stat-num">${groups.length}</div>
              <div class="tech-stat-label">学生总数</div>
            </div>
          </div>
          <div class="tech-stat-card">
            <div class="tech-stat-icon">📊</div>
            <div class="tech-stat-info">
              <div class="tech-stat-num">${fmt(classAvg, 1)}</div>
              <div class="tech-stat-label">班级均分</div>
            </div>
          </div>
          <div class="tech-stat-card highlight">
            <div class="tech-stat-icon">🏆</div>
            <div class="tech-stat-info">
              <div class="tech-stat-num">${topGroup ? esc(topGroup) : "-"}</div>
              <div class="tech-stat-label">最优小组</div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

    html += `<div class="tech-section">
      <div class="tech-section-header">
        <h3><span class="tech-dot"></span>📊 小组综合实力对比</h3>
        <div class="tech-section-sub">各小组总分均分排名与差距分析</div>
      </div>
      <div class="tech-chart-row">
        <div class="tech-chart-box tech-chart-main">
          <canvas id="${chartBar}"></canvas>
        </div>
        <div class="tech-chart-side">
          <div class="tech-ranking-card">
            <div class="tech-ranking-title">🏅 小组排名</div>
            <div class="tech-ranking-list">
              ${sortedByAvg.map((gn, i) => {
                const m = allMetrics[gn];
                const diff = m ? m.avg - classAvg : 0;
                return `
                  <div class="tech-ranking-item ${i === 0 ? 'rank-1' : ''} ${i === 1 ? 'rank-2' : ''} ${i === 2 ? 'rank-3' : ''}">
                    <div class="rank-num">${i + 1}</div>
                    <div class="rank-name">${esc(gn)}</div>
                    <div class="rank-score">${m ? fmt(m.avg, 1) : "-"}</div>
                    <div class="rank-diff ${diff >= 0 ? 'positive' : 'negative'}">${diff >= 0 ? '+' : ''}${fmt(diff, 1)}</div>
                  </div>
                `;
              }).join("")}
            </div>
          </div>
        </div>
      </div>
    </div>`;

    html += `<div class="tech-section">
      <div class="tech-section-header">
        <h3><span class="tech-dot"></span>🎯 各学科均衡度分析</h3>
        <div class="tech-section-sub">多维度雷达图，直观展示小组学科强弱分布</div>
      </div>
      <div class="tech-chart-box" style="height:380px">
        <canvas id="${chartRadar}"></canvas>
      </div>
    </div>`;

    html += `<div class="tech-section">
      <div class="tech-section-header">
        <h3><span class="tech-dot"></span>📋 小组详细指标对比</h3>
        <div class="tech-section-sub">全面数据指标横向对比</div>
      </div>
      <div class="tech-table-wrap">
        <table class="tech-table">
          <thead><tr>
            <th>小组名称</th><th>人数</th><th>总分均分</th><th>班内排名</th><th>最高/最低分</th>
            <th>标准差</th><th>及格率</th><th>优秀率</th>
            ${subjects.map((s) => `<th>${esc(s.name)}均分</th>`).join("")}
          </tr></thead>
          <tbody>
            ${sortedByAvg.map((gn, rankIdx) => {
              const m = allMetrics[gn];
              if (!m) return `<tr><td><b>${esc(gn)}</b></td><td>${groupMap[gn].length}</td><td colspan="${6 + subjects.length}"><span style="color:#999">暂无数据</span></td></tr>`;
              return `
                <tr class="${rankIdx === 0 ? 'row-top' : ''} ${rankIdx === sortedByAvg.length - 1 ? 'row-bottom' : ''}">
                  <td><b>${esc(gn)}</b></td>
                  <td>${m.count}</td>
                  <td class="score-main">${fmt(m.avg, 1)}</td>
                  <td><span class="rank-badge rank-${rankIdx + 1}">第${rankIdx + 1}名</span></td>
                  <td>${m.max} / ${m.min}</td>
                  <td>${fmt(m.std, 1)}</td>
                  <td>${fmtPct(m.passRate)}</td>
                  <td>${fmtPct(m.excRate)}</td>
                  ${subjects.map((s) => {
                    const val = m.subjAvgs[s.name];
                    const isWeak = val != null && val < (s.pass || 60);
                    const isStrong = val != null && val >= (s.excellent || 90);
                    return `<td class="${isWeak ? 'score-low' : isStrong ? 'score-high' : ''}">${val != null ? fmt(val, 1) : "-"}</td>`;
                  }).join("")}
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>`;

    html += `<div class="tech-section">
      <div class="tech-section-header">
        <h3><span class="tech-dot"></span>💡 智能诊断与专业建议</h3>
        <div class="tech-section-sub">基于教育数据分析，为每个小组提供个性化改进方案</div>
      </div>
      <div class="tech-suggestions-grid">
        ${groupNames.map((gn, idx) => {
          const metrics = allMetrics[gn];
          const suggestions = generateGroupSuggestions(gn, metrics, allMetrics, groupMembersWithScoresMap[gn] || []);
          const colorIdx = idx % 8;
          return `
            <div class="tech-suggest-card" style="--accent-color: var(--group-color-${colorIdx + 1})">
              <div class="suggest-card-header">
                <div class="suggest-group-name">${esc(gn)}</div>
                ${metrics ? `<div class="suggest-group-rank">排名 ${sortedByAvg.indexOf(gn) + 1}/${sortedByAvg.length}</div>` : ''}
              </div>
              <div class="suggest-card-body">
                ${suggestions.slice(0, 4).map((s) => `
                  <div class="suggest-item">
                    <div class="suggest-text">${s}</div>
                  </div>
                `).join("")}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>`;

    const thId = showStudentId ? "<th>学号</th>" : "";
    html += `<div class="tech-section">
      <div class="tech-section-header">
        <h3><span class="tech-dot"></span>👨‍🎓 小组成员成绩明细</h3>
        <div class="tech-section-sub">逐人逐项成绩详情</div>
      </div>
      <div class="tech-table-wrap">
        <table class="tech-table">
          <thead><tr>${thId}<th>姓名</th><th>小组</th><th>角色</th><th>总分</th>
            ${subjects.map((s) => `<th>${esc(s.name)}</th>`).join("")}
          </tr></thead>
          <tbody>
            ${sortedByAvg.flatMap((gn) => {
              const members = groupMap[gn];
              return members.map((g) => {
                const rec = nameToRec[g.studentName];
                const rosterId = showStudentId ? getStudentIdFromRoster(grade, classNo, g.studentName) : "";
                return `<tr>
                  ${showStudentId ? `<td>${esc(rosterId)}</td>` : ""}
                  <td><b>${esc(g.studentName)}</b></td>
                  <td><span class="group-chip">${esc(gn)}</span></td>
                  <td>${g.isLeader ? '<span class="leader-tag">👑 组长</span>' : '<span style="color:#999">组员</span>'}</td>
                  <td class="score-main"><b>${rec?.total || "-"}</b></td>
                  ${subjects.map((s) => {
                    const score = rec?.scores[s.name];
                    const isLow = typeof score === "number" && score < (s.pass || 60);
                    const isHigh = typeof score === "number" && score >= (s.excellent || 90);
                    return `<td class="${isLow ? 'score-low' : isHigh ? 'score-high' : ''}">${typeof score === "number" ? score : "-"}</td>`;
                  }).join("")}
                </tr>`;
              });
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>`;

    html += `</div>`;

    $("htg_result").innerHTML = html;

    setTimeout(() => {
      const chartData = sortedByAvg.map((gn) => allMetrics[gn]?.avg || 0);
      drawChart(chartBar, "bar", sortedByAvg, [{ label: "总分均分", data: chartData }], {
        colors: ["#6366f1"],
        gradient: true
      });

      const radarLabels = subjects.map((s) => s.name);
      const radarDatasets = sortedByAvg.slice(0, Math.min(sortedByAvg.length, 6)).map((gn, i) => {
        const colors = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];
        const data = subjects.map((s) => {
          const m = allMetrics[gn];
          const val = m?.subjAvgs[s.name] || 0;
          const full = s.fullScore || s.score || 100;
          return +fmt((val / full) * 100, 1);
        });
        return { label: gn, data, borderColor: colors[i], backgroundColor: colors[i] + "20" };
      });
      if (window.Chart) {
        const ctx = document.getElementById(chartRadar);
        if (ctx) {
          new Chart(ctx, {
            type: "radar",
            data: { labels: radarLabels, datasets: radarDatasets },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              scales: { r: { beginAtZero: true, max: 100 } },
              plugins: { legend: { position: "right" } }
            }
          });
        }
      }
    }, 100);
  };

  // 导出小组分析报告（增强版）
  window.downloadHeadteacherGroupAnalysis = () => {
    const examId = $("htg_exam")?.value;
    if (!examId) { showToast("请先选择考试", "warning"); return; }
    const exam = DB.exams.find((e) => e.id === examId);

    const groupMap = {};
    groups.forEach((g) => { if (!groupMap[g.groupName]) groupMap[g.groupName] = []; groupMap[g.groupName].push(g); });
    const groupNames = Object.keys(groupMap).sort();

    const classRecs = DB.records.filter((r) => r.examId === examId && classNoEquals(r.classNo, classNo));
    const nameToRec = {};
    classRecs.forEach((r) => { if (r.studentName) nameToRec[r.studentName] = r; });

    const allMetrics = {};
    groupNames.forEach((gn) => {
      const members = groupMap[gn];
      const memberNames = members.map((m) => m.studentName);
      const recs = classRecs.filter((r) => memberNames.includes(r.studentName));
      allMetrics[gn] = calcGroupMetrics(recs, members);
    });
    const sortedByAvg = [...groupNames].filter((g) => allMetrics[g]).sort((a, b) => (allMetrics[b]?.avg || 0) - (allMetrics[a]?.avg || 0));

    const wb = XLSX.utils.book_new();

    const statHeader = ["排名", "小组", "人数", "总分均分", "最高分", "最低分", "标准差", ...subjects.map((s) => s.name + "均分"), "及格率", "优秀率"];
    const statData = sortedByAvg.map((gn, rankIdx) => {
      const m = allMetrics[gn];
      if (!m) return [rankIdx + 1, gn, groupMap[gn].length, "-", "-", "-", "-", ...subjects.map(() => "-"), "-", "-"];
      const subjAvgs = subjects.map((s) => m.subjAvgs[s.name] != null ? fmt(m.subjAvgs[s.name], 2) : "-");
      return [rankIdx + 1, gn, m.count, fmt(m.avg, 2), m.max, m.min, fmt(m.std, 2), ...subjAvgs,
        fmt(m.passRate * 100, 1) + "%", fmt(m.excRate * 100, 1) + "%"];
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([statHeader, ...statData]), "小组排名统计");

    const memberHeader = ["学号", "姓名", "小组", "角色", "总分", ...subjects.map((s) => s.name)];
    const memberData = groups.map((g) => {
      const rec = nameToRec[g.studentName];
      const scores = subjects.map((s) => rec?.scores[s.name] != null ? rec.scores[s.name] : "-");
      return [g.studentId, g.studentName, g.groupName, g.isLeader ? "组长" : "组员", rec?.total || "-", ...scores];
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([memberHeader, ...memberData]), "成员明细");

    const sugHeader = ["小组", "建议类型", "详细建议"];
    const sugData = [];
    groupNames.forEach((gn) => {
      const members = groupMap[gn];
      const memberNames = members.map((m) => m.studentName);
      const recs = classRecs.filter((r) => memberNames.includes(r.studentName));
      const metrics = calcGroupMetrics(recs, members);
      const membersWithScores = members.map((m) => {
        const rec = nameToRec[m.studentName];
        return { name: m.studentName, score: rec?.total, isLeader: m.isLeader };
      });
      const suggestions = generateGroupSuggestions(gn, metrics, allMetrics, membersWithScores);
      suggestions.forEach((s, i) => {
        sugData.push([gn, `建议${i + 1}`, s]);
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([sugHeader, ...sugData]), "智能建议");

    XLSX.writeFile(wb, `${grade}_${classNo}_${exam.name}_小组智能分析.xlsx`);
    showToast("分析报告已下载（含排名、明细、建议）", "success");
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

// ========== 任课教师：小组成绩分析（科技感版本） ==========
function renderGroupScores() {
  const grade = currentUser.grade;
  const mySubjects = currentUser.subjects || [];
  const myClassNos = getTeacherClassNos(currentUser, grade);
  // 任课教师：显示年级统一考试 + 所教班级的自建考试
  const exams = getSortedExams(grade).filter((e) => {
    if (!e.isClassExam) return true;
    return myClassNos.some((c) => classNoEquals(e.classNo, c));
  });
  const showStudentId = hasRoster(grade);

  if (exams.length === 0) {
    $("pageContent").innerHTML = `<div class="card"><div class="empty-state"><div class="es-icon">📝</div><div class="es-title">暂无考试数据</div></div></div>`;
    return;
  }

  const myClasses = [...new Set(DB.records.filter((r) => r.grade === grade && mySubjects.some((s) => r.scores && r.scores[s] != null)).map((r) => r.classNo))].sort();
  if (!DB.groups) DB.groups = {};
  if (!DB.groups[grade]) DB.groups[grade] = {};
  const allGroups = DB.groups[grade] || {};
  const myGroups = {};
  myClasses.forEach((c) => { if (allGroups[c]) myGroups[c] = allGroups[c]; });

  const totalStudents = Object.values(myGroups).reduce((sum, arr) => sum + arr.length, 0);
  const totalGroups = Object.values(myGroups).reduce((sum, arr) => {
    const names = new Set(arr.map((g) => g.groupName));
    return sum + names.size;
  }, 0);

  const examOptions = exams.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("");
  const classOptions = myClasses.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");

  $("pageContent").innerHTML = `
    <div class="card tech-card">
      <div class="card-title">👥 小组成绩智能分析</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
        <label>选择考试：</label>
        <select id="gs_exam" class="form-control" style="width:220px">${examOptions}</select>
        <label>选择班级：</label>
        <select id="gs_class" class="form-control" style="width:140px">
          <option value="">全部班级</option>
          ${classOptions}
        </select>
        <button class="btn btn-primary" onclick="refreshGroupScores()">🔍 分析</button>
        <button class="btn btn-success" onclick="downloadGroupAnalysis()">📥 导出Excel</button>
        <button class="btn btn-info" onclick="downloadGroupMemberList()">📋 下载小组名单</button>
      </div>
      <div class="gm-stats">
        <div class="gm-stat-item"><div class="gm-stat-num">${myClasses.length}</div><div class="gm-stat-label">任教班级</div></div>
        <div class="gm-stat-item"><div class="gm-stat-num">${totalGroups}</div><div class="gm-stat-label">小组总数</div></div>
        <div class="gm-stat-item"><div class="gm-stat-num">${totalStudents}</div><div class="gm-stat-label">学生总数</div></div>
        <div class="gm-stat-item"><div class="gm-stat-num">${mySubjects.join("、")}</div><div class="gm-stat-label">任教学科</div></div>
      </div>
    </div>
    <div id="gs_result"></div>
  `;

  $("gs_exam").addEventListener("change", () => refreshGroupScores());
  $("gs_class").addEventListener("change", () => refreshGroupScores());
  setTimeout(() => refreshGroupScores(), 100);
}

function generateTeacherGroupSuggestions(gn, subjectName, subjectMetrics, allMetrics, membersWithScores) {
  const suggestions = [];
  if (!subjectMetrics) return ["暂无该学科成绩数据。"];

  const sortedGroups = Object.entries(allMetrics)
    .filter(([, m]) => m)
    .sort((a, b) => b[1].avg - a[1].avg);
  const rank = sortedGroups.findIndex(([name]) => name === gn) + 1;
  const totalGroups = sortedGroups.length;

  if (rank === 1) {
    suggestions.push(`🏆 学科表现：该小组${subjectName}均分排名第 ${rank}/${totalGroups}，表现卓越。建议：①继续保持学科优势，挑战更高难度题目；②鼓励组内学生担任该学科"小老师"，帮助其他小组；③开展学科拓展阅读和竞赛训练；④总结高效学习方法，在全班分享。`);
  } else if (rank <= Math.ceil(totalGroups / 2)) {
    suggestions.push(`📈 学科表现：该小组${subjectName}均分排名第 ${rank}/${totalGroups}，处于中上游。建议：①对标第1名小组，分析失分点差距；②加强重难点专题训练；③建立小组错题本，定期复盘；④组内开展"每周一题"研讨活动。`);
  } else {
    suggestions.push(`⚠️ 学科表现：该小组${subjectName}均分排名第 ${rank}/${totalGroups}，需重点提升。建议：①从基础抓起，回归课本夯实基础；②每天安排15分钟小组背诵/默写；③与学生沟通了解学习困难点；④联系班主任协同关注；⑤设置"小步走"目标，逐步提升信心。`);
  }

  if (subjectMetrics.std > (subjectMetrics.fullScore * 0.15)) {
    suggestions.push(`📊 组内差异：标准差${fmt(subjectMetrics.std, 1)}分，组员分化较明显。建议：①组内"一对一"结对帮扶；②分层布置作业，各有收获；③关注后进生，避免掉队；④组长多组织互助学习。`);
  } else {
    suggestions.push(`🎯 组内均衡：标准差${fmt(subjectMetrics.std, 1)}分，组员水平较整齐。建议：①整体推进，共同进步；②小组竞赛激发斗志；③合作探究式学习；④人人都当小老师。`);
  }

  const lowScorers = membersWithScores.filter((m) => m.score != null && m.score < subjectMetrics.passLine);
  if (lowScorers.length > 0) {
    suggestions.push(`🚨 待优生：${lowScorers.slice(0, 3).map((s) => s.name).join("、")}${lowScorers.length > 3 ? "等" : ""}未达及格线。建议：①课堂上多提问、多关注；②课后针对性辅导；③作业面批面改；④家校沟通形成合力；⑤建立进步档案，及时肯定。`);
  }

  const highScorers = membersWithScores.filter((m) => m.score != null && m.score >= subjectMetrics.excLine);
  if (highScorers.length > 0) {
    suggestions.push(`🌟 学优生：${highScorers.slice(0, 3).map((s) => s.name).join("、")}${highScorers.length > 3 ? "等" : ""}成绩优秀。建议：①提供拓展性学习资源；②鼓励参加学科竞赛；③担任课代表或小组长；④引导深度学习和探究。`);
  }

  const leader = membersWithScores.find((m) => m.isLeader);
  if (leader) {
    suggestions.push(`👑 组长引领：组长${leader.name}${leader.score != null ? `该科${leader.score}分` : ""}。建议：①组长带头组织小组学科学习；②建立小组学习公约；③定期检查作业完成情况；④组织考前互助复习。`);
  }

  return suggestions;
}

function refreshGroupScores() {
  const grade = currentUser.grade;
  const mySubjects = currentUser.subjects || [];
  const examId = $("gs_exam").value;
  const filterClass = $("gs_class")?.value || "";
  const exam = DB.exams.find((e) => e.id === examId);
  if (!exam) return;

  let myClasses = [...new Set(DB.records.filter((r) => r.grade === grade && mySubjects.some((s) => r.scores && r.scores[s] != null)).map((r) => r.classNo))].sort();
  if (filterClass) myClasses = myClasses.filter((c) => c === filterClass);

  if (!DB.groups) DB.groups = {};
  if (!DB.groups[grade]) DB.groups[grade] = {};
  const allGroups = DB.groups[grade];
  const subjects = DB.subjects[grade] || [];
  const showStudentId = hasRoster(grade);

  let html = `<div class="tech-analysis-panel">`;

  myClasses.forEach((classNo, classIdx) => {
    const groups = allGroups[classNo] || [];
    if (groups.length === 0) return;

    const groupMap = {};
    groups.forEach((g) => { if (!groupMap[g.groupName]) groupMap[g.groupName] = []; groupMap[g.groupName].push(g); });
    const groupNames = Object.keys(groupMap).sort();

    const classRecs = DB.records.filter((r) => r.examId === examId && classNoEquals(r.classNo, classNo));
    const nameToRec = {};
    classRecs.forEach((r) => { if (r.studentName) nameToRec[r.studentName] = r; });

    html += `<div class="tech-section">
      <div class="tech-section-header">
        <h3><span class="tech-dot"></span>🏫 ${esc(classNo)} · ${mySubjects.join("、")}小组分析</h3>
        <div class="tech-section-sub">共 ${groupNames.length} 个学习小组，${groups.length} 名学生</div>
      </div>`;

    mySubjects.forEach((subjectName, subjIdx) => {
      const subject = subjects.find((s) => s.name === subjectName);
      if (!subject) return;

      const subjMetrics = {};
      const membersWithScoresMap = {};
      groupNames.forEach((gn) => {
        const members = groupMap[gn];
        const memberNames = members.map((m) => m.studentName);
        const recs = classRecs.filter((r) => memberNames.includes(r.studentName));
        const scores = recs.map((r) => r.scores[subjectName]).filter((v) => typeof v === "number" && !isNaN(v));
        if (scores.length > 0) {
          const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
          const passCount = scores.filter((s) => s >= subject.pass).length;
          const excCount = scores.filter((s) => s >= subject.excellent).length;
          subjMetrics[gn] = {
            avg, max: Math.max(...scores), min: Math.min(...scores),
            std: mathStdDev(scores), count: scores.length,
            passRate: passCount / scores.length,
            excRate: excCount / scores.length,
            fullScore: subject.fullScore || subject.score || 100,
            passLine: subject.pass, excLine: subject.excellent
          };
        } else {
          subjMetrics[gn] = null;
        }
        membersWithScoresMap[gn] = members.map((m) => {
          const rec = nameToRec[m.studentName];
          return { name: m.studentName, score: rec?.scores?.[subjectName], isLeader: m.isLeader };
        });
      });

      const sortedSubj = [...groupNames].filter((g) => subjMetrics[g]).sort((a, b) => (subjMetrics[b]?.avg || 0) - (subjMetrics[a]?.avg || 0));
      const chartId = `gs_${classNo}_${subjectName}_${Date.now()}`;

      html += `<div class="tech-sub-section">
        <div class="tech-sub-title">📊 ${esc(subjectName)}学科小组对比</div>
        <div class="tech-chart-row">
          <div class="tech-chart-box tech-chart-main">
            <canvas id="${chartId}"></canvas>
          </div>
          <div class="tech-chart-side">
            <div class="tech-ranking-card">
              <div class="tech-ranking-title">🏅 学科排名</div>
              <div class="tech-ranking-list">
                ${sortedSubj.map((gn, i) => {
                  const m = subjMetrics[gn];
                  return `
                    <div class="tech-ranking-item ${i === 0 ? 'rank-1' : ''} ${i === 1 ? 'rank-2' : ''} ${i === 2 ? 'rank-3' : ''}">
                      <div class="rank-num">${i + 1}</div>
                      <div class="rank-name">${esc(gn)}</div>
                      <div class="rank-score">${m ? fmt(m.avg, 1) : "-"}</div>
                    </div>
                  `;
                }).join("")}
              </div>
            </div>
          </div>
        </div>

        <div class="tech-table-wrap" style="margin-top:16px">
          <table class="tech-table">
            <thead><tr><th>排名</th><th>小组</th><th>人数</th><th>均分</th><th>最高分</th><th>最低分</th><th>标准差</th><th>及格率</th><th>优秀率</th></tr></thead>
            <tbody>
              ${sortedSubj.map((gn, i) => {
                const m = subjMetrics[gn];
                if (!m) return `<tr><td>-</td><td><b>${esc(gn)}</b></td><td>${groupMap[gn].length}</td><td colspan="6" style="color:#999">暂无数据</td></tr>`;
                return `<tr class="${i === 0 ? 'row-top' : ''} ${i === sortedSubj.length - 1 ? 'row-bottom' : ''}">
                  <td><span class="rank-badge rank-${i + 1}">${i + 1}</span></td>
                  <td><b>${esc(gn)}</b></td>
                  <td>${m.count}</td>
                  <td class="score-main">${fmt(m.avg, 1)}</td>
                  <td>${m.max}</td>
                  <td>${m.min}</td>
                  <td>${fmt(m.std, 1)}</td>
                  <td>${fmtPct(m.passRate)}</td>
                  <td>${fmtPct(m.excRate)}</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>

        <div class="tech-suggestions-section">
          <div class="tech-suggest-title">💡 ${esc(subjectName)}学科教学建议</div>
          <div class="tech-suggestions-grid">
            ${sortedSubj.slice(0, 4).map((gn, idx) => {
              const m = subjMetrics[gn];
              const suggestions = generateTeacherGroupSuggestions(gn, subjectName, m, subjMetrics, membersWithScoresMap[gn] || []);
              const colors = ["#6366f1", "#10b981", "#f59e0b", "#06b6d4"];
              return `
                <div class="tech-suggest-card" style="--accent-color: ${colors[idx % colors]}">
                  <div class="suggest-card-header">
                    <div class="suggest-group-name">${esc(gn)}</div>
                    <div class="suggest-group-rank">第${idx + 1}名</div>
                  </div>
                  <div class="suggest-card-body">
                    ${suggestions.slice(0, 2).map((s) => `<div class="suggest-item"><div class="suggest-text">${s}</div></div>`).join("")}
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>

        <div style="margin-top:16px">
          <div class="tech-sub-title" style="margin-bottom:12px">👨‍🎓 成员成绩明细</div>
          <div class="tech-table-wrap">
            <table class="tech-table">
              <thead><tr>${showStudentId ? "<th>学号</th>" : ""}<th>姓名</th><th>小组</th><th>角色</th><th>${esc(subjectName)}</th></tr></thead>
              <tbody>
                ${sortedSubj.flatMap((gn) => {
                  return groupMap[gn].map((g) => {
                    const rec = nameToRec[g.studentName];
                    const score = rec?.scores?.[subjectName];
                    const isLow = typeof score === "number" && score < (subject.pass || 60);
                    const isHigh = typeof score === "number" && score >= (subject.excellent || 90);
                    const rosterId = showStudentId ? getStudentIdFromRoster(grade, classNo, g.studentName) : "";
                    return `<tr>
                      ${showStudentId ? `<td>${esc(rosterId)}</td>` : ""}
                      <td><b>${esc(g.studentName)}</b></td>
                      <td><span class="group-chip">${esc(gn)}</span></td>
                      <td>${g.isLeader ? '<span class="leader-tag">👑 组长</span>' : '<span style="color:#999">组员</span>'}</td>
                      <td class="score-main ${isLow ? 'score-low' : isHigh ? 'score-high' : ''}"><b>${typeof score === "number" ? score : "-"}</b></td>
                    </tr>`;
                  });
                }).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;

      setTimeout(() => {
        const data = sortedSubj.map((gn) => subjMetrics[gn]?.avg || 0);
        drawChart(chartId, "bar", sortedSubj, [{ label: `${subjectName}均分`, data }], { colors: ["#6366f1"], gradient: true });
      }, 100 * (classIdx + subjIdx + 1));
    });

    html += `</div>`;
  });

  if (!myClasses.length || myClasses.every((c) => !allGroups[c] || allGroups[c].length === 0)) {
    html = `<div class="card"><div class="empty-state"><div class="es-icon">👥</div><div class="es-title">暂无小组数据</div><div class="es-tip">请联系班主任设置学习小组</div></div></div>`;
  }

  html += `</div>`;
  $("gs_result").innerHTML = html;
}

window.downloadGroupAnalysis = function () {
  const grade = currentUser.grade;
  const mySubjects = currentUser.subjects || [];
  const examId = $("gs_exam")?.value;
  const filterClass = $("gs_class")?.value || "";
  if (!examId) { showToast("请先选择考试", "warning"); return; }
  const exam = DB.exams.find((e) => e.id === examId);

  let myClasses = [...new Set(DB.records.filter((r) => r.grade === grade && mySubjects.some((s) => r.scores && r.scores[s] != null)).map((r) => r.classNo))].sort();
  if (filterClass) myClasses = myClasses.filter((c) => c === filterClass);

  if (!DB.groups) DB.groups = {};
  if (!DB.groups[grade]) DB.groups[grade] = {};
  const allGroups = DB.groups[grade];
  const subjects = DB.subjects[grade] || [];

  const wb = XLSX.utils.book_new();

  myClasses.forEach((classNo) => {
    const groups = allGroups[classNo] || [];
    if (groups.length === 0) return;
    const groupMap = {};
    groups.forEach((g) => { if (!groupMap[g.groupName]) groupMap[g.groupName] = []; groupMap[g.groupName].push(g); });
    const groupNames = Object.keys(groupMap).sort();

    const classRecs = DB.records.filter((r) => r.examId === examId && classNoEquals(r.classNo, classNo));
    const nameToRec = {};
    classRecs.forEach((r) => { if (r.studentName) nameToRec[r.studentName] = r; });

    mySubjects.forEach((subjectName) => {
      const subject = subjects.find((s) => s.name === subjectName);
      if (!subject) return;

      const header = ["排名", "小组", "人数", "均分", "最高分", "最低分", "标准差", "及格率", "优秀率"];
      const data = [];
      const metrics = [];
      groupNames.forEach((gn) => {
        const members = groupMap[gn];
        const memberNames = members.map((m) => m.studentName);
        const recs = classRecs.filter((r) => memberNames.includes(r.studentName));
        const scores = recs.map((r) => r.scores[subjectName]).filter((v) => typeof v === "number" && !isNaN(v));
        if (scores.length > 0) {
          const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
          const passCount = scores.filter((s) => s >= subject.pass).length;
          const excCount = scores.filter((s) => s >= subject.excellent).length;
          metrics.push({
            gn, count: scores.length, avg, max: Math.max(...scores), min: Math.min(...scores),
            std: mathStdDev(scores), passRate: passCount / scores.length, excRate: excCount / scores.length
          });
        } else {
          metrics.push({ gn, count: members.length, avg: null });
        }
      });
      metrics.sort((a, b) => (b.avg || 0) - (a.avg || 0));
      metrics.forEach((m, i) => {
        if (m.avg == null) {
          data.push(["-", m.gn, m.count, "-", "-", "-", "-", "-", "-"]);
        } else {
          data.push([i + 1, m.gn, m.count, fmt(m.avg, 2), m.max, m.min, fmt(m.std, 2),
            fmt(m.passRate * 100, 1) + "%", fmt(m.excRate * 100, 1) + "%"]);
        }
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...data]), `${classNo}_${subjectName}_统计`);

      const memberHeader = ["学号", "姓名", "小组", "角色", subjectName];
      const memberData = groups.map((g) => {
        const rec = nameToRec[g.studentName];
        return [g.studentId, g.studentName, g.groupName, g.isLeader ? "组长" : "组员", rec?.scores?.[subjectName] ?? "-"];
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([memberHeader, ...memberData]), `${classNo}_${subjectName}_明细`);
    });
  });

  if (wb.SheetNames.length > 0) {
    XLSX.writeFile(wb, `${grade}_${currentUser.name}_小组成绩分析_${exam.name}.xlsx`);
    showToast("分析报告已下载", "success");
  } else {
    showToast("暂无数据可下载", "warning");
  }
};

window.downloadGroupMemberList = function () {
  const grade = currentUser.grade;
  const mySubjects = currentUser.subjects || [];
  const filterClass = $("gs_class")?.value || "";

  let myClasses = [...new Set(DB.records.filter((r) => r.grade === grade && mySubjects.some((s) => r.scores && r.scores[s] != null)).map((r) => r.classNo))].sort();
  if (filterClass) myClasses = myClasses.filter((c) => c === filterClass);

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

    const header = ["小组名称", "组长", "组员人数", "组员名单"];
    const data = groupNames.map((gn) => {
      const members = groupMap[gn];
      const leader = members.find((m) => m.isLeader);
      const otherMembers = members.filter((m) => !m.isLeader).map((m) => m.studentName).join("、");
      return [gn, leader ? leader.studentName : "（未设置）", members.length, otherMembers];
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...data]), `${classNo}_小组名单`);

    const detailHeader = ["学号", "姓名", "小组", "角色"];
    const detailData = groups.map((g) => [g.studentId, g.studentName, g.groupName, g.isLeader ? "组长" : "组员"]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([detailHeader, ...detailData]), `${classNo}_详细名单`);
  });

  if (wb.SheetNames.length > 0) {
    XLSX.writeFile(wb, `${grade}_${currentUser.name}_学习小组名单.xlsx`);
    showToast("小组名单已下载", "success");
  } else {
    showToast("暂无小组数据", "warning");
  }
};

// ========== 任课教师：自定义分析 ==========
function renderCustomAnalysis() {
  const grade = currentUser.grade;
  const mySubjects = currentUser.subjects || [];
  const myClassNos = getTeacherClassNos(currentUser, grade);
  // 任课教师：显示年级统一考试 + 所教班级的自建考试
  const exams = getSortedExams(grade).filter((e) => {
    if (!e.isClassExam) return true;
    return myClassNos.some((c) => classNoEquals(e.classNo, c));
  });
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

// ========== 教务端：成绩审核 ==========
function renderScoreReview() {
  // 成绩审核功能已移除：上传成绩直接生效为已确认状态，无需复审
  $("pageContent").innerHTML = `
    <div class="card">
      <div class="card-title">✅ 成绩审核（已移除）</div>
      <div class="empty-state" style="padding:40px 20px">
        <div class="es-icon" style="font-size:48px">📋</div>
        <div class="es-title">成绩审核功能已移除</div>
        <div class="es-tip" style="margin:12px 0;max-width:520px">
          成绩上传后<b>直接生效</b>（自动设为已确认状态），其他端同步后即可查看。<br/>
          历史的「待审核/已确认」状态字段已废弃但保留兼容，所有上传成绩均自动确认。
        </div>
        <button class="btn btn-primary" onclick="navigate('academic_upload_scores')">前往按班级名单上传</button>
        <button class="btn btn-info" onclick="navigate('class_ranking')">查看全年级排名</button>
      </div>
    </div>
  `;
}

// 数据自检函数（保留：成绩审核已移除，但数据自检仍可用于上传后核对错误）
window.runDataCheck = function() {
  const grade = currentUser.grade;
  const subjects = DB.subjects[grade] || [];
  const examIds = [...new Set(DB.records.filter(r => r.grade === grade).map(r => r.examId))];
  
  const errors = [];
  const warnings = [];
  
  examIds.forEach(examId => {
    const exam = DB.exams.find(e => e.id === examId);
    const examName = exam ? exam.name : "未知考试";
    const recs = DB.records.filter(r => r.examId === examId && r.grade === grade);
    
    // 检查学生名单匹配
    const roster = DB.studentRoster?.[grade] || {};
    const allRosterStudents = [];
    Object.keys(roster).forEach(c => {
      roster[c].forEach(stu => allRosterStudents.push(`${c}|${stu.studentName}`));
    });
    
    // 检查每个记录
    recs.forEach(rec => {
      const key = `${rec.classNo}|${rec.studentName}`;
      
      // 检查是否在学生名单中
      if (allRosterStudents.length > 0 && !allRosterStudents.includes(key)) {
        errors.push(`❌ ${examName} - ${rec.classNo} ${rec.studentName}：不在学生名单中`);
      }
      
      // 检查分数是否合理
      subjects.forEach(subject => {
        const score = rec.scores[subject.name];
        if (score !== undefined && score !== null) {
          if (typeof score !== 'number' || isNaN(score)) {
            errors.push(`❌ ${examName} - ${rec.classNo} ${rec.studentName} ${subject.name}：分数不是有效数字`);
          } else if (score < 0) {
            errors.push(`❌ ${examName} - ${rec.classNo} ${rec.studentName} ${subject.name}：分数为负数 (${score})`);
          } else if (score > (subject.fullScore || 100)) {
            errors.push(`❌ ${examName} - ${rec.classNo} ${rec.studentName} ${subject.name}：分数超过满分 (${score}/${subject.fullScore})`);
          } else if (score > 100 && !subject.fullScore) {
            warnings.push(`⚠️ ${examName} - ${rec.classNo} ${rec.studentName} ${subject.name}：分数超过100分 (${score})`);
          }
        }
      });
      
      // 检查总分是否正确
      let calcTotal = 0;
      subjects.forEach(s => {
        if (typeof rec.scores[s.name] === 'number' && !isNaN(rec.scores[s.name])) {
          calcTotal += rec.scores[s.name];
        }
      });
      if (Math.abs(calcTotal - (rec.total || 0)) > 0.01) {
        errors.push(`❌ ${examName} - ${rec.classNo} ${rec.studentName}：总分计算错误 (计算值: ${calcTotal}, 存储值: ${rec.total})`);
      }
    });
    
    // 检查班级人数是否匹配
    const byClass = {};
    recs.forEach(r => {
      if (!byClass[r.classNo]) byClass[r.classNo] = [];
      byClass[r.classNo].push(r);
    });
    
    Object.keys(byClass).forEach(c => {
      const classRecs = byClass[c];
      const rosterCount = roster[c]?.length || 0;
      if (rosterCount > 0 && classRecs.length !== rosterCount) {
        warnings.push(`⚠️ ${examName} - ${c}：成绩人数(${classRecs.length})与名单人数(${rosterCount})不一致`);
      }
    });
  });
  
  const resultDiv = $("check_result");
  if (errors.length === 0 && warnings.length === 0) {
    resultDiv.innerHTML = `<div style="background:#e6f7ea;color:#1a7f37">✅ 数据自检通过，未发现错误！</div>`;
  } else {
    let html = "";
    if (errors.length > 0) {
      html += `<div style="color:#c0392b;margin-bottom:8px"><b>❌ 发现 ${errors.length} 个错误：</b></div>`;
      html += `<ul style="margin-left:20px;color:#c0392b">${errors.map(e => `<li>${e}</li>`).join("")}</ul>`;
    }
    if (warnings.length > 0) {
      html += `<div style="color:#f9a825;margin-bottom:8px;margin-top:12px"><b>⚠️ 发现 ${warnings.length} 个警告：</b></div>`;
      html += `<ul style="margin-left:20px;color:#f9a825">${warnings.map(w => `<li>${w}</li>`).join("")}</ul>`;
    }
    resultDiv.innerHTML = html;
  }
  resultDiv.style.display = "block";
};

// 确认所有待审核成绩
window.confirmAllScores = function() {
  const grade = currentUser.grade;
  const targets = DB.records.filter(r => r.grade === grade && r.status === "pending");
  
  if (targets.length === 0) {
    showToast("没有待审核的记录", "info");
    return;
  }
  
  showModal("确认所有待审核成绩", `<div>
    <p>将把全年级所有 <b style="color:#d35400">${targets.length}</b> 条待审核成绩全部确认为已审核。</p>
    <p style="color:#1a7f37;margin-top:8px">✅ 确认后，班主任和任课教师将能看到这些数据。</p>
  </div>`, "✓ 确认全部", () => {
    const now = Date.now();
    targets.forEach(r => {
      r.status = "confirmed";
      r.confirmedAt = now;
      r.confirmedBy = currentUser.id;
    });
    saveDB(DB);
    showToast(`已确认 ${targets.length} 条成绩`, "success");
    renderScoreReview();
  });
};

// 退回所有待审核成绩
window.rejectAllPendingScores = function() {
  const grade = currentUser.grade;
  const targets = DB.records.filter(r => r.grade === grade && r.status === "pending");
  
  if (targets.length === 0) {
    showToast("没有待审核的记录", "info");
    return;
  }
  
  showModal("⚠️ 退回所有待审核成绩", `<div>
    <p>将删除全年级所有 <b style="color:#c0392b">${targets.length}</b> 条待审核成绩记录。</p>
    <p style="color:#c0392b;margin-top:8px">⚠️ 删除后不可恢复，班主任需要重新上传。请谨慎操作。</p>
  </div>`, "🗑️ 确认退回", () => {
    DB.records = DB.records.filter(r => !(r.grade === grade && r.status === "pending"));
    saveDB(DB);
    showToast(`已退回 ${targets.length} 条记录`, "success");
    renderScoreReview();
  });
};

// 一键清空所有成绩数据
window.clearAllScores = function() {
  const grade = currentUser.grade;
  const targets = DB.records.filter(r => r.grade === grade);
  
  if (targets.length === 0) {
    showToast("没有成绩数据可清空", "info");
    return;
  }
  
  showModal("🗑️ 清空所有成绩数据", `<div>
    <p>将清空本年级 <b style="color:#c0392b">${targets.length}</b> 条成绩记录（包括已确认和待审核）。</p>
    <p style="color:#c0392b;margin-top:8px">⚠️ 此操作不可恢复！所有数据将被删除，班主任需要重新上传。</p>
    <p style="color:#c0392b;margin-top:8px">⚠️ 请确保已确认所有需要的数据后再执行此操作。</p>
  </div>`, "⚠️ 确认清空", () => {
    DB.records = DB.records.filter(r => r.grade !== grade);
    saveDB(DB);
    showToast(`已清空 ${targets.length} 条成绩记录`, "success");
    renderScoreReview();
  });
};

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
    saveDB(DB, examId);
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
  if (typeof refreshScoreReview === "function") refreshScoreReview();
};

// 退回单个学生成绩（删除记录）
window.rejectOneScore = function (recordId) {
  const record = DB.records.find((r) => r.id === recordId);
  if (!record) return;
  
  showModal("确认退回", `<div>
    <p>将<b style="color:#c0392b">删除</b>学生「${esc(record.studentName)}」的成绩记录。</p>
    <p style="color:#c0392b;margin-top:8px">⚠️ 删除后需要重新上传该学生成绩。</p>
  </div>`, "🗑️ 确认退回", () => {
    DB.records = DB.records.filter((r) => r.id !== recordId);
    saveDB(DB, record.examId);
    showToast(`已退回 ${record.studentName} 的成绩`, "success");
    if (typeof refreshScoreReview === "function") refreshScoreReview();
  });
};

// 一键退回某个班级的所有成绩
window.rejectClassScores = function (examId, classNo) {
  const exam = DB.exams.find((e) => e.id === examId);
  const grade = currentUser.grade;
  const target = DB.records.filter((r) => r.examId === examId && r.grade === grade && classNoEquals(r.classNo, classNo));
  if (target.length === 0) { showToast("没有可退回的记录", "info"); return; }

  showModal("确认退回班级", `<div>
    <p>将<b style="color:#c0392b">删除</b> <b>${esc(exam.name)}</b> 中 <b>${esc(classNo)}</b> 的 <b>${target.length}</b> 条成绩记录。</p>
    <p style="color:#c0392b;margin-top:8px">⚠️ 该班级班主任需要重新上传。</p>
  </div>`, "🗑️ 确认退回", () => {
    DB.records = DB.records.filter((r) => !(r.examId === examId && r.grade === grade && classNoEquals(r.classNo, classNo)));
    saveDB(DB, examId);
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
    r.examId === examId && r.grade === grade && classNoEquals(r.classNo, classNo) && r.status === "pending");
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
    saveDB(DB, record.examId);
    showToast("成绩已修改", "success");
    refreshScoreReview();
  });
};

window.deleteReviewScore = function (recordId) {
  const record = DB.records.find((r) => r.id === recordId);
  showModal("确认删除", "<p>确定要删除该学生的成绩记录吗？</p>", "删除", () => {
    DB.records = DB.records.filter((r) => r.id !== recordId);
    saveDB(DB, record?.examId);
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
  .ca-field label { font-weight: 600; color: var(--text); white-space: nowrap; }
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

// ========== 智能教务助手 ==========
let _eaMessages = [];
let _eaContext = {
  lastSubject: null,
  lastClass: null,
  lastTopic: null,
  lastStudent: null,
  lastIntent: null,
  lastAnswerData: null
};

function toggleEduAssistant() {
  const panel = $("eduAssistant");
  const btn = $("eduAssistantBtn");
  if (panel.classList.contains("hidden")) {
    panel.classList.remove("hidden");
    btn.style.display = "none";
    updateEaWelcome();
  } else {
    panel.classList.add("hidden");
    btn.style.display = "flex";
  }
}

function updateEaWelcome() {
  const body = $("eaBody");
  const welcome = body.querySelector(".ea-welcome");
  if (!welcome) return;
  let examName = "本次考试";
  const examId = window._eaCurrentExamId;
  if (examId && DB && DB.exams) {
    const exam = DB.exams.find((e) => e.id === examId);
    if (exam) examName = exam.name;
  }
  const descEl = $("eaWelcomeDesc");
  if (descEl) {
    descEl.innerHTML = `正在分析「<b>${esc(examName)}</b>」的成绩数据，随时为您解答～`;
  }
  const groupsEl = $("eaQuickGroups");
  if (!groupsEl) return;

  const groups = [
    {
      title: "📊 成绩概览",
      items: [
        "年级总分均分是多少？",
        "各科目排名情况",
        "优秀率最高的学科",
        "低分率最高的科目"
      ]
    },
    {
      title: "🏫 班级对比",
      items: [
        "哪个班成绩最好？",
        "各班均分排名",
        "班级差距大吗？",
        "各班及格率对比"
      ]
    },
    {
      title: "👨‍🎓 学生情况",
      items: [
        "需要关注的学生",
        "偏科的学生有哪些？",
        "进步最大的学生",
        "退步明显的学生"
      ]
    },
    {
      title: "💡 分析建议",
      items: [
        "整体成绩怎么样？",
        "有哪些薄弱学科？",
        "给我一些教学建议",
        "成绩分化严重吗？"
      ]
    }
  ];

  groupsEl.innerHTML = groups.map((g) => `
    <div class="ea-quick-group-title">${g.title}</div>
    <div class="ea-quick-items">
      ${g.items.map((q) => `<div class="ea-quick-item" onclick="askAssistant('${q.replace(/'/g, "\\'")}')">${q}</div>`).join("")}
    </div>
  `).join("");
}

function handleAssistantInput(e) {
  if (e.key === "Enter") {
    sendAssistantMessage();
  }
}

function askAssistant(question) {
  $("eaInput").value = question;
  sendAssistantMessage();
}

function sendAssistantMessage() {
  const input = $("eaInput");
  const msg = input.value.trim();
  if (!msg) return;
  input.value = "";

  // 添加用户消息
  addEaMessage("user", msg);

  // 显示正在输入
  showEaTyping();

  // 模拟延迟后回复
  setTimeout(() => {
    removeEaTyping();
    const answer = generateEaAnswer(msg);
    addEaMessage("assistant", answer);
  }, 800 + Math.random() * 500);
}

function addEaMessage(role, content) {
  const body = $("eaBody");
  const welcome = body.querySelector(".ea-welcome");
  if (welcome) welcome.remove();

  _eaMessages.push({ role, content });

  const userSvg = `<svg viewBox="0 0 64 64" width="18" height="18">
    <circle cx="32" cy="26" r="12" fill="#6366f1"/>
    <path d="M12 56 Q32 38 52 56 L52 60 L12 60 Z" fill="#6366f1"/>
  </svg>`;
  const assSvg = `<svg viewBox="0 0 64 64" width="18" height="18">
    <circle cx="32" cy="26" r="12" fill="#6366f1"/>
    <path d="M12 56 Q32 38 52 56 L52 60 L12 60 Z" fill="#6366f1"/>
  </svg>`;

  const div = document.createElement("div");
  div.className = `ea-message ${role}`;
  div.innerHTML = `
    <div class="ea-msg-avatar">${role === "user" ? userSvg : assSvg}</div>
    <div class="ea-msg-content">${formatEaContent(content)}</div>
  `;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
}

function showEaTyping() {
  const body = $("eaBody");
  const div = document.createElement("div");
  div.className = "ea-typing";
  div.id = "ea_typing";
  div.innerHTML = `
    <div class="ea-msg-avatar">
      <svg viewBox="0 0 64 64" width="18" height="18">
        <circle cx="32" cy="26" r="12" fill="#6366f1"/>
        <path d="M12 56 Q32 38 52 56 L52 60 L12 60 Z" fill="#6366f1"/>
      </svg>
    </div>
    <div class="ea-typing-indicator">
      <span></span><span></span><span></span>
    </div>
  `;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
}

function removeEaTyping() {
  const typing = $("ea_typing");
  if (typing) typing.remove();
}

function formatEaContent(content) {
  return content
    .replace(/\n/g, "<br>")
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>");
}

function generateEaAnswer(question) {
  const rawQ = question.trim();
  const qLow = rawQ.toLowerCase();

  const grade = currentUser?.grade;
  if (!grade) {
    return eaResp("系统提示", "请先登录系统后再使用智能助手。");
  }

  const greeting = checkGreeting(qLow);
  if (greeting) return greeting;

  const thanks = checkThanks(qLow);
  if (thanks) return thanks;

  const goodbye = checkGoodbye(qLow);
  if (goodbye) return goodbye;

  let exams = getSortedExams(grade);
  if (currentUser.role === "academic") {
    exams = exams.filter((e) => !e.isClassExam);
  } else if (currentUser.role === "headteacher") {
    exams = getHeadteacherExams(grade, currentUser.classNo).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  } else if (currentUser.role === "teacher") {
    const myClassNos = getTeacherClassNos(currentUser, grade);
    exams = exams.filter((e) => {
      if (!e.isClassExam) return true;
      return myClassNos.some((c) => classNoEquals(e.classNo, c));
    });
  }
  if (exams.length === 0) {
    return eaResp("系统提示", "目前暂无考试数据，请先上传成绩后再进行咨询。");
  }

  let selectedExam = null;
  const currentExamId = window._eaCurrentExamId;
  if (currentExamId) {
    selectedExam = exams.find((e) => e.id === currentExamId);
  }
  if (!selectedExam) selectedExam = exams[exams.length - 1];
  const subjects = getExamSubjects(selectedExam.id);
  const allRecs = DB.records.filter((r) => r.examId === selectedExam.id && r.grade === grade);

  if (allRecs.length === 0) {
    return eaResp("系统提示", `当前选择的「${selectedExam.name}」暂无成绩数据。`);
  }

  const stats = aggregateStats(allRecs, subjects);
  const totalFullScore = subjects.reduce((s, x) => s + x.fullScore, 0);
  const totalStats = stats["总分"];

  const enhanced = enhanceQuestionWithContext(qLow, subjects, allRecs);
  const q = normalizeQuestion(enhanced.q);

  const help = checkHelp(qLow, q);
  if (help) return help;

  const uploadHelp = checkUploadHelp(qLow, q);
  if (uploadHelp) return uploadHelp;

  let qSubject = extractSubject(q, subjects);
  let qClass = extractClass(q, allRecs);
  let qStudent = extractStudent(q, allRecs);

  if (!qSubject && enhanced.subject) qSubject = enhanced.subject;
  if (!qClass && enhanced.classNo) qClass = enhanced.classNo;
  if (!qStudent && enhanced.student) qStudent = enhanced.student;

  if (qSubject) _eaContext.lastSubject = qSubject;
  if (qClass) _eaContext.lastClass = qClass;
  if (qStudent) _eaContext.lastStudent = qStudent;

  const followupDetail = checkFollowupDetail(qLow, q);
  if (followupDetail && _eaContext.lastIntent) {
    const lastIntent = _eaContext.lastIntent;
    const deepIntents = {
      rate: "distribution",
      subject: "stddev",
      overview: "suggestion",
      avg: "distribution",
      classRank: "stddev",
      distribution: "suggestion",
      student: "suggestion",
      topBottom: "student",
      stddev: "suggestion",
      trend: "suggestion"
    };
    const nextIntent = deepIntents[lastIntent] || "suggestion";
    _eaContext.lastIntent = nextIntent;
    const ctx = { q, qLow: q, rawQ, subjects, stats, allRecs, totalFullScore, totalStats,
                  exams, selectedExam, grade, qSubject, qClass, qStudent };
    const answer = generateAnswerByIntent(nextIntent, ctx);
    return appendFollowupSuggestions(answer, nextIntent, ctx);
  }

  const scores = computeIntentScores(q, rawQ, subjects, allRecs, exams.length);

  let maxScore = 0, maxIntent = "overview";
  for (const [intent, score] of Object.entries(scores)) {
    if (score > maxScore) { maxScore = score; maxIntent = intent; }
  }

  if (maxScore < 0.3) {
    const fallbackIntent = fuzzyMatchFallback(q, qLow, subjects);
    if (fallbackIntent) { maxIntent = fallbackIntent; maxScore = 0.4; }
  }

  if (enhanced.isFollowup && _eaContext.lastIntent && maxScore < 0.5) {
    maxIntent = _eaContext.lastIntent;
  }

  _eaContext.lastTopic = maxIntent;
  _eaContext.lastIntent = maxIntent;

  const ctx = { q, qLow: q, rawQ, subjects, stats, allRecs, totalFullScore, totalStats,
                exams, selectedExam, grade, qSubject, qClass, qStudent };

  const clarification = checkClarificationNeeded(maxIntent, maxScore, ctx);
  if (clarification) return clarification;

  const answer = generateAnswerByIntent(maxIntent, ctx);
  return appendFollowupSuggestions(answer, maxIntent, ctx);
}

function generateAnswerByIntent(intent, ctx) {
  switch (intent) {
    case "rate":        return generateRateAnswer(ctx);
    case "classRank":   return generateClassRankingAnswer(ctx);
    case "student":     return generateStudentAnswer(ctx);
    case "subject":     return generateSubjectAnswer(ctx);
    case "avg":         return generateAvgScoreAnswer(ctx);
    case "distribution":return generateDistributionAnswer(ctx);
    case "overview":    return generateOverviewAnswer(ctx);
    case "trend":       return generateTrendAnswer(ctx);
    case "stddev":      return generateStdDevAnswer(ctx);
    case "topBottom":   return generateTopBottomAnswer(ctx);
    case "suggestion":  return generateSuggestionAnswer(ctx);
    case "compare":     return generateCompareAnswer(ctx);
    case "query":       return generateQueryAnswer(ctx);
    case "fallback":    return generateFallbackAnswer(ctx);
    default:            return generateDefaultAnswer(ctx);
  }
}

// ========== 辅助工具 ==========
function eaResp(title, html) {
  return `<div class="emc-title">${title}</div>${html}`;
}

function extractSubject(q, subjects) {
  for (const s of subjects) {
    if (q.includes(s.name)) return s.name;
  }
  return null;
}

function extractClass(q, allRecs) {
  const classList = [...new Set(allRecs.map(r => r.classNo))];
  const m = q.match(/(?:\d+)[班班级]/);
  if (m) {
    const c = m[0].replace(/[班班级]/g, "");
    if (classList.includes(c)) return c;
  }
  for (const c of classList) {
    if (q.includes(c + "班") || q.includes(c + "班级")) return c;
  }
  return null;
}

function extractStudent(q, allRecs) {
  const nameList = allRecs.map(r => r.studentName);
  for (const n of nameList) {
    if (q.includes(n)) return n;
  }
  return null;
}

// ========== 寒暄/简单对话检测 ==========
function checkGreeting(qLow) {
  const greetings = [
    "你好", "您好", "hi", "hello", "嗨", "哈喽",
    "在吗", "在不在", "有人吗", "在么",
    "早上好", "上午好", "中午好", "下午好", "晚上好"
  ];
  const q = qLow.replace(/[？?。，！!,.!~\s]/g, "");
  for (const g of greetings) {
    if (q === g || q.startsWith(g) && q.length <= g.length + 3) {
      const responses = [
        "👋 您好呀！我是教务智能助手，随时为您分析考试数据～有什么想了解的吗？",
        "😊 您好！很高兴为您服务，可以问我关于成绩分析的任何问题哦！",
        "✨ 嗨～我在呢！想了解哪方面的考试分析呀？",
        "🎯 您好！正在为您待命，想查什么直接说就好～"
      ];
      return responses[Math.floor(Math.random() * responses.length)];
    }
  }
  return null;
}

function checkThanks(qLow) {
  const thanks = [
    "谢谢", "感谢", "多谢", "谢了", "谢谢你", "感谢你",
    "非常感谢", "十分感谢", "谢谢啦", "谢谢哈", "3q", "thx", "thanks"
  ];
  const q = qLow.replace(/[？?。，！!,.!~\s]/g, "");
  for (const t of thanks) {
    if (q.includes(t)) {
      const responses = [
        "😊 不客气～能帮到您我也很开心！还有其他想了解的吗？",
        "✨ 不用谢～随时为您服务！还有问题尽管问哦～",
        "🎯 应该的！数据在手，教学无忧～还有啥想查的？",
        "💪 不客气～需要分析其他数据随时叫我！"
      ];
      return responses[Math.floor(Math.random() * responses.length)];
    }
  }
  return null;
}

function checkGoodbye(qLow) {
  const goodbyes = [
    "再见", "拜拜", "bye", "goodbye", "拜拜啦",
    "下次见", "回头见", "走了", "下线了", "休息了"
  ];
  const q = qLow.replace(/[？?。，！!,.!~\s]/g, "");
  for (const g of goodbyes) {
    if (q === g || q.startsWith(g) && q.length <= g.length + 3) {
      const responses = [
        "👋 再见～有需要随时回来找我哦！",
        "😊 好的，下次见！祝您工作顺利～",
        "✨ 拜拜～期待下次为您分析数据！",
        "🎯 再见啦～有新的考试数据记得来分析哦！"
      ];
      return responses[Math.floor(Math.random() * responses.length)];
    }
  }
  return null;
}

// ========== 帮助/能力介绍检测 ==========
function checkHelp(qLow, q) {
  const helpKw = [
    "你能做什么", "你会什么", "你有什么用", "你的功能",
    "能干嘛", "能干啥", "可以做什么", "会什么",
    "帮助", "help", "怎么用", "使用说明",
    "介绍一下自己", "介绍自己", "你是谁"
  ];
  for (const kw of helpKw) {
    if (q.includes(kw) || qLow.includes(kw)) {
      return eaResp("🤖 我能帮您做什么？", `
        <p>我是您的<strong>教务智能助手</strong>，专为考试成绩分析服务～</p>
        <div class="emc-highlight">
          <b>📊 成绩统计</b><br>
          平均分、优秀率、及格率、良好率、低分率、分数段分布<br><br>
          <b>🏆 排名对比</b><br>
          班级排名、科目排名、学生排名、进退步对比<br><br>
          <b>👨‍🎓 学生关注</b><br>
          偏科生、后进生、优秀生、临界生识别<br><br>
          <b>📚 学科分析</b><br>
          优势学科、薄弱学科、学科间对比<br><br>
          <b>💡 教学建议</b><br>
          基于数据自动生成教学改进建议
        </div>
        <p>💬 <b>对话小技巧：</b></p>
        <ul class="emc-list">
          <li>可以直接说科目名 + 问题，如"数学优秀率"</li>
          <li>支持追问"再详细讲讲"、"换个角度"</li>
          <li>可以用"它"、"那"等指代上文内容</li>
          <li>问我"怎么上传成绩"了解上传方式</li>
        </ul>
      `);
    }
  }
  return null;
}

// ========== 上传方式说明检测 ==========
function checkUploadHelp(qLow, q) {
  const uploadKw = [
    "怎么上传", "如何上传", "上传方式", "上传方法", "上传流程",
    "上传成绩", "怎么导入", "如何导入", "怎么录成绩",
    "考场名单", "班级名单", "上传步骤"
  ];
  for (const kw of uploadKw) {
    if (q.includes(kw) || qLow.includes(kw)) {
      return eaResp("📤 成绩上传方式", `
        <p>目前系统支持<b>两种上传方式</b>：</p>
        <div class="emc-highlight">
          <b>📥 按班级名单上传全年级</b><br>
          Excel 表头：学号（可留空）、姓名、班级、各科分数<br>
          适合按班级整理的成绩表，支持多科目批量上传<br><br>
          <b>🏫 按考场名单上传全年级</b><br>
          Excel 表头：考号、姓名、科目分数列<br>
          系统自动从考号解析考场号、座位号、班级和序号<br>
          适合按考场整理的成绩表，科目列自动识别
        </div>
        <p>💡 <b>共同特点：</b></p>
        <ul class="emc-list">
          <li>上传后成绩直接生效，无需审核</li>
          <li>支持批量上传多个不同科目的文件</li>
          <li>跨文件同学生自动合并分数</li>
          <li>可删除已上传的错误成绩</li>
        </ul>
      `);
    }
  }
  return null;
}

// ========== 深度追问检测 ==========
function checkFollowupDetail(qLow, q) {
  const detailKw = [
    "再详细", "详细讲讲", "详细说", "再说说", "再讲讲",
    "深入", "深入分析", "更深入", "深一点",
    "换个角度", "换个方式", "从其他角度",
    "还有呢", "还有什么", "还有哪些", "然后呢",
    "具体点", "具体说说", "具体分析"
  ];
  for (const kw of detailKw) {
    if (q.includes(kw) || qLow.includes(kw)) return true;
  }
  return false;
}

// ========== 回答后追加相关问题推荐 ==========
function appendFollowupSuggestions(answer, intent, ctx) {
  const { subjects, qSubject, qClass, qStudent } = ctx;
  const suggestions = getFollowupSuggestions(intent, ctx);
  if (suggestions.length === 0) return answer;

  const html = suggestions.slice(0, 3).map((s) =>
    `<button class="ea-followup-btn" onclick="askAssistant('${s.replace(/'/g, "\\'")}')">${s}</button>`
  ).join("");

  return answer + `<div class="ea-followup"><div class="ea-followup-title">💡 您可能还想了解：</div><div class="ea-followup-items">${html}</div></div>`;
}

function getFollowupSuggestions(intent, ctx) {
  const { subjects, qSubject, qClass, qStudent, allRecs } = ctx;
  const suggestions = [];

  const classList = [...new Set(allRecs.map(r => r.classNo))].sort();
  const sampleSubject = subjects[0]?.name || "语文";
  const sampleClass = classList[0] || "1班";

  switch (intent) {
    case "overview":
      suggestions.push("各科目的优秀率是多少？");
      suggestions.push("哪个班成绩最好？");
      suggestions.push("有什么教学建议？");
      break;
    case "rate":
      if (qSubject) {
        suggestions.push(`${qSubject}的均分是多少？`);
        suggestions.push(`${qSubject}成绩分布怎么样？`);
        suggestions.push(`${qSubject}有什么教学建议？`);
      } else {
        suggestions.push("各科目均分排名");
        suggestions.push("成绩分布情况");
        suggestions.push("哪个班及格率最高？");
      }
      break;
    case "subject":
      if (qSubject) {
        suggestions.push(`${qSubject}的优秀率是多少？`);
        suggestions.push(`${qSubject}的前10名是谁？`);
        suggestions.push(`${qSubject}教学建议`);
      } else {
        suggestions.push(`${sampleSubject}学科详细分析`);
        suggestions.push("各科目的及格率对比");
        suggestions.push("薄弱学科是哪些？");
      }
      break;
    case "avg":
      if (qSubject) {
        suggestions.push(`${qSubject}的优秀率`);
        suggestions.push(`${qSubject}成绩分布`);
        suggestions.push(`${qSubject}前10名`);
      } else {
        suggestions.push("总分均分是多少？");
        suggestions.push("哪个班均分最高？");
        suggestions.push("各科得分率排名");
      }
      break;
    case "classRank":
      suggestions.push(`${sampleClass}班成绩怎么样？`);
      suggestions.push("各班及格率对比");
      suggestions.push("班级差距大吗？");
      break;
    case "student":
      if (qStudent) {
        suggestions.push(`${qStudent}的年级排名？`);
        suggestions.push(`${qStudent}偏科吗？`);
        suggestions.push("还有哪些需要关注的学生？");
      } else {
        suggestions.push("偏科的学生有哪些？");
        suggestions.push("不及格的学生有哪些？");
        suggestions.push("进步最大的学生");
      }
      break;
    case "distribution":
      suggestions.push("标准差是多少？");
      suggestions.push("有什么教学建议？");
      suggestions.push("前20名有哪些人？");
      break;
    case "stddev":
      suggestions.push("成绩分布情况");
      suggestions.push("有什么教学建议？");
      suggestions.push("哪个班分化最严重？");
      break;
    case "suggestion":
      suggestions.push("整体成绩怎么样？");
      suggestions.push("薄弱学科有哪些？");
      suggestions.push("需要关注的学生");
      break;
    case "topBottom":
      suggestions.push("成绩分布怎么样？");
      suggestions.push("有偏科的学生吗？");
      suggestions.push("教学建议");
      break;
    case "trend":
      suggestions.push("进步最大的学生是谁？");
      suggestions.push("退步明显的有哪些？");
      suggestions.push("整体成绩在提升吗？");
      break;
    case "compare":
      suggestions.push("各科得分率排名");
      suggestions.push("哪个班成绩最好？");
      suggestions.push("教学建议");
      break;
    case "query":
      if (qStudent) {
        suggestions.push(`${qStudent}在年级排第几？`);
        suggestions.push(`${qStudent}有偏科吗？`);
        suggestions.push("还有其他学生要查吗？");
      } else if (qClass) {
        suggestions.push(`${qClass}班前10名`);
        suggestions.push(`${qClass}班和其他班比怎么样？`);
        suggestions.push(`${qClass}班的及格率`);
      }
      break;
    default:
      suggestions.push("整体成绩怎么样？");
      suggestions.push("各科目的排名");
      suggestions.push("有什么教学建议？");
  }

  return suggestions;
}

// ========== 口语化问题标准化 ==========
function normalizeQuestion(qLow) {
  let q = qLow
    .replace(/[？?。，！!,.!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const patterns = [
    [/各科|每个科目|每门课|各门学科/, "各科目"],
    [/哪科|哪门课|哪一科|啥科目|什么科目/, "哪门科目"],
    [/成绩单|得分|分数/, "成绩"],
    [/这次|本次|这回|这次考试|这一次/, "本次考试"],
    [/班级均分|班均分|平均分/, "班级均分"],
    [/年级总|年级分|年级整体|全年级/, "年级总分"],
    [/进步了|进步吗|进步情况|进步如何|有没有进步/, "进步"],
    [/退步了|退步吗|退步情况|退步如何|有没有退步/, "退步"],
    [/怎么|怎么样|如何|咋样|咋的|行不行|好不好|不错吗/, "如何"],
    [/有哪些|有什么|有没有|哪些是/, "哪些"],
    [/告诉|说下|说说|给我看|看下|看看|查一下|查下/, "告诉"],
    [/班级之间|各班级|各班之间/, "班级对比"],
    [/分化情况|分化程度|两极分化/, "分化"],
    [/不稳定|不均衡|不均匀/, "不均衡"],
    [/多少人|几个人|几人|有多少/, "多少人"],
    [/最牛|最厉害|最棒|最好的|最强的/, "最好"],
    [/最差的|最弱的|最烂|最差劲/, "最差"],
    [/排第几|名次|排名多少/, "排名"],
    [/对比一下|比一比|比较一下/, "对比"],
    [/咋办|怎么办|怎么搞|怎么弄/, "怎么办"],
    [/为啥|为什么|原因/, "为什么"],
    [/建议|意见|办法|方法/, "建议"],
  ];

  patterns.forEach(([from, to]) => { q = q.replace(from, to); });
  return q;
}

// ========== 追问上下文补全 ==========
function enhanceQuestionWithContext(qLow, subjects, allRecs) {
  let q = qLow;
  let isFollowup = false;
  let subject = null;
  let classNo = null;
  let student = null;

  const followupMarkers = ["那", "那么", "它", "这个", "那个", "呢", "还有", "再说", "继续", "然后", "接着"];
  for (const m of followupMarkers) {
    if (q.startsWith(m) || q.includes(m + " ")) {
      isFollowup = true;
      break;
    }
  }
  if (q.trim() === "呢" || q.trim().endsWith("呢？") || q.trim().endsWith("呢?")) {
    isFollowup = true;
  }

  if (isFollowup) {
    if (_eaContext.lastSubject) subject = _eaContext.lastSubject;
    if (_eaContext.lastClass) classNo = _eaContext.lastClass;
    if (_eaContext.lastStudent) student = _eaContext.lastStudent;
  }

  if (q.includes("最差") || q.includes("最低") || q.includes("最弱") || q.includes("倒数") || q.includes("垫底")) {
    if (!subject && _eaContext.lastSubject) subject = _eaContext.lastSubject;
    if (!classNo && _eaContext.lastClass) classNo = _eaContext.lastClass;
  }
  if (q.includes("最好") || q.includes("最高") || q.includes("最强") || q.includes("第一") || q.includes("榜首")) {
    if (!subject && _eaContext.lastSubject) subject = _eaContext.lastSubject;
    if (!classNo && _eaContext.lastClass) classNo = _eaContext.lastClass;
  }

  return { q, isFollowup, subject, classNo, student };
}

// ========== 主动澄清检测 ==========
function checkClarificationNeeded(intent, score, ctx) {
  const { q, subjects, allRecs, qSubject, qClass, qStudent, rawQ } = ctx;
  const classList = [...new Set(allRecs.map(r => r.classNo))].sort();
  const studentList = [...new Set(allRecs.map(r => r.studentName))];

  const clarificationBtns = (options, type) => options.map((opt) =>
    `<button class="ea-quick-item" style="display:inline-block;margin:3px;padding:5px 10px;font-size:11px;" onclick="askAssistant('${type === 'subject' ? opt + '成绩怎么样' : type === 'class' ? opt + '班成绩怎么样' : opt + '成绩怎么样'}')">${opt}</button>`
  ).join("");

  if (intent === "rate" && !qSubject && subjects.length > 0) {
    if (score < 0.6 && q.includes("率")) {
      const top3 = subjects.slice(0, 3).map(s => s.name);
      return eaResp("🤔 您想了解哪科？",
        `<div class="emc-tip">您提到了比率数据，但没有指定学科～</div>
         <div style="margin-top:8px">${clarificationBtns(top3, "subject")}</div>`);
    }
  }

  if (intent === "subject" && !qSubject && subjects.length > 0) {
    if (score < 0.5) {
      const top3 = subjects.slice(0, 3).map(s => s.name);
      return eaResp("🤔 您想看哪科？",
        `<div class="emc-tip">选一个学科，我给您详细分析～</div>
         <div style="margin-top:8px">${clarificationBtns(top3, "subject")}</div>`);
    }
  }

  if (intent === "query" && !qStudent && !qSubject && !qClass) {
    if (score < 0.5 && rawQ.length < 4) {
      return eaResp("🤔 您是想了解？",
        `<div class="emc-tip">可以告诉我学科名、班级或学生姓名，我来帮您查～</div>
         <div style="margin-top:8px">
           <div style="font-size:11px;color:var(--text-light);margin-bottom:4px">试试这些：</div>
           ${clarificationBtns(subjects.slice(0, 3).map(s => s.name), "subject")}
         </div>`);
    }
  }

  return null;
}

// ========== 宽松兜底匹配 ==========
function fuzzyMatchFallback(q, qLow, subjects) {
  for (const s of subjects) {
    if (qLow.includes(s.name)) return "subject";
  }
  if (qLow.match(/\d+班/)) return "classRank";
  if (qLow.match(/^[一-龥]{2,4}$/)) return "query";
  if (qLow.includes("怎么样") || qLow.includes("如何") || qLow.includes("好吗")) return "overview";
  return null;
}

// ========== 辅助工具 ==========
function eaResp(title, html) {
  return `<div class="emc-title">${title}</div>${html}`;
}

function extractSubject(q, subjects) {
  for (const s of subjects) {
    if (q.includes(s.name)) return s.name;
  }
  const shortNames = subjects.map(s => s.name.substring(0, 2));
  for (const s of shortNames) {
    if (q.includes(s)) {
      const full = subjects.find(sub => sub.name.includes(s));
      if (full) return full.name;
    }
  }
  return null;
}

function extractClass(q, allRecs) {
  const classList = [...new Set(allRecs.map(r => r.classNo))].sort();
  const m = q.match(/(\d+)班/);
  if (m && classList.includes(m[1])) return m[1];
  for (const c of classList) {
    if (q.includes(c + "班") || q.includes(c + "班级")) return c;
  }
  return null;
}

function extractStudent(q, allRecs) {
  const nameList = [...new Set(allRecs.map(r => r.studentName))].sort((a, b) => b.length - a.length);
  for (const n of nameList) {
    if (q.includes(n)) return n;
  }
  return null;
}

function computeIntentScores(q, rawQ, subjects, allRecs, examCount) {
  const s = {};
  const intents = ["overview","rate","classRank","student","subject","avg","distribution","trend","stddev","topBottom","suggestion","compare","query"];
  intents.forEach(k => s[k] = 0);

  // 成绩率类（高分权重）
  const rateKw = [
    ["优秀率", 0.9], ["良好率", 0.9], ["及格率", 0.9], ["不及格率", 0.9],
    ["达标率", 0.8], ["通过率", 0.7], ["低分率", 0.7],
    ["优秀多少", 0.85], ["及格多少", 0.85], ["有多少人优秀", 0.9], ["有多少人及格", 0.9],
    ["优秀学生有多少", 0.9], ["不及格学生有多少", 0.9],
  ];
  rateKw.forEach(([kw, w]) => { if (q.includes(kw)) s.rate += w; });

  // 班级排名类
  const classRankKw = [
    ["班级排名", 0.95], ["班排名", 0.95], ["各班排名", 0.95], ["班级总分排名", 0.95],
    ["哪个班最好", 0.95], ["哪个班最差", 0.95], ["哪个班最强", 0.95], ["哪个班最弱", 0.95],
    ["班级均分", 0.9], ["班均分", 0.9], ["班级比较", 0.85], ["班级对比", 0.85],
    ["班级成绩排名", 0.95], ["各班级成绩", 0.85],
    ["哪个班高", 0.85], ["哪个班低", 0.85], ["哪班最强", 0.9],
  ];
  classRankKw.forEach(([kw, w]) => { if (q.includes(kw)) s.classRank += w; });
  if (q.includes("班级") && (q.includes("最高") || q.includes("最低") || q.includes("最好") || q.includes("最差") || q.includes("第一") || q.includes("倒数"))) s.classRank += 0.85;
  if (q.match(/\d班成绩/) || q.match(/\d班级成绩/)) s.classRank += 0.8;

  // 学生关注类
  const studentKw = [
    ["学生", 0.6], ["同学", 0.5], ["哪些人", 0.75], ["哪些学生", 0.8],
    ["需要关注", 0.9], ["重点关注", 0.9], ["关注学生", 0.85],
    ["偏科", 0.95], ["瘸腿", 0.95], ["两极分化", 0.9],
    ["不及格学生", 0.9], ["不及格的同学", 0.9],
    ["差生", 0.75], ["后进生", 0.8], ["学困生", 0.85],
    ["优秀生", 0.65], ["优等生", 0.65],
    ["潜力生", 0.7], ["临界生", 0.75],
  ];
  studentKw.forEach(([kw, w]) => { if (q.includes(kw)) s.student += w; });
  if (q.includes("进步") || q.includes("退步")) { s.student += 0.4; s.trend += 0.6; }

  // 科目分析类
  const subjectKw = [
    ["科目分析", 0.95], ["学科分析", 0.95], ["科目诊断", 0.95],
    ["优势学科", 0.95], ["薄弱学科", 0.95], ["最强科目", 0.95], ["最弱科目", 0.95],
    ["科目排名", 0.9], ["学科排名", 0.9], ["科目对比", 0.85], ["学科对比", 0.85],
    ["哪门课", 0.85], ["哪科", 0.85], ["哪门科目", 0.9],
    ["科目成绩", 0.8], ["学科成绩", 0.8],
    ["考得最好", 0.9], ["考得最差", 0.9], ["科目情况", 0.8],
  ];
  subjectKw.forEach(([kw, w]) => { if (q.includes(kw)) s.subject += w; });
  if (extractSubject(rawQ, subjects) && s.rate < 0.5 && s.avg < 0.5) s.subject += 0.7;

  // 均分/分数类
  const avgKw = [
    ["平均分", 0.85], ["均分", 0.85], ["平均成绩", 0.85],
    ["总分均分", 0.9], ["各科均分", 0.9], ["科目均分", 0.9],
    ["最高分", 0.85], ["最低分", 0.85], ["最高成绩", 0.85], ["最低成绩", 0.85],
    ["总分多少", 0.8], ["总分几分", 0.8],
  ];
  avgKw.forEach(([kw, w]) => { if (q.includes(kw)) s.avg += w; });
  if (q.includes("多少分") && !extractStudent(rawQ, subjects)) s.avg += 0.5;
  if (extractStudent(rawQ, allRecs) && (q.includes("多少分") || q.includes("几分"))) { s.query += 0.95; s.avg = 0; }

  // 分布分析类
  const distKw = [
    ["分布", 0.9], ["分段", 0.85], ["分数段", 0.9], ["分段人数", 0.9],
    ["分布情况", 0.9], ["直方图", 0.85],
    ["多少人", 0.5],
  ];
  distKw.forEach(([kw, w]) => { if (q.includes(kw)) s.distribution += w; });

  // 趋势/进退步类
  if (examCount >= 2) {
    const trendKw = [
      ["进步", 0.9], ["退步", 0.9], ["进退步", 0.95],
      ["变化", 0.8], ["对比", 0.75], ["相比", 0.8],
      ["和上次", 0.95], ["上次比", 0.9], ["同比", 0.85],
      ["提高", 0.75], ["下降", 0.75], ["提升", 0.75],
    ];
    trendKw.forEach(([kw, w]) => { if (q.includes(kw)) s.trend += w; });
  }

  // 标准差/离散度
  const stdKw = [
    ["标准差", 0.95], ["方差", 0.9], ["离散", 0.9],
    ["差距", 0.75], ["悬殊", 0.9], ["两极分化", 0.9],
    ["分化程度", 0.9], ["分化情况", 0.85], ["不均衡", 0.8],
  ];
  stdKw.forEach(([kw, w]) => { if (q.includes(kw)) s.stddev += w; });

  // 前后排名类
  const tbKw = [
    ["前10", 0.95], ["前20", 0.95], ["前30", 0.95], ["前50", 0.95],
    ["后10", 0.95], ["后20", 0.95], ["后30", 0.95], ["后50", 0.95],
    ["倒数", 0.95], ["倒数第", 0.95],
    ["排名前", 0.9], ["排名后", 0.9],
    ["前十", 0.95], ["后十", 0.95],
    ["前几名", 0.9], ["后几名", 0.9],
    ["第1名", 0.95], ["第一名", 0.95], ["最后一名", 0.95],
    ["榜首", 0.95], ["垫底", 0.95],
  ];
  tbKw.forEach(([kw, w]) => { if (q.includes(kw)) s.topBottom += w; });

  // 教学建议类
  const sugKw = [
    ["建议", 0.85], ["怎么提升", 0.95], ["怎么改善", 0.95],
    ["怎么办", 0.8], ["措施", 0.9], ["策略", 0.9], ["对策", 0.9],
    ["教学建议", 0.95], ["改进", 0.85], ["提升方法", 0.95],
    ["如何提高", 0.95], ["怎样提升", 0.95], ["如何改善", 0.95],
    ["帮扶", 0.85], ["补救", 0.85],
  ];
  sugKw.forEach(([kw, w]) => { if (q.includes(kw)) s.suggestion += w; });

  // 对比类
  const twoSubjects = subjects.filter((sub, i) => {
    const others = subjects.slice(i + 1);
    return others.some(o => q.includes(sub.name) && q.includes(o.name));
  });
  if (twoSubjects.length >= 2) s.compare += 0.95;
  if (q.match(/\d班.*\d班/)) s.compare += 0.8;

  // 查询类
  if (extractStudent(rawQ, allRecs)) s.query += 0.9;
  if (extractClass(rawQ, allRecs) && q.includes("班")) s.query += 0.7;

  // 整体概况兜底
  const ovKw = [
    ["总体", 0.6], ["整体", 0.6], ["概况", 0.65], ["总览", 0.7],
    ["总结", 0.6], ["分析报告", 0.7], ["整体情况", 0.7],
    ["年级情况", 0.7], ["考试情况", 0.7], ["年级概况", 0.75],
    ["怎么样", 0.5], ["如何", 0.45], ["好吗", 0.5],
    ["讲讲", 0.6], ["介绍", 0.6], ["说说", 0.5],
  ];
  ovKw.forEach(([kw, w]) => { if (q.includes(kw)) s.overview += w; });

  return s;
}

function generateRateAnswer(ctx) {
  const { q, subjects, stats, allRecs, qSubject } = ctx;
  const target = qSubject
    ? subjects.find(s => s.name === qSubject)
    : null;

  let html = '';
  if (target) {
    const st = stats[target.name];
    html += `<p>「${target.name}」成绩率表现：</p>`;
    html += `<div class="emc-highlight">`;
    html += `• 参考人数：${st.total} 人<br>`;
    html += `• 优秀率：<b>${fmt(st.excellentPct * 100, 1)}%</b>（${st.excellent}人，得分率≥90%）<br>`;
    html += `• 良好率：${fmt(st.goodPct * 100, 1)}%（${st.good}人，80%-90%）<br>`;
    html += `• 及格率：${fmt(st.passPct * 100, 1)}%（${st.passCount}人，≥60%）<br>`;
    const failPct = st.total > 0 ? (st.total - st.passCount) / st.total : 0;
    html += `• 不及格率：${fmt(failPct * 100, 1)}%（${st.total - st.passCount}人）`;
    html += `</div>`;
    const rateLevel = st.excellentPct > 0.3 ? "优秀率偏高，整体水平较好" :
                      failPct > 0.2 ? "不及格率偏高，基础薄弱学生多" :
                      "分布相对均衡";
    html += `<div class="emc-tip">💡 ${rateLevel}。建议关注中等生向良好生转化。</div>`;
  } else {
    html += `<p>全年级各科目成绩率对比：</p>`;
    html += `<table><tr><th>科目</th><th>优秀率</th><th>良好率</th><th>及格率</th><th>不及格率</th></tr>`;
    subjects.forEach((s) => {
      const st = stats[s.name];
      const failPct = st.total > 0 ? (st.total - st.passCount) / st.total : 0;
      html += `<tr><td>${s.name}</td><td>${fmt(st.excellentPct * 100, 1)}%</td><td>${fmt(st.goodPct * 100, 1)}%</td><td>${fmt(st.passPct * 100, 1)}%</td><td>${fmt(failPct * 100, 1)}%</td></tr>`;
    });
    html += `</table>`;
    const sortedByExc = subjects.map(s => ({name:s.name, exc:stats[s.name].excellentPct})).sort((a,b)=>b.exc-a.exc);
    const sortedByFail = subjects.map(s => {
      const st = stats[s.name];
      const failPct = st.total > 0 ? (st.total - st.passCount) / st.total : 0;
      return {name:s.name, fail:failPct};
    }).sort((a,b)=>b.fail-a.fail);
    html += `<div class="emc-highlight">`;
    html += `🏆 优秀率最高：${sortedByExc[0].name}（${fmt(sortedByExc[0].exc*100,1)}%）<br>`;
    html += `⚠️ 不及格率最高：${sortedByFail[0].name}（${fmt(sortedByFail[0].fail*100,1)}%）`;
    html += `</div>`;
  }
  return eaResp("📊 成绩率分析", html);
}

function computeClassStats(allRecs, subjects, totalFullScore) {
  const classList = [...new Set(allRecs.map(r => r.classNo))].sort();
  const totalPassLine = subjects.reduce((s, x) => s + x.pass, 0);
  const totalExcellentLine = subjects.reduce((s, x) => s + x.excellent, 0);
  const result = {};
  classList.forEach(c => {
    const recs = allRecs.filter(r => r.classNo === c);
    const totals = recs.map(r => r.total).filter(v => typeof v === "number");
    const avg = totals.length ? totals.reduce((a,b)=>a+b,0) / totals.length : 0;
    const passCount = totals.filter(t => t >= totalPassLine).length;
    const excCount = totals.filter(t => t >= totalExcellentLine).length;
    const variance = totals.length ? totals.reduce((s,t) => s + Math.pow(t-avg,2), 0) / totals.length : 0;
    const stdDev = Math.sqrt(variance);
    result[c] = { avg, passPct: totals.length ? passCount/totals.length : 0,
                  excPct: totals.length ? excCount/totals.length : 0,
                  total: totals.length, stdDev };
  });
  return result;
}

function generateClassRankingAnswer(ctx) {
  const { allRecs, subjects, totalFullScore } = ctx;
  const classStats = computeClassStats(allRecs, subjects, totalFullScore);
  const sorted = Object.entries(classStats).sort((a,b) => b[1].avg - a[1].avg);

  let html = `<p>全年级 ${sorted.length} 个班级总分排名：</p>`;
  html += `<table><tr><th>排名</th><th>班级</th><th>均分</th><th>得分率</th><th>及格率</th><th>优秀率</th><th>标准差</th></tr>`;
  sorted.forEach(([c, s], i) => {
    const rate = totalFullScore > 0 ? fmt(s.avg / totalFullScore * 100, 1) : "0";
    html += `<tr><td>${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</td><td><b>${c}</b></td><td>${fmt(s.avg, 1)}</td><td>${rate}%</td><td>${fmt(s.passPct * 100, 1)}%</td><td>${fmt(s.excPct * 100, 1)}%</td><td>${fmt(s.stdDev, 1)}</td></tr>`;
  });
  html += `</table>`;

  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const gap = best[1].avg - worst[1].avg;
  html += `<div class="emc-highlight">`;
  html += `✅ 领先班级：${best[0]}，均分 ${fmt(best[1].avg, 1)}（得分率 ${fmt(best[1].avg/totalFullScore*100, 1)}%）<br>`;
  html += `⚠️ 待提升：${worst[0]}，均分 ${fmt(worst[1].avg, 1)}，与第1名差距 <b>${fmt(gap, 1)}</b> 分<br>`;
  html += `📊 班级差异：${gap/totalFullScore > 0.1 ? "班级间差距较大，需关注薄弱班级" : "班级整体均衡"}`;
  html += `</div>`;
  html += `<div class="emc-tip">💡 标准差反映班级内部分化程度，值越大说明两极分化越严重。</div>`;

  return eaResp("🏆 班级总分排名", html);
}

function generateStudentAnswer(ctx) {
  const { q, allRecs, subjects, exams, selectedExam, grade, qSubject, qStudent } = ctx;
  const totalFullScore = subjects.reduce((s, x) => s + x.fullScore, 0);
  const totalPassLine = subjects.reduce((s, x) => s + x.pass, 0);
  const totalExcellentLine = subjects.reduce((s, x) => s + x.excellent, 0);

  // 偏科生识别
  const partialStudents = allRecs.map(r => {
    const excellentSubjects = subjects.filter(s => (r.scores[s.name] ?? 0) >= s.excellent);
    const failSubjects = subjects.filter(s => (r.scores[s.name] ?? 0) < s.pass);
    const score = excellentSubjects.length * 10 + failSubjects.length * 10;
    return { ...r, excellentSubjects, failSubjects, partialScore: score };
  }).filter(r => r.excellentSubjects.length > 0 && r.failSubjects.length > 0)
    .sort((a, b) => b.partialScore - a.partialScore).slice(0, 15);

  // 不及格学生（总分未达及格线）
  const failStudents = allRecs.filter(r => r.total < totalPassLine)
    .sort((a, b) => a.total - b.total).slice(0, 15);

  // 高分学生（总分达到优秀线）
  const topStudents = allRecs.filter(r => r.total >= totalExcellentLine)
    .sort((a, b) => b.total - a.total).slice(0, 10);

  let html = '';

  // 如果问到了特定学生
  if (qStudent) {
    const rec = allRecs.find(r => r.studentName === qStudent);
    if (rec) {
      html += `<p><b>${qStudent}</b> 的成绩详情：</p>`;
      html += `<div class="emc-highlight">`;
      html += `• 班级：${rec.classNo} 班<br>`;
      html += `• 总分：${rec.total} / ${totalFullScore}（得分率 ${fmt(rec.total/totalFullScore*100, 1)}%）<br>`;
      const rank = [...allRecs].sort((a,b) => b.total - a.total).findIndex(r => r.studentId === rec.studentId) + 1;
      html += `• 年级排名：第 ${rank} 名 / ${allRecs.length} 人（前 ${fmt(rank/allRecs.length*100,1)}%）`;
      html += `</div>`;
      html += `<p>各科成绩：</p>`;
      html += `<table><tr><th>科目</th><th>得分</th><th>满分</th><th>得分率</th></tr>`;
      subjects.forEach(s => {
        const score = rec.scores[s.name] ?? 0;
        html += `<tr><td>${s.name}</td><td>${score}</td><td>${s.fullScore}</td><td>${fmt(score/s.fullScore*100,1)}%</td></tr>`;
      });
      html += `</table>`;
      return eaResp(`👤 ${qStudent} 成绩查询`, html);
    }
  }

  if (q.includes("偏科")) {
    if (partialStudents.length > 0) {
      html += `<p>偏科学生共 ${partialStudents.length} 人（优势学科优秀+薄弱学科不及格）：</p>`;
      html += `<div class="emc-highlight">`;
      partialStudents.slice(0, 8).forEach(s => {
        html += `• ${s.studentName}（${s.classNo}班）：优势${s.excellentSubjects.map(x=>x.name).join("、")}，薄弱${s.failSubjects.map(x=>x.name).join("、")}<br>`;
      });
      html += `</div>`;
      html += `<div class="emc-tip">💡 偏科生是总分提升的"金矿"——薄弱学科每提升10分，对总分排名拉动效果显著高于优势学科再提升。</div>`;
    } else {
      html += `<p>本次考试未检测到明显的偏科学生。</p>`;
    }
  } else if (q.includes("不及格")) {
    if (failStudents.length > 0) {
      html += `<p>总分不及格（得分率<60%）学生共 ${failStudents.length} 人：</p>`;
      html += `<div class="emc-highlight">`;
      failStudents.slice(0, 8).forEach(s => {
        html += `• ${s.studentName}（${s.classNo}班）：${s.total}分（得分率${fmt(s.total/totalFullScore*100,1)}%）<br>`;
      });
      html += `</div>`;
      html += `<div class="emc-tip">💡 不及格学生通常存在基础知识薄弱或学习态度问题，建议家校协同+个性化辅导。</div>`;
    } else {
      html += `<p>🎉 本次考试没有不及格学生，整体表现优秀！</p>`;
    }
  } else if (q.includes("进步") || q.includes("退步")) {
    // 交给趋势分析
    return generateTrendAnswer(ctx);
  } else {
    // 综合关注
    const toWatch = [...failStudents.slice(0, 5), ...partialStudents.slice(0, 5)]
      .filter((v, i, a) => a.findIndex(t => t.studentId === v.studentId) === i);
    html += `<p>综合关注学生（共 ${toWatch.length} 人）：</p>`;
    html += `<div class="emc-highlight">`;
    toWatch.slice(0, 8).forEach(s => {
      const tags = [];
      if (s.total < totalPassLine) tags.push("总分不及格");
      if (s.excellentSubjects?.length > 0 && s.failSubjects?.length > 0) tags.push("偏科");
      html += `• ${s.studentName}（${s.classNo}班）：${s.total}分 ${tags.length ? `【${tags.join("、")}】` : ""}<br>`;
    });
    html += `</div>`;
    html += `<p>高分学生示例：</p>`;
    html += `<div class="emc-highlight">`;
    topStudents.slice(0, 3).forEach(s => {
      html += `• ${s.studentName}（${s.classNo}班）：${s.total}分（${fmt(s.total/totalFullScore*100,1)}%）<br>`;
    });
    html += `</div>`;
  }

  return eaResp("👨‍🎓 重点关注学生", html);
}

function generateSubjectAnswer(ctx) {
  const { subjects, stats, allRecs, qSubject, totalFullScore } = ctx;

  const sortedByRate = subjects.map(s => {
    const st = stats[s.name];
    const failPct = st.total > 0 ? (st.total - st.passCount) / st.total : 0;
    return {
      name: s.name, rate: st.avg / s.fullScore * 100,
      avg: st.avg, fullScore: s.fullScore,
      excPct: st.excellentPct, failPct: failPct
    };
  }).sort((a, b) => b.rate - a.rate);

  let html = '';

  if (qSubject) {
    const s = subjects.find(x => x.name === qSubject);
    const st = stats[qSubject];
    if (s) {
      const failPct = st.total > 0 ? (st.total - st.passCount) / st.total : 0;
      html += `<p>「${qSubject}」学科深度分析：</p>`;
      html += `<div class="emc-highlight">`;
      html += `• 均分：${fmt(st.avg, 1)} / ${s.fullScore}（得分率 <b>${fmt(st.avg/s.fullScore*100,1)}%</b>）<br>`;
      html += `• 最高分：${fmt(st.max, 1)}（${st.maxCount}人并列）<br>`;
      html += `• 最低分：${fmt(st.min, 1)}（${st.minCount}人并列）<br>`;
      html += `• 极差：${fmt(st.max - st.min, 1)} 分<br>`;
      html += `• 优秀率：${fmt(st.excellentPct*100,1)}%（${st.excellent}人）<br>`;
      html += `• 良好率：${fmt(st.goodPct*100,1)}%（${st.good}人）<br>`;
      html += `• 及格率：${fmt(st.passPct*100,1)}%（${st.passCount}人）<br>`;
      html += `• 不及格率：${fmt(failPct*100,1)}%（${st.total - st.passCount}人）`;
      html += `</div>`;

      // 班级间对比
      const classList = [...new Set(allRecs.map(r => r.classNo))].sort();
      const classData = classList.map(c => {
        const recs = allRecs.filter(r => r.classNo === c);
        const scores = recs.map(r => r.scores[qSubject] ?? 0).filter(v => typeof v === "number");
        const avg = scores.length ? scores.reduce((a,b)=>a+b,0)/scores.length : 0;
        return { classNo: c, avg, count: scores.length };
      }).sort((a,b) => b.avg - a.avg);

      html += `<p>各班${qSubject}均分排名：</p>`;
      html += `<table><tr><th>排名</th><th>班级</th><th>均分</th><th>得分率</th></tr>`;
      classData.forEach((c, i) => {
        html += `<tr><td>${i+1}</td><td>${c.classNo}</td><td>${fmt(c.avg,1)}</td><td>${fmt(c.avg/s.fullScore*100,1)}%</td></tr>`;
      });
      html += `</table>`;
      return eaResp(`📚 ${qSubject} 学科分析`, html);
    }
  }

  html += `<p>各科目得分率排名：</p>`;
  html += `<table><tr><th>排名</th><th>科目</th><th>均分</th><th>满分</th><th>得分率</th><th>优秀率</th><th>不及格率</th></tr>`;
  sortedByRate.forEach((s, i) => {
    html += `<tr><td>${i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</td><td><b>${s.name}</b></td><td>${fmt(s.avg,1)}</td><td>${s.fullScore}</td><td>${fmt(s.rate,1)}%</td><td>${fmt(s.excPct*100,1)}%</td><td>${fmt(s.failPct*100,1)}%</td></tr>`;
  });
  html += `</table>`;

  const best = sortedByRate[0];
  const worst = sortedByRate[sortedByRate.length - 1];
  html += `<div class="emc-highlight">`;
  html += `✅ 优势学科：${best.name}，得分率 ${fmt(best.rate, 1)}%<br>`;
  html += `⚠️ 薄弱学科：${worst.name}，得分率 ${fmt(worst.rate, 1)}%，低于优势学科 <b>${fmt(best.rate - worst.rate, 1)}</b> 个百分点`;
  html += `</div>`;
  html += `<div class="emc-tip">💡 学科间差异过大可能反映教学投入不均衡，建议关注薄弱学科的教研提升。</div>`;

  return eaResp("📚 学科成绩分析", html);
}

function generateAvgScoreAnswer(ctx) {
  const { subjects, stats, qSubject, totalStats, totalFullScore } = ctx;

  let html = '';
  if (qSubject) {
    const s = subjects.find(x => x.name === qSubject);
    const st = stats[qSubject];
    if (s) {
      html += `<p>「${qSubject}」均分概况：</p>`;
      html += `<div class="emc-highlight">`;
      html += `• 参考人数：${st.total} 人<br>`;
      html += `• 平均分：<b>${fmt(st.avg, 1)}</b> / ${s.fullScore}（得分率 ${fmt(st.avg/s.fullScore*100,1)}%）<br>`;
      html += `• 最高分：${fmt(st.max, 1)} 分（${st.maxCount}人）<br>`;
      html += `• 最低分：${fmt(st.min, 1)} 分（${st.minCount}人）<br>`;
      html += `• 极差：${fmt(st.max - st.min, 1)} 分`;
      html += `</div>`;
      return eaResp(`📊 ${qSubject} 均分统计`, html);
    }
  }

  html += `<p>全年级各科目均分一览：</p>`;
  html += `<table><tr><th>科目</th><th>均分</th><th>满分</th><th>得分率</th><th>最高分</th><th>最低分</th></tr>`;
  subjects.forEach(s => {
    const st = stats[s.name];
    html += `<tr><td><b>${s.name}</b></td><td>${fmt(st.avg,1)}</td><td>${s.fullScore}</td><td>${fmt(st.avg/s.fullScore*100,1)}%</td><td>${fmt(st.max,1)}</td><td>${fmt(st.min,1)}</td></tr>`;
  });
  html += `</table>`;
  html += `<div class="emc-highlight">`;
  html += `📈 总分均分：<b>${fmt(totalStats.avg, 1)}</b> / ${totalFullScore}（得分率 ${fmt(totalStats.avg/totalFullScore*100,1)}%）`;
  html += `</div>`;

  return eaResp("📊 均分统计", html);
}

function generateDistributionAnswer(ctx) {
  const { allRecs, totalFullScore, totalStats } = ctx;
  const totals = allRecs.map(r => r.total).filter(v => typeof v === "number").sort((a,b) => a - b);
  const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
  const median = totals.length % 2 === 0
    ? (totals[totals.length / 2 - 1] + totals[totals.length / 2]) / 2
    : totals[Math.floor(totals.length / 2)];
  const variance = totals.reduce((s, t) => s + Math.pow(t - avg, 2), 0) / totals.length;
  const stdDev = Math.sqrt(variance);
  const cv = avg > 0 ? stdDev / avg * 100 : 0;

  const segs = [
    { name: "高分段(≥90%)", min: totalFullScore * 0.9, max: totalFullScore + 1, color: "success" },
    { name: "中高段(80%-90%)", min: totalFullScore * 0.8, max: totalFullScore * 0.9, color: "info" },
    { name: "中等段(70%-80%)", min: totalFullScore * 0.7, max: totalFullScore * 0.8, color: "primary" },
    { name: "中低段(60%-70%)", min: totalFullScore * 0.6, max: totalFullScore * 0.7, color: "warning" },
    { name: "低分段(<60%)", min: 0, max: totalFullScore * 0.6, color: "danger" }
  ];

  let html = `<p>全年级 ${allRecs.length} 名学生总分分布：</p>`;
  html += `<table><tr><th>分数段</th><th>人数</th><th>占比</th></tr>`;
  segs.forEach(seg => {
    const cnt = totals.filter(t => t >= seg.min && t < seg.max).length;
    html += `<tr><td>${seg.name}</td><td><b>${cnt}</b></td><td>${fmt(cnt / totals.length * 100, 1)}%</td></tr>`;
  });
  html += `</table>`;

  html += `<div class="emc-highlight">`;
  html += `📊 平均分：${fmt(avg, 1)} 分（得分率 ${fmt(avg / totalFullScore * 100, 1)}%）<br>`;
  html += `📊 中位数：${fmt(median, 1)} 分<br>`;
  html += `📊 标准差：${fmt(stdDev, 1)} 分（变异系数 ${fmt(cv,1)}%）<br>`;
  html += `📊 极差：${fmt(totalStats.max - totalStats.min, 1)} 分`;
  html += `</div>`;

  const lowerHalf = totals.filter(t => t < avg).length;
  const upperHalf = totals.filter(t => t > avg).length;
  let shape = "正态分布（橄榄型）";
  if (lowerHalf > upperHalf * 1.2) shape = "负偏态（低分人数偏多，左偏分布）";
  else if (upperHalf > lowerHalf * 1.2) shape = "正偏态（高分人数偏多，右偏分布）";

  let diffLevel = cv < 10 ? "整体均衡" : cv < 15 ? "轻度分化" : cv < 20 ? "中度分化" : "严重两极分化";

  html += `<div class="emc-tip">💡 分布形态：${shape}。<br>💡 分化程度：${diffLevel}（变异系数 ${fmt(cv,1)}%）。</div>`;

  return eaResp("📈 成绩分布分析", html);
}

function generateOverviewAnswer(ctx) {
  const { allRecs, subjects, stats, totalFullScore, totalStats, selectedExam } = ctx;
  const classList = [...new Set(allRecs.map(r => r.classNo))].sort();

  const passAllCount = allRecs.filter(r => subjects.every(s => (r.scores[s.name] ?? 0) >= s.pass)).length;
  const excAllCount = allRecs.filter(r => subjects.every(s => (r.scores[s.name] ?? 0) >= s.excellent)).length;

  let html = `<p>「${selectedExam.name}」年级整体概况：</p>`;
  html += `<div class="emc-highlight">`;
  html += `📊 参考人数：<b>${allRecs.length}</b> 人（${classList.length} 个班级）<br>`;
  html += `📚 考试科目：${subjects.length} 科，满分 ${totalFullScore} 分<br>`;
  html += `📈 总分均分：<b>${fmt(totalStats.avg, 1)}</b> 分（得分率 ${fmt(totalStats.avg/totalFullScore*100,1)}%）<br>`;
  html += `🏆 最高分：${fmt(totalStats.max, 1)} 分（${totalStats.maxCount}人并列）<br>`;
  html += `📉 最低分：${fmt(totalStats.min, 1)} 分（${totalStats.minCount}人并列）<br>`;
  html += `✅ 全科目及格：${passAllCount} 人（${fmt(passAllCount/allRecs.length*100,1)}%）<br>`;
  html += `🌟 全科目优秀：${excAllCount} 人（${fmt(excAllCount/allRecs.length*100,1)}%）`;
  html += `</div>`;

  const sortedByRate = subjects.map(s => ({
    name: s.name, rate: stats[s.name].avg / s.fullScore * 100
  })).sort((a, b) => b.rate - a.rate);

  html += `<p>各科得分率：</p>`;
  html += `<div class="emc-highlight">`;
  sortedByRate.forEach(s => {
    const barW = Math.round(s.rate);
    html += `<div style="margin:4px 0;font-size:12px">${s.name}：${fmt(s.rate,1)}% <div style="display:inline-block;width:100px;height:6px;background:#eee;border-radius:3px;vertical-align:middle;margin-left:6px"><div style="width:${barW}%;height:100%;background:#6366f1;border-radius:3px"></div></div></div>`;
  });
  html += `</div>`;

  return eaResp("📊 年级整体概况", html);
}

function generateTrendAnswer(ctx) {
  const { allRecs, exams, selectedExam, grade, subjects, totalFullScore } = ctx;
  if (exams.length < 2) {
    return eaResp("🔄 进退步分析", `<p>目前只有 <b>${exams.length}</b> 次考试数据，无法进行进退步对比。<br>需要至少两次考试才能分析变化趋势。</p>`);
  }

  const examIdx = exams.findIndex(e => e.id === selectedExam.id);
  const prevExam = examIdx > 0 ? exams[examIdx - 1] : exams[exams.length - 2];

  if (!prevExam) {
    return eaResp("🔄 进退步分析", `<p>无法找到上一次考试进行对比。</p>`);
  }

  const prevRecs = DB.records.filter(r => r.examId === prevExam.id && r.grade === grade);
  const prevMap = {};
  prevRecs.forEach(r => { prevMap[r.studentId] = r; });

  const changes = allRecs.filter(r => prevMap[r.studentId])
    .map(r => ({
      studentId: r.studentId, studentName: r.studentName, classNo: r.classNo,
      prev: prevMap[r.studentId].total, curr: r.total,
      diff: r.total - prevMap[r.studentId].total
    }));

  if (changes.length === 0) {
    return eaResp("🔄 进退步分析", `<p>两次考试的学生名单没有重叠，无法进行对比。</p>`);
  }

  const progressCount = changes.filter(c => c.diff > 5).length;
  const regressCount = changes.filter(c => c.diff < -5).length;
  const stableCount = changes.length - progressCount - regressCount;
  const avgDiff = changes.reduce((s, c) => s + c.diff, 0) / changes.length;

  let html = `<p>对比「${prevExam.name}」→「${selectedExam.name}」：</p>`;
  html += `<div class="emc-highlight">`;
  html += `📊 有效对比：${changes.length} 人<br>`;
  html += `📈 整体变化：${avgDiff >= 0 ? "进步" : "退步"} <b>${avgDiff >= 0 ? "+" : ""}${fmt(avgDiff, 1)}</b> 分<br>`;
  html += `✅ 进步明显(>5分)：${progressCount} 人（${fmt(progressCount/changes.length*100,1)}%）<br>`;
  html += `➖ 基本稳定(±5分)：${stableCount} 人（${fmt(stableCount/changes.length*100,1)}%）<br>`;
  html += `⚠️ 退步明显(>5分)：${regressCount} 人（${fmt(regressCount/changes.length*100,1)}%）`;
  html += `</div>`;

  const sorted = [...changes].sort((a, b) => b.diff - a.diff);
  const topProgress = sorted.filter(c => c.diff > 0).slice(0, 5);
  const topRegress = [...sorted].filter(c => c.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 5);

  if (topProgress.length > 0) {
    html += `<p>🏆 进步最大的学生：</p><div class="emc-highlight">`;
    topProgress.forEach(c => {
      html += `• ${c.studentName}（${c.classNo}班）：<b>+${c.diff}</b> 分（${c.prev} → ${c.curr}）<br>`;
    });
    html += `</div>`;
  }

  if (topRegress.length > 0) {
    html += `<p>⚠️ 退步最大的学生：</p><div class="emc-highlight">`;
    topRegress.forEach(c => {
      html += `• ${c.studentName}（${c.classNo}班）：<b>${c.diff}</b> 分（${c.prev} → ${c.curr}）<br>`;
    });
    html += `</div>`;
  }

  html += `<div class="emc-tip">💡 进退步分析帮助识别教学效果变化和学生学习状态波动。</div>`;

  return eaResp("🔄 进退步对比", html);
}

// === 新增：标准差/离散度分析 ===
function generateStdDevAnswer(ctx) {
  const { allRecs, subjects, stats, totalStats, totalFullScore } = ctx;

  const totals = allRecs.map(r => r.total).filter(v => typeof v === "number");
  const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
  const variance = totals.reduce((s, t) => s + Math.pow(t - avg, 2), 0) / totals.length;
  const stdDev = Math.sqrt(variance);
  const cv = avg > 0 ? stdDev / avg * 100 : 0;

  let html = `<p>全年级总分离散程度分析：</p>`;
  html += `<div class="emc-highlight">`;
  html += `📊 标准差：<b>${fmt(stdDev, 1)}</b> 分<br>`;
  html += `📊 变异系数：<b>${fmt(cv, 1)}%</b><br>`;
  html += `📊 极差：${fmt(totalStats.max - totalStats.min, 1)} 分<br>`;
  html += `📊 平均分：${fmt(avg, 1)} 分`;
  html += `</div>`;

  let level, advice;
  if (cv < 10) { level = "整体均衡"; advice = "学生整体水平接近，教学可统一进度，注意优秀生培优。"; }
  else if (cv < 15) { level = "轻度分化"; advice = "存在一定差异，建议分层教学+个别辅导。"; }
  else if (cv < 20) { level = "中度分化"; advice = "两极分化明显，需重点关注后进生，防止差距扩大。"; }
  else { level = "严重两极分化"; advice = "分化严重，建议分班教学或大幅调整教学策略。"; }

  html += `<div class="emc-highlight">`;
  html += `⚠️ 分化等级：<b>${level}</b><br>`;
  html += `💡 建议：${advice}`;
  html += `</div>`;

  html += `<p>各科目标准差对比：</p>`;
  html += `<table><tr><th>科目</th><th>均分</th><th>标准差</th><th>变异系数</th><th>分化程度</th></tr>`;
  subjects.forEach(s => {
    const st = stats[s.name];
    const subCV = st.avg > 0 ? st.stdDev / st.avg * 100 : 0;
    const level2 = subCV < 10 ? "均衡" : subCV < 15 ? "轻度" : subCV < 20 ? "中度" : "严重";
    html += `<tr><td>${s.name}</td><td>${fmt(st.avg,1)}</td><td>${fmt(st.stdDev,1)}</td><td>${fmt(subCV,1)}%</td><td>${level2}</td></tr>`;
  });
  html += `</table>`;

  return eaResp("📐 离散度分析", html);
}

// === 新增：前后排名 ===
function generateTopBottomAnswer(ctx) {
  const { q, allRecs, totalFullScore, qSubject, subjects, stats } = ctx;

  let n = 10;
  const m = q.match(/(\d+)/);
  if (m) n = Math.min(Math.max(parseInt(m[1]), 3), 50);

  let html = '';

  if (qSubject) {
    const s = subjects.find(x => x.name === qSubject);
    const sorted = [...allRecs]
      .map(r => ({ name: r.studentName, classNo: r.classNo, score: r.scores[qSubject] ?? 0 }))
      .sort((a, b) => b.score - a.score);

    const topN = sorted.slice(0, n);
    const bottomN = sorted.slice(-n).reverse();

    html += `<p>${qSubject} 成绩前 ${n} 名：</p>`;
    html += `<div class="emc-highlight">`;
    topN.forEach((t, i) => {
      html += `${i + 1}. ${t.name}（${t.classNo}班）：${t.score}分<br>`;
    });
    html += `</div>`;

    html += `<p>${qSubject} 成绩后 ${n} 名：</p>`;
    html += `<div class="emc-highlight">`;
    bottomN.forEach((t, i) => {
      html += `${sorted.length - n + i + 1}. ${t.name}（${t.classNo}班）：${t.score}分<br>`;
    });
    html += `</div>`;
    return eaResp(`📊 ${qSubject} 排名`, html);
  }

  const sorted = [...allRecs].sort((a, b) => b.total - a.total);
  const topN = sorted.slice(0, n);
  const bottomN = sorted.slice(-n).reverse();

  html += `<p>总分前 ${n} 名：</p>`;
  html += `<div class="emc-highlight">`;
  topN.forEach((t, i) => {
    html += `${i + 1}. ${t.studentName}（${t.classNo}班）：${t.total}分（${fmt(t.total/totalFullScore*100,1)}%）<br>`;
  });
  html += `</div>`;

  html += `<p>总分后 ${n} 名：</p>`;
  html += `<div class="emc-highlight">`;
  bottomN.forEach((t, i) => {
    html += `${sorted.length - n + i + 1}. ${t.studentName}（${t.classNo}班）：${t.total}分（${fmt(t.total/totalFullScore*100,1)}%）<br>`;
  });
  html += `</div>`;

  return eaResp(`🏆 排名查询`, html);
}

// === 新增：教学建议 ===
function generateSuggestionAnswer(ctx) {
  const { allRecs, subjects, stats, totalFullScore, totalStats, qSubject, qClass } = ctx;

  const totals = allRecs.map(r => r.total).filter(v => typeof v === "number");
  const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
  const cv = avg > 0 ? Math.sqrt(totals.reduce((s,t)=>s+Math.pow(t-avg,2),0)/totals.length) / avg * 100 : 0;

  let html = '';

  if (qSubject) {
    const st = stats[qSubject];
    const s = subjects.find(x => x.name === qSubject);
    const failPct = st.total > 0 ? (st.total - st.passCount) / st.total : 0;
    html += `<p>「${qSubject}」教学改进建议：</p>`;
    html += `<div class="emc-highlight">`;
    if (st.excellentPct < 0.1) {
      html += `🔴 优秀率偏低（${fmt(st.excellentPct*100,1)}%）：建议加强难题训练，拓展拔高内容。<br>`;
    }
    if (failPct > 0.2) {
      html += `🔴 不及格率偏高（${fmt(failPct*100,1)}%）：建议回归基础，降低起点，分层辅导后进生。<br>`;
    }
    if (st.avg < s.pass) {
      html += `🔴 整体得分率不足及格线：可能是试卷过难或基础薄弱，需重新评估教学进度。<br>`;
    }
    if (st.stdDev / st.avg > 0.15) {
      html += `🟡 内部分化较大：建议分层作业、小组合作学习。<br>`;
    }
    html += `✅ 当前得分率 ${fmt(st.avg/s.fullScore*100,1)}%，处于${st.avg/s.fullScore>=0.8?"优秀":st.avg/s.fullScore>=0.7?"良好":"中等"}水平。`;
    html += `</div>`;
    return eaResp(`💡 ${qSubject} 教学建议`, html);
  }

  html += `<p>基于本次考试数据的教学建议：</p>`;

  const sortedByFail = subjects.map(s => {
    const st = stats[s.name];
    const failPct = st.total > 0 ? (st.total - st.passCount) / st.total : 0;
    return {name:s.name, fail:failPct, avg:stats[s.name].avg/s.fullScore*100};
  }).sort((a,b) => b.fail - a.fail);

  html += `<div class="emc-highlight">`;
  html += `<b>一、学科层面</b><br>`;
  html += `• 重点关注：${sortedByFail[0].name}（不及格率 ${fmt(sortedByFail[0].fail*100,1)}%），建议开展教研会诊<br>`;
  html += `• 优势学科：${sortedByFail[sortedByFail.length-1].name} 可总结经验，在年级推广`;
  html += `</div>`;

  html += `<div class="emc-highlight">`;
  html += `<b>二、学生层面</b><br>`;
  html += `• 培优：优秀生群体 ${stats["总分"].excellent} 人，可开展竞赛辅导/拓展课程<br>`;
  html += `• 扶困：不及格群体 ${stats["总分"].total - stats["总分"].passCount} 人，需建立"一生一策"帮扶档案<br>`;
  html += `• 中间层：中等生占比最大，是提分关键，建议强化中等生向良好生转化`;
  html += `</div>`;

  html += `<div class="emc-highlight">`;
  html += `<b>三、管理层面</b><br>`;
  html += `• 整体均分 ${fmt(totalStats.avg,1)}（${fmt(avg/totalFullScore*100,1)}%），${cv<15?"班级整体均衡，继续保持":"班级差异较大，需关注薄弱班级"}<br>`;
  html += `• 建议下周召开质量分析会，各科老师交流诊断结果<br>`;
  html += `• 可考虑引入学习科学方法（如间隔重复、刻意练习）提升教学效率`;
  html += `</div>`;

  html += `<div class="emc-tip">💡 以上建议基于数据自动生成，实际决策请结合教学经验综合判断。</div>`;

  return eaResp("💡 教学建议", html);
}

// === 新增：特定班级查询 ===
function generateQueryAnswer(ctx) {
  const { allRecs, subjects, totalFullScore, qClass, qStudent, qSubject, stats } = ctx;

  if (qStudent) {
    return generateStudentAnswer(ctx);
  }

  if (qClass) {
    const classRecs = allRecs.filter(r => r.classNo === qClass);
    if (classRecs.length === 0) {
      return eaResp("🔍 班级查询", `<p>未找到 ${qClass} 班的数据。</p>`);
    }

    const classStats = aggregateStats(classRecs, subjects);
    const totalStats = classStats["总分"];

    // 年级排名
    const allSorted = [...allRecs].sort((a, b) => b.total - a.total);
    const classRanks = classRecs.map(r => ({
      name: r.studentName,
      total: r.total,
      rank: allSorted.findIndex(x => x.studentId === r.studentId) + 1
    })).sort((a, b) => a.rank - b.rank);

    let html = `<p><b>${qClass} 班</b> 成绩概况：</p>`;
    html += `<div class="emc-highlight">`;
    html += `• 参考人数：${classRecs.length} 人<br>`;
    html += `• 总分均分：<b>${fmt(totalStats.avg, 1)}</b> / ${totalFullScore}（${fmt(totalStats.avg/totalFullScore*100,1)}%）<br>`;
    html += `• 最高分：${fmt(totalStats.max, 1)} 分<br>`;
    html += `• 最低分：${fmt(totalStats.min, 1)} 分<br>`;
    html += `• 及格率：${fmt(totalStats.passPct*100,1)}%<br>`;
    html += `• 优秀率：${fmt(totalStats.excellentPct*100,1)}%`;
    html += `</div>`;

    html += `<p>班级前5名：</p>`;
    html += `<div class="emc-highlight">`;
    classRanks.slice(0, 5).forEach((s, i) => {
      html += `${i+1}. ${s.name}：${s.total}分（年级第${s.rank}名）<br>`;
    });
    html += `</div>`;

    return eaResp(`🏫 ${qClass}班 成绩分析`, html);
  }

  return generateOverviewAnswer(ctx);
}

// === 新增：科目对比 ===
function generateCompareAnswer(ctx) {
  const { q, subjects, stats, allRecs, qSubject, totalFullScore } = ctx;

  // 找出问题中提到的两个科目
  const found = subjects.filter(s => q.includes(s.name));
  if (found.length >= 2) {
    const s1 = found[0], s2 = found[1];
    const st1 = stats[s1.name], st2 = stats[s2.name];
    const rate1 = st1.avg / s1.fullScore * 100;
    const rate2 = st2.avg / s2.fullScore * 100;

    let html = `<p>${s1.name} vs ${s2.name} 对比：</p>`;
    html += `<table><tr><th>指标</th><th>${s1.name}</th><th>${s2.name}</th><th>差异</th></tr>`;
    html += `<tr><td>均分</td><td>${fmt(st1.avg,1)}</td><td>${fmt(st2.avg,1)}</td><td>${fmt(st1.avg-st2.avg,1)}</td></tr>`;
    html += `<tr><td>得分率</td><td>${fmt(rate1,1)}%</td><td>${fmt(rate2,1)}%</td><td>${fmt(rate1-rate2,1)}%</td></tr>`;
    html += `<tr><td>优秀率</td><td>${fmt(st1.excellentPct*100,1)}%</td><td>${fmt(st2.excellentPct*100,1)}%</td><td>${fmt((st1.excellentPct-st2.excellentPct)*100,1)}%</td></tr>`;
    html += `<tr><td>及格率</td><td>${fmt(st1.passPct*100,1)}%</td><td>${fmt(st2.passPct*100,1)}%</td><td>${fmt((st1.passPct-st2.passPct)*100,1)}%</td></tr>`;
    html += `<tr><td>标准差</td><td>${fmt(st1.stdDev,1)}</td><td>${fmt(st2.stdDev,1)}</td><td>${fmt(st1.stdDev-st2.stdDev,1)}</td></tr>`;
    html += `</table>`;

    const winner = rate1 > rate2 ? s1.name : s2.name;
    const diff = Math.abs(rate1 - rate2);
    html += `<div class="emc-highlight">`;
    html += `✅ ${winner} 得分率领先 <b>${fmt(diff,1)}</b> 个百分点<br>`;
    html += diff > 10 ? "⚠️ 两科差距较大，需关注薄弱学科均衡发展" : "📊 两科水平接近，整体均衡";
    html += `</div>`;
    return eaResp("⚖️ 科目对比", html);
  }

  // 默认返回班级对比
  return generateClassRankingAnswer(ctx);
}

// 真正无法识别时的兜底回复
function generateFallbackAnswer(ctx) {
  const { allRecs, subjects, stats, totalFullScore, totalStats, selectedExam, rawQ } = ctx;

  let html = `<p>抱歉，我没有理解您的问题。</p>`;
  html += `<p>您问的是：「<b>${esc(rawQ)}</b>」对吗？</p>`;
  html += `<p>我可以帮您分析这些问题：</p>`;
  html += `<ul class="emc-list">`;
  html += `<li>📊 <b>成绩统计</b>："各科目优秀率"、"年级均分是多少"、"这次考试怎么样"</li>`;
  html += `<li>🏆 <b>班级排名</b>："哪个班总分最高"、"班级排名情况"</li>`;
  html += `<li>👨‍🎓 <b>学生关注</b>："有哪些偏科学生"、"不及格学生有哪些"</li>`;
  html += `<li>📚 <b>科目分析</b>："各科目得分率排名"、"哪科最弱"、"数学分析"</li>`;
  html += `<li>📈 <b>分布情况</b>："成绩分布如何"、"分段人数统计"</li>`;
  html += `<li>🔄 <b>进退步</b>："这次比上次进步了多少"、"哪些学生进步明显"</li>`;
  html += `<li>💡 <b>教学建议</b>："有什么建议"、"怎么提升成绩"</li>`;
  html += `<li>🏫 <b>班级查询</b>："3班成绩怎么样"</li>`;
  html += `<li>👤 <b>学生查询</b>："张三考了多少分"</li>`;
  html += `<li>📐 <b>离散度</b>："标准差是多少"、"分化程度如何"</li>`;
  html += `</ul>`;

  return eaResp("🤖 未能理解您的问题", html);
}

function generateDefaultAnswer(ctx) {
  const { allRecs, subjects, stats, totalFullScore, totalStats, selectedExam } = ctx;
  const classList = [...new Set(allRecs.map(r => r.classNo))].sort();
  const sortedByRate = subjects.map(s => ({name:s.name, rate:stats[s.name].avg/s.fullScore*100}))
    .sort((a,b) => b.rate - a.rate);

  let html = `<p>这是「${selectedExam.name}」的智能分析报告：</p>`;
  html += `<div class="emc-highlight">`;
  html += `📊 参考人数：${allRecs.length} 人（${classList.length}个班）<br>`;
  html += `📈 总分均分：${fmt(totalStats.avg, 1)} / ${totalFullScore}（${fmt(totalStats.avg/totalFullScore*100,1)}%）<br>`;
  html += `🏆 最高分：${fmt(totalStats.max, 1)} 分<br>`;
  html += `📚 优势学科：${sortedByRate[0].name}（${fmt(sortedByRate[0].rate,1)}%）<br>`;
  html += `⚠️ 薄弱学科：${sortedByRate[sortedByRate.length-1].name}（${fmt(sortedByRate[sortedByRate.length-1].rate,1)}%）`;
  html += `</div>`;

  html += `<p>您可以这样问我：</p><ul class="emc-list">`;
  html += `<li>"各科目的优秀率是多少？"</li>`;
  html += `<li>"哪个班总分最高？"</li>`;
  html += `<li>"有哪些偏科学生？"</li>`;
  html += `<li>"成绩分布怎么样？"</li>`;
  html += `<li>"XXX同学这次考了多少分？"</li>`;
  html += `<li>"标准差是多少？分化严重吗？"</li>`;
  html += `<li>"有什么教学建议？"</li>`;
  html += `<li>"前20名有哪些人？"</li>`;
  html += `</ul>`;

  return eaResp("🤖 智能分析报告", html);
}

// 页面加载完成后初始化助手（默认隐藏，登录后显示）
document.addEventListener("DOMContentLoaded", () => {
  const btn = $("eduAssistantBtn");
  const panel = $("eduAssistant");
  if (btn) btn.style.display = "none";
  if (panel) panel.classList.add("hidden");
});

// 监听 localStorage 变化，自动同步数据（多标签页数据同步）
window.addEventListener("storage", (e) => {
  if (e.key === DB_KEY && e.newValue && currentUser) {
    try {
      DB = JSON.parse(e.newValue);
      // 保持当前用户登录状态
      const user = DB.users.find((u) => u.id === currentUser.id);
      if (user) currentUser = user;
      // 重新渲染当前页面
      if (currentPage) {
        const render = PAGE_RENDERERS[currentPage];
        if (render) render();
      }
    } catch (err) {
      console.log("数据同步失败:", err);
    }
  }
});

// 定时刷新数据（每30秒自动从 localStorage 刷新一次，确保数据最新）
setInterval(() => {
  if (!currentUser) return;
  const savedDB = localStorage.getItem(DB_KEY);
  if (!savedDB) return;
  try {
    const newDB = JSON.parse(savedDB);
    // 比较记录数量或已确认记录数量，有变化才更新
    const oldConfirmed = (DB.records || []).filter(r => r.status === "confirmed").length;
    const newConfirmed = (newDB.records || []).filter(r => r.status === "confirmed").length;
    if (newDB.records && (newDB.records.length !== (DB.records || []).length || newConfirmed !== oldConfirmed)) {
      DB = newDB;
      const user = DB.users.find((u) => u.id === currentUser.id);
      if (user) currentUser = user;
      if (currentPage) {
        const render = PAGE_RENDERERS[currentPage];
        if (render) render();
      }
    }
  } catch (err) {
    // 忽略解析错误
  }
}, 30000);

