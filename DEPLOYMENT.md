# Deployment Guide - مصنف النخيل (Palm Classifier)

## Quick Start with Docker

### Prerequisites
- Docker and Docker Compose installed on your server
- At least 4GB RAM (the 5 ConvNeXt models use ~1GB total)
- A Google Gemini API key (get one at https://aistudio.google.com/apikey)

### Step 1: Clone and prepare

```bash
git clone <your-repo-url> palmclassifier
cd palmclassifier
```

### Step 2: Add your model files

Place all 5 ConvNeXt model files in `backend/models/`:

```
backend/models/
├── convnext_small_fold1_best.pth
├── convnext_small_fold2_best.pth
├── convnext_small_fold3_best.pth
├── convnext_small_fold4_best.pth
└── convnext_small_fold5_best.pth
```

### Step 3: Set up environment variables

Create a `.env` file in the project root:

```bash
GEMINI_API_KEY=your_google_gemini_api_key_here
SESSION_SECRET=any_random_string_for_session_security
```

### Step 4: Update the database password

Open `docker-compose.yml` and change the default password:

```yaml
POSTGRES_PASSWORD: your_secure_password_here
```

Make sure to update it in both the `db` service and the `DATABASE_URL` in the `app` service.

### Step 5: Build and run

```bash
docker compose up -d --build
```

The first build takes ~10 minutes (downloading PyTorch CPU, etc.).
After that, the app will be available at `http://your-server:5000`.

### Step 6: Verify it's working

```bash
# Check the app is running
curl http://localhost:5000/api/models

# Check the inference server loaded models (wait ~30 seconds after startup)
docker compose logs app | grep "inference"
```

You should see logs like:
```
[inference] Loaded 5 model folds for ensemble prediction
[inference] Starting inference server on port 5001
```

---

## How It Works

```
Mobile App (Expo Go)
    │
    ▼
Node.js Backend (port 5000)
    │
    ├──► Python Inference Server (port 5001, internal)
    │        └── 5x ConvNeXt Small models → ensemble prediction
    │
    ├──► Google Gemini API
    │        └── Description generation + fallback classification
    │
    └──► PostgreSQL Database
             └── Knowledge base + chat history
```

1. User takes a photo of a date palm
2. Image is sent to the Node.js backend
3. Backend forwards to the Python inference server for ConvNeXt ensemble classification
4. If confidence >= 96%, uses that result + asks Gemini for a description
5. If inference server is unavailable, falls back to Gemini Vision for classification
6. User can then chat about the identified palm variety using RAG-powered AI chat

---

## Server Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM | 2GB | 4GB |
| CPU | 2 cores | 4 cores |
| Disk | 5GB | 10GB |
| GPU | Not needed | Not needed |

The models run on CPU only (PyTorch CPU build). No GPU is required.

---

## Common Commands

```bash
# Start everything
docker compose up -d

# View logs
docker compose logs -f app

# Rebuild after code changes
docker compose up -d --build

# Stop everything
docker compose down

# Stop and remove database data
docker compose down -v
```

---

## Connecting the Mobile App

The Expo mobile app needs to know your server's address. Set the `EXPO_PUBLIC_DOMAIN` environment variable when building or running the app:

```bash
EXPO_PUBLIC_DOMAIN=your-server.com:5000 npx expo start
```

Or if running on a local network:
```bash
EXPO_PUBLIC_DOMAIN=192.168.1.100:5000 npx expo start
```

---

## Using HTTPS (Recommended for Production)

For production, put a reverse proxy like Nginx or Caddy in front:

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    client_max_body_size 10M;

    location / {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Troubleshooting

**Models not loading?**
- Check that all 5 `.pth` files are in `backend/models/`
- Check logs: `docker compose logs app | grep inference`
- The models take ~30 seconds to load on startup

**Out of memory?**
- Each model fold uses ~189MB. All 5 use ~1GB total.
- Make sure your server has at least 2GB free RAM

**Gemini API errors?**
- Verify your `GEMINI_API_KEY` is valid
- The app still works for classification without Gemini (ConvNeXt handles it)
- Gemini is needed for descriptions and the chat feature

**Database connection failed?**
- Wait for the database to be healthy: `docker compose ps`
- Check database logs: `docker compose logs db`
