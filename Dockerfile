FROM node:22-slim AS base

RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN python3 -m venv /app/venv
ENV PATH="/app/venv/bin:$PATH"

RUN pip install --no-cache-dir \
    torch torchvision --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir flask flask-cors pillow

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY . .

RUN npm run server:build

EXPOSE 5000

ENV NODE_ENV=production
ENV PORT=5000
ENV INFERENCE_PORT=5001

CMD ["node", "server_dist/index.js"]
