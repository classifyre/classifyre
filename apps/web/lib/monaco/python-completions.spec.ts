import { registerPythonCompletions } from "./python-completions";

interface CompletionList {
  incomplete?: boolean;
  suggestions: { label: string }[];
}

interface Provider {
  provideCompletionItems(model: unknown, position: unknown): CompletionList;
}

/**
 * The Monaco surface this provider actually touches.
 *
 * Registering against a fake is what makes the completion *contents* testable
 * without a browser: a component test can only see the rows the suggest widget
 * happens to be showing, and only once Monaco has decided to ask.
 */
function fakeProvider(): Provider {
  let provider: Provider | undefined;
  const kinds = [
    "Function",
    "Method",
    "Property",
    "Field",
    "Class",
    "Variable",
    "Module",
    "Keyword",
    "Snippet",
  ];
  registerPythonCompletions({
    languages: {
      CompletionItemKind: Object.fromEntries(kinds.map((k, i) => [k, i])),
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      registerCompletionItemProvider: (_language: string, p: Provider) => {
        provider = p;
      },
      registerHoverProvider: () => {},
    },
  } as never);
  return provider!;
}

/** What is offered for `line`, with the caret at the end of it. */
function completionsFor(provider: Provider, line: string): CompletionList {
  const word = /[A-Za-z0-9_]*$/.exec(line)![0];
  return provider.provideCompletionItems(
    {
      getWordUntilPosition: () => ({
        word,
        startColumn: line.length + 1 - word.length,
        endColumn: line.length + 1,
      }),
      getValueInRange: () => line,
    },
    { lineNumber: 1, column: line.length + 1 },
  );
}

const labels = (list: CompletionList) =>
  list.suggestions.map((suggestion) => suggestion.label);

describe("the notebook completion provider", () => {
  const provider = fakeProvider();

  it("answers the line, not the word under the caret", () => {
    // `re` prefixes the `return` keyword and two real modules, and which of
    // those can be right is decided by the four characters before it.
    expect(labels(completionsFor(provider, "import re"))).toContain("requests");
    expect(labels(completionsFor(provider, "import re"))).not.toContain(
      "return",
    );
    expect(labels(completionsFor(provider, "re"))).toContain("return");
    expect(labels(completionsFor(provider, "ctx.se"))).toContain("secret");
  });

  it("reports every list as incomplete", () => {
    // Because of the above. Monaco re-asks a provider only while its list says
    // it is incomplete; a list that claims to be complete is fetched once and
    // then filtered client-side as the caret moves on -- and reused wholesale
    // when a new word starts -- so `import re` would go on offering the SDK's
    // `references` from the list built back at `i`.
    const lines = ["", "re", "import re", "ctx.", "ctx.se", "Asset(", "x."];
    for (const line of lines) {
      expect(completionsFor(provider, line).incomplete).toBe(true);
    }
  });
});
