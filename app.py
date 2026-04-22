import os
import re
import json
import uuid
import shutil
import subprocess
from pathlib import Path
from threading import Thread, Lock

from flask import Flask, render_template, request, jsonify, send_file, abort

app = Flask(__name__)

BASE_DIR = Path(__file__).parent.resolve()
DOWNLOAD_DIR = BASE_DIR / "downloads"
DOWNLOAD_DIR.mkdir(exist_ok=True)

# 优先使用系统 yt-dlp（通常是最新版本）
YT_DLP = shutil.which("yt-dlp") or "yt-dlp"

tasks = {}
tasks_lock = Lock()

YT_URL_RE = re.compile(
    r"^(https?://)?(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com|music\.youtube\.com)/"
)


def sanitize_filename(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|]', "_", name or "")
    name = name.strip().strip(".")
    return name[:120] if name else "download"


def format_duration(seconds):
    if not seconds:
        return "—"
    seconds = int(seconds)
    h, r = divmod(seconds, 3600)
    m, s = divmod(r, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def yt_dlp_json(url):
    """调用 yt-dlp -J 获取视频元信息"""
    result = subprocess.run(
        [YT_DLP, "-J", "--no-warnings", "--no-playlist", url],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "yt-dlp 解析失败")
    return json.loads(result.stdout)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/info", methods=["POST"])
def api_info():
    url = (request.json or {}).get("url", "").strip()
    if not url or not YT_URL_RE.match(url):
        return jsonify({"error": "请输入有效的 YouTube 链接"}), 400

    try:
        info = yt_dlp_json(url)
    except Exception as e:
        return jsonify({"error": f"获取视频信息失败：{e}"}), 500

    heights = sorted({
        f.get("height") for f in info.get("formats", [])
        if f.get("height") and f.get("vcodec") != "none"
    }, reverse=True)

    return jsonify({
        "title": info.get("title"),
        "thumbnail": info.get("thumbnail"),
        "duration": info.get("duration"),
        "duration_str": format_duration(info.get("duration")),
        "uploader": info.get("uploader") or info.get("channel"),
        "view_count": info.get("view_count"),
        "heights": heights,
    })


def run_download(task_id, url, fmt, quality):
    with tasks_lock:
        tasks[task_id]["status"] = "starting"

    out_tmpl = str(DOWNLOAD_DIR / f"{task_id}.%(ext)s")

    cmd = [
        YT_DLP,
        "--no-warnings",
        "--no-playlist",
        "--newline",          # 每次进度一行，便于解析
        "--progress",
        "-o", out_tmpl,
        "--print-json",       # 结束时打印 JSON
    ]

    if fmt == "mp3":
        q = str(quality) if str(quality).isdigit() else "192"
        cmd += [
            "-x", "--audio-format", "mp3", "--audio-quality", q,
            "-f", "bestaudio/best",
        ]
        final_ext = "mp3"
    else:
        if str(quality).isdigit():
            selector = (
                f"bv*[ext=mp4][height<={quality}]+ba[ext=m4a]/"
                f"b[ext=mp4][height<={quality}]/b[height<={quality}]/b"
            )
        else:
            selector = "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b"
        cmd += [
            "-f", selector,
            "--merge-output-format", "mp4",
        ]
        final_ext = "mp4"

    cmd.append(url)

    # 匹配 yt-dlp 进度行: [download]  12.3% of  4.50MiB at 1.20MiB/s ETA 00:03
    prog_re = re.compile(
        r"\[download\]\s+([\d.]+)%\s+of\s+[~]?([\d.]+)(\w+)"
        r"(?:\s+at\s+([\d.]+)(\w+)/s)?(?:\s+ETA\s+([\d:]+))?"
    )

    def unit_to_bytes(val, unit):
        try:
            val = float(val)
        except Exception:
            return 0
        u = unit.upper()
        return int(val * {"B":1, "KB":1024, "KIB":1024, "MB":1024**2, "MIB":1024**2,
                          "GB":1024**3, "GIB":1024**3}.get(u, 1))

    def eta_to_seconds(s):
        try:
            parts = [int(x) for x in s.split(":")]
        except Exception:
            return None
        if len(parts) == 3:
            return parts[0]*3600 + parts[1]*60 + parts[2]
        if len(parts) == 2:
            return parts[0]*60 + parts[1]
        return parts[0] if parts else None

    last_json = None
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        for line in proc.stdout:
            line = line.rstrip()
            m = prog_re.search(line)
            if m:
                with tasks_lock:
                    t = tasks[task_id]
                    t["status"] = "downloading"
                    t["progress"] = float(m.group(1))
                    if m.group(4):
                        t["speed"] = unit_to_bytes(m.group(4), m.group(5))
                    if m.group(6):
                        t["eta"] = eta_to_seconds(m.group(6))
            elif "[Merger]" in line or "[ExtractAudio]" in line or "Destination:" in line:
                with tasks_lock:
                    if tasks[task_id]["progress"] >= 99:
                        tasks[task_id]["status"] = "processing"
            # 尝试捕获最后一行 JSON（--print-json 输出）
            stripped = line.strip()
            if stripped.startswith("{") and stripped.endswith("}"):
                try:
                    last_json = json.loads(stripped)
                except Exception:
                    pass

        proc.wait()
        if proc.returncode != 0:
            raise RuntimeError(f"yt-dlp 退出码 {proc.returncode}")

        # 定位实际生成的文件
        candidates = sorted(DOWNLOAD_DIR.glob(f"{task_id}.*"), key=lambda p: p.stat().st_mtime, reverse=True)
        target_ext_files = [p for p in candidates if p.suffix.lstrip(".") == final_ext]
        final_path = target_ext_files[0] if target_ext_files else (candidates[0] if candidates else None)
        if not final_path or not final_path.exists():
            raise RuntimeError("未找到下载文件")

        title = (last_json or {}).get("title") or "download"

        with tasks_lock:
            tasks[task_id].update({
                "status": "done",
                "progress": 100,
                "file": final_path.name,
                "title": title,
                "ext": final_path.suffix.lstrip("."),
            })

    except Exception as e:
        with tasks_lock:
            tasks[task_id].update({"status": "error", "error": str(e)})


@app.route("/api/download", methods=["POST"])
def api_download():
    data = request.json or {}
    url = data.get("url", "").strip()
    fmt = data.get("format", "mp4")
    quality = data.get("quality", "best")

    if not url or not YT_URL_RE.match(url):
        return jsonify({"error": "请输入有效的 YouTube 链接"}), 400
    if fmt not in ("mp4", "mp3"):
        return jsonify({"error": "格式必须为 mp4 或 mp3"}), 400

    task_id = str(uuid.uuid4())
    with tasks_lock:
        tasks[task_id] = {
            "status": "pending", "progress": 0, "file": None,
            "error": None, "title": None, "ext": None,
            "speed": 0, "eta": None,
        }

    Thread(target=run_download, args=(task_id, url, fmt, quality), daemon=True).start()
    return jsonify({"task_id": task_id})


@app.route("/api/status/<task_id>")
def api_status(task_id):
    with tasks_lock:
        t = tasks.get(task_id)
    if not t:
        return jsonify({"error": "任务不存在"}), 404
    return jsonify(t)


@app.route("/api/file/<task_id>")
def api_file(task_id):
    with tasks_lock:
        t = tasks.get(task_id)
    if not t or t.get("status") != "done":
        abort(404)
    file_path = DOWNLOAD_DIR / t["file"]
    if not file_path.exists():
        abort(404)
    title = sanitize_filename(t.get("title") or "download")
    ext = t.get("ext") or file_path.suffix.lstrip(".")
    return send_file(file_path, as_attachment=True, download_name=f"{title}.{ext}")


@app.route("/api/cleanup", methods=["POST"])
def api_cleanup():
    with tasks_lock:
        tasks.clear()
    for p in DOWNLOAD_DIR.iterdir():
        try:
            p.unlink() if p.is_file() else shutil.rmtree(p)
        except Exception:
            pass
    return jsonify({"ok": True})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    app.run(host=host, port=port, debug=False)
