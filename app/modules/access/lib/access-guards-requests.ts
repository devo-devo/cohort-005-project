import { eq } from "drizzle-orm";
import { data } from "react-router";
import { courses, users } from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";
import {
  decideCourseManagerAccess,
  decideInstructorOrPlatformAdminAccess,
  decideSignedInActor,
} from "./actor-decisions";
import type { CourseActorFacts } from "./course-content-access";
import type { Db } from "./course-content-access-requests";
import { signedOutDenial } from "./request-denials";

const NOT_COURSE_MANAGER_MESSAGE = "Only this course's instructor can do that.";
const NOT_INSTRUCTOR_MESSAGE = "Only instructors can access this page.";

// A falsy session id counts as signed out, as it always has in these guards.
async function signedInActorId(request: Request): Promise<number | null> {
  return (await getCurrentUserId(request)) || null;
}

function findActor(database: Db, actorId: number): CourseActorFacts | null {
  const user = database.select().from(users).where(eq(users.id, actorId)).get();
  return user ? { id: actorId, role: user.role } : null;
}

export function createAccessGuards(database: Db) {
  return {
    async requireSignedInActor(request: Request): Promise<number> {
      const decision = decideSignedInActor(await signedInActorId(request));
      if (!decision.allowed) throw signedOutDenial();
      return decision.actorId;
    },

    async requireCourseManager(request: Request, courseId: number) {
      const signedIn = decideSignedInActor(await signedInActorId(request));
      if (!signedIn.allowed) throw signedOutDenial();

      const actor = findActor(database, signedIn.actorId);
      // A session can outlive its user row; this guard has always treated that
      // as signed out rather than as a role failure.
      if (!actor) throw signedOutDenial();

      const course = database
        .select()
        .from(courses)
        .where(eq(courses.id, courseId))
        .get();
      const decision = decideCourseManagerAccess({
        actor,
        course: course ? { instructorId: course.instructorId } : null,
      });
      if (!decision.allowed) {
        throw data(NOT_COURSE_MANAGER_MESSAGE, { status: 403 });
      }
      return decision.view;
    },

    async requireInstructorOrPlatformAdmin(request: Request) {
      const signedIn = decideSignedInActor(await signedInActorId(request));
      if (!signedIn.allowed) throw signedOutDenial();

      const decision = decideInstructorOrPlatformAdminAccess({
        actor: findActor(database, signedIn.actorId),
      });
      if (!decision.allowed) {
        // Sign-in is already settled; a missing user row or a Student role is
        // a role failure here, which has always been a 403.
        throw data(NOT_INSTRUCTOR_MESSAGE, { status: 403 });
      }
      return { userId: decision.view.actorId, isAdmin: decision.view.isAdmin };
    },
  };
}
