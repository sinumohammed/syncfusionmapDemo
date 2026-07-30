// Minimal stand-in for the host application's shared form-element contract.
// Replace this file with the existing project's real `form-element.model.ts`
// when dropping nx-map back into the main app — NXMapConfig only needs the
// `MapConfig` string field it declares below.
export interface FormElementConfig {
  id?: string;
  label?: string;
}
