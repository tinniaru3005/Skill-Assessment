# REChain - AI-Powered Full-Stack Real Estate Platform

*A production-ready real estate platform with AI-powered property search, admin dashboard, and automated scraping — designed as a technical assessment for engineering candidates*

## 🎯 What This Project Is

This is a **full-stack real estate platform** built for evaluating engineering candidates. It demonstrates real-world architecture, AI integration, and modern development practices.


**Core Features:**
- 🔍 AI-powered property search (Firecrawl + GPT-4.1)
- 💬 AI Chat Assistant — conversational property search with streaming, markdown, and inline property cards
- 🏢 Admin dashboard (CRUD operations)
- 📅 Appointment scheduling
- 📊 Real-time analytics
- 🔐 JWT authentication
- 🖼️ Image upload (ImageKit)
- 📧 Email notifications (Brevo)



## Architecture

**Multi-source AI Property Search Pipeline:**

```mermaid
graph TD
    A["React Frontend<br/>(TypeScript + Vite)"] -->|POST /api/ai/search| B["Express Backend<br/>(Node.js + Helmet + CORS)"]
    
    B -->|Build 3 parallel queries| C["Firecrawl API"]
    
    C -->|Query 1:<br/>site:zapimoveis.com| D1["zapimoveis"]  
    C -->|Query 2:<br/>site:vivareal.com.com| D2["vivareal"]
    C -->|Query 3:<br/>site:imovelweb.com.| D3["imovelweb"]
    
    D1 -->|8-10 URLs| E["Parallel<br/>Scraping"]
    D2 -->|8-10 URLs| E
    D3 -->|8-10 URLs| E
    
    E -->|Full browser render<br/>per property| F["Firecrawl<br/>scrapeUrl"] 
    F -->|Structured JSON| G["Backend<br/>Processing"]
    
    G -->|Deduplicate<br/>by address| H["Code-side Filter<br/>Reject rentals/PG"]
    H -->|Clean properties| I["GitHub Models<br/>GPT-4.1"]
    
    I -->|Ranked + Insights| J["Response<br/>to Frontend"]
    
    J -->|Display with<br/>source badges| K["Rich Property<br/>Cards"]
    
    B --> L[("MongoDB<br/>Atlas")]
    C --> M["User API Keys<br/>(localStorage)"]
    F --> N["ImageKit CDN<br/>(Images)"]
    
    style B fill:#4A90E2
    style E fill:#FF6B6B
    style I fill:#7C3AED
    style K fill:#10B981
```

**Complete System Architecture:**

```mermaid
flowchart LR
    subgraph Client["CLIENT LAYER"]
        FE["Frontend<br/>React 18 + TS<br/>Vercel"]
      AD["Admin Panel<br/>React + JS<br/>Vercel"]
    end
    
    subgraph API["API LAYER (Render)"]
        BE["Express.js<br/>Helmet + CORS<br/>Rate Limiter"]
    end
    
    subgraph Data["DATA & SERVICES"]
        DB[("MongoDB Atlas<br/>Database")]
        IK["ImageKit CDN<br/>Images"]
        FC["Firecrawl API<br/>Web Scraping<br/>Multi-source"]
        AI["GitHub Models<br/>GPT-4.1<br/>AI Ranking"]
        EMAIL["Brevo SMTP<br/>Email Service"]
    end
    
    FE -->|Axios| BE
    AD -->|Axios| BE
    BE -->|JWT Auth| DB
    BE -->|Upload| IK
    BE -->|Scrape| FC
    BE -->|Rank Props| AI
    BE -->|Send Mail| EMAIL
    
    style Client fill:#E8F4F8
    style API fill:#F0E8FF
    style Data fill:#FFF4E8
```

<br/>

### 🔑 User-Owned API Keys

Users provide their **own free keys** in the browser. Keys are stored in localStorage only — never on the server.

```
User's browser (localStorage)
  REChain_github_key   = "ghp_xxx"
  REChain_firecrawl_key = "fc-xxx"
         │
         │  X-Github-Key / X-Firecrawl-Key headers
         ▼
  Backend creates per-request service instances
  (Server env keys are NEVER used as fallback)
```

**Get your free keys in ~2 minutes:**

| Service | Link | Free Tier |
|---|---|---|
| GitHub Models (GPT-4.1) | [github.com/marketplace/models](https://github.com/marketplace/models) | Free with any GitHub account |
| Firecrawl (web scraping) | [firecrawl.dev](https://firecrawl.dev) | 500 free credits/month |
<br/>

### 💬 AI Chat Assistant

A conversational assistant at **`/ai-chat`** that lets users ask natural-language
questions ("find me a 3-bedroom flat in Bangalore under 50 lakh"), get a
conversational reply, and — when the message reads as a property search — see
live property cards pulled straight from the database inline in the chat.

- `POST /api/ai/chat` — single-turn JSON reply (message + history + context in, reply + intent + properties out)
- `POST /api/ai/chat/stream` — Server-Sent Events variant of the same turn, streamed token-by-token
- Uses the same **user-owned API keys** as the AI Hub above (`X-Github-Key` / `X-Firecrawl-Key` headers) — no separate setup needed
- Rule-based intent detection decides whether to look up live listings; the AI never invents specific listings/prices that weren't handed to it in context
- See **`APPROACH.txt`** at the repo root for the full write-up (AI choice, prompt engineering, key decisions, trade-offs)

<br/>

### 📊 Admin Dashboard

> Full control — manage listings, track appointments, monitor analytics, and upload images with drag-and-drop.

<div align="center">

| Capability | Description |
| :--------: | :--- |
| ➕ | Add / Edit / Delete property listings with multi-image upload |
| 📅 | Appointment management with status updates & meeting link generation |
| 📈 | Real-time analytics dashboard with Chart.js visualizations |
| 👥 | User management and platform activity monitoring |

</div>

<br/>

## Tech Stack

<div align="center">

### Frontend
React,  TypeScript,  Vite,  Tailwind,  Framer Motion,  React Router
<br/>
### Backend
Node.js,  Express,  MongoDB,  JWT,  Nodemailer
<br/>
### AI & Infrastructure
GPT-4.1,  Firecrawl,  ImageKit,  Vercel,  Render
</div>

<br/>


## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm 8+
- [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) free account (or local MongoDB)
- [ImageKit](https://imagekit.io/) free account (10GB free tier)
- [Brevo](https://www.brevo.com/) free SMTP account (for email notifications)

### 1. Clone the Repository

```bash
Clone the Repo

# Install dependencies per app:
cd backend && npm install
cd ../frontend && npm install
cd ../admin && npm install
```

<details>
<summary><strong> 2. Backend Setup</strong></summary>

<br/>

```bash
cd backend
npm install
cp .env.example .env.local
```

Edit `backend/.env.local` with your actual values:

```env
# Essential Configuration (Required)
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/REChain?retryWrites=true&w=majority
JWT_SECRET=your_super_secure_jwt_secret_here  # Generate with: openssl rand -base64 32
ADMIN_EMAIL=admin@REChain.com
ADMIN_PASSWORD=your_secure_admin_password

# Email Service (Brevo SMTP - Free tier available)
SMTP_USER=your_brevo_smtp_login
SMTP_PASS=your_brevo_smtp_password
EMAIL=your_sender_email@domain.com
BREVO_API_KEY=your_brevo_api_key

# Frontend URL (for CORS + password reset emails)
WEBSITE_URL=http://localhost:5173
FRONTEND_URL=http://localhost:5173
ADMIN_URL=http://localhost:5174
LOCAL_URLS=http://localhost:5173,http://localhost:5174,http://localhost:4000

# Optional: Image Storage (ImageKit - Free 10GB tier)
IMAGEKIT_PUBLIC_KEY=public_your_imagekit_public_key
IMAGEKIT_PRIVATE_KEY=private_your_imagekit_private_key
IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/your_imagekit_id

# Optional: AI Services (for AI Property Hub)
# Users can provide their own keys via frontend, these are server fallbacks
# FIRECRAWL_API_KEY=fc-your_firecrawl_api_key
# GITHUB_MODELS_API_KEY=github_pat_your_github_token
```

```bash
npm run dev   # Starts backend on http://localhost:4000
```

** Get Free API Keys (Optional - for AI features):**
- **MongoDB Atlas**: [cloud.mongodb.com](https://cloud.mongodb.com) - Free 512MB tier
- **ImageKit**: [imagekit.io](https://imagekit.io) - Free 10GB + CDN
- **Brevo SMTP**: [brevo.com](https://brevo.com) - Free 300 emails/day
- **Firecrawl**: [firecrawl.dev](https://firecrawl.dev) - Free 500 pages/month
- **GitHub Models**: [github.com/marketplace/models](https://github.com/marketplace/models) - Free with GitHub account

</details>

<details>
<summary><strong> 3. Frontend Setup</strong></summary>

<br/>

```bash
cd ../frontend
npm install
cp .env.example .env.local
```

Edit `frontend/.env.local`:

```env
# Backend API URL
VITE_API_BASE_URL=http://localhost:4000

# Feature flags
VITE_ENABLE_AI_HUB=true
```

```bash
npm run dev   # Starts frontend on http://localhost:5173
```

</details>

<details>
<summary><strong> 4. Admin Panel Setup</strong></summary>

<br/>

```bash
cd ../admin
npm install
cp .env.example .env.local
```

Edit `admin/.env.local`:

```env
# Backend API URL (must match your backend)
VITE_BACKEND_URL=http://localhost:4000
```

```bash
npm run dev   # Starts admin panel on http://localhost:5174
```

** Access Admin Panel:**
- URL: http://localhost:5174
- Login with credentials from `backend/.env`: `ADMIN_EMAIL` & `ADMIN_PASSWORD`

</details>

<br/>


## API Endpoints

<details>
<summary><strong> Authentication & Users</strong></summary>

<br/>

| Method | Endpoint | Description |
|---|---|---|
| POST | /api/users/register | Register new user |
| POST | /api/users/login | Login (returns JWT) |
| POST | /api/users/admin | Admin login |
| GET | /api/users/me | Get current user (JWT required) |
| POST | /api/users/forgot | Send password reset email |
| POST | /api/users/reset/:token | Reset password |

</details>

<details>
<summary><strong> Products</strong></summary>

<br/>

| Method | Endpoint | Description |
|---|---|---|
| GET | /api/products/list | List all properties |
| GET | /api/products/single/:id | Get property by ID |
| POST | /api/products/add | Add property with images (admin) |
| POST | /api/products/update | Update property (admin) |
| POST | /api/products/remove | Delete property (admin) |

</details>
<details>
<summary><strong> Properties</strong></summary>

<br/>

| Method | Endpoint | Description |
|---|---|---|
| GET | api/locations/:city/trends | Location trends — same rate limit (shares the 10/hr budget) |
| POST | /api/properties/search | Original route (backend format) — also rate-limited |
| POST | /api/ai/search | Alias route for frontend — transforms format, then rate-limits, then searches |
| POST | /api/ai/validate-keys | Validate user-provided API keys before save/use |
| GET | /api/user/properties | User listing routes (auth required) |
| POST | /api/user/properties | User listing routes (auth required) |
| PUT | /api/user/properties/:id | User listing routes (auth required) |
| DELET | /api/user/properties/:id | User listing routes (auth required) |
| GET | /api/rate-limit/stats | Rate limiter stats (for monitoring)  |
| GET | /api/cache/stats | Cache stats (for monitoring MongoDB cache) |

</details>

<details>
<summary><strong> Appointments</strong></summary>

<br/>

| Method | Endpoint | Description |
|---|---|---|
| POST | /api/appointments/schedule | Book viewing (guest) |
| POST | /api/appointments/schedule/auth | Book viewing (logged in) |
| GET | /api/appointments/user | Get appointments by email |
| PUT | /api/appointments/cancel/:id | Cancel appointment |
| GET | /api/appointments/all | All appointments (admin) |
| PUT | /api/appointments/status | Update status (admin) |
| PUT | /api/appointments/update-meeting | Add meeting link (admin) |

</details>

<details>
<summary><strong> AI & Other Services</strong></summary>

<br/>

| Method | Endpoint | Description |
|---|---|---|
| POST | /api/ai/search | AI property search (requires user API keys) |
| GET | /api/locations/:city/trends | Location market trends (requires user API keys) |
| POST | /api/ai/chat | AI Chat Assistant — single-turn reply (requires user API keys) |
| POST | /api/ai/chat/stream | AI Chat Assistant — SSE streaming variant (requires user API keys) |
| POST | /api/forms/submit | Contact form submission |
| GET | /api/admin/stats | Dashboard statistics (admin) |

</details>

<br/>

<details>
<summary><strong> Pre-Deployment Checklist</strong></summary>

<br/>

**Required Services (Free tier available):**
- [ ] **MongoDB Atlas** cluster created → Connection string ready
- [ ] **ImageKit** account → API keys ready (for image uploads)
- [ ] **Brevo SMTP** account → SMTP credentials ready (for emails)

**Environment Setup:**
- [ ] All `.env` files configured with production values
- [ ] `JWT_SECRET` set to secure random string (32+ characters)
- [ ] `ADMIN_EMAIL` and `ADMIN_PASSWORD` set to your admin credentials
- [ ] Frontend `VITE_API_BASE_URL` points to deployed backend
- [ ] Backend `WEBSITE_URL` points to deployed frontend

**Optional (for AI features):**
- [ ] **Firecrawl** API key (500 free pages/month)
- [ ] **GitHub Models** token (free with GitHub account)

</details>

** Alternative Deployment Options:**
- **Backend**: Heroku, Railway, DigitalOcean App Platform, AWS/Google Cloud
- **Frontend**: Netlify, GitHub Pages, Surge.sh
- **Database**: Local MongoDB, DigitalOcean MongoDB, AWS DocumentDB

<br/>

## Project Structure

<details>
<summary><strong>View Full Directory Tree</strong></summary>

<br/>

```text
Real-Estate-Website/
├── frontend/          → User-facing website (React + TypeScript + Vite)
├── admin/             → Admin dashboard (React + Vite)
├── backend/           → REST API server (Node.js + Express)
├── Image/             → README screenshots
└── .github/           → Issue templates, PR template, CODEOWNERS
```

**Frontend src/**

```text
├── components/
│   ├── ai-hub/            → AI Property Hub (search form, results, trends)
│   ├── common/            → Navbar, Footer, SEO, PageTransition
│   ├── home/              → Homepage sections
│   ├── properties/        → Filter sidebar, property cards
│   ├── property-details/  → Gallery, amenities, booking form
│   ├── about/             → About page sections
│   └── contact/           → Contact page sections
├── contexts/              → AuthContext (JWT state management)
├── hooks/                 → useSEO
├── pages/                 → All pages (lazy loaded via React.lazy)
└── services/              → api.ts (Axios client + API key injection)
```

**Backend**

```text
├── config/         → MongoDB, ImageKit, Nodemailer config
├── controller/     → Route handlers (property, appointment, AI search)
├── middleware/      → JWT auth, Multer uploads, stats tracking, request transform
├── models/         → Mongoose schemas (Property, User, Appointment, Stats)
├── routes/         → Express route definitions
├── services/
│   ├── firecrawlService.js  → Smart Zap Imóveis scraping (30+ cities, URL construction, retry logic)
│   └── aiService.js         → GPT-4.1 property analysis + location trends
├── utils/          → AI response validation & safe parsing
└── server.js       → Entry point (Helmet, CORS, rate limiting)
```

**Admin src/**

```text
├── components/     → Login, Navbar, ProtectedRoute
├── config/         → Property types, amenities constants
├── contexts/       → AuthContext (admin JWT state)
└── pages/          → Dashboard, Add, List, Update, Appointments
```

</details>

<br/>

### Available Scripts

| Directory | Command | Description |
|---|---|---|
| backend/ | npm run dev | Start with nodemon (auto-reload) |
| backend/ | npm start | Start production server |
| frontend/ | npm run dev | Start Vite dev server |
| frontend/ | npm run build | Production build |
| admin/ | npm run dev | Start Vite dev server |
| admin/ | npm run build | Production build |

<br/>


<br/>

<br/>


<div align="center">


</div>

