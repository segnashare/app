# Plan : non-retour emprunt — pénalités, mise en demeure, indemnité, recouvrement

> Statut : **planification** (non déployé en prod).  
> Témoin dev : `scripts/fixtures/borrow-overdue-witness-prod-snapshot.json` (export prod 2026-06-24, cart `593a6583-…`).

## 1. État actuel (gap analysis)

| Capacité | Aujourd’hui | Cible |
|----------|-------------|-------|
| Pénalités J+1→J+14 | ✅ Cron + Stripe off-session | Continuer + **plafond contractuel post-J14** |
| Escalade J+15 | ✅ `cart_disputes` + `disputed` | Ops + **message mise en demeure imminente** |
| Pénalités après J+14 | ❌ Arrêt net (`late_day > 14`) | **Continuer** jusqu’à restitution ou plafond |
| Mise en demeure formelle | ❌ | **J+21** (AR24) — pas de seuil montant |
| Indemnité non-restitution | ❌ | Après expiration délai MED |
| Frais de traitement modérés | ❌ | Optionnel, montant fixe CGU |
| Retries PI + recovery | ❌ (failed → statut jour) | Machine à états + on-session SCA |
| Suspension compte | ❌ | **J+1** : modale blocage app (= suspension) |
| BO résolution litige | ❌ (table read-only) | Workflow complet |
| Retour après prélèvement | ❌ | Règle remboursement CGU |

**Bug structurel actuel** : dès `cart.status = disputed`, `accrue_cart_borrow_overdue_day` skip (`confirmed`/`archived` only) → plus aucune pénalité ni résolution auto si retour tardif.

---

## 2. Trois couches contractuelles (CGU + produit)

Lexique UX recommandé (éviter « punition ») :

1. **Frais de retard** — journaliers, tant que le retour n’est pas effectué (3 % J1-7, 5 % J8+ **maintenu après J+14**, **plafond = 100 %** de la valeur panier).
2. **Indemnité de non-restitution** — valeur du panier (ou pièces manquantes) si, **après mise en demeure + délai**, pas de retour.
3. **Frais de traitement du non-retour** — forfait TTC par panier non restitué (en **plus** de la valeur des pièces et des frais de retard plafonnés) :
   - panier **&lt; 100 €** → **19,99 € TTC** (`1999` cts) ;
   - panier **≥ 100 €** → **29,99 € TTC** (`2999` cts).

CGU à mettre à jour (`conditions-generales-location`) :
- continuité des frais de retard post-J14 avec plafond ;
- déclenchement MED et délai (7 ou 14 j selon tranche) ;
- tentative de prélèvement sans renoncer au retour ultérieur ;
- règle remboursement si retour après indemnité (valeur panier remboursée, frais de retard + traitement conservés) ;
- recouvrement si échec paiement persistant.

---

## 3. Machine à états — dossier `cart_borrow_overdue`

Nouveau champ recommandé : `recovery_phase` (enum) + tables satellites.

```
active                    → pénalités quotidiennes (phase 1)
app_restricted            → J+1 : modale blocage app (= suspension UX)
escalated_ops             → J+15 : litige ops BO
formal_notice_pending     → MED programmée
formal_notice_sent        → MED envoyée, délai en cours ; pénalités continuent (plafonnées)
non_restitution_due       → délai MED expiré, prélèvement indemnité planifié
non_restitution_charged   → PI indemnité succeeded (dossier ouvert si retour physique)
payment_recovery          → échec PI, retries + on-session
collection                → recouvrement amiable / injonction
resolved_return           → retour reçu (partiel ou total)
resolved_paid             → soldé sans retour
waived                    → gracieux BO
```

Conserver `cart_disputes` comme ticket BO ; lier `cart_borrow_overdue.cart_dispute_id` + éventuellement `formal_notice_id`.

---

## 4. Parcours temporel

### Phase A — Jusqu’à la mise en demeure

| Jour | Action auto | Ops |
|------|-------------|-----|
| **J+1** | Pénalité + Stripe + notif · **modale blocage app** (suspension) : bouton assistance (`openMemberFeedbackModal`, même pattern que `ExchangeOrderHelpSection`) + lien page Échange (`/exchange`) pour retour ou signalement | — |
| J+2→… | Pénalités quotidiennes (5 % après J+7) jusqu’au **plafond 100 %** valeur panier | — |
| **J+15** | Escalade ops, litige `borrow_return_overdue_escalation`, copy : *« Sans retour, une mise en demeure sera envoyée et la valeur du panier pourra être prélevée »* | File BO |
| **J+21** | Génération PDF MED (backend) + envoi **AR24 API** · `formal_notice_sent_at` · échéance = **`med_sent_at + 10 j`** | — |

### Phase B — Pendant le délai MED

- Panier = **non restitué**, pas **perdu**.
- **Pénalités continuent** à **5 % / jour** jusqu’au **plafond 100 %** valeur panier (si pas déjà atteint).
- Délai de restitution : **10 jours calendaires** à compter de `formal_notice_sent_at` (`deadline_at = sent_at + interval '10 days'`).
- Pas de prélèvement indemnité tant que `now() < deadline_at`.

### Phase C — Expiration délai MED

Tentative unique puis retries :

```
T0   : PI off-session = cart_value_cents + processing_fee_cents
       (processing_fee : 1999 cts si cart_value < 10000, sinon 2999 cts TTC)
T+2  : retry 1
T+5  : retry 2
T+8  : retry 3
→ payment_recovery_required
```

**Cas SCA (`requires_action`)** : pas de retry aveugle → créer `PaymentIntent` on-session / Payment Link / page `/exchange/emprunt/[id]/regulariser` (72 h).

**Cas carte expirée** : bannière + blocage commande + SetupIntent obligatoire.

### Phase D — Échec persistant

| Étape | Action |
|-------|--------|
| PI échec 1 | Email + SMS + bannière app |
| PI échec 2 | Retry + demande MAJ CB |
| PI échec 3 | Compte suspendu + « dernier avis avant recouvrement » |
| J+7 après dernier échec | Dossier `collection` ; <100 € créance interne ; ≥100 € recouvrement amiable |

**Retour après indemnité** : webhook retour logistique → **remboursement 100 % valeur panier** (Stripe Refund sur PI indemnité) ; **frais de retard conservés** ; frais de traitement non remboursés si applicable.

---

## 5. Modèle de données (migrations dev)

### 5.1 `cart_borrow_overdue` (extend)

```sql
-- recovery_phase enum (voir §3)
-- formal_notice_sent_at timestamptz
-- formal_notice_deadline_at timestamptz
-- penalty_cap_cents bigint
-- penalties_accrued_cents bigint  -- running total post-J14
-- non_restitution_charge_cents bigint
-- processing_fee_cents bigint
-- non_restitution_pi_id text
-- recovery_status enum: none | retry_scheduled | requires_action | recovery_required | collection
-- recovery_next_attempt_at timestamptz
-- recovery_attempt_count int
```

### 5.2 `cart_borrow_formal_notices` (new)

```sql
id, cart_id, overdue_id, sent_at, deadline_at, channel (email|sms|both),
template_version, member_email_snapshot, payload jsonb,
ar24_message_id text, ar24_proof_url text, ar24_status text
```

**Intégration AR24** (PR4) :

- **1 compte entreprise Segna** avec CB enregistrée ;
- activation **facturation globale** + accès **API** ;
- **1 modèle PDF MED** généré côté backend (variables : membre, panier, échéance retour, montants) → upload / envoi via **AR24 API** ;
- stocker `ar24_message_id`, statut, URL preuve dans `cart_borrow_formal_notices`.

### 5.3 `cart_borrow_non_restitution_charges` (new)

```sql
id, cart_id, overdue_id, amount_cents, processing_fee_cents,
stripe_payment_intent_id, status (pending|succeeded|failed|requires_action|refunded_partial),
attempt_number, failure_code, created_at
```

### 5.4 `cart_borrow_overdue_days`

- Lever contrainte `late_day_index <= 14` → plafond 60 ou 90.
- RPC `accrue_cart_borrow_overdue_day` : **ne plus stopper à J+14** ; brancher sur `recovery_phase` :
  - J+1→J+14 : inchangé ;
  - J+15 : escalade ops (sans stop pénalités futur) ;
  - post-J14 + avant MED deadline : accrue si sous plafond ;
  - post-MED deadline : skip pénalité, tenter indemnité.

### 5.5 Restriction app (J+1 = « suspension »)

Pas de `users.status = suspended` système pour l’instant — **modale globale** tant qu’un dossier `cart_borrow_overdue` actif/escaladé sans retour engagé :

- Composant : `BorrowOverdueAppGateModal` (layout `(main)`).
- CTA 1 : `openMemberFeedbackModal()` — réutiliser `ExchangeOrderHelpSection` / bulle assistance existante.
- CTA 2 : lien `/exchange` (retour, prolongation, signalement `/commande/[id]/probleme`).
- Navigation ailleurs bloquée sauf profil paiement si charge failed (PR6).

---

## 6. Code — modules à créer / modifier

### segna-app

| Module | Rôle |
|--------|------|
| `lib/emprunt/borrow-overdue-recovery-phase.ts` | Enum + transitions |
| `lib/cron/run-borrow-overdue-accrual.ts` | Phases A–C |
| `lib/cron/run-borrow-formal-notice.ts` | Envoi MED J+21 |
| `lib/ar24/send-formal-notice.ts` | Intégration AR24 (MED recommandée) |
| `lib/cron/run-borrow-non-restitution-charge.ts` | PI indemnité + retries |
| `lib/stripe/borrow-non-restitution-charge.ts` | Off-session + SCA detection |
| `app/.../regulariser/page.tsx` | Flux on-session recovery |
| `components/emprunt/BorrowOverdueAppGateModal.tsx` | Modale blocage J+1 |
| `components/emprunt/BorrowRecoveryBanner.tsx` | Bannière app (recovery PI) |
| `lib/notifications/borrow-formal-notice-notify.ts` | SMS complémentaire post-AR24 |
| `format-borrow-overdue-copy.ts` | Wording CGU-aligned |

### segna-backoffice

| Module | Rôle |
|--------|------|
| `commandes/litiges-retards` | Actions : MED manuelle, waive, forcer charge, clôturer |
| `api/backoffice/borrow-overdue/*` | Transitions BO |
| Label `borrow_return_overdue_escalation` | FR : « Escalade retard retour » |

### n8n (optionnel phase 2)

- Webhook `borrow_formal_notice_sent`, `borrow_non_restitution_failed`, `borrow_collection_eligible`.

---

## 7. Décisions produit — verrouillées

| # | Sujet | Décision |
|---|--------|----------|
| 1 | Plafond frais de retard | **100 %** de la valeur panier |
| 2 | Taux frais de retard | **3 % fixe** par jour (tous J+) |
| 3 | Mise en demeure | **J+21** · **AR24** (PDF backend → API) |
| 4 | Délai post-MED | **10 jours** à compter de `med_sent_at` |
| 5 | Frais de traitement non-retour | **19,99 € TTC** si panier &lt; 100 € · **29,99 € TTC** si ≥ 100 € (en plus valeur pièces + pénalités) |
| 6 | Suspension | **J+1** : modale blocage app · assistance + lien Échange |
| 7 | Retour après indemnité | Remboursement **100 % valeur panier** · **frais de retard conservés** · frais de traitement non remboursés |
| 8 | Escalade ops | **J+15** (litige BO) |
| 9 | AR24 (infra) | 1 compte entreprise Segna · facturation globale · CB · accès API |

### Constantes code (référence PR5)

```ts
export const BORROW_NON_RETURN_PROCESSING_FEE_CENTS_LT_100_EUR = 1999;
export const BORROW_NON_RETURN_PROCESSING_FEE_CENTS_GTE_100_EUR = 2999;
export const BORROW_NON_RETURN_CART_VALUE_THRESHOLD_CENTS = 10_000;
export const BORROW_FORMAL_NOTICE_DEADLINE_DAYS = 10;
```

---

## 8. Plan d’implémentation (PRs)

### PR1 — Fondations ✅ (dev)

- Migration `20260918190000_borrow_overdue_recovery_foundation.sql`
- Fix RPC : `disputed` + résolution retour sur `escalated` + plafond pénalités J1–14
- Modules TS policy / phase / app-gate helper
- `npm run test:borrow-recovery-policy`

### PR2 — Pénalités post-J+14, sans plafond ✅ (dev)

- Migration `20260925120000_borrow_overdue_post_j14_accrual.sql` + `20260925150000_borrow_overdue_remove_penalty_cap.sql`
- RPC : plus de `beyond_day_14` ni `penalty_cap_reached` · escalade J+15 idempotente · accrue illimité (3 %/jour)
- Skip accrue après `formal_notice_deadline_at` (hook PR4)

### PR3 — Modale blocage J+1 + escalade J+15
- `BorrowOverdueAppGateModal` (assistance + `/exchange`)
- BO labels + actions basiques (in_review)
- Notif ops (Slack/n8n)

### PR4 — Mise en demeure AR24 ✅ (dev)
- `lib/ar24/send-formal-notice.ts` — client AR24 (dry-run via `SEGNA_BORROW_FORMAL_NOTICE_DRY_RUN=1`)
- `lib/borrow-formal-notice/` — contenu MED + envoi
- Cron `member-borrow-formal-notice` (10h Paris) · J+21 · `formal_notice_sent_at` + délai 10 j
- Notif complémentaire `borrow_formal_notice_sent` (Resend + SMS)
- Dev : `npm run dev:send-borrow-formal-notice -- <cart_id> --force`

### PR5 — Indemnité non-restitution
- PI off-session = `cart_value_cents` + frais traitement (1999 / 2999 cts)
- Retries T+2/+5/+8

### PR6 — Payment recovery
- Page regularisation on-session (SCA)
- Bannière + suspension renforcée
- États `requires_action`

### PR7 — Recouvrement + retour tardif
- Export dossier collection
- Remboursement partiel post-retour
- Clôture BO

---

## 9. Témoin prod → dev

**Fichier** : `scripts/fixtures/borrow-overdue-witness-prod-snapshot.json`

| Champ | Valeur témoin |
|-------|---------------|
| cart_id | `593a6583-58b0-4046-a1ec-70c059af9e2c` |
| borrow_return_due_at | 2026-06-03 |
| cart_value_cents | 800 (8 pts × 5 cts) |
| 14 j pénalités | 448 cts total, toutes charged |
| late_day snapshot | 21 |
| overdue | escalated / escalated_dispute |
| dispute | open / borrow_return_overdue_escalation |
| return | ready (étiquette, pas déposé) |

**Commandes** :
```bash
node scripts/dev-seed-borrow-overdue-witness.mjs
node scripts/dev-seed-borrow-overdue-witness.mjs --verify   # sur Supabase dev
```

---

## 10. Risques juridiques / Stripe

- **Clause pénale** : plafond + proportionnalité (CC art. 1231-5, B2C abus de droit).
- **MED** : recommandé AR email ; conserver preuve `formal_notices`.
- **Stripe SCA** : tout montant significatif off-session peut exiger authentification → flux on-session obligatoire.
- **Remboursement** : prévoir `Refund` Stripe partiel lié à `cart_borrow_non_restitution_charges`.

---

## 11. Prochaine étape recommandée

1. Rédiger **CGU** alignées §2 + §7 (incl. frais 19,99 / 29,99 € et délai 10 j post-MED).
2. Ouvrir / configurer **compte AR24** (CB + facturation globale + clés API en `.env`).
3. **PR1 en dev** — dire « go PR1 » en Agent mode.
