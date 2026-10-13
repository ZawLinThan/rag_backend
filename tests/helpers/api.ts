import { randomUUID } from "node:crypto";
export { randomUUID };

const baseUrl = process.env.TEST_API_URL;
const token = process.env.TEST_USER_TOKEN;
const otherToken = process.env.TEST_OTHER_USER_TOKEN;

if (!baseUrl || !token || !otherToken || token === otherToken) {
  throw new Error(
    "Set TEST_API_URL, TEST_USER_TOKEN and a distinct TEST_OTHER_USER_TOKEN.",
  );
}

// Wire payloads are checked by runtime assertions in each contract test.
export async function request<T = any>(
  method: string,
  path: string,
  body?: unknown,
  auth: string | null = token!,
) {
  const response = await fetch(new URL(path, baseUrl!), {
    method,
    headers: {
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  const text = await response.text();
  let data: T;
  if (text) {
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    data = JSON.parse(text);
  }
  return { status: response.status, data: data!, text };
}

export function error(
  result: { status: number; data: { error: string } },
  status: number,
) {
  expect(result.status).toBe(status);
  expect(result.data).toEqual({ error: expect.any(String) });
  expect(result.data.error.trim()).not.toBe("");
}

export function record(
  value: { id: string; createdAt: string; updatedAt: string },
  fields: Record<string, unknown>,
) {
  expect(value).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      userId: expect.any(String),
      ...fields,
    }),
  );
  expect(value.id).toMatch(/^[0-9a-f-]{36}$/i);
  for (const key of ["createdAt", "updatedAt"] as const) {
    expect(typeof value[key]).toBe("string");
    expect(new Date(value[key]).toISOString()).toBe(value[key]);
  }
}

// Track only resources made by this suite. Cleanup failures fail the suite.
export function resources() {
  const paths: string[] = [];
  return {
    track(path: string) {
      paths.unshift(path);
    },
    async clean() {
      const failures: string[] = [];
      for (const path of paths) {
        try {
          const result = await request("DELETE", path);
          if (![204, 404].includes(result.status))
            failures.push(`${path}: ${result.status}`);
        } catch (cause) {
          failures.push(
            `${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
      }
      paths.length = 0;
      if (failures.length)
        throw new Error(`Fixture cleanup failed: ${failures.join(", ")}`);
    },
  };
}

export async function createCourse(cleanup: ReturnType<typeof resources>) {
  const input = {
    name: `Jest ${randomUUID()}`,
    code: "JEST",
    semester: "Test",
  };
  const result = await request("POST", "/api/courses", input);
  if (result.data?.id) cleanup.track(`/api/courses/${result.data.id}`);
  expect(result.status).toBe(201);
  record(result.data, input);
  return result.data;
}

export async function pollDocument(id: string, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  do {
    const result = await request("GET", `/api/documents/${id}`);
    expect(result.status).toBe(200);
    last = result.data;
    expect(last.id).toBe(id);
    expect(["pending", "queued", "processing", "ready", "failed"]).toContain(
      last.status,
    );
    if (["ready", "failed"].includes(last.status)) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw new Error(
    `Document ${id} did not finish within ${timeoutMs}ms (last status: ${last?.status})`,
  );
}

export { otherToken };
