import test from "node:test";
import assert from "node:assert/strict";
import { createElement, act, StrictMode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { useWorkspace } from "../lib/folio/use-workspace.ts";
import { newPage, type Workspace } from "../lib/folio/model.ts";
const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
type Hook = ReturnType<typeof useWorkspace>;
function deferredResponse() {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const snapshot = (workspace: Workspace, revision = 0, userId?: string) =>
  Response.json({
    workspace,
    revision,
    userId,
    pageRevisions: Object.fromEntries(
      workspace.pages.map((page) => [page.id, revision]),
    ),
    permissions: {},
    access: {},
  });
async function withHook(
  fetch: typeof globalThis.fetch,
  run: (app: () => Hook) => Promise<void>,
  options: { team?: boolean; strict?: boolean; accountId?: string } = {},
) {
  const originalFetch = globalThis.fetch,
    originalWindow = globalThis.window;
  Object.assign(globalThis, {
    fetch,
    window: new EventTarget(),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  let app!: Hook, renderer: ReactTestRenderer | undefined;
  function Harness() {
    app = useWorkspace({ team: options.team, accountId: options.accountId });
    return null;
  }
  try {
    await act(async () => {
      renderer = create(
        options.strict
          ? createElement(StrictMode, null, createElement(Harness))
          : createElement(Harness),
      );
    });
    await run(() => app);
  } finally {
    await act(async () => renderer?.unmount());
    globalThis.fetch = originalFetch;
    Object.assign(globalThis, { window: originalWindow });
  }
}
const fixture = (): Workspace => ({
  version: 1,
  name: "Workspace",
  theme: "light",
  pages: [newPage("Original")],
});

test("team loads reject another account's workspace and request a session refresh", async () => {
  const initial = fixture(),
    loading = deferredResponse();
  let reads = 0;
  await withHook(
    (async () => {
      return reads++ === 0
        ? loading.promise
        : snapshot(initial, 1, "account-a");
    }) as typeof fetch,
    async (app) => {
      let refreshes = 0;
      window.addEventListener("folio:session", () => refreshes++);
      await act(async () =>
        loading.resolve(
          snapshot({ ...initial, name: "Another account" }, 9, "account-b"),
        ),
      );
      assert.equal(refreshes, 1);
      assert.equal(app().workspace, null);
      assert.deepEqual(app().pageRevisions, {});
      assert.equal(app().generation, 0);
      await act(async () => {
        await app().reload();
      });
      assert.deepEqual(app().workspace, initial);
      assert.equal(app().status, "saved");
    },
    { team: true, accountId: "account-a" },
  );
});

test("team saves identify the mounted account and reject a different response actor", async () => {
  const initial = fixture();
  const writes: { url: string; actor: string | null }[] = [];
  await withHook(
    (async (url, options) => {
      if (options?.method !== "POST") return snapshot(initial, 1, "account-a");
      writes.push({
        url: String(url),
        actor: new Headers(options.headers).get("X-Folio-User"),
      });
      return snapshot({ ...initial, name: "Another account" }, 9, "account-b");
    }) as typeof fetch,
    async (app) => {
      let refreshes = 0;
      window.addEventListener("folio:session", () => refreshes++);
      await act(async () =>
        app().updatePage(initial.pages[0].id, { title: "Local draft" }),
      );
      await act(async () => {
        await app().flush();
      });
      assert.deepEqual(writes, [
        { url: "/api/team/workspace", actor: "account-a" },
      ]);
      assert.equal(refreshes, 1);
      assert.equal(app().workspace?.name, initial.name);
      assert.equal(app().workspace?.pages[0].title, "Local draft");
      assert.equal(app().pageRevisions[initial.pages[0].id], 1);
      assert.equal(app().status, "error");
      assert.match(app().error, /account changed/i);
    },
    { team: true, accountId: "account-a" },
  );
});

test("Strict Mode cleanup cancels obsolete initial loads before an edit can be lost", async () => {
  const gets: ReturnType<typeof deferredResponse>[] = [],
    initial = fixture();
  await withHook(
    (async () => {
      const request = deferredResponse();
      gets.push(request);
      return request.promise;
    }) as typeof fetch,
    async (app) => {
      assert.equal(
        gets.length,
        1,
        "an obsolete Strict Mode effect must not issue a second load",
      );
      await act(async () => gets[0].resolve(snapshot(initial)));
      await act(async () =>
        app().updatePage(initial.pages[0].id, { title: "Fresh edit" }),
      );
      assert.equal(app().workspace?.pages[0].title, "Fresh edit");
      assert.equal(app().status, "unsaved");
    },
    { strict: true },
  );
});

test("late reload success and failure cannot replace edits made during the request", async () => {
  const initial = fixture(),
    reads: ReturnType<typeof deferredResponse>[] = [];
  let count = 0;
  await withHook(
    (async () => {
      if (count++ === 0) return snapshot(initial);
      const request = deferredResponse();
      reads.push(request);
      return request.promise;
    }) as typeof fetch,
    async (app) => {
      let pending!: Promise<void>;
      await act(async () => {
        pending = app().reload();
      });
      await act(async () =>
        app().updatePage(initial.pages[0].id, { title: "Newer edit" }),
      );
      await act(async () => {
        reads[0].resolve(snapshot(initial));
        await pending;
      });
      assert.equal(app().workspace?.pages[0].title, "Newer edit");
      assert.equal(app().status, "unsaved");
      await act(async () => {
        pending = app().reload();
      });
      await act(async () =>
        app().updatePage(initial.pages[0].id, { title: "Newest edit" }),
      );
      await act(async () => {
        reads[1].reject(new Error("Late network failure"));
        await pending;
      });
      assert.equal(app().workspace?.pages[0].title, "Newest edit");
      assert.equal(app().status, "unsaved");
      assert.equal(app().error, "");
    },
  );
});

test("out-of-order explicit loads keep the newest workspace and revision", async () => {
  const initial = fixture(),
    reads: ReturnType<typeof deferredResponse>[] = [];
  let count = 0;
  await withHook(
    (async () => {
      if (count++ === 0) return snapshot(initial, 1);
      const request = deferredResponse();
      reads.push(request);
      return request.promise;
    }) as typeof fetch,
    async (app) => {
      const generation = app().generation;
      let older!: Promise<void>, newer!: Promise<void>;
      await act(async () => {
        older = app().reload();
        newer = app().reload();
      });
      await act(async () => {
        reads[1].resolve(snapshot({ ...initial, name: "New" }, 3));
        await newer;
      });
      await act(async () => {
        reads[0].resolve(snapshot({ ...initial, name: "Old" }, 2));
        await older;
      });
      assert.equal(app().workspace?.name, "New");
      assert.equal(app().pageRevisions[initial.pages[0].id], 3);
      assert.equal(app().generation, generation + 1);
    },
    { team: true },
  );
});

test("overlapping background polls cannot roll back content or page revisions", async () => {
  const initial = fixture(),
    reads: ReturnType<typeof deferredResponse>[] = [];
  let count = 0;
  await withHook(
    (async () => {
      if (count++ === 0) return snapshot(initial, 1);
      const request = deferredResponse();
      reads.push(request);
      return request.promise;
    }) as typeof fetch,
    async (app) => {
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(new Event("focus"));
      });
      assert.equal(reads.length, 2);
      const content = (text: string): Workspace => ({
        ...initial,
        pages: [
          {
            ...initial.pages[0],
            content: {
              type: "doc",
              content: [
                { type: "paragraph", content: [{ type: "text", text }] },
              ],
            },
          },
        ],
      });
      await act(async () =>
        reads[1].resolve(snapshot(content("Latest remote content"), 3)),
      );
      await act(async () =>
        reads[0].resolve(snapshot(content("Stale remote content"), 2)),
      );
      assert.deepEqual(app().workspace, content("Latest remote content"));
      assert.equal(app().pageRevisions[initial.pages[0].id], 3);
      assert.equal(app().remoteVersions[initial.pages[0].id], 1);
    },
    { team: true },
  );
});

test("a poll started before reload cannot undo the accepted reload", async () => {
  const initial = fixture(),
    reads: ReturnType<typeof deferredResponse>[] = [];
  let count = 0;
  await withHook(
    (async () => {
      if (count++ === 0) return snapshot(initial, 1);
      const request = deferredResponse();
      reads.push(request);
      return request.promise;
    }) as typeof fetch,
    async (app) => {
      let reload!: Promise<void>;
      await act(async () => window.dispatchEvent(new Event("focus")));
      await act(async () => {
        reload = app().reload();
      });
      await act(async () => {
        reads[1].resolve(snapshot({ ...initial, name: "Reloaded" }, 3));
        await reload;
      });
      await act(async () =>
        reads[0].resolve(snapshot({ ...initial, name: "Before reload" }, 2)),
      );
      assert.equal(app().workspace?.name, "Reloaded");
      assert.equal(app().pageRevisions[initial.pages[0].id], 3);
    },
    { team: true },
  );
});

test("team saves preserve pending edits and merge unrelated remote pages", async () => {
  const initial = fixture();
  initial.pages.push(newPage("Another page"));
  const first = deferredResponse(),
    writes: {
      changes: { page: Workspace["pages"][number]; baseRevision: number }[];
    }[] = [];
  const received = {
    ...initial,
    pages: [
      { ...initial.pages[0], title: "First edit" },
      { ...initial.pages[1], title: "Remote update" },
    ],
  };
  await withHook(
    (async (_url, options) => {
      if (options?.method !== "POST") return snapshot(initial, 1);
      const command = JSON.parse(String(options.body));
      writes.push(command);
      if (writes.length === 1) return first.promise;
      return snapshot(
        { ...received, pages: [command.changes[0].page, received.pages[1]] },
        3,
      );
    }) as typeof fetch,
    async (app) => {
      await act(async () =>
        app().updatePage(initial.pages[0].id, { title: "First edit" }),
      );
      let saving!: Promise<void>;
      await act(async () => {
        saving = app().flush();
      });
      await act(async () =>
        app().updatePage(initial.pages[0].id, {
          description: "Typed while saving",
        }),
      );
      await act(async () => {
        first.resolve(snapshot(received, 2));
        await saving;
      });
      assert.equal(app().workspace?.pages[0].description, "Typed while saving");
      assert.equal(app().workspace?.pages[1].title, "Remote update");
      await act(async () => {
        await app().flush();
      });
      assert.equal(writes.length, 2);
      assert.equal(writes[1].changes.length, 1);
      assert.equal(writes[1].changes[0].baseRevision, 2);
      assert.equal(writes[1].changes[0].page.description, "Typed while saving");
      assert.equal(app().workspace?.pages[1].title, "Remote update");
      assert.equal(app().status, "saved");
    },
    { team: true },
  );
});

test("a delayed favorite response cannot replace a newer remote page", async () => {
  const initial = fixture(),
    preference = deferredResponse();
  const favorite = {
    ...initial,
    pages: [{ ...initial.pages[0], favorite: true }],
  };
  const remote = {
    ...favorite,
    pages: [{ ...favorite.pages[0], title: "New remote edit" }],
  };
  let reads = 0;
  await withHook(
    (async (url) => {
      if (String(url).endsWith("/preferences")) return preference.promise;
      return reads++ === 0 ? snapshot(initial, 1) : snapshot(remote, 2);
    }) as typeof fetch,
    async (app) => {
      let pending!: Promise<boolean>;
      await act(async () => {
        pending = app().setFavorite(initial.pages[0].id, true);
      });
      await act(async () => window.dispatchEvent(new Event("focus")));
      assert.equal(app().workspace?.pages[0].title, "New remote edit");
      await act(async () => {
        preference.resolve(snapshot(favorite, 1));
        await pending;
      });
      assert.equal(app().workspace?.pages[0].title, "New remote edit");
      assert.equal(app().workspace?.pages[0].favorite, true);
      assert.equal(app().pageRevisions[initial.pages[0].id], 2);
    },
    { team: true },
  );
});

test("editing during a conflict reload preserves a visible recovery state", async () => {
  const initial = fixture(),
    loading = deferredResponse();
  let reads = 0;
  await withHook(
    (async (_url, options) => {
      if (options?.method === "PUT")
        return Response.json(
          { error: "Changed in another tab" },
          { status: 409 },
        );
      return reads++ === 0 ? snapshot(initial) : loading.promise;
    }) as typeof fetch,
    async (app) => {
      await act(async () =>
        app().updatePage(initial.pages[0].id, { title: "Local edit" }),
      );
      await act(async () => {
        await app().flush();
      });
      assert.equal(app().status, "conflict");
      let reload!: Promise<void>;
      await act(async () => {
        reload = app().reload();
      });
      await act(async () =>
        app().updatePage(initial.pages[0].id, {
          title: "New draft during reload",
        }),
      );
      await act(async () => {
        loading.resolve(snapshot(initial));
        await reload;
      });
      assert.equal(app().workspace?.pages[0].title, "New draft during reload");
      assert.equal(app().status, "conflict");
      assert.ok(
        app().error,
        "the banner must explain how to recover the unsaved draft",
      );
    },
  );
});
test("autosave drains edits made during slow requests and reload resets editor generation", async () => {
  const originalFetch = globalThis.fetch,
    originalWindow = globalThis.window;
  Object.assign(globalThis, {
    window: new EventTarget(),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  let app!: ReturnType<typeof useWorkspace>;
  let renderer: ReactTestRenderer | undefined;
  const initial: Workspace = {
    version: 1,
    name: "Initial",
    theme: "light",
    pages: [newPage("Test")],
  };
  const writes: { revision: number; workspace: Workspace }[] = [];
  let release: (response: Response) => void = () => {};
  let serverRevision = 0;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const request = JSON.parse(String(init.body));
      writes.push(request);
      if (writes.length === 1)
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      return Response.json({ revision: ++serverRevision });
    }
    return Response.json({
      revision: serverRevision,
      workspace: { ...initial, name: "Saved server state" },
    });
  }) as typeof fetch;
  function Harness() {
    app = useWorkspace();
    return null;
  }
  try {
    await act(async () => {
      renderer = create(createElement(Harness));
    });
    assert.equal(app.status, "saved");
    const generation = app.generation;
    await act(async () => {
      app.mutate((w) => ({ ...w, name: "First edit" }));
    });
    await act(async () => {
      await tick(350);
    });
    assert.equal(writes.length, 1);
    await act(async () => {
      app.mutate((w) => ({ ...w, name: "Second edit during save" }));
    });
    await act(async () => {
      await tick(350);
    });
    assert.equal(writes.length, 1);
    await act(async () => {
      serverRevision = 1;
      release(Response.json({ revision: 1 }));
      await tick(5);
    });
    await act(async () => {
      await tick(350);
    });
    assert.equal(writes.length, 2);
    assert.equal(writes[1].workspace.name, "Second edit during save");
    assert.equal(writes[1].revision, 1);
    assert.equal(app.status, "saved");
    await act(async () => {
      await app.reload();
    });
    assert.equal(app.workspace?.name, "Saved server state");
    assert.equal(app.generation, generation + 1);
  } finally {
    await act(async () => renderer?.unmount());
    globalThis.fetch = originalFetch;
    Object.assign(globalThis, { window: originalWindow });
  }
});
test("a failed reload preserves conflict recovery and never sends an overwrite", async () => {
  const originalFetch = globalThis.fetch,
    originalWindow = globalThis.window;
  Object.assign(globalThis, {
    window: new EventTarget(),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  let app!: ReturnType<typeof useWorkspace>,
    renderer: ReactTestRenderer | undefined,
    loadCount = 0,
    writes = 0;
  const workspace: Workspace = {
    version: 1,
    name: "Conflict",
    theme: "light",
    pages: [newPage("Test")],
  };
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    if (init?.method === "PUT") {
      writes++;
      return Response.json({ error: "Conflict" }, { status: 409 });
    }
    if (++loadCount > 1)
      return Response.json({ error: "Offline" }, { status: 503 });
    return Response.json({ revision: 0, workspace });
  }) as typeof fetch;
  function Harness() {
    app = useWorkspace();
    return null;
  }
  try {
    await act(async () => {
      renderer = create(createElement(Harness));
    });
    await act(async () => app.mutate((w) => ({ ...w, name: "Unsaved" })));
    await act(async () => {
      await tick(350);
    });
    assert.equal(app.status, "conflict");
    await act(async () => {
      await app.reload();
    });
    assert.equal(app.status, "conflict");
    assert.equal(app.workspace?.name, "Unsaved");
    await act(async () => {
      await app.retry();
    });
    assert.equal(writes, 1);
  } finally {
    await act(async () => renderer?.unmount());
    globalThis.fetch = originalFetch;
    Object.assign(globalThis, { window: originalWindow });
  }
});
