import type { Session } from "express-session";
import type { NameData, DobData, AddressData, RoleData } from "./validation.js";

// Session interface for onboarding form data
export interface OnboardingSession extends Session {
  onboarding?: {
    name?: NameData;
    dateOfBirth?: DobData;
    address?: AddressData;
    role?: RoleData;
    isComplete?: boolean;
    submittedAt?: Date;
    confirmationId?: string;
  };
}

// Helper to get session data with type safety
export function getOnboardingSession(session: Session): OnboardingSession["onboarding"] {
  const onboardingSession = session as OnboardingSession;
  return onboardingSession.onboarding || {};
}

// Helper to set session data for a specific page
export function setSessionData<T extends keyof NonNullable<OnboardingSession["onboarding"]>>(
  session: Session,
  key: T,
  data: NonNullable<OnboardingSession["onboarding"]>[T]
): void {
  const onboardingSession = session as OnboardingSession;
  onboardingSession.onboarding ??= {};
  onboardingSession.onboarding[key] = data;
}

// Helper to clear session data after successful submission
export function clearOnboardingSession(session: Session): void {
  const onboardingSession = session as OnboardingSession;
  delete onboardingSession.onboarding;
}

// Helper to check if all required data is collected
export function isSessionComplete(session: Session): boolean {
  const sessionData = getOnboardingSession(session);
  return !!(sessionData?.name && sessionData?.dateOfBirth && sessionData?.address && sessionData?.role);
}

// Helper to get all session data for summary page
export function getAllSessionData(session: Session) {
  const sessionData = getOnboardingSession(session);
  return {
    name: sessionData?.name,
    dateOfBirth: sessionData?.dateOfBirth,
    address: sessionData?.address,
    role: sessionData?.role
  };
}
