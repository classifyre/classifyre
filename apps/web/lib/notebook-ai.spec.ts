import {
  buildMessages,
  buildSystemPrompt,
  parseAiReply,
  type NotebookAiContext,
} from "./notebook-ai";

const context = (
  overrides: Partial<NotebookAiContext> = {},
): NotebookAiContext => ({
  cells: [
    {
      id: "imports",
      type: "code",
      source: "from classifyre import Asset, ctx",
    },
    {
      id: "extract",
      type: "code",
      source: "def extract():\n    yield Asset(id='1')",
    },
    { id: "notes", type: "markdown", source: "# Notes" },
  ],
  targetCellId: "extract",
  packages: [{ name: "httpx", version: ">=0.27" }],
  variables: { api_base: "https://api.example.com" },
  secretKeys: ["api_token"],
  ...overrides,
});

describe("buildSystemPrompt", () => {
  it("shows the whole notebook and marks the target cell", () => {
    const prompt = buildSystemPrompt(context());
    expect(prompt).toContain("cell id=imports");
    expect(prompt).toContain("cell id=extract");
    expect(prompt).toContain("cell id=notes");
    // Without this the model has no idea which cell it is being asked to write.
    expect(prompt).toMatch(/cell id=extract.*THE TARGET CELL/);
  });

  it("lists declared packages", () => {
    expect(buildSystemPrompt(context())).toContain("httpx >=0.27");
  });

  it("says so when nothing is declared, rather than leaving a blank", () => {
    const prompt = buildSystemPrompt(
      context({ packages: [], variables: {}, secretKeys: [] }),
    );
    expect(prompt).toContain("none declared");
    expect(prompt).toContain("none configured");
  });

  it("gives variable values, which are not secret", () => {
    const prompt = buildSystemPrompt(context());
    expect(prompt).toContain('ctx.var("api_base")');
    expect(prompt).toContain("https://api.example.com");
  });

  it("gives secret NAMES and never a value", () => {
    // The browser is never sent secret values, so there is nothing to leak --
    // but this asserts the shape stays that way if that ever changes.
    const prompt = buildSystemPrompt(
      context({ secretKeys: ["api_token", "signing_key"] }),
    );
    expect(prompt).toContain('ctx.secret("api_token")');
    expect(prompt).toContain('ctx.secret("signing_key")');
    expect(prompt).toContain("values are never shown");
  });

  it("carries the SDK surface generated from the Python SDK", () => {
    const prompt = buildSystemPrompt(context());
    expect(prompt).toContain("ctx.secret");
    expect(prompt).toContain("ctx.offset");
    // Asset fields come from the same generated manifest as the editor's
    // autocomplete, so the model cannot be told about a field that went away.
    expect(prompt).toContain("content_bytes");
  });

  it("states the reply contract both ways", () => {
    const prompt = buildSystemPrompt(context());
    expect(prompt).toContain("ONE ```python block");
    expect(prompt).toContain("NO python code block");
  });
});

describe("buildMessages", () => {
  it("puts the system prompt first, then history, then the question", () => {
    const messages = buildMessages(
      context(),
      [
        { role: "user", content: "earlier question" },
        { role: "assistant", content: "earlier answer" },
      ],
      "now do this",
    );
    expect(messages.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
    expect(messages[3]!.content).toBe("now do this");
  });

  it("rebuilds the notebook into the prompt on every turn", () => {
    // History holds prose only. If the code rode along in history the model
    // would reason about a copy the user has since edited.
    const edited = context({
      cells: [
        { id: "extract", type: "code", source: "def extract():\n    pass" },
      ],
    });
    const messages = buildMessages(edited, [], "again");
    expect(messages[0]!.content).toContain("def extract():\n    pass");
  });
});

describe("parseAiReply", () => {
  it("treats a python block as a replacement for the cell", () => {
    const reply = parseAiReply(
      "Here you go:\n\n```python\ndef extract():\n    yield Asset(id='1')\n```",
    );
    expect(reply.code).toBe("def extract():\n    yield Asset(id='1')");
    expect(reply.text).toBe("Here you go:");
  });

  it("leaves the cell alone when the answer is prose", () => {
    // Asking a question must never silently rewrite the code.
    const reply = parseAiReply("It fails because the token has expired.");
    expect(reply.code).toBeNull();
    expect(reply.text).toBe("It fails because the token has expired.");
  });

  it("accepts a bare fence and a py fence", () => {
    expect(parseAiReply("```\nx = 1\n```").code).toBe("x = 1");
    expect(parseAiReply("```py\nx = 1\n```").code).toBe("x = 1");
  });

  it("joins multiple blocks, because a cell holds one source", () => {
    const reply = parseAiReply(
      "```python\nimport httpx\n```\nand then\n```python\ndef extract():\n    pass\n```",
    );
    expect(reply.code).toBe("import httpx\n\ndef extract():\n    pass");
    expect(reply.text).toContain("and then");
  });

  it("keeps the whole message as prose when there is no code", () => {
    const reply = parseAiReply("Line one\n\nLine two");
    expect(reply.text).toBe("Line one\n\nLine two");
  });

  it("does not report an empty code block as a change", () => {
    const reply = parseAiReply("Nothing to change.\n\n```python\n```");
    expect(reply.code).toBeNull();
  });

  it("survives an unterminated fence without throwing", () => {
    const reply = parseAiReply("```python\ndef extract():");
    expect(reply.code).toBeNull();
    expect(reply.text).toContain("def extract():");
  });
});
