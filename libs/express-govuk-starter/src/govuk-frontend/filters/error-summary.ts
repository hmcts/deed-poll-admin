export const govukErrorSummaryFilter = (errors: Record<string, string>) => {
  if (!errors || Object.keys(errors).length === 0) return null;

  return Object.entries(errors).map(([field, message]) => ({
    text: message,
    href: `#${field}`
  }));
};
