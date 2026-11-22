import { UserRole } from "~/db/schema";
import {
  isCourseManager,
  type CourseActorFacts,
} from "./course-content-access";

export type SignedInDecision =
  | { allowed: true; actorId: number }
  | { allowed: false; reason: "signed-out" };

/** Authentication only — the actor's role and course ownership are separate decisions. */
export function decideSignedInActor(actorId: number | null): SignedInDecision {
  if (actorId === null) return { allowed: false, reason: "signed-out" };
  return { allowed: true, actorId };
}

export type InstructorOrPlatformAdminFacts = {
  actor: CourseActorFacts | null;
};

export type InstructorOrPlatformAdminView = {
  actorId: number;
  isAdmin: boolean;
};

export type InstructorOrPlatformAdminDecision =
  | { allowed: true; view: InstructorOrPlatformAdminView }
  | { allowed: false; reason: "signed-out" | "not-instructor-or-admin" };

/** Non-course-scoped Instructor areas: role alone decides, not course ownership. */
export function decideInstructorOrPlatformAdminAccess(
  facts: InstructorOrPlatformAdminFacts
): InstructorOrPlatformAdminDecision {
  const actor = facts.actor;
  if (!actor) return { allowed: false, reason: "signed-out" };
  if (
    actor.role !== UserRole.Instructor &&
    actor.role !== UserRole.Admin
  ) {
    return { allowed: false, reason: "not-instructor-or-admin" };
  }
  return {
    allowed: true,
    view: { actorId: actor.id, isAdmin: actor.role === UserRole.Admin },
  };
}

export type CourseManagerFacts = {
  actor: CourseActorFacts | null;
  course: { instructorId: number } | null;
};

export type CourseManagerView = { actorId: number; canManageCourse: true };

export type CourseManagerDecision =
  | { allowed: true; view: CourseManagerView }
  | { allowed: false; reason: "signed-out" | "not-course-manager" };

/** The owning Instructor or a Platform Admin manages this course. */
export function decideCourseManagerAccess(
  facts: CourseManagerFacts
): CourseManagerDecision {
  if (!facts.actor) return { allowed: false, reason: "signed-out" };
  if (!isCourseManager(facts.actor, facts.course)) {
    return { allowed: false, reason: "not-course-manager" };
  }
  return {
    allowed: true,
    view: { actorId: facts.actor.id, canManageCourse: true },
  };
}
