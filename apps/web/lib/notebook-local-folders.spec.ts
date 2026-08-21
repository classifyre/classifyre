import {
  FOLDER_NAME_PATTERN,
  localFoldersAreValid,
  localFoldersToConfig,
  validateLocalFolder,
} from "./notebook-local-folders";

describe("folder name validation", () => {
  it.each(["dumps", "_private", "exports_2024", "a"])(
    "accepts %p as a ctx.folder() key",
    (name) => {
      expect(FOLDER_NAME_PATTERN.test(name)).toBe(true);
    },
  );

  it.each(["", "2024", "with space", "with-dash", "a".repeat(64)])(
    "rejects %p",
    (name) => {
      expect(FOLDER_NAME_PATTERN.test(name)).toBe(false);
    },
  );
});

describe("validateLocalFolder", () => {
  it("requires a name and a path", () => {
    expect(validateLocalFolder([{ name: "", path: "/tmp" }], 0)).toBe(
      "nameRequired",
    );
    expect(validateLocalFolder([{ name: "dumps", path: "" }], 0)).toBe(
      "pathRequired",
    );
  });

  it("rejects a name ctx.folder() could not take", () => {
    expect(validateLocalFolder([{ name: "my dumps", path: "/tmp" }], 0)).toBe(
      "invalidName",
    );
  });

  it("flags the second use of a name, not the first", () => {
    const folders = [
      { name: "dumps", path: "/a" },
      { name: "dumps", path: "/b" },
    ];
    expect(validateLocalFolder(folders, 0)).toBeNull();
    expect(validateLocalFolder(folders, 1)).toBe("duplicate");
  });

  it("requires an absolute path", () => {
    // A relative path would resolve against the runner's working directory,
    // which is never what the author meant.
    expect(validateLocalFolder([{ name: "d", path: "dumps" }], 0)).toBe(
      "pathNotAbsolute",
    );
    expect(validateLocalFolder([{ name: "d", path: "./dumps" }], 0)).toBe(
      "pathNotAbsolute",
    );
    expect(validateLocalFolder([{ name: "d", path: "/data/dumps" }], 0)).toBe(
      null,
    );
  });

  it("accepts a Windows path, since the desktop app runs there too", () => {
    expect(
      validateLocalFolder([{ name: "d", path: "C:\\data\\dumps" }], 0),
    ).toBeNull();
    expect(
      validateLocalFolder([{ name: "d", path: "D:/data/dumps" }], 0),
    ).toBeNull();
  });
});

describe("localFoldersToConfig", () => {
  it("drops half-filled rows rather than saving them", () => {
    expect(
      localFoldersToConfig([
        { name: "dumps", path: " /data/dumps " },
        { name: "", path: "" },
        { name: "exports", path: "" },
      ]),
    ).toEqual([{ name: "dumps", path: "/data/dumps" }]);
  });
});

describe("localFoldersAreValid", () => {
  it("is true for an empty list -- folders are optional", () => {
    expect(localFoldersAreValid([])).toBe(true);
  });

  it("is false while a row is still being filled in", () => {
    expect(localFoldersAreValid([{ name: "dumps", path: "" }])).toBe(false);
  });
});
