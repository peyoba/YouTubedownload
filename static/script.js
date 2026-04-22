const $ = (id) => document.getElementById(id);

const urlInput = $("url");
const fetchBtn = $("fetchBtn");
const urlError = $("urlError");
const infoCard = $("infoCard");
const progressCard = $("progressCard");
const thumb = $("thumb");
const durationBadge = $("duration");
const titleEl = $("title");
const uploaderEl = $("uploader");
const viewsEl = $("views");
const qualitySel = $("quality");
const formatGroup = $("formatGroup");
const downloadBtn = $("downloadBtn");
const progressFill = $("progressFill");
const progressPercent = $("progressPercent");
const progressStatus = $("progressStatus");
const speedText = $("speedText");
const etaText = $("etaText");
const downloadLink = $("downloadLink");
const errorBox = $("errorBox");

let currentFormat = "mp4";
let videoInfo = null;
let statusTimer = null;

// ========== 工具函数 ==========
function formatBytes(bytes) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(1)} ${units[i]}`;
}

function formatDuration(s) {
  if (!s) return "";
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`
           : `${m}:${String(sec).padStart(2,"0")}`;
}

function formatViews(v) {
  if (!v) return "";
  if (v >= 1e6) return `${(v/1e6).toFixed(1)}M 次观看`;
  if (v >= 1e3) return `${(v/1e3).toFixed(1)}K 次观看`;
  return `${v} 次观看`;
}

function showError(text, where = "url") {
  if (where === "url") {
    urlError.textContent = text;
    urlError.classList.remove("hidden");
  } else {
    errorBox.textContent = text;
    errorBox.classList.remove("hidden");
  }
}

function hideError() {
  urlError.classList.add("hidden");
  errorBox.classList.add("hidden");
}

// ========== 解析视频信息 ==========
async function fetchInfo() {
  const url = urlInput.value.trim();
  if (!url) {
    showError("请输入 YouTube 链接");
    return;
  }
  hideError();
  fetchBtn.disabled = true;
  fetchBtn.textContent = "解析中…";

  try {
    const res = await fetch("/api/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "解析失败");

    videoInfo = data;
    renderInfo(data);
  } catch (e) {
    showError(e.message);
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.textContent = "解析";
  }
}

function renderInfo(d) {
  thumb.src = d.thumbnail || "";
  titleEl.textContent = d.title || "未知标题";
  uploaderEl.textContent = d.uploader || "";
  viewsEl.textContent = formatViews(d.view_count);
  durationBadge.textContent = d.duration_str || formatDuration(d.duration);

  // 填充质量选项
  updateQualityOptions();

  infoCard.classList.remove("hidden");
  progressCard.classList.add("hidden");
  infoCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateQualityOptions() {
  qualitySel.innerHTML = "";
  if (currentFormat === "mp3") {
    [
      ["320", "320 kbps (极高)"],
      ["256", "256 kbps (高)"],
      ["192", "192 kbps (推荐)"],
      ["128", "128 kbps (标准)"],
    ].forEach(([v, label]) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = label;
      if (v === "192") opt.selected = true;
      qualitySel.appendChild(opt);
    });
  } else {
    const opt0 = document.createElement("option");
    opt0.value = "best";
    opt0.textContent = "最佳可用";
    qualitySel.appendChild(opt0);
    const heights = (videoInfo && videoInfo.heights) || [2160, 1440, 1080, 720, 480, 360];
    heights.forEach(h => {
      const opt = document.createElement("option");
      opt.value = String(h);
      opt.textContent = `${h}p`;
      qualitySel.appendChild(opt);
    });
  }
}

// ========== 格式切换 ==========
formatGroup.addEventListener("click", (e) => {
  const btn = e.target.closest(".seg");
  if (!btn) return;
  formatGroup.querySelectorAll(".seg").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  currentFormat = btn.dataset.value;
  updateQualityOptions();
});

// ========== 下载 ==========
downloadBtn.addEventListener("click", startDownload);

async function startDownload() {
  const url = urlInput.value.trim();
  if (!url) return;
  hideError();
  downloadBtn.disabled = true;

  progressCard.classList.remove("hidden");
  progressFill.style.width = "0%";
  progressPercent.textContent = "0%";
  progressStatus.textContent = "提交任务…";
  speedText.textContent = "—";
  etaText.textContent = "—";
  downloadLink.classList.add("hidden");

  try {
    const res = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        format: currentFormat,
        quality: qualitySel.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "任务创建失败");

    pollStatus(data.task_id);
  } catch (e) {
    showError(e.message, "progress");
    downloadBtn.disabled = false;
  }
}

function pollStatus(taskId) {
  clearInterval(statusTimer);
  statusTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/status/${taskId}`);
      const s = await res.json();
      updateProgress(s);
      if (s.status === "done" || s.status === "error") {
        clearInterval(statusTimer);
        downloadBtn.disabled = false;
        if (s.status === "done") {
          downloadLink.href = `/api/file/${taskId}`;
          downloadLink.classList.remove("hidden");
          progressStatus.textContent = "✓ 完成";
          // 自动触发下载
          setTimeout(() => downloadLink.click(), 300);
        } else {
          showError(s.error || "下载失败", "progress");
          progressStatus.textContent = "失败";
        }
      }
    } catch (e) {
      console.error(e);
    }
  }, 800);
}

function updateProgress(s) {
  const p = Math.max(0, Math.min(100, s.progress || 0));
  progressFill.style.width = `${p}%`;
  progressPercent.textContent = `${p.toFixed(1)}%`;

  const statusMap = {
    pending: "排队中…",
    starting: "启动中…",
    downloading: "下载中",
    processing: "处理中（合并/转码）…",
    done: "✓ 完成",
    error: "失败",
  };
  progressStatus.textContent = statusMap[s.status] || s.status;

  if (s.speed) speedText.textContent = `${formatBytes(s.speed)}/s`;
  else speedText.textContent = "—";
  if (s.eta) etaText.textContent = `剩余 ${formatDuration(s.eta)}`;
  else if (s.status === "processing") etaText.textContent = "合并中";
  else etaText.textContent = "—";
}

// ========== Cookies 管理 ==========
const cookiesFileInput = $("cookiesFile");
const cookiesFileName = $("cookiesFileName");
const uploadCookiesBtn = $("uploadCookiesBtn");
const cookiesMsg = $("cookiesMsg");
const cookiesStatus = $("cookiesStatus");

async function checkCookiesStatus() {
  try {
    const res = await fetch("/api/cookies-status");
    const data = await res.json();
    if (data.cookies_present) {
      cookiesStatus.textContent = "✓ Cookies 已配置";
      cookiesStatus.className = "cookies-status-badge cookies-status-ok";
    } else {
      cookiesStatus.textContent = "未配置 Cookies";
      cookiesStatus.className = "cookies-status-badge cookies-status-missing";
    }
  } catch {
    cookiesStatus.textContent = "状态未知";
    cookiesStatus.className = "cookies-status-badge cookies-status-unknown";
  }
}

cookiesFileInput.addEventListener("change", () => {
  const file = cookiesFileInput.files[0];
  if (file) {
    cookiesFileName.textContent = file.name;
    uploadCookiesBtn.disabled = false;
  } else {
    cookiesFileName.textContent = "未选择文件";
    uploadCookiesBtn.disabled = true;
  }
  cookiesMsg.classList.add("hidden");
  cookiesMsg.className = "cookies-msg hidden";
});

uploadCookiesBtn.addEventListener("click", async () => {
  const file = cookiesFileInput.files[0];
  if (!file) return;

  uploadCookiesBtn.disabled = true;
  uploadCookiesBtn.textContent = "上传中…";

  const formData = new FormData();
  formData.append("cookies_file", file);

  try {
    const res = await fetch("/api/upload-cookies", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      cookiesMsg.textContent = "✓ Cookies 上传成功！后续下载将自动使用身份验证。";
      cookiesMsg.className = "cookies-msg success";
      cookiesMsg.classList.remove("hidden");
      checkCookiesStatus();
    } else {
      cookiesMsg.textContent = `上传失败：${data.error || "未知错误"}`;
      cookiesMsg.className = "cookies-msg error";
      cookiesMsg.classList.remove("hidden");
    }
  } catch (e) {
    cookiesMsg.textContent = `上传出错：${e.message}`;
    cookiesMsg.className = "cookies-msg error";
    cookiesMsg.classList.remove("hidden");
  } finally {
    uploadCookiesBtn.disabled = false;
    uploadCookiesBtn.textContent = "上传";
  }
});

// 页面加载时检查 cookies 状态
checkCookiesStatus();

// ========== 事件绑定 ==========
fetchBtn.addEventListener("click", fetchInfo);
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") fetchInfo();
});
urlInput.addEventListener("input", hideError);
