// Navigation helper functions for onboarding flow

const PAGE_ORDER = ["start", "name", "date-of-birth", "address", "role", "summary", "confirmation"];

export function getPreviousPage(currentPage: string): string | null {
  const currentIndex = PAGE_ORDER.indexOf(currentPage);
  return currentIndex > 0 ? `/onboarding/${PAGE_ORDER[currentIndex - 1]}` : null;
}

export function getNextPage(currentPage: string): string {
  const currentIndex = PAGE_ORDER.indexOf(currentPage);
  return `/onboarding/${PAGE_ORDER[currentIndex + 1]}`;
}

// Get page route for change links on summary page
export function getChangePageRoute(field: string): string {
  const pageMap: Record<string, string> = {
    name: "/onboarding/name",
    dateOfBirth: "/onboarding/date-of-birth",
    address: "/onboarding/address",
    role: "/onboarding/role"
  };
  return pageMap[field] || "/onboarding/start";
}

// Check if current page has a back link
export function hasBackLink(currentPage: string): boolean {
  return currentPage !== "start" && currentPage !== "confirmation";
}

// Format date for display
export function formatDateForDisplay(dateData: { day: number; month: number; year: number }): string {
  return `${dateData.day} ${getMonthName(dateData.month)} ${dateData.year}`;
}

// Get month name for date display
export function getMonthName(month: number): string {
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return months[month - 1] || "";
}

// Format address for display
export function formatAddressForDisplay(address: { addressLine1: string; addressLine2?: string; town: string; postcode: string }): string[] {
  const lines = [address.addressLine1];
  if (address.addressLine2) {
    lines.push(address.addressLine2);
  }
  lines.push(address.town);
  lines.push(address.postcode);
  return lines;
}

// Format role for display
export function formatRoleForDisplay(role: { roleType: string; roleOther?: string }): string {
  const roleMap: Record<string, string> = {
    "frontend-developer": "Frontend Developer",
    "backend-developer": "Backend Developer",
    "test-engineer": "Test Engineer",
    other: role.roleOther || "Other"
  };
  return roleMap[role.roleType] || role.roleType;
}
