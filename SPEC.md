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
| **Slug format** | Lowercase alphanumeric + hyphens, 2–30 chars. No leading/trailing hyphens. |
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

Listing shows all matching mappings (no pagination), sorted by approval date (newest first).

KV is eventually consistent — after a status change, the listing may briefly show stale data. This is acceptable.

### 3.5 Error Scenarios

| Scenario | Response |
|----------|----------|
| Missing required field (`url`, `title`) | 400 Bad Request — field-level error listing missing fields |
| Field exceeds max length or invalid format | 400 Bad Request — field-level error |
| Duplicate slug on submission | 409 Conflict — suggest a different slug |
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

**Index key**: `index:listed` → JSON array of slugs

The listing page must load without scanning all KV keys. This index is updated on approve/disable/re-enable when `listed = true`. If the key does not exist, treat as empty array (empty listing page).

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

- **HTML**: `/`, `/new`, `/admin`, `/<slug>` (404 page)
- **JSON**: `/admin/api/*` responses (`{ "ok": true, "slug": "..." }` or `{ "ok": false, "error": "..." }`)
- **Redirect**: `/<slug>` on success (302 with `Location` header)

### Subrequest Budget

Cloudflare Workers allow 1000 subrequests per invocation. Estimated usage per route:
- Redirect: 1 KV read → **1 subrequest**
- Listing: 1 KV read (index) + N KV reads (mappings) → **1 + N subrequests** (N = number of listed mappings)
- Submission: 1 KV read (uniqueness) + 1 KV write + 1 KV read/write (index) → **≤ 4 subrequests**
- Admin actions: 1 KV read + 1 KV write + 1 KV read/write (index) → **≤ 4 subrequests**

All well within the 1000 subrequest limit.
