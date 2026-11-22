import { UserRole } from "~/db/schema";
import { checkPppAccess } from "~/lib/ppp";

export type CourseActorFacts = { id: number; role: UserRole };

export type CourseFacts = {
  instructorId: number;
  price: number;
  pppEnabled: boolean;
};

export type CourseContentFacts = {
  actor: CourseActorFacts | null;
  course: CourseFacts | null;
  enrolled: boolean;
  purchaseCountry: string | null;
  currentCountry: string | null;
};

export type CourseContentAccessView = {
  actorId: number | null;
  enrolled: boolean;
  canViewContent: boolean;
  pppBlocked: boolean;
  pppBlockedCountry: string | null;
  pppPurchaseCountry: string | null;
  canManageCourse: boolean;
};

export type CourseContentAccessDecision =
  | { allowed: true; view: CourseContentAccessView }
  | { allowed: false; reason: "signed-out" | "content-denied" };

const SIGNED_OUT_VIEW: CourseContentAccessView = {
  actorId: null,
  enrolled: false,
  canViewContent: false,
  pppBlocked: false,
  pppBlockedCountry: null,
  pppPurchaseCountry: null,
  canManageCourse: false,
};

const NO_PPP_RESTRICTION = {
  blocked: false,
  blockedCountry: null,
  purchaseCountry: null,
} as const;

/** The owning Instructor or a Platform Admin speaks for this course. */
export function isCourseManager(
  actor: CourseActorFacts,
  course: CourseFacts | null
): boolean {
  return actor.role === UserRole.Admin || course?.instructorId === actor.id;
}

export function getCourseContentAccess(
  facts: CourseContentFacts
): CourseContentAccessView {
  if (!facts.actor) return SIGNED_OUT_VIEW;

  const canManageCourse = isCourseManager(facts.actor, facts.course);
  const ppp =
    facts.enrolled && !canManageCourse && facts.course
      ? checkPppAccess(
          facts.course.price,
          facts.course.pppEnabled,
          facts.purchaseCountry,
          facts.currentCountry
        )
      : NO_PPP_RESTRICTION;

  return {
    actorId: facts.actor.id,
    enrolled: facts.enrolled,
    canViewContent: canManageCourse || (facts.enrolled && !ppp.blocked),
    pppBlocked: ppp.blocked,
    pppBlockedCountry: ppp.blockedCountry,
    pppPurchaseCountry: ppp.purchaseCountry,
    canManageCourse,
  };
}

export function decideCourseContentAccess(
  facts: CourseContentFacts
): CourseContentAccessDecision {
  const view = getCourseContentAccess(facts);
  if (view.actorId === null) return { allowed: false, reason: "signed-out" };
  if (!view.canViewContent) {
    return { allowed: false, reason: "content-denied" };
  }
  return { allowed: true, view };
}
