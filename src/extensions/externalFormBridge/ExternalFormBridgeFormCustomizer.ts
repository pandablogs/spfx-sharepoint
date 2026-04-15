import { override } from '@microsoft/decorators';
import { FormDisplayMode } from '@microsoft/sp-core-library';
import { BaseFormCustomizer } from '@microsoft/sp-listview-extensibility';
import { AadHttpClient, SPHttpClient, SPHttpClientResponse } from '@microsoft/sp-http';

export interface IExternalFormBridgeFormCustomizerProperties {
  schemaEndpoint: string;
  aadAppIdUri?: string;
  formId?: string;
}

type FieldType = 'text' | 'number' | 'textarea' | 'choice' | 'date';

interface IExternalFormField {
  key: string;
  label?: string;
  type?: FieldType;
  required?: boolean;
  choices?: string[];
  spInternalName?: string;
}

interface IExternalFormSchema {
  title?: string;
  fields: IExternalFormField[];
}

export default class ExternalFormBridgeFormCustomizer extends BaseFormCustomizer<IExternalFormBridgeFormCustomizerProperties> {
  private _schema: IExternalFormSchema | undefined;
  private _fieldMap: Record<string, string> | undefined;

  @override
  public async onInit(): Promise<void> {
    this._schema = await this._fetchSchema().catch((e: unknown) => {
      console.error('ExternalFormBridge: schema fetch failed', e);
      return undefined;
    });
    return Promise.resolve();
  }

  @override
  protected render(): void {
    const mode = this.displayMode;
    const title =
      this._schema?.title ??
      (mode === FormDisplayMode.New ? 'New item' : mode === FormDisplayMode.Edit ? 'Edit item' : 'View item');

    this.domElement.innerHTML = `
      <div style="padding:16px; max-width:980px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px;">
          <div style="font-size:20px; font-weight:600;">${this._escapeHtml(title)}</div>
          <div style="display:flex; gap:8px;">
            ${mode === FormDisplayMode.Display ? '' : `<button id="efb-save" style="padding:8px 12px; border:0; border-radius:6px; background:#0078d4; color:#fff; font-weight:600; cursor:pointer;">Save</button>`}
            <button id="efb-cancel" style="padding:8px 12px; border:1px solid #ddd; border-radius:6px; background:#fff; font-weight:600; cursor:pointer;">Cancel</button>
          </div>
        </div>
        <div id="efb-error" style="display:none; margin:0 0 12px; padding:10px 12px; border-radius:8px; background:#fde7e9; color:#a4262c;"></div>
        <div id="efb-form" style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;"></div>
      </div>
    `;

    this.domElement.querySelector<HTMLButtonElement>('#efb-cancel')?.addEventListener('click', () => this._cancel());
    this.domElement.querySelector<HTMLButtonElement>('#efb-save')?.addEventListener('click', () => {
      this._save().catch((e: unknown) => this._showError(String((e as Error)?.message ?? e)));
    });

    this._renderFields();
    this._loadValuesIfNeeded().catch((e: unknown) => {
      console.error('ExternalFormBridge: load values failed', e);
      this._showError(String((e as Error)?.message ?? e));
    });
  }

  private _renderFields(): void {
    const host = this.domElement.querySelector<HTMLDivElement>('#efb-form');
    if (!host) return;

    const fields = this._schema?.fields ?? [];
    if (fields.length === 0) {
      host.innerHTML = `<div style="grid-column:1 / -1; padding:12px; border:1px dashed #ddd; border-radius:8px; color:#666;">No fields returned by schema endpoint.</div>`;
      return;
    }

    host.innerHTML = fields.map((f) => this._fieldHtml(f)).join('');

    if (this.displayMode === FormDisplayMode.Display) {
      host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select').forEach((el) => {
        el.setAttribute('disabled', 'true');
      });
    }
  }

  private _fieldHtml(f: IExternalFormField): string {
    const id = this._fieldDomId(f.key);
    const label = this._escapeHtml(f.label ?? f.key);
    const required = !!f.required;
    const type = (f.type ?? 'text').toLowerCase() as FieldType;

    const labelHtml = `<label for="${id}" style="display:block; font-weight:600; margin:0 0 6px;">${label}${required ? ' *' : ''}</label>`;
    const commonStyle = 'width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #ddd; border-radius:8px; outline:none;';

    if (type === 'textarea') {
      return `<div style="grid-column:1 / -1;">${labelHtml}<textarea id="${id}" style="${commonStyle} min-height:92px;"></textarea></div>`;
    }

    if (type === 'choice') {
      const options = (f.choices ?? []).map((c) => `<option value="${this._escapeHtml(c)}">${this._escapeHtml(c)}</option>`).join('');
      return `<div>${labelHtml}<select id="${id}" style="${commonStyle}"><option value=""></option>${options}</select></div>`;
    }

    const inputType = type === 'number' ? 'number' : type === 'date' ? 'date' : 'text';
    return `<div>${labelHtml}<input id="${id}" type="${inputType}" style="${commonStyle}" /></div>`;
  }

  private async _loadValuesIfNeeded(): Promise<void> {
    if (this.displayMode === FormDisplayMode.New) return;
    const itemId = this.context.itemId;
    if (!itemId) return;

    const listTitle = this.context.pageContext.list?.title;
    if (!listTitle) return;

    const fieldMap = await this._getFieldMap(listTitle);
    const schemaFields = this._schema?.fields ?? [];
    const selectFields = this._selectFields(schemaFields, fieldMap);

    const webUrl = this.context.pageContext.web.absoluteUrl;
    const url = `${webUrl}/_api/web/lists/getbytitle('${this._escapeODataString(listTitle)}')/items(${itemId})?$select=${selectFields.join(',')}`;
    const res = await this.context.spHttpClient.get(url, SPHttpClient.configurations.v1);
    const json = await res.json();
    const item = json?.d ?? json;

    for (const f of schemaFields) {
      const internal = this._resolveInternalName(fieldMap, f);
      if (!internal) continue;
      const raw = item?.[internal];
      this._setValue(f.key, raw === undefined || raw === null ? '' : String(raw));
    }
  }

  private async _save(): Promise<void> {
    this._hideError();

    const listTitle = this.context.pageContext.list?.title;
    if (!listTitle) throw new Error('No list context available.');

    const schemaFields = this._schema?.fields ?? [];
    const fieldMap = await this._getFieldMap(listTitle);

    const body: Record<string, unknown> = {};
    for (const f of schemaFields) {
      const val = this._getValue(f.key).trim();
      if (f.required && !val) throw new Error(`Missing required field: ${f.label ?? f.key}`);
      if (!val) continue;

      const internal = this._resolveInternalName(fieldMap, f);
      if (!internal) continue;

      if ((f.type ?? 'text') === 'number') {
        const n = Number(val);
        if (!isNaN(n)) body[internal] = n;
      } else {
        body[internal] = val;
      }
    }

    const webUrl = this.context.pageContext.web.absoluteUrl;
    const isEdit = this.displayMode === FormDisplayMode.Edit;
    const itemId = this.context.itemId;
    const url = isEdit && itemId
      ? `${webUrl}/_api/web/lists/getbytitle('${this._escapeODataString(listTitle)}')/items(${itemId})`
      : `${webUrl}/_api/web/lists/getbytitle('${this._escapeODataString(listTitle)}')/items`;

    const res: SPHttpClientResponse = await this.context.spHttpClient.post(url, SPHttpClient.configurations.v1, {
      headers: {
        Accept: 'application/json;odata=nometadata',
        'Content-Type': 'application/json;odata=nometadata',
        'odata-version': '',
        ...(isEdit ? { 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' } : {})
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error(await res.text());

    this.formSaved();
    this.formClosed();
  }

  private _cancel(): void {
    this.formClosed();
  }

  private async _fetchSchema(): Promise<IExternalFormSchema> {
    const endpoint = (this.properties.schemaEndpoint || '').trim();
    if (!endpoint) return { title: 'External form', fields: [] };

    const webUrl = this.context.pageContext.web.absoluteUrl;
    const siteUrl = this.context.pageContext.site.absoluteUrl;
    const listId = this.context.pageContext.list?.id?.toString() ?? '';
    const itemId = this.context.itemId ? String(this.context.itemId) : '';
    const mode = this.displayMode === FormDisplayMode.New ? 'New' : this.displayMode === FormDisplayMode.Edit ? 'Edit' : 'Display';
    const formId = (this.properties.formId || '').trim();

    const url = this._withQuery(endpoint, { webUrl, siteUrl, listId, itemId, mode, formId });

    const aadResource = (this.properties.aadAppIdUri || '').trim();
    if (aadResource) {
      const client: AadHttpClient = await this.context.aadHttpClientFactory.getClient(aadResource);
      const res = await client.get(url, AadHttpClient.configurations.v1);
      if (!res.ok) throw new Error(await res.text());
      return await res.json();
    }

    const res = await fetch(url, { method: 'GET', credentials: 'include' });
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  }

  private async _getFieldMap(listTitle: string): Promise<Record<string, string>> {
    if (this._fieldMap) return this._fieldMap;

    const webUrl = this.context.pageContext.web.absoluteUrl;
    const url = `${webUrl}/_api/web/lists/getbytitle('${this._escapeODataString(listTitle)}')/fields?$select=Title,InternalName&$filter=Hidden eq false`;
    const res = await this.context.spHttpClient.get(url, SPHttpClient.configurations.v1);
    const json = await res.json();
    const fields: Array<{ Title: string; InternalName: string }> = json?.d?.results ?? json?.value ?? [];

    const map: Record<string, string> = {};
    for (const f of fields) {
      const t = String(f?.Title ?? '').toLowerCase();
      const i = String(f?.InternalName ?? '');
      if (t && i) map[t] = i;
      if (i) map[i.toLowerCase()] = i;
    }

    this._fieldMap = map;
    return map;
  }

  private _selectFields(schemaFields: IExternalFormField[], fieldMap: Record<string, string>): string[] {
    const set: { [k: string]: true } = { Id: true };
    for (const f of schemaFields) {
      const internal = this._resolveInternalName(fieldMap, f);
      if (internal) set[internal] = true;
    }
    const result: string[] = [];
    // eslint-disable-next-line guard-for-in
    for (const k in set) result.push(k);
    return result;
  }

  private _resolveInternalName(fieldMap: Record<string, string>, f: IExternalFormField): string | undefined {
    if (f.spInternalName && f.spInternalName.trim()) return f.spInternalName.trim();
    const key = (f.key || '').trim().toLowerCase();
    const label = (f.label || '').trim().toLowerCase();
    return (key && fieldMap[key]) || (label && fieldMap[label]) || undefined;
  }

  private _fieldDomId(key: string): string {
    const safe = (key || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    return `efb-${safe}`;
  }

  private _getValue(key: string): string {
    const el = this.domElement.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${this._fieldDomId(key)}`);
    return el ? (el.value ?? '') : '';
  }

  private _setValue(key: string, value: string): void {
    const el = this.domElement.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${this._fieldDomId(key)}`);
    if (el) el.value = value ?? '';
  }

  private _showError(message: string): void {
    const el = this.domElement.querySelector<HTMLDivElement>('#efb-error');
    if (!el) return;
    el.textContent = message;
    el.style.display = 'block';
  }

  private _hideError(): void {
    const el = this.domElement.querySelector<HTMLDivElement>('#efb-error');
    if (!el) return;
    el.textContent = '';
    el.style.display = 'none';
  }

  private _escapeHtml(value: string): string {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private _escapeODataString(value: string): string {
    return String(value).replace(/'/g, "''");
  }

  private _withQuery(baseUrl: string, query: Record<string, string>): string {
    const u = new URL(baseUrl);
    // eslint-disable-next-line guard-for-in
    for (const k in query) {
      const v = query[k];
      if (v !== undefined && v !== null && String(v).length > 0) u.searchParams.set(k, String(v));
    }
    return u.toString();
  }
}

