import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { data } from "react-router";
import * as schema from "~/db/schema";
import { courses, enrollments, purchases, users } from "~/db/schema";
import { resolveCountry } from "~/lib/country.server";
import { getCurrentUserId } from "~/lib/session";
import {
  decideCourseContentAccess,
  getCourseContentAccess,
  isCourseManager,
  type CourseContentAccessView,
  type CourseContentFacts,
} from "./course-content-access";
import { signedOutDenial } from "./request-denials";

export type Db = BetterSQLite3Database<typeof schema>;

const SIGNED_OUT_FACTS: CourseContentFacts = {
  actor: null,
  course: null,
  enrolled: false,
  purchaseCountry: null,
  currentCountry: null,
};

async function resolveFacts(
  database: Db,
  request: Request,
  courseId: number
): Promise<CourseContentFacts> {
  const userId = await getCurrentUserId(request);
  if (!userId) return SIGNED_OUT_FACTS;

  const user = database.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return SIGNED_OUT_FACTS;

  const course = database
    .select()
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
  const enrolled = !!database
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();

  const actor = { id: userId, role: user.role };
  const courseFacts = course
    ? {
        instructorId: course.instructorId,
        price: course.price,
        pppEnabled: course.pppEnabled,
      }
    : null;
  const base = { actor, course: courseFacts, enrolled };

  // Country and purchase are only relevant to a Student whose Enrollment is
  // subject to the course's PPP restriction.
  if (!enrolled || !course || isCourseManager(actor, courseFacts)) {
    return { ...base, purchaseCountry: null, currentCountry: null };
  }

  const purchase = database
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .get();

  return {
    ...base,
    purchaseCountry: purchase?.country ?? null,
    currentCountry: await resolveCountry(request),
  };
}

export function createCourseContentAccess(database: Db) {
  return {
    async getView(
      request: Request,
      courseId: number
    ): Promise<CourseContentAccessView> {
      return getCourseContentAccess(
        await resolveFacts(database, request, courseId)
      );
    },

    async require(
      request: Request,
      courseId: number
    ): Promise<CourseContentAccessView> {
      const decision = decideCourseContentAccess(
        await resolveFacts(database, request, courseId)
      );
      if (!decision.allowed) {
        if (decision.reason === "signed-out") throw signedOutDenial();
        throw data("You must be enrolled in this course.", { status: 403 });
      }
      return decision.view;
    },
  };
}
