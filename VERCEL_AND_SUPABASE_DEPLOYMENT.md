# Οδηγός Ανάπτυξης στο Vercel & Supabase
## TIHC Dissemination Monitoring & Reporting Platform
### Τεχνικές Σχολές Επιμελητηρίου Ηρακλείου (TIHC)

Η πλατφόρμα είναι **100% έτοιμη** για άμεση ανάπτυξη στο **Vercel** (για το Web Frontend & Serverless APIs) και στο **Supabase** (για τη διαχειριζόμενη Cloud PostgreSQL βάση δεδομένων).

---

## Περιεχόμενα Έτοιμων Αρχείων στο Project

1. **`supabase_schema.sql`**: Έτοιμο SQL script (περιέχει όλους τους πίνακες, constraints, RLS policies και **όλες τις 124 πραγματικές δράσεις, 101 τεκμήρια και 8 χρήστες** του έργου IN-BOUND).
2. **`vercel.json`**: Ρύθμιση Vercel rewrites ώστε όλα τα `/api/*` endpoints να εξυπηρετούνται serverlessly από το `api/index.js`.
3. **`api/index.js`**: Serverless handler συμβατός με Vercel Edge/Node runtimes.
4. **`src/db_adapter.js`**: Έξυπνος προσαρμογέας βάσης που συνδέεται αυτόματα στο Supabase PostgreSQL όταν υπάρχει η μεταβλητή `DATABASE_URL` (και διατηρεί το τοπικό SQLite για offline δοκιμές).
5. **`public/uploads/`**: Όλα τα 109 screenshots και λογότυπα βρίσκονται μέσα στο `public/uploads/` ώστε το Vercel να τα σερβίρει αστραπιαία μέσω του παγκόσμιου Edge CDN του, χωρίς κόστος!

---

## Βήμα 1: Ρύθμιση της Βάσης Δεδομένων στο Supabase (2 λεπτά)

1. Συνδεθείτε στο [Supabase Dashboard](https://supabase.com/dashboard) και πατήστε **"New Project"**.
2. Συμπληρώστε τα στοιχεία του έργου:
   - **Name**: `tihc-dissemination`
   - **Database Password**: Επιλέξτε έναν ισχυρό κωδικό (σημειώστε τον, θα τον χρειαστείτε στο Vercel).
   - **Region**: Επιλέξτε Ευρωπαϊκό Datacenter (π.χ. `Central EU (Frankfurt)`).
   - Πατήστε **Create new project**.
3. Μόλις ολοκληρωθεί η δημιουργία (περίπου 1-2 λεπτά):
   - Μεταβείτε στο μενού **"SQL Editor"** (εικονίδιο με το `>_` στα αριστερά).
   - Πατήστε **"New query"**.
   - Ανοίξτε το αρχείο **`supabase_schema.sql`** από τον φάκελο του project, αντιγράψτε ολόκληρο το περιεχόμενό του και επικολλήστε το στον SQL Editor.
   - Πατήστε το πράσινο κουμπί **Run** (ή `Ctrl + Enter`).
   - *Αποτέλεσμα:* Σε 3-5 δευτερόλεπτα όλοι οι 10 πίνακες έχουν δημιουργηθεί, έχουν ρυθμιστεί τα δικαιώματα (RLS) και έχουν εισαχθεί όλα τα δεδομένα (έργα, εταίροι, χρήστες, KPIs και 124 δράσεις).
4. Αντιγράψτε το Connection String της βάσης:
   - Πηγαίνετε στο **Project Settings** (γρανάζι κάτω αριστερά) -> **Database**.
   - Στην ενότητα **Connection string**, επιλέξτε την καρτέλα **URI**.
   - Επιλέξτε τη μέθοδο **Transaction Pooler (Port 6543)** ή **Direct (Port 5432)**.
   - Αντιγράψτε το connection string, π.χ.:
     ```text
     postgresql://postgres.[PROJECT_REF]:[YOUR_PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
     ```
   - Αντικαταστήστε το `[YOUR_PASSWORD]` με τον κωδικό βάσης που ορίσατε στο βήμα 2.

---

## Βήμα 2: Ανάπτυξη στο Vercel (1 λεπτό)

### Τρόπος Α: Μέσω GitHub (Προτεινόμενος)
1. Ανεβάστε τα αρχεία του project σε ένα GitHub repository (π.χ. `tihc-dissemination`).
2. Μεταβείτε στο [Vercel Dashboard](https://vercel.com/dashboard) και πατήστε **"Add New..." -> "Project"**.
3. Επιλέξτε το repository και κάντε **Import**.
4. Στην καρτέλα **"Environment Variables"**, προσθέστε τη μεταβλητή:
   - **KEY**: `DATABASE_URL`
   - **VALUE**: Το Connection String του Supabase (από το Βήμα 1).
5. Πατήστε **Deploy**!
   - Το Vercel θα ολοκληρώσει το build σε ~30 δευτερόλεπτα και θα σας δώσει το ζωντανό link (π.χ. `https://tihc-dissemination.vercel.app`).

### Τρόπος Β: Μέσω Vercel CLI (Απευθείας από το Τερματικό)
Αν έχετε εγκατεστημένο το `vercel` CLI:
```bash
npm install -g vercel
vercel
# Ακολουθήστε τις οδηγίες στην οθόνη
vercel env add DATABASE_URL
# Επικολλήστε το Connection String του Supabase
vercel --prod
```

---

## Βήμα 3: Σύνδεση με Custom Subdomain (π.χ. `dissemination.katartisi.gr`)

Για να φαίνεται η πλατφόρμα κάτω από το επίσημο website των Ευρωπαϊκών Προγραμμάτων:
1. Στο Vercel Project, πηγαίνετε στα **Settings -> Domains**.
2. Πληκτρολογήστε το subdomain σας (π.χ. `dissemination.katartisi.gr`) και πατήστε **Add**.
3. Το Vercel θα σας δείξει το CNAME record:
   - **Type**: `CNAME`
   - **Name**: `dissemination`
   - **Value / Target**: `cname.vercel-dns.com`
4. Προσθέστε αυτή την εγγραφή στο DNS του φορέα σας (cPanel, Cloudflare, κλπ.).
5. Το Vercel εκδίδει αυτόματα δωρεάν πιστοποιητικό SSL (HTTPS) μέσα σε λίγα λεπτά!

---

## Πίνακας Διαπιστευτηρίων Σύνδεσης Χρηστών

Όλοι οι παρακάτω λογαριασμοί είναι ήδη ενεργοί και αποθηκευμένοι στο Supabase με κρυπτογράφηση `scrypt`:

| Ρόλος | Username | Κωδικός Πρόσβασης | Οργανισμός / Χώρα |
| :--- | :--- | :--- | :--- |
| **Super Administrator** | `superadmin` | `SuperAdminTIHC2026!` | Τεχνικές Σχολές Επιμελητηρίου Ηρακλείου (TIHC) |
| **Dissemination Manager** | `manager_tihc` | `ManagerTIHC2026!` | Τεχνικές Σχολές Επιμελητηρίου Ηρακλείου (TIHC) |
| **Partner Editor (GR)** | `editor_tihc` | `PartnerTIHC2026!` | KEK TIHC (Ελλάδα) |
| **Partner Editor (BG)** | `editor_bfe` | `PartnerBFE2026!` | Business Foundation for Education (Βουλγαρία) |
| **Partner Editor (PT)** | `editor_mindshift` | `PartnerMindshift2026!` | Mindshift Talent Advisory (Πορτογαλία) |
| **Partner Editor (FI)** | `editor_tampere` | `PartnerTampere2026!` | City of Tampere (Φινλανδία) |
| **Partner Editor (TR)** | `editor_pendik` | `PartnerPendik2026!` | Pendik VET High School (Τουρκία) |
| **Reviewer / Auditor** | `reviewer_eu` | `ReviewerEU2026!` | Εξωτερικός Αξιολογητής Ποιότητας |

---

## Πλεονεκτήματα αυτής της Αρχιτεκτονικής

- **Μηδενικό Κόστος Υποδομής (Free Tier)**: Τόσο το Vercel όσο και το Supabase παρέχουν γενναιόδωρα δωρεάν πακέτα που καλύπτουν πλήρως τις ανάγκες διαχείρισης των Ευρωπαϊκών προγραμμάτων.
- **Αυτόματη Παγκόσμια Ταχύτητα (Edge CDN)**: Όλα τα στατικά αρχεία, scripts και εικόνες αποδεικτικών σερβίρονται άμεσα στους Ευρωπαίους εταίρους σε Φινλανδία, Πορτογαλία, Βουλγαρία και Τουρκία από τον πλησιέστερο Edge server.
- **Ασφάλεια & Αντίγραφα Ασφαλείας**: Το Supabase διατηρεί αυτόματα Point-in-Time recovery και αντίγραφα ασφαλείας, ενώ μπορείτε ανά πάσα στιγμή να κατεβάσετε SQL backup από το Supabase Dashboard.
- **Εναλλαγή Γλωσσών**: Κύρια γλώσσα τα Αγγλικά με άμεση επιλογή για Ελληνικά (`🇬🇧 EN` / `🇬🇷 ΕΛ`).

