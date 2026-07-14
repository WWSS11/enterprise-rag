import "i18next";

// Resources stay structurally validated via satisfies AppResources on locale modules.
// Runtime uses typed dictionaries; component t() accepts cross-namespace keys.
declare module "i18next" {
  interface CustomTypeOptions {
    returnNull: false;
  }
}
