type ArticleHeroProps = {
  image: string;
  title: string;
  description?: string;
  eyebrow?: string;
};

export function ArticleHero({
  image,
  title,
  description,
  eyebrow,
}: ArticleHeroProps) {
  return (
    <section className="relative -mx-6 mb-10 w-[calc(100%+3rem)] overflow-hidden border-b-2 border-border sm:-mx-10 sm:w-[calc(100%+5rem)]">
      <div className="relative flex min-h-[22rem] w-full items-end sm:min-h-[26rem]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-stone-950/90 via-stone-950/35 to-transparent"
        />

        <div className="relative w-full px-6 pt-24 pb-6 sm:px-10 sm:pb-8">
          {eyebrow ? (
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-amber-300">
              {eyebrow}
            </span>
          ) : null}
          <h1 className="mt-2 max-w-4xl font-serif text-3xl font-black text-balance uppercase leading-[1.05] tracking-[0.04em] text-white sm:text-5xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/85 sm:text-base">
              {description}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
