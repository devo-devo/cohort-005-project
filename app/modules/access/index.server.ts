import { db } from "~/db";
import { createAccessGuards } from "./lib/access-guards-requests";
import {
  decideCourseManagerAccess,
  decideInstructorOrPlatformAdminAccess,
  decideSignedInActor,
} from "./lib/actor-decisions";
import {
  decideCourseContentAccess,
  getCourseContentAccess,
} from "./lib/course-content-access";
import { createCourseContentAccess } from "./lib/course-content-access-requests";

export type {
  CourseManagerDecision,
  CourseManagerFacts,
  CourseManagerView,
  InstructorOrPlatformAdminDecision,
  InstructorOrPlatformAdminFacts,
  InstructorOrPlatformAdminView,
  SignedInDecision,
} from "./lib/actor-decisions";
export type {
  CourseActorFacts,
  CourseContentAccessDecision,
  CourseContentAccessView,
  CourseContentFacts,
  CourseFacts,
} from "./lib/course-content-access";
export type { Db } from "./lib/course-content-access-requests";

export { decideCourseContentAccess, getCourseContentAccess };
export {
  decideCourseManagerAccess,
  decideInstructorOrPlatformAdminAccess,
  decideSignedInActor,
};
export { createCourseContentAccess };
export { createAccessGuards };

// Pure so a route importing this module only for its policy doesn't pull the
// database into the client bundle (see `~/db`).
export const accessGuards = /* @__PURE__ */ createAccessGuards(db);
export const courseContentAccess =
  /* @__PURE__ */ createCourseContentAccess(db);
