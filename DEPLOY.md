# 部署到 Railway

## 方式 A：通过 GitHub（最推荐，零命令行）

### 1. 把代码推到 GitHub
```bash
cd /Users/peyoba/Desktop/web/youtube_downloader
# 在 GitHub 新建一个空仓库（例如 yt-downloader），复制它的 URL
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

### 2. Railway 连接仓库
1. 打开 https://railway.com/new
2. 点 **Deploy from GitHub repo**
3. 授权 Railway 访问 GitHub，选刚推送的仓库
4. Railway 会自动识别 `Dockerfile` 并开始构建
5. 构建完成后进入 **Settings → Networking → Generate Domain**，得到公网 URL
6. 打开这个 URL 就能用了

**首次部署大约 3–5 分钟**（要下载基础镜像、装 ffmpeg、装 Python 包）。

---

## 方式 B：通过 Railway CLI（不推 GitHub）

### 1. 装 CLI 并登录
```bash
brew install railway
railway login   # 浏览器会弹出授权页
```

### 2. 初始化并部署
```bash
cd /Users/peyoba/Desktop/web/youtube_downloader
railway init     # 选 "Empty Project"，起个名字
railway up       # 上传代码并构建
railway domain   # 给服务生成一个公网域名
```

后续每次更新代码后只需重跑 `railway up`。

---

## 环境变量（可选）

Railway 会自动注入 `PORT`，无需你配置。

如果要加其它变量，在 Railway Dashboard → Variables 里添加。

---

## 注意事项

1. **免费计划额度**：Railway 有每月 $5 免费额度，够个人使用很久。超额后服务会暂停。
2. **磁盘**：`downloads/` 目录在容器里是临时的，重启会丢。单用户没事；要持久化可加 Volume。
3. **状态存储**：当前任务状态放内存，重启会丢、多实例不共享。Railway 默认单实例，不受影响。
4. **冷启动**：免费档空闲时不会被彻底杀掉（不像 Render Free），响应较快。
5. **YouTube 防爬**：如遇 403，在 Railway 上更新 yt-dlp 版本即可（改 `requirements.txt` 里版本号后重新部署）。

---

## 本地 Docker 测试（可选）

如果你装了 Docker Desktop，可在推云前先本地跑一遍：
```bash
docker build -t yt-dl .
docker run -p 8080:8080 yt-dl
# 访问 http://127.0.0.1:8080
```
