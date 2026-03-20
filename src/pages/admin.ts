import { html } from 'hono/html';
import type { Mapping, MappingStatus } from '../types';
import { pageShell } from './shell';

const STATUS_LABELS: Record<MappingStatus, string> = {
  pending: '待審核',
  approved: '已核准',
  disabled: '已停用',
  rejected: '已拒絕',
};

const STATUS_COLORS: Record<MappingStatus, string> = {
  pending: '#D97706',
  approved: '#059669',
  disabled: '#6B7280',
  rejected: '#DC2626',
};

function actionButtons(m: Mapping) {
  const btnStyle = (bg: string) =>
    `padding: 6px 14px; border: none; border-radius: 8px; background: ${bg}; color: white; font-size: 12px; font-weight: 500; cursor: pointer; font-family: inherit;`;

  switch (m.status) {
    case 'pending':
      return html`
        <button style="${btnStyle('#059669')}" onclick="adminAction('approve', '${m.slug}')">核准</button>
        <button style="${btnStyle('#DC2626')}" onclick="adminAction('reject', '${m.slug}')">拒絕</button>
      `;
    case 'approved':
      return html`
        <button style="${btnStyle('#6B7280')}" onclick="adminAction('disable', '${m.slug}')">停用</button>
      `;
    case 'disabled':
      return html`
        <button style="${btnStyle('#059669')}" onclick="adminAction('enable', '${m.slug}')">重新啟用</button>
      `;
    default:
      return html``;
  }
}

function renderRow(m: Mapping) {
  return html`
    <div class="card" style="padding: 20px; margin-bottom: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px;">
        <div style="flex: 1; min-width: 200px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
            <span style="font-weight: 600; font-size: 15px;">${m.title}</span>
            <span style="
              display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 500;
              background: ${STATUS_COLORS[m.status]}18; color: ${STATUS_COLORS[m.status]};
            ">${STATUS_LABELS[m.status]}</span>
            ${m.listed
              ? html`<span style="display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 500; background: #3B82F618; color: #3B82F6;">公開</span>`
              : html``}
          </div>
          <div style="font-size: 13px; color: var(--accent-pink); font-weight: 500; margin-bottom: 4px;">
            s.oshi.tw/${m.slug}
          </div>
          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; word-break: break-all;">
            → ${m.url}
          </div>
          ${m.description ? html`<div style="font-size: 12px; color: var(--text-tertiary); margin-bottom: 4px;">${m.description}</div>` : html``}
          ${m.author ? html`<div style="font-size: 12px; color: var(--text-tertiary);">提交者：${m.author}</div>` : html``}
          ${m.contact ? html`<div style="font-size: 12px; color: var(--text-tertiary);">聯絡：${m.contact}</div>` : html``}
          ${m.notes ? html`<div style="font-size: 12px; color: var(--text-tertiary); margin-top: 4px; padding: 8px; background: var(--bg-surface-frosted); border-radius: 8px;">備註：${m.notes}</div>` : html``}
          <div style="font-size: 11px; color: var(--text-tertiary); margin-top: 6px;">
            建立：${m.createdAt.slice(0, 16).replace('T', ' ')}
            ${m.approvedAt ? html` ・ 核准：${m.approvedAt.slice(0, 16).replace('T', ' ')}` : html``}
          </div>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          ${actionButtons(m)}
        </div>
      </div>
    </div>
  `;
}

export function renderAdminDashboard(mappings: Mapping[], adminEmail: string) {
  const groups: Record<string, Mapping[]> = {
    pending: [],
    approved: [],
    disabled: [],
    rejected: [],
  };
  for (const m of mappings) {
    groups[m.status]?.push(m);
  }
  // Sort each group by updatedAt desc
  for (const group of Object.values(groups)) {
    group.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  const sectionOrder: MappingStatus[] = ['pending', 'approved', 'disabled', 'rejected'];

  return pageShell(
    '管理後台',
    html`
      <div style="max-width: 900px; margin: 0 auto; padding: 48px 16px;">
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; flex-wrap: wrap; gap: 12px;">
          <div>
            <h1 style="font-size: 24px; font-weight: 700;
              background: linear-gradient(135deg, var(--accent-pink), var(--accent-blue));
              -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">
              s.oshi.tw 管理後台
            </h1>
            <p style="font-size: 13px; color: var(--text-tertiary); margin-top: 4px;">
              ${adminEmail} ・ 共 ${mappings.length} 筆短網址
            </p>
          </div>
          <a href="/" style="color: #8B5CF6; text-decoration: none; font-size: 13px;">← 返回首頁</a>
        </div>

        ${sectionOrder.map(
          (status) => html`
            ${groups[status].length > 0
              ? html`
                  <h2 style="font-size: 16px; font-weight: 600; color: ${STATUS_COLORS[status]}; margin-bottom: 12px; margin-top: 24px;">
                    ${STATUS_LABELS[status]}（${groups[status].length}）
                  </h2>
                  ${groups[status].map(renderRow)}
                `
              : html``}
          `,
        )}

        ${mappings.length === 0
          ? html`<div class="card" style="text-align: center; padding: 48px 24px;">
              <p style="color: var(--text-secondary);">目前沒有任何短網址</p>
            </div>`
          : html``}
      </div>

      <script>
        async function adminAction(action, slug) {
          if (!confirm('確定要執行此操作？')) return;
          try {
            const res = await fetch('/admin/api/' + action, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ slug }),
            });
            const data = await res.json();
            if (data.ok) {
              location.reload();
            } else {
              alert('操作失敗：' + (data.error || '未知錯誤'));
            }
          } catch (e) {
            alert('網路錯誤');
          }
        }
      </script>
    `,
  );
}
