export interface IGeneratedFormField {
  key: string;
  label: string;
  type: string;
  customClass?: string;
}

export const GENERATED_FORM_TITLE: string = "kk-sp-product-form";
export const GENERATED_FORM_CSS: string = "body {\r\n            margin: 0;\r\n            padding: 24px 32px;\r\n            background: #ececec;\r\n            font-family: Arial, sans-serif;\r\n            color: #1f2937;\r\n        }\r\n\r\n        .form-wrapper {\r\n            max-width: 1024px;\r\n            margin: 0 auto;\r\n            background: transparent;\r\n            border: 0;\r\n            border-radius: 0;\r\n            padding: 0;\r\n            box-shadow: none;\r\n        }\r\n\r\n        .form-title {\r\n            margin: 0 0 18px;\r\n            font-size: 46px;\r\n            line-height: 1.1;\r\n            font-weight: 600;\r\n            text-align: center;\r\n            color: #111827;\r\n        }\r\n\r\n        /* Match app style closer than default Form.io theme */\r\n        .formio-component+.formio-component {\r\n            margin-top: 0.85rem;\r\n        }\r\n\r\n        .formio-component-label {\r\n            margin-bottom: 0.25rem;\r\n            color: #4b5563;\r\n            font-size: 12px;\r\n            font-weight: 500;\r\n        }\r\n\r\n        .form-control {\r\n            min-height: 42px;\r\n            border: 1px solid #d7d7d7;\r\n            border-radius: 2px;\r\n            box-shadow: none !important;\r\n        }\r\n\r\n        .btn-primary,\r\n        .btn.btn-primary {\r\n            background-color: #25bfb4 !important;\r\n            border-color: #25bfb4 !important;\r\n            color: #fff !important;\r\n            min-width: 180px;\r\n        }\r\n\r\n        .formio-errors,\r\n        .alert-danger {\r\n            display: none !important;\r\n        }\n\n";

export const GENERATED_FORM_FIELDS: IGeneratedFormField[] = [
  {
    "key": "title",
    "label": "Title",
    "type": "textfield",
    "customClass": ""
  },
  {
    "key": "category",
    "label": "Category",
    "type": "textfield",
    "customClass": ""
  }
];
