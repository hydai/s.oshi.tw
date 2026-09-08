import { html } from 'hono/html';
import type { FieldError } from '../validate';
import { pageShell } from './shell';

function errorFor(errors: FieldError[], field: string): string {
  const err = errors.find((e) => e.field === field);
  return err ? err.message : '';
}

export function renderSubmitForm(
  errors: FieldError[] = [],
  values: Record<string, string> = {},
  globalError = '',
) {
  const v = (name: string) => values[name] ?? '';
  const err = (name: string) => {
    const msg = errorFor(errors, name);
    return msg ? html`<div class="form-error">${msg}</div>` : html``;
  };

  return pageShell(
    '提交短網址',
    html`
      <div style="max-width: 640px; margin: 0 auto; padding: 48px 16px;">
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
            <span class="gradient-text" style="font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">提交短網址</span>
          </div>
          <p style="color: var(--text-secondary); font-size: 14px;">
            提交連結至 s.oshi.tw，審核通過後即可使用
          </p>
        </div>

        <!-- Form Card -->
        <div class="card">
          ${globalError
            ? html`<div style="background: #FEF2F2; color: #DC2626; padding: 12px 16px; border-radius: var(--radius-lg); font-size: 13px; margin-bottom: 20px;">
                ${globalError}
              </div>`
            : html``}

          <form method="POST" action="/new" style="display: flex; flex-direction: column; gap: 20px;">
            <!-- URL -->
            <div>
              <label class="form-label">目標網址 <span class="required">*</span></label>
              <input type="url" name="url" required placeholder="https://example.com" class="form-input" value="${v('url')}" />
              ${err('url')}
            </div>

            <!-- Title -->
            <div>
              <label class="form-label">標題 <span class="required">*</span></label>
              <input type="text" name="title" required placeholder="例：oshi.tw 官網" class="form-input" value="${v('title')}" />
              ${err('title')}
              <div class="form-hint">最多 100 字元</div>
            </div>

            <!-- Slug -->
            <div>
              <label class="form-label">自訂短網址</label>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="color: var(--text-tertiary); font-size: 13px; white-space: nowrap;">s.oshi.tw/</span>
                <input type="text" name="slug" placeholder="留空自動產生" class="form-input" value="${v('slug')}" style="flex: 1;" />
              </div>
              ${err('slug')}
              <div class="form-hint">2-30 字元，可用英數字、中日文字與連字號；英文一律轉為小寫</div>
            </div>

            <!-- Description -->
            <div>
              <label class="form-label">描述</label>
              <textarea name="description" rows="2" placeholder="簡短描述此連結" class="form-input">${v('description')}</textarea>
              ${err('description')}
              <div class="form-hint">最多 200 字元</div>
            </div>

            <!-- Photo URL -->
            <div>
              <label class="form-label">圖片網址</label>
              <input type="url" name="photo" placeholder="https://example.com/photo.jpg" class="form-input" value="${v('photo')}" />
              ${err('photo')}
            </div>

            <!-- Author -->
            <div>
              <label class="form-label">提交者名稱</label>
              <input type="text" name="author" placeholder="你的名稱" class="form-input" value="${v('author')}" />
              ${err('author')}
            </div>

            <!-- Contact -->
            <div>
              <label class="form-label">聯絡方式</label>
              <input type="text" name="contact" placeholder="Email 或社群帳號（不會公開）" class="form-input" maxlength="100" value="${v('contact')}" />
              ${err('contact')}
              <div class="form-hint">僅供管理員聯繫，不會公開顯示</div>
            </div>

            <!-- Notes -->
            <div>
              <label class="form-label">給管理員的備註</label>
              <textarea name="notes" rows="2" placeholder="備註事項（不會公開）" class="form-input">${v('notes')}</textarea>
              ${err('notes')}
              <div class="form-hint">最多 500 字元，僅供管理員參考</div>
            </div>

            <!-- Listed -->
            <div>
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="checkbox" name="listed" ${v('listed') === 'on' ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: var(--accent-pink);" />
                <span style="font-size: 13px; color: var(--text-secondary);">公開顯示在短網址列表中</span>
              </label>
            </div>

            <!-- Submit -->
            <button type="submit" class="btn-primary" style="width: 100%;">提交</button>
          </form>
        </div>

        <div style="display: flex; justify-content: center; gap: 16px; margin-top: 16px; font-size: 13px;">
          <a href="/" class="link">← 返回列表</a>
        </div>
      </div>
    `,
  );
}

const STATUS_TEXT: Record<string, { label: string; color: string; blurb: string }> = {
  pending: { label: '待審核', color: '#D97706', blurb: '你的短網址已提交，等待管理員審核' },
  approved: { label: '已核准', color: '#059669', blurb: '這個短網址已經核准，可以使用了' },
  disabled: { label: '已停用', color: '#6B7280', blurb: '這個短網址目前已停用' },
  rejected: { label: '已拒絕', color: '#DC2626', blurb: '這個短網址未通過審核' },
};

export function renderConfirmation(slug: string, status = 'pending') {
  const state = STATUS_TEXT[status] ?? STATUS_TEXT.pending;
  return pageShell(
    '提交成功',
    html`
      <div style="max-width: 640px; margin: 0 auto; padding: 48px 16px; text-align: center;">
        <div class="card" style="padding: 48px 32px;">
          <div style="font-size: 48px; margin-bottom: 16px;">&#10003;</div>
          <h2 class="gradient-text" style="font-size: 22px; font-weight: 700; margin-bottom: 8px;">
            提交成功！
          </h2>
          <p style="color: var(--text-secondary); font-size: 14px; margin-bottom: 24px;">
            ${state.blurb}
          </p>
          <div style="background: var(--bg-surface-frosted); border: 1px solid var(--border-glass); border-radius: var(--radius-lg); padding: 16px; margin-bottom: 24px;">
            <div style="font-size: 12px; color: var(--text-tertiary); margin-bottom: 4px;">短網址</div>
            <div style="font-size: 18px; font-weight: 600; color: var(--accent-pink);">s.oshi.tw/${slug}</div>
            <div style="font-size: 12px; color: var(--text-tertiary); margin-top: 8px;">
              狀態：<span style="color: ${state.color}; font-weight: 500;">${state.label}</span>
            </div>
          </div>
          <div style="display: flex; justify-content: center; gap: 16px; font-size: 13px;">
            <a href="/new" class="link">提交另一個</a>
            <span style="color: var(--text-tertiary);">|</span>
            <a href="/" class="link">返回列表</a>
          </div>
        </div>
      </div>
    `,
  );
}
