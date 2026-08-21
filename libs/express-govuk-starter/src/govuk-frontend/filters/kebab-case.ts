export const kebabCaseFilter = (value: string) => {
  if (!value) return "";
  return value
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
};
