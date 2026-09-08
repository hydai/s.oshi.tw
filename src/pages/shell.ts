import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

/** The logo, wordmark and strapline every public page opens with. */
export function pageHeader(title: string, subtitle: string) {
  return html`
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="display: inline-flex; align-items: center; gap: 12px; margin-bottom: 8px;">
            <div style="
              width: 40px; height: 40px; border-radius: var(--radius-lg);
              background: linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light));
              display: flex; align-items: center; justify-content: center;
            ">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
            </div>
            <span class="gradient-text" style="font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">${title}</span>
          </div>
          <p style="color: var(--text-secondary); font-size: 14px;">
            ${subtitle}
          </p>
        </div>`;
}

export function pageShell(title: string, body: HtmlEscapedString | Promise<HtmlEscapedString>) {
  return html`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <!-- Listing cards embed submitter-chosen image URLs. Nothing here needs a
       referrer, and those hosts should not learn which page pulled them. -->
  <meta name="referrer" content="no-referrer" />
  <title>${title} — s.oshi.tw</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap" rel="stylesheet" />
  <style>
    :root {
      --accent-pink: #EC4899;
      --accent-pink-dark: #DB2777;
      --accent-pink-light: #F472B6;
      --accent-blue: #3B82F6;
      --accent-blue-light: #60A5FA;
      --bg-page-start: #FFF0F5;
      --bg-page-mid: #F0F8FF;
      --bg-page-end: #E6E6FA;
      --bg-surface-glass: #FFFFFF66;
      --bg-surface-frosted: #FFFFFF99;
      --text-primary: #1E293B;
      --text-secondary: #64748B;
      --text-tertiary: #94A3B8;
      --border-default: #E2E8F0;
      --border-glass: #FFFFFF66;
      --border-accent-pink: #FBCFE8;
      --link: #8B5CF6;
      --radius-lg: 12px;
      --radius-xl: 16px;
      --radius-2xl: 20px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      /* DM Sans carries no CJK glyphs and the whole UI is Chinese, so the
         fallbacks below do the real work on every page. */
      font-family: 'DM Sans', 'PingFang TC', 'Noto Sans TC', 'Microsoft JhengHei',
        'Hiragino Sans', 'Noto Sans CJK TC', sans-serif;
      background: linear-gradient(135deg, var(--bg-page-start) 0%, var(--bg-page-mid) 50%, var(--bg-page-end) 100%);
      background-attachment: fixed;
      min-height: 100vh;
      color: var(--text-primary);
    }

    .form-input {
      width: 100%;
      padding: 10px 16px;
      background: var(--bg-surface-frosted);
      border: 1px solid var(--border-glass);
      border-radius: var(--radius-lg);
      font-family: inherit;
      font-size: 14px;
      color: var(--text-primary);
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .form-input::placeholder { color: var(--text-tertiary); }
    .form-input:focus {
      border-color: var(--border-accent-pink);
      box-shadow: 0 0 0 3px rgba(236, 72, 153, 0.1);
    }

    textarea.form-input { resize: none; }

    .form-label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      margin-bottom: 6px;
    }
    .form-label .required { color: var(--accent-pink); }

    .form-hint {
      font-size: 11px;
      color: var(--text-tertiary);
      margin-top: 4px;
    }

    .form-error {
      font-size: 12px;
      color: #DC2626;
      margin-top: 4px;
    }

    .btn-primary {
      padding: 12px 24px;
      border: none;
      border-radius: var(--radius-lg);
      background: linear-gradient(135deg, var(--accent-pink), var(--accent-blue));
      color: white;
      font-family: inherit;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s, box-shadow 0.2s;
      box-shadow: 0 4px 14px rgba(236, 72, 153, 0.25);
    }
    .btn-primary:hover { opacity: 0.92; box-shadow: 0 6px 20px rgba(236, 72, 153, 0.3); }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

    /* The pink-to-blue wordmark treatment, previously copied into five pages. */
    .gradient-text {
      background: linear-gradient(135deg, var(--accent-pink), var(--accent-blue));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .link { color: var(--link); text-decoration: none; }
    .link:hover { text-decoration: underline; }

    .card {
      background: var(--bg-surface-glass);
      backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--border-glass);
      border-radius: var(--radius-2xl);
      padding: 32px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.06);
    }
  </style>
</head>
<body>
  ${body}
</body>
</html>`;
}
