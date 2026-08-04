import { Button, SourceIcon, ThemeToggle } from "@workspace/ui/components";

import { demoUrl, repoUrl, routes } from "@/lib/site";

/**
 * The action end of the navbar.
 *
 * Navigation itself is not here — Product, Blog, and Documentation come from
 * `app/_meta.js`, so Nextra renders them with its own menu and folds them into
 * its mobile drawer below `md`. This component only adds what the theme has no
 * concept of: the download CTA, the demo link, and the repo.
 *
 * The download button stays visible at every width because it is the page's
 * primary action; the rest collapse into the drawer with the nav links.
 */
export function SiteNav() {
  return (
    <div className="flex items-center gap-2">
      <Button
        asChild
        size="sm"
        className="border-2 border-accent bg-accent text-black hover:bg-accent/90"
      >
        <a href={routes.download}>Download</a>
      </Button>

      <Button
        asChild
        variant="ghost"
        size="sm"
        className="hidden border-2 border-border hover:border-accent md:inline-flex"
      >
        <a href={demoUrl} target="_blank" rel="noreferrer">
          Demo
        </a>
      </Button>

      <Button
        variant="ghost"
        size="icon"
        asChild
        className="hidden rounded-[4px] border-2 border-transparent hover:border-border md:inline-flex"
      >
        <a
          href={repoUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="Classifyre on GitHub"
        >
          <SourceIcon
            source="github"
            size="sm"
            className="[&_svg]:text-current"
          />
        </a>
      </Button>

      <ThemeToggle />
    </div>
  );
}
