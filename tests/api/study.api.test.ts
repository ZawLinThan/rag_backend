import {
  request,
  error,
  record,
  resources,
  createCourse,
  otherToken,
  randomUUID,
} from "../helpers/api.js";
const cleanup = resources();
afterEach(() => cleanup.clean());

test("course creation, listing, ownership, deletion and missing IDs", async () => {
  const course = await createCourse(cleanup);
  const path = `/api/courses/${course.id}`;
  const list = await request("GET", "/api/courses");
  expect(list.status).toBe(200);
  expect(list.data).toEqual(expect.arrayContaining([course]));
  expect(await request("GET", path)).toMatchObject({
    status: 200,
    data: course,
  });
  error(await request("GET", path, undefined, otherToken), 404);
  error(await request("DELETE", path, undefined, otherToken), 404);
  const otherList = await request("GET", "/api/courses", undefined, otherToken);
  expect(otherList.status).toBe(200);
  expect(otherList.data.map((item: { id: string }) => item.id)).not.toContain(
    course.id,
  );
  expect(await request("DELETE", path)).toMatchObject({
    status: 204,
    text: "",
  });
  error(await request("GET", path), 404);
});

test.each([{}, { name: "" }, { name: "   " }, { name: 123 }])(
  "rejects invalid course input %j",
  async (body) => {
    error(await request("POST", "/api/courses", body), 400);
  },
);

test("notebooks reject creation against another user's course", async () => {
  const course = await createCourse(cleanup);
  error(
    await request(
      "POST",
      "/api/notebooks",
      { courseId: course.id, noteBookName: "Forbidden" },
      otherToken,
    ),
    404,
  );
  error(
    await request(
      "GET",
      `/api/notebooks?courseId=${course.id}`,
      undefined,
      otherToken,
    ),
    404,
  );
  const listed = await request("GET", `/api/notebooks?courseId=${course.id}`);
  expect(listed.status).toBe(200);
  expect(listed.data).toEqual([]);
});

test("manual flashcards support CRUD and enforce ownership", async () => {
  const input = { title: `Cards ${randomUUID()}`, courseId: null };
  const created = await request("POST", "/api/flashcards", input);
  if (created.data?.id) cleanup.track(`/api/flashcards/${created.data.id}`);
  expect(created.status).toBe(201);
  record(created.data, { ...input, documentId: null });
  const path = `/api/flashcards/${created.data.id}`;
  expect(await request("GET", path)).toMatchObject({ status: 200, data: [] });
  const card = await request("POST", `${path}/cards`, {
    front: "Question",
    back: "Answer",
  });
  expect(card.status).toBe(201);
  expect(card.data).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      setId: created.data.id,
      front: "Question",
      back: "Answer",
    }),
  );
  const cardPath = `${path}/cards/${card.data.id}`;
  for (const method of ["GET", "DELETE"])
    error(await request(method, path, undefined, otherToken), 404);
  error(
    await request(
      "PATCH",
      cardPath,
      { front: "Intruder", back: "No" },
      otherToken,
    ),
    404,
  );
  error(await request("DELETE", cardPath, undefined, otherToken), 404);
  const updated = await request("PATCH", cardPath, {
    front: "Updated",
    back: "Updated answer",
  });
  expect(updated).toMatchObject({
    status: 200,
    data: { id: card.data.id, front: "Updated", back: "Updated answer" },
  });
  const listed = await request("GET", path);
  expect(listed.status).toBe(200);
  expect(listed.data).toEqual(expect.arrayContaining([updated.data]));
  expect(await request("DELETE", cardPath)).toMatchObject({
    status: 204,
    text: "",
  });
  expect(await request("GET", path)).toMatchObject({ status: 200, data: [] });
});

test.each([0, 21, -1, 1.5])(
  "flashcard generation rejects count %s",
  async (count) => {
    error(
      await request("POST", "/api/flashcards/generate", {
        title: "Invalid",
        courseId: null,
        documentId: randomUUID(),
        count,
      }),
      400,
    );
  },
);

test.each([
  "/api/courses",
  "/api/documents",
  "/api/tests",
  "/api/tests/content",
])("missing resource returns a JSON error: %s", async (prefix) => {
  const path =
    prefix === "/api/tests/content"
      ? `/api/tests/${randomUUID()}/content`
      : `${prefix}/${randomUUID()}`;
  error(await request("GET", path), 404);
});

test("test generation rejects an unknown mode", async () => {
  error(
    await request("POST", "/api/tests/generate", {
      title: "Invalid",
      notebookId: randomUUID(),
      mode: "invalid",
      referenceFileId: null,
      referenceUrl: null,
    }),
    400,
  );
});
