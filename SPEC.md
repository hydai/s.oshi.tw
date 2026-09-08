# s.oshi.tw — Short-URL Service Specification

## 1. Intent

### Purpose
A community short-URL service for the oshi.tw community, hosted at `s.oshi.tw`. Members submit links to be shortened; an admin reviews and approves them before they go live.

### Users
| Role | Description | Auth |
|------|-------------|------|
| **Visitor** | Clicks short links, browses the public listing | None |
| **Submitter** | Proposes new short URLs via a form | None (public) |
| **Admin** | Approves, rejects, enables, disables mappings | Cloudflare Zero Trust |

### Success Criteria
- Community members can share concise `s.oshi.tw/<slug>` links.
- Admin maintains quality control — no link goes live without approval.
- Opted-in URLs are discoverable via a public listing page.

### Non-Goals
- Click analytics / tracking.
- User accounts or authentication for public users.
- Custom domain support beyond `s.oshi.tw`.
- Link expiration / TTL.
- Spam prevention (rate limiting, CAPTCHA) — rely on Cloudflare's built-in protections.
- Pagination for listing or admin views.

---

## 2. Scope

### Features

#### F1 — Public URL Listing (`GET /`)
Browse approved, enabled, opted-in short URLs.

| Journey | Context → Action → Outcome |
|---------|---------------------------|
| Browse | Visitor opens `s.oshi.tw` → sees a list of public short URLs with title, slug, and description → can click any to follow the redirect. |

#### F2 — URL Submission Form (`GET /new`, `POST /new`)
Submit a new short URL for admin review.

| Journey | Context → Action → Outcome |
|---------|---------------------------|
| Submit | Submitter fills in the form (target URL, title, slug, etc.) → submits → server redirects (302) to a confirmation page showing the submitted slug and its `pending` status. |

**Submission fields:**

| Field | Required | Notes |
|-------|----------|-------|
| `url` | Yes | Target URL to redirect to |
| `title` | Yes | Display title; max 100 characters |
| `slug` | No | Proposed short name; auto-generated if blank |
| `description` | No | Short description for listing; max 200 characters |
| `photo` | No | Image URL for listing card; must be valid HTTP/HTTPS URL if provided |
| `author` | No | Submitter name; max 50 characters |
| `contact` | No | Submitter contact (not displayed publicly); max 100 characters |
| `notes` | No | Message to admin (not displayed publicly); max 500 characters |
| `listed` | No | Opt-in to public listing (default: false) |

#### F3 — Admin Dashboard (`GET /admin`, `POST /admin/api/*`)
Manage all URL mappings behind Cloudflare Zero Trust.

| Journey | Context → Action → Outcome |
|---------|---------------------------|
| Review | Admin opens `/admin` → sees all mappings showing: slug, URL, title, status, listed flag, author, contact, notes, and timestamps → approves or rejects pending entries. |
| Disable | Admin disables a live mapping → redirect stops working, removed from listing. |
| Re-enable | Admin re-enables a disabled mapping → redirect resumes. |

#### F4 — URL Redirect (`GET /<slug>`)
Redirect visitors to the target URL.

| Journey | Context → Action → Outcome |
|---------|---------------------------|
| Redirect | Visitor hits `s.oshi.tw/<slug>` → if mapping is approved + enabled, 302 redirect to target URL. |
| Not found | Visitor hits unknown slug → 404 page. |

### System Boundary
- **Runtime**: Cloudflare Workers
- **Storage**: Cloudflare KV (single namespace)
- **Admin auth**: Cloudflare Zero Trust (Access)
- **No external database, no external APIs**

### Reserved Paths
`/`, `/new`, `/admin`, `/admin/*` — these never resolve as slugs.

---

## 3. Behavior

### 3.1 URL Submission

| Rule | Behavior |
|------|----------|
| **Required fields** | `url` and `title` must be present. Missing required fields → 400 with field-level errors. |
| **URL validation** | Must be a valid HTTP/HTTPS URL. Reject otherwise. |
| **Title validation** | Must be non-empty, max 100 characters. |
| **Optional field validation** | `description` max 200 chars; `photo` must be valid HTTP/HTTPS URL if provided; `author` max 50 chars; `contact` max 100 chars; `notes` max 500 chars. Reject with field-level error if exceeded. |
| **Slug format** | 2–30 characters, counted as characters rather than UTF-16 units. Allowed: `a-z`, `0-9`, Han, Hiragana, Katakana and `ー`, joined by single hyphens. No leading/trailing hyphens. Other scripts are refused so a homograph cannot impersonate an existing slug. |
| **Slug canonicalization** | Slugs are NFKC-normalized and lowercased before validation, storage and lookup, so `MyLink`, `ＭｙＬｉｎｋ` and `mylink` are one link. Invisible characters are refused. |
| **Slug uniqueness** | Reject if slug already exists in KV. |
| **Slug auto-generation** | If blank, generate a random 6-char lowercase alphanumeric slug. Retry up to 5 times on collision. If all retries collide, return 409 asking the submitter to provide a slug manually. |
| **Reserved slugs** | Reject slugs matching reserved paths (`new`, `admin`). |
| **Initial status** | All new submissions start as `pending`. |
| **No redirect until approved** | Pending/rejected/disabled mappings do not redirect. |

### 3.2 Mapping Status Machine

```
 submit        approve        disable
───────► PENDING ───────► APPROVED ───────► DISABLED
             │                                 │
             │ reject              re-enable   │
             ▼                ◄─────────────────
          REJECTED
```

| Transition | From | To | Actor |
|------------|------|----|-------|
| submit | (new) | `pending` | Submitter |
| approve | `pending` | `approved` | Admin |
| reject | `pending` | `rejected` | Admin |
| disable | `approved` | `disabled` | Admin |
| re-enable | `disabled` | `approved` | Admin |

Invalid transitions (e.g., approve a rejected mapping) return 400.

### 3.3 Redirect Behavior

| Condition | Response |
|-----------|----------|
| Slug exists, status = `approved` | `302 Found` → target URL |
| Slug exists, status ≠ `approved` | `404 Not Found` |
| Slug does not exist | `404 Not Found` |
| Path matches reserved path | Route to corresponding handler |

Redirect uses 302 (not 301) so browsers do not permanently cache the target.

### 3.4 Listing Behavior

A mapping appears on the public listing when **both** conditions are true:
1. `status` = `approved`
2. `listed` = `true` (submitter opted in)

Listing shows all matching mappings (no pagination), sorted by approval date (newest first). `approvedAt` is stamped on the first approval only, so re-enabling a disabled mapping does not move it up the list.

The listing is derived from the records themselves rather than a maintained index, so it cannot disagree with them. KV is eventually consistent — after a status change, the listing may briefly show stale data. This is acceptable.

A record that cannot be read is skipped and logged rather than failing the page.

### 3.5 Error Scenarios

| Scenario | Response |
|----------|----------|
| Missing required field (`url`, `title`) | 400 Bad Request — field-level error listing missing fields |
| Field exceeds max length or invalid format | 400 Bad Request — field-level error |
| Duplicate slug on submission | 409 Conflict — suggest a different slug |
| Confirmation page for an unknown slug | 404 with the submission form and an explanation |
| `url` or `photo` over 2048 characters | 400 Bad Request — field-level error |
| Record in KV that cannot be parsed | Skipped and logged; the rest of the page renders |
| Slug auto-generation exhausted (5 retries) | 409 Conflict — ask submitter to provide a slug manually |
| Invalid URL format | 400 Bad Request — field-level error |
| Invalid slug format | 400 Bad Request — field-level error |
| KV read failure | 500 Internal Server Error |
| KV write failure | 500 Internal Server Error |
| Unauthorized admin access | Handled by CF Zero Trust (403/redirect to IdP) |

---

## 4. Refinement

### Terminology

| Term | Definition |
|------|-----------|
| **Slug** | The short path segment in `s.oshi.tw/<slug>` |
| **Mapping** | A record linking a slug to a target URL + metadata |
| **Status** | One of: `pending`, `approved`, `disabled`, `rejected` |
| **Listed** | Whether the submitter opted in to public listing |

### KV Data Contract

**Namespace**: single KV namespace (`SHORT_URLS`)

**Primary key**: `slug:<slug>` → JSON value

```jsonc
{
  "slug": "example",
  "url": "https://example.com",
  "title": "Example Site",
  "description": "An example link",
  "photo": "https://example.com/photo.jpg",
  "author": "Author Name",
  "contact": "author@example.com",   // never exposed publicly
  "notes": "Please approve this",     // never exposed publicly
  "listed": true,
  "status": "pending",                // pending | approved | disabled | rejected
  "createdAt": "2026-03-20T12:00:00Z",
  "updatedAt": "2026-03-20T12:00:00Z",
  "approvedAt": null
}
```

**No index key.** An earlier design kept `index:listed`, a single key holding an array of slugs. Maintaining it was a read-modify-write, so overlapping admin actions dropped approved links from the listing permanently, and KV's one-write-per-second-per-key limit could leave a mapping approved but unlisted with no way back. Both pages now read the records with `list()` plus bulk `get()`, which is one call each at this size and cannot fall out of step.

**Key size**: KV refuses keys over 512 bytes. A slug that long cannot name a stored record, so reads treat it as a miss.

**Slug canonicalization**: slugs are stored in canonical form. A lookup tries the exact path first and the canonical form second, so a link published under the older rules keeps working and keeps its path.

### URL Patterns

| Method | Path | Handler | Auth |
|--------|------|---------|------|
| `GET` | `/` | Public listing page | None |
| `GET` | `/new` | Submission form | None |
| `POST` | `/new` | Process submission | None |
| `GET` | `/admin` | Admin dashboard | Zero Trust |
| `POST` | `/admin/api/approve` | Approve mapping | Zero Trust |
| `POST` | `/admin/api/reject` | Reject mapping | Zero Trust |
| `POST` | `/admin/api/disable` | Disable mapping | Zero Trust |
| `POST` | `/admin/api/enable` | Re-enable mapping | Zero Trust |
| `GET` | `/<slug>` | Redirect | None |

### Response Formats

- **HTML**: `/`, `/new`, `/admin`, and every unmatched path (styled 404), plus a styled 500 page when a request fails
- **JSON**: `/admin/api/*` responses (`{ "ok": true, "slug": "..." }` or `{ "ok": false, "error": "..." }`). This holds for every reply on that prefix, including 404, 500 and the 403 a CSRF rejection produces, because the dashboard reads them all with `res.json()`
- **Redirect**: `/<slug>` on success (302 with `Location` header)

Admin responses carry `Cache-Control: private, no-store` and refuse framing.

### KV Operation Budget

Every KV call counts as a subrequest: 50 per request on the Workers free plan, 10,000 on paid, with a separate cap of 1,000 KV operations per invocation. A bulk `get()` takes up to 100 keys and counts once, which is what keeps the list pages cheap.

| Route | Calls | Notes |
|-------|-------|-------|
| Redirect | 1, or 2 for a path that is not already canonical | Exact path first, canonical form second |
| Listing | 1 `list()` per 1,000 keys + 1 bulk `get()` per 100 records | Reads every record, then filters |
| Admin dashboard | Same as the listing | |
| Confirmation page | 1 read | Confirms only a slug that exists |
| Submission | 1 read (uniqueness) + 1 write, plus up to 5 reads when generating a slug | |
| Admin action | 1 read + 1 write | One write, so a transition either lands or does not |

At the current size every route is a handful of calls. Past a few thousand records the list pages would be worth moving onto `list()` metadata, which would make them a single call regardless of size.
