import { users, UserRole } from "~/db/schema";
import { setCurrentUserId } from "~/lib/session";
import { seedBaseData, type TestDb } from "~/test/setup";

const BASE_URL = "http://localhost/";

type Denial = { status: number; message: string };

function isDenial(
  error: unknown
): error is { data: string; init: { status: number } } {
  return (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    "init" in error
  );
}

export async function deniedBy(run: () => Promise<unknown>): Promise<Denial> {
  try {
    await run();
  } catch (error) {
    if (isDenial(error)) {
      return { status: error.init.status, message: error.data };
    }
    throw error;
  }
  throw new Error("Expected the access guard to deny the request");
}

export async function signedInRequest(
  userId: number,
  headers: Record<string, string> = {}
) {
  const cookie = await setCurrentUserId(
    new Request(BASE_URL, { headers }),
    userId
  );
  return new Request(BASE_URL, {
    headers: { ...headers, Cookie: cookie },
  });
}

export function seedRequestFixtures(database: TestDb) {
  const fixtures = seedBaseData(database);
  // Request adapters resolve roles and ownership from stored rows, unlike the
  // plain-facts policy tests, so a Platform Admin needs a real user row here.
  const platformAdminId = database
    .insert(users)
    .values({
      name: "Test Platform Admin",
      email: "admin@example.com",
      role: UserRole.Admin,
    })
    .returning()
    .get().id;
  return { ...fixtures, platformAdminId };
}
