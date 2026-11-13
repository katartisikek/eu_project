# TIHC Dissemination Monitoring & Reporting Platform
## Complete Online Deployment & Operational Management Guide
### Τεχνικές Σχολές Επιμελητηρίου Ηρακλείου (TIHC) — European Projects Unit

---

## 1. Executive Summary & Architecture

The **TIHC Dissemination Monitoring & Reporting Platform** is a unified digital system developed for the Technical Schools of the Chamber of Heraklion to replace disparate Excel dissemination logs across European projects (piloted on **IN-BOUND** — Project No. `2025-1-FI01-KA220-VET-000352154` and multi-project enabled for upcoming initiatives such as **NO ONE BEHIND!**).

### Key Architectural Highlights
- **Bilingual Interface**: **English (`EN`)** as the primary default language for transnational European partners, with an instant one-click toggle to **Greek (`ΕΛ`)**.
- **Zero External Dependencies**: Built with Node.js 22+ using native `node:sqlite`, standard web standards, and pure-JS OpenXML Excel and ZIP engines. No fragile npm build pipelines or native binary compilation (`node-gyp`) required.
- **Strict Metric Separation**: Enforces Sections 4E & 6 of the technical specifications, strictly decoupling unique Reach, Views, Impressions, Reactions, Newsletter Recipients, and Event Participants.
- **Evidence Preservation (v1 Immutability)**: Screenshots, PDFs, and verification files are stored with version tracking. Original files (`v1`) cannot be overwritten.
- **Role-Based Access Control (RBAC)**: 4 distinct security tiers with `scrypt` salted password hashing.

---

## 2. Default Partner Accounts & Credentials

The system comes pre-seeded with dedicated, individual credentials for each participating partner organization:

| Role | Username | Password | Organization / Country | Permissions |
| :--- | :--- | :--- | :--- | :--- |
| **Super Administrator** | `superadmin` | `SuperAdminTIHC2026!` | TIHC (Central Admin) | Full system control, create projects, manage users, database backups, audit trail. |
| **Dissemination Manager** | `manager_tihc` | `ManagerTIHC2026!` | TIHC (Greece) | Manage all partner activities, approve/request revisions, send reminders, export reports. |
| **Partner Editor (Greece)** | `editor_tihc` | `PartnerTIHC2026!` | TIHC (Greece) | Create & edit TIHC activities, upload evidence files, track TIHC KPIs. |
| **Partner Editor (Bulgaria)** | `editor_bfe` | `PartnerBFE2026!` | BFE (Bulgaria) | Create & edit BFE activities, upload evidence files, track BFE KPIs. |
| **Partner Editor (Portugal)** | `editor_mindshift` | `PartnerMindshift2026!` | Mindshift (Portugal) | Create & edit Mindshift activities, upload evidence files, track Mindshift KPIs. |
| **Partner Editor (Finland)** | `editor_tampere` | `PartnerTampere2026!` | Tampere (Finland) | Create & edit Tampere activities, upload evidence files, track Tampere KPIs. |
| **Partner Editor (Türkiye)** | `editor_pendik` | `PartnerPendik2026!` | Pendik (Türkiye) | Create & edit Pendik activities, upload evidence files, track Pendik KPIs. |
| **Reviewer / Auditor** | `reviewer_eu` | `ReviewerEU2026!` | Quality Auditor / Evaluator | Read-only access across all sheets, inspect evidence, audit trail & exports. |

> [!IMPORTANT]
> Advise users to change their initial passwords after their first login via the user management profile.

---

## 3. Online Deployment Options

### Option A: Docker & Docker Compose (Recommended for Production)

Docker is the cleanest and fastest way to deploy the platform on any Linux VPS (Ubuntu, Debian, AlmaLinux, Hetzner, DigitalOcean, AWS, etc.).

#### Step 1: Server Preparation
Install Docker and Docker Compose on your server:
```bash
# Ubuntu / Debian
sudo apt update && sudo apt install -y docker.io docker-compose
sudo systemctl enable --now docker
```

#### Step 2: Upload Files to the Server
Upload or clone the repository to `/var/www/tihc-dissemination`:
```bash
sudo mkdir -p /var/www/tihc-dissemination
cd /var/www/tihc-dissemination
# Copy project files here
```

#### Step 3: Run One-Click Deployment
```bash
chmod +x deploy.sh
./deploy.sh
```
This automatically builds the lightweight Alpine container and mounts the persistent directories (`./data` and `./uploads`).

#### Step 4: Configure Domain & Automated SSL (HTTPS)
To run on your official subdomain (e.g. `dissemination.katartisi.gr`):
1. In your domain DNS manager (Cloudflare, cPanel, or registrar), create an **A Record**:
   - **Host / Name**: `dissemination`
   - **Points to (Value)**: `YOUR_SERVER_PUBLIC_IP`
2. If using Caddy (included in `Caddyfile`):
   ```bash
   DOMAIN=dissemination.katartisi.gr docker-compose up -d
   ```
   Caddy will automatically issue and renew a free Let's Encrypt SSL certificate within 30 seconds.

---

### Option B: Linux VPS with Nginx & Systemd (Direct Node.js 22)

If you prefer running Node.js directly on an existing Linux server:

#### Step 1: Install Node.js 22
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

#### Step 2: Install Systemd Service
```bash
sudo cp systemd/tihc-dissemination.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tihc-dissemination
```

#### Step 3: Setup Nginx Reverse Proxy & SSL
```bash
sudo cp nginx/tihc-dissemination.conf /etc/nginx/sites-available/tihc-dissemination
# Edit server_name to your domain:
sudo nano /etc/nginx/sites-available/tihc-dissemination

sudo ln -s /etc/nginx/sites-available/tihc-dissemination /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Issue free SSL certificate:
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d dissemination.katartisi.gr
```

---

### Option C: Windows Server / Local Network Deployment

1. Make sure Node.js 22+ is installed from [nodejs.org](https://nodejs.org).
2. Double click **`START_PLATFORM.bat`** (or run `node server.js`).
3. The platform is accessible immediately on `http://localhost:3080` or via the server's local IP address (e.g., `http://192.168.1.100:3080`).

---

## 4. Operational Workflows & Daily Management

### For Dissemination Leaders (TIHC):
1. **Monitor Pending Status**: Click on **«⏳ 2. What's Pending by Partner»** to instantly see which partners have missing screenshots, unverified URLs, or pending submissions.
2. **Review & Approve Activities**: Open **«📋 3. Activities Log & Review»**. Click **«🔍 Review / Files»** on any submission to view evidence, add manager feedback, and mark as **Approved** or **Needs Revision**.
3. **One-Click EU Reporting**:
   - Go to **«📥 6. Reports & Exports»**.
   - **Excel Export**: Generates a consolidated `.xlsx` file matching the European Commission dissemination format.
   - **PDF Report**: Generates a formal, printable report with KPI indicators and evidence thumbnails.
   - **Evidence Package ZIP**: Downloads all attached screenshots, PDFs, and photos organized into partner folders with a `MANIFEST.csv`.

### For Partner Editors (BFE, Mindshift, Tampere, Pendik, TIHC):
1. **Log in** with personal credentials. The platform will automatically restrict editing to your organization's entries.
2. Click **«✍️ + New Activity»** or navigate to **«➕ 4. Activity Form»**.
3. Select Activity Type (e.g. Social Media, Newsletter, Event, Press Release). The form adaptively displays only the relevant metric fields.
4. Upload screenshots or verification documents (PDF/PNG/JPG).
5. Confirm the GDPR compliance checkbox and click **Save Activity**.

---

## 5. Backup & Disaster Recovery

Data protection is critical for European project compliance:
- **Database**: Stored in `./data/dissemination_platform.sqlite`.
- **Uploads & Screenshots**: Stored in `./uploads/`.

### Automated Daily Backup via Cron (Linux)
Run `crontab -e` and add the following entry to take daily backups at 02:00 AM:
```bash
0 2 * * * /var/www/tihc-dissemination/backup.sh > /dev/null 2>&1
```

### Manual Backup (Anytime)
- **From Admin UI**: Navigate to **«⚙️ 8. Administration & Audit»** and click **«💾 Download Full SQLite Database Backup (.sqlite)»**.
- **From Shell**: Run `./backup.sh` (Linux) or `backup.bat` (Windows).

---

## 6. Health & Status Endpoints

- **Health Check**: `GET /api/health` -> `{"status":"ok","service":"TIHC Dissemination Monitoring Platform"}`
- **Active Project Summary**: `GET /api/summary?projectId=1`
- **Audit Trail Export**: Accessible by Super Admin and Dissemination Manager under Administration.

