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

const SIGNED_OUT_MESSAGE = "Select a user from the DevUI panel.";
const NOT_COURSE_MANAGER_MESSAGE = "Only this course's instructor can do that.";
const NOT_INSTRUCTOR_MESSAGE = "Only instructors can access this page.";

function signedOut() {
  return data(SIGNED_OUT_MESSAGE, { status: 401 });
}

// A falsy session id counts as signed out, as it always has in these guards.
async function signedInActorId(request: Request): Promise<number | null> {
  return (await getCurrentUserId(request)) || null;
}

function findActor(database: Db, actorId: number): CourseActorFacts | null {
  const user = database.select().from(users).where(eq(users.id, actorId)).get();
  return user ? { id: actorId, role: user.role } : null;
}

/**
 * Authorization guards bound to a database. The app uses the shared
 * `accessGuards` instance; tests build their own against a test database.
 */
export function createAccessGuards(database: Db) {
  return {
    /** Throws 401 unless someone is signed in. Returns their id. */
    async requireSignedInActor(request: Request): Promise<number> {
      const decision = decideSignedInActor(await signedInActorId(request));
      if (!decision.allowed) throw signedOut();
      return decision.actorId;
    },

    /** Throws 401 when signed out, 403 when the actor cannot manage this course. */
    async requireCourseManager(request: Request, courseId: number) {
      const signedIn = decideSignedInActor(await signedInActorId(request));
      if (!signedIn.allowed) throw signedOut();

      const course = database
        .select()
        .from(courses)
        .where(eq(courses.id, courseId))
        .get();
      const decision = decideCourseManagerAccess({
        actor: findActor(database, signedIn.actorId),
        course: course ? { instructorId: course.instructorId } : null,
      });
      if (!decision.allowed) {
        if (decision.reason === "signed-out") throw signedOut();
        throw data(NOT_COURSE_MANAGER_MESSAGE, { status: 403 });
      }
      return decision.view;
    },

    /** Guards non-course-scoped Instructor areas and reports admin status. */
    async requireInstructorOrPlatformAdmin(request: Request) {
      const signedIn = decideSignedInActor(await signedInActorId(request));
      if (!signedIn.allowed) throw signedOut();

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
