// ========== Gist 双数据源持久化服务 ==========
// 主 Gist（configGistId）：仅存放基础配置，永久不动
//   文件：smart-edu-config.json
//   内容：users, subjects, announcements, groups, dataGistIds
//
// 业务 Gist（dataGistIds 数组，[0] 为当前活跃）：
//   文件：smart-edu-data.json（索引文件：exams, sends, rankSends）
//         exam-<examId>.json（每个考试独立一个成绩文件）
//   自动归档：当前活跃 Gist 文件数 >= 280 时，创建新 Gist 继续写入
//
// Token：共用一个具备 gist 权限的 GitHub Token
//
// 配置方式（v2）：登录页"⚙️ 设置"面板支持 JSON 上传导入，
// 配置信息仅保存在本地浏览器 localStorage，不会上传到任何服务器。
// 安全说明：Token 等凭据绝不硬编码在源码中，仅通过用户上传 JSON 文件导入。

const GitHubService = {
  // 默认配置模板（仅作占位，不含真实凭据；实际凭据由用户通过 JSON 文件导入）
  DEFAULT_CONFIG: {
    token: "",
    configGistId: "",
    dataGistIds: []
  },

  config: {
    token: null,
    configGistId: null,    // 主 Gist
    dataGistIds: []        // 业务 Gist 数组：[current, archive1, ...]
  },
  isSyncing: false,
  CORS_PROXIES: [
    "https://corsproxy.io/?",
    "https://api.allorigins.win/raw?url=",
    "https://api.codetabs.com/v1/proxy?quest="
  ],
  currentProxyIndex: 0,
  useProxy: false, // 优先直连 GitHub API（原生支持 CORS），失败时自动回退到代理
  CONFIG_FILE: "smart-edu-config.json",
  DATA_META_FILE: "smart-edu-data.json",
  FILE_LIMIT: 280,         // 接近 300 时触发归档

  init() {
    let token = localStorage.getItem("gh_token");
    const configGistId = localStorage.getItem("gh_config_gist_id");
    let dataGistIds = [];
    try { dataGistIds = JSON.parse(localStorage.getItem("gh_data_gist_ids") || "[]"); } catch(e) {}

    // 清理所有非 ISO-8859-1 字符（只保留 ASCII 可见字符：!-~ 及空格）
    token = token ? String(token).replace(/[^\x20-\x7E]/g, "") : "";

    this.config = {
      token: token || null,
      configGistId: configGistId || null,
      dataGistIds: Array.isArray(dataGistIds) && dataGistIds.length ? dataGistIds : []
    };
  },

  log(msg, type = "info") { console.log(`[Gist Sync][${type}] ${msg}`); },

  isConfigured() {
    return !!this.config.token && !!this.config.configGistId;
  },

  // ========= 登录页翻转面板（JSON 上传导入模式，不显示明文） =========
  // 待保存的配置（仅在内存中暂存，不写入界面元素）
  _pendingConfig: null,

  // 更新状态显示区（不暴露任何凭据明文）
  _setStatus(state, text, sub) {
    const area = document.getElementById("gistStatusArea");
    const icon = document.getElementById("gistStatusIcon");
    const txt = document.getElementById("gistStatusText");
    const subEl = document.getElementById("gistStatusSub");
    if (area) {
      area.classList.remove("is-empty", "is-success", "is-error", "is-info");
      if (state) area.classList.add("is-" + state);
    }
    if (icon) icon.textContent = {
      empty: "🗂️", success: "✅", error: "❌", info: "ℹ️"
    }[state] || "🗂️";
    if (txt) txt.textContent = text || "";
    if (subEl) subEl.textContent = sub || "";
  },

  showLoginSetup() {
    document.getElementById("flipCard").classList.add("flipped");
    // 重置待保存配置，初始状态不显示任何明文
    this._pendingConfig = null;
    // 若本地已有配置，提示「已配置」，但不显示具体内容
    if (this.isConfigured()) {
      this._setStatus("success", "已配置", "如需更换，重新上传即可");
    } else {
      this._setStatus("empty", "未导入", "请上传配置文件");
    }
    // 绑定上传按钮（仅绑定一次）
    const uploadBtn = document.getElementById("gistUploadBtn");
    const fileInput = document.getElementById("gist_json_file");
    if (uploadBtn && !uploadBtn._bound) {
      uploadBtn.addEventListener("click", () => fileInput && fileInput.click());
      uploadBtn._bound = true;
    }
    if (fileInput && !fileInput._bound) {
      fileInput.addEventListener("change", (e) => this._handleJsonFile(e));
      fileInput._bound = true;
    }
  },

  // 处理 JSON 文件上传：解析后仅在内存暂存，不在界面显示明文
  _handleJsonFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target.result || "");
      let cfg;
      try {
        cfg = JSON.parse(text);
      } catch (e) {
        this._pendingConfig = null;
        this._setStatus("error", "JSON 格式有误", e.message);
        return;
      }
      const token = (cfg.token || "").trim();
      const configGistId = (cfg.configGistId || "").trim();
      const dataGistIds = Array.isArray(cfg.dataGistIds)
        ? cfg.dataGistIds.map(s => String(s).trim()).filter(Boolean)
        : [];
      if (!token || !configGistId) {
        this._pendingConfig = null;
        this._setStatus("error", "缺少必填字段", "需包含 token 与 configGistId");
        return;
      }
      // 仅在内存暂存，绝不写入界面元素
      this._pendingConfig = { token, configGistId, dataGistIds };
      this._setStatus("success", "上传成功", "点击「保存并返回」生效");
    };
    reader.onerror = () => {
      this._pendingConfig = null;
      this._setStatus("error", "读取失败", "请重试");
    };
    reader.readAsText(file, "utf-8");
    // 重置 input，便于重复选择同一文件
    event.target.value = "";
  },

  flipBackToLogin() {
    document.getElementById("flipCard").classList.remove("flipped");
  },

  // 保存配置（登录页的"设置"面板 - 仅从内存中的 _pendingConfig 读取）
  applyLoginSetup() {
    if (!this._pendingConfig) {
      this._setStatus("info", "未导入", "请先上传配置文件");
      return false;
    }
    let { token, configGistId, dataGistIds } = this._pendingConfig;
    // 只保留 ASCII 可见字符，彻底避免请求头含非 ISO-8859-1 字符
    token = token ? String(token).replace(/[^\x20-\x7E]/g, "") : "";
    configGistId = configGistId ? String(configGistId).replace(/[^\x20-\x7E]/g, "").trim() : "";
    if (!Array.isArray(dataGistIds)) dataGistIds = [];
    dataGistIds = dataGistIds.map(id => String(id).replace(/[^\x20-\x7E]/g, "").trim()).filter(Boolean);

    // 全部写入 localStorage（仅本地浏览器存储）
    localStorage.setItem("gh_token", token);
    localStorage.setItem("gh_config_gist_id", configGistId);
    localStorage.setItem("gh_data_gist_ids", JSON.stringify(dataGistIds));

    this.config.token = token;
    this.config.configGistId = configGistId;
    this.config.dataGistIds = dataGistIds;
    // 清理内存暂存
    this._pendingConfig = null;

    this._setStatus("success", "保存成功", "正在返回登录页...");
    setTimeout(() => this.flipBackToLogin(), 700);
    return true;
  },

  _flash(msg, type) {
    let el = document.getElementById("gistSetupHint");
    if (!el) {
      el = document.createElement("div");
      el.id = "gistSetupHint";
      el.style.cssText = "padding:8px 12px;margin:8px 0;border-radius:6px;font-size:12px;text-align:center;";
      const box = document.getElementById("gistSetupBox");
      const saveBtn = document.getElementById("gistSaveBtn");
      if (box && saveBtn) box.insertBefore(el, saveBtn);
    }
    el.style.background = type === "error" ? "#fee" : "#e6f7ea";
    el.style.color = type === "error" ? "#c00" : "#1a7f37";
    el.textContent = msg;
    setTimeout(() => { el.textContent = ""; el.style.background = "transparent"; }, 3500);
  },

  saveGistConfig(token, configGistId, dataGistId) {
    if (token) {
      token = String(token).replace(/[^\x20-\x7E]/g, "");
      localStorage.setItem("gh_token", token);
      this.config.token = token;
    }
    if (configGistId) {
      localStorage.setItem("gh_config_gist_id", configGistId);
      this.config.configGistId = configGistId;
    }
    // dataGistId 参数保留用于兼容；多行模式下由 applyLoginSetup 自行处理
    if (dataGistId && !this.config.dataGistIds.includes(dataGistId)) {
      this.config.dataGistIds.unshift(dataGistId);
      localStorage.setItem("gh_data_gist_ids", JSON.stringify(this.config.dataGistIds));
    }
  },

  // ========= 通用 Gist API =========
  // 策略：GitHub API 原生支持 CORS，优先直连（更快更稳定）；
  //       直连失败（网络错误）时自动回退到多个 CORS 代理依次尝试；
  //       每次请求最多重试 3 次，带指数退避（1s, 2s, 4s）
  async api(method, gistId, body = null, _attempt = 0) {
    if (!this.config.token) throw new Error("未配置 Token");
    // 兜底清理：确保 Authorization 头只含 ASCII 可见字符
    const token = String(this.config.token).replace(/[^\x20-\x7E]/g, "");
    if (!token) throw new Error("Token 为空");
    const githubUrl = `https://api.github.com/gists/${gistId || ""}`;
    
    // 根据尝试次数选择请求方式：0次直连，1次用代理0，2次用代理1，3次用代理2
    let url = githubUrl;
    let mode = "直连";
    if (_attempt > 0) {
      const proxyIdx = (_attempt - 1) % this.CORS_PROXIES.length;
      url = `${this.CORS_PROXIES[proxyIdx]}${encodeURIComponent(githubUrl)}`;
      mode = `代理${proxyIdx + 1}`;
    }
    
    const controller = new AbortController();
    // 超时时间：第一次15秒，后续逐步增加到30秒
    const timeoutMs = Math.min(15000 + _attempt * 5000, 30000);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    const opts = {
      method,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      signal: controller.signal,
      targetAddressSpace: "public"
    };
    if (body) opts.body = JSON.stringify(body);
    
    try {
      this.log(`[API] ${mode}请求: ${method} ${githubUrl.slice(-30)}... (尝试${_attempt + 1}/3, 超时${timeoutMs}ms)`);
      const res = await fetch(url, opts);
      clearTimeout(timeoutId);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const errMsg = `${err.message || "HTTP " + res.status}（${res.status}）`;
        // 认证错误不重试
        if (res.status === 401 || res.status === 403) {
          throw new Error(`认证失败：${errMsg}，请检查 Token 是否正确`);
        }
        throw new Error(errMsg);
      }
      return res.status === 204 ? null : res.json();
    } catch (e) {
      clearTimeout(timeoutId);
      this.log(`[API] ${mode}失败: ${e.message}`);
      
      if (e.name === "AbortError") {
        // 超时：如果还有重试机会，换方式重试
        if (_attempt < 2) {
          const delay = Math.pow(2, _attempt) * 1000; // 1s, 2s, 4s
          this.log(`[API] 超时，等待${delay}ms后换${_attempt === 0 ? "代理" : "其他代理"}重试...`);
          await new Promise(r => setTimeout(r, delay));
          return this.api(method, gistId, body, _attempt + 1);
        }
        throw new Error(`请求超时（${timeoutMs}ms），请检查网络连接后重试`);
      }
      
      // 网络错误（DNS解析失败、连接重置、网络不可达等）
      const isNetworkError = e.message.includes("Failed to fetch") || 
                             e.message.includes("NetworkError") || 
                             e.message.includes("ERR_CONNECTION") ||
                             e.message.includes("ERR_NAME_NOT_RESOLVED") ||
                             e.message.includes("ERR_TIMED_OUT") ||
                             e.message.includes("ECONNRESET") ||
                             e.message.includes("ETIMEDOUT");
      
      if (isNetworkError && _attempt < 2) {
        const delay = Math.pow(2, _attempt) * 1000; // 1s, 2s, 4s
        this.log(`[API] 网络错误(${e.message.slice(0,30)}...)，等待${delay}ms后换${_attempt === 0 ? "代理" : "其他代理"}重试...`);
        await new Promise(r => setTimeout(r, delay));
        return this.api(method, gistId, body, _attempt + 1);
      }
      
      // 所有重试都失败了，给出诊断信息
      if (isNetworkError) {
        throw new Error(`网络连接失败：${e.message}。请检查：①网络是否正常 ②路由器DNS设置 ③是否需要切换到手机热点或其他网络`);
      }
      
      throw e;
    }
  },

  // 创建一个新 Gist（用于新业务 Gist 归档）
  async createGist(description, initialFiles) {
    const body = {
      description,
      public: false,
      files: initialFiles || { "README.txt": { content: "Smart Education Platform - business data archive" } }
    };
    const res = await this.api("POST", "", body);
    return res;
  },

  // 更新 Gist 中一个/多个文件（删除文件传 content: ""）
  async updateGistFiles(gistId, files, description) {
    if (!gistId) throw new Error("缺少 Gist ID");
    const body = { files };
    if (description) body.description = description;
    return this.api("PATCH", gistId, body);
  },

  // 获取 Gist 详情（含所有文件列表）
  async getGistInfo(gistId) {
    if (!gistId) throw new Error("缺少 Gist ID");
    return this.api("GET", gistId);
  },

  // 读取 Gist 中某个文件的 JSON 内容
  async readGistFile(gistId, filename) {
    try {
      const info = await this.getGistInfo(gistId);
      const file = info.files[filename];
      if (!file) return null;
      // file.content 在 Gist 详情中直接返回（小文件）
      if (file.content) return JSON.parse(file.content);
      // 大文件需要通过 raw_url 再 fetch（带重试和代理回退）
      if (file.raw_url) {
        return await this._fetchRawUrl(file.raw_url);
      }
      return null;
    } catch (e) {
      this.log(`读取 ${gistId}/${filename} 失败: ${e.message}`, "error");
      return null;
    }
  },

  // 内部方法：获取 raw URL，支持重试和代理回退
  async _fetchRawUrl(rawUrl, _attempt = 0) {
    const controller = new AbortController();
    const timeoutMs = Math.min(15000 + _attempt * 5000, 30000);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    let url = rawUrl;
    let mode = "直连";
    if (_attempt > 0) {
      const proxyIdx = (_attempt - 1) % this.CORS_PROXIES.length;
      url = `${this.CORS_PROXIES[proxyIdx]}${encodeURIComponent(rawUrl)}`;
      mode = `代理${proxyIdx + 1}`;
    }
    
    try {
      this.log(`[Raw] ${mode}获取: ${rawUrl.slice(-30)}... (尝试${_attempt + 1}/3)`);
      const raw = await fetch(url, { signal: controller.signal, targetAddressSpace: "public" });
      clearTimeout(timeoutId);
      if (!raw.ok) {
        throw new Error(`HTTP ${raw.status}`);
      }
      const text = await raw.text();
      return JSON.parse(text);
    } catch (e) {
      clearTimeout(timeoutId);
      this.log(`[Raw] ${mode}失败: ${e.message}`);
      
      if ((e.name === "AbortError" || 
           e.message.includes("Failed to fetch") || 
           e.message.includes("NetworkError") ||
           e.message.includes("ERR_CONNECTION")) && _attempt < 2) {
        const delay = Math.pow(2, _attempt) * 1000;
        await new Promise(r => setTimeout(r, delay));
        return this._fetchRawUrl(rawUrl, _attempt + 1);
      }
      
      throw e;
    }
  },

  // ========= 主 Gist（配置）读写 =========
  // 从主 Gist 读取完整配置
  async loadConfigDB() {
    if (!this.isConfigured()) return null;
    this.log("正在从主 Gist 加载系统配置...");
    try {
      const info = await this.getGistInfo(this.config.configGistId);
      // 检查配置文件是否存在
      if (!info.files || !info.files[this.CONFIG_FILE]) {
        // 智能诊断：这个 Gist 里有什么？
        const fileNames = Object.keys(info.files || {});
        const hasExamFile = fileNames.some(n => n.startsWith("exam-"));
        const hasRosterFile = fileNames.some(n => n === "roster.json");
        const hasMetaFile = fileNames.some(n => n === this.DATA_META_FILE);
        if (hasExamFile || hasMetaFile) {
          this.log(`❌ 主 Gist ID 配置错误！这个 Gist 是业务 Gist（包含 ${fileNames.slice(0, 3).join(", ")}），不是主配置 Gist。`, "error");
          this.log(`👉 请重新创建一个新 Gist 用于存储系统配置（应该只包含 ${this.CONFIG_FILE}）`, "error");
          return null;
        } else if (fileNames.length > 0) {
          this.log(`ℹ️ 主 Gist 已有 ${fileNames.length} 个文件，但没有 ${this.CONFIG_FILE}（首次使用，将自动创建）`, "warn");
        } else {
          this.log(`ℹ️ 主 Gist 是空的（首次使用，将自动创建 ${this.CONFIG_FILE}）`, "warn");
        }
        return null;
      }
      // 只读取配置文件（避免下载其他大文件）
      const cfg = await this.readGistFile(this.config.configGistId, this.CONFIG_FILE);
      if (cfg) {
        this.log(`✅ 配置已加载（${cfg.users?.length || 0} 账号、${Object.keys(cfg.subjects || {}).length} 个年级）`);
        // 同步业务 Gist 索引到本地
        if (Array.isArray(cfg.dataGistIds) && cfg.dataGistIds.length) {
          this.config.dataGistIds = cfg.dataGistIds;
          localStorage.setItem("gh_data_gist_ids", JSON.stringify(cfg.dataGistIds));
        } else if (this.config.dataGistIds.length > 0) {
          // 关键修复：本地有业务 Gist ID 但主 Gist 没有，同步到主 Gist
          this.log("⚠️ 本地有业务 Gist ID 但主 Gist 没有，同步到主 Gist");
          cfg.dataGistIds = this.config.dataGistIds;
          await this.saveConfigDB(cfg);
        }
      }
      return cfg;
    } catch (e) {
      this.log(`主 Gist 读取异常: ${e.message}`, "error");
      return null;
    }
  },

  // 写入主 Gist（配置变更时调用）
  // 返回值：true 成功；'partial' 部分成功（大字段被剥离）；false 失败
  async saveConfigDB(configPart) {
    if (!this.isConfigured()) return false;
    // 确保 dataGistIds 与最新配置同步
    // 关键修复：优先使用传入的 dataGistIds，如果为空才使用本地配置的
    // 这样可以避免覆盖主 Gist 中已有的业务 Gist ID 列表
    if (!configPart.dataGistIds || configPart.dataGistIds.length === 0) {
      configPart.dataGistIds = this.config.dataGistIds;
    } else {
      // 合并去重：确保本地配置也包含所有业务 Gist ID
      this.config.dataGistIds = [...new Set([...this.config.dataGistIds, ...configPart.dataGistIds])];
      localStorage.setItem("gh_data_gist_ids", JSON.stringify(this.config.dataGistIds));
    }
    try {
      // 第一次尝试：使用压缩 JSON（无缩进，节省 30-50% 体积）
      const content = JSON.stringify(configPart);
      const files = { [this.CONFIG_FILE]: { content } };
      await this.updateGistFiles(this.config.configGistId, files,
        `网络智慧教务平台 · 系统配置 · ${new Date().toLocaleString()}`);
      this.log("✅ 主 Gist 配置已保存");
      return true;
    } catch (e) {
      const is413 = (e.message || "").includes("413") || (e.message || "").includes("Request Entity Too Large");
      if (is413) {
        this.log("⚠️ 主 Gist 写入触发 413（请求体过大），自动剥离大字段后重试...", "warn");
        // 剥离大字段：studentRoster 是最容易超大的
        const slim = { ...configPart };
        delete slim.studentRoster;
        try {
          const content = JSON.stringify(slim);
          const files = { [this.CONFIG_FILE]: { content } };
          await this.updateGistFiles(this.config.configGistId, files,
            `网络智慧教务平台 · 系统配置(精简) · ${new Date().toLocaleString()}`);
          this.log("✅ 主 Gist 配置已保存（已剥离 studentRoster）");
          // 把学生名单保存到独立的业务文件
          if (configPart.studentRoster && Object.keys(configPart.studentRoster).length > 0) {
            await this.saveRosterToDataGist(configPart.studentRoster);
          }
          return 'partial';
        } catch (e2) {
          this.log(`❌ 精简后仍保存失败: ${e2.message}`, "error");
          return false;
        }
      }
      this.log(`❌ 保存配置失败: ${e.message}`, "error");
      return false;
    }
  },

  // 把学生名单保存到业务 Gist 的独立文件
  async saveRosterToDataGist(roster) {
    try {
      const activeId = await this.ensureCapacity();
      if (!activeId) return false;
      const files = {
        "roster.json": { content: JSON.stringify(roster) }
      };
      await this.updateGistFiles(activeId, files,
        `学生名单 · ${new Date().toLocaleString()}`);
      this.log("✅ 学生名单已保存到业务 Gist");
      return true;
    } catch (e) {
      this.log(`❌ 学生名单保存失败: ${e.message}`, "error");
      return false;
    }
  },

  // 从业务 Gist 读取学生名单
  async loadRosterFromDataGist() {
    for (const gid of this.config.dataGistIds) {
      try {
        const roster = await this.readGistFile(gid, "roster.json");
        if (roster) return roster;
      } catch (e) {
        // 继续尝试下一个 Gist
      }
    }
    return {};
  },

  // ========= 业务 Gist 读写 =========
  getActiveDataGistId() {
    return this.config.dataGistIds[0] || null;
  },

  // 统计某 Gist 的文件数
  async countFiles(gistId) {
    if (!gistId) return 0;
    try {
      const info = await this.getGistInfo(gistId);
      return Object.keys(info.files || {}).length;
    } catch (e) {
      return 0;
    }
  },

  // 检查当前活跃业务 Gist 是否接近上限，必要时创建新 Gist
  async ensureCapacity() {
    const currentId = this.getActiveDataGistId();
    if (!currentId) {
      // 没有业务 Gist，立即创建一个
      return this.createNewDataGist();
    }
    try {
      const count = await this.countFiles(currentId);
      if (count >= this.FILE_LIMIT) {
        this.log(`⚠️ 当前业务 Gist (${currentId.slice(0,8)}...) 文件数 ${count}，接近上限，创建新 Gist...`, "warn");
        return this.createNewDataGist();
      }
      return currentId;
    } catch (e) {
      this.log(`容量检查失败: ${e.message}`, "error");
      // 失败时保守处理：新建一个
      return this.createNewDataGist();
    }
  },

  // 创建新的业务 Gist
  async createNewDataGist() {
    if (!this.config.token) return null;
    try {
      const metaFile = {
        exams: [],
        sends: [],
        rankSends: [],
        createdAt: Date.now(),
        version: "v2"
      };
      const files = {
        [this.DATA_META_FILE]: { content: JSON.stringify(metaFile, null, 2) },
        "README.txt": { content: "网络智慧教务平台 · 业务数据归档 Gist。请勿手动修改文件。" }
      };
      const gist = await this.createGist(
        `网络智慧教务平台 · 业务数据归档 · ${new Date().toLocaleString()}`,
        files
      );
      if (gist && gist.id) {
        // 插入到数组首（成为活跃 Gist）
        this.config.dataGistIds.unshift(gist.id);
        // 保存到本地
        localStorage.setItem("gh_data_gist_ids", JSON.stringify(this.config.dataGistIds));
        // 保存到主 Gist（在 saveConfigDB 会覆盖）
        this.log(`✅ 新业务 Gist 已创建: ${gist.id}`, "success");
        return gist.id;
      }
      return null;
    } catch (e) {
      this.log(`❌ 创建业务 Gist 失败: ${e.message}`, "error");
      return null;
    }
  },

  // 读当前业务 Gist 的索引文件（exams, sends, rankSends）
  async loadDataMeta() {
    const currentId = this.getActiveDataGistId();
    if (!currentId) return { exams: [], sends: [], rankSends: [] };
    const meta = await this.readGistFile(currentId, this.DATA_META_FILE);
    return meta || { exams: [], sends: [], rankSends: [] };
  },

  // 从所有业务 Gist 加载索引文件（合并历史）
  async loadAllDataMeta() {
    const all = { exams: [], sends: [], rankSends: [] };
    for (const gid of this.config.dataGistIds) {
      const meta = await this.readGistFile(gid, this.DATA_META_FILE);
      if (meta) {
        all.exams.push(...(meta.exams || []));
        all.sends.push(...(meta.sends || []));
        all.rankSends.push(...(meta.rankSends || []));
      }
    }
    return all;
  },

  // 从所有业务 Gist 读取所有 exam-*.json → records 数组
  // 【优化】并行读取：先批量获取所有 Gist 的文件列表，再批量并发读取（限制并发数）
  async loadAllRecords() {
    const records = [];
    // 1. 并行获取所有 Gist 的文件列表
    const gistInfos = await Promise.all(
      this.config.dataGistIds.map(async (gid) => {
        try {
          const info = await this.getGistInfo(gid);
          return { gid, files: Object.keys(info.files || {}).filter(name => name.startsWith("exam-") && name.endsWith(".json")) };
        } catch (e) {
          this.log(`读取 ${gid} 文件列表失败: ${e.message}`, "error");
          return { gid, files: [] };
        }
      })
    );
    // 2. 收集所有待读取的文件路径
    const allFiles = [];
    gistInfos.forEach(({ gid, files }) => {
      files.forEach((fname) => {
        allFiles.push({ gid, fname });
      });
    });
    // 3. 批量并发读取（最多 5 个并发，避免超时）
    const CONCURRENCY = 5;
    for (let i = 0; i < allFiles.length; i += CONCURRENCY) {
      const batch = allFiles.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(({ gid, fname }) =>
          this.readGistFile(gid, fname).catch((e) => {
            this.log(`读取 ${gid}/${fname} 失败: ${e.message}`, "error");
            return null;
          })
        )
      );
      batchResults.forEach((recs) => {
        if (Array.isArray(recs)) records.push(...recs);
      });
    }
    return records;
  },

  // 写入当前业务 Gist 的索引文件
  async saveDataMeta(meta) {
    const currentId = this.getActiveDataGistId();
    if (!currentId) return false;
    try {
      // 【优化】索引文件去掉缩进，减少传输体积
      const files = {
        [this.DATA_META_FILE]: { content: JSON.stringify({
          exams: meta.exams || [],
          sends: meta.sends || [],
          rankSends: meta.rankSends || [],
          updatedAt: Date.now(),
          version: "v2"
        }) }
      };
      await this.updateGistFiles(currentId, files,
        `业务数据归档 · 索引更新 · ${new Date().toLocaleString()}`);
      return true;
    } catch (e) {
      this.log(`❌ 保存业务索引失败: ${e.message}`, "error");
      return false;
    }
  },

  // 写入一个考试的成绩文件（examId 决定文件名）
  async saveExamRecords(examId, records) {
    if (!examId) return false;
    // 先确保容量：检查当前活跃 Gist 的文件数，必要时新建
    const activeGistId = await this.ensureCapacity();
    if (!activeGistId) {
      this.log("❌ 无可用业务 Gist（自动创建失败）", "error");
      return false;
    }
    try {
      const filename = `exam-${examId}.json`;
      // 【优化】去掉 JSON 缩进，减少传输体积
      const files = {
        [filename]: { content: JSON.stringify(records) }
      };
      await this.updateGistFiles(activeGistId, files,
        `考试成绩更新：${examId.slice(0,10)}... · ${new Date().toLocaleString()}`);
      return true;
    } catch (e) {
      this.log(`❌ 保存 ${examId}.json 失败: ${e.message}`, "error");
      return false;
    }
  },

  // 一次性完整写入：主 Gist 配置 + 当前业务 Gist 索引 + 每个考试的成绩文件
  // 入参 db 是完整的 DB 对象（users, subjects, exams, records, announcements, sends, rankSends, groups）
  // 【优化】changedExamIds：增量上传。只传有变化的 examId，不传则全量写入（首次/强制同步）
  // onProgress: 可选回调 (info) => void，info = {step, status, timestamp, detail, current, total}
  async saveRemoteDB(db, changedExamIds, onProgress) {
    if (this.isSyncing) return false;
    this.isSyncing = true;
    const startTime = performance.now();
    const report = (step, status, detail, current, total) => {
      if (typeof onProgress === "function") {
        try { onProgress({ step, status, timestamp: Date.now(), detail, current, total }); } catch(e) {}
      }
    };
    try {
      // 0. 先确保业务 Gist 容量（可能会创建新 Gist，更新 dataGistIds）
      report("检查存储容量", "start", "检查业务 Gist 容量…");
      const activeId = await this.ensureCapacity();
      if (!activeId) {
        this.log("❌ 无可用业务 Gist（自动创建失败）", "error");
        report("检查存储容量", "error", "无可用业务 Gist");
        this.isSyncing = false;
        return false;
      }
      report("检查存储容量", "done", "容量检查完成");

      // 1. 主 Gist：配置（每次都写，因为配置变更频繁）
      // 注意：必须在 ensureCapacity 之后，因为 ensureCapacity 可能会更新 dataGistIds
      report("上传系统配置", "start", "写入主 Gist 配置…");
      const configPart = {
        users: db.users || [],
        subjects: db.subjects || {},
        announcements: db.announcements || [],
        groups: db.groups || {},
        studentRoster: db.studentRoster || {},
        studentIdFormat: db.studentIdFormat || {},
        scoreReviews: db.scoreReviews || [],
        gradeNotifications: db.gradeNotifications || [],
        dismissedNotifications: db.dismissedNotifications || {},
        dataGistIds: this.config.dataGistIds,
        version: "v2",
        updatedAt: Date.now()
      };
      const ok1 = await this.saveConfigDB(configPart);
      report("上传系统配置", "done", ok1 === true ? "配置已保存" : (ok1 === 'partial' ? "配置已保存（精简）" : "配置保存异常"));

      // 2. 业务 Gist：索引文件（每次都写，保证 exams/sends 元数据一致）
      report("上传业务索引", "start", "写入考试/成绩发送索引…");
      const meta = { exams: db.exams || [], sends: db.sends || [], rankSends: db.rankSends || [] };
      await this.saveDataMeta(meta);
      report("上传业务索引", "done", `索引已保存（${meta.exams.length} 场考试）`);

      // 3. 业务 Gist：按 examId 分组写成绩文件
      // 【优化】增量模式：若传了 changedExamIds，只写变化的 exam；否则全量写入
      const byExam = {};
      (db.records || []).forEach(r => {
        const k = r.examId;
        if (!byExam[k]) byExam[k] = [];
        byExam[k].push(r);
      });
      const examIdsToWrite = changedExamIds && changedExamIds.length > 0
        ? changedExamIds.filter(id => byExam[id])
        : Object.keys(byExam);

      if (changedExamIds && changedExamIds.length > 0) {
        this.log(`🚀 增量上传：${examIdsToWrite.length}/${Object.keys(byExam).length} 个考试文件需更新`);
      }

      // 【优化】并行写入多个 exam 文件（最多并发 5 个，避免触发 rate limit）
      const CONCURRENCY = 5;
      const totalExams = examIdsToWrite.length;
      let uploadedExams = 0;
      report("上传考试成绩", "start", `开始上传 ${totalExams} 个考试文件…`, 0, totalExams);
      for (let i = 0; i < examIdsToWrite.length; i += CONCURRENCY) {
        const batch = examIdsToWrite.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map((examId) => this.saveExamRecords(examId, byExam[examId]))
        );
        uploadedExams += batch.length;
        report("上传考试成绩", "progress", `已上传 ${uploadedExams}/${totalExams}`, uploadedExams, totalExams);
      }
      report("上传考试成绩", "done", `全部 ${totalExams} 个考试文件已上传`, totalExams, totalExams);

      // 4. 【删除同步】删除云端存在但本地已删除的考试文件
      // 只在全量上传时检查，增量上传跳过（避免额外网络请求拖慢速度）
      if (!changedExamIds || changedExamIds.length === 0) {
        report("清理已删除文件", "start", "检查并清理云端多余文件…");
        const localExamIds = new Set(db.exams.map(e => e.id));
        const localRecordExamIds = new Set((db.records || []).map(r => r.examId));
        const allLocalExamIds = new Set([...localExamIds, ...localRecordExamIds]);

        // 扫描所有业务 Gist，删除多余的 exam 文件
        let deletedCount = 0;
        for (const gid of this.config.dataGistIds) {
          try {
            const info = await this.getGistInfo(gid);
            const files = Object.keys(info.files || {}).filter(name => name.startsWith("exam-") && name.endsWith(".json"));
            const toDelete = files.filter(filename => {
              const examId = filename.replace("exam-", "").replace(".json", "");
              return !allLocalExamIds.has(examId);
            });
            if (toDelete.length > 0) {
              const deleteFiles = {};
              toDelete.forEach(fn => { deleteFiles[fn] = { content: "" }; });
              await this.updateGistFiles(gid, deleteFiles,
                `删除已清理考试数据 · ${new Date().toLocaleString()}`);
              deletedCount += toDelete.length;
              this.log(`🗑️ 删除 ${gid.slice(0,8)} 中 ${toDelete.length} 个多余文件: ${toDelete.join(", ")}`);
            }
          } catch (e) {
            this.log(`删除检查 ${gid} 失败: ${e.message}`, "error");
          }
        }
        report("清理已删除文件", "done", deletedCount > 0 ? `已清理 ${deletedCount} 个多余文件` : "无需清理");
      }

      // 5. 最后再次更新主 Gist，确保 dataGistIds 是最新的
      // 这是关键修复：ensureCapacity 可能创建了新 Gist，需要确保主 Gist 中的 dataGistIds 同步
      report("更新配置索引", "start", "最终同步配置索引…");
      configPart.dataGistIds = this.config.dataGistIds;
      configPart.updatedAt = Date.now();
      await this.saveConfigDB(configPart);
      report("更新配置索引", "done", "配置索引已同步");

      const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
      this.log(`✅ 上传完成，共 ${examIdsToWrite.length} 个考试文件，dataGistIds: ${this.config.dataGistIds.length}，用时 ${elapsed} 秒`);
      return true;
    } catch (e) {
      this.log(`❌ saveRemoteDB 异常: ${e.message}`, "error");
      return false;
    } finally {
      this.isSyncing = false;
    }
  },

  // 从远程加载完整 DB（主 Gist + 所有业务 Gist）
  async loadRemoteDB() {
    if (this.isSyncing) return null;
    this.isSyncing = true;
    try {
      if (!this.isConfigured()) {
        this.log("未配置 Token 或主 Gist ID", "warn");
        return null;
      }
      const cfg = await this.loadConfigDB();
      if (!cfg) {
        this.log("主 Gist 无配置文件", "warn");
        return null;
      }

      this.log(`主 Gist 配置已加载（${cfg.users?.length || 0} 用户，${cfg.dataGistIds?.length || 0} 业务 Gist）`);

      // 如果主 Gist 里没有业务 Gist 配置，尝试创建一个
      // 这是关键修复：新设备登录时，如果主 Gist 中没有 dataGistIds，需要自动创建
      if (!cfg.dataGistIds || cfg.dataGistIds.length === 0) {
        this.log("⚠️ 主 Gist 中无业务 Gist，尝试创建...");
        const newGistId = await this.createNewDataGist();
        if (newGistId) {
          this.log(`✅ 新业务 Gist 创建成功: ${newGistId}`);
          // 更新主 Gist 中的 dataGistIds
          cfg.dataGistIds = [newGistId];
          await this.saveConfigDB({
            ...cfg,
            dataGistIds: [newGistId],
            updatedAt: Date.now()
          });
        } else {
          this.log("❌ 创建业务 Gist 失败", "error");
        }
      }

      // 如果主 Gist 里指定了业务 Gist，也读回来
      const meta = await this.loadAllDataMeta();
      const records = await this.loadAllRecords();
      // 学生名单可能在业务 Gist 中（被自动剥离）
      let studentRoster = cfg.studentRoster || {};
      if (!studentRoster || Object.keys(studentRoster).length === 0) {
        const rosterFromData = await this.loadRosterFromDataGist();
        if (rosterFromData && Object.keys(rosterFromData).length > 0) {
          studentRoster = rosterFromData;
        }
      }

      this.log(`远程数据加载完成：${meta.exams?.length || 0} 考试，${records.length} 成绩记录`);

      // 合并成一个 DB 对象（与原有 initDefaultDB 结构一致）
      return {
        users: cfg.users || [],
        subjects: cfg.subjects || {},
        announcements: cfg.announcements || [],
        groups: cfg.groups || {},
        studentRoster: studentRoster,
        studentIdFormat: cfg.studentIdFormat || {},
        scoreReviews: cfg.scoreReviews || [],
        gradeNotifications: cfg.gradeNotifications || [],
        dismissedNotifications: cfg.dismissedNotifications || {},
        exams: meta.exams || [],
        records: records,
        sends: meta.sends || [],
        rankSends: meta.rankSends || []
      };
    } catch (e) {
      this.log(`❌ loadRemoteDB 异常: ${e.message}`, "error");
      return null;
    } finally {
      this.isSyncing = false;
    }
  }
};

GitHubService.init();
window.GitHubService = GitHubService;
