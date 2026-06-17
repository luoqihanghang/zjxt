// ========== GitHub 数据持久化服务 ==========
// 将所有数据存储到 GitHub 个人仓库中，模拟数据库效果
// 使用 CORS 代理解决浏览器跨域限制

const GitHubService = {
  config: null,
  isSyncing: false,
  syncLog: [],
  CORS_PROXY: "https://corsproxy.io/?", // 优先用 corsproxy.io
  useProxy: true,

  init() {
    this.config = {
      token: localStorage.getItem("gh_token") || null,
      owner: localStorage.getItem("gh_owner") || "",
      repo: localStorage.getItem("gh_repo") || "smart-edu-platform",
      branch: localStorage.getItem("gh_branch") || "main",
      dbPath: localStorage.getItem("gh_path") || "data/db.json"
    };
    this.log("GitHub 服务已加载（Token 存储于本地浏览器）");
  },

  log(msg, type = "info") {
    const entry = { time: new Date().toLocaleTimeString(), msg, type };
    this.syncLog.unshift(entry);
    if (this.syncLog.length > 20) this.syncLog.pop();
    console.log(`[GitHub Sync] [${entry.time}] ${msg}`);
  },

  // 配置仓库（用户设置）
  showSetupModal(onSaved) {
    const cfg = this.config;
    showModal("🔗 连接 GitHub 仓库", `
      <p style="color:var(--text-light);margin-bottom:16px;font-size:13px">
        请配置你的 GitHub 仓库信息。Token 会保存在<strong>你自己的浏览器</strong>中，其他用户看不到。
      </p>
      <div class="form-group"><label>GitHub Token <span style="color:var(--text-light);font-weight:normal">（必填，创建后存于你的浏览器）</span></label>
        <input id="gs_token" type="password" value="" placeholder="ghp_xxxxxx（首次配置时填写）" />
      </div>
      <div class="form-row">
        <div class="form-group"><label>仓库所有者（GitHub 用户名）</label>
          <input id="gs_owner" value="" placeholder="your-github-username" />
        </div>
        <div class="form-group"><label>仓库名称</label>
          <input id="gs_repo" value="" placeholder="repo-name" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>分支</label>
          <input id="gs_branch" value="main" placeholder="main" />
        </div>
        <div class="form-group"><label>数据文件路径</label>
          <input id="gs_path" value="data/db.json" placeholder="data/db.json" />
        </div>
      </div>
    `, "保存配置", () => {
      const token = $("gs_token").value.trim();
      if (token) {
        localStorage.setItem("gh_token", token);
        cfg.token = token;
      }
      cfg.owner = $("gs_owner").value.trim();
      cfg.repo = $("gs_repo").value.trim();
      cfg.branch = $("gs_branch").value.trim() || "main";
      cfg.dbPath = $("gs_path").value.trim() || "data/db.json";
      localStorage.setItem("gh_owner", cfg.owner);
      localStorage.setItem("gh_repo", cfg.repo);
      localStorage.setItem("gh_branch", cfg.branch);
      localStorage.setItem("gh_path", cfg.dbPath);
      this.config = cfg;
      showToast("配置已保存到你的浏览器", "success");
      if (onSaved) onSaved();
    });
  },

  // GitHub API 请求（带 CORS 代理支持）
  async api(method, endpoint, body = null) {
    if (!this.config.token || !this.config.owner || !this.config.repo) {
      throw new Error("GitHub 仓库未配置，请先设置");
    }
    const githubUrl = `https://api.github.com${endpoint}`;
    // 用 CORS 代理绕过浏览器限制
    const url = this.useProxy ? `${this.CORS_PROXY}${encodeURIComponent(githubUrl)}` : githubUrl;
    const opts = {
      method,
      headers: {
        "Authorization": `Bearer ${this.config.token}`,
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    };
    if (body) opts.body = JSON.stringify(body);
    let res;
    try {
      res = await fetch(url, opts);
    } catch (e) {
      // 如果代理失败，尝试不用代理
      if (this.useProxy) {
        this.log("⚠️ CORS 代理连接失败，尝试直连...", "warn");
        this.useProxy = false;
        return this.api(method, endpoint, body);
      }
      throw new Error(`网络请求失败: ${e.message}`);
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    return res.status === 204 ? null : res.json();
  },

  // 获取数据文件 SHA（用于更新）
  async getFileSha(path) {
    try {
      const data = await this.api("GET", `/repos/${this.config.owner}/${this.config.repo}/contents/${path}?ref=${this.config.branch}`);
      return data.sha;
    } catch (e) {
      if (e.message.includes("Not Found") || e.message.includes("HTTP 404")) return null;
      throw e;
    }
  },

  // 加载远程数据
  async loadRemoteDB() {
    if (this.isSyncing) return null;
    this.isSyncing = true;
    try {
      const path = this.config.dbPath;
      this.log(`正在从 ${this.config.owner}/${this.config.repo} 加载数据...`);
      const data = await this.api("GET", `/repos/${this.config.owner}/${this.config.repo}/contents/${path}?ref=${this.config.branch}`);
      if (!data.content) throw new Error("仓库中没有数据文件");
      // 正确处理 UTF-8 字符的 base64 解码
      const jsonStr = decodeURIComponent(escape(atob(data.content)));
      const db = JSON.parse(jsonStr);
      this.log("✅ 数据已从 GitHub 加载", "success");
      return db;
    } catch (e) {
      if (e.message.includes("Not Found") || e.message.includes("仓库未配置") || e.message.includes("HTTP 404")) {
        this.log("⚠️ 仓库中暂无数据文件，将使用本地默认数据", "warn");
        return null;
      }
      this.log(`❌ 加载失败: ${e.message}`, "error");
      return null;
    } finally {
      this.isSyncing = false;
    }
  },

  // 保存数据到 GitHub
  async saveRemoteDB(db) {
    if (this.isSyncing) return false;
    this.isSyncing = true;
    try {
      const path = this.config.dbPath;
      const content = JSON.stringify(db, null, 2);
      const base64Content = btoa(unescape(encodeURIComponent(content)));
      this.log(`正在保存数据到 ${this.config.owner}/${this.config.repo}...`);
      const sha = await this.getFileSha(path);
      const payload = {
        message: `📊 更新教务平台数据 - ${new Date().toLocaleString()}`,
        content: base64Content,
        branch: this.config.branch
      };
      if (sha) payload.sha = sha;
      await this.api("PUT", `/repos/${this.config.owner}/${this.config.repo}/contents/${path}`, payload);
      this.log(`✅ 数据已保存到 GitHub (${(content.length / 1024).toFixed(1)} KB)`, "success");
      return true;
    } catch (e) {
      this.log(`❌ 保存失败: ${e.message}`, "error");
      // 不弹 Toast，避免打扰用户，只记录日志
      return false;
    } finally {
      this.isSyncing = false;
    }
  },

  // 尝试创建初始数据文件（首次使用）
  async tryInitFile(db) {
    try {
      const path = this.config.dbPath;
      const content = JSON.stringify(db, null, 2);
      const base64Content = btoa(unescape(encodeURIComponent(content)));
      await this.api("PUT", `/repos/${this.config.owner}/${this.config.repo}/contents/${path}`, {
        message: `📊 初始化教务平台数据 - ${new Date().toLocaleString()}`,
        content: base64Content,
        branch: this.config.branch
      });
      this.log("✅ 初始数据文件已创建", "success");
      return true;
    } catch (e) {
      this.log(`❌ 初始化失败: ${e.message}`, "error");
      return false;
    }
  },

  // 获取同步状态 UI
  getStatusHTML() {
    if (this.isSyncing) {
      return `<span style="color:var(--warning)">🔄 同步中...</span>`;
    }
    if (this.config.owner && this.config.repo) {
      return `<span style="color:var(--success)">✅ 已连接</span>`;
    }
    return `<span style="color:var(--danger)">⚠️ 未连接</span>`;
  },

  // 判断是否已配置
  isConfigured() {
    return !!(this.config.token && this.config.owner && this.config.repo);
  }
};

// 初始化
GitHubService.init();
window.GitHubService = GitHubService;
