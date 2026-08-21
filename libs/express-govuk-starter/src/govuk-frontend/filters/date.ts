export const dateFilter = (value: Date | string, format?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (format === "short") {
    return date.toLocaleDateString("en-GB");
  }
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
};
