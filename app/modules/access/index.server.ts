import { db } from "~/db";
import {
  decideCourseContentAccess,
  getCourseContentAccess,
} from "./lib/course-content-access";
import { createCourseContentAccess } from "./lib/course-content-access-requests";

export type {
  CourseActorFacts,
  CourseContentAccessDecision,
  CourseContentAccessView,
  CourseContentFacts,
  CourseFacts,
} from "./lib/course-content-access";
export type { Db } from "./lib/course-content-access-requests";

export { decideCourseContentAccess, getCourseContentAccess };
export { createCourseContentAccess };

// Pure so a route importing this module only for its policy doesn't pull the
// database into the client bundle (see `~/db`).
export const courseContentAccess =
  /* @__PURE__ */ createCourseContentAccess(db);
