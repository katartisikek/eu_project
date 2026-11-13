# ΤΕΧΝΙΚΟΣ ΦΑΚΕΛΟΣ ΥΛΟΠΟΙΗΣΗΣ & ΟΔΗΓΟΣ ΠΑΡΑΔΟΣΗΣ (IT HANDOVER)
## Διαδικτυακή Πλατφόρμα Dissemination Monitoring & Reporting
**Φορέας:** Τεχνικές Σχολές Επιμελητηρίου Ηρακλείου (TIHC)  
**Πιλοτικό Έργο Αναφοράς:** `IN-BOUND` (`2025-1-FI01-KA220-VET-000352154`)  

---

## 1. Αρχιτεκτονική Εφαρμογής & Τεχνολογική Επιλογή (Ενότητα 13)

Η πλατφόρμα σχεδιάστηκε και υλοποιήθηκε ως **Ανεξάρτητη Διαδικτυακή Εφαρμογή (Standalone Web Application)** με σχεσιακή βάση δεδομένων SQLite (`node:sqlite`), έτοιμη να φιλοξενηθεί σε subdomain (π.χ. `dissemination.katartisi.gr` ή `dissemination.tihc.gr`) και να συνδεθεί απευθείας μέσω συνδέσμου από το κεντρικό website των Ευρωπαϊκών Προγραμμάτων του TIHC.

### Γιατί προτιμήθηκε η Ανεξάρτητη Εφαρμογή σε Subdomain έναντι WordPress Plugin:
1. **Ασφάλεια & Απομόνωση Δεδομένων (Ενότητα 12):** Οι εξωτερικοί εταίροι από διαφορετικές χώρες (Φινλανδία, Πορτογαλία, Τουρκία, Βουλγαρία κ.ά.) συνδέονται σε ανεξάρτητο σύστημα χωρίς να αποκτούν λογαριασμούς (`wp_users`) στον κεντρικό ιστότοπο WordPress του φορέα.
2. **Πραγματική Σχεσιακή Βάση Δεδομένων:** Αντί για «ένα Excel μέσα στο website», το σύστημα διαθέτει 10 σχεσιακούς πίνακες με ακεραιότητα ξένων κλειδιών (`FOREIGN KEYS`), ιστορικό εκδόσεων αποδεικτικών (`evidence_files.version`) και πλήρες `Audit Trail`.
3. **Διαχείριση Όγκου Αρχείων Evidence:** Τα εκατοντάδες screenshots, φωτογραφίες εκδηλώσεων και PDF αποθηκεύονται δομημένα ανά έργο και δράση, με δυνατότητα αυτόματης συμπίεσης σε `Evidence Package (.zip)` ανά εταίρο και κωδικό δραστηριότητας.

---

## 2. Σχήμα Σχεσιακής Βάσης Δεδομένων (`data/dissemination_platform.sqlite`)

| Πίνακας | Περιγραφή & Βασικά Πεδία |
| :--- | :--- |
| `projects` | Στοιχεία ευρωπαϊκών προγραμμάτων (`acronym`, `title`, `project_number`, `start_date`, `end_date`, `coordinator_name`, `dissemination_leader`, `categories_json`, `target_groups_json`). |
| `partners` | Εταίροι ανά πρόγραμμα (`project_id`, `code`, `name`, `country`, `country_code`, `role`, `contact_person`, `contact_email`, `logo_url`). |
| `reporting_periods` | Περίοδοι αναφοράς (`RP1-INTERIM`, `RP2-FINAL`, ημερομηνίες έναρξης/λήξης και προθεσμίες). |
| `users` | Χρήστες και δικαιώματα 4 ρόλων (`SUPER_ADMIN`, `DISSEMINATION_MANAGER`, `PARTNER_EDITOR`, `REVIEWER`) με αντιστοίχιση σε `partner_code` και `project_ids_json`. |
| `kpis` | Δείκτες διάχυσης ανά έργο (`code`, `title`, `metric_type`, `target_value`, `unit`) με δυναμικό υπολογισμό καταγεγραμμένης και εγκεκριμένης επίδοσης. |
| `activities` | Πλήρης εγγραφή δραστηριότητας με **11 διαχωρισμένες αριθμητικές μετρικές** (`metric_reach`, `metric_views`, `metric_impressions`, `metric_likes`, `metric_comments`, `metric_shares`, `metric_clicks`, `metric_newsletter_recipients`, `metric_newsletter_opens`, `metric_event_participants`, `metric_orgs_reached`), προσαρμοζόμενα πεδία, σημαίες εγκυρότητας (`validation_warnings_json`, `missing_evidence_flag`) και κατάσταση ροής ελέγχου (`Draft`, `Submitted`, `Needs Revision`, `Approved`). |
| `evidence_files` | Αποδεικτικά αρχεία συνδεδεμένα με τη δραστηριότητα (`activity_id`, `version`, `is_original`, `version_notes`, `file_path`), διασφαλίζοντας ότι τα πρωτότυπα αρχεία (`v1`) δεν διαγράφονται κατά την ανάρτηση νεότερων εκδόσεων (`v2`, `v3`). |
| `activity_comments` | Ιστορικό σχολίων και παρατηρήσεων ελέγχου ανά δραστηριότητα. |
| `email_notifications` | Καταγραφή αυτοματοποιημένων και στοχευμένων υπενθυμίσεων email προς τους εταίρους. |
| `audit_logs` | Αμετάβλητο ιστορικό ενεργειών (`Audit Trail`) με χρονική σήμανση, χρήστη, ρόλο και λεπτομέρειες αλλαγής. |

---

## 3. Αποτελέσματα Εισαγωγής & Ελέγχου του «Dissemination Log IN-BOUND.xlsx»

Κατά την ενσωμάτωση του πραγματικού αρχείου `Dissemination Log IN-BOUND.xlsx` (6 φύλλα, 124 ενεργές δραστηριότητες, 109 ενσωματωμένα αρχεία εικόνων/screenshots):

| Εταίρος (Φύλλο Excel) | Χώρα | Σύνολο Δράσεων | Με Ενσωματωμένο Screenshot | Ελλείψεις Evidence (Missing Evidence) | Κύρια Ευρήματα Validation Engine |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **In-Bound Platform** | EU | **24** | 24 | **0** | Πλήρη screenshots· διαχωρίστηκαν οι σύνθετες μετρικές 90 ημερών (Row 28). |
| **TAMPEREEN KAUPUNKI** | FI | **5** | 4 | **1** | Διαχωρίστηκαν αυτόματα τα κείμενα `"822 impressions"` και `"1667 views 77 reactions 4 reposts"` στις αντίστοιχες αριθμητικές στήλες. |
| **Mindshift** | PT | **15** | 3 | **12** | 12 καταχωρίσεις διαθέτουν URL αλλά στερούνται screenshot analytics· επισημάνθηκε η ημερομηνία `"16/06/206"` (Row 15). |
| **TIHC** | GR | **16** | 13 | **3** | 3 καταχωρίσεις εκδηλώσεων/newsletter χωρίς screenshot ή με `"-"` στο πεδίο URL. |
| **PENDIK** | TR | **12** | 10 | **2** | Επισημάνθηκαν 2 εγγραφές με κείμενο `"PENDIK VET is not able to reach the numbers"` και ασυμφωνία ημερομηνίας `"28/12/2025 (28th of November,2025)"`. |
| **BFE** | BG | **52** | 18 | **34** | 34 καταχωρίσεις χωρίς screenshot/URL και 1 εγγραφή με γενική ετήσια επισκεψιμότητα (`"44000 visitors for the last year"`). |
| **ΣΥΝΟΛΟ IN-BOUND** | **6** | **124** | **72** | **52** | **100% μεταφορά χωρίς απώλεια δεδομένων ή αυθαίρετες παραδοχές.** |

---

## 4. Οδηγίες Εκκίνησης & Χρήσης

1. **Τοπική Εκκίνηση:**
   * Εκτελέστε το αρχείο `START_PLATFORM.bat` ή τρέξτε `node server.js` στον φάκελο του έργου.
   * Ανοίξτε τον φυλλομετρητή στη διεύθυνση `http://localhost:3080`.
2. **Έτοιμα Εξαγόμενα Αρχεία (`exports/`):**
   * `exports/IN-BOUND_Dissemination_Log_Export.xlsx`: Το πλήρες εξαγόμενο αρχείο Excel με 7 φύλλα (Συγκεντρωτικό + 6 Εταίροι) και διαχωρισμένες μετρικές.
   * `exports/IN-BOUND_Evidence_Package.zip`: Το πλήρες πακέτο αποδεικτικών ταξινομημένο ανά `Εταίρο / Κωδικό_Δράσης / v1_εικόνα` μαζί με το `MANIFEST_Activities_and_Evidence.csv`.

