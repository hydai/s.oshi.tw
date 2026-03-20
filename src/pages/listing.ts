import { html } from 'hono/html';
import type { Mapping } from '../types';
import { pageShell } from './shell';

function renderCard(m: Mapping) {
  const link = `/${m.slug}`;
  return html`
    <a href="${link}" style="text-decoration: none; color: inherit; display: block;">
      <div class="card" style="padding: 20px; transition: transform 0.15s, box-shadow 0.15s; cursor: pointer;"
           onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 12px 40px rgba(0,0,0,0.1)'"
           onmouseout="this.style.transform=''; this.style.boxShadow=''">
        <div style="display: flex; gap: 16px; align-items: flex-start;">
          ${m.photo
            ? html`<img src="${m.photo}" alt="" style="width: 56px; height: 56px; border-radius: var(--radius-lg); object-fit: cover; flex-shrink: 0;" />`
            : html`<div style="width: 56px; height: 56px; border-radius: var(--radius-lg); background: linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light)); flex-shrink: 0; display: flex; align-items: center; justify-content: center;">
                <span style="font-size: 24px; color: white; font-weight: 700;">${m.title[0]}</span>
              </div>`}
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 600; font-size: 15px; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${m.title}
            </div>
            <div style="font-size: 12px; color: var(--accent-pink); font-weight: 500; margin-bottom: 6px;">
              s.oshi.tw/${m.slug}
            </div>
            ${m.description
              ? html`<div style="font-size: 13px; color: var(--text-secondary); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                  ${m.description}
                </div>`
              : html``}
          </div>
        </div>
      </div>
    </a>
  `;
}

export function renderListingPage(mappings: Mapping[]) {
  return pageShell(
    '短網址列表',
    html`
      <div style="max-width: 720px; margin: 0 auto; padding: 48px 16px;">
        <!-- Header -->
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
            <span style="
              font-size: 28px; font-weight: 700; letter-spacing: -0.5px;
              background: linear-gradient(135deg, var(--accent-pink), var(--accent-blue));
              -webkit-background-clip: text; -webkit-text-fill-color: transparent;
              background-clip: text;
            ">s.oshi.tw</span>
          </div>
          <p style="color: var(--text-secondary); font-size: 14px;">
            oshi.tw 社群短網址服務
          </p>
        </div>

        <!-- Listing -->
        ${mappings.length > 0
          ? html`<div style="display: flex; flex-direction: column; gap: 12px;">
              ${mappings.map(renderCard)}
            </div>`
          : html`<div class="card" style="text-align: center; padding: 48px 24px;">
              <p style="color: var(--text-secondary); font-size: 14px;">目前沒有公開的短網址</p>
            </div>`}

        <!-- Footer -->
        <div style="display: flex; justify-content: center; gap: 16px; margin-top: 24px; font-size: 13px;">
          <a href="/new" style="color: #8B5CF6; text-decoration: none;">提交新短網址</a>
        </div>
        <p style="text-align: center; font-size: 11px; color: var(--text-tertiary); margin-top: 16px;">
          s.oshi.tw &mdash; oshi.tw 社群短網址服務
        </p>
      </div>
    `,
  );
}
