// GitHub 配置 - Token 永远不写在此文件中！
// Token 由用户在界面中首次配置，存储在用户自己的浏览器 localStorage 中
// 这样其他用户打开页面时看不到任何人的 Token
const GITHUB_CONFIG = {
  token: null, // 从 localStorage["gh_token"] 动态读取，绝不硬编码
  owner: localStorage.getItem("gh_owner") || "",
  repo: localStorage.getItem("gh_repo") || "smart-edu-platform",
  branch: localStorage.getItem("gh_branch") || "main",
  dbPath: localStorage.getItem("gh_path") || "data/db.json"
};
GITHUB_CONFIG.token = localStorage.getItem("gh_token") || null;
window.GITHUB_CONFIG = GITHUB_CONFIG;
