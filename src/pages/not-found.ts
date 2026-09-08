import { html } from 'hono/html';
import { pageShell } from './shell';

function renderStatusPage(code: string, title: string, message: string) {
  return pageShell(
    `${code} — ${title}`,
    html`
      <div style="text-align: center; padding: 80px 16px;">
        <div style="font-size: 72px; font-weight: 700; background: linear-gradient(135deg, var(--accent-pink), var(--accent-blue)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">
          ${code}
        </div>
        <p style="color: var(--text-secondary); font-size: 16px; margin-top: 12px;">
          ${message}
        </p>
        <a href="/" style="display: inline-block; margin-top: 24px; color: var(--accent-pink); text-decoration: none; font-weight: 500;">
          ← 返回首頁
        </a>
      </div>
    `,
  );
}

export function renderNotFound() {
  return renderStatusPage('404', '找不到頁面', '找不到此短網址，請確認網址是否正確');
}

export function renderServerError() {
  return renderStatusPage('500', '伺服器錯誤', '系統暫時無法處理這個請求，請稍後再試');
}
