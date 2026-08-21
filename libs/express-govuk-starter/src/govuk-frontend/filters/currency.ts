export const currencyFilter = (value: number) => {
  if (typeof value !== "number") return "";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP"
  }).format(value);
};
