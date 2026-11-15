FROM mcr.microsoft.com/playwright:v1.49.1-jammy

USER root
ENV DEBIAN_FRONTEND=noninteractive PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    TTS_VOICE=af_heart TTS_SPEED=0.98 TTS_ENGINE=kokoro \
    HOME=/tmp XDG_CACHE_HOME=/video/cache/runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3-pip fonts-inter && rm -rf /var/lib/apt/lists/*
RUN python3 -m pip install --no-cache-dir \
    kokoro-onnx==0.4.9 soundfile==0.12.1 numpy==2.2.6
# The base includes browser binaries, but the matching Node client is separate.
RUN mkdir -p /opt/recorder && cd /opt/recorder && \
    npm install --omit=dev --no-audit --no-fund --save-exact playwright@1.49.1
COPY download-models.py /opt/recorder/download-models.py
RUN python3 /opt/recorder/download-models.py
WORKDIR /video
USER pwuser
ENTRYPOINT ["/bin/bash", "/video/in-container.sh"]
