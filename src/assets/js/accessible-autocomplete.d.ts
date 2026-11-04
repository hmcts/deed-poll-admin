// accessible-autocomplete publishes no types and DefinitelyTyped has none. Only what this app calls is declared, so a
// new use has to declare what it relies on rather than inherit an `any`.
declare module "accessible-autocomplete" {
  interface EnhanceSelectOptions {
    selectElement: HTMLSelectElement;
    defaultValue?: string;
    showAllValues?: boolean;
  }

  const accessibleAutocomplete: {
    enhanceSelectElement(options: EnhanceSelectOptions): void;
  };

  export default accessibleAutocomplete;
}
