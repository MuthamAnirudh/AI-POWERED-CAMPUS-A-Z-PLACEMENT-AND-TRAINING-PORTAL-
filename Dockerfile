# GovCareer AI Unified: GovCareer (frontend + backend) + Campus Portal (frontend + backend) + FastAPI AI/ML service
# in ONE image. Node serves everything on $PORT; the Campus backend runs internally; the AI/ML service is started
# and supervised by the Campus backend from the virtualenv that is built here (no pip install at first request).
FROM node:20-bookworm-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1
# poppler-utils + tesseract (+ English/Hindi/Telugu packs): scanned-PDF OCR in the GovCareer document pipeline.
# ffmpeg: audio decoding for the interview prosody analysis. python3/venv/build-essential: AI/ML service.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip build-essential ffmpeg poppler-utils \
    tesseract-ocr tesseract-ocr-eng tesseract-ocr-hin tesseract-ocr-tel \
    openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Python deps first (cached layer unless requirements change)
COPY campus/ai-ml-service/requirements.txt campus/ai-ml-service/requirements.txt
RUN python3 -m venv campus/ai-ml-service/.venv \
  && campus/ai-ml-service/.venv/bin/pip install -r campus/ai-ml-service/requirements.txt
COPY package*.json ./
RUN npm install --omit=optional
COPY . .
RUN npx prisma generate --schema=campus/backend/prisma/schema.prisma
# The venv was built above, so the launcher must not try to install anything at runtime.
ENV AI_ML_AUTOINSTALL=false AI_ML_AUTOSTART=true PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm","start"]
