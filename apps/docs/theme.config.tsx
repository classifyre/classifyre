const config = {
  logo: (
    <span style={{ fontWeight: 700, letterSpacing: "-0.02em" }}>
      Classifyre
    </span>
  ),
  project: {
    link: "https://github.com/classifyre-com/classifyre",
  },
  docsRepositoryBase:
    "https://github.com/classifyre-com/classifyre/tree/main/apps/docs",
  useNextSeoProps() {
    return { titleTemplate: "%s – Classifyre Docs" };
  },
  head: (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </>
  ),
  footer: {
    text: (
      <span>
        © {new Date().getFullYear()} Classifyre. Open-source metadata ingestion
        for unstructured data.
      </span>
    ),
  },
  sidebar: {
    defaultMenuCollapseLevel: 1,
    toggleButton: true,
  },
  toc: {
    backToTop: true,
  },
};

export default config;
