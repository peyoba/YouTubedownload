# syntax=docker/dockerfile:1
FROM python:3.12-slim

# 安装 ffmpeg（合并视频/转 MP3 需要）
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先装依赖，利用 Docker 缓存
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY . .

ENV PYTHONUNBUFFERED=1 \
    PORT=8000 \
    HOST=0.0.0.0

EXPOSE 8000

# 单 worker + 多线程：subprocess 阻塞型任务用线程更合适，
# 且内存中的 tasks 字典需要在同一进程内共享
CMD ["sh", "-c", "gunicorn -w 1 --threads 8 -k gthread -b 0.0.0.0:${PORT} --timeout 900 --access-logfile - app:app"]
