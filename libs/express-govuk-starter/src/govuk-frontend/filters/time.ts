export const timeFilter = (value: Date | string) => {
  if (!value) return "";
  const date = new Date(value);
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit"
  });
};
