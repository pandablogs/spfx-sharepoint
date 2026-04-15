import { override } from '@microsoft/decorators';
import {
  BaseListViewCommandSet,
  IListViewCommandSetListViewUpdatedParameters
} from '@microsoft/sp-listview-extensibility';
import { SPHttpClient, SPHttpClientResponse } from '@microsoft/sp-http';
import { GENERATED_FORM_CSS, GENERATED_FORM_FIELDS, GENERATED_FORM_TITLE, IGeneratedFormField } from './generatedFormSchema';


export interface ICustomNewItemCommandSetProperties { }

export default class CustomNewItemCommandSet
  extends BaseListViewCommandSet<ICustomNewItemCommandSetProperties> {

  private _isAllowedList(): boolean {
    const allowed = String((this.properties as unknown as { listGuid?: string })?.listGuid ?? '').trim().toLowerCase();
    if (!allowed) return true; // if not configured, behave as before

    const current = this.context.pageContext.list?.id?.toString()?.trim().toLowerCase() ?? '';
    const normalize = (v: string) => v.replace(/^\{/, '').replace(/\}$/, '');
    return normalize(current) === normalize(allowed);
  }

  @override
  public onInit(): Promise<void> {
    console.log("✅ CustomNewItemCommandSet initialized");

    const command = this.tryGetCommand('COMMAND_1');
    if (command) {
      command.visible = this._isAllowedList();
    }

    const editCommand = this.tryGetCommand('COMMAND_2');
    if (editCommand) {
      editCommand.visible = false;
    }

    return Promise.resolve();
  }

  @override
  public onListViewUpdated(event: IListViewCommandSetListViewUpdatedParameters): void {
    if (!this._isAllowedList()) {
      const c1 = this.tryGetCommand('COMMAND_1');
      if (c1) c1.visible = false;
      const c2 = this.tryGetCommand('COMMAND_2');
      if (c2) c2.visible = false;
      return;
    }

    const editCommand = this.tryGetCommand('COMMAND_2');
    if (editCommand) {
      const selectedCount = event?.selectedRows?.length ?? 0;
      editCommand.visible = selectedCount === 1;
    }
  }

  @override
  public onExecute(event: { itemId: string }): void {
    if (event.itemId === 'COMMAND_1') {
      this.openCustomModal('new').catch((e: unknown) => console.error(e));
    }
    if (event.itemId === 'COMMAND_2') {
      const selected = this.context.listView?.selectedRows?.[0];
      const idRaw = selected?.getValueByName('ID');
      const itemId = typeof idRaw === 'number' ? idRaw : Number(idRaw);
      if (!isNaN(itemId)) {
        this.openCustomModal('edit', itemId).catch((e: unknown) => console.error(e));
      }
    }
  }

  private async getListFieldInternalNames(listName: string): Promise<{
    titleToInternal: Record<string, string>;
  }> {
    const webUrl = this.context.pageContext.web.absoluteUrl;

    const fieldsRes = await this.context.spHttpClient.get(
      `${webUrl}/_api/web/lists/getbytitle('${listName}')/fields?$select=Title,InternalName,TypeAsString&$filter=Hidden eq false and ReadOnlyField eq false`,
      SPHttpClient.configurations.v1
    );
    const fieldsJson = await fieldsRes.json();
    const fields: Array<{ Title: string; InternalName: string; TypeAsString?: string }> =
      fieldsJson?.d?.results ?? fieldsJson?.value ?? [];

    const titleToInternal: Record<string, string> = {};
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      const title = String(f?.Title || '').toLowerCase();
      const internal = String(f?.InternalName || '');
      if (title && internal) {
        titleToInternal[title] = internal;
      }
      if (internal) {
        titleToInternal[internal.toLowerCase()] = internal;
      }
    }

    return { titleToInternal };
  }

  private getCurrentListName(): string {
    const listTitle = this.context.pageContext.list?.title;
    return listTitle && listTitle.trim() ? listTitle : "Products";
  }

  private resolveInternalName(
    titleToInternal: Record<string, string>,
    candidates: string[]
  ): string | undefined {
    for (let i = 0; i < candidates.length; i++) {
      const key = (candidates[i] || '').trim().toLowerCase();
      if (key && titleToInternal[key]) {
        return titleToInternal[key];
      }
    }
    return undefined;
  }
  private async openCustomModal(mode: 'new' | 'edit', editItemId?: number): Promise<void> {

    const modal = document.createElement("div");
    modal.innerHTML = `
    <div id="glozicModal" style="
      position:fixed;
      top:0; left:0;
      width:100%; height:100%;
      background:rgba(0,0,0,0.5);
      display:flex;
      align-items:center;
      justify-content:center;
      z-index:9999;
    ">
      <style>${GENERATED_FORM_CSS}</style>
      <div style="background:#fff; border-radius:10px; padding:14px; width:920px; max-height:92vh; overflow:auto;">
        <h2 style="margin: 4px 8px 12px; font-size:28px; font-weight:600;">${mode === 'edit' ? '✏️ Edit Product' : '📦 Add Product'}</h2>
        <div class="form-wrapper">
          <h1 class="form-title">${this.escapeHtml(GENERATED_FORM_TITLE)}</h1>
          <div id="glozic-form">
            ${this.renderDynamicFields()}
          </div>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:12px;">
          <button style="padding:10px 18px; border:none; border-radius:6px; cursor:pointer; font-weight:600; background:#eee;" id="cancelBtn">Cancel</button>
          <button style="padding:10px 18px; border:none; border-radius:6px; cursor:pointer; font-weight:600; background:#25bfb4; color:#fff;" id="saveBtn">${mode === 'edit' ? 'Update Product' : 'Save Product'}</button>
        </div>
      </div>
    </div>
  `;

    document.body.appendChild(modal);

    const host = document.getElementById("glozicModal") as HTMLDivElement | null;
    if (host) {
      host.dataset.glozicMode = mode;
      if (editItemId !== undefined) host.dataset.glozicItemId = String(editItemId);
    }

    this.bindFormEvents();

    const pageUrlEl = this.getFieldElement('pageUrl') as HTMLInputElement | null;
    if (pageUrlEl) {
      pageUrlEl.value = window.location.href;
    }

    if (mode === 'edit' && editItemId !== undefined) {
      await this.loadItemIntoForm(editItemId);
    }
  }

  private getFieldElement(key: string): HTMLInputElement | HTMLTextAreaElement | null {
    return document.getElementById(`glozic-field-${key}`) as HTMLInputElement | HTMLTextAreaElement | null;
  }

  private getFieldValue(key: string): string {
    const el = this.getFieldElement(key);
    return el ? (el.value ?? '') : '';
  }

  private setFieldValue(key: string, value: string): void {
    const el = this.getFieldElement(key);
    if (el) {
      el.value = value;
    }
  }

  private renderDynamicFields(): string {
    const fields = GENERATED_FORM_FIELDS.filter((field: IGeneratedFormField) => field.type !== 'button');
    return fields.map((field: IGeneratedFormField) => {
      const safeLabel = this.escapeHtml(field.label || field.key);
      const safeKey = this.escapeHtml(field.key);
      const safeCustomClass = this.escapeHtml(field.customClass || '');
      const typeLower = field.type.toLowerCase();
      const isDescription = typeLower === 'textarea' || field.key.toLowerCase() === 'description';
      const isNumber = field.type.toLowerCase() === 'number';
      const isFile = typeLower.indexOf('file') !== -1 || typeLower.indexOf('image') !== -1;

      const wrapperClass = `formio-component ${safeCustomClass}`.trim();
      const labelHtml = `<div class="formio-component-label">${safeLabel}</div>`;
      const classNames = `form-control`.trim();
      const wrapperStart = `<div class="${wrapperClass}">`;
      const wrapperEnd = `</div>`;
      if (isDescription) {
        return `${wrapperStart}${labelHtml}<textarea id="glozic-field-${safeKey}" class="${classNames}" style="min-height:86px;"></textarea>${wrapperEnd}`;
      }
      if (isFile) {
        return `${wrapperStart}${labelHtml}<input id="glozic-field-${safeKey}" type="file" />${wrapperEnd}`;
      }

      const type = isNumber ? 'number' : 'text';
      return `${wrapperStart}${labelHtml}<input id="glozic-field-${safeKey}" type="${type}" class="${classNames}" />${wrapperEnd}`;
    }).join('');
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private bindFormEvents(): void {

    document.getElementById("cancelBtn")?.addEventListener("click", () => {
      document.getElementById("glozicModal")?.remove();
    });

    document.getElementById("saveBtn")?.addEventListener("click", () => {
      this.saveProduct().catch((e: unknown) => console.error(e));
    });
  }

  private getModalModeAndItemId(): { mode: 'new' | 'edit'; itemId?: number } {
    const host = document.querySelector<HTMLDivElement>('#glozicModal');
    const mode = (host?.dataset?.glozicMode === 'edit' ? 'edit' : 'new') as 'new' | 'edit';
    const idRaw = host?.dataset?.glozicItemId;
    const parsed = idRaw ? Number(idRaw) : undefined;
    return { mode, itemId: parsed !== undefined && !isNaN(parsed) ? parsed : undefined };
  }

  private async loadItemIntoForm(itemId: number): Promise<void> {
    const webUrl = this.context.pageContext.web.absoluteUrl;
    const listName = this.getCurrentListName();

    const internals = await this.getListFieldInternalNames(listName);
    const selectFields: string[] = ['Title'];
    for (let i = 0; i < GENERATED_FORM_FIELDS.length; i++) {
      const field = GENERATED_FORM_FIELDS[i];
      const typeLower = String(field.type || '').toLowerCase();
      if (typeLower.indexOf('file') !== -1 || typeLower.indexOf('image') !== -1) {
        continue;
      }
      const internal = this.resolveInternalName(internals.titleToInternal, [field.key, field.label]);
      if (internal && selectFields.indexOf(internal) === -1) {
        selectFields.push(internal);
      }
    }

    const res = await this.context.spHttpClient.get(
      `${webUrl}/_api/web/lists/getbytitle('${listName}')/items(${itemId})?$select=${selectFields.join(',')}`,
      SPHttpClient.configurations.v1
    );
    const data = await res.json();
    const item = data?.d ?? data;
    for (let i = 0; i < GENERATED_FORM_FIELDS.length; i++) {
      const field = GENERATED_FORM_FIELDS[i];
      const typeLower = String(field.type || '').toLowerCase();
      if (typeLower.indexOf('file') !== -1 || typeLower.indexOf('image') !== -1) {
        continue;
      }
      const keyLower = String(field.key || '').toLowerCase();
      const labelLower = String(field.label || '').toLowerCase();

      if (keyLower === 'pageurl' || labelLower === 'pageurl') {
        this.setFieldValue(field.key, window.location.href);
        continue;
      }

      const internal = this.resolveInternalName(internals.titleToInternal, [field.key, field.label]);
      if (!internal) {
        continue;
      }
      const raw = item?.[internal];
      this.setFieldValue(field.key, raw !== undefined && raw !== null ? String(raw) : "");
    }
  }

  private async saveProduct(): Promise<void> {
    const titleKey = this.findFieldKey(['title', 'producttitle']);
    const titleValue = titleKey ? this.getFieldValue(titleKey) : '';
    const fileInput = this.getFileInput();

    const webUrl = this.context.pageContext.web.absoluteUrl;

    try {

      const listName = this.getCurrentListName();
      const modalInfo = this.getModalModeAndItemId();

      const internals = await this.getListFieldInternalNames(listName);
      const itemBody: Record<string, unknown> = {
        Title: titleValue
      };

      for (let i = 0; i < GENERATED_FORM_FIELDS.length; i++) {
        const field = GENERATED_FORM_FIELDS[i];
        const typeLower = String(field.type || '').toLowerCase();
        if (typeLower.indexOf('file') !== -1 || typeLower.indexOf('image') !== -1) {
          continue;
        }

        const value = this.getFieldValue(field.key).trim();
        if (value === '') {
          continue;
        }

        const keyLower = String(field.key || '').toLowerCase();
        const labelLower = String(field.label || '').toLowerCase();
        if (keyLower === 'title' || labelLower === 'title' || keyLower === 'producttitle') {
          itemBody.Title = value;
          continue;
        }
        if (keyLower === 'pageurl' || labelLower === 'pageurl') {
          continue;
        }

        const internal = this.resolveInternalName(internals.titleToInternal, [field.key, field.label]);
        if (!internal) {
          continue;
        }

        if (typeLower === 'number') {
          const parsed = Number(value);
          if (!isNaN(parsed)) {
            itemBody[internal] = parsed;
          }
        } else {
          itemBody[internal] = value;
        }
      }

      const isEdit = modalInfo.mode === 'edit' && modalInfo.itemId !== undefined;
      const url = isEdit
        ? `${webUrl}/_api/web/lists/getbytitle('${listName}')/items(${modalInfo.itemId})`
        : `${webUrl}/_api/web/lists/getbytitle('${listName}')/items`;

      const response: SPHttpClientResponse = await this.context.spHttpClient.post(url, SPHttpClient.configurations.v1, {
        headers: {
          "Accept": "application/json;odata=nometadata",
          "Content-Type": "application/json;odata=nometadata",
          "odata-version": "",
          ...(isEdit ? { "IF-MATCH": "*", "X-HTTP-Method": "MERGE" } : {})
        },
        body: JSON.stringify(itemBody)
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("🔥 SHAREPOINT ERROR (create item):", errText);
        throw new Error(errText);
      }

      const data = isEdit ? undefined : await response.json();
      const itemId = isEdit ? modalInfo.itemId : data?.Id;

      if (!isEdit && fileInput && fileInput.files && fileInput.files.length > 0) {

        const file = fileInput.files[0];
        const safeFileName = encodeURIComponent(file.name.replace(/'/g, "''"));

        const uploadRes = await this.context.spHttpClient.post(
          `${webUrl}/_api/web/lists/getbytitle('${listName}')/items(${itemId})/AttachmentFiles/add(FileName='${safeFileName}')`,
          SPHttpClient.configurations.v1,
          {
            headers: {
              "Accept": "application/json;odata=nometadata",
              "Content-Type": "application/octet-stream",
              "odata-version": ""
            },
            body: file
          }
        );

        if (!uploadRes.ok) {
          const uploadErr = await uploadRes.text();
          console.error("🔥 SHAREPOINT ERROR (upload):", uploadErr);
          throw new Error(uploadErr);
        }
      }

      alert(isEdit ? "✅ Product updated!" : "✅ Product saved!");

      document.getElementById("glozicModal")?.remove();
      location.reload();

    } catch (error: unknown) {
      console.error(error);
    }
  }

  private findFieldKey(keywords: string[]): string | undefined {
    const lowered = keywords.map((k) => k.toLowerCase());
    for (let i = 0; i < GENERATED_FORM_FIELDS.length; i++) {
      const field = GENERATED_FORM_FIELDS[i];
      const key = (field.key || '').toLowerCase();
      const label = (field.label || '').toLowerCase();
      for (let j = 0; j < lowered.length; j++) {
        const keyword = lowered[j];
        if (key.indexOf(keyword) !== -1 || label.indexOf(keyword) !== -1) {
          return field.key;
        }
      }
    }
    return undefined;
  }

  private getFileInput(): HTMLInputElement | null {
    for (let i = 0; i < GENERATED_FORM_FIELDS.length; i++) {
      const field = GENERATED_FORM_FIELDS[i];
      const type = (field.type || '').toLowerCase();
      if (type.indexOf('file') !== -1 || type.indexOf('image') !== -1) {
        return document.getElementById(`glozic-field-${field.key}`) as HTMLInputElement | null;
      }
    }
    return null;
  }
}