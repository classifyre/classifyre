import type { ApplyBoardOpsResponseDto, CaseBoardResponseDto } from "@workspace/api-client";
import { createBoardStore } from "./board-store";
import { addNote, editText, moveItems } from "./commands";
import type { BoardOp } from "./ops";

// jest hoists jest.mock above the imports; the factory only reaches these
// mocks once a request is made.
const mockGet = jest.fn<Promise<CaseBoardResponseDto>, [unknown]>();
const mockApplyOps = jest.fn<Promise<ApplyBoardOpsResponseDto>, [{ applyBoardOpsDto: { ops: BoardOp[] } }]>();

jest.mock("@workspace/api-client", () => ({
  api: {
    caseBoard: {
      caseBoardControllerGet: (arg: unknown) => mockGet(arg),
      caseBoardControllerApplyOps: (arg: { applyBoardOpsDto: { ops: BoardOp[] } }) => mockApplyOps(arg),
    },
  },
  getActorName: () => "tester",
  ResponseError: class ResponseError extends Error {},
}));

const T0 = "2026-09-26T10:00:00.000Z";
const T1 = "2026-09-26T10:00:01.000Z";
const T2 = "2026-09-26T10:00:02.000Z";
const T3 = "2026-09-26T10:00:03.000Z";

function noteDto(x: number, updatedAt: string, text = "before") {
  return {
    id: "N",
    kind: "NOTE",
    refId: null,
    x,
    y: 0,
    width: 220,
    height: 160,
    z: 0,
    parentId: null,
    collapsed: false,
    style: null,
    content: { text },
    createdBy: null,
    updatedBy: null,
    createdAt: new Date(T0),
    updatedAt: new Date(updatedAt),
  };
}

function board(version: number, items: ReturnType<typeof noteDto>[]): CaseBoardResponseDto {
  return {
    board: { id: "B", caseId: "C", version, readOnly: false, caseStatus: "OPEN" },
    items,
    links: [],
    evidence: [],
    graph: { nodes: [], edges: [], truncated: false },
    supports: [],
    threads: [],
  } as unknown as CaseBoardResponseDto;
}

/** The server applies every op it is sent, answering with the next stamp each time. */
function serverAnswering(stamps: string[]) {
  let call = 0;
  mockApplyOps.mockImplementation(({ applyBoardOpsDto }) => {
    const stamp = stamps[call] ?? stamps[stamps.length - 1]!;
    call += 1;
    return Promise.resolve({
      version: 1 + call,
      applied: applyBoardOpsDto.ops.map((op) => ({
        opId: op.opId,
        id: "id" in op ? op.id : undefined,
        updatedAt: new Date(stamp),
      })),
      rejected: [],
      stale: false,
    } as unknown as ApplyBoardOpsResponseDto);
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockGet.mockReset();
  mockApplyOps.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("board store", () => {
  it("opens read-only on a demo instance, so nothing it cannot save is ever sent", async () => {
    mockGet.mockResolvedValueOnce(board(1, [noteDto(0, T0)]));
    const store = createBoardStore("C", { demo: true });
    await store.getState().load();
    expect(store.getState().readOnly).toBe(true);
    store.getState().run(addNote({ x: 10, y: 10 }));
    expect(store.getState().items.size).toBe(1);
  });

  it("does not put back a board read that raced one of its own batches, and reads again", async () => {
    mockGet.mockResolvedValueOnce(board(1, [noteDto(0, T0)]));
    const store = createBoardStore("C");
    await store.getState().load();
    const stop = store.getState().connect();
    serverAnswering([T1]);

    // A slow read starts (the minute's poll, a focus)…
    const slow = deferred<CaseBoardResponseDto>();
    mockGet.mockImplementationOnce(() => slow.promise);
    const reading = store.getState().load();
    // …and the note is moved and saved while it is in flight.
    store.getState().run(moveItems([{ id: "N", from: { x: 0, y: 0 }, to: { x: 500, y: 0 } }]));
    await store.getState().flush();

    // The read answers with the board as it was before the move.
    mockGet.mockResolvedValueOnce(board(2, [noteDto(500, T1)]));
    slow.resolve(board(1, [noteDto(0, T0)]));
    await reading;
    expect(store.getState().items.get("N")!.x).toBe(500);

    // It reads again, and that answer is taken.
    await jest.advanceTimersByTimeAsync(300);
    expect(mockGet).toHaveBeenCalledTimes(3);
    expect(store.getState().version).toBe(2);
    stop();
  });

  it("reads again after an in-flight read when a refetch is asked for meanwhile", async () => {
    mockGet.mockResolvedValueOnce(board(1, []));
    const store = createBoardStore("C");
    await store.getState().load();

    const slow = deferred<CaseBoardResponseDto>();
    mockGet.mockImplementationOnce(() => slow.promise);
    const reading = store.getState().load();
    // Someone else changed the board: the socket asks for a refetch.
    store.getState().refetch();
    await jest.advanceTimersByTimeAsync(300);
    expect(mockGet).toHaveBeenCalledTimes(2);

    mockGet.mockResolvedValueOnce(board(2, [noteDto(0, T1)]));
    slow.resolve(board(1, []));
    await reading;
    await jest.advanceTimersByTimeAsync(300);
    expect(mockGet).toHaveBeenCalledTimes(3);
    expect(store.getState().items.has("N")).toBe(true);
  });

  it("redoes a text edit: each replay claims the version the board's last write left", async () => {
    mockGet.mockResolvedValueOnce(board(1, [noteDto(0, T0)]));
    const store = createBoardStore("C");
    await store.getState().load();
    const stop = store.getState().connect();
    serverAnswering([T1, T2, T3]);

    store.getState().run(editText(store.getState().items.get("N")!, "after"));
    await store.getState().flush();
    store.getState().undo();
    await store.getState().flush();
    store.getState().redo();
    await store.getState().flush();

    const claims = mockApplyOps.mock.calls.map(([arg]) => {
      const op = arg.applyBoardOpsDto.ops[0] as Extract<BoardOp, { type: "item.update" }>;
      return op.expectedUpdatedAt;
    });
    expect(claims).toEqual([T0, T1, T2]);
    expect(store.getState().items.get("N")!.content.text).toBe("after");
    stop();
  });
});
